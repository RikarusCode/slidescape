import { endTurn, legalMoves, move, roll } from "./engine.js";
import type { GameState } from "./types.js";

export type BotActionKind = "roll" | "move" | "end-turn";

export interface BotActionResult {
  state: GameState;
  kind: BotActionKind;
}

export function advanceBotAction(state: GameState, actorId: string): BotActionResult {
  const active = state.players.find((player) => player.id === actorId);
  if (!active || state.status !== "playing" || state.turn.activePlayerId !== actorId) {
    throw new Error("The bot is not the active player.");
  }

  if (state.turn.phase === "awaiting-roll" && active.effects.forcedOpponentMoves > 0) {
    const moves = legalMoves(state, actorId);
    if (moves.length > 0) {
      return { state: move(state, actorId, moves[state.seed % moves.length]!), kind: "move" };
    }
    return { state: endTurn(state, actorId), kind: "end-turn" };
  }

  if (state.turn.phase === "awaiting-roll") {
    return { state: roll(state, actorId), kind: "roll" };
  }

  if (state.turn.phase === "moving" && state.turn.movesRemaining > 0) {
    const moves = legalMoves(state, actorId);
    if (moves.length > 0) {
      return { state: move(state, actorId, moves[state.seed % moves.length]!), kind: "move" };
    }
  }

  return { state: endTurn(state, actorId), kind: "end-turn" };
}
