import type { Color, Direction } from "@slidescape/game";

const rotation: Record<Direction, number> = { up: 0, right: 90, down: 180, left: -90 };

export function nearestFacingRotation(current: number, facing: Direction) {
  const target = rotation[facing];
  const delta = ((target - current + 540) % 360) - 180;
  return current + delta;
}

export function PenguinGlyph({ color, facing = "up", selected = false }: { color: string; facing?: Direction; selected?: boolean }) {
  return (
  <g className="piece penguin-piece">
    {selected ? (
      <circle
        cx=".5"
        cy=".5"
        r=".45"
        fill="none"
        stroke="#ff7145"
        strokeWidth=".09"
      />
    ) : null}

    <g
      className="piece-facing"
      style={{ transform: `rotate(${rotation[facing]}deg)` }}
    >
      {/* Body */}
      <circle
        cx=".5"
        cy=".51"
        r=".355"
        fill="#071a33"
        stroke="#05264b"
        strokeWidth=".055"
      />

      {/* Face */}
      <ellipse cx=".5" cy=".39" rx=".245" ry=".205" fill="#fbfeff" />

      {/* Eyes */}
      <circle cx=".415" cy=".36" r=".045" fill="#071a33" />
      <circle cx=".585" cy=".36" r=".045" fill="#071a33" />

      {/* Beak */}
      <path
        d="M.43 .27L.5 .17l.07 .1-.07 .065z"
        fill="#ff743d"
        stroke="#d64a22"
        strokeWidth=".018"
        strokeLinejoin="round"
      />

      {/* Scarf tail */}
      <path
        d="
          M.72 .595
          C.775 .625 .82 .715 .83 .81
          L.775 .78
          L.73 .825
          C.73 .755 .7 .685 .655 .645
          Z
        "
        fill={color}
        stroke="#05264b"
        strokeOpacity=".4"
        strokeWidth=".018"
        strokeLinejoin="round"
      />

      {/* Edge-to-edge wrapped scarf */}
      <path
        d="
          M.145 .52
          C.235 .558 .36 .575 .5 .575
          C.64 .575 .765 .558 .855 .52
          C.853 .57 .842 .62 .82 .655
          C.735 .695 .62 .715 .5 .715
          C.38 .715 .265 .695 .18 .655
          C.158 .62 .147 .57 .145 .52
          Z
        "
        fill={color}
        stroke="#05264b"
        strokeOpacity=".45"
        strokeWidth=".018"
        strokeLinejoin="round"
      />

      {/* Wrapped side shadows */}
      <path
        d="
          M.145 .52
          C.175 .535 .215 .55 .26 .562
          L.245 .685
          C.22 .677 .198 .667 .18 .655
          C.158 .62 .147 .57 .145 .52
          Z
        "
        fill="#071a33"
        fillOpacity=".2"
      />

      <path
        d="
          M.855 .52
          C.825 .535 .785 .55 .74 .562
          L.755 .685
          C.78 .677 .802 .667 .82 .655
          C.842 .62 .853 .57 .855 .52
          Z
        "
        fill="#071a33"
        fillOpacity=".2"
      />

      {/* Front-facing scarf highlight */}
      <path
        d="
          M.26 .562
          C.34 .58 .43 .587 .5 .587
          C.57 .587 .66 .58 .74 .562
          L.755 .685
          C.68 .705 .59 .715 .5 .715
          C.41 .715 .32 .705 .245 .685
          Z
        "
        fill="#fff"
        fillOpacity=".12"
      />

      {/* Scarf fold */}
      <path
        d="
          M.17 .535
          C.27 .57 .375 .585 .5 .585
          C.625 .585 .73 .57 .83 .535
        "
        fill="none"
        stroke="#fff"
        strokeOpacity=".28"
        strokeWidth=".016"
        strokeLinecap="round"
      />

      {/* Knot */}
      <path
        d="
          M.705 .57
          C.745 .545 .795 .57 .808 .612
          C.81 .655 .77 .685 .725 .67
          C.685 .655 .675 .6 .705 .57
          Z
        "
        fill={color}
        stroke="#05264b"
        strokeOpacity=".5"
        strokeWidth=".018"
        strokeLinejoin="round"
      />

      <path
        d="M.71 .585C.735 .572 .77 .59 .785 .615"
        fill="none"
        stroke="#fff"
        strokeOpacity=".3"
        strokeWidth=".014"
        strokeLinecap="round"
      />

      {/* Feet */}
      <ellipse cx=".37" cy=".79" rx=".105" ry=".04" fill="#f7a42b" />
      <ellipse cx=".63" cy=".79" rx=".105" ry=".04" fill="#f7a42b" />
    </g>
  </g>);
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

export function WalrusGlyph({ facing = "down", rotationDegrees }: { facing?: Direction; rotationDegrees?: number }) {
  return <g className="piece piece-facing walrus-piece" style={{ transform: `rotate(${rotationDegrees ?? rotation[facing]}deg)` }}>
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
