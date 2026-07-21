import {
  COLOR_ORDER,
  FENCE_POSITIONS,
  GOAL_GUARD_BOUNDARIES,
  GOAL_LANES,
  ICE_POSITIONS,
  PLAYER_COLOR_ORDER,
  SCORE_TARGET,
  STARTING_POSITIONS
} from "./config.js";
import { expandedFishDeck, expandedPoopDeck } from "./cards.js";
import { nextRandom, shuffle } from "./random.js";
import {
  BOARD_SIZE,
  type Color,
  type Direction,
  type GameMode,
  type GameGuest,
  type GameState,
  type FishPlay,
  type LegalMove,
  type Piece,
  type PlayerState,
  type Position
} from "./types.js";

const DELTA: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
};
const DIRECTIONS = Object.keys(DELTA) as Direction[];

const key = ({ x, y }: Position) => `${x},${y}`;
const same = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
const inside = ({ x, y }: Position) => x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
const step = (position: Position, direction: Direction): Position => ({
  x: position.x + DELTA[direction].x,
  y: position.y + DELTA[direction].y
});
const START_FACING: Record<Color, Direction> = {
  green: "down",
  yellow: "left",
  red: "up",
  blue: "right"
};

function facingToward(from: Position, to: Position, fallback: Direction = "down"): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  if (dy !== 0) return dy > 0 ? "down" : "up";
  return fallback;
}

function emptyEffects() {
  return {
    skipTurns: 0,
    forcedTwoMoveTurns: 0,
    forcedOpponentMoves: 0,
    flyoverCharges: 0,
    avoidPoopCharges: 0
  };
}

function recordScoreHistory(state: GameState): void {
  const snapshot = {
    moveNumber: state.moveNumber ?? 0,
    scores: Object.fromEntries(state.players.map((player) => [player.id, player.score]))
  };
  const history = state.scoreHistory ?? [];
  const prior = history.at(-1);
  state.scoreHistory =
    prior?.moveNumber === snapshot.moveNumber ? [...history.slice(0, -1), snapshot] : [...history, snapshot];
}

function playerColors(mode: GameMode): Color[][] {
  if (mode === "quick-2") return [["green"], ["red"]];
  if (mode === "strategic-2")
    return [
      ["green", "blue"],
      ["red", "yellow"]
    ];
  return COLOR_ORDER.map((color) => [color]);
}

function assignThemeColors(guests: GameGuest[], seed: number) {
  const claimed = new Set(guests.flatMap((guest) => (guest.colorChoice ? [guest.colorChoice] : [])));
  if (claimed.size !== guests.filter((guest) => guest.colorChoice).length)
    throw new Error("Each player must have a distinct color.");
  const available = PLAYER_COLOR_ORDER.filter((color) => !claimed.has(color));
  let nextSeed = seed;
  const colors = guests.map((guest) => {
    if (guest.colorChoice) return guest.colorChoice;
    const [value, advanced] = nextRandom(nextSeed);
    nextSeed = advanced;
    return available.splice(Math.floor(value * available.length), 1)[0]!;
  });
  return [colors, nextSeed] as const;
}

export function createGame(
  id: string,
  mode: GameMode,
  guests: GameGuest[],
  seed = Date.now() >>> 0
): GameState {
  const assignments = playerColors(mode);
  if (guests.length !== assignments.length)
    throw new Error(`${mode} requires ${assignments.length} players.`);
  const [themeColors, afterColors] = assignThemeColors(guests, seed);
  const players: PlayerState[] = guests.map((guest, index) => ({
    id: guest.id,
    name: guest.name,
    colors: assignments[index]!,
    themeColor: themeColors[index]!,
    score: 0,
    connected: true,
    effects: emptyEffects()
  }));
  const ownerByColor = new Map<Color, string>();
  for (const player of players) for (const color of player.colors) ownerByColor.set(color, player.id);

  const activeColors = assignments.flat();
  const pieces: Piece[] = [];
  for (const color of activeColors) {
    STARTING_POSITIONS[color].forEach((position, index) =>
      pieces.push({
        id: `${color}-penguin-${index + 1}`,
        kind: "penguin",
        color,
        ownerId: ownerByColor.get(color),
        position: { ...position },
        facing: START_FACING[color]
      })
    );
    ICE_POSITIONS[color].forEach((position, index) =>
      pieces.push({
        id: `${color}-ice-${index + 1}`,
        kind: "ice",
        color,
        ownerId: ownerByColor.get(color),
        position: { ...position }
      })
    );
  }
  pieces.push({
    id: "walrus",
    kind: "walrus",
    position: { x: 6, y: 6 },
    facing: "down"
  });
  const [firstValue, afterFirstPlayer] = nextRandom(afterColors);
  const firstPlayer = players[Math.floor(firstValue * players.length)]!;
  const [fishDeck, afterFish] = shuffle(expandedFishDeck(), afterFirstPlayer);
  const [poopDeck, afterPoop] = shuffle(expandedPoopDeck(), afterFish);
  const state: GameState = {
    schemaVersion: 4,
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
    fishDeck,
    poopDeck,
    turnOrder: players.map((player) => player.id),
    turn: {
      number: 1,
      activePlayerId: firstPlayer.id,
      phase: "awaiting-roll",
      movesRemaining: 0,
      pendingPoop: []
    },
    log: [`${firstPlayer.name} was randomly chosen to go first.`],
    moveNumber: 0
  };
  recordScoreHistory(state);
  return state;
}

export function activePlayer(state: GameState): PlayerState {
  const player = state.players.find((candidate) => candidate.id === state.turn.activePlayerId);
  if (!player) throw new Error("Active player is missing.");
  return player;
}

function occupied(state: GameState, except?: string): Map<string, Piece> {
  const result = new Map(
    state.pieces
      .filter((piece) => !piece.scored && piece.id !== except)
      .map((piece) => [key(piece.position), piece])
  );
  if (state.fenceActive) {
    const walrus = state.pieces.find((piece) => piece.kind === "walrus")!;
    for (const position of FENCE_POSITIONS) result.set(key(position), walrus);
  }
  return result;
}

function exitsThroughGoal(piece: Piece, position: Position, direction: Direction): boolean {
  if (piece.kind !== "penguin" || !piece.color) return false;
  const aligned = GOAL_LANES[piece.color].some((goal) =>
    piece.color === "green" || piece.color === "red" ? goal.x === position.x : goal.y === position.y
  );
  return (
    aligned &&
    ((piece.color === "green" && direction === "down" && position.y === BOARD_SIZE - 1) ||
      (piece.color === "yellow" && direction === "left" && position.x === 0) ||
      (piece.color === "red" && direction === "up" && position.y === 0) ||
      (piece.color === "blue" && direction === "right" && position.x === BOARD_SIZE - 1))
  );
}

function crossesGoalGuard(from: Position, to: Position): boolean {
  if (from.y === to.y && (from.y === 0 || from.y === BOARD_SIZE - 1)) {
    return GOAL_GUARD_BOUNDARIES.some((boundary) => boundary === Math.max(from.x, to.x));
  }
  if (from.x === to.x && (from.x === 0 || from.x === BOARD_SIZE - 1)) {
    return GOAL_GUARD_BOUNDARIES.some((boundary) => boundary === Math.max(from.y, to.y));
  }
  return false;
}

function penguinMove(
  state: GameState,
  piece: Piece,
  direction: Direction,
  flyover = false,
  blockers = occupied(state),
  poopCells = new Set(state.poop.map(key))
): LegalMove | undefined {
  let cursor = piece.position;
  const crossedPoop: Position[] = [];
  let ignored = false;
  let moved = false;
  while (true) {
    if (exitsThroughGoal(piece, cursor, direction)) {
      return {
        pieceId: piece.id,
        direction,
        to: cursor,
        scores: true,
        crossesPoop: crossedPoop,
        usesFlyover: ignored
      };
    }
    const next = step(cursor, direction);
    if (!inside(next) || crossesGoalGuard(cursor, next)) break;
    const blocker = blockers.get(key(next));
    if (blocker && blocker.id !== piece.id) {
      if (
        flyover &&
        !ignored &&
        ["penguin", "ice", "walrus"].includes(blocker.kind) &&
        !(blocker.kind === "walrus" && state.fenceActive)
      ) {
        ignored = true;
        cursor = next;
        continue;
      }
      break;
    }
    cursor = next;
    moved = true;
    if (poopCells.has(key(cursor))) crossedPoop.push({ ...cursor });
  }
  if (!moved || same(cursor, piece.position)) return undefined;
  return {
    pieceId: piece.id,
    direction,
    to: { ...cursor },
    crossesPoop: crossedPoop,
    usesFlyover: ignored
  };
}

function stepMove(
  state: GameState,
  piece: Piece,
  direction: Direction,
  blockers = occupied(state),
  poopCells = new Set(state.poop.map(key))
): LegalMove | undefined {
  const to = step(piece.position, direction);
  const blocker = blockers.get(key(to));
  if (!inside(to) || crossesGoalGuard(piece.position, to) || (blocker && blocker.id !== piece.id))
    return undefined;
  return {
    pieceId: piece.id,
    direction,
    to,
    crossesPoop: piece.kind === "ice" && poopCells.has(key(to)) ? [{ ...to }] : []
  };
}

const cellIndex = ({ x, y }: Position) => y * BOARD_SIZE + x;

function reachableGoalCells(color: Color, blockers: Set<number>): Uint8Array {
  const seen = new Uint8Array(BOARD_SIZE * BOARD_SIZE);
  const queue: Position[] = [];
  for (const goal of GOAL_LANES[color]) {
    const index = cellIndex(goal);
    if (!blockers.has(index) && !seen[index]) {
      seen[index] = 1;
      queue.push(goal);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]!;
    for (const direction of DIRECTIONS) {
      const next = step(current, direction);
      if (!inside(next) || crossesGoalGuard(current, next)) continue;
      const index = cellIndex(next);
      if (blockers.has(index) || seen[index]) continue;
      seen[index] = 1;
      queue.push(next);
    }
  }
  return seen;
}

function allPlayersRetainGoalAccess(state: GameState, move: LegalMove): boolean {
  for (const player of state.players) {
    const hardBlockers = new Set<number>();
    const penguins: Array<{ color: Color; position: Position }> = [];
    for (const piece of state.pieces) {
      const isMovingPiece = piece.id === move.pieceId;
      if (piece.scored || (isMovingPiece && move.scores)) continue;
      const position = isMovingPiece ? move.to : piece.position;
      if (piece.kind !== "walrus" && piece.ownerId !== player.id) hardBlockers.add(cellIndex(position));
      if (piece.kind === "penguin" && piece.ownerId === player.id && piece.color)
        penguins.push({ color: piece.color, position });
    }
    const reachableByColor = new Map<Color, Uint8Array>();
    for (const penguin of penguins) {
      let reachable = reachableByColor.get(penguin.color);
      if (!reachable) {
        reachable = reachableGoalCells(penguin.color, hardBlockers);
        reachableByColor.set(penguin.color, reachable);
      }
      if (!reachable[cellIndex(penguin.position)]) return false;
    }
  }
  return true;
}

function moveActorAllowed(state: GameState, piece: Piece, actorId: string): boolean {
  if (piece.kind === "walrus") return !state.fenceActive && state.turn.rolled !== 1;
  if (piece.ownerId === actorId) return true;
  return state.turn.forcedPieceOwnerIds?.[0] === piece.ownerId;
}

export function legalMoves(state: GameState, actorId = state.turn.activePlayerId): LegalMove[] {
  if (state.status !== "playing") return [];
  const active = activePlayer(state);
  if (active.id !== actorId) return [];
  const forcedPieceOwnerId = state.turn.forcedPieceOwnerIds?.[0];
  const preRollOpponentMove = state.turn.phase === "awaiting-roll" && Boolean(forcedPieceOwnerId);
  if (state.turn.phase !== "moving" && !preRollOpponentMove) return [];
  if (state.turn.pendingFishChoice) return [];
  if (!preRollOpponentMove && state.turn.movesRemaining <= 0) return [];
  const blockers = occupied(state);
  const poopCells = new Set(state.poop.map(key));
  const moves: LegalMove[] = [];
  for (const piece of state.pieces) {
    if (piece.scored || !moveActorAllowed(state, piece, actorId)) continue;
    if (preRollOpponentMove && (piece.ownerId !== forcedPieceOwnerId || piece.kind === "walrus")) continue;
    for (const direction of DIRECTIONS) {
      const canFlyover =
        piece.kind === "penguin" && piece.ownerId === active.id && active.effects.flyoverCharges > 0;
      const move =
        piece.kind === "penguin"
          ? penguinMove(state, piece, direction, canFlyover, blockers, poopCells)
          : stepMove(state, piece, direction, blockers, poopCells);
      if (!move) continue;
      if (allPlayersRetainGoalAccess(state, move)) moves.push(move);
    }
  }
  return moves;
}

export function legalMovesForPiece(state: GameState, pieceId: string): LegalMove[] {
  const piece = state.pieces.find((candidate) => candidate.id === pieceId && !candidate.scored);
  if (!piece) return [];
  if (piece.kind === "walrus" && (state.fenceActive || state.turn.rolled === 1)) return [];
  const blockers = occupied(state);
  const poopCells = new Set(state.poop.map(key));
  return DIRECTIONS.flatMap((direction) => {
    const canFlyover =
      piece.kind === "penguin" &&
      piece.ownerId === state.turn.activePlayerId &&
      activePlayer(state).effects.flyoverCharges > 0;
    const candidate =
      piece.kind === "penguin"
        ? penguinMove(state, piece, direction, canFlyover, blockers, poopCells)
        : stepMove(state, piece, direction, blockers, poopCells);
    if (!candidate) return [];
    return allPlayersRetainGoalAccess(state, candidate) ? [candidate] : [];
  });
}

function drawPoop(state: GameState): void {
  if (state.poopDeck.length === 0) state.poopDeck = expandedPoopDeck();
  const card = state.poopDeck.shift();
  if (card) {
    state.turn.pendingPoop.push(card);
    state.cardRevealSequence = (state.cardRevealSequence ?? 0) + 1;
    state.cardReveals = [
      ...(state.cardReveals ?? []),
      {
        id: state.cardRevealSequence,
        deck: "poop" as const,
        cardId: card,
        playerId: state.turn.activePlayerId,
        turnNumber: state.turn.number
      }
    ].slice(-24);
  }
}

function applyMoveUnchecked(state: GameState, move: LegalMove, triggerPoop = true): void {
  const piece = state.pieces.find((candidate) => candidate.id === move.pieceId);
  if (!piece) throw new Error("Piece not found.");
  state.moveNumber = (state.moveNumber ?? 0) + 1;
  piece.facing = move.direction;
  if (move.scores) {
    piece.scored = true;
    piece.position = { x: -1, y: -1 };
    const owner = state.players.find((player) => player.id === piece.ownerId);
    if (owner) {
      owner.score += 1;
      recordScoreHistory(state);
    }
  } else piece.position = { ...move.to };
  if (move.usesFlyover)
    activePlayer(state).effects.flyoverCharges = Math.max(0, activePlayer(state).effects.flyoverCharges - 1);
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
  if (
    next.status !== "playing" ||
    next.turn.activePlayerId !== actorId ||
    next.turn.phase !== "awaiting-roll"
  )
    throw new Error("You cannot roll now.");
  const player = activePlayer(next);
  if (next.turn.forcedPieceOwnerIds?.length) {
    if (legalMoves(next, actorId).length > 0)
      throw new Error("Move the affected player's piece before rolling.");
    delete next.turn.forcedPieceOwnerIds;
  }
  const [value, seed] = nextRandom(next.seed);
  next.seed = seed;
  const forcedTwo = player.effects.forcedTwoMoveTurns > 0;
  const rolled = forcedTwo ? 2 : Math.floor(value * 6) + 1;
  if (forcedTwo) player.effects.forcedTwoMoveTurns -= 1;
  next.turn.rolled = rolled;
  next.turn.fishForbidden = forcedTwo;
  next.turn.movesRemaining = rolled;
  next.turn.fishDrawAvailable = rolled === 2 && !forcedTwo;
  next.turn.walrusRelocationsRemaining = rolled === 1 ? 1 : 0;
  next.turn.phase = "moving";
  next.version += 1;
  next.log.push(`${player.name} rolled ${rolled}.`);
  return next;
}

export function drawFish(state: GameState, actorId: string): GameState {
  const next = structuredClone(state);
  const player = activePlayer(next);
  if (player.id !== actorId || next.turn.phase !== "moving" || !next.turn.fishDrawAvailable)
    throw new Error("A Fish card can only replace an unused natural roll of two.");
  if (next.turn.pendingFishChoice) throw new Error("Choose the Fish card effect first.");
  if (player.fishCard) throw new Error("You may hold only one Fish card.");
  if (next.turn.fishForbidden) throw new Error("A forced two-move turn cannot be traded for Fish.");
  if (next.fishDeck.length === 0) next.fishDeck = expandedFishDeck();
  player.fishCard = next.fishDeck.shift();
  player.fishDrawnTurn = next.turn.number;
  next.turn.movesRemaining = 0;
  next.turn.fishDrawAvailable = false;
  next.version += 1;
  next.log.push(`${player.name} drew a Fish card.`);
  return endTurn(next, actorId);
}

export function move(state: GameState, actorId: string, requested: LegalMove): GameState {
  const next = structuredClone(state);
  if (next.turn.activePlayerId !== actorId) throw new Error("It is not your turn.");
  if (next.turn.phase === "moving" && next.turn.movesRemaining <= 0)
    throw new Error("No moves remain this turn.");
  const candidate = legalMoves(next, actorId).find(
    (legal) =>
      legal.pieceId === requested.pieceId &&
      legal.direction === requested.direction &&
      same(legal.to, requested.to)
  );
  if (!candidate) throw new Error("That move is not legal.");
  const preRoll = next.turn.phase === "awaiting-roll";
  applyMoveUnchecked(next, candidate);
  if (preRoll) next.turn.forcedPieceOwnerIds = next.turn.forcedPieceOwnerIds?.slice(1);
  else {
    next.turn.movesRemaining = Math.max(0, next.turn.movesRemaining - 1);
    next.turn.fishDrawAvailable = false;
  }
  if (candidate.scores) {
    const scorer = next.players.find(
      (player) => next.pieces.find((piece) => piece.id === candidate.pieceId)?.ownerId === player.id
    );
    if (scorer?.score === SCORE_TARGET[next.mode]) {
      next.turn.movesRemaining = 0;
      next.turn.fishDrawAvailable = false;
      if (next.turn.pendingPoop.length === 0) declareWinner(next, scorer);
    }
  }
  next.version += 1;
  next.log.push(`${candidate.pieceId} moved ${candidate.direction}.`);
  return next;
}

function returnFish(state: GameState, player: PlayerState): void {
  if (!player.fishCard) return;
  state.fishDeck.push(player.fishCard);
  [state.fishDeck, state.seed] = shuffle(state.fishDeck, state.seed);
  delete player.fishCard;
  delete player.fishDrawnTurn;
}

function declareWinner(state: GameState, player: PlayerState): void {
  if (state.status === "finished") return;
  state.status = "finished";
  state.winnerId = player.id;
  state.turn.movesRemaining = 0;
  state.turn.fishDrawAvailable = false;
  state.log.push(`${player.name} wins!`);
}

function declareWinnerWhenPoopIsClear(state: GameState): void {
  if (state.turn.pendingPoop.length > 0 || state.turn.pendingChoice) return;
  const winner = state.players.find((candidate) => candidate.score >= SCORE_TARGET[state.mode]);
  if (winner) declareWinner(state, winner);
}

export function playFish(state: GameState, actorId: string, play: FishPlay): GameState {
  const next = structuredClone(state);
  const player = activePlayer(next);
  if (player.id !== actorId || next.turn.phase !== "moving")
    throw new Error("Fish cards are played during your turn.");

  const pending = next.turn.pendingFishChoice;
  if (pending) {
    if (pending.playerId !== actorId || pending.cardId !== play.cardId)
      throw new Error("Choose the pending Fish card effect first.");
    if (play.choice !== "keep-two" && play.choice !== "avoid" && play.choice !== "steal")
      throw new Error("Choose one of the available Fish card effects.");
    if (play.choice === "avoid") {
      if (pending.cardId !== "avoid-or-two" || next.turn.pendingPoop.length === 0)
        throw new Error("There is no Poop consequence to block.");
      next.turn.movesRemaining = Math.max(0, next.turn.movesRemaining - 2);
      returnPoopCard(next, next.turn.pendingPoop.shift()!);
    }
    if (play.choice === "steal") {
      if (pending.cardId !== "steal-or-two") throw new Error("That effect is not available.");
      const target = next.players.find(
        (candidate) => candidate.id === play.targetPlayerId && candidate.fishCard
      );
      if (!target?.fishCard) throw new Error("That opponent has no Fish card.");
      next.turn.movesRemaining = Math.max(0, next.turn.movesRemaining - 2);
      player.fishCard = target.fishCard;
      player.fishDrawnTurn = target.fishDrawnTurn;
      delete target.fishCard;
      delete target.fishDrawnTurn;
    }
    delete next.turn.pendingFishChoice;
    if (
      play.choice === "keep-two" &&
      player.score >= SCORE_TARGET[next.mode] &&
      next.turn.pendingPoop.length > 0
    )
      next.turn.movesRemaining = 0;
    declareWinnerWhenPoopIsClear(next);
    next.version += 1;
    next.log.push(`${player.name} chose a Fish card effect.`);
    return next;
  }

  if (player.fishCard !== play.cardId) throw new Error("You do not hold that Fish card.");
  if (player.fishDrawnTurn === next.turn.number)
    throw new Error("A Fish card cannot be used on the turn it was drawn.");
  if ((play.cardId === "avoid-or-two" || play.cardId === "steal-or-two") && play.choice === "start") {
    const hasAlternative =
      play.cardId === "avoid-or-two"
        ? next.turn.pendingPoop.length > 0
        : next.players.some((candidate) => candidate.id !== actorId && candidate.fishCard);
    returnFish(next, player);
    next.turn.movesRemaining += 2;
    if (hasAlternative) next.turn.pendingFishChoice = { playerId: actorId, cardId: play.cardId };
    next.version += 1;
    next.log.push(`${player.name} played a Fish card.`);
    return next;
  }
  if (play.cardId === "flyover") player.effects.flyoverCharges += 1;
  if (play.cardId === "avoid-or-two") {
    if (play.choice === "avoid") {
      const avoided = next.turn.pendingPoop.shift();
      if (avoided) returnPoopCard(next, avoided);
      else player.effects.avoidPoopCharges += 1;
    } else if (play.choice === "two") next.turn.movesRemaining += 2;
  }
  if (play.cardId === "double-roll") {
    if (!next.turn.rolled) throw new Error("Roll before doubling it.");
    next.turn.movesRemaining += next.turn.rolled;
    if (next.turn.rolled === 1)
      next.turn.walrusRelocationsRemaining = (next.turn.walrusRelocationsRemaining ?? 0) + 1;
  }
  if (play.cardId === "steal-or-two") {
    if (play.choice === "two") next.turn.movesRemaining += 2;
    else {
      const target = next.players.find(
        (candidate) => candidate.id === play.targetPlayerId && candidate.fishCard
      );
      if (!target?.fishCard) throw new Error("That opponent has no Fish card.");
      const own = player.fishCard;
      player.fishCard = target.fishCard;
      player.fishDrawnTurn = target.fishDrawnTurn;
      target.fishCard = undefined;
      target.fishDrawnTurn = undefined;
      if (own) {
        next.fishDeck.push(own);
        [next.fishDeck, next.seed] = shuffle(next.fishDeck, next.seed);
      }
    }
  }
  if (play.cardId === "move-opponent") {
    const piece = next.pieces.find((candidate) => candidate.id === play.move.pieceId);
    if (!piece || piece.ownerId === actorId || piece.kind === "walrus")
      throw new Error("Choose an opponent's penguin or ice block.");
    const legal = legalMovesForPiece(next, piece.id).find(
      (candidate) => candidate.direction === play.move.direction && same(candidate.to, play.move.to)
    );
    if (!legal) throw new Error("That opponent move is not legal.");
    applyMoveUnchecked(next, legal);
    if (legal.scores) {
      const scorer = next.players.find((candidate) => candidate.id === piece.ownerId);
      if (scorer?.score === SCORE_TARGET[next.mode]) {
        next.turn.movesRemaining = 0;
        if (next.turn.pendingPoop.length === 0) declareWinner(next, scorer);
      }
    }
  }
  if (play.cardId === "relocate-and-roll") {
    if (next.turn.movesRemaining !== 0) throw new Error("Finish the current roll first.");
    if (play.poopFrom && play.poopTo) {
      const index = next.poop.findIndex((poop) => same(poop, play.poopFrom!));
      if (
        index < 0 ||
        !inside(play.poopTo) ||
        occupied(next).has(key(play.poopTo)) ||
        next.poop.some((poop) => same(poop, play.poopTo!))
      )
        throw new Error("Choose an existing poop and an open destination.");
      next.poop[index] = { ...play.poopTo };
    }
    const [value, seed] = nextRandom(next.seed);
    next.seed = seed;
    next.turn.rolled = Math.floor(value * 6) + 1;
    next.turn.movesRemaining = next.turn.rolled;
    next.turn.fishDrawAvailable = next.turn.rolled === 2;
    next.turn.walrusRelocationsRemaining = next.turn.rolled === 1 ? 1 : 0;
  }
  if (play.cardId !== "steal-or-two" || play.choice === "two") returnFish(next, player);
  declareWinnerWhenPoopIsClear(next);
  next.version += 1;
  next.log.push(`${player.name} played a Fish card.`);
  return next;
}

function returnPoopCard(state: GameState, card: GameState["turn"]["pendingPoop"][number]): void {
  state.poopDeck.push(card);
  [state.poopDeck, state.seed] = shuffle(state.poopDeck, state.seed);
}

function returnPenguinOptions(state: GameState, player: PlayerState) {
  const blocked = occupied(state);
  return state.pieces.flatMap((piece) => {
    if (piece.kind !== "penguin" || piece.ownerId !== player.id || !piece.scored || !piece.color) return [];
    const positions = STARTING_POSITIONS[piece.color]
      .filter((position) => !blocked.has(key(position)))
      .map((position) => ({ ...position }));
    return positions.length ? [{ pieceId: piece.id, color: piece.color, positions }] : [];
  });
}

function resolvePoopUntilChoice(state: GameState, player: PlayerState): boolean {
  while (state.turn.pendingPoop.length > 0) {
    const card = state.turn.pendingPoop.shift()!;
    if (card === "skip-turn") player.effects.skipTurns += 1;
    if (card === "two-move-turn") player.effects.forcedTwoMoveTurns += 1;
    if (card === "opponent-moves")
      state.turn.forcedPieceOwnerIds = [...(state.turn.forcedPieceOwnerIds ?? []), player.id];
    if (card === "discard-fish") returnFish(state, player);
    if (card === "return-penguin") {
      const options = returnPenguinOptions(state, player);
      if (options.length > 0) {
        state.turn.pendingChoice = {
          type: "return-penguin",
          playerId: player.id,
          cardId: card,
          options
        };
        return false;
      }
    }
    returnPoopCard(state, card);
  }
  return true;
}

function nextTurn(state: GameState): void {
  let forcedPieceOwnerIds = state.turn.forcedPieceOwnerIds;
  let index = state.turnOrder.indexOf(state.turn.activePlayerId);
  do {
    index = (index + 1) % state.turnOrder.length;
    const player = state.players.find((candidate) => candidate.id === state.turnOrder[index])!;
    state.turn = {
      number: state.turn.number + 1,
      activePlayerId: player.id,
      phase: "awaiting-roll",
      movesRemaining: 0,
      pendingPoop: [],
      forcedPieceOwnerIds
    };
    if (player.effects.skipTurns > 0) {
      player.effects.skipTurns -= 1;
      if (player.effects.forcedTwoMoveTurns > 0) player.effects.forcedTwoMoveTurns -= 1;
      state.log.push(`${player.name} misses this turn.`);
      delete state.turn.forcedPieceOwnerIds;
      forcedPieceOwnerIds = undefined;
      continue;
    }
    break;
  } while (true);
}

function finishTurnAfterPoop(state: GameState, player: PlayerState): void {
  if (player.score >= SCORE_TARGET[state.mode]) {
    declareWinner(state, player);
  } else nextTurn(state);
}

export function endTurn(state: GameState, actorId: string): GameState {
  const next = structuredClone(state);
  const player = activePlayer(next);
  if (player.id !== actorId) throw new Error("It is not your turn.");
  if (next.turn.phase === "resolving-poop" || next.turn.pendingChoice)
    throw new Error("Resolve the pending Poop card first.");
  if (next.turn.pendingFishChoice) throw new Error("Choose the Fish card effect first.");
  if (next.turn.movesRemaining > 0 && legalMoves(next, actorId).length > 0)
    throw new Error("Use every available move before ending the turn.");
  next.turn.phase = "resolving-poop";
  if (resolvePoopUntilChoice(next, player)) finishTurnAfterPoop(next, player);
  next.version += 1;
  return next;
}

export function resolvePoopChoice(
  state: GameState,
  actorId: string,
  pieceId: string,
  to: Position
): GameState {
  const next = structuredClone(state);
  const choice = next.turn.pendingChoice;
  if (next.status !== "playing" || next.turn.phase !== "resolving-poop" || !choice)
    throw new Error("There is no Poop card choice to resolve.");
  if (choice.playerId !== actorId) throw new Error("Only the affected player can resolve this Poop card.");
  const option = choice.options.find(
    (candidate) => candidate.pieceId === pieceId && candidate.positions.some((position) => same(position, to))
  );
  const piece = next.pieces.find(
    (candidate) => candidate.id === pieceId && candidate.scored && candidate.ownerId === actorId
  );
  if (!option || !piece || occupied(next).has(key(to)))
    throw new Error("Choose an escaped penguin and an open original starting space.");
  piece.scored = false;
  piece.position = { ...to };
  piece.facing = START_FACING[option.color];
  const player = next.players.find((candidate) => candidate.id === actorId)!;
  player.score = Math.max(0, player.score - 1);
  recordScoreHistory(next);
  delete next.turn.pendingChoice;
  returnPoopCard(next, choice.cardId);
  if (resolvePoopUntilChoice(next, player)) finishTurnAfterPoop(next, player);
  next.version += 1;
  next.log.push(`${player.name} returned an escaped penguin to its starting line.`);
  return next;
}

export function placeWalrusAndPoop(
  state: GameState,
  actorId: string,
  to: Position,
  options: { leavePoop?: boolean; poopFrom?: Position } = { leavePoop: true }
): GameState {
  const next = structuredClone(state);
  const player = activePlayer(next);
  if (
    player.id !== actorId ||
    next.turn.phase !== "moving" ||
    next.turn.movesRemaining < 1 ||
    (next.turn.walrusRelocationsRemaining ?? 0) < 1
  )
    throw new Error("The walrus can be relocated only with an unused walrus action from a roll of one.");
  if (next.turn.pendingFishChoice) throw new Error("Choose the Fish card effect first.");
  if (!inside(to) || occupied(next, "walrus").has(key(to))) throw new Error("Choose an open square.");
  const walrus = next.pieces.find((piece) => piece.kind === "walrus")!;
  walrus.facing = facingToward(walrus.position, to, walrus.facing);
  walrus.position = { ...to };
  next.moveNumber = (next.moveNumber ?? 0) + 1;
  next.fenceActive = false;
  if (options.leavePoop !== false && !next.poop.some((poop) => same(poop, to))) {
    if (next.poopSupply > 0) {
      next.poop.push({ ...to });
      next.poopSupply -= 1;
    } else {
      const index = options.poopFrom ? next.poop.findIndex((poop) => same(poop, options.poopFrom!)) : -1;
      if (index < 0) throw new Error("Choose a poop token to recycle under the walrus.");
      next.poop[index] = { ...to };
    }
  }
  next.turn.movesRemaining = Math.max(0, next.turn.movesRemaining - 1);
  next.turn.walrusRelocationsRemaining = Math.max(0, (next.turn.walrusRelocationsRemaining ?? 0) - 1);
  next.turn.fishDrawAvailable = false;
  next.version += 1;
  next.log.push(`${player.name} relocated the walrus${options.leavePoop === false ? "" : " and left poop"}.`);
  return next;
}
