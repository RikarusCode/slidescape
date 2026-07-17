import { ChevronDown, Copy, Dice5, Leaf, Settings, Users } from "lucide-react";
import { HARVEST_CARDS, legalMoves, legalMovesForPiece, type ClientCommand, type GameState, type HarvestPlay, type LegalMove, type Position } from "@haywire/game";
import { useMemo, useState } from "react";
import { Board } from "./Board.js";

const commandId = () => crypto.randomUUID();
type CommandInput = ClientCommand extends infer Command
  ? Command extends ClientCommand ? Omit<Command, "commandId" | "expectedVersion"> : never
  : never;

export function GameView({ state, playerId, roomCode, connected, send }: { state: GameState; playerId: string; roomCode?: string; connected: boolean; send: (command: ClientCommand) => void }) {
  const [selectedId, setSelectedId] = useState<string>();
  const [specialMode, setSpecialMode] = useState<"cow" | "opponent" | "poop">();
  const [selectedPoop, setSelectedPoop] = useState<Position>();
  const active = state.players.find((player) => player.id === state.turn.activePlayerId)!;
  const me = state.players.find((player) => player.id === playerId)!;
  const isMyTurn = state.turn.activePlayerId === playerId;
  const available = useMemo(() => legalMoves(state, playerId), [state, playerId]);
  const card = HARVEST_CARDS.find((definition) => definition.id === me.harvestCard);
  const stealTarget = state.players.find((player) => player.id !== playerId && player.harvestCard);
  const dispatch = (command: CommandInput) => send({ ...command, commandId: commandId(), expectedVersion: state.version } as ClientCommand);
  const playSimpleCard = () => {
    if (!me.harvestCard) return;
    let play: HarvestPlay;
    if (me.harvestCard === "avoid-or-two" || me.harvestCard === "steal-or-two") return;
    if (me.harvestCard === "relocate-and-roll") {
      if (state.poop.length === 0) play = { cardId: "relocate-and-roll" };
      else { setSpecialMode("poop"); return; }
    }
    else if (me.harvestCard === "move-opponent") { setSpecialMode("opponent"); return; }
    else play = { cardId: me.harvestCard } as HarvestPlay;
    dispatch({ type: "play-harvest", play });
  };
  const canEnd = isMyTurn && state.turn.phase === "moving" && (state.turn.movesRemaining === 0 || available.length === 0);

  return <div className="game-shell">
    <header className="game-header"><div className="wordmark">Haywire</div><div className="room-meta"><span>{roomCode ? "Private game" : state.mode.replace("-", " ")}</span>{roomCode ? <button onClick={() => navigator.clipboard.writeText(roomCode)}>Room {roomCode}<Copy size={15}/></button> : null}</div><div className="connection"><i className={connected ? "online" : "offline"}/>{connected ? "Connected" : "Reconnecting"}<button aria-label="Settings"><Settings size={21}/></button></div></header>
    <main className="game-layout"><Board state={state} playerId={playerId} selectedId={selectedId} onSelect={(pieceId) => { setSelectedId(pieceId); }} specialMoves={specialMode === "opponent" && selectedId ? legalMovesForPiece(state, selectedId) : undefined} onMove={(move: LegalMove) => { if (specialMode === "opponent") { dispatch({ type: "play-harvest", play: { cardId: "move-opponent", move } }); setSpecialMode(undefined); } else dispatch({ type: "move", move }); setSelectedId(undefined); }} onPoopSelect={specialMode === "poop" ? setSelectedPoop : undefined} selectedPoop={selectedPoop} onEmptyCell={specialMode ? (position) => { if (specialMode === "cow") dispatch({ type: "place-cow", to: position }); if (specialMode === "poop" && selectedPoop) dispatch({ type: "play-harvest", play: { cardId: "relocate-and-roll", poopFrom: selectedPoop, poopTo: position } }); setSpecialMode(undefined); setSelectedPoop(undefined); } : undefined}/>
      <aside className="game-sidebar">
        <section className="turn-panel"><div className="turn-title"><span className={`player-token ${active.colors[0]}`}/><h1>{isMyTurn ? "Your turn" : `${active.name}’s turn`}</h1></div><div className="roll-row"><div className="die"><Dice5/></div><div>{state.turn.rolled ? <><strong>Rolled {state.turn.rolled}</strong><span>{state.turn.movesRemaining} {state.turn.movesRemaining === 1 ? "move" : "moves"} left</span></> : <><strong>Ready to roll</strong><span>{isMyTurn ? "Your move" : "Waiting"}</span></>}</div></div>{isMyTurn && state.turn.phase === "awaiting-roll" && active.effects.forcedOpponentMoves === 0 ? <button className="primary-action" onClick={() => dispatch({ type: "roll" })}>Roll the die</button> : null}{isMyTurn && state.turn.rolled === 1 && state.turn.movesRemaining === 1 ? <button className="harvest-action" onClick={() => setSpecialMode("cow")}>Relocate cow &amp; poop</button> : null}{isMyTurn && state.turn.rolled === 2 && state.turn.movesRemaining === 2 && !state.turn.harvestForbidden && !me.harvestCard ? <button className="harvest-action" onClick={() => dispatch({ type: "draw-harvest" })}><Leaf size={18}/> Take Harvest instead</button> : null}<button className="end-turn" disabled={!canEnd} onClick={() => dispatch({ type: "end-turn" })}>End turn</button></section>
        <details className="side-panel players-panel" open><summary><span><Users size={19}/> Players</span><ChevronDown/></summary><div>{state.players.map((player) => <div className="score-row" key={player.id}><span className={`player-token ${player.colors[0]}`}/><span><strong>{player.name}</strong>{player.id === playerId ? <small>You</small> : null}</span><b>{player.score} / {state.mode === "quick-2" ? 4 : state.mode === "strategic-2" ? 10 : 6}</b></div>)}</div></details>
        <details className="side-panel card-panel" open><summary><span><Leaf size={19}/> Your card</span><ChevronDown/></summary>{card ? <div className="harvest-card"><span className="card-leaf"><Leaf/></span><strong>{card.id.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ")}</strong><p>{card.text}</p><div className="card-actions">{card.id === "avoid-or-two" ? <><button disabled={!isMyTurn || me.harvestDrawnTurn === state.turn.number} onClick={() => dispatch({ type: "play-harvest", play: { cardId: "avoid-or-two", choice: "avoid" } })}>Block one Poop</button><button disabled={!isMyTurn || me.harvestDrawnTurn === state.turn.number} onClick={() => dispatch({ type: "play-harvest", play: { cardId: "avoid-or-two", choice: "two" } })}>Add 2 moves</button></> : card.id === "steal-or-two" ? <>{stealTarget ? <button disabled={!isMyTurn || me.harvestDrawnTurn === state.turn.number} onClick={() => dispatch({ type: "play-harvest", play: { cardId: "steal-or-two", choice: "steal", targetPlayerId: stealTarget.id } })}>Take {stealTarget.name}’s card</button> : null}<button disabled={!isMyTurn || me.harvestDrawnTurn === state.turn.number} onClick={() => dispatch({ type: "play-harvest", play: { cardId: "steal-or-two", choice: "two" } })}>Add 2 moves</button></> : <button disabled={!isMyTurn || me.harvestDrawnTurn === state.turn.number} onClick={playSimpleCard}>{card.id === "move-opponent" ? "Choose rival piece" : card.id === "relocate-and-roll" && state.poop.length > 0 ? "Choose poop" : "Use card"}</button>}</div></div> : <div className="empty-card"><Leaf/><p>Roll a two to draw a Harvest card.</p></div>}</details>
      </aside>
    </main>
    <div className="sr-only" aria-live="polite">{state.log.at(-1)}</div>
    {state.status === "finished" ? <div className="game-over"><div><h2>{state.winnerId === playerId ? "You won!" : `${state.players.find((player) => player.id === state.winnerId)?.name} wins`}</h2><p>The farm has officially gone haywire.</p><button onClick={() => { localStorage.removeItem("haywire-session-v1"); location.reload(); }}>Back to lobby</button></div></div> : null}
  </div>;
}
