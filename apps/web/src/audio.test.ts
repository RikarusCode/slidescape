import { afterEach, describe, expect, it } from "vitest";
import { AUDIO_LIBRARY_SIZE, audio } from "./audio.js";

describe("Slidescape audio", () => {
  afterEach(() => audio.setSettings({ music: 0.38, effects: 0.72 }));

  it("ships several original shuffled themes for every scene", () => {
    expect(AUDIO_LIBRARY_SIZE).toEqual({ lobby: 3, game: 7, results: 2 });
  });

  it("clamps independently controlled music and effects levels", () => {
    audio.setSettings({ music: 2, effects: -1 });
    expect(audio.getSnapshot()).toEqual({ music: 1, effects: 0 });
  });
});
