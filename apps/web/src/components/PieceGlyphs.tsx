import type { Color, Direction } from "@slidescape/game";

const rotation: Record<Direction, number> = { up: 0, right: 90, down: 180, left: -90 };

export function PenguinGlyph({ color, facing = "up", selected = false }: { color: string; facing?: Direction; selected?: boolean }) {
  return <g className="piece penguin-piece">
    {selected ? <circle cx=".5" cy=".5" r=".45" fill="none" stroke="#ff7145" strokeWidth=".09"/> : null}
    <g className="piece-facing" style={{ transform: `rotate(${rotation[facing]}deg)` }}>
      <circle cx=".5" cy=".51" r=".355" fill="#071a33" stroke="#05264b" strokeWidth=".055"/>
      <ellipse cx=".5" cy=".39" rx=".245" ry=".205" fill="#fbfeff"/>
      <circle cx=".415" cy=".36" r=".045" fill="#071a33"/><circle cx=".585" cy=".36" r=".045" fill="#071a33"/>
      <path d="M.43 .27L.5 .17l.07 .1-.07 .065z" fill="#ff743d" stroke="#d64a22" strokeWidth=".018"/>
      <path d="M.215 .56c.16.07.41.07.57 0v.13c-.18.075-.39.075-.57 0z" fill={color}/>
      <path d="M.67 .63l.13 .18-.11 .025-.11-.17z" fill={color}/>
      <ellipse cx=".37" cy=".79" rx=".105" ry=".04" fill="#f7a42b"/><ellipse cx=".63" cy=".79" rx=".105" ry=".04" fill="#f7a42b"/>
    </g>
  </g>;
}

export function IceBlockGlyph({ color }: { color: string }) {
  return <g className="piece ice-block-piece">
    <path d="M.15 .31L.36 .13h.43l.09 .18-.18 .19H.28z" fill="#effcff" stroke="#185782" strokeWidth=".045"/>
    <path d="M.15 .31l.13 .19v.34L.15 .7z" fill="#8ed8f2" stroke="#185782" strokeWidth=".045"/>
    <path d="M.28 .5h.42l.18-.19v.4L.7 .87H.28z" fill="#bcecff" stroke="#185782" strokeWidth=".045"/>
    <path d="M.36 .2h.31l.09 .09-.13 .12H.3z" fill="#fff" opacity=".8"/>
    <path d="M.3 .76h.37" stroke={color} strokeWidth=".075" strokeLinecap="round"/>
  </g>;
}

export function WalrusGlyph({ facing = "down" }: { facing?: Direction }) {
  return <g className="piece piece-facing walrus-piece" style={{ transform: `rotate(${rotation[facing]}deg)` }}>
    <circle cx=".5" cy=".51" r=".35" fill="#9aabba" stroke="#0b315d" strokeWidth=".06"/>
    <ellipse cx=".5" cy=".36" rx=".24" ry=".18" fill="#c5d0d8"/>
    <circle cx=".415" cy=".34" r=".035" fill="#071a33"/><circle cx=".585" cy=".34" r=".035" fill="#071a33"/>
    <ellipse cx=".5" cy=".44" rx=".12" ry=".075" fill="#718596"/>
    <path d="M.43 .47l.025 .2.055-.18M.57 .47l-.025 .2-.055-.18" fill="#fff" stroke="#0b315d" strokeWidth=".022"/>
    <path d="M.38 .43l-.19-.045M.38 .48l-.2 .04M.62 .43l.19-.045M.62 .48l.2 .04" stroke="#0b315d" strokeWidth=".022"/>
  </g>;
}

export function PoopGlyph() {
  return <g className="piece poop-piece">
    <circle cx=".5" cy=".5" r=".3" fill="#8b572a" stroke="#3b2618" strokeWidth=".065"/>
    <path d="M.34 .52c.03-.23.35-.22.32-.01-.02.14-.24.16-.24.02 0-.09.15-.11.17-.03" fill="none" stroke="#2d2118" strokeWidth=".055" strokeLinecap="round"/>
  </g>;
}

export function startingFacing(color?: Color): Direction {
  return color === "green" ? "down" : color === "yellow" ? "left" : color === "red" ? "up" : "right";
}
