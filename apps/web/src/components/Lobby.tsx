import { Check, Copy, Dice5, LockKeyhole, Search, Users } from "lucide-react";
import type { GameMode } from "@haywire/game";

export interface LobbyState {
  id: string;
  code?: string;
  hostId: string;
  settings: { mode: GameMode; turnTimer: boolean; privacy: "private" | "random" };
  requiredPlayers: number;
  members: { id: string; name: string; ready: boolean; connected: boolean; timerVote: boolean }[];
  started: boolean;
}

const MODE_LABELS: Record<GameMode, { title: string; detail: string }> = {
  "quick-2": { title: "Quick 2-player", detail: "Opposite flocks · first to four" },
  "strategic-2": { title: "Strategic 2-player", detail: "Two flocks each · first to ten" },
  "classic-4": { title: "Classic 4-player", detail: "One flock each · score all six" }
};

export function Home({ name, setName, mode, setMode, code, setCode, onCreate, onJoin, onQueue, message }: {
  name: string; setName: (value: string) => void; mode: GameMode; setMode: (mode: GameMode) => void;
  code: string; setCode: (value: string) => void; onCreate: () => void; onJoin: () => void; onQueue: () => void; message?: string;
}) {
  return <main className="home-shell">
    <section className="home-copy"><div className="brand-lockup"><span className="brand-mark">H</span><h1>Haywire</h1></div><p>Slide your pigs, place your hay, and make a beautiful mess of everyone else’s plan.</p><div className="mini-pieces" aria-hidden="true"><i className="mini-pig red"/><i className="mini-hay"/><i className="mini-cow"/><i className="mini-poop">↻</i></div></section>
    <section className="lobby-card" aria-label="Start a game">
      <label>Display name<input value={name} maxLength={24} onChange={(event) => setName(event.target.value)} placeholder="Farmhand" /></label>
      <fieldset><legend>Choose a game</legend>{(Object.keys(MODE_LABELS) as GameMode[]).map((value) => <button key={value} className={`mode-option ${mode === value ? "selected" : ""}`} onClick={() => setMode(value)}><span><strong>{MODE_LABELS[value].title}</strong><small>{MODE_LABELS[value].detail}</small></span>{mode === value ? <Check size={20}/> : null}</button>)}</fieldset>
      <button className="primary-action" onClick={onQueue}><Search size={20}/> Find a random game</button>
      <div className="or-rule"><span>or play with friends</span></div>
      <button className="secondary-action" onClick={onCreate}><LockKeyhole size={19}/> Create private room</button>
      <div className="join-row"><input aria-label="Private room code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={6} placeholder="ROOM CODE"/><button onClick={onJoin}>Join</button></div>
      {message ? <p className="form-message" role="status">{message}</p> : null}
    </section>
  </main>;
}

export function WaitingRoom({ lobby, playerId, onReady, onTimerVote }: { lobby: LobbyState; playerId: string; onReady: (ready: boolean) => void; onTimerVote: (enabled: boolean) => void }) {
  const me = lobby.members.find((member) => member.id === playerId);
  return <main className="waiting-shell"><section className="waiting-card"><Dice5 size={36}/><p className="eyebrow">{lobby.settings.privacy === "private" ? "Private game" : "Random game"}</p><h1>{MODE_LABELS[lobby.settings.mode].title}</h1>{lobby.code ? <button className="room-code" onClick={() => navigator.clipboard.writeText(lobby.code!)}><span>{lobby.code}</span><Copy size={18}/></button> : null}<p className="waiting-note">Waiting for {lobby.requiredPlayers} players. The game begins when everyone is ready.</p><div className="member-list">{Array.from({ length: lobby.requiredPlayers }, (_, index) => { const member = lobby.members[index]; return <div className="member-row" key={member?.id ?? index}><span className={`seat-dot ${member ? "filled" : ""}`}><Users size={16}/></span><span>{member?.name ?? "Open seat"}</span>{member?.ready ? <strong>Ready</strong> : null}</div>})}</div>{lobby.settings.privacy === "random" ? <label className="timer-check"><input type="checkbox" checked={me?.timerVote ?? false} onChange={(event) => onTimerVote(event.target.checked)}/> Vote for a 90-second turn timer</label> : <p className="timer-check">Turn timer: {lobby.settings.turnTimer ? "90 seconds" : "off"}</p>}<button className="primary-action" onClick={() => onReady(!(me?.ready ?? false))}>{me?.ready ? "Not ready" : "Ready up"}</button></section></main>;
}

