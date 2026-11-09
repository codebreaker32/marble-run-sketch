/**
 * MarbleRunPreviewStandIn — EDITOR-ONLY stand-in wooden picnic table.
 *
 * The real Specs experience uses the table the user is standing at, found with
 * World Query. Lens Studio's simulated outdoor scene has no table, so in the
 * editor only this builds one on the simulated ground: top surface at this
 * object's y = 0 (the PlayArea origin), planks, legs. On device it destroys itself.
 *
 * Must not: exist on device, or affect anything but visuals (floor collider lives
 * in MarbleRunSurfacePlacer).
 */
import {Mats, addBox, addCylinderBetween, makeNode, addVisual, unitBox} from "./MarbleRunPrims"

@component
export class MarbleRunPreviewStandIn extends BaseScriptComponent {
  @ui.label('<span style="color: #FFB74D;">PREVIEW STAND-IN (editor only) – a picnic table on the simulated ground</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Tabletop length (cm)")
  @widget(new SliderWidget(70, 140, 1))
  topLengthCm: number = 100

  @input
  @hint("Tabletop depth (cm)")
  @widget(new SliderWidget(45, 90, 1))
  topDepthCm: number = 62

  @input
  @hint("Tabletop height above the simulated ground (cm)")
  @widget(new SliderWidget(60, 90, 1))
  tableHeightCm: number = 74

  @input
  @hint("World Y of the simulated ground (cm); the table's feet rest here")
  @widget(new SliderWidget(-30, 30, 0.5))
  groundY: number = 0
  @ui.group_end

  private built = false

  /** World Y of the table top (editor only). */
  get tableTopY(): number { return this.groundY + this.tableHeightCm }

  onAwake(): void {
    if (!global.deviceInfoSystem.isEditor()) {
      this.sceneObject.destroy()
    }
  }

  /** Editor only: build the table visuals under this node. */
  buildIfEditor(mats: Mats): void {
    if (!global.deviceInfoSystem.isEditor() || this.built) return
    this.built = true
    const root = makeNode(this.sceneObject, "PicnicTable")
    const L = this.topLengthCm
    const D = this.topDepthCm
    const planks = 7
    const gap = 0.7
    const plankW = (D - gap * (planks - 1)) / planks
    const thickness = 3
    for (let i = 0; i < planks; i++) {
      const tone = 0.92 + (((i * 37) % 11) / 11) * 0.16
      const c = new vec4(0.72 * tone, 0.5 * tone, 0.3 * tone, 1)
      const z = -D / 2 + plankW / 2 + i * (plankW + gap)
      addBox(root, "Plank_" + i, new vec3(L, thickness, plankW), new vec3(0, -thickness / 2, z), undefined, mats.pbr(c))
    }
    const wood = mats.pbr(new vec4(0.6, 0.42, 0.25, 1))
    // Underframe.
    addBox(root, "Rail_L", new vec3(L * 0.9, 3, 4), new vec3(0, -thickness - 1.5, -D / 2 + 8), undefined, wood)
    addBox(root, "Rail_R", new vec3(L * 0.9, 3, 4), new vec3(0, -thickness - 1.5, D / 2 - 8), undefined, wood)
    // Splayed legs from the table edge to the ground.
    const legX = L / 2 - 10
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const top = new vec3(sx * legX, -thickness, sz * (D / 2 - 9))
        const foot = new vec3(sx * (legX + 8), -this.tableHeightCm, sz * (D / 2 - 2))
        addCylinderBetween(root, "Leg", top, foot, 2.2, wood)
        addVisual(root, "GroundShadow", unitBox(), mats.shadow(), new vec3(foot.x, -this.tableHeightCm + 0.06, foot.z), new vec3(12, 0.001, 12))
      }
    }
    print("[MarbleRun] preview stand-in table built (editor only), top at y=" + this.tableTopY)
  }
}
