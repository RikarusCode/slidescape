import { describe, expect, it } from "vitest";
import { advanceBotAction } from "./bot.js";
import { createGame } from "./engine.js";
import { BOARD_SIZE, type GameMode, type GameState } from "./types.js";

function gameWithBotFirst(): GameState {
  for (let seed = 1; seed < 1_000; seed += 1) {
    const state = createGame(
      "bot-test",
      "quick-2",
      [
        { id: "human", name: "Human" },
        { id: "bot", name: "Testing Bot" }
      ],
      seed
    );
    if (state.turn.activePlayerId === "bot") return state;
  }
  throw new Error("Could not find a deterministic bot-first seed.");
}

describe("paced bot actions", () => {
  it("keeps setup intact until the first scheduled action, then exposes the roll separately", () => {
    const setup = gameWithBotFirst();
    expect(setup.version).toBe(1);
    expect(setup.turn.rolled).toBeUndefined();

    const first = advanceBotAction(setup, "bot");
    expect(first.kind).toBe("roll");
    expect(first.state.version).toBe(2);
    expect(first.state.turn.activePlayerId).toBe("bot");
    expect(first.state.turn.rolled).toBeGreaterThanOrEqual(1);
    expect(first.state.turn.rolled).toBeLessThanOrEqual(6);
  });

  it("advances exactly one versioned action at a time until control reaches the human", () => {
    let state = gameWithBotFirst();
    const observedVersions = [state.version];
    let guard = 20;

    while (state.turn.activePlayerId === "bot" && guard-- > 0) {
      const result = advanceBotAction(state, "bot");
      state = result.state;
      observedVersions.push(state.version);
    }

    expect(state.turn.activePlayerId).toBe("human");
    expect(observedVersions.length).toBeGreaterThan(2);
    expect(
      observedVersions.every((version, index) => index === 0 || version === observedVersions[index - 1]! + 1)
    ).toBe(true);
  });

  it("replays seeded multi-mode simulations without corrupting board invariants", () => {
    const modes: GameMode[] = ["quick-2", "strategic-2", "classic-4"];

    for (const mode of modes) {
      const playerCount = mode === "classic-4" ? 4 : 2;
      const guests = Array.from({ length: playerCount }, (_, index) => ({
        id: `player-${index + 1}`,
        name: `Player ${index + 1}`
      }));

      for (const seed of [41]) {
        const simulate = (verifyInvariants: boolean) => {
          let state = createGame(`simulation-${mode}-${seed}`, mode, guests, seed);
          const pieceCount = state.pieces.length;

          for (let action = 0; action < 40 && state.status === "playing"; action += 1) {
            const priorVersion = state.version;
            state = advanceBotAction(state, state.turn.activePlayerId).state;
            if (!verifyInvariants) continue;
            expect(state.version).toBe(priorVersion + 1);
            expect(state.turn.movesRemaining).toBeGreaterThanOrEqual(0);
            expect(state.pieces).toHaveLength(pieceCount);

            const occupied = state.pieces.filter((piece) => !piece.scored).map((piece) => piece.position);
            expect(new Set(occupied.map(({ x, y }) => `${x},${y}`)).size).toBe(occupied.length);
            expect(occupied.every(({ x, y }) => x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE)).toBe(
              true
            );

            for (const player of state.players) {
              const escaped = state.pieces.filter(
                (piece) => piece.kind === "penguin" && piece.ownerId === player.id && piece.scored
              ).length;
              expect(player.score).toBe(escaped);
            }
          }
          return state;
        };

        expect(simulate(true)).toEqual(simulate(false));
      }
    }
  }, 10_000);
});
