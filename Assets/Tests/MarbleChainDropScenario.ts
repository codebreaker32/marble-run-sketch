/**
 * marble-chain-drop (done criteria 1 and 2).
 *
 * Pinches the real Tool_Drop button twice. Each press must ring the bell, topple
 * all 7 dominoes, register a goal and add exactly 1 to the score, then the
 * contraption must reset (dominoes standing, waiting marble back) so the next
 * press scores as well.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {assertContraptionReset, assertHeroRun, runHeroDrop, waitForLensReady} from "./MarbleRunLeafHelpers"

@component
export class MarbleChainDropScenario extends Scenario {
  async run(): Promise<void> {
    const main = await waitForLensReady()
    expect(main.contraption.exists, "demo contraption is not built").toBe(true)
    expect(main.chain.busy, "chain is busy before the first press").toBe(false)

    for (let press = 1; press <= 2; press++) {
      const label = "Drop press " + press
      const scoreBefore: number = main.state.score
      const run = await runHeroDrop(main)
      assertHeroRun(main, run, scoreBefore, label)
      assertContraptionReset(main, label)
    }
  }
}
