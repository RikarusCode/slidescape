import { performance } from "node:perf_hooks";
import { createGame, legalMoves } from "../packages/game/dist/index.js";

const scenarios = [
  { mode: "quick-2", players: 2 },
  { mode: "strategic-2", players: 2 },
  { mode: "classic-4", players: 4 }
];
const iterations = 100;

const results = scenarios.map(({ mode, players }) => {
  const guests = Array.from({ length: players }, (_, index) => ({
    id: `player-${index + 1}`,
    name: `Player ${index + 1}`
  }));
  const state = createGame(`benchmark-${mode}`, mode, guests, 42);
  state.turn.activePlayerId = guests[0].id;
  state.turn.phase = "moving";
  state.turn.rolled = 6;
  state.turn.movesRemaining = 6;

  for (let warmup = 0; warmup < 10; warmup += 1) legalMoves(state, guests[0].id);
  const started = performance.now();
  let moveCount = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    moveCount = legalMoves(state, guests[0].id).length;
  }
  const elapsed = performance.now() - started;
  return {
    mode,
    legalMoves: moveCount,
    iterations,
    totalMilliseconds: Number(elapsed.toFixed(2)),
    meanMilliseconds: Number((elapsed / iterations).toFixed(3))
  };
});

console.log(JSON.stringify({ benchmark: "initial legal move generation", results }, null, 2));
