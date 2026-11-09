/**
 * MarbleRunMain — orchestrator for Marble Run.
 *
 * Owns: wiring between controllers, session state (via MarbleRunState), aligning
 * the PlayArea to the surface and the user, the undo history, and the Drop logic
 * (hero chain vs the most recently drawn track).
 *
 * Expects (wired in the scene): the tool panel, goal banner, PlayArea root, hero
 * contraption, tracks, pieces, marbles, goal cup, input, surface, audio, FX, and
 * the editor-only stand-in table.
 *
 * Must not: build UI or geometry (the UI modules and controllers do).
 */
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {MarbleRunAudio} from "./MarbleRunAudio"
import {MarbleRunFx} from "./MarbleRunFx"
import {MarbleRunGoalBannerUI} from "./MarbleRunGoalBannerUI"
import {MarbleRunGoalCup} from "./MarbleRunGoalCup"
import {MarbleRunHeroChain} from "./MarbleRunHeroChain"
import {MarbleRunHeroContraption} from "./MarbleRunHeroContraption"
import {HERO} from "./MarbleRunHeroLayout"
import {setColliderDebugAll} from "./MarbleRunColliderTags"
import {AimRay, MarbleRunInputController} from "./MarbleRunInputController"
import {MarbleImpact, MarbleRunMarblePool} from "./MarbleRunMarblePool"
import {MarbleRunPieces} from "./MarbleRunPieces"
import {MarbleRunPreviewStandIn} from "./MarbleRunPreviewStandIn"
import {gameDelta, Mats} from "./MarbleRunPrims"
import {MarbleRunState, STATUS_TEXT, ToolMode} from "./MarbleRunState"
import {MarbleRunSurfacePlacer} from "./MarbleRunSurfacePlacer"
import {MarbleRunToolPanelUI} from "./MarbleRunToolPanelUI"
import {BuiltTrack, MarbleRunTrackManager} from "./MarbleRunTrackManager"
import {MarbleRunDropMarker} from "./MarbleRunDropMarker"

type HistoryEntry = "hero" | "track" | "piece"
type DropChoice = {kind: "hero"} | {kind: "track"; track: BuiltTrack; point: vec3}

const DROP_PICK_TRACK_CM = 6 // how close an aim ray must pass to a track to pick a spot on it
const DROP_PICK_HERO_CM = 12 // the demo's funnel is a bigger target

@component
export class MarbleRunMain extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MarbleRunMain – orchestrates Marble Run</span>')
  @ui.separator
  @ui.group_start("References")
  @input @hint("Tool panel (UIKit module)") toolPanel: MarbleRunToolPanelUI
  @input @hint("Big GOAL! text above the cup") goalBanner: MarbleRunGoalBannerUI
  @input @hint("Root of all play content, placed on the table") playArea: SceneObject
  @input @hint("Parent of the tool panel, moved next to the user at start") uiRoot: SceneObject
  @input @hint("Ready-made chain reaction") contraption: MarbleRunHeroContraption
  @input @hint("Drawn tracks") tracks: MarbleRunTrackManager
  @input @hint("Placed bells and dominoes") pieces: MarbleRunPieces
  @input @hint("Spawns and retires marbles") marbles: MarbleRunMarblePool
  @input @hint("Pinch-to-sketch and aim input") inputController: MarbleRunInputController
  @input @hint("World Query floor + reticle") surface: MarbleRunSurfacePlacer
  @input @hint("Goal cup colliders + trigger") goalCup: MarbleRunGoalCup
  @input @hint("Sound effects + music") audio: MarbleRunAudio
  @input @hint("Goal confetti") fx: MarbleRunFx
  @input @hint("Editor-only stand-in picnic table") standIn: MarbleRunPreviewStandIn
  @ui.group_end

  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Horizontal distance from the user to the play area origin (cm)")
  @widget(new SliderWidget(30, 70, 1))
  playDistanceCm: number = 47

  @input
  @hint("Distance from the user's head to the tool panel (cm)")
  @widget(new SliderWidget(35, 70, 1))
  panelDistanceCm: number = 47
  @ui.group_end

  @ui.separator
  @ui.group_start("Debug")
  @input
  @hint("Editor only: run the hero chain this many times after start-up and print a PASS/FAIL summary")
  @widget(new SliderWidget(0, 20, 1))
  autoRunChainCount: number = 0

  @input
  @hint("Editor only: wireframe all physics colliders")
  debugColliders: boolean = false

  @input
  @hint("Editor only: hold the camera at a fixed review pose: 0 off, 1 overview, 2 left, 3 right, 4 top, 5 panel, 6 bell, 7 cup, 8 head")
  @widget(new SliderWidget(0, 8, 1))
  debugCameraPose: number = 0
  @ui.group_end

  private state = new MarbleRunState()
  private mats = new Mats()
  private chain!: MarbleRunHeroChain
  private history: HistoryEntry[] = []
  private setupDone = false
  private dropMarker!: MarbleRunDropMarker
  private dropChoice: DropChoice | null = null // null: drop on the newest thing built
  private headFlat = new vec3(0, 0, -1)
  private cameraT!: Transform

  onAwake(): void {
    const required: [unknown, string][] = [
      [this.toolPanel, "toolPanel"], [this.goalBanner, "goalBanner"], [this.playArea, "playArea"],
      [this.uiRoot, "uiRoot"], [this.contraption, "contraption"], [this.tracks, "tracks"],
      [this.pieces, "pieces"], [this.marbles, "marbles"], [this.inputController, "inputController"],
      [this.surface, "surface"], [this.goalCup, "goalCup"], [this.audio, "audio"], [this.fx, "fx"],
      [this.standIn, "standIn"],
    ]
    const missing = required.filter(([v]) => !v).map(([, n]) => n)
    if (missing.length > 0) {
      print("[MarbleRun] ERROR: required @input not wired: " + missing.join(", "))
      return
    }
    this.chain = new MarbleRunHeroChain(this.contraption, this.marbles, {
      onBell: () => this.audio.playBell(0.9),
      onDominoFall: (i) => this.audio.playDomino(0.3 + 0.1 * i),
      onRelease: () => this.toolPanel.setStatus("Dominoes tipped the marble!"),
      onGoal: () => this.onHeroGoal(),
      onMiss: () => this.toolPanel.setStatus("Missed! Resetting..."),
      onReady: () => this.onChainReady(),
    })
    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onStart(): void {
    this.cameraT = WorldCameraFinderProvider.getInstance().getTransform()
    this.goalBanner.setCamera(this.cameraT)
    this.tracks.init(this.mats)
    this.dropMarker = new MarbleRunDropMarker(this.tracks.getSceneObject(), this.mats)
    this.pieces.init(this.mats)
    this.goalCup.addGroundShadow(this.mats)

    this.toolPanel.onDraw.add(() => this.onToolPressed("draw"))
    this.toolPanel.onFloor.add(() => this.onToolPressed("floor"))
    this.toolPanel.onGoal.add(() => this.onToolPressed("goal"))
    this.toolPanel.onBell.add(() => this.onToolPressed("bell"))
    this.toolPanel.onDomino.add(() => this.onToolPressed("domino"))
    this.toolPanel.onDrop.add(() => { this.audio.playClick(); this.drop() })
    this.toolPanel.onUndo.add(() => { this.audio.playClick(); this.undoLast() })
    this.toolPanel.onClear.add(() => { this.audio.playClick(); this.clearAll() })

    this.inputController.onStrokeUpdate.add((pts) => this.tracks.setPreview(pts))
    this.inputController.onStrokeEnd.add((pts) => this.onStrokeEnd(pts))
    this.inputController.onAim.add((ray) => this.onAim(ray))
    this.inputController.onConfirm.add((ray) => this.onConfirm(ray))

    this.marbles.onImpact.add((e) => this.onImpact(e))
    this.goalCup.onMarbleEntered.add((c) => this.onCupEntered(c))
    this.tracks.setHeroPresence(() => this.contraption.exists)
    this.marbles.setCupZone((p) => this.goalCup.contains(p))
    this.inputController.setMouseDrawPlane(() => {
      const back = this.cameraT.forward
      const flat = new vec3(back.x, 0, back.z)
      return {point: this.goalCup.worldPosition, normal: flat.length > 1e-3 ? flat.normalize() : vec3.forward()}
    })
    this.pieces.onBellRing.add((s) => this.audio.playBell(s))

    this.toolPanel.setScore(0)
    this.toolPanel.setStatus("Looking for a table...")

    // Give device tracking a moment to report the head pose before placing content.
    const delay = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
    delay.bind(() => this.findSurface())
    delay.reset(0.3)
  }

  private findSurface(): void {
    const head = this.cameraT.getWorldPosition()
    const fwd = this.cameraT.forward.uniformScale(-1) // the camera looks down its -Z
    let flat = new vec3(fwd.x, 0, fwd.z)
    flat = flat.length > 1e-3 ? flat.normalize() : new vec3(0, 0, -1)
    this.headFlat = flat
    print("[MarbleRun] head at (" + head.x.toFixed(1) + "," + head.y.toFixed(1) + "," + head.z.toFixed(1) + ") forward (" + fwd.x.toFixed(2) + "," + fwd.y.toFixed(2) + "," + fwd.z.toFixed(2) + ")")

    if (global.deviceInfoSystem.isEditor()) {
      // Editor: the stand-in picnic table stands at a fixed spot on the simulated
      // plaza, so the preview camera can be anywhere when the Lens starts.
      const tableY = this.standIn.tableTopY
      const tablePos = new vec3(6, tableY, 358)
      this.headFlat = new vec3(0, 0, -1)
      this.placePlayArea(tablePos, tableY, this.standIn.topLengthCm, this.standIn.topDepthCm, tablePos.add(new vec3(0, 61, this.playDistanceCm)))
      this.standIn.buildIfEditor(this.mats)
      this.onSurfaceReady()
      return
    }
    const anchor = head.add(flat.uniformScale(this.playDistanceCm))
    this.surface.probeTable(head, flat, (y) => {
      if (y === null) {
        this.placePlayArea(new vec3(anchor.x, head.y - 85, anchor.z), head.y - 85, 400, 400, head)
        this.toolPanel.setStatus("No table found - aim at one with Floor")
      } else {
        this.placePlayArea(new vec3(anchor.x, y, anchor.z), y, 400, 400, head)
      }
      this.onSurfaceReady()
    })
  }

  /** Align the PlayArea on the surface, facing the user at `head`. */
  private placePlayArea(worldPos: vec3, tableY: number, extentX: number, extentZ: number, head: vec3): void {
    const flat = this.headFlat
    const pa = this.playArea.getTransform()
    pa.setWorldPosition(worldPos)
    pa.setWorldRotation(quat.angleAxis(Math.atan2(-flat.x, -flat.z), vec3.up()))
    this.surface.setTable(tableY, extentX, extentZ)
    this.marbles.setPlayBounds(tableY - 60, Math.max(extentX, extentZ) / 2 + 2)
    this.placePanel(head)
  }

  /** Tool panel: lower-left of the build, near the user, tilted to face them. */
  private placePanel(head: vec3): void {
    const pa = this.playArea.getTransform()
    const inv = pa.getInvertedWorldTransform()
    const localHead = inv.multiplyPoint(head)
    // Direction from the head toward the panel, in play-area space: left, down, forward.
    const dir = new vec3(-0.42, -0.74, -0.53).normalize()
    let p = localHead.add(dir.uniformScale(this.panelDistanceCm))
    if (p.y < 18) p = new vec3(p.x, 18, p.z)
    const ui = this.uiRoot.getTransform()
    ui.setLocalPosition(p)
    // Tilted up toward the user and square to the table, so it reads level.
    const pitch = (45 * Math.PI) / 180
    const facing = new vec3(0, Math.sin(pitch), Math.cos(pitch))
    ui.setLocalRotation(quat.lookAt(facing, vec3.up()))
  }

  private onSurfaceReady(): void {
    this.goalCup.placeLocal(new vec3(HERO.cupX, 0, HERO.cupZ))
    this.contraption.build(this.mats)
    this.chain.bindHero()
    this.history.push("hero")
    this.setupDone = true
    this.applyMode("idle")
    this.toolPanel.setStatus("Press Drop to run the marble")
    this.audio.playTrackPlace()
    print("[MarbleRun] contraption ready")

    if (global.deviceInfoSystem.isEditor()) {
      if (this.debugColliders) setColliderDebugAll(this.playArea, true)
      if (this.autoRunChainCount > 0) this.chain.startAuto(Math.round(this.autoRunChainCount))
    }
  }

  private onUpdate(): void {
    if (!this.setupDone) return
    const dt = gameDelta()
    this.contraption.update(dt)
    this.chain.update(dt)
    this.pieces.update(dt)
    this.updateDropMarker(dt)
    if (this.debugCameraPose > 0 && global.deviceInfoSystem.isEditor()) this.applyDebugCamera()
  }

  // ── Tools ────────────────────────────────────────────────────────────────
  private onToolPressed(mode: ToolMode): void {
    this.audio.playClick()
    this.applyMode(this.state.toggleMode(mode))
  }

  private applyMode(mode: ToolMode): void {
    this.state.setMode(mode)
    this.inputController.setMode(mode)
    this.toolPanel.setMode(mode)
    this.toolPanel.setStatus(STATUS_TEXT[mode])
    if (mode !== "floor" && mode !== "goal") this.surface.hideReticle()
    if (mode !== "bell" && mode !== "domino") this.pieces.setGhost(null, null, 0)
  }

  private onStrokeEnd(points: vec3[]): void {
    const t = this.tracks.addTrack(points)
    if (!t) {
      this.toolPanel.setStatus(this.tracks.blockedByShelf ? "Blocked by the domino shelf - try from the right" : "Too short or steep - draw a longer slope")
      return
    }
    this.history.push("track")
    this.dropChoice = null // a fresh track becomes the target until another spot is picked
    while (this.tracksInHistory() > this.tracks.trackCount) this.removeOldestTrackEntry()
    this.audio.playTrackPlace()
    if (this.tracks.trackCount >= 2) this.toolPanel.setStatus("Pinch any track to choose the drop spot")
    else this.toolPanel.setStatus(t.snapped ? "Track reaches the cup - press Drop" : "Track built - press Drop")
    print("[MarbleRun] track built: high " + this.fmt(t.highEnd) + " low " + this.fmt(t.lowEnd) + " snapped=" + t.snapped)
  }

  /** The Drop button: releases at the picked spot, or at the newest thing built when none is picked. */
  private drop(): void {
    if (!this.setupDone) return
    const target = this.resolveDrop()
    if (target && target.kind === "hero") {
      if (this.chain.busy) { this.toolPanel.setStatus("Watch the chain reaction..."); return }
      if (this.chain.drop()) this.toolPanel.setStatus("Here it goes!")
    } else if (target && target.kind === "track") {
      this.marbles.spawn(this.tracks.toWorld(target.point), null, false, this.marbles.nextColorIndex)
      this.audio.playDrop()
      this.toolPanel.setStatus("Marble away!")
    } else {
      // Nothing to drop onto: release a marble above the middle of the table.
      this.marbles.spawn(this.tracks.toWorld(new vec3(0, 20, 0)), null, false, 2)
      this.audio.playDrop()
      this.toolPanel.setStatus("No track yet - press Draw")
    }
  }

  /** Where the next marble goes: the picked spot if it still exists, else the newest thing built. */
  private resolveDrop(): DropChoice | null {
    const c = this.dropChoice
    if (c && c.kind === "track" && this.tracks.has(c.track)) return c
    if (c && c.kind === "hero" && this.contraption.exists) return c
    this.dropChoice = null
    const newest = this.dropTarget()
    if (newest === "hero") return {kind: "hero"}
    const t = this.tracks.lastTrack
    return newest === "track" && t ? {kind: "track", track: t, point: t.dropPoint} : null
  }

  /** A pinch with no tool active: pick the spot on a track, or the demo's funnel, under the aim ray. */
  private pickDropSpot(ray: AimRay): void {
    const hit = this.tracks.pickDropSpot(ray.start, ray.end, DROP_PICK_TRACK_CM)
    const heroMiss = this.contraption.exists ? this.rayMiss(ray, this.contraption.spawnWorldPos) : Infinity
    if (heroMiss <= DROP_PICK_HERO_CM && (!hit || heroMiss / DROP_PICK_HERO_CM < hit.missCm / DROP_PICK_TRACK_CM)) {
      this.dropChoice = {kind: "hero"}
      this.toolPanel.setStatus("Drop spot set: the chain reaction")
    } else if (hit) {
      this.dropChoice = {kind: "track", track: hit.track, point: hit.point}
      this.toolPanel.setStatus("Drop spot set - press Drop")
    } else {
      return
    }
    this.audio.playClick()
  }

  private rayMiss(ray: AimRay, p: vec3): number {
    const ab = ray.end.sub(ray.start)
    const k = Math.max(0, Math.min(1, p.sub(ray.start).dot(ab) / Math.max(1e-6, ab.dot(ab))))
    return ray.start.add(ab.uniformScale(k)).distance(p)
  }

  /** Shows the ghost marble once there's a choice to make, or after one was made. */
  private updateDropMarker(dt: number): void {
    const target = this.resolveDrop()
    const targets = (this.contraption.exists ? 1 : 0) + this.tracks.trackCount
    if (!target || this.chain.busy || (targets < 2 && !this.dropChoice)) { this.dropMarker.hide(); return }
    const local = target.kind === "track" ? target.point : this.tracks.worldToLocal(this.contraption.spawnWorldPos)
    this.dropMarker.show(local, dt)
  }

  private dropTarget(): "hero" | "track" | "none" {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i] === "track") return "track"
      if (this.history[i] === "hero") return "hero"
    }
    return "none"
  }

  private undoLast(): void {
    const last = this.history.pop()
    if (last === "track") {
      this.tracks.undo()
      this.toolPanel.setStatus("Removed the last track")
    } else if (last === "piece") {
      this.pieces.undoLast()
      this.toolPanel.setStatus("Removed the last piece")
    } else if (last === "hero") {
      this.chain.abort()
      this.marbles.clearLoose()
      this.contraption.destroyAll()
      this.toolPanel.setStatus("Demo removed - draw your own track")
    } else {
      this.toolPanel.setStatus("Nothing to undo")
    }
  }

  private clearAll(): void {
    this.inputController.cancelStroke()
    this.chain.abort()
    this.tracks.clearAll()
    this.pieces.clearAll()
    this.marbles.clearAll()
    if (this.contraption.exists) this.contraption.destroyAll()
    this.goalCup.placeLocal(new vec3(HERO.cupX, 0, HERO.cupZ))
    this.history = []
    this.dropChoice = null
    this.state.setScore(0)
    this.toolPanel.setScore(0)
    this.applyMode("idle")
    this.toolPanel.setStatus("Table cleared - draw a track")
    print("[MarbleRun] cleared")
  }

  private tracksInHistory(): number {
    let n = 0
    for (const h of this.history) if (h === "track") n++
    return n
  }

  private removeOldestTrackEntry(): void {
    const i = this.history.indexOf("track")
    if (i >= 0) this.history.splice(i, 1)
  }

  // ── Placement ────────────────────────────────────────────────────────────
  private onAim(ray: AimRay): void {
    const m = this.state.mode
    if (m === "floor" || m === "goal") {
      this.surface.aim(ray.start, ray.end, m)
    } else if (m === "bell" || m === "domino") {
      const hit = this.surface.intersectTable(ray.start, ray.end)
      const local = hit ? this.playArea.getTransform().getInvertedWorldTransform().multiplyPoint(hit.position) : null
      this.pieces.setGhost(m, local, this.yawTowardUser(local))
    }
  }

  private onConfirm(ray: AimRay): void {
    const m = this.state.mode
    if (m === "idle") { this.pickDropSpot(ray); return }
    if (m === "bell" || m === "domino") {
      const hit = this.surface.intersectTable(ray.start, ray.end)
      if (!hit) return
      const local = this.playArea.getTransform().getInvertedWorldTransform().multiplyPoint(hit.position)
      const cup = this.goalCup.localPosition
      const toCup = new vec3(cup.x - local.x, 0, cup.z - local.z).length
      if (!this.pieces.isSpotFree(local, m) || toCup < this.goalCup.outerRadiusCm + 3) {
        this.toolPanel.setStatus("Too close - pick another spot")
        return
      }
      const yaw = this.yawTowardUser(local)
      if (m === "bell") {
        this.pieces.placeBell(local, yaw)
        this.audio.playBell(0.4)
        this.toolPanel.setStatus("Bell placed - pinch for another")
      } else {
        this.pieces.placeDomino(local, yaw)
        this.audio.playDomino(0.3)
        this.toolPanel.setStatus("Domino placed - pinch for the next")
      }
      this.history.push("piece")
      return
    }
    if (m !== "floor" && m !== "goal") return
    const hit = this.surface.confirm()
    if (!hit) {
      const noSurface = global.deviceInfoSystem.isEditor() ? "Floor needs real glasses - the preview table is fixed" : "No flat surface there - try again"
      this.toolPanel.setStatus(m === "floor" ? noSurface : "Aim at the table")
      return
    }
    let done = "Cup moved"
    if (m === "goal") {
      const local = this.playArea.getTransform().getInvertedWorldTransform().multiplyPoint(hit.position)
      const before = this.goalCup.worldPosition
      this.goalCup.placeLocal(new vec3(local.x, 0, local.z))
      this.marbles.shiftKept(this.goalCup.worldPosition.sub(before))
    } else {
      this.moveFloor(hit.position.y)
      done = hit.fromWorldQuery ? "Table set on the real surface" : "Table height set"
    }
    this.audio.playClick()
    this.applyMode("idle")
    this.toolPanel.setStatus(done)
  }

  /** The new table height: everything on the PlayArea follows it. */
  private moveFloor(newTableY: number): void {
    this.chain.abort()
    this.marbles.clearAll()
    const pa = this.playArea.getTransform()
    const p = pa.getWorldPosition()
    pa.setWorldPosition(new vec3(p.x, newTableY, p.z))
    this.surface.setTable(newTableY, 400, 400)
    this.marbles.setPlayBounds(newTableY - 60, 202)
    this.contraption.parkNow()
    this.pieces.reparkDominoes()
    this.placePanel(this.cameraT.getWorldPosition())
    print("[MarbleRun] table moved to y=" + newTableY.toFixed(1))
  }

  /** Yaw (around Y, play-area space) that turns a placed piece to face the user. */
  private yawTowardUser(local: vec3 | null): number {
    if (!local) return 0
    const inv = this.playArea.getTransform().getInvertedWorldTransform()
    const head = inv.multiplyPoint(this.cameraT.getWorldPosition())
    return Math.atan2(head.x - local.x, head.z - local.z)
  }

  // ── Physics feedback ─────────────────────────────────────────────────────
  private onImpact(e: MarbleImpact): void {
    if (e.kind === "track" || e.kind === "cup" || e.kind === "shelf") this.audio.playClack(e.strength)
    else if (e.kind === "floor") this.audio.playBounce(e.strength)
    else if (e.kind === "domino") this.audio.playDomino(e.strength)
  }

  private onCupEntered(c: ColliderComponent): void {
    if (this.chain.onCupEntered(c)) return
    const gen = this.marbles.markScored(c)
    if (gen < 0) return
    this.awardGoal()
  }

  private onHeroGoal(): void {
    this.awardGoal()
    this.toolPanel.setStatus("GOAL! Press Drop to run it again")
  }

  private onChainReady(): void {
    this.toolPanel.setStatus("Press Drop to run the marble")
  }

  private awardGoal(): void {
    const score = this.state.addPoint()
    this.toolPanel.setScore(score)
    this.audio.playChime()
    const rimWorld = this.tracks.toWorld(this.goalCup.rimLocal)
    this.fx.burst(rimWorld)
    this.goalBanner.show(rimWorld.add(new vec3(0, 18, 0)))
    print("[MarbleRun] GOAL score=" + score)
  }

  // ── Editor-only debug ────────────────────────────────────────────────────
  private fmt(v: vec3): string {
    return "(" + v.x.toFixed(1) + "," + v.y.toFixed(1) + "," + v.z.toFixed(1) + ")"
  }

  private debugTrackingDisabled = false

  /** Review poses for automated screenshots; never used on device. */
  private applyDebugCamera(): void {
    if (!this.debugTrackingDisabled) {
      this.debugTrackingDisabled = true
      const camObj = this.cameraT.getSceneObject()
      const dt = camObj.getComponent("Component.DeviceTracking") as DeviceTracking
      if (dt) dt.enabled = false
    }
    const pose = Math.round(this.debugCameraPose)
    // Pose positions in PlayArea space (cm).
    const wt = this.playArea.getTransform().getWorldTransform()
    let eye = new vec3(0, 150, 150)
    let target = new vec3(0, 16, -3)
    if (pose === 6) { eye = new vec3(-8.5, 34, 12); target = new vec3(-8.5, 25, -20) }
    else if (pose === 7) { eye = new vec3(34, 34, 42); target = new vec3(20, 8, 15) }
    else if (pose === 8) { eye = new vec3(0, 61, 47); target = new vec3(1, 12, -3) }
    else if (pose === 2) { eye = new vec3(-120, 55, 18); target = new vec3(0, 16, -4) }
    else if (pose === 3) { eye = new vec3(120, 55, 18); target = new vec3(0, 16, -4) }
    else if (pose === 4) { eye = new vec3(2, 170, 0.1); target = new vec3(2, 0, -2) }
    else if (pose === 5) {
      const p = this.uiRoot.getTransform().getLocalPosition()
      eye = p.add(new vec3(0.5, 3, 30))
      target = p
    }
    const worldEye = wt.multiplyPoint(eye)
    const worldTarget = wt.multiplyPoint(target)
    this.cameraT.setWorldPosition(worldEye)
    this.cameraT.setWorldRotation(quat.lookAt(worldEye.sub(worldTarget).normalize(), vec3.up()))
  }
}
