/**
 * MarbleRunFx — confetti burst when a marble scores.
 *
 * Owns: a fixed pool of big tumbling confetti cards that fountain up from a point,
 * fall under gravity, spin and shrink away within about a second. The update runs
 * only while a burst is alive, so the effect costs nothing when idle.
 *
 * Must not: know about scoring or audio. Main calls burst(localPos).
 */
import {gameDelta, Mats, makeNode, unitBox} from "./MarbleRunPrims"

interface Piece {
  so: SceneObject
  vel: vec3
  spin: vec3
  age: number
  life: number
  sx: number
  sy: number
  active: boolean
}

const COLORS = [
  new vec4(1.0, 0.25, 0.35, 1), new vec4(1.0, 0.72, 0.1, 1), new vec4(0.2, 0.9, 0.5, 1),
  new vec4(0.2, 0.75, 1.0, 1), new vec4(0.75, 0.35, 1.0, 1), new vec4(1.0, 0.5, 0.15, 1),
]

@component
export class MarbleRunFx extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MarbleRunFx – goal confetti burst</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Confetti pieces per burst")
  @widget(new SliderWidget(8, 60, 1))
  piecesPerBurst: number = 34

  @input
  @hint("Size of a confetti card (cm)")
  @widget(new SliderWidget(0.5, 4, 0.1))
  pieceSizeCm: number = 2.2

  @input
  @hint("Upward launch speed (cm/s)")
  @widget(new SliderWidget(40, 300, 5))
  launchSpeed: number = 170
  @ui.group_end

  private pool: Piece[] = []
  private update: SceneEvent | null = null
  private mats = new Mats()

  onAwake(): void {
    const n = Math.max(8, Math.round(this.piecesPerBurst))
    for (let i = 0; i < n; i++) {
      const so = makeNode(this.sceneObject, "Confetti_" + i)
      const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = unitBox()
      rmv.mainMaterial = this.mats.unlit(COLORS[i % COLORS.length])
      so.enabled = false
      this.pool.push({so, vel: vec3.zero(), spin: vec3.zero(), age: 0, life: 1, sx: 1, sy: 1, active: false})
    }
    this.update = this.createEvent("UpdateEvent")
    this.update.bind(() => this.tick())
    this.update.enabled = false
  }

  burst(worldPos: vec3): void {
    for (const p of this.pool) {
      const a = Math.random() * Math.PI * 2
      const spread = 0.25 + Math.random() * 0.75
      p.vel = new vec3(Math.cos(a) * spread, 1, Math.sin(a) * spread).normalize()
        .uniformScale(this.launchSpeed * (0.65 + Math.random() * 0.55))
      p.spin = new vec3((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20)
      p.age = 0
      p.life = 0.55 + Math.random() * 0.4
      p.sx = this.pieceSizeCm * (0.7 + Math.random() * 0.6)
      p.sy = p.sx * (0.55 + Math.random() * 0.5)
      const t = p.so.getTransform()
      t.setWorldPosition(worldPos.add(new vec3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)))
      t.setLocalRotation(quat.angleAxis(Math.random() * Math.PI, new vec3(Math.random(), Math.random(), Math.random()).normalize()))
      t.setLocalScale(new vec3(p.sx, p.sy, 0.08))
      p.so.enabled = true
      p.active = true
    }
    if (this.update) this.update.enabled = true
  }

  private tick(): void {
    const dt = Math.min(gameDelta(), 0.05)
    let alive = 0
    for (const p of this.pool) {
      if (!p.active) continue
      p.age += dt
      if (p.age >= p.life) {
        p.active = false
        p.so.enabled = false
        continue
      }
      alive++
      p.vel = new vec3(p.vel.x * 0.985, p.vel.y - 420 * dt, p.vel.z * 0.985)
      const t = p.so.getTransform()
      t.setWorldPosition(t.getWorldPosition().add(p.vel.uniformScale(dt)))
      const r = t.getLocalRotation()
      t.setLocalRotation(r.multiply(quat.angleAxis(p.spin.length * dt, p.spin.normalize())))
      const fade = 1 - Math.pow(p.age / p.life, 3)
      t.setLocalScale(new vec3(p.sx * fade, p.sy * fade, 0.08))
    }
    if (alive === 0 && this.update) this.update.enabled = false
  }
}
