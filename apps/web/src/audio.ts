export type AudioScene = "silent" | "lobby" | "game" | "results";
export type SoundEffect =
  | "ui"
  | "dice"
  | "slide"
  | "ice"
  | "elephant-seal"
  | "poop"
  | "fish"
  | "score"
  | "turn"
  | "win"
  | "lose";

export interface AudioSettings {
  music: number;
  effects: number;
}

interface MusicTrack {
  id: string;
  src: string;
}

const STORAGE_KEY = "slidescape-audio-v1";
const AUDIO_ROOT = "/assets/audio";
const SLIDE_SOUND = `${AUDIO_ROOT}/penguin-slide-v1.mp3`;
const DEFAULT_SETTINGS: AudioSettings = { music: 0.38, effects: 0.72 };
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const midiFrequency = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

const MUSIC = {
  rainyLounge: {
    id: "rainy-lounge",
    src: `${AUDIO_ROOT}/rainy-lounge-556235-160k.mp3`
  },
  saxophoneJazz: {
    id: "saxophone-jazz",
    src: `${AUDIO_ROOT}/saxophone-jazz-560421-160k.mp3`
  },
  coffeeShop: {
    id: "coffee-shop",
    src: `${AUDIO_ROOT}/coffee-shop-567545-160k.mp3`
  },
  studySession: {
    id: "study-session",
    src: `${AUDIO_ROOT}/study-session-567544-160k.mp3`
  },
  jazzRestaurant: {
    id: "jazz-restaurant",
    src: `${AUDIO_ROOT}/jazz-restaurant-560418-160k.mp3`
  },
  jazzHiphop: {
    id: "jazz-hiphop",
    src: `${AUDIO_ROOT}/jazz-hiphop-567429-160k.mp3`
  },
  relaxingBackground: {
    id: "relaxing-background",
    src: `${AUDIO_ROOT}/relaxing-background-565102-160k.mp3`
  }
} as const satisfies Record<string, MusicTrack>;

const LOBBY_TRACKS: readonly MusicTrack[] = [MUSIC.rainyLounge, MUSIC.coffeeShop, MUSIC.relaxingBackground];
const GAME_TRACKS: readonly MusicTrack[] = [
  MUSIC.rainyLounge,
  MUSIC.saxophoneJazz,
  MUSIC.coffeeShop,
  MUSIC.studySession,
  MUSIC.jazzRestaurant,
  MUSIC.jazzHiphop,
  MUSIC.relaxingBackground
];
const RESULTS_TRACKS: readonly MusicTrack[] = [MUSIC.relaxingBackground, MUSIC.rainyLounge];

export const AUDIO_LIBRARY_SIZE = {
  lobby: LOBBY_TRACKS.length,
  game: GAME_TRACKS.length,
  results: RESULTS_TRACKS.length
} as const;

function readSettings(): AudioSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null"
    ) as Partial<AudioSettings> | null;
    if (!stored) return DEFAULT_SETTINGS;
    return {
      music: clamp(stored.music ?? DEFAULT_SETTINGS.music),
      effects: clamp(stored.effects ?? DEFAULT_SETTINGS.effects)
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

class SlidescapeAudio {
  private settings = readSettings();
  private listeners = new Set<() => void>();
  private context?: AudioContext;
  private effectsBus?: GainNode;
  private noise?: AudioBuffer;
  private slideBuffer?: AudioBuffer;
  private slideBufferPromise?: Promise<AudioBuffer | undefined>;
  private music?: HTMLAudioElement;
  private musicRetry?: number;
  private musicGeneration = 0;
  private scene: AudioScene = "silent";
  private unlocked = false;
  private trackDeck: MusicTrack[] = [];
  private lastTrackId?: string;

  constructor() {
    if (typeof window === "undefined") return;
    const unlock = () => this.unlock();
    window.addEventListener("pointerdown", unlock, {
      capture: true,
      passive: true
    });
    window.addEventListener("keydown", unlock, { capture: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.music?.pause();
        if (this.context) void this.context.suspend();
        return;
      }
      if (!this.unlocked) return;
      if (this.context) void this.context.resume();
      this.startMusic();
    });
  }

  getSnapshot = () => this.settings;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setSettings(next: Partial<AudioSettings>) {
    const previousMusic = this.settings.music;
    this.settings = {
      music: clamp(next.music ?? this.settings.music),
      effects: clamp(next.effects ?? this.settings.effects)
    };
    if (typeof window !== "undefined")
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    this.applyVolumes();
    for (const listener of this.listeners) listener();
    if (this.settings.music === 0 && previousMusic > 0) this.music?.pause();
    else if (this.settings.music > 0) this.unlock();
  }

  setScene(scene: AudioScene) {
    if (scene === this.scene) return;
    this.scene = scene;
    this.trackDeck = [];
    this.stopMusic();
    this.startMusic();
  }

  unlock() {
    this.unlocked = true;
    const context = this.ensureContext();
    if (context?.state === "suspended") void context.resume();
    if (this.settings.effects > 0) void this.loadSlideBuffer();
    this.startMusic();
  }

  play(effect: SoundEffect) {
    if (this.settings.effects <= 0 || typeof window === "undefined") return;
    const context = this.ensureContext();
    if (!context) return;
    this.unlock();
    const now = context.currentTime;
    if (effect === "slide") {
      this.playSlide(now);
      return;
    }
    if (effect === "ui") this.tone(520, 680, now, 0.07, 0.045, "sine");
    if (effect === "dice") this.dice(now);
    if (effect === "ice") {
      this.tone(420, 560, now, 0.14, 0.075, "triangle");
      this.tone(680, 820, now + 0.06, 0.13, 0.045, "sine");
    }
    if (effect === "elephant-seal") {
      this.tone(230, 155, now, 0.28, 0.075, "sine");
      this.tone(310, 230, now + 0.05, 0.2, 0.035, "triangle");
    }
    if (effect === "poop") {
      this.tone(210, 105, now, 0.22, 0.085, "sine");
      this.tone(155, 125, now + 0.09, 0.18, 0.035, "triangle");
    }
    if (effect === "fish") this.chime([74, 78, 81, 86], now, 0.085, 0.055);
    if (effect === "score") this.chime([72, 76, 79, 84], now, 0.1, 0.07);
    if (effect === "turn") this.chime([67, 72], now, 0.13, 0.035);
    if (effect === "win") this.chime([60, 64, 67, 72, 76, 79], now, 0.13, 0.095);
    if (effect === "lose") this.chime([67, 64, 60, 55], now, 0.16, 0.05);
  }

  private ensureContext() {
    if (this.context) return this.context;
    if (typeof window === "undefined" || !window.AudioContext) return undefined;
    const context = new window.AudioContext({ latencyHint: "interactive" });
    this.context = context;
    this.effectsBus = context.createGain();
    this.effectsBus.connect(context.destination);
    this.noise = this.createNoise(context);
    this.applyVolumes();
    return context;
  }

  private ensureMusic() {
    if (this.music) return this.music;
    if (typeof Audio === "undefined") return undefined;
    const music = new Audio();
    music.preload = "none";
    music.loop = false;
    music.addEventListener("ended", () => this.playNextTrack(this.musicGeneration));
    music.addEventListener("error", () => this.retryAfterMusicError());
    this.music = music;
    this.applyVolumes();
    return music;
  }

  private applyVolumes() {
    if (this.context)
      this.effectsBus?.gain.setTargetAtTime(this.settings.effects, this.context.currentTime, 0.02);
    if (this.music) this.music.volume = this.settings.music * 0.32;
  }

  private createNoise(context: AudioContext) {
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.7), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    return buffer;
  }

  private loadSlideBuffer() {
    if (this.slideBuffer) return Promise.resolve(this.slideBuffer);
    if (this.slideBufferPromise) return this.slideBufferPromise;
    const context = this.ensureContext();
    if (!context) return Promise.resolve(undefined);
    this.slideBufferPromise = fetch(SLIDE_SOUND, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Slide sound returned ${response.status}`);
        return response.arrayBuffer();
      })
      .then((bytes) => context.decodeAudioData(bytes))
      .then((buffer) => {
        this.slideBuffer = buffer;
        return buffer;
      })
      .catch(() => undefined)
      .finally(() => {
        if (!this.slideBuffer) this.slideBufferPromise = undefined;
      });
    return this.slideBufferPromise;
  }

  private playSlide(when: number) {
    if (!this.context || !this.effectsBus || !this.slideBuffer) {
      void this.loadSlideBuffer();
      return;
    }
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.slideBuffer;
    gain.gain.value = 0.42;
    source.connect(gain).connect(this.effectsBus);
    source.start(when);
  }

  private tone(
    from: number,
    to: number,
    when: number,
    duration: number,
    volume: number,
    wave: OscillatorType
  ) {
    if (!this.context || !this.effectsBus) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(from, when);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, to), when + duration);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + Math.min(0.025, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(gain).connect(this.effectsBus);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
  }

  private noiseBurst(when: number, duration: number, frequency: number, volume: number) {
    if (!this.context || !this.effectsBus || !this.noise) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noise;
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 1.1;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    source.connect(filter).connect(gain).connect(this.effectsBus);
    source.start(when, Math.random() * 0.2, duration);
  }

  private dice(when: number) {
    for (let index = 0; index < 7; index += 1) {
      const at = when + index * 0.075 + Math.random() * 0.018;
      this.noiseBurst(at, 0.055, 900 + Math.random() * 900, 0.075 - index * 0.004);
      this.tone(520 + Math.random() * 140, 390, at, 0.045, 0.025, "triangle");
    }
  }

  private chime(notes: number[], when: number, spacing: number, volume: number) {
    notes.forEach((note, index) => {
      const at = when + index * spacing;
      const frequency = midiFrequency(note);
      this.tone(frequency, frequency * 1.003, at, 0.34, volume, index % 2 ? "triangle" : "sine");
    });
  }

  private tracksForScene() {
    if (this.scene === "lobby") return LOBBY_TRACKS;
    if (this.scene === "game") return GAME_TRACKS;
    if (this.scene === "results") return RESULTS_TRACKS;
    return [];
  }

  private nextTrack() {
    const tracks = this.tracksForScene();
    if (tracks.length === 0) return undefined;
    if (this.trackDeck.length === 0) {
      this.trackDeck = shuffle(tracks);
      if (this.trackDeck.length > 1 && this.trackDeck[0]?.id === this.lastTrackId) {
        const first = this.trackDeck.shift()!;
        this.trackDeck.push(first);
      }
    }
    const track = this.trackDeck.shift();
    this.lastTrackId = track?.id;
    return track;
  }

  private startMusic() {
    if (
      !this.unlocked ||
      this.scene === "silent" ||
      this.settings.music <= 0 ||
      typeof document === "undefined" ||
      document.hidden
    )
      return;
    const music = this.ensureMusic();
    if (!music) return;
    if (music.getAttribute("src") && !music.ended) {
      void music.play().catch(() => undefined);
      return;
    }
    this.playNextTrack(this.musicGeneration);
  }

  private playNextTrack(generation: number) {
    if (
      generation !== this.musicGeneration ||
      !this.unlocked ||
      this.scene === "silent" ||
      this.settings.music <= 0 ||
      document.hidden
    )
      return;
    const music = this.ensureMusic();
    const track = this.nextTrack();
    if (!music || !track) return;
    music.src = track.src;
    music.preload = "auto";
    music.load();
    void music.play().catch(() => undefined);
  }

  private retryAfterMusicError() {
    if (this.musicRetry !== undefined || this.scene === "silent") return;
    const generation = this.musicGeneration;
    this.musicRetry = window.setTimeout(() => {
      this.musicRetry = undefined;
      this.playNextTrack(generation);
    }, 900);
  }

  private stopMusic() {
    this.musicGeneration += 1;
    if (this.musicRetry !== undefined) window.clearTimeout(this.musicRetry);
    this.musicRetry = undefined;
    if (!this.music) return;
    this.music.pause();
    this.music.removeAttribute("src");
    this.music.load();
  }
}

export const audio = new SlidescapeAudio();
