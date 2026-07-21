import { memo, useEffect, useState, type CSSProperties } from "react";
import { PLAYER_COLOR_HEX, type PlayerColor, type TurnTimerSeconds } from "@slidescape/game";

interface TurnTimerProps {
  deadline?: number;
  durationSeconds?: TurnTimerSeconds;
  activePlayerName: string;
  activePlayerColor: PlayerColor;
  isMyTurn: boolean;
}

function remainingUntil(deadline?: number): number {
  return deadline ? Math.max(0, deadline - Date.now()) : 0;
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export const TurnTimer = memo(function TurnTimer({
  deadline,
  durationSeconds,
  activePlayerName,
  activePlayerColor,
  isMyTurn
}: TurnTimerProps) {
  const [remaining, setRemaining] = useState(() => remainingUntil(deadline));

  useEffect(() => {
    setRemaining(remainingUntil(deadline));
    if (!deadline) return;
    const interval = window.setInterval(() => setRemaining(remainingUntil(deadline)), 250);
    return () => window.clearInterval(interval);
  }, [deadline]);

  if (!deadline || !durationSeconds) return null;
  const total = durationSeconds * 1_000;
  const progress = Math.max(0, Math.min(1, remaining / total));
  const urgent = remaining <= 10_000;
  const style = {
    "--timer-color": PLAYER_COLOR_HEX[activePlayerColor],
    "--timer-progress": `${progress * 360}deg`
  } as CSSProperties;

  return (
    <div
      className={`turn-timer ${urgent ? "urgent" : ""}`}
      style={style}
      role="timer"
      aria-live={urgent ? "polite" : "off"}
      aria-label={`${formatTime(remaining)} remaining in ${activePlayerName}'s turn`}
    >
      <div className="turn-timer-ring">
        <div className="turn-timer-face">
          <span>{isMyTurn ? "Your turn" : activePlayerName}</span>
          <strong>{formatTime(remaining)}</strong>
        </div>
      </div>
    </div>
  );
});
