/**
 * marble-all-buttons.
 *
 * Pinches each of the 8 real panel buttons (modes toggled back off) and asserts
 * the status text changes on every press and each toggle's on state follows the
 * mode. Before pressing, a ray from the user's head position must target each
 * button under SIK's own targeting rule, because the LEAF press does not raycast.
 * Script errors cannot be seen from inside a scenario: check the Lens Studio log.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {STATUS_TEXT, ToolMode} from "../Scripts/MarbleRunState"
import {log, pressButton, status, targetFromHead, TOOL_CAPTIONS, waitForLensReady} from "./MarbleRunLeafHelpers"

const TOGGLES: {caption: string; mode: ToolMode}[] = [
  {caption: "Draw", mode: "draw"},
  {caption: "Floor", mode: "floor"},
  {caption: "Goal", mode: "goal"},
  {caption: "Bell", mode: "bell"},
  {caption: "Domino", mode: "domino"},
]

@component
export class MarbleAllButtonsScenario extends Scenario {
  async run(): Promise<void> {
    const main = await waitForLensReady()

    for (const caption of TOOL_CAPTIONS) {
      const ray = await targetFromHead(main, caption)
      log("ray from head to Tool_" + caption + ": SIK would target '" + ray.hitName + "' onButton=" + ray.hitButton)
      expect(ray.hitButton, "a ray from the head at Tool_" + caption + " targets '" + ray.hitName + "' instead").toBe(true)
    }

    const toggles: Map<string, {isOn: boolean}> = main.toolPanel.toggles
    for (const t of TOGGLES) {
      await this.press(main, t.caption, STATUS_TEXT[t.mode])
      expect(main.state.mode, "Tool_" + t.caption + " did not enter its mode").toBe(t.mode)
      expect(toggles.get(t.mode).isOn, "Tool_" + t.caption + " is not shown as on").toBe(true)

      await this.press(main, t.caption, STATUS_TEXT.idle)
      expect(main.state.mode, "Tool_" + t.caption + " did not toggle back off").toBe("idle")
      expect(toggles.get(t.mode).isOn, "Tool_" + t.caption + " is still shown as on").toBe(false)
    }

    await this.press(main, "Drop", "Here it goes!")
    expect(main.chain.busy, "Tool_Drop did not start the chain").toBe(true)

    await this.press(main, "Undo", "Demo removed - draw your own track")
    expect(main.contraption.exists, "Tool_Undo did not remove the demo").toBe(false)
    expect(main.chain.busy, "Tool_Undo left the chain running").toBe(false)

    await this.press(main, "Clear", "Table cleared - draw a track")
    expect(main.marbles.activeCount, "Tool_Clear left a live marble").toBe(0)
  }

  private async press(main: any, caption: string, expected: string): Promise<void> {
    const before = status(main)
    await pressButton(caption)
    const after = status(main)
    log("Tool_" + caption + ": status '" + before + "' -> '" + after + "' mode=" + main.state.mode)
    expect(after !== before, "Tool_" + caption + " did not change the status text ('" + after + "')").toBe(true)
    expect(after, "Tool_" + caption + " showed the wrong status").toBe(expected)
  }
}
