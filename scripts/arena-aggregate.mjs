// Aggregate RESULT_JSON blocks emitted by parallel bot-arena.mjs workers.
// Sums per (preset, modes) group across seed-disjoint workers and reports win%,
// decisive win% (excluding draws), and a Wilson 95% CI on the decisive rate.
//
// Usage: node scripts/arena-aggregate.mjs <file1.output> <file2.output> ...

import { readFileSync } from "node:fs";

function wilson(wins, n) {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = wins / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(centre - margin) / d, (centre + margin) / d];
}

const files = process.argv.slice(2);
const groups = new Map(); // key -> { configs: Map(name->{games,wins,draws,avgMoveSum,avgMoveWeight,maxMove,beam,depth}), h2h, workers, games }

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    console.error(`skip (unreadable): ${file}`);
    continue;
  }
  const line = text.split("\n").find((l) => l.includes("RESULT_JSON "));
  if (!line) {
    console.error(`skip (no RESULT_JSON): ${file}`);
    continue;
  }
  const json = JSON.parse(line.slice(line.indexOf("RESULT_JSON ") + "RESULT_JSON ".length));
  const key = `${json.preset} | ${json.modes.join(",")}`;
  if (!groups.has(key)) groups.set(key, { configs: new Map(), h2h: new Map(), workers: 0, games: 0 });
  const g = groups.get(key);
  g.workers += 1;
  g.games += json.gamesPlayed;
  for (const c of json.configs) {
    if (!g.configs.has(c.name))
      g.configs.set(c.name, {
        games: 0,
        wins: 0,
        draws: 0,
        avgMoveSum: 0,
        avgMoveWeight: 0,
        maxMove: 0,
        beam: c.beam,
        depth: c.depth
      });
    const agg = g.configs.get(c.name);
    agg.games += c.games;
    agg.wins += c.wins;
    agg.draws += c.draws;
    agg.avgMoveSum += c.avgMoveMs * c.games; // weight by games as a proxy for move count
    agg.avgMoveWeight += c.games;
    agg.maxMove = Math.max(agg.maxMove, c.maxMoveMs);
  }
  for (const [a, row] of Object.entries(json.h2h)) {
    if (!g.h2h.has(a)) g.h2h.set(a, new Map());
    for (const [b, n] of Object.entries(row)) g.h2h.get(a).set(b, (g.h2h.get(a).get(b) || 0) + n);
  }
}

for (const [key, g] of groups) {
  console.log(`\n==================== ${key} ====================`);
  console.log(`workers=${g.workers}  total games=${g.games}`);
  console.log(
    "Config        Games   W    L    D    Win%   Decisive%   95% CI (decisive)   AvgMove  MaxMove"
  );
  const names = [...g.configs.keys()];
  for (const name of names) {
    const c = g.configs.get(name);
    const losses = c.games - c.wins - c.draws;
    const decisive = c.wins + losses;
    const winPct = c.games ? ((c.wins / c.games) * 100).toFixed(1) : "0";
    const decPct = decisive ? ((c.wins / decisive) * 100).toFixed(1) : "0";
    const [lo, hi] = wilson(c.wins, decisive);
    const ci = `[${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}]`;
    const avgMove = c.avgMoveWeight ? (c.avgMoveSum / c.avgMoveWeight).toFixed(0) : "0";
    console.log(
      `${name.padEnd(12)} ${String(c.games).padStart(5)} ${String(c.wins).padStart(4)} ` +
        `${String(losses).padStart(4)} ${String(c.draws).padStart(4)} ${winPct.padStart(6)} ` +
        `${decPct.padStart(9)}   ${ci.padStart(12)}   ${avgMove.padStart(6)}  ${String(c.maxMove).padStart(6)}`
    );
  }
  console.log("\nHead-to-head (row beat column):");
  console.log("".padEnd(12) + names.map((n) => n.padStart(11)).join(""));
  for (const a of names) {
    const row = names.map((b) => (a === b ? "-" : String(g.h2h.get(a)?.get(b) || 0)).padStart(11)).join("");
    console.log(a.padEnd(12) + row);
  }
}
