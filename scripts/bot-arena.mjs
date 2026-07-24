// Self-play A/B arena for tuning the bot's search shape (beam width, depth,
// eval budget). Plays round-robin head-to-head matches between configs and
// reports win rate plus the measured per-move cost, so strength can be weighed
// against time. Configs drive the pure engine at a FIXED search depth (not the
// production wall-clock driver), which keeps runs fast and reproducible-modulo
// the bot's own opening/tie variety; the reported avg move time is the bridge
// back to "what fits the 1-3s budget".
//
// Usage:
//   pnpm arena                       # default preset, default game count
//   pnpm arena -- --preset frontier --games 40 --modes quick-2,strategic-2
//   pnpm arena -- --preset beam-bigbudget

import { performance } from "node:perf_hooks";
import {
  createGame,
  advanceBotAction,
  __setSearchMaxDepth,
  __setBeamWidth,
  __setEvalBudget,
  __resetEvalBudget
} from "../packages/game/dist/index.js";

const SHIPPED_BUDGET = 1_500;

// A config is a point in (beam, depth, budget) space. beam 0 = adaptive default.
const PRESETS = {
  // Isolate beam at equal depth and the shipped budget (production regime).
  beam: [
    { name: "beam4-d4", beam: 4, depth: 4, budget: SHIPPED_BUDGET },
    { name: "beam5-d4", beam: 5, depth: 4, budget: SHIPPED_BUDGET },
    { name: "beam6-d4", beam: 6, depth: 4, budget: SHIPPED_BUDGET }
  ],
  // Same, but with the eval budget lifted so it can't mask a wider beam.
  "beam-bigbudget": [
    { name: "beam4-d4-big", beam: 4, depth: 4, budget: 60_000 },
    { name: "beam5-d4-big", beam: 5, depth: 4, budget: 60_000 },
    { name: "beam6-d4-big", beam: 6, depth: 4, budget: 60_000 }
  ],
  // The equal-ish-time frontier: each beam at the depth it can reach in ~budget
  // (from the timing sweep). Compare with the avg-move-time column.
  frontier: [
    { name: "beam4-d5", beam: 4, depth: 5, budget: 60_000 },
    { name: "beam5-d4", beam: 5, depth: 4, budget: 60_000 },
    { name: "beam6-d4", beam: 6, depth: 4, budget: 60_000 }
  ],
  // Depth ladder at a fixed beam, to see how much depth alone buys.
  depth: [
    { name: "beam4-d3", beam: 4, depth: 3, budget: 60_000 },
    { name: "beam4-d4", beam: 4, depth: 4, budget: 60_000 },
    { name: "beam4-d5", beam: 4, depth: 5, budget: 60_000 }
  ]
};

function parseArgs(argv) {
  const args = { preset: "beam", games: 24, modes: ["quick-2", "strategic-2"] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--preset") args.preset = argv[++i];
    else if (flag === "--games") args.games = Number(argv[++i]);
    else if (flag === "--modes") args.modes = argv[++i].split(",");
  }
  return args;
}

function applyConfig(cfg) {
  __setSearchMaxDepth(cfg.depth);
  __setBeamWidth(cfg.beam);
  __setEvalBudget(cfg.budget);
}

// Play one game. seatConfigs[i] is the config for the i-th guest (turn order).
// Returns { winnerIndex | -1 for draw, actions, timeByConfig }.
function playGame(mode, seatConfigs, seed) {
  const playerCount = mode === "classic-4" ? 4 : 2;
  const guests = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i}`, name: `p${i}` }));
  const configOf = new Map(guests.map((g, i) => [g.id, seatConfigs[i]]));
  const timeByConfig = new Map(seatConfigs.map((c) => [c.name, { sum: 0, count: 0, max: 0 }]));

  let state = createGame(`arena-${mode}-${seed}`, mode, guests, seed);
  let actions = 0;
  const guard = 4000;
  while (state.status === "playing" && actions < guard) {
    const actor = state.turn.activePlayerId;
    const cfg = configOf.get(actor);
    applyConfig(cfg);
    const t0 = performance.now();
    const result = advanceBotAction(state, actor, { maxDepth: cfg.depth });
    const dt = performance.now() - t0;
    const bucket = timeByConfig.get(cfg.name);
    bucket.sum += dt;
    bucket.count += 1;
    if (dt > bucket.max) bucket.max = dt;
    state = result.state;
    actions += 1;
  }

  let winnerIndex = -1;
  if (state.winnerId) winnerIndex = guests.findIndex((g) => g.id === state.winnerId);
  return { winnerIndex, actions, finished: state.status === "finished", timeByConfig };
}

function newStat() {
  return { games: 0, wins: 0, draws: 0, moveSum: 0, moveCount: 0, moveMax: 0, actionSum: 0 };
}

function main() {
  const { preset, games, modes } = parseArgs(process.argv.slice(2));
  const configs = PRESETS[preset];
  if (!configs) {
    console.error(`Unknown preset "${preset}". Options: ${Object.keys(PRESETS).join(", ")}`);
    process.exit(1);
  }

  const stats = new Map(configs.map((c) => [c.name, newStat()]));
  // Head-to-head win matrix: h2h[a][b] = games a beat b.
  const h2h = new Map(configs.map((a) => [a.name, new Map(configs.map((b) => [b.name, 0]))]));

  const started = performance.now();
  let gamesPlayed = 0;

  for (let a = 0; a < configs.length; a += 1) {
    for (let b = a + 1; b < configs.length; b += 1) {
      const A = configs[a];
      const B = configs[b];
      for (const mode of modes) {
        for (let g = 0; g < games; g += 1) {
          // Play each seed twice with swapped seats so neither config keeps the
          // first-move edge -- a proper paired (mirrored) comparison.
          const swap = g % 2 === 1;
          const seats = swap ? [B, A] : [A, B];
          const seed = 5000 + Math.floor(g / 2);
          const { winnerIndex, actions, timeByConfig } = playGame(mode, seats, seed);

          for (const cfg of [A, B]) {
            const s = stats.get(cfg.name);
            s.games += 1;
            s.actionSum += actions;
            const t = timeByConfig.get(cfg.name);
            s.moveSum += t.sum;
            s.moveCount += t.count;
            if (t.max > s.moveMax) s.moveMax = t.max;
          }
          if (winnerIndex === -1) {
            stats.get(A.name).draws += 1;
            stats.get(B.name).draws += 1;
          } else {
            const winner = seats[winnerIndex];
            const loser = winner === A ? B : A;
            stats.get(winner.name).wins += 1;
            h2h.get(winner.name).set(loser.name, h2h.get(winner.name).get(loser.name) + 1);
          }
          gamesPlayed += 1;
        }
      }
    }
  }

  __resetEvalBudget();
  __setBeamWidth(0);
  __setSearchMaxDepth(3);

  const elapsed = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`\nArena preset="${preset}" games/pairing/mode=${games} modes=${modes.join(",")}`);
  console.log(`Played ${gamesPlayed} games in ${elapsed}s\n`);

  console.log("Config          Games   Win%   Draw%   AvgMove(ms)  MaxMove(ms)  AvgActions/game");
  for (const cfg of configs) {
    const s = stats.get(cfg.name);
    const winPct = ((s.wins / s.games) * 100).toFixed(1);
    const drawPct = ((s.draws / s.games) * 100).toFixed(1);
    const avgMove = (s.moveSum / s.moveCount).toFixed(1);
    const avgActions = (s.actionSum / s.games).toFixed(0);
    console.log(
      `${cfg.name.padEnd(15)} ${String(s.games).padStart(5)}  ${winPct.padStart(5)}  ${drawPct.padStart(5)}  ` +
        `${avgMove.padStart(11)}  ${s.moveMax.toFixed(0).padStart(11)}  ${avgActions.padStart(15)}`
    );
  }

  console.log("\nHead-to-head (row beat column, count):");
  const header = ["".padEnd(15), ...configs.map((c) => c.name.padStart(12))].join(" ");
  console.log(header);
  for (const A of configs) {
    const row = configs.map((B) => (A === B ? "-" : String(h2h.get(A.name).get(B.name))).padStart(12));
    console.log(`${A.name.padEnd(15)} ${row.join(" ")}`);
  }
}

main();
