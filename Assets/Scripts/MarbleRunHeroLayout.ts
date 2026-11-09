/**
 * MarbleRunHeroLayout — every dimension of the ready-made hero contraption.
 *
 * Owns: pure numbers and derived positions, in PlayArea-local centimetres
 * (table top at y = 0, the user stands toward +Z). No scene access.
 * Must not: create scene objects or keep state.
 */
export const HERO = {
  marbleRadius: 1.75,

  // Channel cross-section (the arc centre sits on the path, floor = path - radius).
  channelRadius: 2.6,
  channelLip: 1.9,
  channelWall: 0.55,

  // Spiral tower at the back-left, descending; start point is under the funnel.
  towerX: -22,
  towerZ: -11,
  towerRadius: 8.5,
  towerTurns: 1.3,
  startY: 34,
  // Height of the channel centre where it delivers the marble to the first domino.
  // Floor there = endY - channelRadius = shelfTop + 3, so the marble strikes the
  // domino above its centre of mass and tips it instead of sliding it.
  endY: 18.6,

  shelfTop: 13,
  shelfThickness: 1.6,
  shelfWidth: 9.5,

  dominoCount: 7,
  dominoHeight: 8,
  dominoWidth: 4,
  dominoThickness: 1.4,
  dominoSpacing: 4.1,

  // Goal cup (base centre on the table) and the diagonal the row runs along toward it.
  cupX: 20,
  cupZ: 15,
  rowAngleDeg: 60, // measured from +X toward +Z

  // Bell straddles the channel on the run after the spiral.
  bellX: -8.5,
  bellZ: -20.3,
  bellCrossbarAbovePath: 11,
  bellPostOffset: 5.5,
} as const

/** Unit vector along the domino row (from the first domino toward the cup). */
export function rowDir(): vec3 {
  const a = (HERO.rowAngleDeg * Math.PI) / 180
  return new vec3(Math.cos(a), 0, Math.sin(a))
}

function alongRow(distanceBeforeCup: number, y: number): vec3 {
  const d = rowDir()
  return new vec3(HERO.cupX - d.x * distanceBeforeCup, y, HERO.cupZ - d.z * distanceBeforeCup)
}

const LAST_DOMINO_DIST = 8.1
const WAIT_MARBLE_DIST = 4.2
const SHELF_END_DIST = 2.0
const CHUTE_END_GAP = 1.6

/** Distance from the cup centre to domino i (0 = first domino hit). */
function dominoDist(i: number): number {
  return LAST_DOMINO_DIST + (HERO.dominoCount - 1 - i) * HERO.dominoSpacing
}

/** Local centre of domino i. */
export function dominoCenter(i: number): vec3 {
  return alongRow(dominoDist(i), HERO.shelfTop + HERO.dominoHeight / 2)
}

/** Local position of the marble waiting at the shelf end. */
export function waitingMarblePos(): vec3 {
  return alongRow(WAIT_MARBLE_DIST, HERO.shelfTop + HERO.marbleRadius)
}

/** Cup base centre, local. */
export function cupBase(): vec3 {
  return new vec3(HERO.cupX, 0, HERO.cupZ)
}

/** Plank end over the cup and plank start under the chute mouth, on top of the shelf. */
export function shelfEnds(): {start: vec3; end: vec3} {
  const firstDominoDist = dominoDist(0)
  return {
    start: alongRow(firstDominoDist + 3, HERO.shelfTop),
    end: alongRow(SHELF_END_DIST, HERO.shelfTop),
  }
}

/** Control points of the hero channel, from the funnel to the first domino. */
export function heroControlPoints(): vec3[] {
  const xz: vec2[] = []
  const endAngleDeg = -90
  const startAngleDeg = endAngleDeg - 360 * HERO.towerTurns
  const steps = Math.ceil(Math.abs(endAngleDeg - startAngleDeg) / 30)
  for (let i = 0; i <= steps; i++) {
    const a = ((startAngleDeg + ((endAngleDeg - startAngleDeg) * i) / steps) * Math.PI) / 180
    xz.push(new vec2(HERO.towerX + HERO.towerRadius * Math.cos(a), HERO.towerZ + HERO.towerRadius * Math.sin(a)))
  }
  // Run along the back, under the bell, then a banked sweep onto the row's diagonal.
  const q = alongRow(dominoDist(0) + CHUTE_END_GAP, 0)
  const b = alongRow(dominoDist(0) + CHUTE_END_GAP + 2.5, 0)
  const r = 6.5
  const a2 = (HERO.rowAngleDeg * Math.PI) / 180
  const ux = b.x - r * Math.sin(a2)
  const uz = b.z + r * Math.cos(a2)
  const arc = [0, 20, 40].map((deg) => {
    const f = (deg * Math.PI) / 180
    return new vec2(ux + r * Math.sin(f), uz - r * Math.cos(f))
  })
  xz.push(new vec2(-15.5, -19.9))
  xz.push(new vec2(-8.5, -20.3))
  for (const p of arc) xz.push(p)
  xz.push(new vec2(b.x, b.z))
  xz.push(new vec2(q.x, q.z))

  // Assign heights by chord length for a uniform descent.
  const dist: number[] = [0]
  for (let i = 1; i < xz.length; i++) dist.push(dist[i - 1] + xz[i].distance(xz[i - 1]))
  const total = dist[dist.length - 1]
  const pts: vec3[] = []
  for (let i = 0; i < xz.length; i++) {
    const y = HERO.startY + ((HERO.endY - HERO.startY) * dist[i]) / total
    pts.push(new vec3(xz[i].x, y, xz[i].y))
  }
  return pts
}
