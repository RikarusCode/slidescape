import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Bot, Check, Copy, LockKeyhole, Search, Snowflake, Users } from "lucide-react";
import type { GameMode, LobbySettings, TurnTimerSeconds } from "@slidescape/game";
import { RulesButton } from "./RulesDialog.js";

export interface LobbyState {
  id: string;
  code?: string;
  hostId: string;
  settings: LobbySettings;
  requiredPlayers: number;
  members: { id: string; name: string; ready: boolean; connected: boolean }[];
  started: boolean;
}

const MODE_LABELS: Record<GameMode, { title: string; detail: string }> = {
  "quick-2": { title: "Quick 2-player", detail: "Opposite flocks · first to four" },
  "strategic-2": { title: "Strategic 2-player", detail: "Two flocks each · first to ten" },
  "classic-4": { title: "Classic 4-player", detail: "One flock each · escape all six" }
};

const TIMER_OPTIONS: ReadonlyArray<{ seconds: TurnTimerSeconds; label: string }> = [
  { seconds: 0, label: "Off" },
  { seconds: 45, label: "45 seconds" },
  { seconds: 90, label: "90 seconds" },
  { seconds: 180, label: "3 minutes" }
];
const timerLabel = (seconds: TurnTimerSeconds) => TIMER_OPTIONS.find((option) => option.seconds === seconds)?.label ?? "Off";

export function Home({ name, setName, mode, setMode, code, setCode, privateTimerSeconds, setPrivateTimerSeconds, onCreate, onJoin, onQueue, onBot, message }: {
  name: string; setName: (value: string) => void; mode: GameMode; setMode: (mode: GameMode) => void;
  code: string; setCode: (value: string) => void; privateTimerSeconds: TurnTimerSeconds; setPrivateTimerSeconds: (value: TurnTimerSeconds) => void;
  onCreate: () => void; onJoin: () => void; onQueue: () => void; onBot: () => void; message?: string;
}) {
  return <main className="home-shell">
    <section className="home-copy"><div className="brand-lockup"><span className="brand-mark"><span className="penguin-mark"/></span><h1>Slidescape</h1></div><p>Slide. Block. Escape. Send your penguins skimming across the ice before anyone freezes your route.</p><div className="mini-pieces" aria-hidden="true"><i className="mini-penguin red"/><i className="mini-ice"/><i className="mini-walrus"/><i className="mini-poop">↻</i></div></section>
    <section className="lobby-card" aria-label="Start a game">
      <RulesButton className="home-rules"/>
      <label>Display name<input value={name} maxLength={24} onChange={(event) => setName(event.target.value)} placeholder="Penguin Player" /></label>
      <fieldset><legend>Choose a game</legend>{(Object.keys(MODE_LABELS) as GameMode[]).map((value) => <button key={value} className={`mode-option ${mode === value ? "selected" : ""}`} onClick={() => setMode(value)}><span><strong>{MODE_LABELS[value].title}</strong><small>{MODE_LABELS[value].detail}</small></span>{mode === value ? <Check size={20}/> : null}</button>)}</fieldset>
      <div className="play-row"><button className="primary-action" onClick={onQueue}><Search size={20}/> Find a random game</button><button className="secondary-action" onClick={onBot}><Bot size={20}/> Play a bot</button></div>
      <div className="or-rule"><span>or play with friends</span></div>
      <button className="secondary-action" onClick={onCreate}><LockKeyhole size={19}/> Create private room</button>
      <label className="private-timer"><span>Private turn timer</span><select aria-label="Private turn timer" value={privateTimerSeconds} onChange={(event) => setPrivateTimerSeconds(Number(event.target.value) as TurnTimerSeconds)}>{TIMER_OPTIONS.map((option) => <option key={option.seconds} value={option.seconds}>{option.label}</option>)}</select></label>
      <div className="join-row"><input aria-label="Private room code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={6} placeholder="ROOM CODE"/><button onClick={onJoin}>Join</button></div>
      {message ? <p className="form-message" role="status">{message}</p> : null}
    </section>
  </main>;
}

export function WaitingRoom({ lobby, playerId, onLeave, onReady }: { lobby: LobbyState; playerId: string; onLeave: () => void; onReady: (ready: boolean) => void }) {
  const me = lobby.members.find((member) => member.id === playerId);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const copyCode = async () => {
    if (!lobby.code) return;
    await navigator.clipboard.writeText(lobby.code);
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1600);
  };

  return <main className="waiting-shell"><section className="waiting-card"><button className="waiting-back" onClick={onLeave}><ArrowLeft size={18}/> Back to home</button><RulesButton className="waiting-rules"/><Snowflake size={36}/><p className="eyebrow">{lobby.settings.privacy === "private" ? "Private game" : "Random game"}</p><h1>{MODE_LABELS[lobby.settings.mode].title}</h1>{lobby.code ? <div className="room-code-wrap"><button className="room-code" onClick={copyCode} aria-label={`Copy room code ${lobby.code}`}><span>{lobby.code}</span><Copy size={18}/></button>{copied ? <span className="copy-toast" role="status">Copied!</span> : null}</div> : null}<p className="waiting-note">Waiting for {lobby.requiredPlayers} players. The game begins when everyone is ready.</p><div className="member-list">{Array.from({ length: lobby.requiredPlayers }, (_, index) => { const member = lobby.members[index]; return <div className="member-row" key={member?.id ?? index}><span className={`seat-dot ${member ? "filled" : ""}`}><Users size={16}/></span><span>{member?.name ?? "Open seat"}</span>{member?.ready ? <strong>Ready</strong> : null}</div>})}</div><p className="timer-summary">Turn timer: {timerLabel(lobby.settings.turnTimerSeconds)}</p><button className="primary-action" onClick={() => onReady(!(me?.ready ?? false))}>{me?.ready ? "Not ready" : "Ready up"}</button></section></main>;
}
