import { ChevronDown, Copy, Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, Fish, LogOut, Settings, Users, X } from "lucide-react";
import { HARVEST_CARDS, legalMoves, legalMovesForPiece, PLAYER_COLOR_HEX, type ClientCommand, type GameState, type HarvestPlay, type LegalMove, type Position } from "@slidescape/game";
import { useEffect, useMemo, useState } from "react";
import { Board } from "./Board.js";
import { RulesButton } from "./RulesDialog.js";
import { MODE_LABELS, SlidescapeMark } from "./Lobby.js";

const commandId = () => crypto.randomUUID();
type CommandInput = ClientCommand extends infer Command
  ? Command extends ClientCommand ? Omit<Command, "commandId" | "expectedVersion"> : never
  : never;
type SpecialMode = "walrus-poop" | "walrus-only" | "opponent" | "poop";
const DIE_ICONS = [Dice1, Dice2, Dice3, Dice4, Dice5, Dice6] as const;

export function GameView({ state, playerId, roomCode, connected, message, send, onLeaveGame }: { state: GameState; playerId: string; roomCode?: string; connected: boolean; message?: string; send: (command: ClientCommand) => void; onLeaveGame: () => void }) {
  const [selectedId, setSelectedId] = useState<string>();
  const [specialMode, setSpecialMode] = useState<SpecialMode>();
  const [selectedPoop, setSelectedPoop] = useState<Position>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [dieFrame, setDieFrame] = useState(0);
  const active = state.players.find((player) => player.id === state.turn.activePlayerId)!;
  const me = state.players.find((player) => player.id === playerId)!;
  const isMyTurn = state.turn.activePlayerId === playerId;
  const available = useMemo(() => legalMoves(state, playerId), [state, playerId]);
  const card = HARVEST_CARDS.find((definition) => definition.id === me.harvestCard);
  const stealTarget = state.players.find((player) => player.id !== playerId && player.harvestCard);
  const dispatch = (command: CommandInput) => {
    if (!connected) return;
    send({ ...command, commandId: commandId(), expectedVersion: state.version } as ClientCommand);
  };
  const canEnd = isMyTurn && state.turn.phase === "moving" && (state.turn.movesRemaining === 0 || available.length === 0);
  const canRelocateWalrus = isMyTurn && state.turn.phase === "moving" && state.turn.movesRemaining > 0 && (state.turn.walrusRelocationsRemaining ?? 0) > 0;

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSettingsOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  useEffect(() => {
    if (!rolling) return;
    const interval = window.setInterval(() => setDieFrame((frame) => (frame + 1) % DIE_ICONS.length), 85);
    const timeout = window.setTimeout(() => setRolling(false), 750);
    return () => { window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [rolling]);

  const clearSpecial = () => { setSpecialMode(undefined); setSelectedPoop(undefined); };
  const playSimpleCard = () => {
    if (!me.harvestCard) return;
    let play: HarvestPlay;
    if (me.harvestCard === "avoid-or-two" || me.harvestCard === "steal-or-two") return;
    if (me.harvestCard === "relocate-and-roll") {
      if (state.poop.length === 0) play = { cardId: "relocate-and-roll" };
      else { setSpecialMode("poop"); return; }
    } else if (me.harvestCard === "move-opponent") { setSpecialMode("opponent"); return; }
    else play = { cardId: me.harvestCard } as HarvestPlay;
    dispatch({ type: "play-harvest", play });
  };

  const chooseEmptyCell = (position: Position) => {
    if (specialMode === "walrus-only") dispatch({ type: "place-cow", to: position, leavePoop: false });
    if (specialMode === "walrus-poop") {
      if (state.poopSupply === 0 && !selectedPoop) return;
      dispatch({ type: "place-cow", to: position, leavePoop: true, poopFrom: selectedPoop });
    }
    if (specialMode === "poop" && selectedPoop) dispatch({ type: "play-harvest", play: { cardId: "relocate-and-roll", poopFrom: selectedPoop, poopTo: position } });
    clearSpecial();
  };

  const instruction = specialMode === "walrus-poop"
    ? state.poopSupply === 0 && !selectedPoop ? "Choose a poop to recycle, then choose the walrus destination." : "Choose an open square for the walrus."
    : specialMode === "walrus-only" ? "Choose an open square for the walrus."
    : specialMode === "poop" ? selectedPoop ? "Choose an open square for that poop." : "Choose a poop to relocate."
    : specialMode === "opponent" ? "Choose an opponent penguin or ice block." : undefined;

  const DieIcon = rolling ? DIE_ICONS[dieFrame]! : state.turn.rolled ? DIE_ICONS[state.turn.rolled - 1]! : Dice5;

  return <div className="game-shell">
    <header className="game-header"><div className="wordmark"><SlidescapeMark className="game-logo-mark"/><span>Slidescape</span></div><div className="room-meta"><span className="game-mode-pill">{MODE_LABELS[state.mode].title}</span>{roomCode ? <button onClick={() => navigator.clipboard.writeText(roomCode)}>Room {roomCode}<Copy size={15}/></button> : null}</div><div className="connection"><span className="connection-status"><i className={connected ? "online" : "offline"}/>{connected ? "Connected" : "Reconnecting"}</span><RulesButton/><div className="game-settings-wrap"><button className="settings-toggle" aria-label="Game settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}><Settings size={21}/></button>{settingsOpen ? <section className="game-settings-menu" role="dialog" aria-label="Game settings menu"><header><strong>Game options</strong><button aria-label="Close game settings" onClick={() => setSettingsOpen(false)}><X size={18}/></button></header><p>Leave this match and return to the home screen.</p><button className="leave-game-button" onClick={onLeaveGame}><LogOut size={18}/> Leave game</button></section> : null}</div></div></header>
    {message ? <div className="game-message" role="status">{message}</div> : null}
    <main className="game-layout"><Board state={state} playerId={playerId} selectedId={selectedId} onSelect={setSelectedId} specialMoves={specialMode === "opponent" && selectedId ? legalMovesForPiece(state, selectedId) : undefined} onMove={(move: LegalMove) => { if (specialMode === "opponent") { dispatch({ type: "play-harvest", play: { cardId: "move-opponent", move } }); clearSpecial(); } else dispatch({ type: "move", move }); setSelectedId(undefined); }} onPoopSelect={specialMode === "poop" || (specialMode === "walrus-poop" && state.poopSupply === 0) ? setSelectedPoop : undefined} selectedPoop={selectedPoop} onEmptyCell={specialMode && specialMode !== "opponent" ? chooseEmptyCell : undefined}/>
      <aside className="game-sidebar">
        <section className="turn-panel"><div className="turn-title"><span className="player-token" style={{ background: PLAYER_COLOR_HEX[active.themeColor] }}/><h1>{isMyTurn ? "Your turn" : `${active.name}’s turn`}</h1></div><div className="roll-row"><div className={`die ${rolling ? "rolling" : ""}`} aria-label={rolling ? "Rolling die" : state.turn.rolled ? `Die shows ${state.turn.rolled}` : "Die ready"}><DieIcon/></div><div>{rolling ? <><strong>Rolling…</strong><span>The die is tumbling</span></> : state.turn.rolled ? <><strong>Rolled {state.turn.rolled}</strong><span>{state.turn.movesRemaining} {state.turn.movesRemaining === 1 ? "move" : "moves"} left</span></> : <><strong>Ready to roll</strong><span>{isMyTurn ? "Your move" : "Waiting"}</span></>}</div></div>
          {instruction ? <p className="target-instruction">{instruction}</p> : null}
          {isMyTurn && state.turn.phase === "awaiting-roll" && active.effects.forcedOpponentMoves === 0 ? <button className="primary-action" disabled={!connected || rolling} onClick={() => { setDieFrame(0); setRolling(true); dispatch({ type: "roll" }); }}>{connected ? "Roll the die" : "Waiting for connection…"}</button> : null}
          {canRelocateWalrus ? <div className="walrus-actions"><button className="fish-action" onClick={() => { setSpecialMode("walrus-poop"); setSelectedPoop(undefined); }}>Relocate walrus + poop</button><button className="fish-action subtle" onClick={() => setSpecialMode("walrus-only")}>Relocate without poop</button></div> : null}
          {isMyTurn && state.turn.fishDrawAvailable && !me.harvestCard ? <button className="fish-action" onClick={() => dispatch({ type: "draw-harvest" })}><Fish size={18}/> Take a Fish card instead</button> : null}
          <button className="end-turn" disabled={!canEnd} onClick={() => dispatch({ type: "end-turn" })}>End turn</button>
        </section>
        <details className="side-panel players-panel" open><summary><span><Users size={19}/> Players</span><ChevronDown/></summary><div>{state.players.map((player) => <div className="score-row" key={player.id}><span className="player-token" style={{ background: PLAYER_COLOR_HEX[player.themeColor] }}/><span><strong>{player.name}</strong>{player.id === playerId ? <small>You</small> : null}</span><b>{player.score} / {state.mode === "quick-2" ? 4 : state.mode === "strategic-2" ? 10 : 6}</b></div>)}</div></details>
        <details className="side-panel card-panel" open><summary><span><Fish size={19}/> Your Fish card</span><ChevronDown/></summary>{card ? <div className="harvest-card"><span className="card-leaf"><Fish/></span><strong>{card.id.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ")}</strong><p>{card.text}</p><div className="card-actions">{card.id === "avoid-or-two" ? <><button disabled={!isMyTurn || me.harvestDrawnTurn === state.turn.number} onClick={() => dispatch({ type: "play-harvest", play: { cardId: "avoid-or-two", choice: "avoid" } })}>Block one Poop</button><button disabled={!isMyTurn || me.harvestDrawnTurn === state.turn.number} onClick={() => dispatch({ type: "play-harvest", play: { cardId: "avoid-or-two", choice: "two" } })}>Add 2 moves</button></> : card.id === "steal-or-two" ? <>{stealTarget ? <button disabled={!isMyTurn || me.harvestDrawnTurn === state.turn.number} onClick={() => dispatch({ type: "play-harvest", play: { cardId: "steal-or-two", choice: "steal", targetPlayerId: stealTarget.id } })}>Take {stealTarget.name}’s card</button> : null}<button disabled={!isMyTurn || me.harvestDrawnTurn === state.turn.number} onClick={() => dispatch({ type: "play-harvest", play: { cardId: "steal-or-two", choice: "two" } })}>Add 2 moves</button></> : <button disabled={!isMyTurn || me.harvestDrawnTurn === state.turn.number} onClick={playSimpleCard}>{card.id === "move-opponent" ? "Choose rival piece" : card.id === "relocate-and-roll" && state.poop.length > 0 ? "Choose poop" : "Use card"}</button>}</div></div> : <div className="empty-card"><Fish/><p>Roll a two to draw a Fish card.</p></div>}</details>
      </aside>
    </main>
    <div className="sr-only" aria-live="polite">{state.log.at(-1)}</div>
    {state.status === "finished" ? <div className="game-over"><div><h2>{state.winnerId === playerId ? "You won!" : `${state.players.find((player) => player.id === state.winnerId)?.name} wins`}</h2><p>You mastered the Slidescape.</p><button onClick={() => { localStorage.removeItem("slidescape-session-v1"); location.reload(); }}>Back to lobby</button></div></div> : null}
  </div>;
}
