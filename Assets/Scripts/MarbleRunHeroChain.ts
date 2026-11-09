/**
 * MarbleRunHeroChain — the state machine for the hero chain reaction.
 *
 * Owns: run state (idle -> running -> resetting), detecting every stage from the
 * physics (bell trigger, domino tilt, waiting-marble contact, cup trigger),
 * retiring marbles, reset timing, and the automated test printout.
 *
 * Inputs: hero (geometry), pool (first marble). Main routes cup triggers to onCupEntered.
 * Must not: touch the UI directly — it fires callbacks that Main routes to the view.
 */
import {HERO} from "./MarbleRunHeroLayout"
import {MarbleRunHeroContraption} from "./MarbleRunHeroContraption"
import {Marble, MarbleRunMarblePool} from "./MarbleRunMarblePool"

export interface ChainCallbacks {
  onBell: () => void
  onDominoFall: (index: number) => void
  onRelease: () => void
  onGoal: () => void
  onMiss: () => void
  onReady: () => void
}

type ChainState = "idle" | "running" | "resetting"

// Seconds with no chain progress before a run counts as missed. Measured from the
// last stage, not the drop, because physics runs slower when the frame rate is low.
const STALL_TIMEOUT_SEC = 18
const NEW_MARBLE_DELAY_SEC = 0.4 // into the reset, once the dominoes are mostly upright
const NEW_MARBLE_GROW_SEC = 0.25
const AFTER_RELEASE_TIMEOUT_SEC = 8 // the last marble only has to fall into the cup, so a miss resets sooner
const RESET_DELAY_SEC = 1.3
const DOMINO_FALL_DEG = 45
const RELEASE_TILT_DEG = 26

export class MarbleRunHeroChain {
  private state: ChainState = "idle"
  private runIndex = 0
  private t = 0
  private lastProgressAt = 0
  private marble: Marble | null = null
  private bellRung = false
  private releaseDone = false
  private fallen = 0
  private goalAt = -1
  private waitingScaleT = -1
  private pendingHandoff = false // the scored marble moves to the pool on the next update, outside the physics callback
  private newMarbleT = -1 // time since the reset began, while a fresh waiting marble grows in
  private resetAt = -1
  private passedRuns = 0
  private autoRemaining = 0
  private autoTotal = 0
  private autoNextAt = -1
  private frameSum = 0
  private frameMax = 0
  private frameCount = 0

  constructor(
    private hero: MarbleRunHeroContraption,
    private pool: MarbleRunMarblePool,
    private callbacks: ChainCallbacks,
  ) {}

  /** Wires the bell ring into the chain. Call once after the hero is built. */
  bindHero(): void {
    this.hero.bell.onRing = (strength: number) => {
      if (this.state === "running" && !this.bellRung) {
        this.bellRung = true
        this.lastProgressAt = this.t
        this.log("bell")
        this.callbacks.onBell()
      } else if (this.state !== "running") {
        // A free-build marble rang it: the view still reacts, just no chain progress.
        void strength
      }
    }
  }

  get busy(): boolean { return this.state !== "idle" }

  /** Start a chain run. Returns false when one is already in flight or resetting. */
  drop(): boolean {
    if (this.state !== "idle" || !this.hero.exists) return false
    this.hero.armForRun()
    this.marble = this.pool.spawn(this.hero.spawnWorldPos, null, true, 0)
    this.state = "running"
    this.runIndex++
    this.t = 0
    this.lastProgressAt = 0
    this.bellRung = false
    this.releaseDone = false
    this.fallen = 0
    this.goalAt = -1
    this.resetAt = -1
    this.waitingScaleT = -1
    this.frameSum = 0
    this.frameMax = 0
    this.frameCount = 0
    this.log("drop")
    return true
  }

  /** Editor-only automated test: run the chain `count` times back to back. */
  startAuto(count: number): void {
    this.autoTotal = count
    this.autoRemaining = count
    this.passedRuns = 0
    this.autoNextAt = getTime() + 1.0
    print("[Chain] auto test: " + count + " runs")
  }

  /** A marble entered the cup. Returns true when it was the chain's waiting marble. */
  onCupEntered(collider: ColliderComponent): boolean {
    if (this.state !== "running" || !this.releaseDone || this.goalAt >= 0) return false
    if (collider !== this.hero.waitingBody) return false
    this.goalAt = this.t
    this.pendingHandoff = true
    this.log("goal")
    this.callbacks.onGoal()
    this.scheduleReset()
    return true
  }

  /** Abandon any run in progress and park the contraption (Clear/Undo/Floor). */
  abort(): void {
    if (this.marble) { this.pool.fadeOut(this.marble); this.marble = null }
    this.state = "idle"
    this.autoRemaining = 0
    this.autoNextAt = -1
    this.resetAt = -1
    this.waitingScaleT = -1
    this.pendingHandoff = false
    this.newMarbleT = -1
  }

  update(dt: number): void {
    if (this.state === "idle") {
      if (this.autoRemaining > 0 && this.autoNextAt > 0 && getTime() >= this.autoNextAt) {
        this.autoNextAt = -1
        this.drop()
      }
      return
    }
    this.t += dt
    if (this.pendingHandoff) {
      this.pendingHandoff = false
      const s = this.hero.takeWaitingMarble()
      if (s) this.pool.adopt(s.position, s.rotation, s.velocity, s.angularVelocity, s.color)
    }
    if (this.newMarbleT >= 0) {
      this.newMarbleT += dt
      if (this.newMarbleT >= NEW_MARBLE_DELAY_SEC) {
        this.hero.armWaitingMarble()
        this.hero.setWaitingScale((this.newMarbleT - NEW_MARBLE_DELAY_SEC) / NEW_MARBLE_GROW_SEC)
      }
    }
    if (dt > 0) {
      this.frameSum += dt
      this.frameCount++
      if (dt > this.frameMax) this.frameMax = dt
    }
    if (this.state === "running") this.updateRunning()
    if (this.waitingScaleT >= 0) {
      this.waitingScaleT += dt
      const f = 1 - this.waitingScaleT / 0.35
      if (f <= 0) { this.hero.hideWaitingMarble(); this.waitingScaleT = -1 }
      else this.hero.setWaitingScale(f)
    }
    if (this.resetAt > 0 && this.t >= this.resetAt) {
      this.resetAt = -1
      this.startReset()
    }
  }

  private updateRunning(): void {
    const dominoes = this.hero.dominoes
    for (let i = 0; i < dominoes.length; i++) {
      const d = dominoes[i]
      if (d.fallenReported) continue
      if (d.tiltDeg() >= DOMINO_FALL_DEG) {
        d.fallenReported = true
        this.lastProgressAt = this.t
        this.fallen++
        this.log("domino " + (i + 1) + " fell")
        this.callbacks.onDominoFall(i)
      }
    }
    // The last domino tips the waiting marble: go dynamic when it leans into the marble.
    if (!this.releaseDone && dominoes.length > 0 && dominoes[dominoes.length - 1].tiltDeg() >= RELEASE_TILT_DEG) {
      this.releaseDone = true
      this.lastProgressAt = this.t
      this.hero.releaseWaitingMarble()
      this.log("release")
      this.callbacks.onRelease()
    }
    const timeout = this.releaseDone ? AFTER_RELEASE_TIMEOUT_SEC : STALL_TIMEOUT_SEC
    if (this.goalAt < 0 && this.t - this.lastProgressAt > timeout) this.finish(false)
  }

  private scheduleReset(): void {
    this.resetAt = this.t + RESET_DELAY_SEC
  }

  private startReset(): void {
    this.state = "resetting"
    if (this.marble) this.pool.fadeOut(this.marble)
    this.marble = null
    if (this.goalAt >= 0) this.newMarbleT = 0 // the last marble stayed in the cup, so a new one grows on the shelf
    else this.waitingScaleT = 0
    this.log("reset begin")
    this.hero.beginReset(() => this.onResetDone())
  }

  private onResetDone(): void {
    this.hero.armWaitingMarble()
    this.state = "idle"
    this.waitingScaleT = -1
    this.newMarbleT = -1
    this.hero.setWaitingScale(1)
    const passed = this.goalAt >= 0 && this.bellRung && this.fallen >= HERO.dominoCount
    this.log("reset done; passed=" + passed + " bell=" + this.bellRung + " fallen=" + this.fallen + "/" + HERO.dominoCount +
      " goalAt=" + this.goalAt.toFixed(2) +
      " frameAvgMs=" + ((this.frameSum / Math.max(1, this.frameCount)) * 1000).toFixed(1) +
      " frameWorstMs=" + (this.frameMax * 1000).toFixed(1))
    this.callbacks.onReady()
    if (this.autoTotal > 0) {
      if (passed) this.passedRuns++
      this.autoRemaining--
      if (this.autoRemaining > 0) this.autoNextAt = getTime() + 1.0
      else {
        print("[Chain] RESULT passed=" + this.passedRuns + "/" + this.autoTotal)
        this.autoTotal = 0
      }
    }
  }

  private finish(success: boolean): void {
    if (this.state !== "running") return
    if (!success) {
      this.log("run failed: timeout t=" + this.t.toFixed(1) + " bell=" + this.bellRung + " fallen=" + this.fallen + " released=" + this.releaseDone)
      this.callbacks.onMiss()
      if (!this.releaseDone) {
        this.releaseDone = true
        this.hero.releaseWaitingMarble()
      }
    }
    this.goalAt = -1
    this.resetAt = this.t
    if (!success && this.autoTotal > 0) this.autoNextAt = -1
  }

  private log(stage: string): void {
    print("[Chain] run=" + this.runIndex + " " + stage + " t=" + this.t.toFixed(2))
  }
}
