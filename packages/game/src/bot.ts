import { FENCE_POSITIONS, GOAL_GUARD_BOUNDARIES, GOAL_LANES, SCORE_TARGET } from "./config.js";
import {
  drawFish,
  endTurn,
  legalMoves,
  legalMovesForPiece,
  move,
  placeElephantSealAndPoop,
  playFish,
  resolvePoopChoice,
  roll
} from "./engine.js";
import { nextRandom } from "./random.js";
import {
  BOARD_SIZE,
  type Color,
  type Direction,
  type FishCardId,
  type FishPlay,
  type GameState,
  type LegalMove,
  type Piece,
  type PoopCardId,
  type Position
} from "./types.js";

export type BotActionKind = "roll" | "move" | "choice" | "end-turn" | "fish" | "draw-fish" | "elephant-seal";

export interface BotActionResult {
  state: GameState;
  kind: BotActionKind;
}

// =====================================================================
// Geometry helpers (mirror the private ones in engine.ts so the bot can
// reason about slides without paying to run the full engine).
// =====================================================================

const DELTA: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
};
const DIRECTIONS: Direction[] = ["up", "right", "down", "left"];
const COLORS: Color[] = ["green", "yellow", "red", "blue"];

const same = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
const inside = ({ x, y }: Position) => x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
const posKey = ({ x, y }: Position) => `${x},${y}`;
const manhattan = (a: Position, b: Position) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const cellIndex = ({ x, y }: Position) => y * BOARD_SIZE + x;
const step = (position: Position, direction: Direction): Position => ({
  x: position.x + DELTA[direction].x,
  y: position.y + DELTA[direction].y
});

// The fixed direction each color slides to reach its own goal edge.
const HOME_DIRECTION: Record<Color, Direction> = { green: "down", yellow: "left", red: "up", blue: "right" };
// Whether a color's goal "lane track" is a pair of columns (x) or rows (y).
const LANE_IS_COLUMN: Record<Color, boolean> = { green: true, red: true, yellow: false, blue: false };
const LANE_TRACK = [6, 7];

// Mirrors engine crossesGoalGuard: the goal edge is walled off except for the
// 2-wide lane opening, so a piece can't slide sideways along the edge into the
// goal from outside the lane -- it must already be lined up.
function crossesGoalGuard(from: Position, to: Position): boolean {
  if (from.y === to.y && (from.y === 0 || from.y === BOARD_SIZE - 1)) {
    return GOAL_GUARD_BOUNDARIES.some((boundary) => boundary === Math.max(from.x, to.x));
  }
  if (from.x === to.x && (from.x === 0 || from.x === BOARD_SIZE - 1)) {
    return GOAL_GUARD_BOUNDARIES.some((boundary) => boundary === Math.max(from.y, to.y));
  }
  return false;
}

// Mirrors engine exitsThroughGoal: true when a penguin already sitting on its
// goal-edge lane cell would slide outward through the opening (i.e. score).
function exitsThroughGoal(color: Color, position: Position, direction: Direction): boolean {
  const aligned = GOAL_LANES[color].some((goal) =>
    LANE_IS_COLUMN[color] ? goal.x === position.x : goal.y === position.y
  );
  return (
    aligned &&
    ((color === "green" && direction === "down" && position.y === BOARD_SIZE - 1) ||
      (color === "yellow" && direction === "left" && position.x === 0) ||
      (color === "red" && direction === "up" && position.y === 0) ||
      (color === "blue" && direction === "right" && position.x === BOARD_SIZE - 1))
  );
}

const inLaneTrack = (color: Color, pos: Position) =>
  LANE_TRACK.includes(LANE_IS_COLUMN[color] ? pos.x : pos.y);
const offTrackDistance = (color: Color, pos: Position) =>
  Math.min(...LANE_TRACK.map((t) => Math.abs((LANE_IS_COLUMN[color] ? pos.x : pos.y) - t)));

interface SlideResult {
  stop: Position;
  scores: boolean;
  blocker?: Piece;
}

// Where a penguin of `color` would stop sliding from `from` in `direction`,
// given the occupied board -- and whether that slide scores. This is the
// engine's penguinMove logic minus flyover/poop bookkeeping, which is all the
// bot needs to judge scoring-readiness and who is blocking whom.
function slidePenguin(
  color: Color,
  from: Position,
  direction: Direction,
  occupied: Set<number>,
  pieceAt: Map<number, Piece>
): SlideResult {
  let cursor = from;
  while (true) {
    if (exitsThroughGoal(color, cursor, direction)) return { stop: cursor, scores: true };
    const next = step(cursor, direction);
    if (!inside(next) || crossesGoalGuard(cursor, next)) break;
    const index = cellIndex(next);
    if (occupied.has(index)) return { stop: cursor, scores: false, blocker: pieceAt.get(index) };
    cursor = next;
  }
  return { stop: cursor, scores: false };
}

// =====================================================================
// Goal-distance flood fill (kept as a background gradient for pieces that
// are nowhere near their lane; the tier model below carries the real load).
// =====================================================================

const MAX_GOAL_DISTANCE = 40;

function goalDistances(color: Color, blockers: Set<number>): Int16Array {
  const dist = new Int16Array(BOARD_SIZE * BOARD_SIZE).fill(-1);
  const queue: Position[] = [];
  for (const goal of GOAL_LANES[color]) {
    const index = cellIndex(goal);
    if (blockers.has(index)) continue;
    dist[index] = 0;
    queue.push(goal);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]!;
    const nextDist = dist[cellIndex(current)]! + 1;
    for (const direction of DIRECTIONS) {
      const next = step(current, direction);
      if (!inside(next) || crossesGoalGuard(current, next)) continue;
      const index = cellIndex(next);
      if (blockers.has(index) || dist[index] !== -1) continue;
      dist[index] = nextDist;
      queue.push(next);
    }
  }
  return dist;
}

// Concave: losing ground near the goal hurts a lot; a far, stuck piece taking
// a necessary backward step as part of a detour barely does. A linear scale
// over-punished that detour and made the search refuse to fix stuck pieces.
function progressValue(dist: number): number {
  const clamped = dist < 0 ? MAX_GOAL_DISTANCE : Math.min(dist, MAX_GOAL_DISTANCE);
  return MAX_GOAL_DISTANCE - Math.sqrt(clamped * MAX_GOAL_DISTANCE);
}

// =====================================================================
// Per-node board summary: occupied cells, a cell->piece map, and one BFS per
// color. Built once per evaluate() call and shared by every term.
// =====================================================================

interface BoardView {
  occupied: Set<number>;
  pieceAt: Map<number, Piece>;
  distanceMaps: Record<Color, Int16Array>;
}

function buildBoardView(state: GameState): BoardView {
  const occupied = new Set<number>();
  const pieceAt = new Map<number, Piece>();
  for (const piece of state.pieces) {
    if (piece.scored) continue;
    const index = cellIndex(piece.position);
    occupied.add(index);
    pieceAt.set(index, piece);
  }
  if (state.fenceActive) {
    const seal = state.pieces.find((piece) => piece.kind === "elephant-seal");
    for (const position of FENCE_POSITIONS) {
      const index = cellIndex(position);
      occupied.add(index);
      if (seal) pieceAt.set(index, seal);
    }
  }

  // A color's own pieces don't block its own goal reachability (they can move
  // out of the way later); opponents' pieces and ice do. Exactly 4 BFS passes.
  const sameColorCells: Record<Color, number[]> = { green: [], yellow: [], red: [], blue: [] };
  for (const piece of state.pieces) {
    if (piece.color && !piece.scored) sameColorCells[piece.color].push(cellIndex(piece.position));
  }
  const distanceMaps = {} as Record<Color, Int16Array>;
  for (const color of COLORS) {
    const blockers = new Set(occupied);
    for (const index of sameColorCells[color]) blockers.delete(index);
    distanceMaps[color] = goalDistances(color, blockers);
  }

  return { occupied, pieceAt, distanceMaps };
}

// =====================================================================
// Scoring tiers -- the core reframe. Penguins score by SLIDING into their
// lane, so "how lined up am I" matters far more than raw grid distance.
// =====================================================================

type Tier = "scoring" | "aligned" | "setup" | "far";

interface TierResult {
  tier: Tier;
  blocker?: Piece; // for "aligned": the piece stopping the home slide short.
}

function classifyTier(piece: Piece, view: BoardView): TierResult {
  const color = piece.color!;
  const home = slidePenguin(color, piece.position, HOME_DIRECTION[color], view.occupied, view.pieceAt);
  if (home.scores) return { tier: "scoring" };
  if (inLaneTrack(color, piece.position)) return { tier: "aligned", blocker: home.blocker };
  // One slide onto the lane track (needs a backstop to stop it there).
  for (const direction of DIRECTIONS) {
    const slide = slidePenguin(color, piece.position, direction, view.occupied, view.pieceAt);
    if (!same(slide.stop, piece.position) && inLaneTrack(color, slide.stop)) return { tier: "setup" };
  }
  return { tier: "far" };
}

// =====================================================================
// Evaluation. Higher is better for `botId`. All weights share one scale
// anchored at "an escaped penguin = 1000".
// =====================================================================

const SCORE_WEIGHT = 1_000;
const WIN_WEIGHT = 100_000; // a reached target must dwarf any positional term.

// Scoring pipeline (own pieces summed; opponents' scoring-readiness is a
// discrete threat handled separately).
const SCORING_READY_BONUS = 320; // in lane, clear shot to the edge -- a banked point.
const ALIGNED_BONUS = 130; // in the lane track but blocked short.
const SETUP_BONUS = 70; // one slide from landing in the lane track.
const LATERAL_WEIGHT = 10; // -LATERAL_WEIGHT * sqrt(cells off the lane track).
const OWN_PROGRESS_WEIGHT = 4; // demoted BFS gradient, tiebreak for far pieces only.
const OPPONENT_PROGRESS_WEIGHT = 2; // opponents scored by their single best piece.

// Defense.
const OPP_SCORING_PENALTY = 600; // an opponent one slide from scoring (threat or concession).
const BLOCK_BONUS = 40; // we are the piece stopping an aligned opponent short.

// Cards / hazards.
const FISH_CARD_VALUE: Record<FishCardId, number> = {
  "double-roll": 40,
  "relocate-and-roll": 40,
  "steal-or-two": 30,
  "move-opponent": 30,
  flyover: 20,
  "avoid-or-two": 20
};

// Urgency: escalate the right half of the eval when a win is one point away.
const OFFENSE_URGENCY = 1.4;
const DEFENSE_URGENCY = 1.8;

interface Urgency {
  offense: number;
  defense: number;
}

function computeUrgency(state: GameState, botId: string): Urgency {
  const target = SCORE_TARGET[state.mode];
  let me = 0;
  let maxOpp = 0;
  for (const player of state.players) {
    if (player.id === botId) me = player.score;
    else maxOpp = Math.max(maxOpp, player.score);
  }
  return {
    offense: me < target && target - me <= 1 ? OFFENSE_URGENCY : 1,
    defense: target - maxOpp <= 1 ? DEFENSE_URGENCY : 1
  };
}

function poopSeverity(card: PoopCardId, holdsFish: boolean, hasScore: boolean): number {
  switch (card) {
    case "return-penguin":
      return hasScore ? 220 : 0; // a full -1 point swing.
    case "skip-turn":
      return 50;
    case "discard-fish":
      return holdsFish ? 25 : 0;
    case "two-move-turn":
      return 20;
    case "opponent-moves":
      return 15;
  }
}

function pendingPoopPenalty(state: GameState): number {
  if (state.turn.pendingPoop.length === 0) return 0;
  const player = state.players.find((candidate) => candidate.id === state.turn.activePlayerId);
  if (!player) return 0;
  return state.turn.pendingPoop.reduce(
    (total, card) => total + poopSeverity(card, Boolean(player.fishCard), player.score > 0),
    0
  );
}

function evaluate(state: GameState, botId: string): number {
  let total = 0;
  const urgency = computeUrgency(state, botId);
  const target = SCORE_TARGET[state.mode];

  // Material + terminal.
  for (const player of state.players) {
    const sign = player.id === botId ? 1 : -1;
    total += sign * player.score * SCORE_WEIGHT;
    if (player.fishCard) total += sign * FISH_CARD_VALUE[player.fishCard];
    if (player.score >= target) total += sign * WIN_WEIGHT;
  }

  const view = buildBoardView(state);

  let ownTierValue = 0;
  let ownProgress = 0;
  const bestOpponentProgress = new Map<string, number>();
  for (const piece of state.pieces) {
    if (piece.kind !== "penguin" || piece.scored || !piece.color || !piece.ownerId) continue;
    const own = piece.ownerId === botId;
    const { tier, blocker } = classifyTier(piece, view);
    const dist = view.distanceMaps[piece.color]![cellIndex(piece.position)]!;

    if (own) {
      if (tier === "scoring") ownTierValue += SCORING_READY_BONUS * urgency.offense;
      else if (tier === "aligned") ownTierValue += ALIGNED_BONUS;
      else if (tier === "setup") ownTierValue += SETUP_BONUS;
      ownTierValue -= LATERAL_WEIGHT * Math.sqrt(offTrackDistance(piece.color, piece.position));
      ownProgress += progressValue(dist);
    } else {
      // A scoring-ready opponent is the sharpest signal there is -- captures
      // both "left an existing threat open" and "our move just created one".
      if (tier === "scoring") total -= OPP_SCORING_PENALTY * urgency.defense;
      // Reward being the piece that stops an aligned opponent short.
      if (tier === "aligned" && blocker && blocker.ownerId === botId) total += BLOCK_BONUS * urgency.defense;
      const value = progressValue(dist);
      const current = bestOpponentProgress.get(piece.ownerId);
      if (current === undefined || value > current) bestOpponentProgress.set(piece.ownerId, value);
    }
  }
  total += ownTierValue;
  total += ownProgress * OWN_PROGRESS_WEIGHT;
  for (const value of bestOpponentProgress.values()) total -= value * OPPONENT_PROGRESS_WEIGHT;

  // Pending poop lands on whoever's turn it is.
  total += (state.turn.activePlayerId === botId ? -1 : 1) * pendingPoopPenalty(state);

  return total;
}

// =====================================================================
// Cheap lite simulation for lookahead. Mirrors applyMoveUnchecked's effect on
// pieces/score/poop; skips the engine's clone+revalidate+deck work. Candidates
// always come from legalMoves, so they're legal by construction. Only the one
// move the bot actually commits ever goes through the real engine.
// =====================================================================

// Assume crossing poop draws something roughly as bad as a skipped turn -- a
// real deterrent so the search routes penguins around tokens.
const ASSUMED_POOP_CARD: PoopCardId = "skip-turn";

function simulateMoveForSearch(state: GameState, candidate: LegalMove): GameState {
  const pieces = state.pieces.map((piece) => (piece.id === candidate.pieceId ? { ...piece } : piece));
  const piece = pieces.find((candidatePiece) => candidatePiece.id === candidate.pieceId)!;
  const players = state.players.map((player) => ({ ...player, effects: { ...player.effects } }));

  piece.facing = candidate.direction;
  if (candidate.scores) {
    piece.scored = true;
    piece.position = { x: -1, y: -1 };
    const owner = players.find((player) => player.id === piece.ownerId);
    if (owner) owner.score += 1;
  } else {
    piece.position = { ...candidate.to };
  }
  if (candidate.usesFlyover) {
    const mover = players.find((player) => player.id === state.turn.activePlayerId);
    if (mover) mover.effects.flyoverCharges = Math.max(0, mover.effects.flyoverCharges - 1);
  }

  let poop = state.poop;
  let pendingPoop = state.turn.pendingPoop;
  let poopSupply = state.poopSupply;
  if (candidate.crossesPoop.length > 0) {
    poop = poop.filter((token) => !candidate.crossesPoop.some((crossed) => same(crossed, token)));
    poopSupply += candidate.crossesPoop.length;
    pendingPoop = [...pendingPoop, ...candidate.crossesPoop.map(() => ASSUMED_POOP_CARD)];
  }

  return {
    ...state,
    pieces,
    players,
    poop,
    poopSupply,
    turn: {
      ...state.turn,
      pendingPoop,
      movesRemaining: Math.max(0, state.turn.movesRemaining - 1),
      fishDrawAvailable: false
    }
  };
}

// =====================================================================
// Deterministic, board-derived randomness. NEVER derived from state.seed
// (that literally is the next die roll -- using it would be both peeking and
// self-desyncing). A board hash decorrelated from the dice stream gives
// variety across games while staying byte-identical on replay of a seed.
// =====================================================================

function boardHash(state: GameState): number {
  let h = 0x811c9dc5;
  const mix = (value: number) => {
    h ^= value & 0xffff;
    h = Math.imul(h, 0x01000193);
    h ^= (value >>> 16) & 0xffff;
    h = Math.imul(h, 0x01000193);
  };
  for (const piece of state.pieces) mix(piece.scored ? 0x3fff : cellIndex(piece.position));
  for (const player of state.players) mix(player.score);
  mix(state.turn.number);
  mix(state.version);
  return h >>> 0;
}

function boardRandom(state: GameState): number {
  return nextRandom(boardHash(state) ^ 0x9e3779b1)[0];
}

// =====================================================================
// Search: fixed-cost, deterministic maximization over the bot's own remaining
// moves this turn. The bot re-plans every call, so depth 2-3 suffices to avoid
// greedy traps; opponents are handled statically by the eval's threat terms.
// =====================================================================

const SEARCH_MAX_DEPTH = 3;
const EVAL_BUDGET = 1_500; // hard, deterministic cap on evaluate() calls per decision.
const ICE_MOVE_BIAS = 3; // gentle nudge to prefer moving penguins in near-ties.
const TIE_EPS = 6; // candidates within this of the best are "equivalent".
const EXPLORE_PROBABILITY = 0.08; // chance to take a near-best alternative for variety.
const EXPLORE_EPS = 12; // exploration never sacrifices more than this much value.

function beamWidthFor(branching: number): number {
  if (branching <= 8) return 6;
  if (branching <= 16) return 4;
  if (branching <= 24) return 3;
  return 1; // very wide turns fall back to greedy so worst case stays bounded.
}

function canContinue(state: GameState, actorId: string): boolean {
  return (
    state.turn.activePlayerId === actorId && state.turn.phase === "moving" && state.turn.movesRemaining > 0
  );
}

function candidateBias(candidate: LegalMove, state: GameState): number {
  const piece = state.pieces.find((entry) => entry.id === candidate.pieceId);
  return piece && piece.kind !== "penguin" ? -ICE_MOVE_BIAS : 0;
}

interface ScoredCandidate {
  candidate: LegalMove;
  after: GameState;
  value: number;
}

interface SearchResult {
  move: LegalMove;
  after: GameState;
  value: number;
}

// Best evaluate() reachable from `state` within `depth` more of the actor's
// own moves. Pure lite-sim; the shared budget bounds total work.
function bestContinuation(
  state: GameState,
  actorId: string,
  depth: number,
  budget: { evals: number }
): number {
  if (budget.evals <= 0) return evaluate(state, actorId);
  const candidates = legalMoves(state, actorId);
  if (candidates.length === 0) return evaluate(state, actorId);

  const scored: ScoredCandidate[] = [];
  for (const candidate of candidates) {
    if (budget.evals <= 0) break;
    budget.evals -= 1;
    const after = simulateMoveForSearch(state, candidate);
    scored.push({ candidate, after, value: evaluate(after, actorId) + candidateBias(candidate, state) });
  }
  scored.sort((a, b) => b.value - a.value);
  if (depth <= 1) return scored[0]!.value;

  const width = beamWidthFor(candidates.length);
  let best = scored[0]!.value;
  for (const node of scored.slice(0, width)) {
    let value = node.value;
    if (canContinue(node.after, actorId)) {
      value = Math.max(value, bestContinuation(node.after, actorId, depth - 1, budget));
    }
    if (value > best) best = value;
  }
  return best;
}

// Root move selection: deep-value the beam, then pick among near-equivalent
// top candidates with board-derived randomness (variety + anti-oscillation),
// escalating to a sharp pick when a win is on the line.
function searchBestMove(state: GameState, actorId: string, depth: number): SearchResult | undefined {
  const candidates = legalMoves(state, actorId);
  if (candidates.length === 0) return undefined;

  const budget = { evals: EVAL_BUDGET };
  const scored: ScoredCandidate[] = candidates.map((candidate) => {
    budget.evals -= 1;
    const after = simulateMoveForSearch(state, candidate);
    return { candidate, after, value: evaluate(after, actorId) + candidateBias(candidate, state) };
  });
  scored.sort((a, b) => b.value - a.value);

  if (depth > 1) {
    const width = beamWidthFor(candidates.length);
    for (const node of scored.slice(0, width)) {
      if (canContinue(node.after, actorId)) {
        node.value = Math.max(node.value, bestContinuation(node.after, actorId, depth - 1, budget));
      }
    }
    scored.sort((a, b) => b.value - a.value);
  }

  const chosen = chooseWithVariety(scored, state, actorId);
  return { move: chosen.candidate, after: move(state, actorId, chosen.candidate), value: chosen.value };
}

function chooseWithVariety(scored: ScoredCandidate[], state: GameState, actorId: string): ScoredCandidate {
  const best = scored[0]!;
  const urgency = computeUrgency(state, actorId);
  const sharp = urgency.offense > 1 || urgency.defense > 1;
  const rng = boardRandom(state);

  if (!sharp && rng < EXPLORE_PROBABILITY && scored.length > 1) {
    const second = scored[1]!;
    if (best.value - second.value <= EXPLORE_EPS) return second;
  }

  // Random pick among the near-equivalent top band. Deterministic given state
  // (replay-safe) but varies across games and cannot form a stable A->B->A
  // cycle because the hash advances with turn.number / version every action.
  const band = scored.filter((entry) => best.value - entry.value <= TIE_EPS);
  return band[Math.floor(rng * band.length)] ?? best;
}

// =====================================================================
// Elephant-seal relocation (roll of 1). Targeted candidates -- block an
// advanced opponent or backstop one of our own penguins -- not blind nearby
// cells, and never drop poop onto our own slide paths.
// =====================================================================

const SEAL_MIN_GAIN = 20;

function ownForwardSlideCells(state: GameState, actorId: string, view: BoardView): Set<number> {
  const cells = new Set<number>();
  for (const piece of state.pieces) {
    if (piece.kind !== "penguin" || piece.scored || !piece.color || piece.ownerId !== actorId) continue;
    let cursor = piece.position;
    const home = HOME_DIRECTION[piece.color];
    for (let stepCount = 0; stepCount < BOARD_SIZE; stepCount += 1) {
      const next = step(cursor, home);
      if (!inside(next) || crossesGoalGuard(cursor, next) || view.occupied.has(cellIndex(next))) break;
      cells.add(cellIndex(next));
      cursor = next;
    }
  }
  return cells;
}

function elephantSealTargets(state: GameState, actorId: string): Position[] {
  const seen = new Set<string>();
  const targets: Position[] = [];
  const add = (position: Position) => {
    if (!inside(position) || seen.has(posKey(position))) return;
    seen.add(posKey(position));
    targets.push(position);
  };
  const seal = state.pieces.find((piece) => piece.kind === "elephant-seal");
  if (seal) add(seal.position); // in place, purely to drop a blocking poop.
  for (const piece of state.pieces) {
    if (piece.kind !== "penguin" || piece.scored || !piece.color) continue;
    // One cell ahead of a piece: blocks an opponent, or backstops our own.
    add(step(piece.position, HOME_DIRECTION[piece.color]));
  }
  return targets.slice(0, 12);
}

function chooseElephantSealAction(state: GameState, actorId: string): BotActionResult | undefined {
  const depth = Math.min(SEARCH_MAX_DEPTH, state.turn.movesRemaining);
  const normal = searchBestMove(state, actorId, depth);

  const view = buildBoardView(state);
  const ownSlides = ownForwardSlideCells(state, actorId, view);
  let best: { after: GameState; value: number } | undefined;
  for (const to of elephantSealTargets(state, actorId)) {
    // Only leave poop if the cell threatens an opponent path and not our own.
    const onOwnPath = ownSlides.has(cellIndex(to));
    const leavePoopOptions = onOwnPath ? [false] : [true, false];
    for (const leavePoop of leavePoopOptions) {
      let after: GameState;
      try {
        after = placeElephantSealAndPoop(state, actorId, to, { leavePoop });
      } catch {
        continue;
      }
      const value = evaluate(after, actorId);
      if (!best || value > best.value) best = { after, value };
    }
  }

  if (best && (!normal || best.value >= normal.value + SEAL_MIN_GAIN))
    return { state: best.after, kind: "elephant-seal" };
  if (normal) return { state: normal.after, kind: "move" };
  return undefined;
}

// =====================================================================
// Fish cards. Hold only one at a time, so at most one fires per turn.
// =====================================================================

const FLYOVER_MIN_GAIN = 15; // one-shot charge is precious.
const SABOTAGE_MIN_GAIN = 12;
const DRAW_FISH_FLOOR = 15; // bias toward drawing when no move makes real progress.

function alreadyUsable(state: GameState, actorId: string): boolean {
  const player = state.players.find((candidate) => candidate.id === actorId);
  return Boolean(player && player.fishDrawnTurn !== state.turn.number);
}

function tryPlayDoubleRoll(state: GameState, actorId: string): BotActionResult | undefined {
  const player = state.players.find((candidate) => candidate.id === actorId);
  if (player?.fishCard !== "double-roll" || !alreadyUsable(state, actorId)) return undefined;
  return { state: playFish(state, actorId, { cardId: "double-roll" }), kind: "fish" };
}

function tryStartAvoidOrStealTwo(state: GameState, actorId: string): BotActionResult | undefined {
  const player = state.players.find((candidate) => candidate.id === actorId);
  if (!player || !alreadyUsable(state, actorId)) return undefined;
  if (player.fishCard === "avoid-or-two")
    return { state: playFish(state, actorId, { cardId: "avoid-or-two", choice: "start" }), kind: "fish" };
  // Only start a steal if there is actually a card to take; otherwise it is
  // just "add two", which we still want, so start it either way.
  if (player.fishCard === "steal-or-two")
    return { state: playFish(state, actorId, { cardId: "steal-or-two", choice: "start" }), kind: "fish" };
  return undefined;
}

function resolvePendingFishChoice(state: GameState, actorId: string): BotActionResult {
  const pending = state.turn.pendingFishChoice!;
  if (pending.cardId === "avoid-or-two") {
    const choice = state.turn.pendingPoop.length > 0 ? "avoid" : "keep-two";
    return { state: playFish(state, actorId, { cardId: "avoid-or-two", choice }), kind: "fish" };
  }
  // steal-or-two: take the most valuable opponent card, else keep the +2.
  let target: string | undefined;
  let targetValue = 0;
  for (const player of state.players) {
    if (player.id === actorId || !player.fishCard) continue;
    const value = FISH_CARD_VALUE[player.fishCard];
    if (value > targetValue) {
      targetValue = value;
      target = player.id;
    }
  }
  if (target)
    return {
      state: playFish(state, actorId, { cardId: "steal-or-two", choice: "steal", targetPlayerId: target }),
      kind: "fish"
    };
  return { state: playFish(state, actorId, { cardId: "steal-or-two", choice: "keep-two" }), kind: "fish" };
}

function tryPlayFlyover(state: GameState, actorId: string): BotActionResult | undefined {
  const player = state.players.find((candidate) => candidate.id === actorId);
  if (player?.fishCard !== "flyover" || !alreadyUsable(state, actorId)) return undefined;
  if (state.turn.movesRemaining <= 0) return undefined;
  const baseline = searchBestMove(state, actorId, 1);
  let withFlyover: GameState;
  try {
    withFlyover = playFish(state, actorId, { cardId: "flyover" });
  } catch {
    return undefined;
  }
  const withFlyoverBest = searchBestMove(withFlyover, actorId, 1);
  if (!withFlyoverBest) return undefined;
  const baselineValue = baseline ? baseline.value : evaluate(state, actorId);
  if (withFlyoverBest.value <= baselineValue + FLYOVER_MIN_GAIN) return undefined;
  return { state: withFlyover, kind: "fish" };
}

function trySabotageWithMoveOpponent(state: GameState, actorId: string): BotActionResult | undefined {
  const player = state.players.find((candidate) => candidate.id === actorId);
  if (player?.fishCard !== "move-opponent" || !alreadyUsable(state, actorId)) return undefined;

  const baseline = evaluate(state, actorId);
  let best: { after: GameState; value: number } | undefined;
  for (const piece of state.pieces) {
    if (piece.kind === "elephant-seal" || piece.scored || !piece.ownerId || piece.ownerId === actorId)
      continue;
    for (const candidate of legalMovesForPiece(state, piece.id)) {
      if (candidate.scores) continue; // never hand an opponent a point.
      let after: GameState;
      try {
        after = playFish(state, actorId, { cardId: "move-opponent", move: candidate });
      } catch {
        continue;
      }
      const value = evaluate(after, actorId);
      if (!best || value > best.value) best = { after, value };
    }
  }
  if (!best || best.value <= baseline + SABOTAGE_MIN_GAIN) return undefined;
  return { state: best.after, kind: "fish" };
}

function occupiedKeysForPlacement(state: GameState): Set<string> {
  const set = new Set(state.pieces.filter((piece) => !piece.scored).map((piece) => posKey(piece.position)));
  for (const poop of state.poop) set.add(posKey(poop));
  if (state.fenceActive) for (const position of FENCE_POSITIONS) set.add(posKey(position));
  return set;
}

// Recycle the poop token nearest our own pieces (likeliest to bite us).
function chooseRecyclePoop(state: GameState, actorId: string): Position | undefined {
  if (state.poop.length === 0) return undefined;
  let best = state.poop[0]!;
  let bestScore = -Infinity;
  for (const candidate of state.poop) {
    let score = 0;
    for (const piece of state.pieces) {
      if (piece.kind === "penguin" && piece.ownerId === actorId && !piece.scored)
        score += 1 / (1 + manhattan(piece.position, candidate));
    }
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function chooseRelocationTarget(state: GameState, actorId: string, poopFrom: Position): Position | undefined {
  const blocked = occupiedKeysForPlacement(state);
  const opponents = state.pieces.filter(
    (piece) => piece.kind === "penguin" && !piece.scored && piece.ownerId && piece.ownerId !== actorId
  );
  let best: Position | undefined;
  let bestScore = -Infinity;
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const candidate = { x, y };
      if (same(candidate, poopFrom) || blocked.has(posKey(candidate))) continue;
      let score = 0;
      for (const opponent of opponents) score += 1 / (1 + manhattan(candidate, opponent.position));
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }
  return best;
}

function tryPlayRelocateAndRoll(state: GameState, actorId: string): BotActionResult | undefined {
  const player = state.players.find((candidate) => candidate.id === actorId);
  if (player?.fishCard !== "relocate-and-roll" || !alreadyUsable(state, actorId)) return undefined;
  if (state.turn.movesRemaining !== 0) return undefined;

  let play: FishPlay = { cardId: "relocate-and-roll" };
  if (state.poop.length > 0) {
    const poopFrom = chooseRecyclePoop(state, actorId) ?? state.poop[0]!;
    const poopTo = chooseRelocationTarget(state, actorId, poopFrom);
    if (!poopTo) return undefined;
    play = { cardId: "relocate-and-roll", poopFrom, poopTo };
  }
  try {
    return { state: playFish(state, actorId, play), kind: "fish" };
  } catch {
    return undefined;
  }
}

function chooseDrawFishOrMove(state: GameState, actorId: string): BotActionResult | undefined {
  const depth = Math.min(SEARCH_MAX_DEPTH, state.turn.movesRemaining);
  const normal = searchBestMove(state, actorId, depth);
  let drawn: GameState | undefined;
  try {
    drawn = drawFish(state, actorId);
  } catch {
    drawn = undefined;
  }
  if (drawn) {
    // Drawing is worth a fresh card; take it unless a move clears a real
    // progress bar over just holding position.
    const drawnValue = evaluate(drawn, actorId) + DRAW_FISH_FLOOR;
    if (!normal || drawnValue > normal.value) return { state: drawn, kind: "draw-fish" };
  }
  if (normal) return { state: normal.after, kind: "move" };
  return undefined;
}

// Return an escaped penguin to the start cell with the best comeback (lowest
// goal distance), minimizing the regret of the forced -1.
function resolveReturnPenguinChoice(state: GameState, actorId: string): GameState {
  const choice = state.turn.pendingChoice!;
  const view = buildBoardView(state);
  let bestPieceId = choice.options[0]!.pieceId;
  let bestPosition = choice.options[0]!.positions[0]!;
  let bestDist = Infinity;
  for (const option of choice.options) {
    for (const position of option.positions) {
      const dist = view.distanceMaps[option.color]![cellIndex(position)]!;
      const normalized = dist < 0 ? MAX_GOAL_DISTANCE : dist;
      if (normalized < bestDist) {
        bestDist = normalized;
        bestPieceId = option.pieceId;
        bestPosition = position;
      }
    }
  }
  return resolvePoopChoice(state, actorId, bestPieceId, bestPosition);
}

// =====================================================================
// Entry point: one engine transition per call.
// =====================================================================

export function advanceBotAction(state: GameState, actorId: string): BotActionResult {
  const active = state.players.find((player) => player.id === actorId);
  if (!active || state.status !== "playing" || state.turn.activePlayerId !== actorId) {
    throw new Error("The bot is not the active player.");
  }

  if (state.turn.pendingChoice) {
    return { state: resolveReturnPenguinChoice(state, actorId), kind: "choice" };
  }

  if (state.turn.pendingFishChoice) {
    return resolvePendingFishChoice(state, actorId);
  }

  // Pre-roll forced opponent move: pick the one least useful to them (which is
  // exactly the one maximizing our own eval), never a scoring move.
  if (state.turn.phase === "awaiting-roll" && state.turn.forcedPieceOwnerIds?.length) {
    const best = searchBestMove(state, actorId, 1);
    if (best) return { state: best.after, kind: "move" };
    return { state: roll(state, actorId), kind: "roll" };
  }

  if (state.turn.phase === "awaiting-roll") {
    return { state: roll(state, actorId), kind: "roll" };
  }

  if (state.turn.phase === "moving") {
    const doubleRoll = tryPlayDoubleRoll(state, actorId);
    if (doubleRoll) return doubleRoll;

    // Starting avoid/steal is pure upside: it grants +2 now, and only opens a
    // follow-up choice (cancel poop / take a card) when one is actually worth
    // taking. Worst case it is simply "+2 moves".
    const startAvoidOrSteal = tryStartAvoidOrStealTwo(state, actorId);
    if (startAvoidOrSteal) return startAvoidOrSteal;

    if ((state.turn.elephantSealRelocationsRemaining ?? 0) > 0 && state.turn.movesRemaining > 0) {
      const sealChoice = chooseElephantSealAction(state, actorId);
      if (sealChoice) return sealChoice;
    }

    if (
      state.turn.movesRemaining === 2 &&
      state.turn.fishDrawAvailable &&
      !state.turn.fishForbidden &&
      !active.fishCard
    ) {
      const drawChoice = chooseDrawFishOrMove(state, actorId);
      if (drawChoice) return drawChoice;
    }

    if (state.turn.movesRemaining > 0) {
      const sabotage = trySabotageWithMoveOpponent(state, actorId);
      if (sabotage) return sabotage;

      const flyoverPlay = tryPlayFlyover(state, actorId);
      if (flyoverPlay) return flyoverPlay;

      const best = searchBestMove(state, actorId, Math.min(SEARCH_MAX_DEPTH, state.turn.movesRemaining));
      if (best) return { state: best.after, kind: "move" };
    }

    const relocate = tryPlayRelocateAndRoll(state, actorId);
    if (relocate) return relocate;
  }

  return { state: endTurn(state, actorId), kind: "end-turn" };
}
