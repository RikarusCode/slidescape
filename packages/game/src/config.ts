import type { Color, Position } from "./types.js";

export const COLOR_ORDER: Color[] = ["green", "yellow", "red", "blue"];
export const COLOR_HEX: Record<Color, string> = {
  green: "#18a999", yellow: "#f6a623", red: "#ef5b5b", blue: "#3977d3"
};

const long = [1, 3, 5, 10, 12, 14];
export const STARTING_POSITIONS: Record<Color, Position[]> = {
  green: long.map((x) => ({ x, y: 0 })),
  yellow: long.map((y) => ({ x: 16, y })),
  red: long.map((x) => ({ x, y: 16 })),
  blue: long.map((y) => ({ x: 0, y }))
};

export const HAY_POSITIONS: Record<Color, Position[]> = {
  green: [{ x: 5, y: 1 }, { x: 10, y: 1 }, { x: 5, y: 3 }, { x: 10, y: 3 }],
  yellow: [{ x: 15, y: 5 }, { x: 15, y: 10 }, { x: 13, y: 5 }, { x: 13, y: 10 }],
  red: [{ x: 5, y: 15 }, { x: 10, y: 15 }, { x: 5, y: 13 }, { x: 10, y: 13 }],
  blue: [{ x: 1, y: 5 }, { x: 1, y: 10 }, { x: 3, y: 5 }, { x: 3, y: 10 }]
};

export const GOAL_LANES: Record<Color, Position[]> = {
  green: [7, 8, 9].map((x) => ({ x, y: 0 })),
  yellow: [7, 8, 9].map((y) => ({ x: 16, y })),
  red: [7, 8, 9].map((x) => ({ x, y: 16 })),
  blue: [7, 8, 9].map((y) => ({ x: 0, y }))
};

export const SCORE_TARGET = { "quick-2": 4, "strategic-2": 10, "classic-4": 6 } as const;
