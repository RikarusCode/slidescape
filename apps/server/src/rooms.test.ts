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
});
