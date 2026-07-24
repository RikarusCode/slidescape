import { describe, expect, it } from "vitest";
import { advanceBotAction } from "./bot.js";
import {
  createGame,
  drawFish,
  endTurn,
  legalMoves,
  move,
  playFish,
  resolvePoopChoice,
  roll
} from "./engine.js";
import { BOARD_SIZE, type GameMode, type GameState, type LegalMove } from "./types.js";

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

          for (let action = 0; action < 28 && state.status === "playing"; action += 1) {
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
    // Production paces the bot with an anytime iterative-deepening driver whose
    // committed depth depends on the wall clock, so full games are NOT
    // byte-identical across machines. What must stay deterministic is the
    // underlying search at a *fixed* depth -- that's what advanceBotAction (no
    // maxDepth => the default) exercises here, and what this replay asserts.
    // The per-decision search (bounded beam + goal-distance BFS) is heavier than
    // the trivial bot this test's original 10s cap was sized for; the generous
    // ceiling is headroom for slower CI, not an expected runtime.
  }, 90_000);

  // Regression guard for the "bot froze mid-turn" bug: the server computes the
  // bot's action eagerly, so if advanceBotAction ever throws for a valid bot
  // turn the turn strands with no follow-up scheduled and the game visibly
  // hangs. It must ALWAYS return exactly one legal engine transition. This
  // plays many games where a chaotic random "human" perturbs the board into the
  // odd late-game states pure self-play never reaches.
  it("never throws and always advances exactly one action for a valid bot turn", () => {
    let rng = 123456789;
    const rnd = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = <T>(items: T[]): T => items[Math.floor(rnd() * items.length)]!;

    const humanAction = (state: GameState, actorId: string): GameState => {
      const t = state.turn;
      try {
        if (t.pendingChoice) {
          const option = pick(t.pendingChoice.options);
          return resolvePoopChoice(state, actorId, option.pieceId, pick(option.positions));
        }
        if (t.pendingFishChoice)
          return playFish(state, actorId, { cardId: t.pendingFishChoice.cardId, choice: "keep-two" });
        if (t.phase === "awaiting-roll" && t.forcedPieceOwnerIds?.length) {
          const moves = legalMoves(state, actorId);
          return moves.length ? move(state, actorId, pick(moves)) : roll(state, actorId);
        }
        if (t.phase === "awaiting-roll") return roll(state, actorId);
        if (t.phase === "moving" && t.movesRemaining > 0) {
          const player = state.players.find((candidate) => candidate.id === actorId)!;
          if (t.fishDrawAvailable && !player.fishCard && rnd() < 0.5) return drawFish(state, actorId);
          const moves = legalMoves(state, actorId);
          if (moves.length) return move(state, actorId, pick(moves));
        }
        return endTurn(state, actorId);
      } catch {
        return endTurn(state, actorId);
      }
    };

    // Kept deliberately small so the whole file stays well under the timeout;
    // it samples varied mid/late-game states rather than playing games out.
    const scenarios: Array<{ mode: GameMode; ids: string[]; seed: number }> = [
      { mode: "quick-2", ids: ["human", "bot"], seed: 1 },
      { mode: "quick-2", ids: ["human", "bot"], seed: 2 },
      { mode: "strategic-2", ids: ["human", "bot"], seed: 1 },
      { mode: "strategic-2", ids: ["human", "bot"], seed: 2 },
      { mode: "strategic-2", ids: ["human", "bot"], seed: 3 },
      { mode: "classic-4", ids: ["human", "bot", "bot2", "bot3"], seed: 1 }
    ];
    const isBot = (id: string) => id.startsWith("bot");

    for (const { mode, ids, seed } of scenarios) {
      const guests = ids.map((id) => ({ id, name: id }));
      let state = createGame(`crash-guard-${mode}-${seed}`, mode, guests, seed);
      for (let action = 0; action < 90 && state.status === "playing"; action += 1) {
        const actor = state.turn.activePlayerId;
        if (isBot(actor)) {
          const before = state.version;
          const result = advanceBotAction(state, actor); // must not throw
          expect(result.state.version).toBe(before + 1);
          state = result.state;
        } else {
          state = humanAction(state, actor);
        }
      }
    }
  }, 90_000);
});

describe("iterative-deepening plan (PV)", () => {
  // Advance a self-play game until the bot faces a multi-move "moving" turn.
  function multiMoveState(mode: GameMode, seed: number, minMoves: number): GameState | undefined {
    const playerCount = mode === "classic-4" ? 4 : 2;
    const guests = Array.from({ length: playerCount }, (_, index) => ({
      id: `p${index + 1}`,
      name: `p${index + 1}`
    }));
    let state = createGame(`pv-${mode}-${seed}`, mode, guests, seed);
    for (let step = 0; step < 400 && state.status === "playing"; step += 1) {
      if (state.turn.phase === "moving" && state.turn.movesRemaining >= minMoves) return state;
      state = advanceBotAction(state, state.turn.activePlayerId).state;
    }
    return undefined;
  }

  it("returns a legal principal variation no longer than the search depth", () => {
    const state = multiMoveState("strategic-2", 5, 3);
    expect(state).toBeDefined();
    const actor = state!.turn.activePlayerId;

    // Cap at depth 4: enough to exercise multi-ply PV structure, without paying
    // for the seconds-long depth-5/6 searches the wide production beam incurs.
    const maxDepth = Math.min(state!.turn.movesRemaining, 4);
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const result = advanceBotAction(state!, actor, { maxDepth: depth });
      expect(result.kind).toBe("move");
      const plan = result.plan ?? [];
      // The PV covers only moves AFTER the committed one, so it can never be
      // longer than the remaining lookahead.
      expect(plan.length).toBeLessThanOrEqual(depth - 1);
      // Every planned move must be legal to replay from the committed state.
      let cursor = result.state;
      for (const planned of plan) {
        if (cursor.turn.phase !== "moving" || cursor.turn.movesRemaining <= 0) break;
        const legal = legalMoves(cursor, actor).some(
          (candidate) => candidate.pieceId === planned.pieceId && candidate.direction === planned.direction
        );
        expect(legal).toBe(true);
        cursor = move(cursor, actor, planned);
      }
    }
  }, 20_000);

  it("carries the plan forward across a full turn without regressing or throwing", () => {
    const state = multiMoveState("quick-2", 9, 3);
    expect(state).toBeDefined();
    const actor = state!.turn.activePlayerId;

    // Mirror the driver: commit each move, then seed the next search with the
    // carried plan tail. Every committed action must be exactly one legal
    // engine transition, all the way to the end of the bot's turn.
    let current = state!;
    let plan: LegalMove[] = [];
    let guard = 16;
    while (current.turn.activePlayerId === actor && current.status === "playing" && guard-- > 0) {
      const before = current.version;
      const result = advanceBotAction(current, actor, { maxDepth: 4, plan });
      expect(result.state.version).toBe(before + 1);
      plan = result.kind === "move" ? (result.plan ?? []) : [];
      current = result.state;
    }
    expect(guard).toBeGreaterThan(0); // the turn terminated rather than looping.
  }, 20_000);
});
