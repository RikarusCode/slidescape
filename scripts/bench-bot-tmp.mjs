import { createGame, advanceBotAction } from "../packages/game/dist/index.js";

const guests = Array.from({ length: 4 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));

// Find a non-finishing classic-4 seed and inspect its progression.
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  let state = createGame(`c4-${seed}`, "classic-4", guests, seed);
  let actions = 0;
  const scoreLog = [];
  while (state.status === "playing" && actions < 6000) {
    state = advanceBotAction(state, state.turn.activePlayerId).state;
    actions += 1;
    if (actions % 1000 === 0) scoreLog.push(state.players.map((p) => p.score).join(","));
  }
  console.log(
    JSON.stringify({
      seed,
      finished: state.status === "finished",
      actions,
      finalScores: state.players.map((p) => p.score),
      per1000: scoreLog
    })
  );
}
