import type { GameMode } from "@slidescape/game";

export const SESSION_KEY = "slidescape-session-v1";
export interface Session {
  playerId: string;
  reconnectToken: string;
  roomId?: string;
}

interface ActionReply {
  ok: boolean;
  message?: string;
  waiting?: boolean;
  roomId?: string;
  lobby?: unknown;
  game?: unknown;
}
interface WireMessage {
  id?: string;
  event?: string;
  payload?: unknown;
  replyTo?: string;
}
type Listener = (value: unknown) => void;
type ReplyCallback = (error: Error | null, reply?: ActionReply) => void;

export interface GameSocket {
  readonly connected: boolean;
  on<T = undefined>(event: string, listener: (value: T) => void): GameSocket;
  emit(event: string, ...values: unknown[]): GameSocket;
  timeout(milliseconds: number): {
    emit: (event: string, ...values: unknown[]) => void;
  };
  setName(name: string): void;
  disconnect(): void;
}

export function readSession(): Session | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
    return parsed?.playerId && parsed.reconnectToken ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function websocketUrl(path: string): string {
  const url = new URL(path, window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

class SlidescapeSocket implements GameSocket {
  connected = false;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly pending = new Map<string, { callback: ReplyCallback; event: string; timer: number }>();
  private readonly identity: Session;
  private name: string;
  private roomSocket?: WebSocket;
  private queueSocket?: WebSocket;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer?: number;

  constructor(name: string) {
    this.name = name;
    this.identity = readSession() ?? {
      playerId: crypto.randomUUID(),
      reconnectToken: crypto.randomUUID()
    };
    queueMicrotask(() => void this.start());
  }

  on<T = undefined>(event: string, listener: (value: T) => void): GameSocket {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener as unknown as Listener);
    this.listeners.set(event, listeners);
    return this;
  }

  emit(event: string, ...values: unknown[]): GameSocket {
    void this.dispatch(event, values, 5_000);
    return this;
  }

  timeout(milliseconds: number) {
    return {
      emit: (event: string, ...values: unknown[]) => {
        void this.dispatch(event, values, milliseconds);
      }
    };
  }

  // Keep the live name in sync with the input field so that whenever the
  // player next enters a room (match found, private join, reconnect) the server
  // is told their current name rather than the one captured at construction.
  setName(name: string): void {
    this.name = name;
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.queueSocket?.close(1000, "Client left");
    this.roomSocket?.close(1000, "Client left");
    this.queueSocket = undefined;
    this.roomSocket = undefined;
    this.rejectPending("Connection closed.");
    this.setConnected(false);
  }

  private async start(): Promise<void> {
    this.fire("session", { ...this.identity });
    if (this.identity.roomId) {
      try {
        const reply = await this.post("/api/reconnect", {
          ...this.identity,
          name: this.name
        });
        if (reply.ok) {
          this.openRoom(this.identity.roomId);
          return;
        }
        delete this.identity.roomId;
        this.fire(
          "session-reset",
          reply.message ?? "Your previous match is no longer available. You can start a new game."
        );
      } catch {
        this.fire("connect_error", new Error("Could not reach the game server."));
        return;
      }
    }
    this.setConnected(true);
  }

  private async dispatch(event: string, values: unknown[], timeoutMs: number): Promise<void> {
    const callback = typeof values.at(-1) === "function" ? (values.pop() as ReplyCallback) : undefined;
    const payload = values[0];
    try {
      if (event === "create-private")
        return void this.httpRoomAction("/api/private/create", payload, callback);
      if (event === "join-private") return void this.httpRoomAction("/api/private/join", payload, callback);
      if (event === "play-bot") return void this.httpRoomAction("/api/bot", payload, callback);
      if (event === "join-queue") return void this.openQueue((payload as { mode: GameMode }).mode, callback);
      if (event === "leave-lobby" && this.queueSocket) {
        this.queueSocket.close(1000, "Queue cancelled");
        this.queueSocket = undefined;
        callback?.(null, { ok: true });
        return;
      }
      this.sendRoom(event, payload, callback, timeoutMs);
    } catch (error) {
      callback?.(error instanceof Error ? error : new Error("The action failed."));
    }
  }

  private async httpRoomAction(path: string, payload: unknown, callback?: ReplyCallback): Promise<void> {
    try {
      const reply = await this.post(path, {
        ...(payload as object),
        ...this.identity,
        name: this.name
      });
      if (reply.ok && reply.roomId) {
        this.setRoom(reply.roomId);
        if (reply.lobby) this.fire("lobby-state", reply.lobby);
        if (reply.game) this.fire("game-state", reply.game);
        this.openRoom(reply.roomId);
      }
      callback?.(null, reply);
    } catch (error) {
      callback?.(error instanceof Error ? error : new Error("The game server did not respond."));
    }
  }

  private openQueue(mode: GameMode, callback?: ReplyCallback): void {
    this.queueSocket?.close(1000, "Queue replaced");
    const query = new URLSearchParams({
      playerId: this.identity.playerId,
      reconnectToken: this.identity.reconnectToken,
      name: this.name
    });
    const socket = new WebSocket(websocketUrl(`/ws/queue/${mode}?${query}`));
    let opened = false;
    let completed = false;
    this.queueSocket = socket;
    socket.addEventListener(
      "open",
      () => {
        opened = true;
        this.setConnected(true);
        callback?.(null, { ok: true, waiting: true });
      },
      { once: true }
    );
    socket.addEventListener("message", (event) => {
      const message = this.decode(event.data);
      if (message?.event === "matched") {
        const roomId = (message.payload as { roomId?: string } | undefined)?.roomId;
        if (roomId) {
          completed = true;
          this.queueSocket = undefined;
          this.setRoom(roomId);
          this.openRoom(roomId);
        }
      }
    });
    socket.addEventListener(
      "error",
      () => {
        if (!opened && !completed) {
          completed = true;
          callback?.(new Error("Could not join matchmaking."));
        }
      },
      { once: true }
    );
    socket.addEventListener(
      "close",
      () => {
        if (this.queueSocket !== socket) return;
        this.queueSocket = undefined;
        if (!completed) {
          this.fire("connect_error", new Error("Matchmaking disconnected. Please try again."));
        }
      },
      { once: true }
    );
  }

  private openRoom(roomId: string): void {
    if (this.stopped) return;
    this.roomSocket?.close(1000, "Room replaced");
    const query = new URLSearchParams({
      playerId: this.identity.playerId,
      reconnectToken: this.identity.reconnectToken,
      name: this.name
    });
    const socket = new WebSocket(websocketUrl(`/ws/room/${encodeURIComponent(roomId)}?${query}`));
    this.roomSocket = socket;
    socket.addEventListener("open", () => {
      if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
      this.reconnectAttempt = 0;
      this.setConnected(true);
    });
    socket.addEventListener("message", (event) => this.receive(event.data));
    socket.addEventListener("close", () => {
      if (this.roomSocket !== socket) return;
      this.roomSocket = undefined;
      this.setConnected(false);
      if (!this.stopped && this.identity.roomId) this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      if (!this.connected) this.fire("connect_error", new Error("Could not reach the game server."));
    });
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempt, 10_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      if (!this.stopped && this.identity.roomId) this.openRoom(this.identity.roomId);
    }, delay);
  }

  private sendRoom(
    event: string,
    payload: unknown,
    callback: ReplyCallback | undefined,
    timeoutMs: number
  ): void {
    const socket = this.roomSocket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      callback?.(new Error("The room connection is not ready."));
      return;
    }
    const id = crypto.randomUUID();
    if (callback) {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        callback(new Error("The game server did not respond."));
      }, timeoutMs);
      this.pending.set(id, { callback, event, timer });
    }
    socket.send(JSON.stringify({ id, event, payload } satisfies WireMessage));
  }

  private receive(value: unknown): void {
    const message = this.decode(value);
    if (!message) return;
    if (message.replyTo) {
      const pending = this.pending.get(message.replyTo);
      if (pending) {
        window.clearTimeout(pending.timer);
        this.pending.delete(message.replyTo);
        const reply = message.payload as ActionReply;
        pending.callback(null, reply);
        if (reply.ok && (pending.event === "leave-lobby" || pending.event === "leave-game")) this.clearRoom();
      }
      return;
    }
    if (message.event === "session" && message.payload) {
      const next = message.payload as Session;
      Object.assign(this.identity, next);
      localStorage.setItem(SESSION_KEY, JSON.stringify(this.identity));
    }
    if (message.event === "lobby-closed") this.clearRoom();
    if (message.event) this.fire(message.event, message.payload);
  }

  private decode(value: unknown): WireMessage | undefined {
    try {
      return JSON.parse(typeof value === "string" ? value : "") as WireMessage;
    } catch {
      return undefined;
    }
  }

  private async post(path: string, payload: unknown): Promise<ActionReply> {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    let reply: ActionReply;
    try {
      reply = (await response.json()) as ActionReply;
    } catch {
      throw new Error(`The game server returned an invalid response (${response.status}).`);
    }
    if (!response.ok && !reply.message) {
      throw new Error(`The game server rejected the request (${response.status}).`);
    }
    return reply;
  }

  private setRoom(roomId: string): void {
    this.identity.roomId = roomId;
    localStorage.setItem(SESSION_KEY, JSON.stringify(this.identity));
    this.fire("session", { ...this.identity });
  }

  private clearRoom(): void {
    delete this.identity.roomId;
    localStorage.setItem(SESSION_KEY, JSON.stringify(this.identity));
  }

  private setConnected(value: boolean): void {
    if (this.connected === value) return;
    this.connected = value;
    this.fire(value ? "connect" : "disconnect");
  }

  private fire(event: string, value?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }

  private rejectPending(message: string): void {
    for (const { callback, timer } of this.pending.values()) {
      window.clearTimeout(timer);
      callback(new Error(message));
    }
    this.pending.clear();
  }
}

export function connectGame(name: string): GameSocket {
  return new SlidescapeSocket(name);
}
