import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  Copy,
  LockKeyhole,
  PencilLine,
  Shuffle,
  Snowflake,
  Users,
  X
} from "lucide-react";
import {
  PLAYER_COLOR_HEX,
  PLAYER_COLOR_LABEL,
  PLAYER_COLOR_ORDER,
  type GameMode,
  type LobbySettings,
  type PlayerColor,
  type TurnTimerSeconds
} from "@slidescape/game";
import { RulesButton } from "./RulesDialog.js";
import { AudioSettingsButton } from "./AudioSettings.js";
import { audio } from "../audio.js";

export interface LobbyState {
  id: string;
  code?: string;
  hostId: string;
  settings: LobbySettings;
  requiredPlayers: number;
  members: {
    id: string;
    name: string;
    ready: boolean;
    connected: boolean;
    colorChoice?: PlayerColor;
  }[];
  started: boolean;
}

export const MODE_LABELS: Record<
  GameMode,
  { title: string; detail: string; penguin: "blue" | "teal" | "purple" }
> = {
  "quick-2": {
    title: "Beginner 2-player",
    detail: "Opposite teams · first to four",
    penguin: "blue"
  },
  "strategic-2": {
    title: "Standard 2-player",
    detail: "Two teams each · first to ten",
    penguin: "teal"
  },
  "classic-4": {
    title: "Classic 4-player",
    detail: "One team each · escape all six",
    penguin: "purple"
  }
};

const TIMER_OPTIONS: ReadonlyArray<{
  seconds: TurnTimerSeconds;
  label: string;
}> = [
  { seconds: 0, label: "Off" },
  { seconds: 45, label: "45 seconds" },
  { seconds: 90, label: "90 seconds" },
  { seconds: 180, label: "3 minutes" }
];
const timerLabel = (seconds: TurnTimerSeconds) =>
  TIMER_OPTIONS.find((option) => option.seconds === seconds)?.label ?? "Off";

function PenguinSprite({
  color,
  className = ""
}: {
  color: "teal" | "coral" | "blue" | "purple";
  className?: string;
}) {
  return (
    <img
      className={`penguin-sprite ${className}`.trim()}
      src={`/assets/slidescape-penguin-${color}.webp`}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

export function SlidescapeMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`slidescape-logo-mark ${className}`.trim()}
      viewBox="0 0 112 112"
      role="img"
      aria-label="Slidescape penguin face logo"
    >
      <rect className="logo-head" x="11" y="10" width="90" height="88" rx="25" />
      <path
        className="logo-face"
        d="M56 36C47 24 29 27 25 43C19 68 37 87 56 87C75 87 93 68 87 43C83 27 65 24 56 36Z"
      />
      <circle className="logo-eye" cx="40" cy="49" r="5" />
      <circle className="logo-eye" cx="72" cy="49" r="5" />
      <path className="logo-beak" d="M56 53L67 62L56 70L45 62Z" />
      <path className="logo-ice" d="M20 91C38 86 74 86 92 91" />
    </svg>
  );
}

export function Home({
  name,
  setName,
  mode,
  setMode,
  code,
  setCode,
  privateTimerSeconds,
  setPrivateTimerSeconds,
  onCreate,
  onJoin,
  onQueue,
  onCancelQueue,
  onBot,
  searching,
  message
}: {
  name: string;
  setName: (value: string) => void;
  mode: GameMode;
  setMode: (mode: GameMode) => void;
  code: string;
  setCode: (value: string) => void;
  privateTimerSeconds: TurnTimerSeconds;
  setPrivateTimerSeconds: (value: TurnTimerSeconds) => void;
  onCreate: () => void;
  onJoin: () => void;
  onQueue: () => void;
  onCancelQueue: () => void;
  onBot: () => void;
  searching: boolean;
  message?: string;
}) {
  const [privateRoomOpen, setPrivateRoomOpen] = useState(false);

  useEffect(() => {
    if (!privateRoomOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPrivateRoomOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [privateRoomOpen]);

  return (
    <main className="home-shell">
      <section className="home-copy">
        <div className="brand-cluster">
          <div className="brand-lockup">
            <SlidescapeMark />
            <h1>Slidescape</h1>
          </div>
          <p className="home-tagline">An online Chickapig alternative.</p>
        </div>
        <div className="hero-penguins" aria-hidden="true">
          <span className="skate-trail trail-teal" />
          <PenguinSprite color="teal" className="hero-penguin hero-penguin-teal" />
          <span className="skate-trail trail-coral" />
          <PenguinSprite color="coral" className="hero-penguin hero-penguin-coral" />
          <span className="skate-trail trail-blue" />
          <PenguinSprite color="blue" className="hero-penguin hero-penguin-blue" />
        </div>
      </section>
      <section className="lobby-card" aria-label="Start a game">
        <div className="player-identity">
          <PenguinSprite color="blue" className="player-avatar" />
          <label>
            <span>Display name</span>
            <span className="name-input">
              <input
                value={name}
                maxLength={24}
                onChange={(event) => setName(event.target.value)}
                placeholder="Penguin Player"
              />
              <PencilLine size={21} />
            </span>
          </label>
          <div className="lobby-utility-buttons">
            <AudioSettingsButton className="home-audio" />
            <RulesButton className="home-rules" />
          </div>
        </div>
        <fieldset className="mode-picker">
          <legend className="sr-only">Choose a game</legend>
          {(Object.keys(MODE_LABELS) as GameMode[]).map((value) => (
            <button
              key={value}
              className={`mode-option ${mode === value ? "selected" : ""}`}
              onClick={() => {
                audio.play("ui");
                setMode(value);
              }}
              aria-pressed={mode === value}
            >
              <PenguinSprite color={MODE_LABELS[value].penguin} className="mode-penguin" />
              <span>
                <strong>{MODE_LABELS[value].title}</strong>
                <small>{MODE_LABELS[value].detail}</small>
              </span>
              <ChevronRight size={27} />
            </button>
          ))}
        </fieldset>
        <div className="play-row">
          <button
            type="button"
            className="primary-action"
            disabled={searching}
            onClick={() => {
              audio.play("ui");
              onQueue();
            }}
          >
            <Shuffle size={22} /> Find a random game
          </button>
          <button
            type="button"
            className="secondary-action bot-action"
            disabled={searching}
            onClick={() => {
              audio.play("ui");
              onBot();
            }}
          >
            <Bot size={21} /> Play a bot
          </button>
        </div>
        <button
          type="button"
          className="secondary-action private-room-action"
          onClick={() => {
            audio.play("ui");
            setPrivateRoomOpen(true);
          }}
        >
          <span className="button-icon">
            <LockKeyhole size={20} />
          </span>{" "}
          Create private room
        </button>
        <div className="join-row">
          <input
            aria-label="Private room code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, ""))}
            maxLength={6}
            placeholder="ENTER ROOM CODE"
          />
          <button
            type="button"
            onClick={() => {
              audio.play("ui");
              onJoin();
            }}
          >
            Join
          </button>
        </div>
        {searching ? (
          <div className="searching-bar" role="status">
            <span>
              <i className="queue-spinner" aria-hidden="true" /> Searching for players…
            </span>
            <button onClick={onCancelQueue}>Cancel</button>
          </div>
        ) : message ? (
          <p className="form-message" role="status">
            {message}
          </p>
        ) : null}
      </section>
      {privateRoomOpen ? (
        <div
          className="private-room-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPrivateRoomOpen(false);
          }}
        >
          <section
            className="private-room-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="private-room-title"
          >
            <header>
              <span className="button-icon">
                <LockKeyhole size={20} />
              </span>
              <div>
                <h2 id="private-room-title">Create a private room</h2>
                <p>Invite friends with a six-character code.</p>
              </div>
              <button
                className="dialog-close"
                aria-label="Close private room menu"
                onClick={() => setPrivateRoomOpen(false)}
              >
                <X size={21} />
              </button>
            </header>
            <label className="private-setting">
              <span>Game format</span>
              <select value={mode} onChange={(event) => setMode(event.target.value as GameMode)}>
                {(Object.keys(MODE_LABELS) as GameMode[]).map((value) => (
                  <option key={value} value={value}>
                    {MODE_LABELS[value].title}
                  </option>
                ))}
              </select>
            </label>
            <label className="private-setting">
              <span>Turn timer</span>
              <select
                value={privateTimerSeconds}
                onChange={(event) => setPrivateTimerSeconds(Number(event.target.value) as TurnTimerSeconds)}
              >
                {TIMER_OPTIONS.map((option) => (
                  <option key={option.seconds} value={option.seconds}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="private-dialog-actions">
              <button className="secondary-action" onClick={() => setPrivateRoomOpen(false)}>
                Back
              </button>
              <button className="primary-action" onClick={onCreate}>
                Create room
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export function WaitingRoom({
  lobby,
  playerId,
  message,
  onLeave,
  onReady,
  onColorChange
}: {
  lobby: LobbyState;
  playerId: string;
  message?: string;
  onLeave: () => void;
  onReady: (ready: boolean) => void;
  onColorChange: (color?: PlayerColor) => void;
}) {
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

  const claimed = new Set(
    lobby.members.flatMap((member) =>
      member.id !== playerId && member.colorChoice ? [member.colorChoice] : []
    )
  );

  return (
    <main className="waiting-shell">
      <section className="waiting-card">
        <button className="waiting-back" onClick={onLeave}>
          <ArrowLeft size={18} /> Back to home
        </button>
        <div className="waiting-utilities">
          <AudioSettingsButton />
          <RulesButton />
        </div>
        <Snowflake size={36} />
        <p className="eyebrow">{lobby.settings.privacy === "private" ? "Private game" : "Random game"}</p>
        <h1>{MODE_LABELS[lobby.settings.mode].title}</h1>
        {lobby.code ? (
          <div className="room-code-wrap">
            <button className="room-code" onClick={copyCode} aria-label={`Copy room code ${lobby.code}`}>
              <span>{lobby.code}</span>
              <Copy size={18} />
            </button>
            {copied ? (
              <span className="copy-toast" role="status">
                Copied!
              </span>
            ) : null}
          </div>
        ) : null}
        <p className="waiting-note">
          Waiting for {lobby.requiredPlayers} players. The game begins when everyone is ready.
        </p>
        <div className="member-list">
          {Array.from({ length: lobby.requiredPlayers }, (_, index) => {
            const member = lobby.members[index];
            return (
              <div className="member-row" key={member?.id ?? index}>
                <span className={`seat-dot ${member ? "filled" : ""}`}>
                  <Users size={16} />
                </span>
                <span className="member-name">
                  {member?.name ?? "Open seat"}
                  {member ? (
                    <small>
                      {member.colorChoice ? PLAYER_COLOR_LABEL[member.colorChoice] : "Random color"}
                    </small>
                  ) : null}
                </span>
                {member?.colorChoice ? (
                  <i className="member-color" style={{ background: PLAYER_COLOR_HEX[member.colorChoice] }} />
                ) : null}
                {member?.ready ? <strong>Ready</strong> : null}
              </div>
            );
          })}
        </div>
        {lobby.settings.privacy === "private" && me ? (
          <fieldset className="color-picker">
            <legend>Choose your color</legend>
            <button
              className={!me.colorChoice ? "selected" : ""}
              aria-pressed={!me.colorChoice}
              onClick={() => onColorChange(undefined)}
            >
              <Shuffle size={16} /> Random color
            </button>
            {PLAYER_COLOR_ORDER.map((color) => (
              <button
                key={color}
                disabled={claimed.has(color)}
                className={me.colorChoice === color ? "selected" : ""}
                aria-label={
                  claimed.has(color) ? `${PLAYER_COLOR_LABEL[color]} is claimed` : PLAYER_COLOR_LABEL[color]
                }
                aria-pressed={me.colorChoice === color}
                title={PLAYER_COLOR_LABEL[color]}
                onClick={() => onColorChange(color)}
              >
                <i style={{ background: PLAYER_COLOR_HEX[color] }} />
                <span>{PLAYER_COLOR_LABEL[color]}</span>
              </button>
            ))}
          </fieldset>
        ) : null}
        {message ? (
          <p className="form-message" role="status">
            {message}
          </p>
        ) : null}
        <p className="timer-summary">Turn timer: {timerLabel(lobby.settings.turnTimerSeconds)}</p>
        <button className="primary-action" onClick={() => onReady(!(me?.ready ?? false))}>
          {me?.ready ? "Not ready" : "Ready up"}
        </button>
      </section>
    </main>
  );
}
