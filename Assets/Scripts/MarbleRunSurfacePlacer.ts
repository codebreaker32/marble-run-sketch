/**
 * MarbleRunSurfacePlacer — real-surface detection and the placement reticle.
 *
 * Owns: a World Query hit-test session (run only while probing or aiming), the
 * static floor slab under the play area, and the reticle shown only while the
 * Floor or Goal tool is aiming. Reports table height; Main moves the play area.
 *
 * Inputs: reticle object. Must not: decide tools or move content.
 */
import {tagCollider} from "./MarbleRunColliderTags"

const FLOOR_MATTER = requireAsset("../Physics/FloorMatter.matter") as Matter

export interface SurfaceHit {
  position: vec3 // world
  normal: vec3
  fromWorldQuery: boolean
}

@component
export class MarbleRunSurfacePlacer extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MarbleRunSurfacePlacer – World Query surface + reticle</span>')
  @ui.separator
  @ui.group_start("References")
  @input @hint("Reticle shown where the Floor/Goal placement will land") reticle: SceneObject
  @ui.group_end
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Maximum tilt from horizontal for a surface to count as a table (degrees)")
  @widget(new SliderWidget(5, 45, 1))
  maxSurfaceTiltDeg: number = 20

  @input
  @hint("How long a World Query hit stays valid for confirm after it arrives (s)")
  @widget(new SliderWidget(0.1, 1.5, 0.05))
  worldHitHoldSec: number = 0.5
  @ui.group_end

  private session: HitTestSession | null = null
  private sessionRunning = false
  private probing = false
  private aiming = false
  private aimToken = 0
  private tableWorldY = 0
  private pendingHit: SurfaceHit | null = null
  private lastWorldHit: SurfaceHit | null = null
  private lastWorldHitAt = -1
  private floorCollider: ColliderComponent | null = null

  get surfaceY(): number { return this.tableWorldY }

  onAwake(): void {
    const slab = global.scene.createSceneObject("FloorCollider")
    slab.setParent(this.sceneObject)
    slab.getTransform().setLocalPosition(new vec3(0, -10, 0))
    const col = slab.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(400, 20, 400)
    col.shape = shape
    col.matter = FLOOR_MATTER
    tagCollider(col, "floor")
    this.floorCollider = col

    if (this.reticle) this.reticle.enabled = false
    try {
      const wq = require("LensStudio:WorldQueryModule") as WorldQueryModule
      const opts = HitTestSessionOptions.create()
      opts.filter = true
      this.session = wq.createHitTestSessionWithOptions(opts)
    } catch (e) {
      this.session = null
      print("[MarbleRun] World Query unavailable: " + e)
    }
  }

  /** The table-top height (world Y) of the current play area; the floor slab sits under it. */
  setTable(worldY: number, extentX: number, extentZ: number): void {
    this.tableWorldY = worldY
    if (this.floorCollider) {
      const s = this.floorCollider.shape as BoxShape
      s.size = new vec3(extentX, 20, extentZ)
      this.floorCollider.shape = s
    }
  }

  /**
   * Probe for a table in front of the user. `done` fires exactly once with the
   * surface height, or null if nothing was found before the time-out.
   */
  probeTable(headWorldPos: vec3, flatForward: vec3, done: (worldY: number | null) => void): void {
    if (!this.session) { done(null); return }
    let tries = 0
    let settled = false
    const settle = (y: number | null) => {
      if (settled) return
      settled = true
      this.probing = false
      this.updateSession()
      done(y)
    }
    this.probing = true
    this.updateSession()
    const probe = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
    probe.bind(() => {
      if (settled) return
      if (tries++ > 24) { settle(null); return }
      const end = headWorldPos.add(flatForward.uniformScale(55)).add(new vec3(0, -160, 0))
      this.hitTest(headWorldPos, end, (hit) => {
        if (!settled && hit && this.isTableLike(hit.normal)) settle(hit.position.y)
      })
      if (!settled) probe.reset(0.25)
    })
    probe.reset(0.4)
  }

  /** Aim the reticle along a ray for the Floor or Goal tool. */
  aim(rayStart: vec3, rayEnd: vec3, purpose: "floor" | "goal"): void {
    if (!this.aiming) {
      this.aiming = true
      this.aimToken++
      this.lastWorldHit = null
      this.updateSession()
    }
    const token = this.aimToken
    this.hitTest(rayStart, rayEnd, (hit) => {
      if (!this.aiming || token !== this.aimToken) return
      if (hit && this.isTableLike(hit.normal)) {
        this.lastWorldHit = hit
        this.lastWorldHitAt = getTime()
        this.showCandidate(hit)
      }
    })
    const fresh = this.lastWorldHit !== null && getTime() - this.lastWorldHitAt <= this.worldHitHoldSec
    if (fresh) this.showCandidate(this.lastWorldHit)
    else this.showCandidate(purpose === "goal" ? this.intersectTable(rayStart, rayEnd) : null)
  }

  private showCandidate(candidate: SurfaceHit | null): void {
    this.pendingHit = candidate
    if (!this.reticle) return
    this.reticle.enabled = candidate !== null
    if (candidate) this.reticle.getTransform().setWorldPosition(candidate.position.add(new vec3(0, 0.3, 0)))
  }

  /** The current aim as a confirmed hit, or null when nothing valid is aimed at. */
  confirm(): SurfaceHit | null {
    return this.pendingHit
  }

  hideReticle(): void {
    this.pendingHit = null
    if (this.aiming) {
      this.aiming = false
      this.aimToken++
      this.lastWorldHit = null
      this.updateSession()
    }
    if (this.reticle) this.reticle.enabled = false
  }

  /** Ray intersection with the table plane; used for placing bells and dominoes. */
  intersectTable(a: vec3, b: vec3): SurfaceHit | null {
    const dy = b.y - a.y
    if (Math.abs(dy) < 1e-4) return null
    const t = (this.tableWorldY - a.y) / dy
    if (t < 0 || t > 1) return null
    return {position: a.add(b.sub(a).uniformScale(t)), normal: vec3.up(), fromWorldQuery: false}
  }

  private updateSession(): void {
    if (!this.session) return
    const want = this.probing || this.aiming
    if (want === this.sessionRunning) return
    try {
      if (want) this.session.start()
      else this.session.stop()
      this.sessionRunning = want
    } catch (e) {
      print("[MarbleRun] World Query session " + (want ? "start" : "stop") + " failed: " + e)
    }
  }

  private isTableLike(n: vec3): boolean {
    return n.normalize().dot(vec3.up()) >= Math.cos((this.maxSurfaceTiltDeg * Math.PI) / 180)
  }

  private hitTest(a: vec3, b: vec3, cb: (hit: SurfaceHit | null) => void): void {
    if (!this.session) { cb(null); return }
    try {
      this.session.hitTest(a, b, (r: WorldQueryHitTestResult) => {
        cb(r ? {position: r.position, normal: r.normal, fromWorldQuery: true} : null)
      })
    } catch (e) {
      cb(null)
    }
  }
}
