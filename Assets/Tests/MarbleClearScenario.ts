/**
 * marble-clear.
 *
 * Phase 1 presses the real Tool_Clear while a Drop-driven chain run is in flight.
 * Phase 2 rebuilds through the UI (a drawn track, a bell, a domino and a marble
 * dropped on the track) and presses Tool_Clear again. Both times no track, piece
 * or live marble may remain, and the score must return to 0.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName} from "Leaf.lspkg/Utils/common/Utils"
import {designHead, framesUntil, log, pressButton, scoreLabel, SimulatedPinch, status, strokeThrough, toWorld, waitForLensReady} from "./MarbleRunLeafHelpers"

const STROKE = [new vec3(25, 26, -26), new vec3(36, 20, -25), new vec3(47, 15, -24)]
const BELL_AT = new vec3(38, 0, 2)
const DOMINO_AT = new vec3(-38, 0, 10)

@component
export class MarbleClearScenario extends Scenario {
  async run(): Promise<void> {
    const main = await waitForLensReady()
    const pinch = new SimulatedPinch(main)
    const head = designHead(main)

    // Phase 1: Clear during a live chain run.
    await pressButton("Drop")
    expect(main.chain.busy, "Tool_Drop did not start the chain").toBe(true)
    expect(main.marbles.activeCount, "no live marble during the chain run").toBe(1)
    log("phase 1: chain state=" + main.chain.state + " activeMarbles=" + main.marbles.activeCount + " t=" + main.chain.t.toFixed(2))
    await pressButton("Clear")
    this.expectCleared(main, "phase 1")
    expect(isNull(findSceneObjectByName("Built")) || !findSceneObjectByName("Built"), "phase 1: demo geometry still in the scene").toBe(true)

    // Phase 2: Clear after building through the UI.
    await pressButton("Draw")
    await pinch.drawStroke(strokeThrough(main, STROKE))
    await pressButton("Draw")
    expect(main.tracks.trackCount, "the stroke did not build a track: '" + status(main) + "'").toBe(1)
    const trackRoot: SceneObject = main.tracks.lastTrack.root

    await pressButton("Bell")
    await pinch.placeAt(toWorld(main, BELL_AT), head)
    await pressButton("Bell")
    await pressButton("Domino")
    await pinch.placeAt(toWorld(main, DOMINO_AT), head)
    await pressButton("Domino")
    expect(main.pieces.count, "the pinches did not place both pieces").toBe(2)
    const bellRoot: SceneObject = main.pieces.pieces[0].bell.root
    const dominoRoot: SceneObject = main.pieces.pieces[1].domino.so

    const drop = pressButton("Drop")
    const live = await framesUntil(() => main.marbles.activeCount >= 1, 6000)
    expect(live, "Tool_Drop did not spawn a marble on the drawn track").toBe(true)
    await drop
    log("phase 2 before Clear: tracks=" + main.tracks.trackCount + " pieces=" + main.pieces.count + " activeMarbles=" + main.marbles.activeCount)

    await pressButton("Clear")
    this.expectCleared(main, "phase 2")
    expect(isNull(trackRoot), "phase 2: track still in the scene").toBe(true)
    expect(isNull(bellRoot), "phase 2: bell still in the scene").toBe(true)
    expect(isNull(dominoRoot), "phase 2: domino still in the scene").toBe(true)
  }

  private expectCleared(main: any, label: string): void {
    log(label + " after Clear: tracks=" + main.tracks.trackCount + " pieces=" + main.pieces.count +
      " activeMarbles=" + main.marbles.activeCount + " heroExists=" + main.contraption.exists +
      " chainBusy=" + main.chain.busy + " status='" + status(main) + "'")
    expect(main.tracks.trackCount, label + ": tracks remain").toBe(0)
    expect(main.pieces.count, label + ": pieces remain").toBe(0)
    expect(main.marbles.activeCount, label + ": live marbles remain").toBe(0)
    expect(main.marbles.keptCount, label + ": marbles left in the cup").toBe(0)
    expect(main.contraption.exists, label + ": demo contraption remains").toBe(false)
    expect(main.chain.busy, label + ": chain still running").toBe(false)
    expect(main.history.length, label + ": undo history not emptied").toBe(0)
    expect(main.state.score, label + ": score not reset").toBe(0)
    expect(scoreLabel(main), label + ": panel score not reset").toBe("0")
    expect(main.state.mode, label + ": mode not idle").toBe("idle")
    expect(status(main)).toBe("Table cleared - draw a track")
  }
}
