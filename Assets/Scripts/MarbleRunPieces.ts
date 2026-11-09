/**
 * MarbleRunPieces — free-build bells and dominoes placed with the panel tools.
 *
 * Owns: placed pieces (bells on an arch stand, dynamic dominoes), their placement
 * ghost, Undo/Clear for pieces, and swinging the placed bells.
 * Inputs: none wired; Main calls init(mats) and the place* methods.
 * Must not: decide tools or keep score; bell rings surface through onBellRing.
 */
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {HERO} from "./MarbleRunHeroLayout"
import {Mats, addShadow, addVisual, bellMesh, makeNode, unitBox} from "./MarbleRunPrims"
import {MarbleRunBellUnit} from "./MarbleRunBellUnit"
import {MarbleRunDominoUnit} from "./MarbleRunDominoUnit"

export type PieceKind = "bell" | "domino"

const DOMINO_CLEARANCE_CM = 3 // closest two dominoes may stand (centre to centre)
const BELL_CLEARANCE_CM = 7 // closest anything may stand to a bell's arch

interface Piece {
  kind: PieceKind
  at: vec3 // play-area position on the table
  bell?: MarbleRunBellUnit
  domino?: MarbleRunDominoUnit
  shadow?: SceneObject
}

const DOMINO_COLORS = [
  new vec4(1.0, 0.25, 0.3, 1), new vec4(1.0, 0.85, 0.15, 1), new vec4(0.25, 0.9, 0.45, 1),
  new vec4(0.15, 0.8, 1.0, 1), new vec4(0.85, 0.35, 1.0, 1),
]

@component
export class MarbleRunPieces extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MarbleRunPieces – placed bells and dominoes</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Height of a placed bell's crossbar above the table (cm)")
  @widget(new SliderWidget(10, 30, 0.5))
  bellCrossbarHeightCm: number = 15
  @ui.group_end

  private mats!: Mats
  private pieces: Piece[] = []
  private ghostDomino!: SceneObject
  private ghostBell!: SceneObject
  private _onBellRing = new Event<number>()
  get onBellRing(): PublicApi<number> { return this._onBellRing.publicApi() }
  get count(): number { return this.pieces.length }

  init(mats: Mats): void {
    this.mats = mats
    const ghostMat = mats.unlit(new vec4(0.6, 0.95, 1.0, 0.45))
    this.ghostDomino = makeNode(this.sceneObject, "GhostDomino")
    addVisual(this.ghostDomino, "GhostVisual", unitBox(), ghostMat,
      new vec3(0, HERO.dominoHeight / 2, 0), new vec3(HERO.dominoWidth, HERO.dominoHeight, HERO.dominoThickness))
    this.ghostDomino.enabled = false
    this.ghostBell = makeNode(this.sceneObject, "GhostBell")
    addVisual(this.ghostBell, "GhostVisual", bellMesh(), ghostMat, new vec3(0, this.bellCrossbarHeightCm - 1.5, 0), vec3.one())
    this.ghostBell.enabled = false
  }

  /** Show the placement ghost at a table position, or hide it. */
  setGhost(kind: PieceKind | null, localPos: vec3 | null, yaw: number): void {
    this.ghostDomino.enabled = kind === "domino" && localPos !== null
    this.ghostBell.enabled = kind === "bell" && localPos !== null
    if (!kind || !localPos) return
    const so = kind === "domino" ? this.ghostDomino : this.ghostBell
    so.getTransform().setLocalPosition(new vec3(localPos.x, 0, localPos.z))
    so.getTransform().setLocalRotation(quat.angleAxis(yaw, vec3.up()))
  }

  /** Place a bell on a small arch stand standing on the table. */
  placeBell(localPos: vec3, yaw: number): void {
    const rot = quat.angleAxis(yaw, vec3.up())
    const right = rot.multiplyVec3(vec3.right())
    const unit = new MarbleRunBellUnit(this.sceneObject, this.mats, {
      base: new vec3(localPos.x, 0, localPos.z),
      rightDir: right,
      crossbarY: this.bellCrossbarHeightCm,
      postOffset: 4,
      triggerCenter: new vec3(localPos.x, 6, localPos.z),
      triggerSize: new vec3(9, 12, 7),
      withShadows: true,
    })
    unit.onRing = (s: number) => this._onBellRing.invoke(s)
    this.pieces.push({kind: "bell", at: localPos, bell: unit})
  }

  /** False when a new piece at `local` would overlap one already placed. */
  isSpotFree(local: vec3, kind: PieceKind): boolean {
    for (const p of this.pieces) {
      const min = kind === "bell" || p.kind === "bell" ? BELL_CLEARANCE_CM : DOMINO_CLEARANCE_CM
      const dx = p.at.x - local.x
      const dz = p.at.z - local.z
      if (dx * dx + dz * dz < min * min) return false
    }
    return true
  }

  /** Place a domino standing on the table, its broad face toward `yaw`. */
  placeDomino(localPos: vec3, yaw: number): void {
    const rot = quat.angleAxis(yaw, vec3.up())
    const size = {width: HERO.dominoWidth, height: HERO.dominoHeight, thickness: HERO.dominoThickness}
    const color = DOMINO_COLORS[this.pieces.length % DOMINO_COLORS.length]
    const unit = new MarbleRunDominoUnit(this.sceneObject, this.mats, size, color,
      new vec3(localPos.x, HERO.dominoHeight / 2 + 0.05, localPos.z), rot)
    unit.setDynamic(true)
    const shadow = addShadow(this.sceneObject, this.mats, localPos.x, localPos.z, 3.4).getSceneObject()
    this.pieces.push({kind: "domino", at: localPos, domino: unit, shadow})
  }

  /** Remove the most recently placed piece. Returns false when there are none. */
  undoLast(): boolean {
    const p = this.pieces.pop()
    if (!p) return false
    this.remove(p)
    return true
  }

  clearAll(): number {
    const n = this.pieces.length
    while (this.undoLast()) { /* pop all */ }
    return n
  }

  /** Dominoes are dynamic bodies: park them again if the floor moved. */
  reparkDominoes(): void {
    for (const p of this.pieces) {
      if (p.domino) { p.domino.beginReset(); p.domino.applyResetPose(1); p.domino.setDynamic(true) }
    }
  }

  update(dt: number): void {
    for (const p of this.pieces) if (p.bell) p.bell.update(dt)
  }

  private remove(p: Piece): void {
    if (p.bell) p.bell.destroy()
    if (p.domino) p.domino.destroy()
    if (p.shadow) p.shadow.destroy()
  }
}
