/**
 * MarbleRunGoalCup — the goal cup's physics and scoring trigger.
 *
 * Owns: static colliders that approximate the cup GLB (a base slab plus a ring of
 * wall boxes), an internal trigger volume, and the cup's contact shadow. The GLB
 * visual is an authored child (GoalCupVisual); this script never scales it.
 * The SceneObject's origin is the cup's base centre (GLB grounded at min-Y = 0).
 *
 * Emits onMarbleEntered(collider). Must not keep score — Main does.
 */
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {tagCollider, surfaceKindOf} from "./MarbleRunColliderTags"
import {Mats, addCylinderBetween, addShadow} from "./MarbleRunPrims"

const CUP_MATTER = requireAsset("../Physics/CupMatter.matter") as Matter
const TARGET_ORANGE = new vec4(0.95, 0.42, 0.14, 1)

@component
export class MarbleRunGoalCup extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MarbleRunGoalCup – cup colliders + goal trigger</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Inner radius of the cup opening (cm); must match the GoalCup mesh")
  @widget(new SliderWidget(3, 10, 0.1))
  innerRadiusCm: number = 5.6

  @input
  @hint("Height of the cup walls (cm); must match the GoalCup mesh")
  @widget(new SliderWidget(4, 15, 0.1))
  wallHeightCm: number = 9.3
  @ui.group_end

  private _onMarbleEntered = new Event<ColliderComponent>()
  get onMarbleEntered(): PublicApi<ColliderComponent> { return this._onMarbleEntered.publicApi() }

  get localPosition(): vec3 { return this.sceneObject.getTransform().getLocalPosition() }
  get worldPosition(): vec3 { return this.sceneObject.getTransform().getWorldPosition() }

  /** Local-space point on the cup axis at rim height. */
  get rimLocal(): vec3 {
    const p = this.localPosition
    return new vec3(p.x, p.y + this.wallHeightCm, p.z)
  }

  get outerRadiusCm(): number { return this.innerRadiusCm + 1.3 }

  onAwake(): void {
    this.buildColliders()
  }

  /** Attach the soft shadow once materials exist; idempotent per call site. */
  addGroundShadow(mats: Mats): void {
    addShadow(this.sceneObject, mats, 0, 0, this.outerRadiusCm * 1.9)
    // Bright target disc on the cup floor; also covers a texture smear in the GLB.
    addCylinderBetween(this.sceneObject, "CupFloorTarget", new vec3(0, 2.8, 0), new vec3(0, 3.0, 0), 3.6, mats.pbr(TARGET_ORANGE))
  }

  /** True for a world point inside the cup or heaped up above its opening. */
  contains(world: vec3): boolean {
    const local = this.sceneObject.getTransform().getInvertedWorldTransform().multiplyPoint(world)
    const r = Math.sqrt(local.x * local.x + local.z * local.z)
    return r <= this.innerRadiusCm + 0.8 && local.y > 0 && local.y <= this.wallHeightCm + 9
  }

  /** Move the cup; `pos` is in the parent (PlayArea) frame. */
  placeLocal(pos: vec3): void {
    this.sceneObject.getTransform().setLocalPosition(pos)
  }

  private buildColliders(): void {
    const root = global.scene.createSceneObject("CupColliders")
    root.setParent(this.sceneObject)
    const floorT = 3.0 // top of the visual floor target, so marbles rest on it instead of sinking in
    this.box(root, "CupFloor", new vec3(0, floorT / 2, 0), quat.quatIdentity(),
      new vec3(this.innerRadiusCm * 2.2, floorT, this.innerRadiusCm * 2.2))

    const n = 14
    const thick = 1.0
    const r = this.innerRadiusCm + thick / 2
    const segLen = (2 * Math.PI * r / n) * 1.15
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const pos = new vec3(Math.sin(a) * r, this.wallHeightCm / 2, Math.cos(a) * r)
      this.box(root, "CupWall_" + i, pos, quat.angleAxis(a, vec3.up()), new vec3(segLen, this.wallHeightCm, thick))
    }

    const trig = global.scene.createSceneObject("GoalTrigger")
    trig.setParent(root)
    // Tall enough to catch a marble landing on top of a full cup.
    const trigTop = this.wallHeightCm + 2.7
    trig.getTransform().setLocalPosition(new vec3(0, (floorT + trigTop) / 2, 0))
    const tc = trig.createComponent("Physics.ColliderComponent") as ColliderComponent
    const ts = Shape.createBoxShape()
    ts.size = new vec3(this.innerRadiusCm * 1.55, trigTop - floorT, this.innerRadiusCm * 1.55)
    tc.shape = ts
    tc.intangible = true
    tc.onOverlapEnter.add((e: OverlapEnterEventArgs) => {
      if (surfaceKindOf(e.overlap.collider) === "marble") this._onMarbleEntered.invoke(e.overlap.collider)
    })
  }

  private box(parent: SceneObject, name: string, pos: vec3, rot: quat, size: vec3): void {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    so.getTransform().setLocalPosition(pos)
    so.getTransform().setLocalRotation(rot)
    const c = so.createComponent("Physics.ColliderComponent") as ColliderComponent
    const s = Shape.createBoxShape()
    s.size = size
    c.shape = s
    c.matter = CUP_MATTER
    tagCollider(c, "cup")
  }
}
