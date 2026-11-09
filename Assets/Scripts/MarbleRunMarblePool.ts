/**
 * MarbleRunMarblePool — spawns, recycles and retires dynamic marbles.
 *
 * Owns: a capped pool of sphere bodies, shrinking away marbles that come to rest
 * or leave the table, and turning collisions into impact events for the audio layer.
 * Hero marbles are exempt from the rest timer: the chain retires them itself.
 *
 * Must not: play sounds or keep score — it emits onImpact; Main decides.
 */
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {SurfaceKind, surfaceKindOf, tagCollider, untagCollider} from "./MarbleRunColliderTags"
import {Mats, gameDelta, makeCatsEye, sphereMesh} from "./MarbleRunPrims"

export interface MarbleImpact {
  kind: SurfaceKind
  strength: number // 0..1
}

const MATTER = requireAsset("../Physics/MarbleMatter.matter") as Matter

const PALETTE = [
  new vec4(1.0, 0.16, 0.12, 1), new vec4(0.08, 0.55, 1.0, 1),
  new vec4(1.0, 0.72, 0.04, 1), new vec4(0.62, 0.24, 1.0, 1),
]

const OVERFLOW_REST_SEC = 8 // a marble that spilled out of the cup lingers on the table this long
const MAX_KEPT = 26 // marbles the cup may hold before the oldest is recycled (it overflows well before this)

export interface Marble {
  so: SceneObject
  visual: SceneObject
  vane: RenderMeshVisual
  body: BodyComponent
  active: boolean
  hero: boolean
  restTime: number
  shrinkT: number // -1 when not shrinking
  scored: boolean
  kept: boolean // scored and sitting in the cup: stays until Clear
  gen: number
  lastSoundAt: number
}

@component
export class MarbleRunMarblePool extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MarbleRunMarblePool – pooled physics marbles</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Maximum marbles alive at once; the oldest free marble is recycled beyond this")
  @widget(new SliderWidget(2, 16, 1))
  maxMarbles: number = 8

  @input
  @hint("Marble radius (cm)")
  @widget(new SliderWidget(1, 2.5, 0.05))
  marbleRadiusCm: number = 1.75

  @input
  @hint("Linear damping on marbles: keeps speed bounded in the channel (0.8 = strong)")
  @widget(new SliderWidget(0.05, 0.95, 0.05))
  rollDamping: number = 0.05

  @input
  @hint("A marble resting this long (s) shrinks away")
  @widget(new SliderWidget(0.3, 3, 0.1))
  restLifetimeSec: number = 1.5
  @ui.group_end

  private marbles: Marble[] = []
  private byCollider = new Map<ColliderComponent, Marble>()
  private meshRadius = 1
  private killY = -1e6
  private bounds = 200 // cm from the play area origin that still counts as on the table
  private _onImpact = new Event<MarbleImpact>()
  private update: SceneEvent | null = null
  private mats = new Mats()
  private spawnCount = 0
  private cupZone: ((world: vec3) => boolean) | null = null
  get onImpact(): PublicApi<MarbleImpact> { return this._onImpact.publicApi() }

  /** Marbles in play, not counting those kept in the cup. */
  get activeCount(): number {
    let n = 0
    for (const m of this.marbles) if (m.active && !m.kept) n++
    return n
  }

  /** A palette index that changes with every spawn, so a full cup is a mix of colours. */
  get nextColorIndex(): number { return this.spawnCount }

  /** Marbles sitting in the cup. */
  get keptCount(): number {
    let n = 0
    for (const m of this.marbles) if (m.active && m.kept) n++
    return n
  }

  /** Scored marbles inside this zone stay there instead of being cleaned up. */
  setCupZone(zone: (world: vec3) => boolean): void { this.cupZone = zone }

  onAwake(): void {
    const ext = sphereMesh().aabbMax.sub(sphereMesh().aabbMin)
    this.meshRadius = Math.max(ext.x, ext.y, ext.z) / 2 || 1
    this.update = this.createEvent("UpdateEvent")
    this.update.bind(() => this.onUpdate())
  }

  /** World Y below which marbles are retired, and the table extent. */
  setPlayBounds(killY: number, bounds: number): void {
    this.killY = killY
    this.bounds = bounds
  }

  isMarble(c: ColliderComponent): boolean { return this.byCollider.has(c) }

  /** Marks a marble scored; returns its generation or -1 if it was already counted. */
  markScored(c: ColliderComponent): number {
    const m = this.byCollider.get(c)
    if (!m || m.scored || !m.active) return -1
    m.scored = true
    return m.gen
  }

  /** Spawns or recycles a marble at `worldPos`. */
  spawn(worldPos: vec3, velocity: vec3 | null, hero: boolean, colorIndex: number): Marble {
    let m = this.takeFree()
    if (!m) m = this.create()
    this.spawnCount++
    const t = m.so.getTransform()
    t.setWorldPosition(worldPos)
    t.setWorldRotation(quat.quatIdentity())
    m.so.enabled = true
    const k = this.marbleRadiusCm / this.meshRadius
    m.visual.getTransform().setLocalScale(new vec3(k, k, k))
    m.body.dynamic = true
    m.body.damping = this.rollDamping
    m.body.velocity = velocity ? velocity : vec3.zero()
    m.body.angularVelocity = vec3.zero()
    m.active = true
    m.hero = hero
    m.scored = false
    m.kept = false
    m.restTime = 0
    m.shrinkT = -1
    m.gen++
    m.lastSoundAt = getTime()
    const color = PALETTE[colorIndex % PALETTE.length]
    m.vane.mainMaterial = this.mats.vane(color)
    ;(m.visual.getComponent("Component.RenderMeshVisual") as RenderMeshVisual).mainMaterial = this.mats.glass(color)
    return m
  }

  /** Take over a marble that has already scored, keeping its motion and colour. */
  adopt(worldPos: vec3, rotation: quat, velocity: vec3, angularVelocity: vec3, color: vec4): Marble {
    const m = this.spawn(worldPos, velocity, false, 0)
    m.so.getTransform().setWorldRotation(rotation)
    m.body.angularVelocity = angularVelocity
    m.scored = true
    m.vane.mainMaterial = this.mats.vane(color)
    ;(m.visual.getComponent("Component.RenderMeshVisual") as RenderMeshVisual).mainMaterial = this.mats.glass(color)
    return m
  }

  /** Move the marbles held in the cup along with it. */
  shiftKept(delta: vec3): void {
    for (const m of this.marbles) {
      if (!m.active || !m.kept) continue
      const t = m.so.getTransform()
      t.setWorldPosition(t.getWorldPosition().add(delta))
      m.body.velocity = vec3.zero()
    }
  }

  /** Begin the shrink-away for a marble now. */
  fadeOut(m: Marble): void {
    if (m.active && m.shrinkT < 0) m.shrinkT = 0
  }

  /** Immediately retire every marble (no animation). */
  clearAll(): void {
    for (const m of this.marbles) this.deactivate(m)
  }

  /** Retire every marble except those kept in the cup. */
  clearLoose(): void {
    for (const m of this.marbles) if (!m.kept) this.deactivate(m)
  }

  private takeFree(): Marble | null {
    const looseFull = this.activeCount >= this.maxMarbles
    const cupFull = this.keptCount >= MAX_KEPT
    if (looseFull || cupFull) {
      // Recycle the oldest non-hero marble; kept marbles only when the cup limit is reached.
      for (let i = 0; i < this.marbles.length; i++) {
        const c = this.marbles[i]
        if (c.active && !c.hero && (c.kept ? cupFull : looseFull)) {
          this.deactivate(c)
          this.marbles.splice(i, 1)
          this.marbles.push(c)
          return c
        }
      }
    }
    for (let i = 0; i < this.marbles.length; i++) {
      const c = this.marbles[i]
      if (!c.active) {
        this.marbles.splice(i, 1)
        this.marbles.push(c)
        return c
      }
    }
    return null
  }

  private create(): Marble {
    const idx = this.marbles.length
    const so = global.scene.createSceneObject("Marble_" + idx)
    so.setParent(this.sceneObject)
    const vis = global.scene.createSceneObject("MarbleVisual")
    vis.setParent(so)
    const rmv = vis.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = sphereMesh()
    const vane = makeCatsEye(rmv, this.mats, PALETTE[0])
    const body = so.createComponent("Physics.BodyComponent") as BodyComponent
    const shape = Shape.createSphereShape()
    shape.radius = this.marbleRadiusCm
    body.shape = shape
    body.dynamic = true
    body.mass = 0.06
    body.damping = this.rollDamping
    body.angularDamping = 0.1
    body.matter = MATTER
    tagCollider(body, "marble")
    const m: Marble = {
      so, visual: vis, vane, body, active: false, hero: false, restTime: 0, shrinkT: -1,
      scored: false, kept: false, gen: 0, lastSoundAt: 0,
    }
    body.onCollisionEnter.add((e: CollisionEnterEventArgs) => this.onHit(m, e))
    this.marbles.push(m)
    this.byCollider.set(body, m)
    return m
  }

  private onHit(m: Marble, e: CollisionEnterEventArgs): void {
    if (!m.active) return
    const kind = surfaceKindOf(e.collision.collider)
    if (!kind || kind === "marble") return
    const now = getTime()
    if (now - m.lastSoundAt < 0.12) return
    const speed = m.body.velocity.length
    if (speed < 18) return
    m.lastSoundAt = now
    this._onImpact.invoke({kind, strength: Math.min(1, speed / 200)})
  }

  private deactivate(m: Marble): void {
    if (!m.active) return
    m.active = false
    m.hero = false
    m.kept = false
    m.shrinkT = -1
    m.body.velocity = vec3.zero()
    m.body.angularVelocity = vec3.zero()
    m.so.enabled = false
  }

  private onUpdate(): void {
    const dt = gameDelta()
    for (const m of this.marbles) {
      if (!m.active) continue
      if (m.shrinkT >= 0) {
        m.shrinkT += dt
        const f = 1 - m.shrinkT / 0.35
        if (f <= 0) { this.deactivate(m); continue }
        const k = (this.marbleRadiusCm / this.meshRadius) * f
        m.visual.getTransform().setLocalScale(new vec3(k, k, k))
        continue
      }
      if (m.hero) continue
      const p = m.so.getTransform().getWorldPosition()
      m.kept = m.scored && this.cupZone !== null && this.cupZone(p)
      if (m.kept) {
        m.restTime = 0
        continue
      }
      const outOfBounds = p.y < this.killY || Math.abs(p.x) > 1e5 ? true : this.outsideTable(p)
      if (outOfBounds) { m.shrinkT = 0; continue }
      const speed = m.body.velocity.length
      m.restTime = speed < 4 ? m.restTime + dt : 0
      if (m.restTime > (m.scored ? OVERFLOW_REST_SEC : this.restLifetimeSec)) m.shrinkT = 0
    }
  }

  private outsideTable(world: vec3): boolean {
    const inv = this.sceneObject.getTransform().getInvertedWorldTransform()
    const local = inv.multiplyPoint(world)
    return Math.abs(local.x) > this.bounds || Math.abs(local.z) > this.bounds
  }

  onDestroy(): void {
    for (const m of this.marbles) untagCollider(m.body)
  }
}
