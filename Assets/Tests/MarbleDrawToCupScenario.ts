/**
 * marble-draw-to-cup.
 *
 * Enters Draw with the real Tool_Draw button, then makes a real pinch-drag with
 * LEAF's simulated hand through the input controller's per-frame stroke path, from
 * hand height down to just beside the cup. The track must snap into the cup, and
 * pressing Tool_Drop must spawn a marble on that track that scores.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {STATUS_TEXT} from "../Scripts/MarbleRunState"
import {fmt, framesUntil, log, pressButton, scoreLabel, SimulatedPinch, status, strokeThrough, waitForLensReady} from "./MarbleRunLeafHelpers"

/** PlayArea-local waypoints: approaches the cup (20, 15) from the open +X side, clear of the demo. */
const STROKE_TO_CUP = [new vec3(46, 26, 21), new vec3(38, 21, 19), new vec3(32, 17, 17), new vec3(28, 14.5, 15.5)]
const SCORE_TIMEOUT_MS = 12000

@component
export class MarbleDrawToCupScenario extends Scenario {
  async run(): Promise<void> {
    const main = await waitForLensReady()
    const scoreBefore: number = main.state.score
    const tracksBefore: number = main.tracks.trackCount
    const heroRunsBefore: number = main.chain.runIndex

    await pressButton("Draw")
    expect(main.state.mode, "Tool_Draw did not enter Draw mode").toBe("draw")
    expect(status(main)).toBe(STATUS_TEXT.draw)

    await new SimulatedPinch(main).drawStroke(strokeThrough(main, STROKE_TO_CUP))

    expect(main.tracks.trackCount, "the stroke did not build a track: '" + status(main) + "'").toBe(tracksBefore + 1)
    const track = main.tracks.lastTrack
    const rim: vec3 = main.goalCup.rimLocal
    const lowEnd: vec3 = track.lowEnd
    const endToAxis = Math.sqrt((lowEnd.x - rim.x) * (lowEnd.x - rim.x) + (lowEnd.z - rim.z) * (lowEnd.z - rim.z))
    log("track: high " + fmt(track.highEnd) + " low " + fmt(lowEnd) + " snapped=" + track.snapped +
      " endToCupAxis=" + endToAxis.toFixed(2) + " status='" + status(main) + "'")
    expect(track.snapped, "the track did not snap to the cup").toBe(true)
    expect(status(main)).toBe("Track reaches the cup - press Drop")
    expect(endToAxis < main.goalCup.innerRadiusCm, "the track ends outside the cup opening").toBe(true)
    expect(lowEnd.y > rim.y, "the track ends below the cup rim").toBe(true)

    // A marble that reaches the cup during the press counts as kept, not active.
    const marblesBefore = main.marbles.activeCount + main.marbles.keptCount
    await pressButton("Drop")
    const spawned = main.marbles.activeCount + main.marbles.keptCount > marblesBefore
    log("after Drop: status='" + status(main) + "' activeMarbles=" + main.marbles.activeCount)
    expect(main.chain.runIndex, "Drop ran the demo chain instead of the drawn track").toBe(heroRunsBefore)
    expect(spawned, "Drop did not spawn a marble on the drawn track").toBe(true)

    const scored = await framesUntil(() => main.state.score > scoreBefore, SCORE_TIMEOUT_MS)
    log("drawn track result: scored=" + scored + " score=" + main.state.score + " label='" + scoreLabel(main) + "'")
    expect(scored, "the marble on the drawn track never scored").toBe(true)
    expect(main.state.score, "score did not rise by exactly 1").toBe(scoreBefore + 1)
    expect(scoreLabel(main), "the panel score does not show the new score").toBe("" + (scoreBefore + 1))

    await pressButton("Draw")
    expect(main.state.mode, "Tool_Draw did not leave Draw mode").toBe("idle")
    // Tool_Drop and Tool_Draw were pinched while in Draw mode: pinches on the panel must never draw.
    expect(main.inputController.drawing, "a pinch on a panel button started a stroke").toBe(false)
    expect(main.tracks.trackCount, "a pinch on a panel button built a track").toBe(tracksBefore + 1)
  }
}
