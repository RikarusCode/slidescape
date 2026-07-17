import { useEffect, useRef, useState } from "react";
import type { ClientCommand, GameMode, GameState } from "@haywire/game";
import type { Socket } from "socket.io-client";
import { GameView } from "./components/GameView.js";
import { Home, WaitingRoom, type LobbyState } from "./components/Lobby.js";
import { connectGame, readSession, SESSION_KEY, type Session } from "./socket.js";

export function App() {
  const [name, setName] = useState(() => localStorage.getItem("haywire-name") ?? "");
  const [mode, setMode] = useState<GameMode>("quick-2");
  const [code, setCode] = useState("");
  const [session, setSession] = useState<Session>();
  const [lobby, setLobby] = useState<LobbyState>();
  const [game, setGame] = useState<GameState>();
  const [message, setMessage] = useState<string>();
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | undefined>(undefined);

  const ensureSocket = () => {
    if (socketRef.current) return socketRef.current;
    const socket = connectGame(name.trim() || "Farmhand");
    socketRef.current = socket;
    localStorage.setItem("haywire-name", name.trim() || "Farmhand");
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("session", (value: Session) => { setSession(value); localStorage.setItem(SESSION_KEY, JSON.stringify(value)); });
    socket.on("lobby-state", (value: LobbyState) => setLobby(value));
    socket.on("game-state", (value: GameState) => { setGame(value); setMessage(undefined); });
    socket.on("game-over", (value: GameState) => setGame(value));
    socket.on("server-message", (value: string) => setMessage(value));
    return socket;
  };

  useEffect(() => {
    if (readSession()) ensureSocket();
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = undefined;
    };
  }, []);
  const action = (event: string, payload: unknown) => {
    const socket = ensureSocket();
    socket.emit(event, payload, (reply: { ok: boolean; message?: string; waiting?: boolean }) => {
      if (!reply.ok) setMessage(reply.message ?? "Something went wrong.");
      else if (reply.waiting) setMessage("Searching for another farmhand…");
    });
  };
  const send = (command: ClientCommand) => action("command", command);

  if (game && session) return <GameView state={game} playerId={session.playerId} roomCode={lobby?.code} connected={connected} send={send}/>;
  if (lobby && session) return <WaitingRoom lobby={lobby} playerId={session.playerId} onReady={(ready) => ensureSocket().emit("ready", ready)} onTimerVote={(enabled) => ensureSocket().emit("timer-vote", enabled)}/>;
  return <Home name={name} setName={setName} mode={mode} setMode={setMode} code={code} setCode={setCode} onCreate={() => action("create-private", { mode, turnTimer: false })} onJoin={() => action("join-private", { code })} onQueue={() => action("join-queue", { mode })} message={message}/>;
}
