import { describe, expect, it } from "vitest";
import { advanceBotAction } from "./bot.js";
import { createGame } from "./engine.js";
import type { GameState } from "./types.js";

function gameWithBotFirst(): GameState {
  for (let seed = 1; seed < 1_000; seed += 1) {
    const state = createGame("bot-test", "quick-2", [
      { id: "human", name: "Human" },
      { id: "bot", name: "Testing Bot" }
    ], seed);
    if (state.turn.activePlayerId === "bot") return state;
  }
  throw new Error("Could not find a deterministic bot-first seed.");
}

describe("paced bot actions", () => {
  it("keeps setup intact until the first scheduled action, then exposes the roll separately", () => {
    const setup = gameWithBotFirst();
    expect(setup.version).toBe(1);
    expect(setup.turn.rolled).toBeUndefined();

    const first = advanceBotAction(setup, "bot");
    expect(first.kind).toBe("roll");
    expect(first.state.version).toBe(2);
    expect(first.state.turn.activePlayerId).toBe("bot");
    expect(first.state.turn.rolled).toBeGreaterThanOrEqual(1);
    expect(first.state.turn.rolled).toBeLessThanOrEqual(6);
  });

  it("advances exactly one versioned action at a time until control reaches the human", () => {
    let state = gameWithBotFirst();
    const observedVersions = [state.version];
    let guard = 20;

    while (state.turn.activePlayerId === "bot" && guard-- > 0) {
      const result = advanceBotAction(state, "bot");
      state = result.state;
      observedVersions.push(state.version);
    }

    expect(state.turn.activePlayerId).toBe("human");
    expect(observedVersions.length).toBeGreaterThan(2);
    expect(observedVersions.every((version, index) => index === 0 || version === observedVersions[index - 1]! + 1)).toBe(true);
  });
});
