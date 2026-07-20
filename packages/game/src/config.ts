import type { Color, PlayerColor, Position } from "./types.js";

export const COLOR_ORDER: Color[] = ["green", "yellow", "red", "blue"];
export const COLOR_HEX: Record<Color, string> = {
  green: "#18a999", yellow: "#f6a623", red: "#ef5b5b", blue: "#3977d3"
};
export const PLAYER_COLOR_ORDER: PlayerColor[] = ["arctic-teal", "sunburst", "coral-red", "cobalt-blue", "aurora-purple", "berry-pink", "lime-green"];
export const PLAYER_COLOR_HEX: Record<PlayerColor, string> = {
  "arctic-teal": "#159D98",
  sunburst: "#F2A51B",
  "coral-red": "#E84C5B",
  "cobalt-blue": "#3568D4",
  "aurora-purple": "#784BC2",
  "berry-pink": "#D84B98",
  "lime-green": "#72B62B"
};
export const PLAYER_COLOR_LABEL: Record<PlayerColor, string> = {
  "arctic-teal": "Arctic",
  sunburst: "Sunburst",
  "coral-red": "Coral",
  "cobalt-blue": "Cobalt",
  "aurora-purple": "Aurora",
  "berry-pink": "Berry",
  "lime-green": "Lime"
};

const long = [1, 3, 5, 8, 10, 12];
export const STARTING_POSITIONS: Record<Color, Position[]> = {
  green: long.map((x) => ({ x, y: 0 })),
  yellow: long.map((y) => ({ x: 13, y })),
  red: long.map((x) => ({ x, y: 13 })),
  blue: long.map((y) => ({ x: 0, y }))
};

export const HAY_POSITIONS: Record<Color, Position[]> = {
  green: [{ x: 5, y: 1 }, { x: 8, y: 1 }, { x: 5, y: 10 }, { x: 8, y: 10 }],
  yellow: [{ x: 12, y: 5 }, { x: 12, y: 8 }, { x: 3, y: 5 }, { x: 3, y: 8 }],
  red: [{ x: 5, y: 12 }, { x: 8, y: 12 }, { x: 5, y: 3 }, { x: 8, y: 3 }],
  blue: [{ x: 1, y: 5 }, { x: 1, y: 8 }, { x: 10, y: 5 }, { x: 10, y: 8 }]
};

export const GOAL_LANES: Record<Color, Position[]> = {
  green: [6, 7].map((x) => ({ x, y: 13 })),
  yellow: [6, 7].map((y) => ({ x: 0, y })),
  red: [6, 7].map((x) => ({ x, y: 0 })),
  blue: [6, 7].map((y) => ({ x: 13, y }))
};

export const GOAL_GUARD_BOUNDARIES = [6, 8] as const;

export const FENCE_POSITIONS: Position[] = [
  { x: 6, y: 6 }, { x: 7, y: 6 }, { x: 6, y: 7 }, { x: 7, y: 7 }
];

export const SCORE_TARGET = { "quick-2": 4, "strategic-2": 10, "classic-4": 6 } as const;
