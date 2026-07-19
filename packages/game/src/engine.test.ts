import { describe, expect, it } from "vitest";
import { BOARD_SIZE, HARVEST_CARDS, POOP_CARDS, STARTING_POSITIONS, createGame, drawHarvest, endTurn, legalMoves, move, placeCowAndPoop, playHarvest, roll } from "./index.js";

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

  it("uses the reference 14 by 14 board and edge starting positions", () => {
    expect(BOARD_SIZE).toBe(14);
    expect(STARTING_POSITIONS.green).toEqual([1, 3, 5, 8, 10, 12].map((x) => ({ x, y: 0 })));
    expect(STARTING_POSITIONS.yellow).toEqual([1, 3, 5, 8, 10, 12].map((y) => ({ x: 13, y })));
  });

  it("chooses a random starting player while keeping clockwise seat order", () => {
    const starters = new Set(Array.from({ length: 40 }, (_, seed) => {
      const state = createGame(`starter-${seed}`, "classic-4", guests(4), seed + 1);
      expect(state.turnOrder).toEqual(["p1", "p2", "p3", "p4"]);
      return state.turn.activePlayerId;
    }));
    expect(starters.size).toBeGreaterThan(1);
    const state = createGame("clockwise", "classic-4", guests(4), 91);
    const priorIndex = state.turnOrder.indexOf(state.turn.activePlayerId);
    state.turn.phase = "moving";
    state.turn.movesRemaining = 0;
    const next = endTurn(state, state.turn.activePlayerId);
    expect(next.turn.activePlayerId).toBe(state.turnOrder[(priorIndex + 1) % state.turnOrder.length]);
  });

  it("assigns seven-color choices uniquely and gives strategic teammates matching flocks", () => {
    const state = createGame("themes", "strategic-2", [
      { id: "p1", name: "One", colorChoice: "berry-pink" },
      { id: "p2", name: "Two", colorChoice: "cobalt-blue" }
    ], 51);
    expect(state.players[0]).toMatchObject({ colors: ["green", "blue"], themeColor: "berry-pink" });
    expect(state.players[1]).toMatchObject({ colors: ["red", "yellow"], themeColor: "cobalt-blue" });
    expect(new Set(state.players.map((player) => player.themeColor)).size).toBe(2);
    expect(state.pieces.filter((piece) => piece.color === "green" || piece.color === "blue").every((piece) => piece.ownerId === "p1")).toBe(true);
  });
});

describe("movement", () => {
  it("slides a pig until the square before a blocker", () => {
    const state = createGame("slide", "quick-2", guests(2), 7);
    state.turn.activePlayerId = "p1";
    state.turn.phase = "moving";
    state.turn.rolled = 6;
    state.turn.movesRemaining = 6;
    const candidate = legalMoves(state, "p1").find((entry) => entry.pieceId === "green-pig-1" && entry.direction === "down");
    expect(candidate?.to).toEqual({ x: 1, y: 12 });
    const next = move(state, "p1", candidate!);
    expect(next.pieces.find((piece) => piece.id === "green-pig-1")?.position).toEqual({ x: 1, y: 12 });
    expect(next.turn.movesRemaining).toBe(5);
  });

  it("moves hay exactly one open square", () => {
    const state = createGame("hay", "quick-2", guests(2), 11);
    state.turn.activePlayerId = "p1";
    state.turn.phase = "moving";
    state.turn.rolled = 3;
    state.turn.movesRemaining = 3;
    const moves = legalMoves(state, "p1").filter((entry) => entry.pieceId === "green-hay-1");
    expect(moves.every((entry) => Math.abs(entry.to.x - 5) + Math.abs(entry.to.y - 1) === 1)).toBe(true);
  });

  it("keeps the walrus locked until a roll of one frees it", () => {
    const state = createGame("locked-walrus", "quick-2", guests(2), 8);
    state.turn.activePlayerId = "p1";
    state.turn.phase = "moving";
    state.turn.rolled = 4;
    state.turn.movesRemaining = 4;
    expect(legalMoves(state, "p1").some((entry) => entry.pieceId === "cow")).toBe(false);

    state.turn.rolled = 1;
    state.turn.movesRemaining = 1;
    state.turn.walrusRelocationsRemaining = 1;
    expect(legalMoves(state, "p1").some((entry) => entry.pieceId === "cow")).toBe(false);
    const freed = placeCowAndPoop(state, "p1", { x: 8, y: 5 }, { leavePoop: false });
    freed.turn.movesRemaining = 1;
    expect(freed.fenceActive).toBe(false);
    expect(legalMoves(freed, "p1").some((entry) => entry.pieceId === "cow")).toBe(true);
  });

  it("faces penguins across the board at setup and toward their latest move", () => {
    const state = createGame("facing", "quick-2", guests(2), 6);
    state.turn.activePlayerId = "p1";
    expect(state.pieces.find((piece) => piece.id === "green-pig-1")?.facing).toBe("down");
    expect(state.pieces.find((piece) => piece.id === "red-pig-1")?.facing).toBe("up");
    state.turn.phase = "moving";
    state.turn.rolled = 3;
    state.turn.movesRemaining = 3;
    const candidate = legalMoves(state, "p1").find((entry) => entry.pieceId === "green-pig-1" && entry.direction === "right")!;
    const next = move(state, "p1", candidate);
    expect(next.pieces.find((piece) => piece.id === "green-pig-1")?.facing).toBe("right");
  });

  it("removes the fence and uses one poop from supply on cow placement", () => {
    const state = createGame("cow", "quick-2", guests(2), 9);
    state.turn.activePlayerId = "p1";
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
    state.turn.activePlayerId = "p1";
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
    state.turn.activePlayerId = "p1";
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
    state.turn.activePlayerId = "p1";
    state.turn.phase = "moving";
    state.turn.rolled = 3;
    state.turn.movesRemaining = 3;
    state.players[0]!.effects.flyoverCharges = 1;
    state.pieces.find((piece) => piece.id === "green-pig-1")!.position = { x: 6, y: 5 };
    const fenced = legalMoves(state, "p1").find((candidate) => candidate.pieceId === "green-pig-1" && candidate.direction === "down");
    expect(fenced).toBeUndefined();
    state.fenceActive = false;
    const open = legalMoves(state, "p1").find((candidate) => candidate.pieceId === "green-pig-1" && candidate.direction === "down");
    expect(open?.usesFlyover).toBe(true);
  });

  it("never permits movement after the move budget reaches zero", () => {
    const state = createGame("no-negative-moves", "quick-2", guests(2), 14);
    state.turn.activePlayerId = "p1";
    state.turn.phase = "moving";
    state.turn.rolled = 1;
    state.turn.movesRemaining = 1;
    state.turn.walrusRelocationsRemaining = 1;
    const freed = placeCowAndPoop(state, "p1", { x: 8, y: 5 }, { leavePoop: false });
    expect(freed.turn.movesRemaining).toBe(0);
    expect(legalMoves(freed, "p1")).toEqual([]);
    expect(() => move(freed, "p1", { pieceId: "cow", direction: "down", to: { x: 8, y: 6 }, crossesPoop: [] })).toThrow("No moves remain");
  });
});

describe("turns and Harvest cards", () => {
  it("rolls deterministically for the same seed", () => {
    const firstState = createGame("a", "quick-2", guests(2), 123);
    const secondState = createGame("b", "quick-2", guests(2), 123);
    firstState.turn.activePlayerId = "p1";
    secondState.turn.activePlayerId = "p1";
    const first = roll(firstState, "p1");
    const second = roll(secondState, "p1");
    expect(first.turn.rolled).toBe(second.turn.rolled);
  });

  it("adds two moves without changing the card distribution", () => {
    const state = createGame("card", "quick-2", guests(2), 19);
    state.turn.activePlayerId = "p1";
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
    state.turn.activePlayerId = "p1";
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
    state.turn.activePlayerId = "p1";
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
    state.turn.activePlayerId = "p1";
    state.turn.phase = "moving";
    state.turn.rolled = 1;
    state.turn.movesRemaining = 1;
    state.players[0]!.score = 3;
    const penguin = state.pieces.find((piece) => piece.id === "green-pig-1")!;
    penguin.position = { x: 6, y: 12 };
    state.poop = [{ x: 6, y: 13 }];
    state.poopSupply = 7;
    state.poopDeck = ["return-pig", ...state.poopDeck.filter((card) => card !== "return-pig"), "return-pig"];
    const winningMove = legalMoves(state, "p1").find((candidate) => candidate.pieceId === penguin.id && candidate.direction === "down" && candidate.scores)!;
    const moved = move(state, "p1", winningMove);
    const resolved = endTurn(moved, "p1");
    expect(resolved.status).toBe("playing");
    expect(resolved.players[0]!.score).toBe(3);
  });
});
