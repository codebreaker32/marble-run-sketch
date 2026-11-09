/**
 * MarbleRunBellUnit — a real bell hanging from a small arch.
 *
 * Owns: the arch (two posts + crossbar) standing on the table, the swinging bell
 * and clapper, and an intangible trigger. A marble passing through the trigger
 * rings the bell without being deflected. Used by the hero contraption (arch
 * straddling the channel) and the free-build Bell tool.
 *
 * Must not: play sounds or keep state beyond the swing; it emits via onRing.
 */
import {surfaceKindOf} from "./MarbleRunColliderTags"
import {Mats, addCylinderBetween, addShadow, addSphere, addVisual, bellMesh, makeNode} from "./MarbleRunPrims"

const WOOD = new vec4(0.72, 0.5, 0.28, 1)
const GOLD = new vec4(1.0, 0.86, 0.32, 1)
const DARK_GOLD = new vec4(0.85, 0.6, 0.15, 1)

export interface BellOptions {
  base: vec3 // point on the table under the arch centre (y = 0)
  rightDir: vec3 // horizontal unit vector along the crossbar
  crossbarY: number // crossbar height above the table
  postOffset: number // half the arch span
  rearPostOnly?: boolean // one post on the far side with an arm over the bell, so nothing stands in front of it
  triggerCenter: vec3 // centre of the trigger volume, in parent space
  triggerSize: vec3 // across, up, along
  withShadows: boolean
}

export class MarbleRunBellUnit {
  readonly root: SceneObject
  private swing: SceneObject
  private clapper: SceneObject
  private trigger: SceneObject
  private swingT = -1
  private lastRingAt = -10
  /** Fired when a marble passes the trigger; receives a strength 0..1. */
  onRing: ((strength: number) => void) | null = null

  constructor(parent: SceneObject, mats: Mats, opts: BellOptions) {
    const rot = quat.rotationFromTo(vec3.right(), opts.rightDir)
    this.root = makeNode(parent, "BellArch", opts.base, rot)
    const y = opts.crossbarY
    const off = opts.postOffset
    const wood = mats.pbr(WOOD)
    // The user is toward +Z, so the rear post is the end pointing away from +Z.
    const rearSide = opts.rightDir.z > 0 ? -1 : 1
    const sides = opts.rearPostOnly ? [rearSide] : [-1, 1]
    for (const side of sides) {
      addCylinderBetween(this.root, side < 0 ? "PostL" : "PostR", new vec3(side * off, 0, 0), new vec3(side * off, y, 0), 0.5, wood)
      if (opts.withShadows) addShadow(this.root, mats, side * off, 0, 1.5)
    }
    const barFrom = opts.rearPostOnly ? rearSide * (off + 0.6) : -off - 0.6
    const barTo = opts.rearPostOnly ? -rearSide * 1.2 : off + 0.6
    addCylinderBetween(this.root, "Crossbar", new vec3(barFrom, y, 0), new vec3(barTo, y, 0), 0.45, wood)

    const pivot = makeNode(this.root, "BellPivot", new vec3(0, y, 0))
    this.swing = makeNode(pivot, "BellSwing")
    addCylinderBetween(this.swing, "Hanger", vec3.zero(), new vec3(0, -1.5, 0), 0.25, mats.gloss(DARK_GOLD))
    addVisual(this.swing, "BellBody", bellMesh(), mats.gloss(GOLD), new vec3(0, -1.5, 0), vec3.one())
    this.clapper = makeNode(this.swing, "Clapper", new vec3(0, -1.5, 0))
    addCylinderBetween(this.clapper, "ClapperRod", vec3.zero(), new vec3(0, -4.4, 0), 0.14, mats.gloss(DARK_GOLD))
    addSphere(this.clapper, "ClapperBall", 0.75, new vec3(0, -4.9, 0), mats.gloss(DARK_GOLD))

    this.trigger = makeNode(parent, "BellTrigger", opts.triggerCenter, rot)
    const tc = this.trigger.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = opts.triggerSize
    tc.shape = shape
    tc.intangible = true
    tc.onOverlapEnter.add((e: OverlapEnterEventArgs) => {
      if (surfaceKindOf(e.overlap.collider) === "marble") this.ring(0.9)
    })
  }

  ring(strength: number): void {
    const now = getTime()
    if (now - this.lastRingAt < 0.25) return
    this.lastRingAt = now
    this.swingT = 0
    if (this.onRing) this.onRing(strength)
  }

  update(dt: number): void {
    if (this.swingT < 0) return
    this.swingT += dt
    const t = this.swingT
    if (t > 2.4) {
      this.swingT = -1
      this.swing.getTransform().setLocalRotation(quat.quatIdentity())
      this.clapper.getTransform().setLocalRotation(quat.quatIdentity())
      return
    }
    const envelope = Math.exp(-1.9 * t)
    const angle = 0.5 * envelope * Math.sin(t * 13)
    const clapperAngle = 0.75 * envelope * Math.sin(t * 13 - 0.9)
    this.swing.getTransform().setLocalRotation(quat.angleAxis(angle, vec3.right()))
    this.clapper.getTransform().setLocalRotation(quat.angleAxis(clapperAngle - angle, vec3.right()))
  }

  destroy(): void {
    this.root.destroy()
    this.trigger.destroy()
  }
}
