import { COLOR_ORDER, GOAL_LANES, HAY_POSITIONS, SCORE_TARGET, STARTING_POSITIONS } from "./config.js";
import { expandedHarvestDeck, expandedPoopDeck } from "./cards.js";
import { nextRandom, shuffle } from "./random.js";
import {
  BOARD_SIZE,
  type Color,
  type Direction,
  type GameMode,
  type GameState,
  type HarvestPlay,
  type LegalMove,
  type Piece,
  type PlayerState,
  type Position
} from "./types.js";

const DELTA: Record<Direction, Position> = {
  up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }
};
const DIRECTIONS = Object.keys(DELTA) as Direction[];

const key = ({ x, y }: Position) => `${x},${y}`;
const same = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
const inside = ({ x, y }: Position) => x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
const step = (position: Position, direction: Direction): Position => ({
  x: position.x + DELTA[direction].x,
  y: position.y + DELTA[direction].y
});

function emptyEffects() {
  return { skipTurns: 0, forcedTwoMoveTurns: 0, forcedOpponentMoves: 0, flyoverCharges: 0, avoidPoopCharges: 0 };
}

function playerColors(mode: GameMode): Color[][] {
  if (mode === "quick-2") return [["green"], ["red"]];
  if (mode === "strategic-2") return [["green", "yellow"], ["red", "blue"]];
  return COLOR_ORDER.map((color) => [color]);
}

export function createGame(
  id: string,
  mode: GameMode,
  guests: { id: string; name: string }[],
  seed = Date.now() >>> 0
): GameState {
  const assignments = playerColors(mode);
  if (guests.length !== assignments.length) throw new Error(`${mode} requires ${assignments.length} players.`);
  const players: PlayerState[] = guests.map((guest, index) => ({
    ...guest,
    colors: assignments[index]!,
    score: 0,
    connected: true,
    effects: emptyEffects()
  }));
  const ownerByColor = new Map<Color, string>();
  for (const player of players) for (const color of player.colors) ownerByColor.set(color, player.id);

  const activeColors = assignments.flat();
  const pieces: Piece[] = [];
  for (const color of activeColors) {
    STARTING_POSITIONS[color].forEach((position, index) => pieces.push({
      id: `${color}-pig-${index + 1}`, kind: "pig", color, ownerId: ownerByColor.get(color), position: { ...position }
    }));
    HAY_POSITIONS[color].forEach((position, index) => pieces.push({
      id: `${color}-hay-${index + 1}`, kind: "hay", color, ownerId: ownerByColor.get(color), position: { ...position }
    }));
  }
  pieces.push({ id: "cow", kind: "cow", position: { x: 8, y: 8 } });
  const [harvestDeck, afterHarvest] = shuffle(expandedHarvestDeck(), seed);
  const [poopDeck, afterPoop] = shuffle(expandedPoopDeck(), afterHarvest);
  return {
    schemaVersion: 1,
    id,
    mode,
    status: "playing",
    version: 1,
    seed: afterPoop,
    players,
    pieces,
    poop: [],
    fenceActive: true,
    poopSupply: 8,
    harvestDeck,
    poopDeck,
    turnOrder: players.map((player) => player.id),
    turn: { number: 1, activePlayerId: players[0]!.id, phase: "awaiting-roll", movesRemaining: 0, pendingPoop: [] },
    log: [`${players[0]!.name} goes first.`]
  };
}

export function activePlayer(state: GameState): PlayerState {
  const player = state.players.find((candidate) => candidate.id === state.turn.activePlayerId);
  if (!player) throw new Error("Active player is missing.");
  return player;
}

function occupied(state: GameState, except?: string): Map<string, Piece> {
  return new Map(state.pieces.filter((piece) => !piece.scored && piece.id !== except).map((piece) => [key(piece.position), piece]));
}

function exitsThroughGoal(piece: Piece, position: Position, direction: Direction): boolean {
  if (piece.kind !== "pig" || !piece.color) return false;
  const aligned = GOAL_LANES[piece.color].some((goal) => piece.color === "green" || piece.color === "red" ? goal.x === position.x : goal.y === position.y);
  return aligned && (
    (piece.color === "green" && direction === "up" && position.y === 0) ||
    (piece.color === "yellow" && direction === "right" && position.x === 16) ||
    (piece.color === "red" && direction === "down" && position.y === 16) ||
    (piece.color === "blue" && direction === "left" && position.x === 0)
  );
}

function pigMove(state: GameState, piece: Piece, direction: Direction, flyover = false): LegalMove | undefined {
  const blockers = occupied(state, piece.id);
  let cursor = piece.position;
  const crossedPoop: Position[] = [];
  let ignored = false;
  let moved = false;
  while (true) {
    if (exitsThroughGoal(piece, cursor, direction)) {
      return { pieceId: piece.id, direction, to: cursor, scores: true, crossesPoop: crossedPoop, usesFlyover: ignored };
    }
    const next = step(cursor, direction);
    if (!inside(next)) break;
    const blocker = blockers.get(key(next));
    if (blocker) {
      if (flyover && !ignored && ["pig", "hay", "cow"].includes(blocker.kind)) {
        ignored = true;
        cursor = next;
        continue;
      }
      break;
    }
    cursor = next;
    moved = true;
    if (state.poop.some((poop) => same(poop, cursor))) crossedPoop.push({ ...cursor });
  }
  if (!moved || same(cursor, piece.position)) return undefined;
  return { pieceId: piece.id, direction, to: { ...cursor }, crossesPoop: crossedPoop, usesFlyover: ignored };
}

function stepMove(state: GameState, piece: Piece, direction: Direction): LegalMove | undefined {
  const to = step(piece.position, direction);
  if (!inside(to) || occupied(state, piece.id).has(key(to))) return undefined;
  return {
    pieceId: piece.id,
    direction,
    to,
    crossesPoop: piece.kind === "hay" && state.poop.some((poop) => same(poop, to)) ? [{ ...to }] : []
  };
}

function goalAccess(state: GameState, player: PlayerState): boolean {
  const hardBlockers = new Set(
    state.pieces
      .filter((piece) => !piece.scored && piece.kind !== "cow" && piece.ownerId !== player.id)
      .map((piece) => key(piece.position))
  );
  for (const pig of state.pieces.filter((piece) => piece.kind === "pig" && !piece.scored && piece.ownerId === player.id)) {
    if (!pig.color) continue;
    const goals = GOAL_LANES[pig.color];
    const target = new Set(goals.map(key));
    const queue = [{ ...pig.position }];
    const seen = new Set([key(pig.position)]);
    let reached = false;
    while (queue.length && !reached) {
      const current = queue.shift()!;
      if (target.has(key(current))) { reached = true; break; }
      for (const direction of DIRECTIONS) {
        const next = step(current, direction);
        const id = key(next);
        if (inside(next) && !hardBlockers.has(id) && !seen.has(id)) {
          seen.add(id);
          queue.push(next);
        }
      }
    }
    if (!reached) return false;
  }
  return true;
}

function moveActorAllowed(state: GameState, piece: Piece, actorId: string): boolean {
  if (piece.kind === "cow") return true;
  if (piece.ownerId === actorId) return true;
  const active = activePlayer(state);
  return active.effects.forcedOpponentMoves > 0 && piece.ownerId !== actorId;
}

export function legalMoves(state: GameState, actorId = state.turn.activePlayerId): LegalMove[] {
  if (state.status !== "playing") return [];
  const active = activePlayer(state);
  const preRollOpponentMove = state.turn.phase === "awaiting-roll" && active.effects.forcedOpponentMoves > 0;
  if (state.turn.phase !== "moving" && !preRollOpponentMove) return [];
  const moves: LegalMove[] = [];
  for (const piece of state.pieces) {
    if (piece.scored || !moveActorAllowed(state, piece, actorId)) continue;
    if (preRollOpponentMove && (piece.ownerId === actorId || piece.kind === "cow")) continue;
    for (const direction of DIRECTIONS) {
      const move = piece.kind === "pig" ? pigMove(state, piece, direction, active.effects.flyoverCharges > 0) : stepMove(state, piece, direction);
      if (!move) continue;
      const clone = structuredClone(state);
      applyMoveUnchecked(clone, move, false);
      if (clone.players.every((player) => goalAccess(clone, player))) moves.push(move);
    }
  }
  return moves;
}

export function legalMovesForPiece(state: GameState, pieceId: string): LegalMove[] {
  const piece = state.pieces.find((candidate) => candidate.id === pieceId && !candidate.scored);
  if (!piece) return [];
  return DIRECTIONS.flatMap((direction) => {
    const candidate = piece.kind === "pig" ? pigMove(state, piece, direction) : stepMove(state, piece, direction);
    if (!candidate) return [];
    const clone = structuredClone(state);
    applyMoveUnchecked(clone, candidate, false);
    return clone.players.every((player) => goalAccess(clone, player)) ? [candidate] : [];
  });
}

function drawPoop(state: GameState): void {
  if (state.poopDeck.length === 0) state.poopDeck = expandedPoopDeck();
  const card = state.poopDeck.shift();
  if (card) state.turn.pendingPoop.push(card);
}

function applyMoveUnchecked(state: GameState, move: LegalMove, triggerPoop = true): void {
  const piece = state.pieces.find((candidate) => candidate.id === move.pieceId);
  if (!piece) throw new Error("Piece not found.");
  if (move.scores) {
    piece.scored = true;
    piece.position = { x: -1, y: -1 };
    const owner = state.players.find((player) => player.id === piece.ownerId);
    if (owner) owner.score += 1;
  } else piece.position = { ...move.to };
  if (move.usesFlyover) activePlayer(state).effects.flyoverCharges = Math.max(0, activePlayer(state).effects.flyoverCharges - 1);
  if (!triggerPoop) return;
  for (const crossed of move.crossesPoop) {
    const index = state.poop.findIndex((poop) => same(poop, crossed));
    if (index < 0) continue;
    state.poop.splice(index, 1);
    state.poopSupply += 1;
    if (activePlayer(state).effects.avoidPoopCharges > 0) activePlayer(state).effects.avoidPoopCharges -= 1;
    else drawPoop(state);
  }
}

export function roll(state: GameState, actorId: string): GameState {
  const next = structuredClone(state);
  if (next.status !== "playing" || next.turn.activePlayerId !== actorId || next.turn.phase !== "awaiting-roll") throw new Error("You cannot roll now.");
  const player = activePlayer(next);
  if (player.effects.forcedOpponentMoves > 0) throw new Error("Move an opponent-controlled piece before rolling.");
  const [value, seed] = nextRandom(next.seed);
  next.seed = seed;
  const forcedTwo = player.effects.forcedTwoMoveTurns > 0;
  const rolled = forcedTwo ? 2 : Math.floor(value * 6) + 1;
  if (forcedTwo) player.effects.forcedTwoMoveTurns -= 1;
  next.turn.rolled = rolled;
  next.turn.harvestForbidden = forcedTwo;
  next.turn.movesRemaining = rolled;
  next.turn.phase = "moving";
  next.version += 1;
  next.log.push(`${player.name} rolled ${rolled}.`);
  return next;
}

export function drawHarvest(state: GameState, actorId: string): GameState {
  const next = structuredClone(state);
  const player = activePlayer(next);
  if (player.id !== actorId || next.turn.phase !== "moving" || next.turn.rolled !== 2 || next.turn.movesRemaining !== 2) throw new Error("A Harvest card can only replace an unused roll of two.");
  if (player.harvestCard) throw new Error("You may hold only one Harvest card.");
  if (next.turn.harvestForbidden) throw new Error("A forced two-move turn cannot be traded for Harvest.");
  if (next.harvestDeck.length === 0) next.harvestDeck = expandedHarvestDeck();
  player.harvestCard = next.harvestDeck.shift();
  player.harvestDrawnTurn = next.turn.number;
  next.turn.movesRemaining = 0;
  next.version += 1;
  next.log.push(`${player.name} drew a Harvest card.`);
  return endTurn(next, actorId);
}

export function move(state: GameState, actorId: string, requested: LegalMove): GameState {
  const next = structuredClone(state);
  if (next.turn.activePlayerId !== actorId) throw new Error("It is not your turn.");
  const candidate = legalMoves(next, actorId).find((legal) => legal.pieceId === requested.pieceId && legal.direction === requested.direction && same(legal.to, requested.to));
  if (!candidate) throw new Error("That move is not legal.");
  const preRoll = next.turn.phase === "awaiting-roll";
  applyMoveUnchecked(next, candidate);
  if (preRoll) activePlayer(next).effects.forcedOpponentMoves -= 1;
  else next.turn.movesRemaining -= 1;
  next.version += 1;
  next.log.push(`${candidate.pieceId} moved ${candidate.direction}.`);
  return next;
}

function returnHarvest(state: GameState, player: PlayerState): void {
  if (!player.harvestCard) return;
  state.harvestDeck.push(player.harvestCard);
  [state.harvestDeck, state.seed] = shuffle(state.harvestDeck, state.seed);
  delete player.harvestCard;
  delete player.harvestDrawnTurn;
}

export function playHarvest(state: GameState, actorId: string, play: HarvestPlay): GameState {
  const next = structuredClone(state);
  const player = activePlayer(next);
  if (player.id !== actorId || next.turn.phase !== "moving") throw new Error("Harvest cards are played during your turn.");
  if (player.harvestCard !== play.cardId) throw new Error("You do not hold that Harvest card.");
  if (player.harvestDrawnTurn === next.turn.number) throw new Error("A Harvest card cannot be used on the turn it was drawn.");
  if (play.cardId === "flyover") player.effects.flyoverCharges += 1;
  if (play.cardId === "avoid-or-two") {
    if (play.choice === "avoid") player.effects.avoidPoopCharges += 1;
    else next.turn.movesRemaining += 2;
  }
  if (play.cardId === "double-roll") {
    if (!next.turn.rolled) throw new Error("Roll before doubling it.");
    next.turn.movesRemaining += next.turn.rolled;
  }
  if (play.cardId === "steal-or-two") {
    if (play.choice === "two") next.turn.movesRemaining += 2;
    else {
      const target = next.players.find((candidate) => candidate.id === play.targetPlayerId && candidate.harvestCard);
      if (!target?.harvestCard) throw new Error("That opponent has no Harvest card.");
      const own = player.harvestCard;
      player.harvestCard = target.harvestCard;
      player.harvestDrawnTurn = target.harvestDrawnTurn;
      target.harvestCard = undefined;
      target.harvestDrawnTurn = undefined;
      if (own) next.harvestDeck.push(own);
    }
  }
  if (play.cardId === "move-opponent") {
    const piece = next.pieces.find((candidate) => candidate.id === play.move.pieceId);
    if (!piece || piece.ownerId === actorId || piece.kind === "cow") throw new Error("Choose an opponent's pig or hay bale.");
    const legal = legalMovesForPiece(next, piece.id).find((candidate) => candidate.direction === play.move.direction && same(candidate.to, play.move.to));
    if (!legal) throw new Error("That opponent move is not legal.");
    applyMoveUnchecked(next, legal);
  }
  if (play.cardId === "relocate-and-roll") {
    if (next.turn.movesRemaining !== 0) throw new Error("Finish the current roll first.");
    if (play.poopFrom && play.poopTo) {
      const index = next.poop.findIndex((poop) => same(poop, play.poopFrom!));
      if (index < 0 || !inside(play.poopTo) || occupied(next).has(key(play.poopTo)) || next.poop.some((poop) => same(poop, play.poopTo!))) throw new Error("Choose an existing poop and an open destination.");
      next.poop[index] = { ...play.poopTo };
    }
    const [value, seed] = nextRandom(next.seed);
    next.seed = seed;
    next.turn.rolled = Math.floor(value * 6) + 1;
    next.turn.movesRemaining = next.turn.rolled;
  }
  if (play.cardId !== "steal-or-two" || play.choice === "two") returnHarvest(next, player);
  next.version += 1;
  next.log.push(`${player.name} played a Harvest card.`);
  return next;
}

function resolvePoop(state: GameState, player: PlayerState): void {
  for (const card of state.turn.pendingPoop) {
    if (card === "skip-turn") player.effects.skipTurns += 1;
    if (card === "two-move-turn") player.effects.forcedTwoMoveTurns += 1;
    if (card === "opponent-moves") player.effects.forcedOpponentMoves += 1;
    if (card === "discard-harvest") returnHarvest(state, player);
    if (card === "return-pig") {
      const scored = state.pieces.find((piece) => piece.kind === "pig" && piece.ownerId === player.id && piece.scored);
      if (scored?.color) {
        const blocked = occupied(state);
        const start = STARTING_POSITIONS[scored.color].find((position) => !blocked.has(key(position)));
        if (start) {
          scored.scored = false;
          scored.position = { ...start };
          player.score = Math.max(0, player.score - 1);
        }
      }
    }
    state.poopDeck.push(card);
    [state.poopDeck, state.seed] = shuffle(state.poopDeck, state.seed);
  }
  state.turn.pendingPoop = [];
}

function nextTurn(state: GameState): void {
  let index = state.turnOrder.indexOf(state.turn.activePlayerId);
  do {
    index = (index + 1) % state.turnOrder.length;
    const player = state.players.find((candidate) => candidate.id === state.turnOrder[index])!;
    state.turn = { number: state.turn.number + 1, activePlayerId: player.id, phase: "awaiting-roll", movesRemaining: 0, pendingPoop: [] };
    if (player.effects.skipTurns > 0) {
      player.effects.skipTurns -= 1;
      if (player.effects.forcedTwoMoveTurns > 0) player.effects.forcedTwoMoveTurns -= 1;
      state.log.push(`${player.name} misses this turn.`);
      continue;
    }
    break;
  } while (true);
}

export function endTurn(state: GameState, actorId: string): GameState {
  const next = structuredClone(state);
  const player = activePlayer(next);
  if (player.id !== actorId) throw new Error("It is not your turn.");
  if (next.turn.movesRemaining > 0 && legalMoves(next, actorId).length > 0) throw new Error("Use every available move before ending the turn.");
  next.turn.phase = "resolving-poop";
  resolvePoop(next, player);
  if (player.score >= SCORE_TARGET[next.mode]) {
    next.status = "finished";
    next.winnerId = player.id;
    next.log.push(`${player.name} wins!`);
  } else nextTurn(next);
  next.version += 1;
  return next;
}

export function placeCowAndPoop(state: GameState, actorId: string, to: Position): GameState {
  const next = structuredClone(state);
  const player = activePlayer(next);
  if (player.id !== actorId || next.turn.phase !== "moving" || next.turn.rolled !== 1 || next.turn.movesRemaining !== 1) throw new Error("The cow can be relocated only as the unused action from a roll of one.");
  if (!inside(to) || occupied(next, "cow").has(key(to))) throw new Error("Choose an open square.");
  const cow = next.pieces.find((piece) => piece.kind === "cow")!;
  cow.position = { ...to };
  next.fenceActive = false;
  if (next.poopSupply > 0 && !next.poop.some((poop) => same(poop, to))) {
    next.poop.push({ ...to });
    next.poopSupply -= 1;
  }
  next.turn.movesRemaining = 0;
  next.version += 1;
  next.log.push(`${player.name} relocated the cow.`);
  return next;
}
