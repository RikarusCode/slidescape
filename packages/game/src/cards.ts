import type { CardDefinition, FishCardId, PoopCardId } from "./types.js";

export const FISH_CARDS: CardDefinition<FishCardId>[] = [
  {
    id: "flyover",
    deck: "fish",
    copies: 2,
    timing: "your turn",
    choices: [],
    targets: "next penguin move",
    text: "On one penguin slide, pass over the first penguin, ice block, or unfenced walrus in its path. The slide still costs one move."
  },
  {
    id: "avoid-or-two",
    deck: "fish",
    copies: 2,
    timing: "your turn",
    choices: ["Block one Poop effect", "Add two moves"],
    targets: "self",
    text: "Cancel one Poop consequence, or add two moves to your current roll."
  },
  {
    id: "relocate-and-roll",
    deck: "fish",
    copies: 2,
    timing: "after completing a roll",
    choices: [],
    targets: "one poop and one open square",
    text: "After using every move, relocate one poop to an open square and roll again. Roll again even when no poop is available."
  },
  {
    id: "steal-or-two",
    deck: "fish",
    copies: 1,
    timing: "your turn",
    choices: ["Take an opponent's Fish card", "Add two moves"],
    targets: "self or opponent",
    text: "Return this card, then take a held Fish card from an opponent or add two moves to your current roll."
  },
  {
    id: "move-opponent",
    deck: "fish",
    copies: 1,
    timing: "your turn",
    choices: [],
    targets: "opponent penguin or ice block",
    text: "Choose an opponent's penguin or ice block and make one legal move with it."
  },
  {
    id: "double-roll",
    deck: "fish",
    copies: 1,
    timing: "after a roll",
    choices: [],
    targets: "current roll",
    text: "Double the value of your current roll."
  }
];

export const POOP_CARDS: CardDefinition<PoopCardId>[] = [
  {
    id: "skip-turn",
    deck: "poop",
    copies: 2,
    timing: "end of turn",
    choices: [],
    targets: "self",
    text: "Sit out your next turn."
  },
  {
    id: "return-penguin",
    deck: "poop",
    copies: 2,
    timing: "end of turn",
    choices: [],
    targets: "one escaped penguin",
    text: "Return one escaped penguin to an open space from its original starting line."
  },
  {
    id: "two-move-turn",
    deck: "poop",
    copies: 2,
    timing: "next turn",
    choices: [],
    targets: "self",
    text: "Your next turn has exactly two moves. That turn cannot be traded for a Fish card."
  },
  {
    id: "opponent-moves",
    deck: "poop",
    copies: 2,
    timing: "before next player's roll",
    choices: [],
    targets: "your penguin or ice block",
    text: "Before rolling, the next player makes one legal move with one of your penguins or ice blocks."
  },
  {
    id: "discard-fish",
    deck: "poop",
    copies: 1,
    timing: "end of turn",
    choices: [],
    targets: "held Fish card",
    text: "Return your held Fish card to its deck."
  }
];

export const expandedFishDeck = (): FishCardId[] =>
  FISH_CARDS.flatMap((card) => Array(card.copies).fill(card.id));
export const expandedPoopDeck = (): PoopCardId[] =>
  POOP_CARDS.flatMap((card) => Array(card.copies).fill(card.id));
