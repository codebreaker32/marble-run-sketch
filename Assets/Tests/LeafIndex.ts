import {scenariosIndex} from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator"
import {ScenarioMetadata} from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata"
import {MarbleAllButtonsScenario} from "./MarbleAllButtonsScenario"
import {MarbleChainDropScenario} from "./MarbleChainDropScenario"
import {MarbleClearScenario} from "./MarbleClearScenario"
import {MarbleDominoChainScenario} from "./MarbleDominoChainScenario"
import {MarbleDrawToCupScenario} from "./MarbleDrawToCupScenario"
import {MarbleDropChoiceScenario} from "./MarbleDropChoiceScenario"
import {MarbleUndoLastScenario} from "./MarbleUndoLastScenario"

/** Registers the Marble Run Sketch scenarios with LEAF. */
@component
export class LeafIndex extends BaseScriptComponent {
  @scenariosIndex
  static scenariosIndex: ScenarioMetadata[] = [
    {id: "marble-chain-drop", typename: MarbleChainDropScenario.getTypeName()},
    {id: "marble-domino-chain", typename: MarbleDominoChainScenario.getTypeName()},
    {id: "marble-draw-to-cup", typename: MarbleDrawToCupScenario.getTypeName()},
    {id: "marble-drop-choice", typename: MarbleDropChoiceScenario.getTypeName()},
    {id: "marble-undo-last", typename: MarbleUndoLastScenario.getTypeName()},
    {id: "marble-clear", typename: MarbleClearScenario.getTypeName()},
    {id: "marble-all-buttons", typename: MarbleAllButtonsScenario.getTypeName()},
  ]
}
