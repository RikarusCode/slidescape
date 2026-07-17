import { io, type Socket } from "socket.io-client";

export const SESSION_KEY = "haywire-session-v1";
export interface Session { playerId: string; reconnectToken: string }

export function readSession(): Session | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
    return parsed?.reconnectToken ? parsed : undefined;
  } catch { return undefined; }
}

export function connectGame(name: string): Socket {
  const session = readSession();
  return io({ auth: { name, reconnectToken: session?.reconnectToken }, transports: ["websocket", "polling"] });
}

