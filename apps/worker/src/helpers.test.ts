import { createGame } from "@slidescape/game";
import { describe, expect, it } from "vitest";
import {
  cleanIdentity,
  isGameMode,
  privateCode,
  privateTimer,
  publicGameState,
  serializeEvent
} from "./helpers.js";

describe("worker protocol helpers", () => {
  it("normalizes untrusted lobby inputs", () => {
    expect(
      cleanIdentity({
        playerId: "player-1",
        reconnectToken: "token-1",
        name: "  A very patient penguin  "
      })
    ).toEqual({
      playerId: "player-1",
      reconnectToken: "token-1",
      name: "A very patient penguin"
    });
    expect(() => cleanIdentity({ playerId: "", reconnectToken: "token", name: "Player" })).toThrow();
    expect(isGameMode("strategic-2")).toBe(true);
    expect(isGameMode("unknown")).toBe(false);
    expect(privateTimer(90)).toBe(90);
    expect(privateTimer(30)).toBe(0);
  });

  it("creates unambiguous six-character room codes", () => {
    const code = privateCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it("serializes one protocol envelope", () => {
    expect(JSON.parse(serializeEvent("status", { ok: true }))).toEqual({
      event: "status",
      payload: { ok: true }
    });
  });

  it("redacts deck order without mutating canonical game state", () => {
    const state = createGame(
      "public-state",
      "quick-2",
      [
        { id: "p1", name: "One" },
        { id: "p2", name: "Two" }
      ],
      101
    );
    const fishDeck = [...state.fishDeck];
    const poopDeck = [...state.poopDeck];

    const publicState = publicGameState(state);

    expect(publicState.fishDeck).toEqual([]);
    expect(publicState.poopDeck).toEqual([]);
    expect(state.fishDeck).toEqual(fishDeck);
    expect(state.poopDeck).toEqual(poopDeck);
  });
});
