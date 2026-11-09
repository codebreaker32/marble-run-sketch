/**
 * MarbleRunTrackManager — turns sketched strokes into solid marble tracks.
 *
 * Owns: the drawn tracks (Undo/Clear), the throttled live preview ribbon, making
 * strokes safe: never below the table, never through the cup, and blending a stroke
 * that ends near the cup into a mouth just above and inside its rim.
 * Colliders are built once, when the stroke finishes.
 *
 * Inputs: cup (goal geometry for the snap). Must not: read input or choose tools.
 */
import {tagCollider, untagCollider} from "./MarbleRunColliderTags"
import {HERO, shelfEnds} from "./MarbleRunHeroLayout"
import {MarbleRunGoalCup} from "./MarbleRunGoalCup"
import {Mats, PIPE_COLOR, addChannelCollars, makeNode} from "./MarbleRunPrims"
import {
  PathFrame,
  TrackProfile,
  buildChannelMesh,
  computeFrames,
  polylineLength,
  resamplePolyline,
  smoothPolyline,
} from "./MarbleRunTrackGeometry"

const PREVIEW_MAT = requireAsset("../Materials/TrackPreviewMaterial.mat") as Material
const TRACK_MATTER = requireAsset("../Physics/TrackMatter.matter") as Matter
const MAX_SLOPE = 0.9 // steepest drop per cm of run (about 42 degrees); steeper channels trap or throw the marble
const DROP_END_MARGIN = 3 // samples at each end of a track that can't be picked as a drop spot
const FLAT_STROKE_CM = 4 // a stroke within this sideways spread of its chord counts as drawn in one flat sheet

export interface BuiltTrack {
  root: SceneObject
  collider: ColliderComponent
  highEnd: vec3 // local, top of the run
  dropPoint: vec3 // local, just above the channel a little past the back wall
  dropPoints: vec3[] // local, a resting spot on the channel floor at every sample along the track
  lowEnd: vec3 // local
  snapped: boolean
}

@component
export class MarbleRunTrackManager extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MarbleRunTrackManager – sketch to U-channel track</span>')
  @ui.separator
  @ui.group_start("References")
  @input @hint("Goal cup, used to snap a stroke's end into its rim") cup: MarbleRunGoalCup
  @ui.group_end
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Shortest stroke that becomes a track (cm)")
  @widget(new SliderWidget(3, 30, 1))
  minTrackLengthCm: number = 10

  @input
  @hint("A stroke ending within this distance of the cup snaps into its rim (cm)")
  @widget(new SliderWidget(6, 30, 1))
  snapRangeCm: number = 16

  @input
  @hint("Max rebuilds per second of the live drawing preview")
  @widget(new SliderWidget(5, 30, 1))
  previewRebuildHz: number = 12

  @input
  @hint("Maximum tracks kept; drawing past this removes the oldest")
  @widget(new SliderWidget(3, 30, 1))
  maxTracks: number = 12
  @ui.group_end

  private mats!: Mats
  private tracks: BuiltTrack[] = []
  private previewSO: SceneObject | null = null
  private previewRmv: RenderMeshVisual | null = null
  private lastPreviewAt = -1
  private previewMat: Material | null = null
  private heroPresent: (() => boolean) | null = null
  private _blockedByShelf = false

  /** True when the last rejected stroke would have run through the demo's domino shelf. */
  get blockedByShelf(): boolean { return this._blockedByShelf }

  /** Tells the manager whether the demo contraption is on the table, so tracks can avoid its shelf. */
  setHeroPresence(present: () => boolean): void { this.heroPresent = present }

  get trackCount(): number { return this.tracks.length }
  get lastTrack(): BuiltTrack | null { return this.tracks.length > 0 ? this.tracks[this.tracks.length - 1] : null }
  has(t: BuiltTrack): boolean { return this.tracks.indexOf(t) >= 0 }

  /** The point on any track closest to a world-space aim ray, if the ray passes within `maxMissCm`. */
  pickDropSpot(rayStart: vec3, rayEnd: vec3, maxMissCm: number): {track: BuiltTrack; point: vec3; missCm: number} | null {
    const inv = this.sceneObject.getTransform().getInvertedWorldTransform()
    const a = inv.multiplyPoint(rayStart)
    const ab = inv.multiplyPoint(rayEnd).sub(a)
    const len2 = ab.dot(ab)
    if (len2 < 1e-6) return null
    let best: {track: BuiltTrack; point: vec3; missCm: number} | null = null
    for (const track of this.tracks) {
      // Skip the very ends: past the back wall, or too late for the marble to roll anywhere.
      for (let i = DROP_END_MARGIN; i < track.dropPoints.length - DROP_END_MARGIN; i++) {
        const p = track.dropPoints[i]
        const k = Math.max(0, Math.min(1, p.sub(a).dot(ab) / len2))
        const missCm = a.add(ab.uniformScale(k)).distance(p)
        if (missCm <= maxMissCm && (!best || missCm < best.missCm)) best = {track, point: p, missCm}
      }
    }
    return best
  }

  /** Track-space position of a world point. */
  worldToLocal(world: vec3): vec3 {
    return this.sceneObject.getTransform().getInvertedWorldTransform().multiplyPoint(world)
  }

  init(mats: Mats): void {
    this.mats = mats
  }

  /** World position of a local track point. */
  toWorld(local: vec3): vec3 {
    return this.sceneObject.getTransform().getWorldTransform().multiplyPoint(local)
  }

  private profile(arc: number): TrackProfile {
    return {innerRadiusCm: HERO.channelRadius, lipHeightCm: HERO.channelLip, wallThicknessCm: HERO.channelWall, arcSegments: arc}
  }

  /** Live preview while drawing; throttled, light geometry, no collider. */
  setPreview(worldPoints: vec3[]): void {
    if (worldPoints.length < 2) { this.clearPreview(); return }
    const now = getTime()
    if (this.previewSO && this.previewSO.enabled && now - this.lastPreviewAt < 1 / this.previewRebuildHz) return
    this.lastPreviewAt = now
    const local = this.toLocal(smoothPolyline(worldPoints, 1))
    const frames = computeFrames(local, 0, 0)
    const mesh = buildChannelMesh(frames, this.profile(5), false, true)
    if (!mesh) return
    if (!this.previewSO) {
      this.previewSO = makeNode(this.sceneObject, "StrokePreview")
      this.previewRmv = this.previewSO.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      this.previewMat = PREVIEW_MAT.clone()
      this.previewMat.mainPass.twoSided = true
      this.previewRmv.mainMaterial = this.previewMat
    }
    this.previewSO.enabled = true
    ;(this.previewRmv as RenderMeshVisual).mesh = mesh
  }

  clearPreview(): void {
    if (this.previewSO) this.previewSO.enabled = false
    this.lastPreviewAt = -1
  }

  /** Build a solid track from a world-space stroke, or null if it is too short. */
  addTrack(worldPoints: vec3[]): BuiltTrack | null {
    this.clearPreview()
    this._blockedByShelf = false
    if (worldPoints.length < 2 || polylineLength(worldPoints) < this.minTrackLengthCm) return null

    let pts = this.toLocal(smoothPolyline(resamplePolyline(worldPoints, 1.4), 3))
    if (pts.length > 300) pts = resamplePolyline(pts, polylineLength(pts) / 299)
    // Index 0 = high end: the marble drops there and it has the closed back wall.
    if (pts[0].y < pts[pts.length - 1].y) pts = pts.reverse()

    pts = this.unfoldFlatStroke(pts)
    const snapped = this.snapEndToCup(pts)
    this.keepClearOfCupAndTable(pts)
    pts = this.limitSlope(pts)
    this.enforceDescent(pts)
    if (polylineLength(pts) < this.minTrackLengthCm) return null
    if (this.runsThroughShelf(pts)) {
      this._blockedByShelf = true
      return null
    }

    const frames = computeFrames(pts, 55, 14)
    const mesh = buildChannelMesh(frames, this.profile(14), true)
    if (!mesh) {
      print("[MarbleRun] track mesh build failed (" + pts.length + " samples)")
      return null
    }
    const root = makeNode(this.sceneObject, "Track_" + (this.tracks.length + 1))
    const rmv = root.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = mesh
    rmv.mainMaterial = this.mats.plastic(PIPE_COLOR)
    addChannelCollars(root, frames, this.profile(14), this.mats)

    const coarse: PathFrame[] = []
    for (let i = 0; i < frames.length; i += 2) coarse.push(frames[i])
    if (coarse[coarse.length - 1] !== frames[frames.length - 1]) coarse.push(frames[frames.length - 1])
    const colMesh = buildChannelMesh(coarse, this.profile(10), true, true) || mesh
    const col = root.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createMeshShape()
    shape.mesh = colMesh
    col.shape = shape
    col.matter = TRACK_MATTER
    tagCollider(col, "track")

    // The marble starts resting on the channel floor, so a steep start can't put it behind the back wall.
    const dropPoints = frames.map((f) => f.p.sub(f.n.uniformScale(HERO.channelRadius - HERO.marbleRadius - 0.2)))
    const dropPoint = dropPoints[Math.min(DROP_END_MARGIN, dropPoints.length - 1)]
    const t: BuiltTrack = {root, collider: col, highEnd: pts[0], lowEnd: pts[pts.length - 1], dropPoint, dropPoints, snapped}
    this.tracks.push(t)
    while (this.tracks.length > Math.max(1, this.maxTracks)) this.removeTrack(this.tracks.shift())
    return t
  }

  undo(): boolean {
    const t = this.tracks.pop()
    if (!t) return false
    this.removeTrack(t)
    return true
  }

  clearAll(): number {
    const n = this.tracks.length
    while (this.undo()) { /* pop all */ }
    this.clearPreview()
    return n
  }

  private removeTrack(t: BuiltTrack | undefined): void {
    if (!t) return
    untagCollider(t.collider)
    t.root.destroy()
  }

  private toLocal(worldPoints: vec3[]): vec3[] {
    const inv = this.sceneObject.getTransform().getInvertedWorldTransform()
    return worldPoints.map((p) => inv.multiplyPoint(p))
  }

  /**
   * A stroke drawn in one flat sheet (always with a mouse, sometimes by hand) has no
   * room to turn around, so doubling back would fold the channel onto itself.
   * Keep only its forward progress. Strokes with real sideways curves are left alone.
   */
  private unfoldFlatStroke(pts: vec3[]): vec3[] {
    const first = pts[0]
    const last = pts[pts.length - 1]
    const run = new vec3(last.x - first.x, 0, last.z - first.z)
    if (run.length < 1) return pts
    const along = run.normalize()
    const side = new vec3(along.z, 0, -along.x)
    let maxSide = 0
    for (const p of pts) maxSide = Math.max(maxSide, Math.abs(p.sub(first).dot(side)))
    if (maxSide > FLAT_STROKE_CM) return pts

    const out = [first]
    let furthest = 0
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i].sub(first).dot(along)
      if (a > furthest + 0.2) {
        out.push(pts[i])
        furthest = a
      }
    }
    if (out[out.length - 1] !== last) out.push(last)
    return smoothPolyline(resamplePolyline(out, 1.4), 3)
  }

  /**
   * Keep every stretch shallow enough for a marble to stay in. Scales the whole height
   * range first so the drawn waves survive, then clips whatever is still too steep,
   * walking up from the low end so that end stays put.
   */
  private limitSlope(pts: vec3[]): vec3[] {
    let run = 0
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      run += Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z))
    }
    const lowY = pts[pts.length - 1].y
    const averageSlope = (pts[0].y - lowY) / Math.max(run, 0.01)
    if (averageSlope > MAX_SLOPE) {
      const k = MAX_SLOPE / averageSlope
      for (let i = 0; i < pts.length; i++) pts[i] = new vec3(pts[i].x, lowY + (pts[i].y - lowY) * k, pts[i].z)
    }
    for (let i = pts.length - 2; i >= 0; i--) {
      const next = pts[i + 1]
      const p = pts[i]
      const dh = Math.sqrt((p.x - next.x) * (p.x - next.x) + (p.z - next.z) * (p.z - next.z))
      const maxY = next.y + MAX_SLOPE * dh
      if (p.y > maxY) pts[i] = new vec3(p.x, maxY, p.z)
    }
    return smoothPolyline(resamplePolyline(pts, 1.4), 2)
  }

  /** Lift points below the table and push points away from the cup wall. */
  private keepClearOfCupAndTable(pts: vec3[]): void {
    const floorClear = HERO.channelRadius + HERO.channelWall + 0.4
    const cupPos = this.cup.localPosition
    const keepRadius = this.cup.outerRadiusCm + HERO.channelRadius + HERO.channelWall + 0.8
    const rimTop = this.cup.rimLocal.y + HERO.channelRadius + HERO.channelWall + 0.3
    // A straight stroke crossing the axis must stay on one side, not jump across the cup.
    let lastDir: {x: number; z: number} | null = null
    for (let i = 0; i < pts.length; i++) {
      let p = pts[i]
      if (p.y < floorClear) p = new vec3(p.x, floorClear, p.z)
      const dx = p.x - cupPos.x
      const dz = p.z - cupPos.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist < keepRadius) {
        if (!lastDir && i > 0) {
          // Entering the circle: remember which side the stroke came from, whatever its height.
          const ex = pts[i - 1].x - cupPos.x
          const ez = pts[i - 1].z - cupPos.z
          const elen = Math.sqrt(ex * ex + ez * ez)
          if (elen > 0.001) lastDir = {x: ex / elen, z: ez / elen}
        }
        if (p.y < rimTop) {
          let ux = dx / Math.max(dist, 0.001)
          let uz = dz / Math.max(dist, 0.001)
          if (lastDir && ux * lastDir.x + uz * lastDir.z <= 0) {
            ux = lastDir.x
            uz = lastDir.z
          }
          lastDir = {x: ux, z: uz}
          p = new vec3(cupPos.x + ux * keepRadius, p.y, cupPos.z + uz * keepRadius)
        }
      } else {
        lastDir = null
      }
      pts[i] = p
    }
  }

  /**
   * If the stroke ends near the cup, cut it where it reaches the cup's clearance
   * circle and run a straight final section to a mouth just above and inside the
   * rim, aimed into the cup. A stroke arriving too low is lifted to rim height.
   */
  private snapEndToCup(pts: vec3[]): boolean {
    const rim = this.cup.rimLocal
    const horizontal = (p: vec3): number => Math.sqrt((rim.x - p.x) * (rim.x - p.x) + (rim.z - p.z) * (rim.z - p.z))
    if (horizontal(pts[pts.length - 1]) > this.snapRangeCm) return false

    const reach = this.cup.outerRadiusCm + HERO.channelRadius + HERO.channelWall + 0.8
    let last = pts.length - 1
    while (last >= 0 && horizontal(pts[last]) < reach) last--
    if (last < 0) return false

    const inward = new vec3(rim.x - pts[last].x, 0, rim.z - pts[last].z).normalize()
    const inset = this.cup.innerRadiusCm - 2.6
    const mouthY = rim.y + HERO.channelRadius + HERO.channelWall + 0.5
    const mouth = new vec3(rim.x - inward.x * inset, mouthY, rim.z - inward.z * inset)

    pts.length = last + 1
    let next = mouth
    for (let i = last; i >= 0; i--) {
      const dh = Math.sqrt((pts[i].x - next.x) * (pts[i].x - next.x) + (pts[i].z - next.z) * (pts[i].z - next.z))
      const minY = next.y + 0.05 * dh
      if (pts[i].y < minY) pts[i] = new vec3(pts[i].x, minY, pts[i].z)
      next = pts[i]
    }
    const start = pts[last]
    const steps = Math.max(2, Math.ceil(start.distance(mouth) / 1.4))
    for (let i = 1; i <= steps; i++) pts.push(vec3.lerp(start, mouth, i / steps))
    return true
  }

  /** True when a finished path would cut through the demo's domino shelf or its dominoes. */
  private runsThroughShelf(pts: vec3[]): boolean {
    if (!this.heroPresent || !this.heroPresent()) return false
    const ends = shelfEnds()
    const axis = new vec3(ends.end.x - ends.start.x, 0, ends.end.z - ends.start.z)
    const len = axis.length
    const dir = axis.uniformScale(1 / len)
    const clearance = HERO.channelRadius + HERO.channelWall
    const halfWidth = HERO.shelfWidth / 2 + clearance
    const top = HERO.shelfTop + HERO.dominoHeight
    for (const p of pts) {
      if (p.y - clearance > top) continue
      const rx = p.x - ends.start.x
      const rz = p.z - ends.start.z
      const along = rx * dir.x + rz * dir.z
      const across = Math.abs(rx * dir.z - rz * dir.x)
      if (along >= 0 && along <= len + 0.5 && across <= halfWidth) return true
    }
    return false
  }

  /** Walk from the high end making sure the channel always descends a little. */
  private enforceDescent(pts: vec3[]): void {
    const minSlope = 0.05
    const floorClear = HERO.channelRadius + HERO.channelWall + 0.4
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]
      const p = pts[i]
      const dh = Math.sqrt((p.x - prev.x) * (p.x - prev.x) + (p.z - prev.z) * (p.z - prev.z))
      const maxY = prev.y - minSlope * dh
      if (p.y > maxY) pts[i] = new vec3(p.x, maxY, p.z)
      if (pts[i].y < floorClear) pts[i] = new vec3(pts[i].x, floorClear, pts[i].z)
    }
  }
}
