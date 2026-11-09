/**
 * MarbleRunPhysicsWorld — gives the PlayArea subtree its own physics world.
 *
 * Owns: the Physics.WorldComponent on this SceneObject. A custom world avoids the
 * root world's implicit floor at y = 0 and runs at a higher simulation rate, so
 * small marbles and thin dominoes stay stable.
 *
 * Must sit ABOVE every collider it governs (it is the PlayArea root), and runs
 * in onAwake before child scripts create bodies.
 */
import {RECORDING_SLOWMO} from "./MarbleRunPrims"

const WORLD_SETTINGS = requireAsset("../Physics/MarbleRunWorldSettings.worldSettings") as Physics.WorldSettingsAsset

@component
export class MarbleRunPhysicsWorld extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MarbleRunPhysicsWorld – physics world for the play area</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Physics steps per second. Higher is more stable for small marbles and thin dominoes, but costs CPU")
  @widget(new ComboBoxWidget([
    new ComboBoxItem("120 Hz", 120),
    new ComboBoxItem("180 Hz", 180),
    new ComboBoxItem("240 Hz", 240),
  ]))
  simulationRateHz: number = 240

  @input
  @hint("Gravity strength multiplier (1 = real-world 980 cm/s^2)")
  @widget(new SliderWidget(0.3, 1.2, 0.05))
  gravityScale: number = 1.0

  @input
  @hint("Hard speed limit for any body (cm/s). Keeps marbles from tunnelling through thin walls")
  @widget(new SliderWidget(150, 800, 10))
  speedLimit: number = 400
  @ui.group_end

  onAwake(): void {
    WORLD_SETTINGS.simulationRate = this.simulationRateHz
    WORLD_SETTINGS.slowDownTime = RECORDING_SLOWMO
    WORLD_SETTINGS.gravity = new vec3(0, -980 * this.gravityScale, 0)
    WORLD_SETTINGS.absoluteSpeedLimit = this.speedLimit
    WORLD_SETTINGS.relativeSpeedLimit = 0
    let w = this.sceneObject.getComponent("Physics.WorldComponent") as WorldComponent
    if (!w) w = this.sceneObject.createComponent("Physics.WorldComponent") as WorldComponent
    w.worldSettings = WORLD_SETTINGS
    print("[MarbleRun] physics world ready: " + this.simulationRateHz + " Hz, gravity " + WORLD_SETTINGS.gravity.y)
  }
}
