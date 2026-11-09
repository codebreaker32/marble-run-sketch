/**
 * MarbleRunInputController — free-space pinch input for sketching and placing.
 *
 * Owns: per-frame reading of the primary SIK interactor (dominant hand on Specs,
 * mouse in the preview), stroke sampling (spacing + light smoothing), and the
 * aim ray used by the placement tools. Pinches that start on a UI element are
 * ignored, so tapping tool buttons never draws.
 *
 * Emits: onStrokeUpdate(points), onStrokeEnd(points), onAim(ray), onConfirm(ray).
 * Must not: build tracks or change modes — Main listens and decides.
 */
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
import {Interactor, InteractorInputType, InteractorTriggerType} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"

export type InputMode = "idle" | "draw" | "floor" | "goal" | "bell" | "domino"
export interface AimRay { start: vec3; end: vec3 }

@component
export class MarbleRunInputController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MarbleRunInputController – pinch to sketch + aim</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Fallback distance from the camera for mouse strokes when the draw plane can't be hit (cm)")
  @widget(new SliderWidget(25, 120, 1))
  editorDrawDepthCm: number = 60

  @input
  @hint("Minimum distance between recorded stroke samples (cm)")
  @widget(new SliderWidget(0.5, 4, 0.1))
  minPointSpacingCm: number = 1.5

  @input
  @hint("Input smoothing (0 = raw hand position, 0.9 = very smooth / laggy)")
  @widget(new SliderWidget(0, 0.9, 0.05))
  inputSmoothing: number = 0.5

  @input
  @hint("Length of the placement aim ray (cm)")
  @widget(new SliderWidget(100, 600, 10))
  aimRayLengthCm: number = 400
  @ui.group_end

  private mode: InputMode = "idle"
  private wasPinching = false
  private drawing = false
  private points: vec3[] = []
  private smoothed: vec3 | null = null
  private strokeInteractor: Interactor | null = null
  private mouseDrawPlane: (() => {point: vec3; normal: vec3}) | null = null

  private _onStrokeUpdate = new Event<vec3[]>()
  private _onStrokeEnd = new Event<vec3[]>()
  private _onAim = new Event<AimRay>()
  private _onConfirm = new Event<AimRay>()
  get onStrokeUpdate(): PublicApi<vec3[]> { return this._onStrokeUpdate.publicApi() }
  get onStrokeEnd(): PublicApi<vec3[]> { return this._onStrokeEnd.publicApi() }
  get onAim(): PublicApi<AimRay> { return this._onAim.publicApi() }
  get onConfirm(): PublicApi<AimRay> { return this._onConfirm.publicApi() }

  setMode(mode: InputMode): void {
    if (this.drawing && mode !== "draw") this.finishStroke()
    this.mode = mode
  }

  onAwake(): void {
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  /** Preview only: the plane mouse strokes are drawn on, so a stroke lands under the pointer at the build. */
  setMouseDrawPlane(plane: () => {point: vec3; normal: vec3}): void {
    this.mouseDrawPlane = plane
  }

  /** Drop a stroke in progress without building it. A held pinch can't start a new one. */
  cancelStroke(): void {
    this.drawing = false
    this.strokeInteractor = null
    this.points = []
    this.smoothed = null
  }

  /** Feed a complete world-space stroke through the normal pipeline. */
  injectStroke(worldPoints: vec3[]): void {
    this.beginStroke()
    for (const p of worldPoints) this.addSample(p, true)
    this.finishStroke()
  }

  private onUpdate(): void {
    if (this.drawing && this.strokeInteractor) { this.updateStroke(this.strokeInteractor); return }
    const it = this.primaryInteractor()
    if (!it) { if (this.drawing) this.finishStroke(); this.wasPinching = false; return }
    const pinching = (it.currentTrigger & InteractorTriggerType.Select) !== 0
    const overUI = it.currentInteractable !== null && it.currentInteractable !== undefined
    const justPressed = pinching && !this.wasPinching
    const justReleased = !pinching && this.wasPinching
    this.wasPinching = pinching

    if (this.mode === "draw") {
      if (justPressed && !overUI) {
        this.beginStroke()
        this.strokeInteractor = it
        this.updateStroke(it)
      }
    } else {
      // With no tool active a pinch is still a confirm: it picks where the marble drops.
      const ray = this.aimRay(it)
      if (ray) {
        if (this.mode !== "idle") this._onAim.invoke(ray)
        if (justReleased && !overUI) this._onConfirm.invoke(ray)
      }
    }
  }

  private updateStroke(it: Interactor): void {
    const hand = this.handFor(it)
    let pinching: boolean
    if (hand) {
      if (!hand.isTracked()) { this.finishStroke(); this.wasPinching = false; return }
      pinching = hand.isPinching()
    } else {
      pinching = (it.currentTrigger & InteractorTriggerType.Select) !== 0
    }
    if (!pinching) { this.finishStroke(); this.wasPinching = false; return }
    const p = this.drawPoint(it)
    if (p) this.addSample(p, false)
    this.wasPinching = true
  }

  private beginStroke(): void {
    this.drawing = true
    this.points = []
    this.smoothed = null
  }

  private addSample(p: vec3, raw: boolean): void {
    const a = raw ? 0 : this.inputSmoothing
    this.smoothed = this.smoothed ? vec3.lerp(p, this.smoothed, a) : p
    const last = this.points.length > 0 ? this.points[this.points.length - 1] : null
    if (!last || last.distance(this.smoothed) >= this.minPointSpacingCm) {
      this.points.push(this.smoothed)
      if (this.points.length > 600) this.points.shift()
      if (!raw) this._onStrokeUpdate.invoke(this.points)
    }
  }

  private finishStroke(): void {
    if (!this.drawing) return
    this.drawing = false
    this.strokeInteractor = null
    this._onStrokeEnd.invoke(this.points.slice())
    this.points = []
  }

  private primaryInteractor(): Interactor | null {
    const all = SIK.InteractionManager.getTargetingInteractors()
    let best: Interactor | null = null
    for (const it of all) {
      if (!it.isActive()) continue
      if (!best) best = it
      const hand = this.handFor(it)
      if (hand && hand.isDominantHand) return it
    }
    if (best) return best
    const mouse = SIK.InteractionManager.getInteractorsByType(InteractorInputType.Mouse)
    for (const it of mouse) if (it.isActive()) return it
    const hands = SIK.InteractionManager.getInteractorsByType(InteractorInputType.BothHands)
    for (const it of hands) if (it.isActive()) return it
    return null
  }

  private handFor(it: Interactor) {
    const hd = SIK.HandInputData
    if (it.inputType === InteractorInputType.RightHand) return hd.getHand("right")
    if (it.inputType === InteractorInputType.LeftHand) return hd.getHand("left")
    return null
  }

  private drawPoint(it: Interactor): vec3 | null {
    const hand = this.handFor(it)
    if (hand) {
      return hand.isTracked() ? hand.indexTip.position.add(hand.thumbTip.position).uniformScale(0.5) : null
    }
    const o = it.startPoint
    const d = it.direction
    if (!o || !d) return null
    const dir = d.normalize()
    if (this.mouseDrawPlane) {
      const plane = this.mouseDrawPlane()
      const denom = dir.dot(plane.normal)
      if (Math.abs(denom) > 0.05) {
        const t = plane.point.sub(o).dot(plane.normal) / denom
        if (t > 0) return o.add(dir.uniformScale(t))
      }
    }
    return o.add(dir.uniformScale(this.editorDrawDepthCm))
  }

  private aimRay(it: Interactor): AimRay | null {
    const o = it.startPoint
    const d = it.direction
    if (!o || !d) return null
    return {start: o, end: o.add(d.normalize().uniformScale(this.aimRayLengthCm))}
  }
}
