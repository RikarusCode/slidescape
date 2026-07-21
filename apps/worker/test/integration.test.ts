import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { GameMode, GameState, PlayerColor, TurnTimerSeconds } from "@slidescape/game";
import type { QueueEntry, RoomSnapshot, SessionIdentity, WireMessage } from "../src/types.js";

interface Reply {
  ok: boolean;
  message?: string;
}

const openSockets = new Set<WebSocket>();

function identity(name: string): SessionIdentity {
  return {
    playerId: crypto.randomUUID(),
    reconnectToken: crypto.randomUUID(),
    name
  };
}

class TestSocket {
  readonly socket: WebSocket;
  private readonly events: WireMessage[] = [];
  private readonly eventWaiters = new Map<string, Array<(payload: unknown) => void>>();
  private readonly replyWaiters = new Map<string, (payload: Reply) => void>();

  constructor(socket: WebSocket) {
    this.socket = socket;
    openSockets.add(socket);
    socket.accept();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as WireMessage;
      if (message.replyTo) {
        this.replyWaiters.get(message.replyTo)?.(message.payload as Reply);
        this.replyWaiters.delete(message.replyTo);
        return;
      }
      if (!message.event) return;
      const waiters = this.eventWaiters.get(message.event);
      const waiter = waiters?.shift();
      if (waiter) waiter(message.payload);
      else this.events.push(message);
    });
  }

  next<T>(event: string): Promise<T> {
    const index = this.events.findIndex((message) => message.event === event);
    if (index >= 0) return Promise.resolve(this.events.splice(index, 1)[0]!.payload as T);
    return this.withTimeout<T>(
      new Promise((resolve) => {
        const waiters = this.eventWaiters.get(event) ?? [];
        waiters.push((payload) => resolve(payload as T));
        this.eventWaiters.set(event, waiters);
      }),
      `Timed out waiting for ${event}.`
    );
  }

  send(event: string, payload?: unknown): Promise<Reply> {
    const id = crypto.randomUUID();
    const reply = new Promise<Reply>((resolve) => this.replyWaiters.set(id, resolve));
    this.socket.send(JSON.stringify({ id, event, payload } satisfies WireMessage));
    return this.withTimeout(reply, `Timed out waiting for ${event} reply.`);
  }

  close(): void {
    openSockets.delete(this.socket);
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1000, "Test complete");
  }

  private withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(message)), 3_000);
      promise.then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timeout);
          reject(error);
        }
      );
    });
  }
}

async function roomSocket(roomId: string, player: SessionIdentity): Promise<TestSocket> {
  const query = new URLSearchParams({
    playerId: player.playerId,
    reconnectToken: player.reconnectToken
  });
  const response = await env.GAME_ROOMS.getByName(roomId).fetch(
    new Request(`https://slidescape.test/room?${query}`, {
      headers: { upgrade: "websocket" }
    })
  );
  expect(response.status).toBe(101);
  expect(response.webSocket).toBeDefined();
  return new TestSocket(response.webSocket!);
}

async function queueSocket(mode: GameMode, player: SessionIdentity): Promise<TestSocket> {
  const query = new URLSearchParams({
    mode,
    playerId: player.playerId,
    reconnectToken: player.reconnectToken,
    name: player.name
  });
  const response = await env.MATCHMAKER.getByName(mode).fetch(
    new Request(`https://slidescape.test/queue?${query}`, {
      headers: { upgrade: "websocket" }
    })
  );
  expect(response.status).toBe(101);
  expect(response.webSocket).toBeDefined();
  return new TestSocket(response.webSocket!);
}

async function startPrivate(
  mode: GameMode,
  timer: TurnTimerSeconds,
  players: SessionIdentity[]
): Promise<{ roomId: string; sockets: TestSocket[]; game: GameState }> {
  const roomId = crypto.randomUUID();
  const room = env.GAME_ROOMS.getByName(roomId);
  await room.initializePrivate(roomId, roomId.slice(0, 6), players[0]!, {
    mode,
    turnTimerSeconds: timer
  });
  for (const player of players.slice(1)) await room.joinPrivate(player);
  const sockets = await Promise.all(players.map((player) => roomSocket(roomId, player)));
  for (const socket of sockets.slice(0, -1)) expect((await socket.send("ready", true)).ok).toBe(true);
  const gameEvent = sockets[0]!.next<GameState>("game-state");
  expect((await sockets.at(-1)!.send("ready", true)).ok).toBe(true);
  return { roomId, sockets, game: await gameEvent };
}

afterEach(() => {
  for (const socket of openSockets) {
    if (socket.readyState === WebSocket.OPEN) socket.close(1000, "Test cleanup");
  }
  openSockets.clear();
});

describe("Matchmaker", () => {
  it("deduplicates queue entries and removes a cancelled search", async () => {
    const player = identity("Queue Player");
    const first = await queueSocket("quick-2", player);
    const duplicate = await queueSocket("quick-2", player);
    const stub = env.MATCHMAKER.getByName("quick-2");

    await runInDurableObject(stub, async (_instance, state) => {
      expect((await state.storage.get<QueueEntry[]>("queue"))?.map((entry) => entry.playerId)).toEqual([
        player.playerId
      ]);
    });

    expect((await duplicate.send("leave-lobby")).ok).toBe(true);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.get<QueueEntry[]>("queue")).toEqual([]);
    });
    first.close();
    duplicate.close();
  });

  it("atomically matches two players into the same 90-second public room", async () => {
    const firstPlayer = identity("First");
    const secondPlayer = identity("Second");
    const first = await queueSocket("quick-2", firstPlayer);
    const firstMatch = first.next<{ roomId: string }>("matched");
    const second = await queueSocket("quick-2", secondPlayer);
    const [matchOne, matchTwo] = await Promise.all([firstMatch, second.next<{ roomId: string }>("matched")]);

    expect(matchOne.roomId).toBe(matchTwo.roomId);
    const gameRoom = env.GAME_ROOMS.getByName(matchOne.roomId);
    await runInDurableObject(gameRoom, async (_instance, state) => {
      const room = await state.storage.get<RoomSnapshot>("room");
      expect(room?.settings).toEqual({
        mode: "quick-2",
        privacy: "random",
        turnTimerSeconds: 90
      });
      expect(room?.members.map((member) => member.playerId)).toEqual([
        firstPlayer.playerId,
        secondPlayer.playerId
      ]);
    });
  });
});

describe("GameRoom lobbies", () => {
  it("reserves private colors uniquely and permits returning to random", async () => {
    const host = identity("Host");
    const guest = identity("Guest");
    const roomId = crypto.randomUUID();
    const room = env.GAME_ROOMS.getByName(roomId);
    await room.initializePrivate(roomId, "ABC234", host, {
      mode: "quick-2",
      turnTimerSeconds: 0
    });
    await room.joinPrivate(guest);
    const hostSocket = await roomSocket(roomId, host);
    const guestSocket = await roomSocket(roomId, guest);

    expect((await hostSocket.send("select-color", { color: "berry-pink" })).ok).toBe(true);
    const duplicate = await guestSocket.send("select-color", { color: "berry-pink" });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.message).toContain("claimed");
    expect((await hostSocket.send("select-color", {})).ok).toBe(true);
    expect((await guestSocket.send("select-color", { color: "berry-pink" })).ok).toBe(true);

    await runInDurableObject(room, async (_instance, state) => {
      const snapshot = await state.storage.get<RoomSnapshot>("room");
      expect(
        snapshot?.members.find((member) => member.playerId === host.playerId)?.colorChoice
      ).toBeUndefined();
      expect(snapshot?.members.find((member) => member.playerId === guest.playerId)?.colorChoice).toBe(
        "berry-pink" satisfies PlayerColor
      );
    });
  });

  it.each([0, 45, 90, 180] as const)("arms the selected %i-second private timer", async (timer) => {
    const before = Date.now();
    const { game } = await startPrivate("quick-2", timer, [identity("Host"), identity("Guest")]);

    if (timer === 0) {
      expect(game.turn.timerDurationSeconds).toBeUndefined();
      expect(game.turn.timerDeadline).toBeUndefined();
    } else {
      expect(game.turn.timerDurationSeconds).toBe(timer);
      expect(game.turn.timerDeadline).toBeGreaterThanOrEqual(before + timer * 1_000);
      expect(game.turn.timerDeadline).toBeLessThan(before + timer * 1_000 + 2_000);
    }
  });
});

describe("GameRoom matches", () => {
  it("broadcasts same-version presence changes when a player disconnects and reconnects", async () => {
    const players = [identity("Host"), identity("Guest")];
    const { roomId, sockets, game } = await startPrivate("quick-2", 0, players);

    const disconnectedEvent = sockets[0]!.next<GameState>("game-state");
    sockets[1]!.close();
    const disconnected = await disconnectedEvent;
    expect(disconnected.version).toBe(game.version);
    expect(disconnected.players.find((player) => player.id === players[1]!.playerId)?.connected).toBe(false);

    const reconnectedEvent = sockets[0]!.next<GameState>("game-state");
    const reconnectedSocket = await roomSocket(roomId, players[1]!);
    const reconnected = await reconnectedEvent;
    expect(reconnected.version).toBe(game.version);
    expect(reconnected.players.find((player) => player.id === players[1]!.playerId)?.connected).toBe(true);
    reconnectedSocket.close();
  });

  it("does not mark a player offline when an older duplicate socket closes", async () => {
    const players = [identity("Host"), identity("Guest")];
    const { roomId, sockets } = await startPrivate("quick-2", 0, players);
    const replacement = await roomSocket(roomId, players[1]!);
    await replacement.next<GameState>("game-state");
    sockets[1]!.close();
    await scheduler.wait(25);

    await runInDurableObject(env.GAME_ROOMS.getByName(roomId), async (_instance, state) => {
      const snapshot = (await state.storage.get<RoomSnapshot>("room"))!;
      expect(snapshot.members.find((member) => member.playerId === players[1]!.playerId)?.connected).toBe(
        true
      );
      expect(snapshot.disconnectDeadlines[players[1]!.playerId]).toBeUndefined();
    });
    replacement.close();
  });

  it("keeps one deadline during a turn and starts a new one for the next player", async () => {
    const players = [identity("Host"), identity("Guest")];
    const { roomId, sockets, game } = await startPrivate("quick-2", 45, players);
    const activeIndex = players.findIndex((player) => player.playerId === game.turn.activePlayerId);
    const activeSocket = sockets[activeIndex]!;
    const originalDeadline = game.turn.timerDeadline;
    const rolledEvent = sockets[0]!.next<GameState>("game-state");
    expect(
      (
        await activeSocket.send("command", {
          type: "roll",
          commandId: crypto.randomUUID(),
          expectedVersion: game.version
        })
      ).ok
    ).toBe(true);
    const rolled = await rolledEvent;
    expect(rolled.turn.timerDeadline).toBe(originalDeadline);

    const room = env.GAME_ROOMS.getByName(roomId);
    await runInDurableObject(room, async (_instance, state) => {
      const snapshot = (await state.storage.get<RoomSnapshot>("room"))!;
      snapshot.game!.turn.phase = "moving";
      snapshot.game!.turn.movesRemaining = 0;
      await state.storage.put("room", snapshot);
    });
    const beforeNextTurn = Date.now();
    const nextTurnEvent = sockets[0]!.next<GameState>("game-state");
    expect(
      (
        await activeSocket.send("command", {
          type: "end-turn",
          commandId: crypto.randomUUID(),
          expectedVersion: rolled.version
        })
      ).ok
    ).toBe(true);
    const nextTurn = await nextTurnEvent;
    expect(nextTurn.turn.activePlayerId).not.toBe(game.turn.activePlayerId);
    expect(nextTurn.turn.timerDeadline).toBeGreaterThanOrEqual(beforeNextTurn + 45_000);
  });

  it("rejects stale commands and processes a command id only once", async () => {
    const players = [identity("Host"), identity("Guest")];
    const { sockets, game } = await startPrivate("quick-2", 0, players);
    const activeIndex = players.findIndex((player) => player.playerId === game.turn.activePlayerId);
    const activeSocket = sockets[activeIndex]!;
    const commandId = crypto.randomUUID();
    const command = { type: "roll" as const, commandId, expectedVersion: game.version };
    const stateEvent = sockets[0]!.next<GameState>("game-state");
    expect((await activeSocket.send("command", command)).ok).toBe(true);
    const next = await stateEvent;
    expect((await activeSocket.send("command", command)).ok).toBe(true);
    const stale = await activeSocket.send("command", {
      type: "end-turn",
      commandId: crypto.randomUUID(),
      expectedVersion: game.version
    });
    expect(stale.ok).toBe(false);
    expect(stale.message).toContain("board changed");
    expect(next.version).toBe(game.version + 1);
  });

  it("finishes a two-player game when one player leaves", async () => {
    const players = [identity("Host"), identity("Guest")];
    const { sockets } = await startPrivate("quick-2", 0, players);
    const gameOver = sockets[1]!.next<GameState>("game-over");
    expect((await sockets[0]!.send("leave-game")).ok).toBe(true);
    const finished = await gameOver;
    expect(finished.status).toBe("finished");
    expect(finished.winnerId).toBe(players[1]!.playerId);
  });

  it("removes a departing four-player flock and continues the match", async () => {
    const players = ["One", "Two", "Three", "Four"].map(identity);
    const { sockets } = await startPrivate("classic-4", 0, players);
    const gameState = sockets[0]!.next<GameState>("game-state");
    expect((await sockets[1]!.send("leave-game")).ok).toBe(true);
    const continued = await gameState;
    expect(continued.status).toBe("playing");
    expect(continued.turnOrder).not.toContain(players[1]!.playerId);
    expect(continued.pieces.some((piece) => piece.ownerId === players[1]!.playerId)).toBe(false);
  });

  it("restores durable room state after eviction", async () => {
    const host = identity("Host");
    const roomId = crypto.randomUUID();
    const room = env.GAME_ROOMS.getByName(roomId);
    await room.initializePrivate(roomId, "ABC234", host, {
      mode: "quick-2",
      turnTimerSeconds: 0
    });

    await evictDurableObject(room);

    expect(await room.validateSession(host)).toBe(true);
    await runInDurableObject(room, async (_instance, state) => {
      expect((await state.storage.get<RoomSnapshot>("room"))?.hostId).toBe(host.playerId);
    });
  });

  it("delays an opening bot action until the human client has loaded", async () => {
    const human = identity("Human");
    const roomId = crypto.randomUUID();
    const room = env.GAME_ROOMS.getByName(roomId);
    const initialized = await room.initializeBot(roomId, "quick-2", human);
    const bot = initialized.lobby.members.find((member) => member.isBot)!;
    const botId = bot.id;
    await runInDurableObject(room, async (_instance, state) => {
      const snapshot = (await state.storage.get<RoomSnapshot>("room"))!;
      snapshot.game!.turn.activePlayerId = botId;
      delete snapshot.botActionAt;
      await state.storage.put("room", snapshot);
    });

    const client = await roomSocket(roomId, human);
    const loaded = await client.next<GameState>("game-state");
    expect(loaded.version).toBe(initialized.game.version);
    await runInDurableObject(room, async (_instance, state) => {
      const snapshot = (await state.storage.get<RoomSnapshot>("room"))!;
      expect(snapshot.botActionAt).toBeGreaterThan(Date.now());
      snapshot.botActionAt = Date.now() - 1;
      await Promise.all([state.storage.put("room", snapshot), state.storage.setAlarm(Date.now() + 60_000)]);
    });

    expect(await runDurableObjectAlarm(room)).toBe(true);
    await runInDurableObject(room, async (_instance, state) => {
      const snapshot = (await state.storage.get<RoomSnapshot>("room"))!;
      expect(snapshot.game!.version).toBeGreaterThan(initialized.game.version);
      expect(snapshot.game!.log.some((entry) => entry.startsWith(`${bot.name} rolled`))).toBe(true);
    });
  });
});
