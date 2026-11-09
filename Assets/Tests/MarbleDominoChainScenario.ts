/**
 * marble-domino-chain (done criterion 2).
 *
 * Pinches Tool_Drop and samples every domino's tilt each frame. The dominoes must
 * tip in order along the row (a wave, not all at once) and each must go over.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {HERO} from "../Scripts/MarbleRunHeroLayout"
import {FALLEN_DEG, log, runHeroDrop, TIPPING_DEG, waitForLensReady} from "./MarbleRunLeafHelpers"

@component
export class MarbleDominoChainScenario extends Scenario {
  async run(): Promise<void> {
    const main = await waitForLensReady()
    expect(main.contraption.dominoes.length, "wrong number of dominoes in the row").toBe(HERO.dominoCount)

    const run = await runHeroDrop(main)
    expect(run.finished, "the run never finished").toBe(true)

    for (let i = 0; i < HERO.dominoCount; i++) {
      expect(run.tippedAt[i] >= 0, "domino " + (i + 1) + " never tipped past " + TIPPING_DEG + " deg").toBe(true)
      expect(run.maxTiltDeg[i] >= FALLEN_DEG,
        "domino " + (i + 1) + " never fell (max tilt " + run.maxTiltDeg[i].toFixed(1) + " deg)").toBe(true)
    }
    for (let i = 1; i < HERO.dominoCount; i++) {
      expect(run.tippedAt[i] >= run.tippedAt[i - 1],
        "domino " + (i + 1) + " tipped at " + run.tippedAt[i].toFixed(3) + " s, before domino " + i +
        " at " + run.tippedAt[i - 1].toFixed(3) + " s").toBe(true)
    }
    const spread = run.tippedAt[HERO.dominoCount - 1] - run.tippedAt[0]
    expect(spread > 0.1, "the row went over in " + spread.toFixed(3) + " s: not a chain").toBe(true)
    log("domino wave: first to last tip took " + spread.toFixed(2) + " s")
  }
}
