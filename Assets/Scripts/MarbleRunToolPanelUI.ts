/**
 * MarbleRunToolPanelUI — the tool panel next to the build (UIKit).
 *
 * Owns: a BackPlate with a header (title + trophy score), two rows of four big
 * icon-and-label buttons (Draw, Drop, Undo, Clear / Floor, Goal, Bell, Domino) and
 * a large status line. Sized for reading at about 45-55 cm.
 *
 * Passive view (Hard Rule 3): holds no game state.
 *   Main -> UI : setMode(mode), setScore(n), setStatus(msg)
 *   UI -> Main : onDraw, onDrop, onUndo, onClear, onFloor, onGoal, onBell, onDomino
 */
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {
  FlexAlign,
  FlexAlignSelf,
  FlexDirection,
  FlexJustify,
} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"

const ICON_DRAW = requireAsset("../Icons/draw.png") as Texture
const ICON_DROP = requireAsset("../Icons/sports_baseball.png") as Texture
const ICON_UNDO = requireAsset("../Icons/undo.png") as Texture
const ICON_CLEAR = requireAsset("../Icons/delete.png") as Texture
const ICON_FLOOR = requireAsset("../Icons/table_restaurant.png") as Texture
const ICON_GOAL = requireAsset("../Icons/flag.png") as Texture
const ICON_TROPHY = requireAsset("../Icons/trophy.png") as Texture
const ICON_BELL = requireAsset("../Icons/bell_256x256.png") as Texture
const ICON_DOMINO = requireAsset("../Icons/domino_256x256.png") as Texture
const IMAGE_MATERIAL = requireAsset("../Materials/ImageMaterial.mat") as Material

const LAYOUT_Z_LIFT = 0.02
const BUTTON_FACE_Z = 0.1
const CONTENT_Z = 0.6

export type MarbleRunToolMode = "idle" | "draw" | "floor" | "goal" | "bell" | "domino"

@component
export class MarbleRunToolPanelUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MarbleRunToolPanelUI – tool panel (passive view)</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Title shown in the panel header")
  titleText: string = "Marble Run"

  @input("vec4", "{0.45,0.92,1.0,1}")
  @hint("Accent colour for the score number")
  @widget(new ColorWidget())
  accentColor: vec4

  @input
  @hint("Size of each tool button (cm)")
  @widget(new SliderWidget(3.4, 7, 0.1))
  buttonSizeCm: number = 4.6

  @input
  @hint("Text size of button labels")
  @widget(new SliderWidget(20, 70, 1))
  labelFontSize: number = 37

  @input
  @hint("Text size of the status line")
  @widget(new SliderWidget(20, 80, 1))
  statusFontSize: number = 46

  @input
  @hint("Text size of the score number")
  @widget(new SliderWidget(40, 180, 1))
  scoreFontSize: number = 96
  @ui.group_end

  private _onDraw = new Event<void>()
  private _onDrop = new Event<void>()
  private _onUndo = new Event<void>()
  private _onClear = new Event<void>()
  private _onFloor = new Event<void>()
  private _onGoal = new Event<void>()
  private _onBell = new Event<void>()
  private _onDomino = new Event<void>()
  get onDraw(): PublicApi<void> { return this._onDraw.publicApi() }
  get onDrop(): PublicApi<void> { return this._onDrop.publicApi() }
  get onUndo(): PublicApi<void> { return this._onUndo.publicApi() }
  get onClear(): PublicApi<void> { return this._onClear.publicApi() }
  get onFloor(): PublicApi<void> { return this._onFloor.publicApi() }
  get onGoal(): PublicApi<void> { return this._onGoal.publicApi() }
  get onBell(): PublicApi<void> { return this._onBell.publicApi() }
  get onDomino(): PublicApi<void> { return this._onDomino.publicApi() }

  private scoreText: Text | null = null
  private statusText: Text | null = null
  private toggles = new Map<MarbleRunToolMode, Button>()
  private pendingMode: MarbleRunToolMode = "idle"
  private pendingScore = 0
  private pendingStatus = ""

  setScore(n: number): void {
    this.pendingScore = n
    if (this.scoreText) this.scoreText.text = "" + n
  }

  setStatus(msg: string): void {
    this.pendingStatus = msg
    if (this.statusText) this.statusText.text = msg
  }

  setMode(mode: MarbleRunToolMode): void {
    this.pendingMode = mode
    this.toggles.forEach((btn, key) => {
      const on = key === mode
      if (btn.isOn !== on) btn.isOn = on
    })
  }

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    const plate = this.sceneObject.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.style = "dark"

    const pad = 0.7
    const gap = 0.5
    const cellW = this.buttonSizeCm + 0.3
    const cellH = this.buttonSizeCm + 1.0
    const COLS = 4
    const headerH = 3.2
    const statusH = 2.3
    const innerW = cellW * COLS + gap * (COLS - 1) + pad * 2
    const innerH = pad * 2 + headerH + cellH * 2 + gap * 3 + statusH
    plate.size = new vec2(innerW, innerH)

    const content = this.obj(this.sceneObject, "Content", new vec3(0, 0, CONTENT_Z))
    const col = this.layout(content)
    col.width = innerW
    col.height = innerH
    col.direction = FlexDirection.Column
    col.alignItems = FlexAlign.Center
    col.justifyContent = FlexJustify.Center
    col.rowGap = gap
    col.paddingTop = pad
    col.paddingBottom = pad
    col.paddingLeft = pad
    col.paddingRight = pad

    const rowW = innerW - pad * 2
    this.buildHeader(content, rowW, headerH)
    this.buildToolRow(content, rowW, cellW, cellH, gap, [
      {icon: ICON_DRAW, caption: "Draw", toggle: "draw", fire: () => this._onDraw.invoke()},
      {icon: ICON_DROP, caption: "Drop", toggle: null, fire: () => this._onDrop.invoke()},
      {icon: ICON_UNDO, caption: "Undo", toggle: null, fire: () => this._onUndo.invoke()},
      {icon: ICON_CLEAR, caption: "Clear", toggle: null, fire: () => this._onClear.invoke()},
    ])
    this.buildToolRow(content, rowW, cellW, cellH, gap, [
      {icon: ICON_FLOOR, caption: "Floor", toggle: "floor", fire: () => this._onFloor.invoke()},
      {icon: ICON_GOAL, caption: "Goal", toggle: "goal", fire: () => this._onGoal.invoke()},
      {icon: ICON_BELL, caption: "Bell", toggle: "bell", fire: () => this._onBell.invoke()},
      {icon: ICON_DOMINO, caption: "Domino", toggle: "domino", fire: () => this._onDomino.invoke()},
    ])
    this.flexChild(content, {w: rowW, h: statusH}, (so) => {
      this.statusText = this.makeText(so, this.pendingStatus, this.statusFontSize, rowW, statusH, true)
      this.statusText.textFill.color = new vec4(1, 1, 1, 1)
    })
    this.setScore(this.pendingScore)
    this.setMode(this.pendingMode)
  }

  private buildHeader(parent: SceneObject, rowW: number, h: number): void {
    this.flexChild(parent, {w: rowW, h: h}, (rowSO) => {
      const row = this.layout(rowSO)
      row.width = rowW
      row.height = h
      row.direction = FlexDirection.Row
      row.justifyContent = FlexJustify.SpaceBetween
      row.alignItems = FlexAlign.Center
      const titleW = rowW * 0.55
      this.flexChild(rowSO, {w: titleW, h: h}, (so) => {
        const t = this.makeText(so, this.titleText, 62, titleW, h, false)
        t.horizontalAlignment = HorizontalAlignment.Left
      })
      const scoreW = rowW - titleW
      this.flexChild(rowSO, {w: scoreW, h: h}, (scoreSO) => {
        const sr = this.layout(scoreSO)
        sr.width = scoreW
        sr.height = h
        sr.direction = FlexDirection.Row
        sr.justifyContent = FlexJustify.End
        sr.alignItems = FlexAlign.Center
        sr.columnGap = 0.4
        const iconCm = h * 0.95
        this.flexChild(scoreSO, {w: iconCm, h: iconCm}, (iconSO) => this.addImage(iconSO, ICON_TROPHY, iconCm))
        const numW = scoreW - iconCm - 0.4
        this.flexChild(scoreSO, {w: numW, h: h}, (numSO) => {
          this.scoreText = this.makeText(numSO, "0", this.scoreFontSize, numW, h, false)
          this.scoreText.horizontalAlignment = HorizontalAlignment.Right
          this.scoreText.textFill.color = this.accentColor
        })
      })
    })
  }

  private buildToolRow(
    parent: SceneObject,
    rowW: number,
    cellW: number,
    cellH: number,
    gap: number,
    specs: {icon: Texture; caption: string; toggle: MarbleRunToolMode | null; fire: () => void}[]
  ): void {
    this.flexChild(parent, {w: rowW, h: cellH}, (rowSO) => {
      const row = this.layout(rowSO)
      row.width = rowW
      row.height = cellH
      row.direction = FlexDirection.Row
      row.justifyContent = FlexJustify.Center
      row.alignItems = FlexAlign.Center
      row.columnGap = gap
      for (const s of specs) {
        this.flexChild(rowSO, {w: cellW, h: cellH}, (cellSO) => {
          const btnSO = this.obj(cellSO, "Tool_" + s.caption)
          const btn = btnSO.createComponent(Button.getTypeName()) as Button
          btn.size = new vec3(cellW, cellH, 1)
          if (s.toggle) {
            // Set the toggle flag before enabling toggling so UIKit doesn't warn about it.
            ;(btn as unknown as {_toggleable: boolean})._toggleable = true
            btn.setIsToggleable(true)
            this.toggles.set(s.toggle, btn)
          }
          btn.onTriggerUp.add(() => s.fire())

          // Face layout above the button surface: big icon over a big label.
          const face = this.obj(btnSO, "Face", new vec3(0, 0, BUTTON_FACE_Z))
          const faceCol = this.layout(face)
          faceCol.width = cellW
          faceCol.height = cellH
          faceCol.direction = FlexDirection.Column
          faceCol.justifyContent = FlexJustify.Center
          faceCol.alignItems = FlexAlign.Center
          faceCol.rowGap = 0.25
          const iconCm = this.buttonSizeCm * 0.66
          this.flexChild(face, {w: iconCm, h: iconCm}, (iconSO) => this.addImage(iconSO, s.icon, iconCm))
          this.flexChild(face, {w: cellW, h: 1.3}, (capSO) => {
            this.makeText(capSO, s.caption, this.labelFontSize, cellW, 1.3, false)
          })
        })
      }
    })
  }

  private makeText(parent: SceneObject, value: string, fontSize: number, widthCm: number, heightCm: number, wrap: boolean): Text {
    const t = parent.createComponent("Component.Text") as Text
    t.text = value
    t.depthTest = true
    t.size = fontSize
    ;(t as Text & {weight?: number}).weight = 600
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = wrap ? HorizontalOverflow.Wrap : HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCm / 2, widthCm / 2, -heightCm / 2, heightCm / 2)
    return t
  }

  private addImage(parent: SceneObject, texture: Texture, sizeCm: number): void {
    const so = this.obj(parent, "Image", new vec3(0, 0, 0.05))
    const img = so.createComponent("Component.Image") as Image
    const mat = IMAGE_MATERIAL.clone()
    mat.mainPass.baseTex = texture
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false
    img.clearMaterials()
    img.addMaterial(mat)
    so.getTransform().setLocalScale(new vec3(sizeCm, sizeCm, 1))
  }

  /** Every layout registers children explicitly via addItems, so discovery stays off. */
  private layout(so: SceneObject): FlexLayout {
    const l = so.createComponent(FlexLayout.getTypeName()) as FlexLayout
    l.autoDiscoverItemsOnStart = false
    return l
  }

  private obj(parent: SceneObject, name: string, position?: vec3): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    if (position) so.getTransform().setLocalPosition(position)
    return so
  }

  private flexChild(
    parent: SceneObject,
    size: {w?: number; h?: number; grow?: number},
    builder: (child: SceneObject) => void
  ): SceneObject {
    const child = this.obj(parent, "Item", new vec3(0, 0, LAYOUT_Z_LIFT))
    const item = child.createComponent(FlexItem.getTypeName()) as FlexItem
    if (size.w !== undefined && size.w > 0) item.overrideWidth = size.w
    if (size.h !== undefined && size.h > 0) item.overrideHeight = size.h
    item.flexGrow = size.grow ?? 0
    item.flexShrink = 0
    item.alignSelf = FlexAlignSelf.Center
    builder(child)
    const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
    if (parentFlex) parentFlex.addItems([item])
    return child
  }
}
