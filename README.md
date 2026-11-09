# Marble Run Sketch

A Specs Lens for the Learn AR with SPECS hackathon. Draw a marble track in the air with a pinch, add bells and dominoes, then drop a marble and watch real physics take over.

## Try it

1. Open `lens.esproj` in Lens Studio 5.23 or later.
2. Press Draw, pinch and move to sketch a track, then release.
3. With no tool selected, aim at a track or the demo's funnel and pinch to choose where the marble starts. A gold ghost marble marks the spot.
4. Press Drop.

Undo removes the last thing you added. Clear resets the table.

## Tests

The LEAF scenarios are in `Assets/Tests`. All seven pass in the Lens Studio preview: draw to cup, undo, clear, all buttons, chain drop, domino chain and drop-spot choice.

The Lens has been tested in the preview only, not on physical Specs.

## Design

The design brief and video script are in [`devpost/`](devpost/).
