import type { GameMode, TurnTimerSeconds } from "@slidescape/game";
import { cleanIdentity, isGameMode, json, privateCode, privateTimer } from "./helpers.js";
import type { SessionIdentity } from "./types.js";

export { GameRoom } from "./GameRoom.js";
export { Matchmaker } from "./Matchmaker.js";

interface CreatePrivateBody extends SessionIdentity {
  mode: GameMode;
  turnTimerSeconds: TurnTimerSeconds;
}
interface ModeBody extends SessionIdentity {
  mode: GameMode;
}
const MAX_JSON_BODY_BYTES = 16_384;

async function body<T>(request: Request): Promise<T> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new Error("Expected a JSON request.");
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES)
    throw new Error("Request is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES)
    throw new Error("Request is too large.");
  return JSON.parse(text) as T;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json({ ok: true, service: "slidescape-worker" });

      if (url.pathname.startsWith("/ws/queue/") && request.headers.get("upgrade")) {
        const mode = url.pathname.split("/").pop();
        if (!isGameMode(mode)) return json({ ok: false, message: "Invalid game mode." }, 400);
        url.searchParams.set("mode", mode);
        return env.MATCHMAKER.getByName(mode).fetch(new Request(url, request));
      }

      if (url.pathname.startsWith("/ws/room/") && request.headers.get("upgrade")) {
        const roomId = decodeURIComponent(url.pathname.slice("/ws/room/".length));
        if (!roomId || roomId.length > 64) return json({ ok: false, message: "Invalid room." }, 400);
        return env.GAME_ROOMS.getByName(roomId).fetch(request);
      }

      if (request.method === "POST" && url.pathname === "/api/private/create") {
        const input = await body<CreatePrivateBody>(request);
        const identity = cleanIdentity(input);
        if (!isGameMode(input.mode)) return json({ ok: false, message: "Invalid game mode." }, 400);
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const code = privateCode();
          const lobby = await env.GAME_ROOMS.getByName(code).initializePrivate(code, code, identity, {
            mode: input.mode,
            turnTimerSeconds: privateTimer(input.turnTimerSeconds)
          });
          if (lobby) return json({ ok: true, roomId: code, lobby });
        }
        return json(
          {
            ok: false,
            message: "Could not reserve a private room code. Try again."
          },
          503
        );
      }

      if (request.method === "POST" && url.pathname === "/api/private/join") {
        const input = await body<SessionIdentity & { code: string }>(request);
        const identity = cleanIdentity(input);
        const code = typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code))
          return json({ ok: false, message: "Enter a valid six-character room code." }, 400);
        const lobby = await env.GAME_ROOMS.getByName(code).joinPrivate(identity);
        return json({ ok: true, roomId: code, lobby });
      }

      if (request.method === "POST" && url.pathname === "/api/bot") {
        const input = await body<ModeBody>(request);
        const identity = cleanIdentity(input);
        if (!isGameMode(input.mode)) return json({ ok: false, message: "Invalid game mode." }, 400);
        const roomId = crypto.randomUUID();
        const initialized = await env.GAME_ROOMS.getByName(roomId).initializeBot(
          roomId,
          input.mode,
          identity
        );
        return json({
          ok: true,
          roomId,
          lobby: initialized.lobby,
          game: initialized.game
        });
      }

      if (request.method === "POST" && url.pathname === "/api/reconnect") {
        const input = await body<SessionIdentity & { roomId?: string }>(request);
        const identity = cleanIdentity(input);
        const roomId = typeof input.roomId === "string" ? input.roomId : "";
        if (!roomId || roomId.length > 64)
          return json({
            ok: false,
            message: "Your previous match is no longer available. You can start a new game."
          });
        const available = await env.GAME_ROOMS.getByName(roomId).validateSession(identity);
        return json(
          available
            ? { ok: true, roomId }
            : {
                ok: false,
                message: "Your previous match is no longer available. You can start a new game."
              }
        );
      }

      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/"))
        return json({ ok: false, message: "Not found." }, 404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "request_failed",
          path: url.pathname,
          error: error instanceof Error ? error.message : String(error)
        })
      );
      return json(
        {
          ok: false,
          message: error instanceof Error ? error.message : "The request failed."
        },
        400
      );
    }
  }
} satisfies ExportedHandler<Env>;
