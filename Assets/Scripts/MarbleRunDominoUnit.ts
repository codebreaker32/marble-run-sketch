/**
 * MarbleRunDominoUnit — one chunky domino with a real rigid body.
 *
 * Owns: the body (box collider on a unit-scale node), the coloured visual with
 * face details on leaf children, and its home pose. The body is kinematic while
 * parked at home and dynamic while the chain or free play is running, so a
 * parked row can't creep or be knocked by a stray marble.
 *
 * Must not: decide when it is reset; the owner drives it.
 */
import {tagCollider, untagCollider} from "./MarbleRunColliderTags"
import {Mats, addBox, addSphere, makeNode} from "./MarbleRunPrims"

const MATTER = requireAsset("../Physics/WoodMatter.matter") as Matter

export interface DominoSize {
  width: number
  height: number
  thickness: number
}

export class MarbleRunDominoUnit {
  readonly so: SceneObject
  readonly body: BodyComponent
  private homePos: vec3
  private homeRot: quat
  private fromPos: vec3
  private fromRot: quat
  private fallenPrinted = false

  constructor(parent: SceneObject, mats: Mats, size: DominoSize, color: vec4, pos: vec3, rot: quat) {
    this.homePos = pos
    this.homeRot = rot
    this.fromPos = pos
    this.fromRot = rot
    this.so = makeNode(parent, "Domino", pos, rot)
    this.body = this.so.createComponent("Physics.BodyComponent") as BodyComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(size.width, size.height, size.thickness)
    this.body.shape = shape
    this.body.mass = 0.025
    this.body.damping = 0.0
    this.body.angularDamping = 0.1
    this.body.matter = MATTER
    this.body.dynamic = false
    tagCollider(this.body, "domino")

    addBox(this.so, "DominoVisual", new vec3(size.width, size.height, size.thickness), vec3.zero(), undefined, mats.pbr(color))
    // Face details: a light stripe and pips on both large faces so it reads as a domino.
    const light = mats.unlit(new vec4(1, 1, 1, 1))
    for (const face of [1, -1]) {
      const z = (face * size.thickness) / 2 + face * 0.02
      addBox(this.so, "Stripe", new vec3(size.width * 0.75, 0.24, 0.04), new vec3(0, 0, z), undefined, light)
      addSphere(this.so, "PipTop", 0.42, new vec3(0, size.height * 0.27, z), light)
      addSphere(this.so, "PipBottomL", 0.42, new vec3(-size.width * 0.24, -size.height * 0.27, z), light)
      addSphere(this.so, "PipBottomR", 0.42, new vec3(size.width * 0.24, -size.height * 0.27, z), light)
    }
  }

  setDynamic(on: boolean): void {
    this.body.dynamic = on
    if (on) {
      this.body.velocity = vec3.zero()
      this.body.angularVelocity = vec3.zero()
    }
  }

  /** Degrees this domino has tilted from upright. */
  tiltDeg(): number {
    const up = this.so.getTransform().up
    return (Math.acos(Math.max(-1, Math.min(1, up.dot(vec3.up())))) * 180) / Math.PI
  }

  get fallenReported(): boolean { return this.fallenPrinted }
  set fallenReported(v: boolean) { this.fallenPrinted = v }

  /** Snapshot the current pose (start of a reset animation). */
  beginReset(): void {
    this.setDynamic(false)
    const t = this.so.getTransform()
    this.fromPos = t.getLocalPosition()
    this.fromRot = t.getLocalRotation()
  }

  /** Interpolate toward home; f in 0..1. */
  applyResetPose(f: number): void {
    const s = f * f * (3 - 2 * f)
    const t = this.so.getTransform()
    t.setLocalPosition(vec3.lerp(this.fromPos, this.homePos, s))
    t.setLocalRotation(quat.slerp(this.fromRot, this.homeRot, s))
  }

  destroy(): void {
    untagCollider(this.body)
    this.so.destroy()
  }
}
