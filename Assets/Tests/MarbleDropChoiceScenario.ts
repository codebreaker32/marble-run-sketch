/**
 * marble-drop-choice.
 *
 * Draws two tracks through real pinches, then checks: Drop uses the newest track;
 * a pinch aimed at the older track moves the drop spot there; drawing again hands
 * the target back to the newest track; undoing a picked track falls back safely.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {designHead, fmt, frames, log, pressButton, SimulatedPinch, status, strokeThrough, toWorld, waitForLensReady} from "./MarbleRunLeafHelpers"

/** PlayArea-local strokes clear of the demo contraption and away from the cup. */
const FIRST = [new vec3(25, 26, -26), new vec3(36, 20, -25), new vec3(47, 15, -24)]
const SECOND = [new vec3(25, 26, 14), new vec3(36, 20, 15), new vec3(47, 15, 16)]
const THIRD = [new vec3(25, 26, -6), new vec3(36, 20, -5), new vec3(47, 15, -4)]
const NEAR_CM = 1.5

@component
export class MarbleDropChoiceScenario extends Scenario {
  async run(): Promise<void> {
    const main = await waitForLensReady()
    const pinch = new SimulatedPinch(main)
    const head = designHead(main)

    const draw = async (stroke: vec3[]): Promise<any> => {
      await pressButton("Draw")
      await pinch.drawStroke(strokeThrough(main, stroke))
      await pressButton("Draw")
      expect(main.state.mode).toBe("idle")
      return main.tracks.lastTrack
    }

    // Record the release point itself: at a low frame rate the marble has rolled on by the time a test can read it.
    let released: vec3 | null = null
    const originalSpawn = main.marbles.spawn
    main.marbles.spawn = function (worldPos: vec3, velocity: any, hero: boolean, colorIndex: number) {
      released = worldPos
      return originalSpawn.call(main.marbles, worldPos, velocity, hero, colorIndex)
    }

    /** Presses Drop and returns where the new marble was released, in world space. */
    const dropAndLocate = async (): Promise<vec3> => {
      main.marbles.clearLoose()
      released = null
      await frames(2)
      await pressButton("Drop")
      expect(released !== null, "Drop did not release a marble: '" + status(main) + "'").toBe(true)
      return released as vec3
    }

    try {
      await this.checkChoices(main, pinch, head, draw, dropAndLocate)
    } finally {
      main.marbles.spawn = originalSpawn
    }
  }

  private async checkChoices(main: any, pinch: SimulatedPinch, head: vec3, draw: (stroke: vec3[]) => Promise<any>, dropAndLocate: () => Promise<vec3>): Promise<void> {
    const first = await draw(FIRST)
    const second = await draw(SECOND)
    expect(main.tracks.trackCount, "both strokes should build").toBe(2)

    const atSecond = await dropAndLocate()
    log("default drop at " + fmt(atSecond))
    expect(atSecond.distance(toWorld(main, second.dropPoint)) < NEAR_CM, "with nothing picked, Drop should use the newest track").toBe(true)

    // Pick the middle of the older track.
    const middle = first.dropPoints[Math.floor(first.dropPoints.length / 2)]
    await pinch.placeAt(toWorld(main, middle), head)
    expect(status(main), "the pinch did not pick a spot").toBe("Drop spot set - press Drop")
    expect(main.dropMarker.root.enabled, "the marker should show the picked spot").toBe(true)

    const atPicked = await dropAndLocate()
    log("picked drop at " + fmt(atPicked))
    expect(atPicked.distance(toWorld(main, middle)) < NEAR_CM, "Drop should release at the picked spot").toBe(true)
    expect(atPicked.distance(toWorld(main, second.dropPoint)) > NEAR_CM, "Drop still used the newest track").toBe(true)

    // A pinch that aims at nothing must not change the choice.
    await pinch.placeAt(toWorld(main, new vec3(-60, 0, 60)), head)
    const stillPicked = await dropAndLocate()
    expect(stillPicked.distance(toWorld(main, middle)) < NEAR_CM, "a missed pinch moved the drop spot").toBe(true)

    // A new track takes over as the target.
    const third = await draw(THIRD)
    const atThird = await dropAndLocate()
    expect(atThird.distance(toWorld(main, third.dropPoint)) < NEAR_CM, "a new track should become the target").toBe(true)

    // Undoing a picked track falls back to the newest one left.
    await pinch.placeAt(toWorld(main, third.dropPoints[Math.floor(third.dropPoints.length / 2)]), head)
    await pressButton("Undo")
    expect(main.tracks.trackCount).toBe(2)
    const afterUndo = await dropAndLocate()
    expect(afterUndo.distance(toWorld(main, second.dropPoint)) < NEAR_CM, "after undo the drop should fall back to the newest track").toBe(true)

    main.marbles.clearLoose()
    await pressButton("Undo")
    await pressButton("Undo")
    expect(main.tracks.trackCount).toBe(0)
  }
}
