import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Music2, SlidersHorizontal, Volume2, VolumeX, X } from "lucide-react";
import { audio, type AudioScene, type AudioSettings } from "../audio.js";

export function useAudioScene(scene: AudioScene) {
  useEffect(() => {
    audio.setScene(scene);
    return () => audio.setScene("silent");
  }, [scene]);
}

function useAudioSettings() {
  return useSyncExternalStore(audio.subscribe, audio.getSnapshot, audio.getSnapshot);
}

function VolumeControl({
  kind,
  label,
  icon
}: {
  kind: keyof AudioSettings;
  label: string;
  icon: "music" | "effects";
}) {
  const settings = useAudioSettings();
  const value = settings[kind];
  const id = useId();
  const Icon = value === 0 ? VolumeX : icon === "music" ? Music2 : Volume2;
  const update = (next: number) => audio.setSettings({ [kind]: next });

  return (
    <div className="audio-control">
      <div className="audio-control-heading">
        <label htmlFor={id}>
          <Icon size={17} />
          {label}
        </label>
        <output htmlFor={id}>{Math.round(value * 100)}%</output>
      </div>
      <div className="audio-control-row">
        <button
          type="button"
          aria-label={`${value === 0 ? "Unmute" : "Mute"} ${label.toLowerCase()}`}
          onClick={() => {
            const next = value === 0 ? (kind === "music" ? 0.38 : 0.72) : 0;
            update(next);
            if (kind === "effects" && next > 0) audio.play("ui");
          }}
        >
          <Icon size={18} />
        </button>
        <input
          id={id}
          type="range"
          min="0"
          max="100"
          step="1"
          value={Math.round(value * 100)}
          onChange={(event) => update(Number(event.target.value) / 100)}
          aria-valuetext={`${Math.round(value * 100)} percent`}
        />
      </div>
    </div>
  );
}

export function AudioControls() {
  return (
    <div className="audio-controls" aria-label="Sound levels">
      <VolumeControl kind="music" label="Music" icon="music" />
      <VolumeControl kind="effects" label="Sound effects" icon="effects" />
    </div>
  );
}

export function AudioSettingsButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <div className={`audio-settings-wrap ${className}`.trim()}>
      <button
        type="button"
        className="audio-settings-toggle"
        aria-label="Sound settings"
        aria-expanded={open}
        onClick={() => {
          audio.play("ui");
          setOpen((current) => !current);
        }}
      >
        <SlidersHorizontal size={21} />
      </button>
      {open ? (
        <section className="audio-settings-popover" role="dialog" aria-label="Sound settings menu">
          <header>
            <div>
              <strong>Sound</strong>
              <small>Set your ice-side atmosphere.</small>
            </div>
            <button type="button" aria-label="Close sound settings" onClick={() => setOpen(false)}>
              <X size={17} />
            </button>
          </header>
          <AudioControls />
        </section>
      ) : null}
    </div>
  );
}
