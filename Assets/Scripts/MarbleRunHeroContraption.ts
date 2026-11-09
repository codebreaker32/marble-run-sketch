/**
 * MarbleRunHeroContraption — the ready-made chain reaction on the table.
 *
 * Owns: building (and destroying) every piece: the banked channel with funnel and
 * supports, the bell arch, the wooden domino shelf, the domino row and the waiting
 * marble, plus the animated reset. All geometry comes from MarbleRunHeroLayout.
 * Coordinates are PlayArea-local (this node sits at identity under PlayArea).
 *
 * Inputs: none wired; built by Main once the surface is known.
 * Must not: track chain progress, score or play sounds (MarbleRunHeroChain does).
 */
import {tagCollider, untagCollider} from "./MarbleRunColliderTags"
import {HERO, dominoCenter, heroControlPoints, rowDir, shelfEnds, waitingMarblePos} from "./MarbleRunHeroLayout"
import {COLLAR_COLOR, Mats, PIPE_COLOR, addBox, addChannelCollars, addCylinderBetween, addShadow, addSphere, addVisual, funnelMesh, makeCatsEye, makeNode} from "./MarbleRunPrims"
import {PathFrame, TrackProfile, buildChannelMesh, catmullRomPath, computeFrames, polylineLength} from "./MarbleRunTrackGeometry"
import {MarbleRunBellUnit} from "./MarbleRunBellUnit"
import {MarbleRunDominoUnit} from "./MarbleRunDominoUnit"

const TRACK_MATTER = requireAsset("../Physics/TrackMatter.matter") as Matter
const SHELF_MATTER = requireAsset("../Physics/WoodMatter.matter") as Matter

const WOOD = new vec4(0.72, 0.5, 0.28, 1)
const SHELF_WOOD = new vec4(0.8, 0.56, 0.3, 1)
const WAITING_COLOR = new vec4(0.06, 0.92, 0.3, 1)
const DOMINO_COLORS = [
  new vec4(1.0, 0.25, 0.3, 1), new vec4(1.0, 0.55, 0.12, 1), new vec4(1.0, 0.85, 0.15, 1),
  new vec4(0.25, 0.9, 0.45, 1), new vec4(0.15, 0.8, 1.0, 1), new vec4(0.35, 0.45, 1.0, 1),
  new vec4(0.85, 0.35, 1.0, 1), new vec4(1.0, 0.45, 0.75, 1),
]

@component
export class MarbleRunHeroContraption extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MarbleRunHeroContraption – hero track, bell, shelf, dominoes</span>')

  private mats!: Mats
  private built: SceneObject | null = null
  private trackCollider: ColliderComponent | null = null
  private _dominoes: MarbleRunDominoUnit[] = []
  private _bell: MarbleRunBellUnit | null = null
  private waiting: {so: SceneObject; visual: SceneObject; body: BodyComponent; scale: vec3} | null = null
  private resetT = -1
  private resetDone: (() => void) | null = null
  private releaseKickFrames = 0

  get exists(): boolean { return this.built !== null }
  get dominoes(): MarbleRunDominoUnit[] { return this._dominoes }
  get bell(): MarbleRunBellUnit { return this._bell as MarbleRunBellUnit }

  /** World position above the channel start, where a dropped marble is spawned. */
  get spawnWorldPos(): vec3 {
    return this.sceneObject.getTransform().getWorldTransform().multiplyPoint(this.spawnLocal)
  }
  private spawnLocal = new vec3(0, HERO.startY, 0)

  /** The waiting marble's body, for release and overlap checks. */
  get waitingBody(): BodyComponent | null { return this.waiting ? this.waiting.body : null }

  build(mats: Mats): void {
    if (this.built) return
    this.mats = mats
    const root = makeNode(this.sceneObject, "Built")
    this.built = root
    this.buildChannel(root)
    this.buildShelf(root)
    this.buildDominoes(root)
    this.buildWaitingMarble(root)
    this.armWaitingMarble()
  }

  destroyAll(): void {
    if (!this.built) return
    if (this.trackCollider) untagCollider(this.trackCollider)
    for (const d of this._dominoes) d.destroy()
    this._dominoes = []
    if (this._bell) this._bell.destroy()
    this._bell = null
    this.waiting = null
    this.built.destroy()
    this.built = null
    this.resetT = -1
  }

  /** Move every domino to dynamic so the chain can run. */
  armForRun(): void {
    for (const d of this._dominoes) {
      d.fallenReported = false
      d.setDynamic(true)
    }
    this.armWaitingMarble()
  }

  /** Kinematic waiting marble back on its perch, full size. */
  armWaitingMarble(): void {
    if (!this.waiting) return
    this.waiting.body.dynamic = false
    this.waiting.body.velocity = vec3.zero()
    this.waiting.so.enabled = true
    const t = this.waiting.so.getTransform()
    t.setLocalPosition(waitingMarblePos())
    t.setLocalRotation(quat.quatIdentity())
    this.waiting.visual.getTransform().setLocalScale(this.waiting.scale)
  }

  /** Let the waiting marble go, rolling it off the shelf end toward the cup. */
  releaseWaitingMarble(): void {
    if (!this.waiting) return
    this.waiting.body.dynamic = true
    // The velocity must land after the body has become dynamic (next update).
    this.releaseKickFrames = 3
  }

  /** Hide the waiting marble after it scores and return its state, so a pool marble can carry on in its place. */
  takeWaitingMarble(): {position: vec3; rotation: quat; velocity: vec3; angularVelocity: vec3; color: vec4} | null {
    if (!this.waiting) return null
    const t = this.waiting.so.getTransform()
    const state = {
      position: t.getWorldPosition(),
      rotation: t.getWorldRotation(),
      velocity: this.waiting.body.velocity,
      angularVelocity: this.waiting.body.angularVelocity,
      color: WAITING_COLOR,
    }
    this.waiting.so.enabled = false
    return state
  }

  /** Hide the waiting marble (after it scored or missed) until the reset brings it back. */
  hideWaitingMarble(): void {
    if (this.waiting) this.waiting.so.enabled = false
  }

  /** Drive the shrink of the waiting marble; f goes 1 -> 0. */
  setWaitingScale(f: number): void {
    if (this.waiting) this.waiting.visual.getTransform().setLocalScale(this.waiting.scale.uniformScale(Math.max(0.001, f)))
  }

  /** Animate all dominoes upright; `done` fires when they are home and parked. */
  beginReset(done: () => void): void {
    for (const d of this._dominoes) d.beginReset()
    this.resetDone = done
    this.resetT = 0
  }

  /** Instantly park everything at home (used on abort and floor moves). */
  parkNow(): void {
    this.resetT = -1
    this.resetDone = null
    for (const d of this._dominoes) { d.beginReset(); d.applyResetPose(1) }
    this.armWaitingMarble()
  }

  update(dt: number): void {
    if (this.releaseKickFrames > 0 && this.waiting) {
      this.releaseKickFrames--
      if (this.releaseKickFrames === 1) this.waiting.body.addForce(rowDir().uniformScale(38), Physics.ForceMode.VelocityChange)
    }
    if (this._bell) this._bell.update(dt)
    if (this.resetT < 0) return
    this.resetT += dt
    const dur = 0.7
    const f = Math.min(1, this.resetT / dur)
    for (let i = 0; i < this._dominoes.length; i++) {
      const stagger = Math.max(0, Math.min(1, (f * dur - i * 0.03) / (dur - 0.21)))
      this._dominoes[i].applyResetPose(stagger)
    }
    if (f >= 1) {
      this.resetT = -1
      const cb = this.resetDone
      this.resetDone = null
      if (cb) cb()
    }
  }

  private profile(arcSegments: number): TrackProfile {
    return {innerRadiusCm: HERO.channelRadius, lipHeightCm: HERO.channelLip, wallThicknessCm: HERO.channelWall, arcSegments}
  }

  private buildChannel(root: SceneObject): void {
    const path = catmullRomPath(heroControlPoints(), 0.8)
    const frames = computeFrames(path, 110, 20)
    // The marble is spawned over the channel start, inside the funnel.
    const start = path[0]
    const dropAt = path[3]
    this.spawnLocal = new vec3(dropAt.x, dropAt.y + 5.5, dropAt.z)

    const mesh = buildChannelMesh(frames, this.profile(14), true)
    const channelSo = makeNode(root, "Channel")
    const rmv = channelSo.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = mesh
    rmv.mainMaterial = this.mats.plastic(PIPE_COLOR)
    addChannelCollars(root, frames, this.profile(14), this.mats)

    // Collider from the same frames: inner surface + lips, at coarser ring spacing.
    const coarse: PathFrame[] = []
    for (let i = 0; i < frames.length; i += 2) coarse.push(frames[i])
    if (coarse[coarse.length - 1] !== frames[frames.length - 1]) coarse.push(frames[frames.length - 1])
    const colMesh = buildChannelMesh(coarse, this.profile(10), true, true)
    const col = channelSo.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createMeshShape()
    shape.mesh = colMesh
    col.shape = shape
    col.matter = TRACK_MATTER
    tagCollider(col, "track")
    this.trackCollider = col

    print("[MarbleRun] hero channel: " + path.length + " rings, length " + polylineLength(path).toFixed(1) + " cm")

    addVisual(root, "Funnel", funnelMesh(), this.mats.plastic(COLLAR_COLOR),
      new vec3(start.x, start.y + HERO.channelLip + 0.2, start.z), vec3.one())

    this.buildSupports(root, frames)
    this.buildBell(root, frames)
  }

  private buildSupports(root: SceneObject, frames: PathFrame[]): void {
    const wood = this.mats.pbr(WOOD)
    const belowChannel = HERO.channelRadius + HERO.channelWall
    const towerX = HERO.towerX
    const towerZ = HERO.towerZ

    // Central column with radial arms under the spiral.
    const topY = HERO.startY - belowChannel
    addCylinderBetween(root, "TowerColumn", new vec3(towerX, 0, towerZ), new vec3(towerX, topY + 0.4, towerZ), 1.0, wood)
    addShadow(root, this.mats, towerX, towerZ, 4.5)

    const spiralArc = HERO.towerRadius * 2 * Math.PI * HERO.towerTurns
    const armEvery = (HERO.towerRadius * 2 * Math.PI) / 3
    let nextArm = armEvery * 0.4
    let s = 0
    let spiralEnd = 0
    for (let i = 1; i < frames.length; i++) {
      s += frames[i].p.distance(frames[i - 1].p)
      const p = frames[i].p
      if (s <= spiralArc) {
        spiralEnd = i
        if (s >= nextArm) {
          nextArm += armEvery
          const y = p.y - belowChannel + 0.05
          addCylinderBetween(root, "TowerArm", new vec3(towerX, y, towerZ), new vec3(p.x, y, p.z), 0.45, wood)
        }
      }
    }

    // Slim posts under the run, standing on the shelf where it passes over it.
    const ends = shelfEnds()
    const axis = ends.end.sub(ends.start).normalize()
    const shelfLen = ends.start.distance(ends.end)
    let lastPost = spiralEnd
    for (let i = spiralEnd + 3; i < frames.length - 1; i += 1) {
      const p = frames[i].p
      if (p.distance(frames[lastPost].p) < 12) continue
      lastPost = i
      const onShelf = this.onShelfTop(p, ends.start, axis, shelfLen)
      const footY = onShelf ? HERO.shelfTop : 0
      addCylinderBetween(root, "Post", new vec3(p.x, footY, p.z), new vec3(p.x, p.y - belowChannel + 0.1, p.z), 0.55, wood)
      if (!onShelf) addShadow(root, this.mats, p.x, p.z, 1.7)
    }
    // Stub under the chute mouth so it never hangs in the air.
    const mouth = frames[frames.length - 3].p
    const mouthOnShelf = this.onShelfTop(mouth, ends.start, axis, shelfLen)
    addCylinderBetween(root, "ChuteStub", new vec3(mouth.x, mouthOnShelf ? HERO.shelfTop : 0, mouth.z),
      new vec3(mouth.x, mouth.y - belowChannel + 0.1, mouth.z), 0.55, wood)
  }

  private onShelfTop(p: vec3, start: vec3, axis: vec3, len: number): boolean {
    const rel = p.sub(new vec3(start.x, p.y, start.z))
    const along = rel.dot(axis)
    const across = Math.abs(rel.dot(new vec3(-axis.z, 0, axis.x)))
    return along >= 0 && along <= len && across <= HERO.shelfWidth / 2 - 0.3
  }

  private buildBell(root: SceneObject, frames: PathFrame[]): void {
    // The ring on the path closest to the authored bell position.
    let best = 0
    let bestD = 1e9
    for (let i = 0; i < frames.length; i++) {
      const p = frames[i].p
      const d = (p.x - HERO.bellX) * (p.x - HERO.bellX) + (p.z - HERO.bellZ) * (p.z - HERO.bellZ)
      if (d < bestD) { bestD = d; best = i }
    }
    const f = frames[best]
    const flatT = new vec3(f.t.x, 0, f.t.z).normalize()
    const right = new vec3(flatT.z, 0, -flatT.x)
    this._bell = new MarbleRunBellUnit(root, this.mats, {
      base: new vec3(f.p.x, 0, f.p.z),
      rightDir: right,
      crossbarY: f.p.y + HERO.bellCrossbarAbovePath,
      postOffset: HERO.bellPostOffset,
      rearPostOnly: true,
      triggerCenter: f.p.add(new vec3(0, 0.5, 0)),
      triggerSize: new vec3(7, 6, 3.6),
      withShadows: true,
    })
    print("[MarbleRun] bell at (" + f.p.x.toFixed(1) + "," + f.p.y.toFixed(1) + "," + f.p.z.toFixed(1) + ")")
  }

  private buildShelf(root: SceneObject): void {
    const ends = shelfEnds()
    const axis = ends.end.sub(ends.start)
    const len = axis.length
    const dir = axis.uniformScale(1 / len)
    const center = ends.start.add(ends.end).uniformScale(0.5)
    const rot = quat.rotationFromTo(vec3.forward(), dir)
    const y = HERO.shelfTop - HERO.shelfThickness / 2

    const shelf = makeNode(root, "DominoShelf", new vec3(center.x, y, center.z), rot)
    addBox(shelf, "Plank", new vec3(HERO.shelfWidth, HERO.shelfThickness, len), vec3.zero(), undefined, this.mats.pbr(SHELF_WOOD))
    const col = shelf.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(HERO.shelfWidth, HERO.shelfThickness, len)
    col.shape = shape
    col.matter = SHELF_MATTER
    tagCollider(col, "shelf")

    // Legs under the first 60 % of the plank; the end overhangs the cup.
    const wood = this.mats.pbr(WOOD)
    const side = new vec3(-dir.z, 0, dir.x)
    for (const t of [0.12, 0.42, 0.72]) {
      for (const s of [-1, 1]) {
        const off = side.uniformScale(s * (HERO.shelfWidth / 2 - 0.9))
        const p = ends.start.add(dir.uniformScale(len * t)).add(off)
        addCylinderBetween(root, "ShelfLeg", new vec3(p.x, 0, p.z), new vec3(p.x, HERO.shelfTop - HERO.shelfThickness, p.z), 0.65, wood)
        addShadow(root, this.mats, p.x, p.z, 1.8)
      }
    }
    addShadow(root, this.mats, center.x, center.z, len * 0.32, HERO.shelfWidth * 0.62)
  }

  private buildDominoes(root: SceneObject): void {
    const dir = rowDir()
    const rot = quat.rotationFromTo(vec3.forward(), dir)
    const size = {width: HERO.dominoWidth, height: HERO.dominoHeight, thickness: HERO.dominoThickness}
    for (let i = 0; i < HERO.dominoCount; i++) {
      const d = new MarbleRunDominoUnit(root, this.mats, size, DOMINO_COLORS[i % DOMINO_COLORS.length], dominoCenter(i), rot)
      this._dominoes.push(d)
    }
  }

  private buildWaitingMarble(root: SceneObject): void {
    const so = makeNode(root, "WaitingMarble", waitingMarblePos())
    const body = so.createComponent("Physics.BodyComponent") as BodyComponent
    const shape = Shape.createSphereShape()
    shape.radius = HERO.marbleRadius
    body.shape = shape
    body.mass = 0.06
    body.damping = 0.01
    body.angularDamping = 0.02
    body.dynamic = false
    tagCollider(body, "marble")
    const shell = addSphere(so, "WaitingMarbleVisual", HERO.marbleRadius, vec3.zero(), this.mats.glass(WAITING_COLOR))
    makeCatsEye(shell, this.mats, WAITING_COLOR)
    const visual = shell.getSceneObject()
    this.waiting = {so, visual, body, scale: visual.getTransform().getLocalScale()}
  }
}
