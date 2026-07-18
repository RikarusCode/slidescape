import { describe, expect, it } from "vitest";
import { HARVEST_CARDS, POOP_CARDS, createGame, drawHarvest, endTurn, legalMoves, move, placeCowAndPoop, playHarvest, roll } from "./index.js";

const guests = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `Player ${index + 1}` }));

describe("Slidescape setup", () => {
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
    state.turn.walrusRelocationsRemaining = 1;
    const next = placeCowAndPoop(state, "p1", { x: 8, y: 4 });
    expect(next.fenceActive).toBe(false);
    expect(next.poop).toContainEqual({ x: 8, y: 4 });
    expect(next.poopSupply).toBe(7);
  });

  it("can relocate the walrus without leaving poop", () => {
    const state = createGame("clean-walrus", "quick-2", guests(2), 10);
    state.turn.phase = "moving";
    state.turn.rolled = 1;
    state.turn.movesRemaining = 1;
    state.turn.walrusRelocationsRemaining = 1;
    const next = placeCowAndPoop(state, "p1", { x: 8, y: 4 }, { leavePoop: false });
    expect(next.poop).toHaveLength(0);
    expect(next.poopSupply).toBe(8);
  });

  it("recycles an existing poop when all eight tokens are on the board", () => {
    const state = createGame("recycle", "quick-2", guests(2), 12);
    state.turn.phase = "moving";
    state.turn.rolled = 1;
    state.turn.movesRemaining = 1;
    state.turn.walrusRelocationsRemaining = 1;
    state.poop = Array.from({ length: 8 }, (_, x) => ({ x, y: 7 }));
    state.poopSupply = 0;
    const next = placeCowAndPoop(state, "p1", { x: 8, y: 4 }, { leavePoop: true, poopFrom: { x: 0, y: 7 } });
    expect(next.poop).toHaveLength(8);
    expect(next.poop).not.toContainEqual({ x: 0, y: 7 });
    expect(next.poop).toContainEqual({ x: 8, y: 4 });
  });

  it("does not allow a Fish flyover across the fenced walrus", () => {
    const state = createGame("fenced-flyover", "quick-2", guests(2), 13);
    state.turn.phase = "moving";
    state.turn.rolled = 3;
    state.turn.movesRemaining = 3;
    state.players[0]!.effects.flyoverCharges = 1;
    state.pieces.find((piece) => piece.id === "green-pig-1")!.position = { x: 8, y: 6 };
    const fenced = legalMoves(state, "p1").find((candidate) => candidate.pieceId === "green-pig-1" && candidate.direction === "down");
    expect(fenced?.usesFlyover).toBe(false);
    state.fenceActive = false;
    const open = legalMoves(state, "p1").find((candidate) => candidate.pieceId === "green-pig-1" && candidate.direction === "down");
    expect(open?.usesFlyover).toBe(true);
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

  it("doubling a one provides two walrus relocations", () => {
    const state = createGame("double-one", "quick-2", guests(2), 21);
    state.turn.phase = "moving";
    state.turn.rolled = 1;
    state.turn.movesRemaining = 1;
    state.turn.walrusRelocationsRemaining = 1;
    state.players[0]!.harvestCard = "double-roll";
    state.players[0]!.harvestDrawnTurn = 0;
    const doubled = playHarvest(state, "p1", { cardId: "double-roll" });
    expect(doubled.turn.movesRemaining).toBe(2);
    expect(doubled.turn.walrusRelocationsRemaining).toBe(2);
    const first = placeCowAndPoop(doubled, "p1", { x: 8, y: 5 });
    const second = placeCowAndPoop(first, "p1", { x: 8, y: 6 });
    expect(second.poop).toEqual(expect.arrayContaining([{ x: 8, y: 5 }, { x: 8, y: 6 }]));
    expect(second.turn.movesRemaining).toBe(0);
  });

  it("can play a held Fish card before exchanging an untouched two", () => {
    const state = createGame("fish-before-fish", "quick-2", guests(2), 22);
    state.turn.phase = "moving";
    state.turn.rolled = 2;
    state.turn.movesRemaining = 2;
    state.turn.fishDrawAvailable = true;
    state.players[0]!.harvestCard = "avoid-or-two";
    state.players[0]!.harvestDrawnTurn = 0;
    const played = playHarvest(state, "p1", { cardId: "avoid-or-two", choice: "avoid" });
    expect(played.turn.fishDrawAvailable).toBe(true);
    const drawn = drawHarvest(played, "p1");
    expect(drawn.players[0]!.harvestCard).toBeDefined();
    expect(drawn.turn.activePlayerId).toBe("p2");
  });

  it("resolves winning-slide poop before declaring a winner", () => {
    const state = createGame("poop-before-win", "quick-2", guests(2), 23);
    state.turn.phase = "moving";
    state.turn.rolled = 1;
    state.turn.movesRemaining = 1;
    state.players[0]!.score = 3;
    const penguin = state.pieces.find((piece) => piece.id === "green-pig-1")!;
    penguin.position = { x: 8, y: 1 };
    state.poop = [{ x: 8, y: 0 }];
    state.poopSupply = 7;
    state.poopDeck = ["return-pig", ...state.poopDeck.filter((card) => card !== "return-pig"), "return-pig"];
    const winningMove = legalMoves(state, "p1").find((candidate) => candidate.pieceId === penguin.id && candidate.direction === "up" && candidate.scores)!;
    const moved = move(state, "p1", winningMove);
    const resolved = endTurn(moved, "p1");
    expect(resolved.status).toBe("playing");
    expect(resolved.players[0]!.score).toBe(3);
  });
});
