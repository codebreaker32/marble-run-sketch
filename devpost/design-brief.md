---
status: approved
---

# Design brief: Marble Run Sketch

<!-- Filled in by plan-lens from the learner's interview. Uses the learner's words. Values the learner didn't choose are marked (default). -->
<!-- Note: this brief was written after the first build, during polish. It records the design the learner chose and checks it against the build, rather than driving the first build. -->
<!-- Updated after the full rebuild on 8 Nov 2026, to record the second marble, the editor-only table, the level panel, aim-to-place pieces, and the removal of saved contraptions. Done criteria are unchanged. -->

## The one spatial moment
At the park, on a picnic table, you draw a twisty track in the air from hand height down to a cup. You drop a marble. It rattles down the track, rings a bell, and knocks over a row of dominoes. The last domino tips a second, waiting marble off the shelf, the cup catches it, and confetti bursts out: a chain reaction that's fun to watch, maybe with friends nearby.

## Why it belongs on glasses
- Uses: draws in the world, leaves your body free
- Why it's better than the phone or laptop version: you sketch tracks directly in 3D space with your hand, sized to the real table in front of you. On a phone you'd be drawing on a flat screen while holding the device. Here the contraption sits on the real table, and you can walk around it and watch the marble run like a real toy. (default)

## Product or overlay
- Type: product. The virtual contraption is the experience.
- What the real version would sense: the real surface (a table) to build on, through World Query hit testing.
- Stand-in for the preview: a wooden picnic table built in the editor only (`PreviewStandIn_Table [EDITOR ONLY]`), with its top 74 cm above the simulated ground. On a device it does not exist and the real table is the surface. (default)

## Where things live
- Where the user is looking during the main task: down and forward, at the table in front of them.
- Contraption (tracks, bells, dominoes, cup): table-sized, anchored to the detected surface, roughly within arm's reach (about 30–60 cm in front of the user).
- Tool panel (Draw, Drop, Undo, Clear / Floor, Goal, Bell, Domino): stays in one place next to the build, to the lower left at about 47 cm, tilted 45 degrees up toward the user and square to the table. Two rows of four big buttons on a panel about 21 x 19 cm.
- Status text: on the panel. It tells the user what to do next.

## Hands and input
- Draw a track: pinch to start, the line follows your finger, release to stop. Very steep strokes are eased into a slope a marble can roll down, and a stroke drawn straight down asks for a longer slope. With a mouse in the preview, the stroke lands on a vertical plane through the cup.
- Drop a marble: Drop button on the panel.
- Choose where it drops: with no tool active, aim at any point on any track, or at the demo funnel, and pinch. A ghost marble marks the spot and Drop releases there. A newly drawn track becomes the target automatically.
- Undo or Clear: buttons on the panel. Undo removes the last track or piece.
- Place a bell or a domino: choose Bell or Domino on the panel, then aim at the table, where a ghost shows the spot, and pinch. Dominoes face the user. A spot too close to another piece or the cup is refused.
- Move the cup or floor: Goal and Floor buttons, then aim and pinch on the surface. (default)
- Targets are big and highlight when aimed at.
- Voice: none. (default)

## When things show
- Demo track: shows first, as soon as the surface is found. It stays until you clear it or undo it. After that, restarting the Lens brings it back. Clear keeps the cup and returns it to its starting spot.
- Instructions (status text): show after the demo track appears, and change with the current mode.
- Surface reticle: shows only while you're placing the floor or the goal.
- Confetti: shows for under a second when a marble lands in the cup.
- Scored marbles stay in the cup until Clear. A new marble appears on the shelf for the next chain run. A full cup overflows onto the table, and spilled marbles fade after a few seconds.
- If something needs attention out of view: sound (bell ding, domino clack, goal) (default).

## Done criteria
Each one can be checked in Lens Studio's preview.
1. A dropped marble rolls along the track and lands in the cup, and the score goes up.
2. A marble knocks over a row of dominoes: they fall in a chain.
3. Undo removes the last thing you added (track, bell, or domino).

## Out of scope
- Multiplayer and shared building with friends; they watch, they don't build.
- Saving and reloading contraptions. The demo always appears at start.
- Real outdoor conditions (sunlight, grass) aren't tested.

## Risks and open questions
- Real hand tracking for drawing smooth tracks: feel unproven without glasses.
- Surface detection on a real outdoor picnic table, in bright sun: unproven without glasses.
- No Specs device is available. Everything is verified in the preview only.

## Build notes for CLAD
- Build for SPECS so it runs and can be demonstrated in Lens Studio's preview. No SPECS device is available.
- Use Spectacles Interaction Kit (SIK) and UI Kit for all interactions, so they work with the mouse in Interactive Preview and with LEAF.
- Build any stand-in exactly as described above, and keep it obvious in the scene.
- Use real-world scale in centimeters. Keep content inside the user's view during the main task.
- The display is additive: black renders as transparent. Don't rely on black or very dark content to be seen; keep text light and readable from where the user stands.
- Get the basic flow working first, then add detail.
- Write LEAF scenarios for each done criterion, run them in preview, and report which pass. Say which criteria have no test.
- Don't record, identify, or follow people.

## After the build: judge it
This part is for you, after CLAD finishes.

1. **Does it work?** Ask your agent which LEAF tests passed and which done criteria have no test.
2. **Walk around it.** Open the preview in Interactive Preview. Use WASD to move, Q and E to go down and up, and right-drag (or hold Shift) to look around. Clicking acts as a pinch. Stand where a user would and look at the task.
3. **Ask the three questions.**
   - Does it use what I'm looking at?
   - Does it put something in my space, where it belongs?
   - Does it free my hands or let me keep my eyes up?
   - Would it be just as good on a phone? If so, what would make it need the glasses?
4. **Check comfort.**
   - Everything I need is in view while I do the task. Nothing sits at the edges, behind me, or stuck to my face.
   - Every control is within reach of someone standing there.
   - Text reads easily from where I stand. No dark UI disappearing.
   - Things show when needed and get out of the way.
5. **Label what you know.** Write "logic proven" next to anything the tests and preview show working, and "feel unproven" next to anything only real glasses could tell you (comfort over time, real hand tracking, real recognition).
6. **Fix with design notes, not code.** Tell your agent what to change in design terms, for example: "Move the step card 15 cm lower and next to the pan. Make the Next button twice as big. Re-run the tests." If a fix takes under a minute, like nudging a panel, do it yourself in the scene.
7. **Submit.** Record a video under 3 minutes of your Lens in the preview, public on YouTube. Make your repo public with your Lens Studio project and this `devpost/` folder. Details are on the hackathon site: https://learn-specs.devpost.com/resources
