import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp, Fish, Footprints, Goal, Snowflake, X } from "lucide-react";
import { COLOR_HEX } from "@slidescape/game";
import { IceBlockGlyph, PenguinGlyph, PoopGlyph, WalrusGlyph } from "./PieceGlyphs.js";
import { audio } from "../audio.js";

function RulesArtwork() {
  return (
    <div className="rules-artwork" aria-label="Slidescape game pieces">
      <figure>
        <svg viewBox="0 0 1 1">
          <PenguinGlyph color={COLOR_HEX.blue} facing="right" />
        </svg>
        <figcaption>Penguin</figcaption>
      </figure>
      <figure>
        <svg viewBox="0 0 1 1">
          <IceBlockGlyph color={COLOR_HEX.green} />
        </svg>
        <figcaption>Ice block</figcaption>
      </figure>
      <figure>
        <svg viewBox="0 0 1 1">
          <WalrusGlyph facing="up" />
        </svg>
        <figcaption>Walrus</figcaption>
      </figure>
      <figure>
        <svg viewBox="0 0 1 1">
          <PoopGlyph />
        </svg>
        <figcaption>Poop</figcaption>
      </figure>
      <figure className="fish-art">
        <span>
          <Fish />
        </span>
        <figcaption>Fish card</figcaption>
      </figure>
    </div>
  );
}

export function RulesButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const dialog = open
    ? createPortal(
        <div
          className="rules-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section className="rules-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <header className="rules-header">
              <div>
                <Snowflake />
                <h2 id={titleId}>How to play</h2>
              </div>
              <button aria-label="Close rules" onClick={() => setOpen(false)}>
                <X />
              </button>
            </header>
            <div className="rules-content">
              <RulesArtwork />
              <section id="rules-objective" className="rules-section rules-objective">
                <div className="rules-section-title">
                  <Goal />
                  <div>
                    <h3>Objective</h3>
                  </div>
                </div>
                <p>
                  Guide your penguins to safety! Strategically slide your penguins across the board while
                  preventing your opponent from reaching their goal. The first player to save the necessary
                  number of penguins wins the game.
                </p>
              </section>

              <section id="rules-turns" className="rules-section">
                <div className="rules-section-title">
                  <Footprints />
                  <div>
                    <h3>Setup and gameplay</h3>
                  </div>
                </div>
                <p>
                  The board is a 14×14 grid. The first player is chosen randomly, then turns continue
                  clockwise. Before each turn, the player rolls a six-sided die to determine how many moves
                  they recieve for that turn. You may split a roll among eligible pieces in any order, or move
                  the same piece repeatedly. If no legal move exists, the turn can end early.
                </p>
                <p>
                  When a penguin moves, it keeps sliding until it hits a solid object like another penguin or
                  an ice block, walrus, fence, board edge, or side of an exit. Any movement in one direction
                  costs one move.
                </p>
                <p>
                  Unlike penguins, an ice block or walrus (once freed) moves exactly one square per move. You
                  control only your own ice blocks and penguins, but the walrus is neutral and shared.
                </p>
                <div className="rule-callout">
                  A move is illegal if it leaves an active flock with no possible route to its own exit. A
                  temporary block is allowed if the affected player can eventually reopen it using one of
                  their pieces or the walrus.
                </div>
              </section>

              <section id="rules-walrus" className="rules-section">
                <div className="rules-section-title">
                  <Snowflake />
                  <div>
                    <h3>Walrus and poop</h3>
                  </div>
                </div>
                <div className="rules-grid">
                  <div>
                    <h4>Roll of one</h4>
                    <p>
                      On a roll of one, choose either a normal move or relocate the walrus to any open square,
                      optionally leaving poop underneath it. Before the first relocation, the walrus is locked
                      inside its center fence and cannot be moved. If all eight poop tokens are already out
                      and you choose to poop, select one existing token and recycle it beneath the walrus.
                    </p>
                  </div>
                  <div>
                    <h4>Crossing poop</h4>
                    <p>
                      Poop never blocks movement. When a penguin or ice block crosses or enters a poop square,
                      remove that token and queue one Poop card. Crossing several tokens means you queue a
                      card for each one.
                    </p>
                    <p>
                      Resolve every queued card after the turn. Returned cards immediately rejoin and
                      reshuffle into their deck. All poop cards are bad. Nobody likes poop.
                    </p>
                  </div>
                </div>
              </section>

              <section id="rules-fish" className="rules-section">
                <div className="rules-section-title">
                  <Fish />
                  <div>
                    <h3>Fish cards</h3>
                  </div>
                </div>
                <p>
                  When a two is rolled, you may opt to take a fish card rather than your two moves. You may
                  hold only one Fish card at a time. Cards are played only during your own turn, and may not
                  be played on the turn that they are recieved. All fish cards are helpful, so use them
                  wisely.
                </p>
              </section>

              <section id="rules-clarifications" className="rules-section">
                <div className="rules-section-title">
                  <CircleHelp />
                  <div>
                    <h3>Clarification</h3>
                  </div>
                </div>
                <div className="clarification-list">
                  <p>
                    <strong>Using a fish card to double a roll </strong>makes it two seperate moves. For
                    natural rolls of 1, either or both may be used to relocate the walrus, and each relocation
                    may leave poop.
                  </p>
                  <p>
                    <strong>Crossing poop </strong>on a would-be winning slide still queues every card. The
                    win is valid only after all consequences resolve.
                  </p>
                  <p>
                    <strong>A skipped turn </strong>consumes the affected turn along with other “next turn”
                    effects attached to it.
                  </p>
                  <p>
                    <strong>A return-penguin card </strong>does nothing when no penguin has escaped or every
                    starting space is occupied.
                  </p>
                </div>
              </section>

              <footer className="rules-attribution">
                Enjoy Slidescape? Check out the original{" "}
                <a href="https://www.chickapig.com/chickapig" target="_blank" rel="noreferrer">
                  Chickapig board game
                </a>
                . Slidescape is an independent fan-made project and is not affiliated with, sponsored by, or
                endorsed by Chickapig or its creators. Check out the open source code on{" "}
                <a href="https://github.com/RikarusCode/slidescape" target="_blank" rel="noreferrer">
                  GitHub
                </a>
                .
              </footer>
            </div>
          </section>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <button
        className={`rules-button ${className}`.trim()}
        aria-label="Open game rules"
        onClick={() => {
          audio.play("ui");
          setOpen(true);
        }}
      >
        <svg className="rule-question-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8.7 8.2a3.45 3.45 0 1 1 5.65 2.65C12.8 12 12 12.7 12 14.2" />
          <circle cx="12" cy="18.2" r="1.2" />
        </svg>
      </button>
      {dialog}
    </>
  );
}
