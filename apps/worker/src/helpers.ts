import type { GameMode, GameState, TurnTimerSeconds } from "@slidescape/game";
import type { ActionReply, SessionIdentity, WireMessage } from "./types.js";

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_TTL_MS = 86_400_000;
export const RECONNECT_MS = 120_000;

export function playerCount(mode: GameMode): number {
  return mode === "classic-4" ? 4 : 2;
}

export function isGameMode(value: unknown): value is GameMode {
  return value === "quick-2" || value === "strategic-2" || value === "classic-4";
}

export function privateTimer(value: unknown): TurnTimerSeconds {
  return value === 45 || value === 90 || value === 180 ? value : 0;
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

export function privateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]!).join("");
}

export function cleanIdentity(input: Partial<SessionIdentity>): SessionIdentity {
  const playerId = typeof input.playerId === "string" && input.playerId.length <= 64 ? input.playerId : "";
  const reconnectToken =
    typeof input.reconnectToken === "string" && input.reconnectToken.length <= 128
      ? input.reconnectToken
      : "";
  if (!playerId || !reconnectToken)
    throw new Error("Your game session is invalid. Return home and try again.");
  return {
    playerId,
    reconnectToken,
    name:
      typeof input.name === "string" ? input.name.trim().slice(0, 24) || "Penguin Player" : "Penguin Player"
  };
}

export function parseWireMessage(value: string | ArrayBuffer): WireMessage {
  const text = typeof value === "string" ? value : new TextDecoder().decode(value);
  const parsed = JSON.parse(text) as WireMessage;
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid message.");
  return parsed;
}

export function serializeEvent(event: string, payload?: unknown): string {
  return JSON.stringify({ event, payload } satisfies WireMessage);
}

export function sendEvent(socket: WebSocket, event: string, payload?: unknown): void {
  socket.send(serializeEvent(event, payload));
}

export function sendReply(socket: WebSocket, replyTo: string | undefined, payload: ActionReply): void {
  if (replyTo) socket.send(JSON.stringify({ replyTo, payload } satisfies WireMessage));
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

/** Remove server-only deck order before a game state crosses the network. */
export function publicGameState(state: GameState): GameState {
  return { ...state, fishDeck: [], poopDeck: [] };
}
