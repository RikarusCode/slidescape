import {
  ChevronDown,
  Copy,
  Dice1,
  Dice2,
  Dice3,
  Dice4,
  Dice5,
  Dice6,
  Fish,
  Hand,
  LogOut,
  Plus,
  Settings,
  ShieldCheck,
  Signal,
  Users,
  X
} from "lucide-react";
import {
  FISH_CARDS,
  legalMoves,
  legalMovesForPiece,
  PLAYER_COLOR_HEX,
  POOP_CARDS,
  type CardReveal,
  type ClientCommand,
  type GameState,
  type FishPlay,
  type LegalMove,
  type Position
} from "@slidescape/game";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board } from "./Board.js";
import { AudioControls } from "./AudioSettings.js";
import { GameResults } from "./GameResults.js";
import { RulesButton } from "./RulesDialog.js";
import { MODE_LABELS, SlidescapeMark } from "./Lobby.js";
import { PoopGlyph } from "./PieceGlyphs.js";
import { TurnTimer } from "./TurnTimer.js";
import { audio } from "../audio.js";

const commandId = () => crypto.randomUUID();
type CommandInput = ClientCommand extends infer Command
  ? Command extends ClientCommand
    ? Omit<Command, "commandId" | "expectedVersion">
    : never
  : never;
type SpecialMode = "elephant-seal-poop" | "elephant-seal-only" | "opponent" | "poop";
const DIE_ICONS = [Dice1, Dice2, Dice3, Dice4, Dice5, Dice6] as const;

export function GameView({
  state,
  playerId,
  roomCode,
  connected,
  message,
  send,
  onLeaveGame,
  onReturnHome
}: {
  state: GameState;
  playerId: string;
  roomCode?: string;
  connected: boolean;
  message?: string;
  send: (command: ClientCommand) => void;
  onLeaveGame: () => void;
  onReturnHome: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [specialMode, setSpecialMode] = useState<SpecialMode>();
  const [selectedPoop, setSelectedPoop] = useState<Position>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [dieFrame, setDieFrame] = useState(0);
  const [revealQueue, setRevealQueue] = useState<CardReveal[]>([]);
  const [returnPieceId, setReturnPieceId] = useState<string>();
  const [stealPickerOpen, setStealPickerOpen] = useState(false);
  const animatedRoll = useRef<string | undefined>(undefined);
  const knownReveals = useRef(new Set((state.cardReveals ?? []).map((reveal) => reveal.id)));
  const previousPieces = useRef(
    new Map(state.pieces.map((piece) => [piece.id, { ...piece.position, scored: piece.scored }]))
  );
  const previousPoop = useRef(
    state.poop
      .map((position) => `${position.x},${position.y}`)
      .sort()
      .join("|")
  );
  const previousScores = useRef(new Map(state.players.map((player) => [player.id, player.score])));
  const previousActivePlayer = useRef(state.turn.activePlayerId);
  const previousLogLength = useRef(state.log.length);
  const finishSoundPlayed = useRef(false);
  const locallySoundedPiece = useRef<{ id: string; expiresAt: number } | undefined>(undefined);
  const active = state.players.find((player) => player.id === state.turn.activePlayerId)!;
  const me = state.players.find((player) => player.id === playerId)!;
  const isMyTurn = state.turn.activePlayerId === playerId;
  const available = useMemo(
    () => (connected ? legalMoves(state, playerId) : []),
    [connected, state, playerId]
  );
  const card = FISH_CARDS.find((definition) => definition.id === me.fishCard);
  const heldFishReady =
    connected && isMyTurn && me.fishDrawnTurn !== state.turn.number && !state.turn.pendingFishChoice;
  const canUseRolledFish = heldFishReady && state.turn.phase === "moving";
  const canStealFish =
    heldFishReady && (state.turn.phase === "awaiting-roll" || state.turn.phase === "moving");
  const fishFeedback =
    message && /(fish|card|consequence|poop|another player)/i.test(message) ? message : undefined;
  const stealOpponents = useMemo(
    () => state.players.filter((player) => player.id !== playerId),
    [playerId, state.players]
  );
  const specialSelectableIds = useMemo(
    () =>
      connected && specialMode === "opponent"
        ? state.pieces
            .filter(
              (piece) =>
                !piece.scored &&
                piece.ownerId !== playerId &&
                piece.kind !== "elephant-seal" &&
                legalMovesForPiece(state, piece.id).length > 0
            )
            .map((piece) => piece.id)
        : undefined,
    [connected, playerId, specialMode, state]
  );
  const specialMoves = useMemo(
    () =>
      connected && specialMode === "opponent" && selectedId
        ? legalMovesForPiece(state, selectedId)
        : undefined,
    [connected, selectedId, specialMode, state]
  );
  const visibleReveal = revealQueue[0];
  const revealCard = visibleReveal
    ? POOP_CARDS.find((definition) => definition.id === visibleReveal.cardId)
    : undefined;
  const revealPlayer = visibleReveal
    ? state.players.find((player) => player.id === visibleReveal.playerId)
    : undefined;
  const canAvoidVisiblePoop =
    connected &&
    visibleReveal?.playerId === playerId &&
    state.turn.activePlayerId === playerId &&
    state.turn.phase === "moving" &&
    state.turn.pendingPoop[0] === visibleReveal.cardId &&
    me.fishCard === "avoid-or-two" &&
    me.fishDrawnTurn !== state.turn.number;
  const pendingChoice = state.turn.pendingChoice;
  const pendingFishChoice =
    state.turn.pendingFishChoice?.playerId === playerId ? state.turn.pendingFishChoice : undefined;
  const returnOption = pendingChoice?.options.find((option) => option.pieceId === returnPieceId);
  const effectNotes = state.players.flatMap((player) => [
    ...(player.effects.skipTurns > 0
      ? [
          `${player.name} will miss ${player.effects.skipTurns === 1 ? "their next turn" : `${player.effects.skipTurns} turns`}.`
        ]
      : []),
    ...(player.effects.forcedTwoMoveTurns > 0 ? [`${player.name}'s next turn is exactly two moves.`] : [])
  ]);
  const forcedOwner = state.turn.forcedPieceOwnerIds?.[0]
    ? state.players.find((player) => player.id === state.turn.forcedPieceOwnerIds?.[0])
    : undefined;
  const hasForcedMove = Boolean(forcedOwner && available.length > 0);
  if (hasForcedMove)
    effectNotes.push(`${active.name} must move one of ${forcedOwner!.name}'s pieces before rolling.`);
  const dispatch = useCallback(
    (command: CommandInput) => {
      if (!connected) return;
      send({
        ...command,
        commandId: commandId(),
        expectedVersion: state.version
      } as ClientCommand);
    },
    [connected, send, state.version]
  );
  const canEnd =
    connected &&
    isMyTurn &&
    state.turn.phase === "moving" &&
    !state.turn.pendingFishChoice &&
    (state.turn.movesRemaining === 0 || available.length === 0);
  const canRelocateElephantSeal =
    connected &&
    isMyTurn &&
    state.turn.phase === "moving" &&
    !state.turn.pendingFishChoice &&
    state.turn.movesRemaining > 0 &&
    (state.turn.elephantSealRelocationsRemaining ?? 0) > 0;

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  useEffect(() => {
    if (!rolling) return;
    const interval = window.setInterval(() => setDieFrame((frame) => (frame + 1) % DIE_ICONS.length), 85);
    const timeout = window.setTimeout(() => setRolling(false), 750);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [rolling]);

  useEffect(() => {
    if (!state.turn.rolled) return;
    const rollKey = `${state.turn.number}:${state.turn.activePlayerId}:${state.turn.rolled}`;
    if (animatedRoll.current === rollKey) return;
    animatedRoll.current = rollKey;
    audio.play("dice");
    setDieFrame(0);
    setRolling(true);
  }, [state.turn.activePlayerId, state.turn.number, state.turn.rolled]);

  useEffect(() => {
    const fresh = (state.cardReveals ?? []).filter((reveal) => !knownReveals.current.has(reveal.id));
    if (!fresh.length) return;
    for (const reveal of fresh) knownReveals.current.add(reveal.id);
    audio.play("poop");
    setRevealQueue((current) => [...current, ...fresh]);
  }, [state.cardReveals]);

  useEffect(() => {
    const prior = previousPieces.current;
    const moved = state.pieces.find((piece) => {
      const before = prior.get(piece.id);
      return (
        before &&
        (before.x !== piece.position.x || before.y !== piece.position.y || before.scored !== piece.scored)
      );
    });
    previousPieces.current = new Map(
      state.pieces.map((piece) => [piece.id, { ...piece.position, scored: piece.scored }])
    );
    if (moved) {
      const localSound = locallySoundedPiece.current;
      locallySoundedPiece.current = undefined;
      if (!localSound || localSound.id !== moved.id || localSound.expiresAt < performance.now()) {
        audio.play(moved.kind === "penguin" ? "slide" : moved.kind === "ice" ? "ice" : "elephant-seal");
      }
    }

    const poopKey = state.poop
      .map((position) => `${position.x},${position.y}`)
      .sort()
      .join("|");
    const priorPoopCount = previousPoop.current ? previousPoop.current.split("|").length : 0;
    if (poopKey !== previousPoop.current && state.poop.length >= priorPoopCount) audio.play("poop");
    previousPoop.current = poopKey;

    const scored = state.players.some(
      (player) => player.score > (previousScores.current.get(player.id) ?? player.score)
    );
    previousScores.current = new Map(state.players.map((player) => [player.id, player.score]));
    if (scored) audio.play("score");
  }, [state.version, state.pieces, state.players, state.poop]);

  useEffect(() => {
    if (previousActivePlayer.current !== state.turn.activePlayerId && state.turn.activePlayerId === playerId)
      audio.play("turn");
    previousActivePlayer.current = state.turn.activePlayerId;
  }, [playerId, state.turn.activePlayerId]);

  useEffect(() => {
    const freshLogs = state.log.slice(previousLogLength.current);
    previousLogLength.current = state.log.length;
    if (freshLogs.some((entry) => entry.includes("Fish card"))) audio.play("fish");
  }, [state.log]);

  useEffect(() => {
    if (state.status !== "finished" || finishSoundPlayed.current) return;
    finishSoundPlayed.current = true;
    audio.play(state.winnerId === playerId ? "win" : "lose");
  }, [playerId, state.status, state.winnerId]);

  useEffect(() => {
    if (isMyTurn && connected) return;
    setSelectedId(undefined);
    setSpecialMode(undefined);
    setSelectedPoop(undefined);
  }, [connected, isMyTurn]);

  useEffect(() => {
    setStealPickerOpen(false);
  }, [isMyTurn, me.fishCard, state.turn.number]);

  useEffect(() => {
    setReturnPieceId(pendingChoice?.options[0]?.pieceId);
  }, [pendingChoice?.playerId, pendingChoice?.cardId, pendingChoice?.options]);

  const clearSpecial = useCallback(() => {
    setSpecialMode(undefined);
    setSelectedPoop(undefined);
  }, []);
  const chooseElephantSealMode = (
    mode: Extract<SpecialMode, "elephant-seal-poop" | "elephant-seal-only">
  ) => {
    setSelectedId(undefined);
    setSelectedPoop(undefined);
    setSpecialMode(mode);
  };
  const selectBoardPiece = useCallback(
    (pieceId: string) => {
      if (!isMyTurn) return;
      if (specialMode === "opponent" && !specialSelectableIds?.includes(pieceId)) return;
      const piece = state.pieces.find((candidate) => candidate.id === pieceId);
      if (
        (specialMode === "elephant-seal-poop" || specialMode === "elephant-seal-only") &&
        piece?.kind === "penguin"
      )
        clearSpecial();
      setSelectedId(pieceId);
    },
    [clearSpecial, isMyTurn, specialMode, specialSelectableIds, state.pieces]
  );
  const playSimpleCard = () => {
    if (!me.fishCard) return;
    let play: FishPlay;
    if (me.fishCard === "avoid-or-two" || me.fishCard === "steal-or-two") return;
    if (me.fishCard === "relocate-and-roll") {
      if (state.poop.length === 0) play = { cardId: "relocate-and-roll" };
      else {
        setSpecialMode("poop");
        return;
      }
    } else if (me.fishCard === "move-opponent") {
      setSpecialMode("opponent");
      return;
    } else play = { cardId: me.fishCard } as FishPlay;
    dispatch({ type: "play-fish", play });
  };

  const playMoveSoundImmediately = useCallback(
    (move: LegalMove) => {
      const piece = state.pieces.find((candidate) => candidate.id === move.pieceId);
      if (!piece) return;
      locallySoundedPiece.current = {
        id: piece.id,
        expiresAt: performance.now() + 1_500
      };
      audio.play(piece.kind === "penguin" ? "slide" : piece.kind === "ice" ? "ice" : "elephant-seal");
    },
    [state.pieces]
  );

  const chooseEmptyCell = useCallback(
    (position: Position) => {
      if (specialMode === "elephant-seal-only")
        dispatch({ type: "place-elephant-seal", to: position, leavePoop: false });
      if (specialMode === "elephant-seal-poop") {
        dispatch({
          type: "place-elephant-seal",
          to: position,
          leavePoop: true
        });
      }
      if (specialMode === "poop" && selectedPoop)
        dispatch({
          type: "play-fish",
          play: {
            cardId: "relocate-and-roll",
            poopFrom: selectedPoop,
            poopTo: position
          }
        });
      clearSpecial();
    },
    [clearSpecial, dispatch, selectedPoop, specialMode]
  );

  const moveBoardPiece = useCallback(
    (move: LegalMove) => {
      playMoveSoundImmediately(move);
      if (specialMode === "opponent") {
        dispatch({
          type: "play-fish",
          play: { cardId: "move-opponent", move }
        });
        clearSpecial();
      } else {
        dispatch({ type: "move", move });
      }
      setSelectedId(undefined);
    },
    [clearSpecial, dispatch, playMoveSoundImmediately, specialMode]
  );

  const instruction =
    specialMode === "elephant-seal-poop"
      ? "Choose an open square for the elephant seal."
      : specialMode === "elephant-seal-only"
        ? "Choose an open square for the elephant seal."
        : specialMode === "poop"
          ? selectedPoop
            ? "Choose an open square for that poop."
            : "Choose a poop to relocate."
          : specialMode === "opponent"
            ? "Choose an opponent penguin or ice block."
            : undefined;

  const DieIcon = rolling
    ? DIE_ICONS[dieFrame]!
    : state.turn.rolled
      ? DIE_ICONS[state.turn.rolled - 1]!
      : Dice5;

  return (
    <div className="game-shell">
      <header className="game-header">
        <div className="wordmark">
          <SlidescapeMark className="game-logo-mark" />
          <span>Slidescape</span>
        </div>
        <div className="match-title">
          <strong>{MODE_LABELS[state.mode].title}</strong>
          <span>{MODE_LABELS[state.mode].detail}</span>
          {roomCode ? (
            <button onClick={() => navigator.clipboard.writeText(roomCode)}>
              Room {roomCode}
              <Copy size={14} />
            </button>
          ) : null}
        </div>
        <TurnTimer
          deadline={state.turn.timerDeadline}
          durationSeconds={state.turn.timerDurationSeconds}
          activePlayerName={active.name}
          activePlayerColor={active.themeColor}
          isMyTurn={isMyTurn}
        />
        <div className="connection">
          {!connected ? (
            <span className="reconnect-status" role="status" aria-label="Reconnecting" title="Reconnecting">
              <Signal size={21} />
            </span>
          ) : null}
          <RulesButton />
          <div className="game-settings-wrap">
            <button
              className="settings-toggle"
              aria-label="Game settings"
              aria-expanded={settingsOpen}
              onClick={() => {
                audio.play("ui");
                setSettingsOpen((open) => !open);
              }}
            >
              <Settings size={21} />
            </button>
            {settingsOpen ? (
              <section className="game-settings-menu" role="dialog" aria-label="Game settings menu">
                <header>
                  <strong>Game options</strong>
                  <button aria-label="Close game settings" onClick={() => setSettingsOpen(false)}>
                    <X size={18} />
                  </button>
                </header>
                <AudioControls />
                <p>Leave this match and return to the home screen.</p>
                <button className="leave-game-button" onClick={onLeaveGame}>
                  <LogOut size={18} /> Leave game
                </button>
              </section>
            ) : null}
          </div>
        </div>
      </header>
      {message ? (
        <div className="game-message" role="status">
          {message}
        </div>
      ) : null}
      <main className="game-layout">
        <Board
          state={state}
          playerId={playerId}
          selectedId={selectedId}
          availableMoves={available}
          onSelect={selectBoardPiece}
          specialMoves={specialMoves}
          specialSelectableIds={specialSelectableIds}
          onMove={moveBoardPiece}
          onPoopSelect={isMyTurn && specialMode === "poop" ? setSelectedPoop : undefined}
          selectedPoop={selectedPoop}
          interactionError={message}
          onEmptyCell={isMyTurn && specialMode && specialMode !== "opponent" ? chooseEmptyCell : undefined}
        />
        <aside className="game-sidebar">
          <section className="turn-panel">
            <div className="turn-title">
              <span className="player-token" style={{ background: PLAYER_COLOR_HEX[active.themeColor] }} />
              <h1>{isMyTurn ? "Your turn" : `${active.name}’s turn`}</h1>
            </div>
            <div className="roll-row">
              <div
                className={`die ${rolling ? "rolling" : ""}`}
                aria-label={
                  rolling ? "Rolling die" : state.turn.rolled ? `Die shows ${state.turn.rolled}` : "Die ready"
                }
              >
                <DieIcon />
              </div>
              <div>
                {rolling ? (
                  <>
                    <strong>Rolling…</strong>
                    <span>The die is tumbling</span>
                  </>
                ) : state.turn.rolled ? (
                  <>
                    <strong>Rolled {state.turn.rolled}</strong>
                    <span>
                      {state.turn.movesRemaining} {state.turn.movesRemaining === 1 ? "move" : "moves"} left
                    </span>
                  </>
                ) : (
                  <>
                    <strong>Ready to roll</strong>
                    <span>{isMyTurn ? "Your move" : "Waiting"}</span>
                  </>
                )}
              </div>
            </div>
            {instruction ? <p className="target-instruction">{instruction}</p> : null}
            {isMyTurn && state.turn.phase === "awaiting-roll" && !hasForcedMove ? (
              <button
                className="primary-action"
                disabled={!connected || rolling}
                onClick={() => {
                  setDieFrame(0);
                  setRolling(true);
                  dispatch({ type: "roll" });
                }}
              >
                {connected ? "Roll the die" : "Waiting for connection…"}
              </button>
            ) : null}
            {canRelocateElephantSeal ? (
              <div className="elephant-seal-actions">
                <button
                  className={`fish-action elephant-seal-choice ${specialMode === "elephant-seal-poop" ? "selected" : ""}`.trim()}
                  aria-pressed={specialMode === "elephant-seal-poop"}
                  onClick={() => chooseElephantSealMode("elephant-seal-poop")}
                >
                  Relocate elephant seal + poop
                </button>
                <button
                  className={`fish-action elephant-seal-choice ${specialMode === "elephant-seal-only" ? "selected" : ""}`.trim()}
                  aria-pressed={specialMode === "elephant-seal-only"}
                  onClick={() => chooseElephantSealMode("elephant-seal-only")}
                >
                  Relocate without poop
                </button>
              </div>
            ) : null}
            {isMyTurn && state.turn.fishDrawAvailable && !me.fishCard ? (
              <button
                className="fish-action"
                disabled={!connected}
                onClick={() => dispatch({ type: "draw-fish" })}
              >
                <Fish size={18} /> Trade the rolled 2 for a Fish card
              </button>
            ) : null}
            <button className="end-turn" disabled={!canEnd} onClick={() => dispatch({ type: "end-turn" })}>
              End turn
            </button>
          </section>
          <details className="side-panel players-panel" open>
            <summary>
              <span>
                <Users size={19} /> Players
              </span>
              <ChevronDown />
            </summary>
            <div>
              {state.players.map((player) => (
                <div className="score-row" key={player.id}>
                  <span
                    className="player-token"
                    style={{ background: PLAYER_COLOR_HEX[player.themeColor] }}
                  />
                  <span>
                    <strong>{player.name}</strong>
                    {player.id === playerId ? <small>You</small> : null}
                  </span>
                  <b>
                    {player.score} / {state.mode === "quick-2" ? 4 : state.mode === "strategic-2" ? 10 : 6}
                  </b>
                </div>
              ))}
            </div>
          </details>
          <details className="side-panel card-panel" open>
            <summary>
              <span>
                <Fish size={19} /> Your Fish card
              </span>
              <ChevronDown />
            </summary>
            {pendingFishChoice ? (
              <div className="fish-card fish-choice-card">
                <span className="card-leaf">
                  <Fish />
                </span>
                <strong>Choose the effect</strong>
                <p>
                  Two moves are ready. Choose the other effect instead to remove them before that effect
                  resolves.
                </p>
                <div className="card-actions">
                  <button
                    disabled={!connected}
                    onClick={() =>
                      dispatch({
                        type: "play-fish",
                        play: {
                          cardId: pendingFishChoice.cardId,
                          choice: "keep-two"
                        }
                      })
                    }
                  >
                    Keep 2 moves
                  </button>
                  {pendingFishChoice.cardId === "avoid-or-two" ? (
                    <button
                      disabled={!connected}
                      onClick={() =>
                        dispatch({
                          type: "play-fish",
                          play: { cardId: "avoid-or-two", choice: "avoid" }
                        })
                      }
                    >
                      <ShieldCheck size={16} /> Avoid Poop effect instead
                    </button>
                  ) : null}
                  {pendingFishChoice.cardId === "steal-or-two"
                    ? stealOpponents.map((target) => (
                        <button
                          key={target.id}
                          disabled={!connected}
                          onClick={() =>
                            dispatch({
                              type: "play-fish",
                              play: {
                                cardId: "steal-or-two",
                                choice: "steal",
                                targetPlayerId: target.id
                              }
                            })
                          }
                        >
                          <Hand size={16} /> Take {target.name}'s card instead
                        </button>
                      ))
                    : null}
                </div>
              </div>
            ) : card ? (
              <div className="fish-card">
                <span className="card-leaf">
                  <Fish />
                </span>
                <strong>
                  {card.id
                    .split("-")
                    .map((part) => part[0]?.toUpperCase() + part.slice(1))
                    .join(" ")}
                </strong>
                <p>{card.text}</p>
                {fishFeedback ? (
                  <div className="fish-card-feedback" role="status">
                    {fishFeedback}
                  </div>
                ) : null}
                <div
                  className={`card-actions ${card.id === "avoid-or-two" || card.id === "steal-or-two" ? "two-options" : ""}`.trim()}
                >
                  {card.id === "avoid-or-two" ? (
                    <>
                      <button
                        className="fish-choice-button"
                        disabled={!canUseRolledFish}
                        onClick={() =>
                          dispatch({
                            type: "play-fish",
                            play: { cardId: "avoid-or-two", choice: "two" }
                          })
                        }
                      >
                        <Plus size={17} /> Add 2 moves
                      </button>
                      <button
                        className="fish-choice-button"
                        disabled={!canUseRolledFish}
                        onClick={() =>
                          dispatch({
                            type: "play-fish",
                            play: { cardId: "avoid-or-two", choice: "avoid" }
                          })
                        }
                      >
                        <ShieldCheck size={17} /> Avoid Poop effect
                      </button>
                    </>
                  ) : card.id === "steal-or-two" ? (
                    <>
                      <button
                        className="fish-choice-button"
                        disabled={!canUseRolledFish}
                        onClick={() =>
                          dispatch({
                            type: "play-fish",
                            play: { cardId: "steal-or-two", choice: "two" }
                          })
                        }
                      >
                        <Plus size={17} /> Add 2 moves
                      </button>
                      <button
                        className="fish-choice-button"
                        aria-expanded={stealPickerOpen}
                        disabled={!canStealFish}
                        onClick={() => setStealPickerOpen((open) => !open)}
                      >
                        <Hand size={17} /> Steal Fish card
                      </button>
                    </>
                  ) : (
                    <button
                      className="fish-choice-button"
                      disabled={!canUseRolledFish}
                      onClick={playSimpleCard}
                    >
                      {card.id === "move-opponent"
                        ? "Choose rival piece"
                        : card.id === "relocate-and-roll" && state.poop.length > 0
                          ? "Choose poop"
                          : "Use card"}
                    </button>
                  )}
                </div>
                {card.id === "steal-or-two" && stealPickerOpen ? (
                  <div className="fish-target-picker" aria-label="Choose a player to steal from">
                    <span>Choose a player</span>
                    {stealOpponents.map((target) => (
                      <button
                        key={target.id}
                        disabled={!canStealFish}
                        onClick={() =>
                          dispatch({
                            type: "play-fish",
                            play: {
                              cardId: "steal-or-two",
                              choice: "steal",
                              targetPlayerId: target.id
                            }
                          })
                        }
                      >
                        <span
                          className="player-token"
                          style={{ background: PLAYER_COLOR_HEX[target.themeColor] }}
                        />
                        <span>
                          <strong>{target.name}</strong>
                          <small>{target.fishCard ? "Fish card held" : "No Fish card held"}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-card">
                <Fish />
                <p>Roll a two to draw a Fish card.</p>
              </div>
            )}
          </details>
        </aside>
      </main>
      {effectNotes.length ? (
        <aside className="effect-notes" aria-label="Upcoming card effects">
          {effectNotes.map((note, index) => (
            <div key={`${index}-${note}`}>
              <span>!</span>
              <p>{note}</p>
            </div>
          ))}
        </aside>
      ) : null}
      {visibleReveal && revealCard ? (
        <section className="card-reveal" role="dialog" aria-label="Poop card drawn">
          <button
            className="card-reveal-close"
            aria-label="Close Poop card"
            onClick={() => setRevealQueue((queue) => queue.slice(1))}
          >
            <X size={18} />
          </button>
          <div className="poop-card-icon">
            <svg viewBox="0 0 1 1">
              <PoopGlyph />
            </svg>
          </div>
          <span className="card-reveal-kicker">Poop card</span>
          <h2>
            {revealCard.id
              .split("-")
              .map((part) => part[0]?.toUpperCase() + part.slice(1))
              .join(" ")}
          </h2>
          <p>
            <strong>{revealPlayer?.name ?? "A player"}</strong> crossed poop. {revealCard.text}
          </p>
          {canAvoidVisiblePoop ? (
            <button
              className="card-reveal-action"
              onClick={() => {
                dispatch({
                  type: "play-fish",
                  play: { cardId: "avoid-or-two", choice: "avoid" }
                });
                setRevealQueue((queue) => queue.slice(1));
              }}
            >
              <Fish size={17} /> Use Fish card to avoid this
            </button>
          ) : null}
          <small>
            {revealCard.timing === "next turn" || revealCard.timing.includes("next player")
              ? "This stays noted until it takes effect."
              : "This resolves when the current turn ends."}
          </small>
        </section>
      ) : null}
      {pendingChoice ? (
        <div className="card-choice-backdrop">
          <section className="card-choice" role="dialog" aria-label="Resolve Poop card">
            <div className="poop-card-icon">
              <svg viewBox="0 0 1 1">
                <PoopGlyph />
              </svg>
            </div>
            <span className="card-reveal-kicker">Return an escaped penguin</span>
            {pendingChoice.playerId === playerId ? (
              <>
                <h2>Choose the penguin and starting space</h2>
                <p>This penguin returns to the board immediately. The game continues after you choose.</p>
                <div className="return-penguins">
                  {pendingChoice.options.map((option) => (
                    <button
                      className={option.pieceId === returnPieceId ? "selected" : ""}
                      key={option.pieceId}
                      disabled={!connected}
                      onClick={() => setReturnPieceId(option.pieceId)}
                    >
                      {option.color} penguin {option.pieceId.split("-").at(-1)}
                    </button>
                  ))}
                </div>
                <div className="return-spaces">
                  {returnOption?.positions.map((position) => (
                    <button
                      key={`${position.x},${position.y}`}
                      disabled={!connected}
                      onClick={() =>
                        dispatch({
                          type: "resolve-poop-choice",
                          pieceId: returnOption.pieceId,
                          to: position
                        })
                      }
                    >
                      Row {position.y + 1}, column {position.x + 1}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <h2>Card choice in progress</h2>
                <p>
                  {state.players.find((player) => player.id === pendingChoice.playerId)?.name} is choosing
                  which escaped penguin returns to the ice.
                </p>
              </>
            )}
          </section>
        </div>
      ) : null}
      <div className="sr-only" aria-live="polite">
        {state.log.at(-1)}
      </div>
      {state.status === "finished" ? (
        <GameResults state={state} playerId={playerId} onHome={onReturnHome} />
      ) : null}
    </div>
  );
}
