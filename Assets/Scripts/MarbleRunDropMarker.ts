/**
 * MarbleRunDropMarker — the ghost marble that shows where the next Drop will release.
 *
 * Owns: a gold glass marble with a small bobbing pin above it. Purely visual, so it
 * has no collider and never gets in a marble's way.
 *
 * Must not: decide where the drop goes — Main works that out and calls show/hide.
 */
import {HERO} from "./MarbleRunHeroLayout"
import {Mats, addCylinderBetween, addSphere, makeCatsEye, makeNode} from "./MarbleRunPrims"

const GOLD = new vec4(1.0, 0.72, 0.04, 1)
const PIN_GLOW = new vec4(1.0, 0.8, 0.2, 1)
const BOB_HZ = 1.1
const BOB_CM = 0.7
const PIN_BASE_CM = HERO.marbleRadius + 1.2
const PIN_TOP_CM = PIN_BASE_CM + 2.6
const PIN_HEAD_RADIUS_CM = 0.85
const PIN_STEM_RADIUS_CM = 0.16

export class MarbleRunDropMarker {
  readonly root: SceneObject
  private pin: SceneObject
  private t = 0

  constructor(parent: SceneObject, mats: Mats) {
    this.root = makeNode(parent, "DropMarker")
    const shell = addSphere(this.root, "GhostMarble", HERO.marbleRadius, vec3.zero(), mats.glass(GOLD))
    makeCatsEye(shell, mats, GOLD)
    this.pin = makeNode(this.root, "Pin")
    addCylinderBetween(this.pin, "Stem", new vec3(0, PIN_BASE_CM, 0), new vec3(0, PIN_TOP_CM, 0), PIN_STEM_RADIUS_CM, mats.unlit(PIN_GLOW))
    addSphere(this.pin, "Head", PIN_HEAD_RADIUS_CM, new vec3(0, PIN_TOP_CM, 0), mats.unlit(PIN_GLOW))
    this.root.enabled = false
  }

  /** Place the marker at a position in the parent's space and animate it. */
  show(local: vec3, dt: number): void {
    this.root.enabled = true
    this.root.getTransform().setLocalPosition(local)
    this.t += dt
    this.pin.getTransform().setLocalPosition(new vec3(0, Math.sin(this.t * BOB_HZ * Math.PI * 2) * BOB_CM, 0))
  }

  hide(): void {
    this.root.enabled = false
  }
}
