import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { Server } from "socket.io";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { ClientCommand, GameMode } from "@haywire/game";
import { RoomManager, type Member } from "./rooms.js";
import { createStore } from "./store.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true, credentials: true });
await app.register(rateLimit, { max: 180, timeWindow: "1 minute" });

app.get("/health", async () => ({ ok: true, service: "haywire-server" }));
app.get("/metrics", async () => ({ ok: true, uptimeSeconds: Math.floor(process.uptime()) }));

const webRoot = resolve(process.cwd(), "apps/web/dist");
const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
app.get("/assets/*", async (request, reply) => {
  const asset = String((request.params as { "*": string })["*"] ?? "").replaceAll("..", "");
  const path = join(webRoot, "assets", asset);
  return reply.type(mime[extname(path)] ?? "application/octet-stream").send(await readFile(path));
});
app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await readFile(join(webRoot, "index.html"))));
app.get("/*", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await readFile(join(webRoot, "index.html"))));

const io = new Server(app.server, { cors: { origin: true, credentials: true }, transports: ["websocket", "polling"] });
const rooms = new RoomManager(io, createStore());

io.on("connection", (socket) => {
  let member: Member | undefined;
  const auth = socket.handshake.auth as { name?: string; reconnectToken?: string };
  if (auth.reconnectToken) {
    const restored = rooms.reconnect(auth.reconnectToken, socket.id);
    if (restored) {
      member = restored.member;
      socket.join(restored.room.id);
      socket.emit("session", { playerId: member.id, reconnectToken: member.reconnectToken });
      socket.emit("lobby-state", rooms.publicLobby(restored.room));
      if (restored.room.game) socket.emit("game-state", restored.room.game);
    }
  }
  member ??= rooms.guest(auth.name ?? "Farmhand", socket.id);
  socket.emit("session", { playerId: member.id, reconnectToken: member.reconnectToken });

  socket.on("create-private", async (payload: { mode: GameMode; turnTimer: boolean }, reply) => {
    try {
      const room = rooms.createPrivate(member!, payload);
      await socket.join(room.id);
      rooms.emitLobby(room);
      reply?.({ ok: true, room: rooms.publicLobby(room) });
    } catch (error) { reply?.({ ok: false, message: error instanceof Error ? error.message : "Could not create room." }); }
  });

  socket.on("join-private", async (payload: { code: string }, reply) => {
    try {
      const room = rooms.joinPrivate(member!, payload.code);
      await socket.join(room.id);
      rooms.emitLobby(room);
      reply?.({ ok: true, room: rooms.publicLobby(room) });
    } catch (error) { reply?.({ ok: false, message: error instanceof Error ? error.message : "Could not join room." }); }
  });

  socket.on("join-queue", async (payload: { mode: GameMode }, reply) => {
    const room = rooms.queue(member!, payload.mode);
    if (room) {
      for (const candidate of room.members) io.sockets.sockets.get(candidate.socketId)?.join(room.id);
      rooms.emitLobby(room);
    }
    reply?.({ ok: true, waiting: !room });
  });

  socket.on("ready", async (ready: boolean) => {
    const room = rooms.roomFor(member!.id);
    if (room) await rooms.setReady(room, member!.id, ready);
  });
  socket.on("timer-vote", (enabled: boolean) => {
    const room = rooms.roomFor(member!.id);
    if (room) rooms.setTimerVote(room, member!.id, enabled);
  });
  socket.on("command", async (command: ClientCommand, reply) => {
    const room = rooms.roomFor(member!.id);
    if (!room) return reply?.({ ok: false, message: "Join a room first." });
    try { await rooms.command(room, member!.id, command); reply?.({ ok: true }); }
    catch (error) { reply?.({ ok: false, message: error instanceof Error ? error.message : "Command rejected." }); }
  });
  socket.on("disconnect", () => rooms.disconnect(member!.id));
});

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
