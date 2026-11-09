/**
 * MarbleRunGoalBannerUI — the big "GOAL!" that pops above the cup.
 *
 * Owns: one bright world-space text that scales in, holds and fades. Passive view:
 * it holds no game state.
 *   Main -> UI : show(worldPosition), hide()
 */
import {gameDelta} from "./MarbleRunPrims"

@component
export class MarbleRunGoalBannerUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MarbleRunGoalBannerUI – goal feedback text</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Text shown when a marble lands in the cup")
  message: string = "GOAL!"

  @input("vec4", "{1,0.85,0.2,1}")
  @hint("Text colour")
  @widget(new ColorWidget())
  textColor: vec4

  @input
  @hint("Seconds the banner stays on screen")
  @widget(new SliderWidget(0.4, 3, 0.1))
  holdSeconds: number = 1.1
  @ui.group_end

  private text!: Text
  private root!: SceneObject
  private t = -1
  private update: SceneEvent | null = null
  private cameraTransform: Transform | null = null

  /** Assign the camera used to billboard the banner. */
  setCamera(cam: Transform): void { this.cameraTransform = cam }

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    this.root = global.scene.createSceneObject("GoalBannerText")
    this.root.setParent(this.sceneObject)
    this.text = this.root.createComponent("Component.Text") as Text
    this.text.text = this.message
    this.text.depthTest = false
    this.text.size = 170
    ;(this.text as Text & {weight?: number}).weight = 800
    this.text.horizontalAlignment = HorizontalAlignment.Center
    this.text.verticalAlignment = VerticalAlignment.Center
    this.text.horizontalOverflow = HorizontalOverflow.Overflow
    this.text.verticalOverflow = VerticalOverflow.Overflow
    this.text.layoutRect = Rect.create(-14, 14, -5, 5)
    this.text.textFill.color = this.textColor
    this.root.enabled = false
    this.update = this.createEvent("UpdateEvent")
    this.update.bind(() => this.tick())
    this.update.enabled = false
  }

  /** Show the banner above `worldPos`, popping in then fading away. */
  show(worldPos: vec3): void {
    this.sceneObject.getTransform().setWorldPosition(worldPos)
    this.t = 0
    this.root.enabled = true
    this.apply(0)
    if (this.update) this.update.enabled = true
  }

  hide(): void {
    this.t = -1
    this.root.enabled = false
    if (this.update) this.update.enabled = false
  }

  private tick(): void {
    this.t += gameDelta()
    if (this.t >= this.holdSeconds) { this.hide(); return }
    this.apply(this.t)
    if (this.cameraTransform) {
      const camPos = this.cameraTransform.getWorldPosition()
      const here = this.sceneObject.getTransform().getWorldPosition()
      const dir = camPos.sub(here)
      if (dir.length > 0.1) {
        this.sceneObject.getTransform().setWorldRotation(quat.lookAt(dir.normalize(), vec3.up()))
      }
    }
  }

  private apply(t: number): void {
    const pop = t < 0.15 ? t / 0.15 : 1
    const s = 0.4 + 0.6 * pop * pop
    this.root.getTransform().setLocalScale(new vec3(s, s, s))
    const fade = t > this.holdSeconds - 0.3 ? (this.holdSeconds - t) / 0.3 : 1
    const c = this.textColor
    this.text.textFill.color = new vec4(c.x, c.y, c.z, c.w * Math.max(0, fade))
  }
}
