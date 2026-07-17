import { describe, expect, it } from "vitest";
import { HARVEST_CARDS, POOP_CARDS, createGame, legalMoves, move, placeCowAndPoop, playHarvest, roll } from "./index.js";

const guests = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `Player ${index + 1}` }));

describe("Haywire setup", () => {
  it("preserves the nine-card deck distributions", () => {
    expect(HARVEST_CARDS.reduce((sum, card) => sum + card.copies, 0)).toBe(9);
    expect(POOP_CARDS.reduce((sum, card) => sum + card.copies, 0)).toBe(9);
    expect(HARVEST_CARDS.find((card) => card.id === "flyover")?.copies).toBe(2);
    expect(POOP_CARDS.find((card) => card.id === "discard-harvest")?.copies).toBe(1);
  });

  it.each([
    ["quick-2", 2, 21],
    ["strategic-2", 2, 41],
    ["classic-4", 4, 41]
  ] as const)("creates %s with the correct players and pieces", (mode, count, pieces) => {
    const state = createGame("test", mode, guests(count), 42);
    expect(state.players).toHaveLength(count);
    expect(state.pieces).toHaveLength(pieces);
    expect(state.harvestDeck).toHaveLength(9);
    expect(state.poopDeck).toHaveLength(9);
    expect(state.poopSupply).toBe(8);
  });
});

describe("movement", () => {
  it("slides a pig until the square before a blocker", () => {
    const state = createGame("slide", "quick-2", guests(2), 7);
    state.turn.phase = "moving";
    state.turn.rolled = 6;
    state.turn.movesRemaining = 6;
    const candidate = legalMoves(state, "p1").find((entry) => entry.pieceId === "green-pig-1" && entry.direction === "down");
    expect(candidate?.to).toEqual({ x: 1, y: 15 });
    const next = move(state, "p1", candidate!);
    expect(next.pieces.find((piece) => piece.id === "green-pig-1")?.position).toEqual({ x: 1, y: 15 });
    expect(next.turn.movesRemaining).toBe(5);
  });

  it("moves hay exactly one open square", () => {
    const state = createGame("hay", "quick-2", guests(2), 11);
    state.turn.phase = "moving";
    state.turn.rolled = 3;
    state.turn.movesRemaining = 3;
    const moves = legalMoves(state, "p1").filter((entry) => entry.pieceId === "green-hay-1");
    expect(moves.every((entry) => Math.abs(entry.to.x - 5) + Math.abs(entry.to.y - 1) === 1)).toBe(true);
  });

  it("removes the fence and uses one poop from supply on cow placement", () => {
    const state = createGame("cow", "quick-2", guests(2), 9);
    state.turn.phase = "moving";
    state.turn.rolled = 1;
    state.turn.movesRemaining = 1;
    const next = placeCowAndPoop(state, "p1", { x: 8, y: 4 });
    expect(next.fenceActive).toBe(false);
    expect(next.poop).toContainEqual({ x: 8, y: 4 });
    expect(next.poopSupply).toBe(7);
  });
});

describe("turns and Harvest cards", () => {
  it("rolls deterministically for the same seed", () => {
    const first = roll(createGame("a", "quick-2", guests(2), 123), "p1");
    const second = roll(createGame("b", "quick-2", guests(2), 123), "p1");
    expect(first.turn.rolled).toBe(second.turn.rolled);
  });

  it("adds two moves without changing the card distribution", () => {
    const state = createGame("card", "quick-2", guests(2), 19);
    state.turn.phase = "moving";
    state.turn.rolled = 4;
    state.turn.movesRemaining = 4;
    state.players[0]!.harvestCard = "avoid-or-two";
    state.players[0]!.harvestDrawnTurn = 0;
    const next = playHarvest(state, "p1", { cardId: "avoid-or-two", choice: "two" });
    expect(next.turn.movesRemaining).toBe(6);
    expect(next.players[0]!.harvestCard).toBeUndefined();
    expect(next.harvestDeck).toHaveLength(10);
  });
});

