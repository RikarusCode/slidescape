// Self-play A/B arena for tuning the bot's search shape (beam width, depth,
// eval budget). Plays round-robin head-to-head matches between configs and
// reports win rate plus the measured per-move cost, so strength can be weighed
// against time. Configs drive the pure engine at a FIXED search depth (not the
// production wall-clock driver); on turns the production bot actually reaches
// (~depth 4 within its ~1.5s compute cap), this is representative, and the
// reported avg move time is the bridge back to "what fits the budget".
//
// Time-bounded and interleaved: it cycles one game through every matchup before
// deepening the sample, so a run stopped at its --minutes budget still has
// balanced coverage. Parallelize by launching several workers with distinct
// --seed-base values and summing the emitted RESULT_JSON blocks.
//
// Usage:
//   node scripts/bot-arena.mjs --preset beam --modes quick-2 --minutes 30 --seed-base 0 --label w0

import { performance } from "node:perf_hooks";
import {
  createGame,
  advanceBotAction,
  __setSearchMaxDepth,
  __setBeamWidth,
  __setEvalBudget
} from "../packages/game/dist/index.js";

const SHIPPED_BUDGET = 1_500;

const PRESETS = {
  // PRIMARY decision: flat beam 4/5/6 vs the current production adaptive policy
  // (beam=0 -> beamWidthFor: 6/5/4 by branching), all at the shipped depth/budget.
  main: [
    { name: "flat4", beam: 4, depth: 4, budget: SHIPPED_BUDGET },
    { name: "flat5", beam: 5, depth: 4, budget: SHIPPED_BUDGET },
    { name: "flat6", beam: 6, depth: 4, budget: SHIPPED_BUDGET },
    { name: "adaptive", beam: 0, depth: 4, budget: SHIPPED_BUDGET }
  ],
  // Follow-up: is even narrower better? The main sweep was monotonic (4>5>6).
  narrow: [
    { name: "flat2", beam: 2, depth: 4, budget: SHIPPED_BUDGET },
    { name: "flat3", beam: 3, depth: 4, budget: SHIPPED_BUDGET },
    { name: "flat4", beam: 4, depth: 4, budget: SHIPPED_BUDGET },
    { name: "flat5", beam: 5, depth: 4, budget: SHIPPED_BUDGET }
  ],
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
  // The depth-vs-width frontier: each beam at the depth it can reach in ~budget
  // (from the timing sweep). This is what production actually trades off.
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
  const args = {
    preset: "beam",
    modes: ["quick-2", "strategic-2"],
    minutes: 30,
    seedBase: 0,
    label: "arena"
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--preset") args.preset = argv[++i];
    else if (flag === "--modes") args.modes = argv[++i].split(",");
    else if (flag === "--minutes") args.minutes = Number(argv[++i]);
    else if (flag === "--seed-base") args.seedBase = Number(argv[++i]);
    else if (flag === "--label") args.label = argv[++i];
  }
  return args;
}

function applyConfig(cfg) {
  __setSearchMaxDepth(cfg.depth);
  __setBeamWidth(cfg.beam);
  __setEvalBudget(cfg.budget);
}

const playerCountOf = (mode) => (mode === "classic-4" ? 4 : 2);

// Play one game. seatConfigs[i] is the config for the i-th player (turn order).
function playGame(mode, seatConfigs, seed, timeByConfig) {
  const playerCount = seatConfigs.length;
  const guests = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i}`, name: `p${i}` }));
  const configOf = new Map(guests.map((g, i) => [g.id, seatConfigs[i]]));

  let state = createGame(`arena-${mode}-${seed}`, mode, guests, seed);
  const totalScore = (s) => s.players.reduce((sum, p) => sum + p.score, 0);
  let actions = 0;
  let lastProgress = 0; // action index of the last time anyone's score rose.
  let escaped = totalScore(state);
  // Two-player games can reach a mutual-blocking stalemate where neither bot
  // ever scores; such a game would run forever. Treat "no score in STALL_LIMIT
  // actions" as a draw (legit games always score far more often than this, so
  // it never cuts a real game short). HARD_GUARD is a final backstop.
  const STALL_LIMIT = 400;
  const HARD_GUARD = 3000;
  while (state.status === "playing" && actions < HARD_GUARD) {
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
    const nowScore = totalScore(state);
    if (nowScore > escaped) {
      escaped = nowScore;
      lastProgress = actions;
    } else if (actions - lastProgress >= STALL_LIMIT) {
      break; // stalemate -> draw.
    }
  }
  let winnerIndex = -1;
  if (state.winnerId) winnerIndex = guests.findIndex((g) => g.id === state.winnerId);
  return { winnerIndex, actions, finished: state.status === "finished", stalled: !state.winnerId };
}

function newStat() {
  return { games: 0, wins: 0, draws: 0, actionSum: 0 };
}

function main() {
  const { preset, modes, minutes, seedBase, label } = parseArgs(process.argv.slice(2));
  const configs = PRESETS[preset];
  if (!configs) {
    console.error(`Unknown preset "${preset}". Options: ${Object.keys(PRESETS).join(", ")}`);
    process.exit(1);
  }

  const stats = new Map(configs.map((c) => [c.name, newStat()]));
  const timeByConfig = new Map(configs.map((c) => [c.name, { sum: 0, count: 0, max: 0 }]));
  const h2h = new Map(configs.map((a) => [a.name, new Map(configs.map((b) => [b.name, 0]))]));

  // Matchups: every unordered config pair x every mode.
  const matchups = [];
  for (let a = 0; a < configs.length; a += 1) {
    for (let b = a + 1; b < configs.length; b += 1) {
      for (const mode of modes) matchups.push({ A: configs[a], B: configs[b], mode });
    }
  }

  const started = performance.now();
  const deadlineMs = minutes * 60_000;
  let gamesPlayed = 0;
  let gameIndex = seedBase;

  const record = (A, B, mode, swap) => {
    const seats = [];
    const pc = playerCountOf(mode);
    // Cycle A,B across all seats (2 each in classic-4); swap flips the order so
    // neither config keeps the first-move edge.
    for (let i = 0; i < pc; i += 1) seats.push((i % 2 === 0) === !swap ? A : B);
    const { winnerIndex, actions } = playGame(mode, seats, gameIndex, timeByConfig);
    for (const cfg of [A, B]) {
      const s = stats.get(cfg.name);
      s.games += 1;
      s.actionSum += actions;
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
  };

  outer: while (performance.now() - started < deadlineMs) {
    const swap = gameIndex % 2 === 1;
    for (const { A, B, mode } of matchups) {
      record(A, B, mode, swap);
      if (performance.now() - started >= deadlineMs) break outer;
    }
    gameIndex += 1;
    if ((gameIndex - seedBase) % 5 === 0) {
      const secs = Math.round((performance.now() - started) / 1000);
      const line = configs
        .map((c) => `${c.name}:${stats.get(c.name).wins}/${stats.get(c.name).games}`)
        .join("  ");
      console.log(`[${label}] ${secs}s games=${gamesPlayed} | ${line}`);
    }
  }

  const elapsed = ((performance.now() - started) / 1000).toFixed(0);
  const result = {
    label,
    preset,
    modes,
    seedBase,
    gamesPlayed,
    elapsedSeconds: Number(elapsed),
    configs: configs.map((c) => {
      const s = stats.get(c.name);
      const t = timeByConfig.get(c.name);
      return {
        name: c.name,
        beam: c.beam,
        depth: c.depth,
        budget: c.budget,
        games: s.games,
        wins: s.wins,
        draws: s.draws,
        avgMoveMs: t.count ? +(t.sum / t.count).toFixed(1) : 0,
        maxMoveMs: +t.max.toFixed(0),
        avgActions: s.games ? Math.round(s.actionSum / s.games) : 0
      };
    }),
    h2h: Object.fromEntries(configs.map((a) => [a.name, Object.fromEntries(h2h.get(a.name))]))
  };

  console.log(
    `\n[${label}] DONE preset=${preset} modes=${modes.join(",")} games=${gamesPlayed} in ${elapsed}s`
  );
  console.log("Config          Games   Win%   Draw%   AvgMove(ms)  MaxMove(ms)");
  for (const c of result.configs) {
    const winPct = c.games ? ((c.wins / c.games) * 100).toFixed(1) : "0";
    const drawPct = c.games ? ((c.draws / c.games) * 100).toFixed(1) : "0";
    console.log(
      `${c.name.padEnd(15)} ${String(c.games).padStart(5)}  ${winPct.padStart(5)}  ${drawPct.padStart(5)}  ` +
        `${String(c.avgMoveMs).padStart(11)}  ${String(c.maxMoveMs).padStart(11)}`
    );
  }
  console.log(`RESULT_JSON ${JSON.stringify(result)}`);
}

main();
