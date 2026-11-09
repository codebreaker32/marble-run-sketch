/**
 * Shared helpers for the Marble Run Sketch LEAF scenarios.
 *
 * Every panel button is pressed with LEAF's simulated right hand:
 * LeafHandInteractor.get("right").trigger(button) moves the simulated hand onto
 * the UIKit button, pinches, and drives the real SIK HandInteractor through
 * hover -> trigger start -> trigger end on the button's Interactable. UIKit then
 * fires Button.onTriggerUp, the panel fires its event and MarbleRunMain reacts.
 * Nothing calls MarbleRunMain's methods to act; private fields are only READ,
 * through an `any` view, so no game script is changed for testing.
 *
 * Free-space input (drawing a stroke, placing a piece) uses the same simulated
 * hand against MarbleRunInputController's real per-frame path. LEAF interactors
 * report isTargeting() only while hovering an Interactable, and the controller
 * picks its interactor from the targeting list, so SimulatedPinch makes the
 * hand report targeting for the duration of the gesture. That is the only
 * thing it overrides, and only on the test's hand instance.
 */
import {findInteractableByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {PINCH_POSITION_OFFSET} from "Leaf.lspkg/Interactors/interactor/handInput/Gestures"
import {LeafHandInteractor} from "Leaf.lspkg/Interactors/interactor/LeafTwoHandInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, nextFrame, sleep, withTimeout} from "Leaf.lspkg/Utils/common/Utils"
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
import {MarbleRunMain} from "../Scripts/MarbleRunMain"
import {HERO, waitingMarblePos} from "../Scripts/MarbleRunHeroLayout"

export const TOOL_CAPTIONS = ["Draw", "Drop", "Undo", "Clear", "Floor", "Goal", "Bell", "Domino"]

/** The chain's own definition of a fallen domino (MarbleRunHeroChain.DOMINO_FALL_DEG). */
export const FALLEN_DEG = 45
/** A domino must tilt about 19 deg before it can touch the next one, so 15 deg marks the wave reaching it. */
export const TIPPING_DEG = 15

const PRESS_TIMEOUT_MS = 12000
/** A run ends within 18 s (chain timeout) + 1.3 s reset delay + 0.7 s reset animation. */
const HERO_RUN_TIMEOUT_MS = 30000

export function log(msg: string): void {
  print("[MarbleLeaf] " + msg)
}

export function fmt(v: vec3): string {
  return "(" + v.x.toFixed(1) + "," + v.y.toFixed(1) + "," + v.z.toFixed(1) + ")"
}

export async function frames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await nextFrame()
}

/** Runs `each` every frame until `cond` is true or the timeout passes; returns whether it became true. */
export async function framesUntil(cond: () => boolean, timeoutMs: number, each?: () => void): Promise<boolean> {
  const t0 = getTime()
  while ((getTime() - t0) * 1000 < timeoutMs) {
    if (each) each()
    if (cond()) return true
    await nextFrame()
  }
  if (each) each()
  return cond()
}

/** MarbleRunMain on the "MarbleRun" scene object, viewed as `any` to read private state. */
export function getMain(): any {
  const so = findSceneObjectByName("MarbleRun")
  if (!so) throw new Error('Scene object "MarbleRun" not found')
  const main = so.getComponent(MarbleRunMain.getTypeName()) as MarbleRunMain
  if (!main) throw new Error("MarbleRunMain component not found on MarbleRun")
  return main as any
}

/** Waits for the contraption to be built and all eight UIKit buttons to be pressable. */
export async function waitForLensReady(timeoutMs: number = 15000): Promise<any> {
  const main = getMain()
  const setup = await framesUntil(() => main.setupDone === true, timeoutMs)
  expect(setup, "MarbleRunMain never finished setup").toBe(true)
  const buttons = await framesUntil(
    () => TOOL_CAPTIONS.every((c) => !!findInteractableByName("Tool_" + c, undefined, true)),
    timeoutMs,
  )
  expect(buttons, "not all Tool_* buttons became enabled Interactables").toBe(true)
  await sleep(500)
  log("ready: score=" + main.state.score + " mode=" + main.state.mode + " status='" + status(main) + "'" +
    " tracks=" + main.tracks.trackCount + " pieces=" + main.pieces.count + " heroExists=" + main.contraption.exists)
  return main
}

export function status(main: any): string {
  return main.toolPanel.statusText ? main.toolPanel.statusText.text : ""
}

export function scoreLabel(main: any): string {
  return main.toolPanel.scoreText ? main.toolPanel.scoreText.text : ""
}

export function rightHand(): any {
  return LeafHandInteractor.get("right")
}

/** Pinches the real UIKit button "Tool_<caption>" with LEAF's simulated right hand. */
export async function pressButton(caption: string): Promise<void> {
  const name = "Tool_" + caption
  const button = findInteractableByName(name, undefined, true)
  if (!button) throw new Error('Interactable "' + name + '" not found or not enabled')
  await withTimeout(rightHand().trigger(button) as Promise<void>, PRESS_TIMEOUT_MS, "Timed out pinching " + name)
  await sleep(120)
}

/** World position of a PlayArea-local point. */
export function toWorld(main: any, local: vec3): vec3 {
  return main.playArea.getTransform().getWorldTransform().multiplyPoint(local)
}

/** Where the Lens places the user's head in the editor (see MarbleRunMain.findSurface). */
export function designHead(main: any): vec3 {
  return toWorld(main, new vec3(0, 61, main.playDistanceCm))
}

/** Piecewise-linear world-space stroke through PlayArea-local waypoints, about 1 cm per sample. */
export function strokeThrough(main: any, localPoints: vec3[]): vec3[] {
  const out: vec3[] = []
  for (let i = 0; i < localPoints.length - 1; i++) {
    const a = localPoints[i]
    const b = localPoints[i + 1]
    const n = Math.max(1, Math.ceil(a.distance(b)))
    for (let k = 0; k < n; k++) out.push(vec3.lerp(a, b, k / n))
  }
  out.push(localPoints[localPoints.length - 1])
  return out.map((p) => toWorld(main, p))
}

/** Free-space pinches with LEAF's simulated right hand, through the input controller's per-frame path. */
export class SimulatedPinch {
  private leaf: any = rightHand()
  private sik: any = this.leaf.sikInteractor
  private savedIsTargeting: (() => boolean) | null = null

  constructor(private main: any) {}

  private enterFreeSpace(): void {
    if (this.savedIsTargeting) return
    this.savedIsTargeting = this.sik.isTargeting
    this.sik.isTargeting = () => true
  }

  private exitFreeSpace(): void {
    if (!this.savedIsTargeting) return
    this.sik.isTargeting = this.savedIsTargeting
    this.savedIsTargeting = null
  }

  private expectControllerUsesHand(): void {
    const primary = this.main.inputController.primaryInteractor()
    expect(primary === this.sik, "input controller is not reading the simulated right hand").toBe(true)
  }

  private pinchMidpoint(): vec3 {
    const hand = this.leaf.hand
    return hand.indexTip.position.add(hand.thumbTip.position).uniformScale(0.5)
  }

  /** Pinch at the first point, drag through the rest, release: a real sketch stroke. */
  async drawStroke(worldPoints: vec3[]): Promise<void> {
    const hand = this.leaf.hand
    const controller = this.main.inputController
    this.enterFreeSpace()
    try {
      await nextFrame()
      this.expectControllerUsesHand()
      await hand.makeGesture("pinch")
      const firstRoot = worldPoints[0].add(PINCH_POSITION_OFFSET.right)
      await hand.setPosition(firstRoot, 300)
      await frames(2)
      // Measured rather than assumed: the hand root's offset from its pinch point in this pose.
      const rootOffset = firstRoot.sub(this.pinchMidpoint())
      await hand.setPosition(worldPoints[0].add(rootOffset), 0)
      await frames(2)

      this.leaf.startSelecting()
      await frames(3)
      expect(controller.drawing === true, "pinch did not begin a stroke").toBe(true)

      for (const p of worldPoints) {
        await hand.setPosition(p.add(rootOffset), 0)
        await nextFrame()
        expect(controller.drawing === true, "the stroke ended before the hand finished moving").toBe(true)
      }
      await frames(12) // hold at the end so the controller's input smoothing catches up

      this.leaf.stopSelecting()
      await frames(2)
      await hand.makeGesture("neutral", undefined, 150)
      const ended = await framesUntil(() => controller.drawing === false, 2000)
      expect(ended, "releasing the pinch did not finish the stroke").toBe(true)
    } finally {
      this.leaf.stopSelecting()
      this.exitFreeSpace()
    }
  }

  /** Aim from `from` at a point on the table, pinch and release: a Bell or Domino placement. */
  async placeAt(worldPoint: vec3, from: vec3): Promise<void> {
    const hand = this.leaf.hand
    this.enterFreeSpace()
    try {
      this.leaf.startPoint = from
      this.leaf.endPoint = worldPoint
      await nextFrame()
      this.expectControllerUsesHand()
      await hand.setPosition(worldPoint.add(PINCH_POSITION_OFFSET.right), 300)
      await hand.makeGesture("pinch")
      await frames(3) // the aim ray updates the placement ghost
      this.leaf.startSelecting()
      await frames(3)
      this.leaf.stopSelecting()
      await frames(4) // the release frame confirms the placement
      await hand.makeGesture("neutral", undefined, 150)
      await frames(2)
    } finally {
      this.leaf.stopSelecting()
      this.exitFreeSpace()
    }
  }
}

/** What one Drop-driven hero run did, sampled every frame from the physics. */
export interface HeroRun {
  runIndex: number
  finished: boolean
  tippedAt: number[]
  fellAt: number[]
  maxTiltDeg: number[]
  bellRingAt: number
  statusDuringRun: string
}

/** Pinches Tool_Drop and samples the domino physics every frame until the hero run has fully reset. */
export async function runHeroDrop(main: any): Promise<HeroRun> {
  const chain = main.chain
  const hero = main.contraption
  const n: number = hero.dominoes.length
  const run: HeroRun = {
    runIndex: chain.runIndex,
    finished: false,
    tippedAt: new Array(n).fill(-1),
    fellAt: new Array(n).fill(-1),
    maxTiltDeg: new Array(n).fill(0),
    bellRingAt: hero.bell.lastRingAt,
    statusDuringRun: "",
  }
  let started = false
  let pressError: unknown = null
  const t0 = getTime()
  const press = pressButton("Drop").catch((e) => { pressError = e })

  run.finished = await framesUntil(
    () => {
      if (pressError) return true
      if (chain.busy && !started) {
        started = true
        run.statusDuringRun = status(main)
      }
      return started && !chain.busy
    },
    HERO_RUN_TIMEOUT_MS,
    () => {
      if (!started && !chain.busy) return
      const now = getTime() - t0
      for (let i = 0; i < n; i++) {
        const tilt: number = hero.dominoes[i].tiltDeg()
        if (tilt > run.maxTiltDeg[i]) run.maxTiltDeg[i] = tilt
        if (run.tippedAt[i] < 0 && tilt >= TIPPING_DEG) run.tippedAt[i] = now
        if (run.fellAt[i] < 0 && tilt >= FALLEN_DEG) run.fellAt[i] = now
      }
    },
  )
  await press
  if (pressError) throw pressError
  log("hero run " + chain.runIndex + ": finished=" + run.finished + " bellRung=" + chain.bellRung + " fallen=" + chain.fallen +
    " goalAt=" + chain.goalAt.toFixed(2) + " score=" + main.state.score + " status='" + status(main) + "'")
  log("  tippedAt(s)=" + run.tippedAt.map((t) => t.toFixed(2)).join(",") +
    "  fellAt(s)=" + run.fellAt.map((t) => t.toFixed(2)).join(",") +
    "  maxTilt(deg)=" + run.maxTiltDeg.map((t) => t.toFixed(0)).join(","))
  return run
}

/** Done criteria 1 and 2 for one Drop press: bell, all dominoes, goal, exactly one point. */
export function assertHeroRun(main: any, run: HeroRun, scoreBefore: number, label: string): void {
  const chain = main.chain
  const hero = main.contraption
  expect(run.finished, label + ": the run never finished (chain state '" + chain.state + "')").toBe(true)
  expect(chain.runIndex, label + ": Tool_Drop did not start exactly one chain run").toBe(run.runIndex + 1)
  expect(run.statusDuringRun, label + ": wrong status after pressing Drop").toBe("Here it goes!")
  expect(chain.bellRung, label + ": the chain never registered the bell").toBe(true)
  expect(hero.bell.lastRingAt > run.bellRingAt, label + ": the bell unit never rang").toBe(true)
  expect(chain.fallen, label + ": the chain did not count every domino as fallen").toBe(HERO.dominoCount)
  for (let i = 0; i < run.maxTiltDeg.length; i++) {
    expect(run.maxTiltDeg[i] >= FALLEN_DEG,
      label + ": domino " + (i + 1) + " only tilted " + run.maxTiltDeg[i].toFixed(1) + " deg").toBe(true)
  }
  expect(chain.goalAt >= 0, label + ": no goal was registered").toBe(true)
  expect(main.state.score, label + ": score did not rise by exactly 1").toBe(scoreBefore + 1)
  expect(scoreLabel(main), label + ": the panel score does not show the new score").toBe("" + (scoreBefore + 1))
}

/** The contraption is ready to run again: dominoes standing at home, waiting marble back, nothing live. */
export function assertContraptionReset(main: any, label: string): void {
  const chain = main.chain
  const hero = main.contraption
  expect(chain.busy, label + ": chain still busy").toBe(false)
  expect(status(main), label + ": wrong status after the reset").toBe("Press Drop to run the marble")
  expect(hero.dominoes.length, label + ": dominoes missing").toBe(HERO.dominoCount)
  for (let i = 0; i < hero.dominoes.length; i++) {
    const d = hero.dominoes[i]
    const tilt: number = d.tiltDeg()
    const offset: number = d.so.getTransform().getLocalPosition().distance(d.homePos)
    expect(tilt < 2, label + ": domino " + (i + 1) + " not standing, tilt " + tilt.toFixed(1) + " deg").toBe(true)
    expect(offset < 0.2, label + ": domino " + (i + 1) + " is " + offset.toFixed(2) + " cm from home").toBe(true)
    expect(d.body.dynamic, label + ": domino " + (i + 1) + " not parked").toBe(false)
  }
  const waiting = hero.waiting
  expect(!!waiting && waiting.so.enabled, label + ": waiting marble is not back").toBe(true)
  expect(waiting.body.dynamic, label + ": waiting marble not parked").toBe(false)
  const offset: number = waiting.so.getTransform().getLocalPosition().distance(waitingMarblePos())
  expect(offset < 0.2, label + ": waiting marble is " + offset.toFixed(2) + " cm from its perch").toBe(true)
  const scale: vec3 = waiting.visual.getTransform().getLocalScale()
  expect(scale.distance(waiting.scale) < 0.001, label + ": waiting marble not back at full size").toBe(true)
  expect(main.marbles.activeCount, label + ": a marble is still live after the reset").toBe(0)
}

/**
 * Which Interactable SIK would target along a ray from the user's head through a
 * panel button. Applies SIK's own rule (TargetProvider): rayCastAll, nearest
 * first, skipping colliders that belong to no Interactable, such as the
 * InteractionPlane helper collider that sits in front of the panel.
 */
export function targetFromHead(main: any, caption: string): Promise<{hitButton: boolean; hitName: string}> {
  const button = findInteractableByName("Tool_" + caption, undefined, true)
  if (!button) throw new Error("Tool_" + caption + " not found")
  const head = designHead(main)
  const target = button.getTransform().getWorldPosition()
  const end = head.add(target.sub(head).uniformScale(1.25))
  const result = new Promise<{hitButton: boolean; hitName: string}>((resolve) => {
    Physics.createGlobalProbe().rayCastAll(head, end, (hits: RayCastHit[]) => {
      for (const hit of hits) {
        const interactable = SIK.InteractionManager.getInteractableByCollider(hit.collider)
        if (interactable === null) continue
        resolve({hitButton: interactable === button, hitName: interactable.getSceneObject().name})
        return
      }
      resolve({hitButton: false, hitName: "<no Interactable on the ray>"})
    })
  })
  return withTimeout(result, 3000, "Physics probe never answered for Tool_" + caption)
}
