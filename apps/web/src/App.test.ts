import { createGame } from "@slidescape/game";
import { describe, expect, it } from "vitest";
import { mergeCanonicalState } from "./App.js";

const players = [
  { id: "player-1", name: "One" },
  { id: "player-2", name: "Two" }
];

describe("canonical game-state merging", () => {
  it("ignores duplicate and older board states", () => {
    const current = createGame("room", "quick-2", players, 42);
    expect(mergeCanonicalState(current, structuredClone(current))).toBe(current);

    const older = structuredClone(current);
    older.version -= 1;
    expect(mergeCanonicalState(current, older)).toBe(current);
  });

  it("accepts same-version presence changes without reopening stale board updates", () => {
    const current = createGame("room", "quick-2", players, 42);
    const presence = structuredClone(current);
    presence.players[1]!.connected = false;
    expect(mergeCanonicalState(current, presence)).toBe(presence);
  });
});
