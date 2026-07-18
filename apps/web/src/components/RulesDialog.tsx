import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp, Fish, Footprints, Goal, Snowflake, X } from "lucide-react";

const sections = [
  ["rules-goal", "Goal"],
  ["rules-turns", "Turns & movement"],
  ["rules-walrus", "Walrus & poop"],
  ["rules-fish", "Fish cards"],
  ["rules-clarifications", "Clarifications"]
] as const;

export function RulesButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const dialog = open ? createPortal(<div className="rules-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="rules-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="rules-header"><div><Snowflake/><h2 id={titleId}>How to play Slidescape</h2></div><button aria-label="Close rules" onClick={() => setOpen(false)}><X/></button></header>
        <nav className="rules-nav" aria-label="Rule sections">{sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
        <div className="rules-content">
          <section id="rules-goal" className="rules-section">
            <div className="rules-section-title"><Goal/><div><h3>Goal and setup</h3><p>Build lanes across the ice and slide your penguins through their matching exit.</p></div></div>
            <div className="rules-grid">
              <div><h4>Winning targets</h4><ul><li><strong>Quick 2-player:</strong> one opposite flock each; first to escape four penguins.</li><li><strong>Strategic 2-player:</strong> two adjacent flocks each; first to escape ten penguins.</li><li><strong>4-player:</strong> one flock each; first to escape all six penguins.</li></ul></div>
              <div><h4>Starting the game</h4><p>Each active color begins with six penguins and four ice blocks on its marked spaces. The walrus begins inside the center ice ring. Turns travel clockwise from the starting player.</p><p>An escaped penguin enters your off-board refuge and counts toward your score.</p></div>
            </div>
          </section>

          <section id="rules-turns" className="rules-section">
            <div className="rules-section-title"><Footprints/><div><h3>Turns and movement</h3><p>Roll, then spend the complete move budget whenever legal moves remain.</p></div></div>
            <div className="rules-grid">
              <div><h4>Penguins slide</h4><p>A penguin travels only up, down, left, or right. It keeps sliding until the square immediately before a penguin, ice block, walrus, active center ring, board edge, or closed side of an exit. Any distance in one direction costs one move.</p><p>You control only your own penguins, and each color may leave only through its own exit.</p></div>
              <div><h4>Ice blocks and walrus steps</h4><p>An ice block moves exactly one open square orthogonally per move. You may move only your own ice blocks. After the center ring is removed, any player may move the walrus one open square in the same way.</p><p>You may split a roll among eligible pieces in any order, or move the same piece repeatedly. If no legal move exists, the turn can end early.</p></div>
            </div>
            <div className="rule-callout"><strong>Blocking limit:</strong> A move is illegal if it leaves an active flock with no possible route to its own exit. A temporary seal is allowed when that player can eventually reopen it using one of their pieces or the walrus.</div>
          </section>

          <section id="rules-walrus" className="rules-section">
            <div className="rules-section-title"><Snowflake/><div><h3>Walrus and poop</h3><p>The neutral walrus reshapes the board—and can leave a nasty surprise.</p></div></div>
            <div className="rules-grid">
              <div><h4>Natural roll of one</h4><p>Use the one as a normal move, or relocate the walrus to any open square. Relocating removes the center ring for the rest of the match. Leaving poop beneath the walrus is optional.</p><p>If all eight poop tokens are already out and you choose to poop, select one existing token and recycle it beneath the walrus.</p></div>
              <div><h4>Crossing poop</h4><p>Poop never blocks movement. When a penguin or ice block crosses or enters a poop square, remove that token and queue one Poop card. Cross several tokens and you queue a card for each one, in crossing order.</p><p>Resolve every queued card after the turn. Returned cards immediately rejoin and reshuffle into their deck.</p></div>
            </div>
            <h4>Poop deck — 9 cards</h4>
            <ul className="card-rule-list"><li><b>2×</b> Miss your next scheduled turn.</li><li><b>2×</b> Return one escaped penguin to an open original starting space.</li><li><b>2×</b> Your next turn is exactly two moves and cannot be exchanged for a Fish card.</li><li><b>2×</b> Before the next player rolls, they make one legal move with one of your penguins or ice blocks.</li><li><b>1×</b> Return your held Fish card to its deck.</li></ul>
          </section>

          <section id="rules-fish" className="rules-section">
            <div className="rules-section-title"><Fish/><div><h3>Fish cards</h3><p>A natural roll of two may be exchanged for one card instead of movement.</p></div></div>
            <p>You may hold only one Fish card. A newly drawn card waits until a later turn, and cards are played only during your own turn. Playing a held card before exchanging an untouched natural two is allowed; once the held card returns to the deck, you may take the new one. A forced two-move Poop turn cannot draw a card, but a Fish card already in hand may still be used.</p>
            <h4>Fish deck — 9 cards</h4>
            <ul className="card-rule-list"><li><b>2× Flyover:</b> During one penguin slide, pass over the first penguin, ice block, or unfenced walrus. It still costs one move.</li><li><b>2× Choice:</b> Prepare protection from one Poop consequence, or add two moves to a roll.</li><li><b>2× Relocate and reroll:</b> After completing a roll, move one poop to any open square, then roll again. The reroll still happens when no poop is present.</li><li><b>1× Trade or boost:</b> Return this card, then take an opponent’s held Fish card or add two moves.</li><li><b>1× Rival move:</b> Make one legal move with an opponent’s penguin or ice block.</li><li><b>1× Double:</b> Double one roll of your choice.</li></ul>
          </section>

          <section id="rules-clarifications" className="rules-section">
            <div className="rules-section-title"><CircleHelp/><div><h3>Important clarifications</h3><p>These edge cases are part of the rules, not optional variants.</p></div></div>
            <div className="clarification-list">
              <p><strong>Doubling a one:</strong> It becomes two moves. Either or both may be used to relocate the walrus, and each relocation may leave poop.</p>
              <p><strong>The fenced walrus:</strong> A Flyover cannot cross it while the center ring remains. After the ring is removed, Flyover may cross the walrus.</p>
              <p><strong>Winning through poop:</strong> Crossing poop on a would-be winning slide still queues every card. The win is checked only after all consequences resolve; a returned penguin keeps the match going.</p>
              <p><strong>Skipped turns:</strong> A skip consumes the affected scheduled turn along with other “next turn” effects attached to it.</p>
              <p><strong>No available return:</strong> A return-penguin card does nothing when no penguin has escaped or every original starting space is occupied.</p>
              <p><strong>Match end:</strong> Slidescape ends as soon as one winner survives end-of-turn Poop resolution. There is no second-place continuation.</p>
            </div>
          </section>
        </div>
      </section>
    </div>, document.body) : null;

  return <>
    <button className={`rules-button ${className}`.trim()} aria-label="Open game rules" onClick={() => setOpen(true)}><CircleHelp/></button>
    {dialog}
  </>;
}
