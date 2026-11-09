/**
 * marble-undo-last (done criterion 3).
 *
 * Adds a drawn track, a bell and a domino through the panel and real pinches, then
 * presses the real Tool_Undo. Each press must remove only the newest item and
 * leave the demo contraption in place. Once the user's items are gone the demo
 * is the next item, and after that there is nothing left to undo.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {HERO} from "../Scripts/MarbleRunHeroLayout"
import {designHead, log, pressButton, SimulatedPinch, status, strokeThrough, toWorld, waitForLensReady} from "./MarbleRunLeafHelpers"

/** PlayArea-local spots clear of the demo contraption and away from the cup. */
const STROKE = [new vec3(25, 26, -26), new vec3(36, 20, -25), new vec3(47, 15, -24)]
const BELL_AT = new vec3(38, 0, 2)
const DOMINO_AT = new vec3(-38, 0, 10)

@component
export class MarbleUndoLastScenario extends Scenario {
  async run(): Promise<void> {
    const main = await waitForLensReady()
    const pinch = new SimulatedPinch(main)
    const head = designHead(main)
    expect(main.contraption.exists, "demo contraption is not built").toBe(true)
    expect(main.tracks.trackCount).toBe(0)
    expect(main.pieces.count).toBe(0)

    await pressButton("Draw")
    expect(main.state.mode).toBe("draw")
    await pinch.drawStroke(strokeThrough(main, STROKE))
    await pressButton("Draw")
    expect(main.state.mode).toBe("idle")
    expect(main.tracks.trackCount, "the stroke did not build a track: '" + status(main) + "'").toBe(1)
    const trackRoot: SceneObject = main.tracks.lastTrack.root

    await pressButton("Bell")
    expect(main.state.mode).toBe("bell")
    await pinch.placeAt(toWorld(main, BELL_AT), head)
    expect(status(main)).toBe("Bell placed - pinch for another")
    await pressButton("Bell")
    expect(main.state.mode).toBe("idle")
    expect(main.pieces.count, "the pinch did not place a bell").toBe(1)
    const bellRoot: SceneObject = main.pieces.pieces[0].bell.root

    await pressButton("Domino")
    expect(main.state.mode).toBe("domino")
    await pinch.placeAt(toWorld(main, DOMINO_AT), head)
    expect(status(main)).toBe("Domino placed - pinch for the next")
    await pressButton("Domino")
    expect(main.state.mode).toBe("idle")
    expect(main.pieces.count, "the pinch did not place a domino").toBe(2)
    const dominoRoot: SceneObject = main.pieces.pieces[1].domino.so
    log("added: track, bell, domino; history=" + main.history.join(","))

    const expectDemoIntact = (label: string): void => {
      expect(main.contraption.exists, label + ": the demo contraption was removed").toBe(true)
      expect(main.contraption.dominoes.length, label + ": demo dominoes changed").toBe(HERO.dominoCount)
      expect(!!main.contraption.waiting && main.contraption.waiting.so.enabled, label + ": waiting marble gone").toBe(true)
    }

    await pressButton("Undo")
    log("undo 1: tracks=" + main.tracks.trackCount + " pieces=" + main.pieces.count + " status='" + status(main) + "'")
    expect(main.pieces.count, "undo 1 should remove only the domino").toBe(1)
    expect(main.pieces.pieces[0].kind).toBe("bell")
    expect(isNull(dominoRoot), "undo 1 left the domino in the scene").toBe(true)
    expect(isNull(bellRoot), "undo 1 removed the bell").toBe(false)
    expect(main.tracks.trackCount, "undo 1 touched the track").toBe(1)
    expect(status(main)).toBe("Removed the last piece")
    expectDemoIntact("undo 1")

    await pressButton("Undo")
    log("undo 2: tracks=" + main.tracks.trackCount + " pieces=" + main.pieces.count + " status='" + status(main) + "'")
    expect(main.pieces.count, "undo 2 should remove the bell").toBe(0)
    expect(isNull(bellRoot), "undo 2 left the bell in the scene").toBe(true)
    expect(isNull(trackRoot), "undo 2 removed the track").toBe(false)
    expect(main.tracks.trackCount, "undo 2 touched the track").toBe(1)
    expect(status(main)).toBe("Removed the last piece")
    expectDemoIntact("undo 2")

    await pressButton("Undo")
    log("undo 3: tracks=" + main.tracks.trackCount + " pieces=" + main.pieces.count + " status='" + status(main) + "'")
    expect(main.tracks.trackCount, "undo 3 should remove the track").toBe(0)
    expect(isNull(trackRoot), "undo 3 left the track in the scene").toBe(true)
    expect(status(main)).toBe("Removed the last track")
    expectDemoIntact("undo 3")

    await pressButton("Undo")
    log("undo 4: heroExists=" + main.contraption.exists + " status='" + status(main) + "'")
    expect(main.contraption.exists, "undo 4 should remove the demo, the next item in the history").toBe(false)
    expect(status(main)).toBe("Demo removed - draw your own track")

    await pressButton("Undo")
    log("undo 5: status='" + status(main) + "'")
    expect(status(main)).toBe("Nothing to undo")
  }
}
