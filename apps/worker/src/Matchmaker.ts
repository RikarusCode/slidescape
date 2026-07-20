import { DurableObject } from "cloudflare:workers";
import type { GameMode } from "@slidescape/game";
import { cleanIdentity, isGameMode, parseWireMessage, playerCount, sendEvent, sendReply } from "./helpers.js";
import type { QueueEntry, SessionIdentity } from "./types.js";

interface QueueAttachment { playerId: string }

export class Matchmaker extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode");
    if (!isGameMode(mode)) return new Response("Invalid game mode", { status: 400 });
    let identity: SessionIdentity;
    try {
      identity = cleanIdentity({
        playerId: url.searchParams.get("playerId") ?? "",
        reconnectToken: url.searchParams.get("reconnectToken") ?? "",
        name: url.searchParams.get("name") ?? ""
      });
    } catch (error) { return new Response(error instanceof Error ? error.message : "Invalid session", { status: 400 }); }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ playerId: identity.playerId } satisfies QueueAttachment);
    this.ctx.acceptWebSocket(server, [identity.playerId]);
    const queue = (await this.ctx.storage.get<QueueEntry[]>("queue")) ?? [];
    const withoutDuplicate = queue.filter((entry) => entry.playerId !== identity.playerId);
    withoutDuplicate.push({ ...identity, mode, queuedAt: Date.now() });
    await this.ctx.storage.put("queue", withoutDuplicate);
    await this.match(mode, withoutDuplicate);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, value: string | ArrayBuffer): Promise<void> {
    try {
      const message = parseWireMessage(value);
      if (message.event === "leave-lobby") {
        await this.remove(socket);
        sendReply(socket, message.id, { ok: true });
      }
    } catch { sendReply(socket, undefined, { ok: false, message: "Invalid queue message." }); }
  }

  async webSocketClose(socket: WebSocket): Promise<void> { await this.remove(socket); }
  async webSocketError(socket: WebSocket): Promise<void> { await this.remove(socket); }

  private async match(mode: GameMode, queue: QueueEntry[]): Promise<void> {
    const needed = playerCount(mode);
    if (queue.length < needed) return;
    const members = queue.slice(0, needed);
    const remaining = queue.slice(needed);
    const roomId = crypto.randomUUID();
    const room = this.env.GAME_ROOMS.getByName(roomId);
    await this.ctx.storage.put("queue", remaining);
    try {
      await room.initializePublic(roomId, mode, members.map(({ playerId, reconnectToken, name }) => ({ playerId, reconnectToken, name })));
    } catch (error) {
      const current = (await this.ctx.storage.get<QueueEntry[]>("queue")) ?? [];
      await this.ctx.storage.put("queue", [...members, ...current.filter((entry) => !members.some((member) => member.playerId === entry.playerId))]);
      console.error(JSON.stringify({ level: "error", message: "match_creation_failed", mode, error: error instanceof Error ? error.message : String(error) }));
      return;
    }
    const matchedIds = new Set(members.map((member) => member.playerId));
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as QueueAttachment | null;
      if (attachment && matchedIds.has(attachment.playerId)) {
        sendEvent(socket, "matched", { roomId });
        socket.close(1000, "Matched");
      }
    }
  }

  private async remove(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as QueueAttachment | null;
    if (!attachment?.playerId) return;
    const queue = (await this.ctx.storage.get<QueueEntry[]>("queue")) ?? [];
    const remaining = queue.filter((entry) => entry.playerId !== attachment.playerId);
    if (remaining.length !== queue.length) await this.ctx.storage.put("queue", remaining);
  }
}
