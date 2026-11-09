/**
 * MarbleRunState — session state: current tool mode and score.
 *
 * Pure logic, no scene access. Main owns the single instance and pushes results to the UI.
 */
export type ToolMode = "idle" | "draw" | "floor" | "goal" | "bell" | "domino"

export const STATUS_TEXT: Record<ToolMode, string> = {
  idle: "Press Drop to run the marble",
  draw: "Pinch and move to draw a track",
  floor: "Aim at a table and pinch",
  goal: "Aim at a spot and pinch to move the cup",
  bell: "Aim at the table and pinch to place a bell",
  domino: "Aim at the table and pinch to place a domino",
}

export class MarbleRunState {
  mode: ToolMode = "idle"
  score = 0

  /** Toggle a tool: pressing the active tool returns to idle. */
  toggleMode(mode: ToolMode): ToolMode {
    this.mode = this.mode === mode ? "idle" : mode
    return this.mode
  }

  setMode(mode: ToolMode): void { this.mode = mode }

  addPoint(): number { return ++this.score }

  setScore(score: number): void { this.score = score }
}
