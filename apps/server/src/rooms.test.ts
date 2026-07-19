import type { Server } from "socket.io";
import { describe, expect, it, vi } from "vitest";
import type { GameStore } from "./store.js";
import { RoomManager } from "./rooms.js";

function manager() {
  const emit = vi.fn();
  const io = { to: vi.fn(() => ({ emit })) } as unknown as Server;
  const store: GameStore = { save: vi.fn(async () => undefined), load: vi.fn(async () => undefined) };
  return new RoomManager(io, store);
}

describe("room turn timers", () => {
  it("removes a player from public matchmaking when they cancel", () => {
    const rooms = manager();
    const first = rooms.guest("First", "socket-first");
    const second = rooms.guest("Second", "socket-second");
    expect(rooms.queue(first, "quick-2")).toBeUndefined();
    rooms.leaveLobby(first.id);
    expect(rooms.queue(second, "quick-2")).toBeUndefined();
  });

  it("does not match a queued player against a duplicate request from themself", () => {
    const rooms = manager();
    const player = rooms.guest("Player", "socket-player");
    expect(rooms.queue(player, "quick-2")).toBeUndefined();
    expect(rooms.queue(player, "quick-2")).toBeUndefined();
  });

  it("plays the opening bot turn immediately when a bot is randomly chosen first", async () => {
    const rooms = manager();
    const human = rooms.guest("Human", "socket-human");
    let botOpeningRoom: Awaited<ReturnType<RoomManager["createBotGame"]>> | undefined;

    for (let seed = 1; seed <= 100; seed += 1) {
      const room = await rooms.createBotGame(human, "quick-2", seed);
      if (room.game?.log[0]?.startsWith("Testing Bot was randomly chosen")) {
        botOpeningRoom = room;
        break;
      }
    }

    expect(botOpeningRoom).toBeDefined();
    expect(botOpeningRoom!.game!.turn.activePlayerId).toBe(human.id);
    expect(botOpeningRoom!.game!.log.some((entry) => entry.startsWith("Testing Bot rolled"))).toBe(true);
  });

  it("reserves private colors uniquely and always permits returning to random", () => {
    const rooms = manager();
    const host = rooms.guest("Host", "socket-host");
    const guest = rooms.guest("Guest", "socket-guest");
    const room = rooms.createPrivate(host, { mode: "quick-2", turnTimerSeconds: 0 });
    rooms.joinPrivate(guest, room.code!);
    rooms.setColor(room, host.id, "berry-pink");
    expect(() => rooms.setColor(room, guest.id, "berry-pink")).toThrow("already been claimed");
    rooms.setColor(room, host.id, undefined);
    rooms.setColor(room, guest.id, "berry-pink");
    expect(room.members.find((member) => member.id === guest.id)?.colorChoice).toBe("berry-pink");
  });

  it.each([0, 45, 90, 180] as const)("schedules a private %i-second timer", async (turnTimerSeconds) => {
    const rooms = manager();
    const host = rooms.guest("Host", "socket-host");
    const guest = rooms.guest("Guest", "socket-guest");
    const room = rooms.createPrivate(host, { mode: "quick-2", turnTimerSeconds });
    rooms.joinPrivate(guest, room.code!);
    const before = Date.now();

    await rooms.setReady(room, host.id, true);
    await rooms.setReady(room, guest.id, true);

    if (turnTimerSeconds === 0) expect(room.game?.turn.timerDeadline).toBeUndefined();
    else {
      const remaining = room.game!.turn.timerDeadline! - before;
      expect(remaining).toBeGreaterThanOrEqual(turnTimerSeconds * 1_000);
      expect(remaining).toBeLessThan(turnTimerSeconds * 1_000 + 1_000);
    }
    if (room.timeout) clearTimeout(room.timeout);
  });

  it("always schedules 90 seconds for public matchmaking", async () => {
    const rooms = manager();
    const first = rooms.guest("First", "socket-first");
    const second = rooms.guest("Second", "socket-second");
    expect(rooms.queue(first, "quick-2")).toBeUndefined();
    const room = rooms.queue(second, "quick-2")!;
    const before = Date.now();

    await rooms.setReady(room, first.id, true);
    await rooms.setReady(room, second.id, true);

    expect(room.settings.turnTimerSeconds).toBe(90);
    const remaining = room.game!.turn.timerDeadline! - before;
    expect(remaining).toBeGreaterThanOrEqual(90_000);
    expect(remaining).toBeLessThan(91_000);
    if (room.timeout) clearTimeout(room.timeout);
  });

  it("ends a two-player game when a player explicitly leaves", async () => {
    const rooms = manager();
    const host = rooms.guest("Host", "socket-host");
    const guest = rooms.guest("Guest", "socket-guest");
    const room = rooms.createPrivate(host, { mode: "quick-2", turnTimerSeconds: 0 });
    rooms.joinPrivate(guest, room.code!);
    await rooms.setReady(room, host.id, true);
    await rooms.setReady(room, guest.id, true);

    expect(await rooms.leaveGame(host.id)).toBe(room.id);
    expect(room.game?.status).toBe("finished");
    expect(room.game?.winnerId).toBe(guest.id);
    expect(rooms.roomFor(host.id)).toBeUndefined();
  });

  it("removes a departing player and their pieces from a four-player game", async () => {
    const rooms = manager();
    const players = ["One", "Two", "Three", "Four"].map((name, index) => rooms.guest(name, `socket-${index}`));
    const room = rooms.createPrivate(players[0]!, { mode: "classic-4", turnTimerSeconds: 0 });
    players.slice(1).forEach((player) => rooms.joinPrivate(player, room.code!));
    for (const player of players) await rooms.setReady(room, player.id, true);

    await rooms.leaveGame(players[1]!.id);
    expect(room.game?.status).toBe("playing");
    expect(room.game?.turnOrder).not.toContain(players[1]!.id);
    expect(room.game?.pieces.some((piece) => piece.ownerId === players[1]!.id)).toBe(false);
  });
});
