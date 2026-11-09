/**
 * MarbleRunAudio — all sound for Marble Run in one place.
 *
 * Owns: pooled AudioComponents per sound effect (so rapid clacks overlap) and the
 * looping background music bed. Interactive cues use LowLatency, music uses LowPower.
 * Must not: decide when sounds play. Main and the chain call the play* methods.
 */
const UI_CLICK = requireAsset("../GeneratedSFX/UIClick.wav") as AudioTrackAsset
const MARBLE_DROP = requireAsset("../GeneratedSFX/MarbleDrop.wav") as AudioTrackAsset
const MARBLE_CLACK = requireAsset("../GeneratedSFX/MarbleClack.wav") as AudioTrackAsset
const MARBLE_BOUNCE = requireAsset("../GeneratedSFX/MarbleBounce.wav") as AudioTrackAsset
const GOAL_CHIME = requireAsset("../GeneratedSFX/GoalChime.wav") as AudioTrackAsset
const TRACK_PLACE = requireAsset("../GeneratedSFX/TrackPlace.wav") as AudioTrackAsset
const BELL_DING = requireAsset("../GeneratedSFX/BellDing.wav") as AudioTrackAsset
const DOMINO_CLACK = requireAsset("../GeneratedSFX/DominoClack.wav") as AudioTrackAsset
const BACKGROUND_MUSIC = requireAsset("../GeneratedSFX/BackgroundMusic.wav") as AudioTrackAsset

@component
export class MarbleRunAudio extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MarbleRunAudio – sound effect pools + music bed</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Master volume for sound effects")
  @widget(new SliderWidget(0, 1, 0.05))
  sfxVolume: number = 0.9

  @input
  @hint("Volume of the background music bed")
  @widget(new SliderWidget(0, 1, 0.05))
  musicVolume: number = 0.25
  @ui.group_end

  private pools = new Map<AudioTrackAsset, AudioComponent[]>()
  private cursors = new Map<AudioTrackAsset, number>()

  // Voices built one per frame: assigning an audio track opens the file
  // synchronously, so building them all in onAwake can hitch a slow load.
  private pending: AudioTrackAsset[] = []

  onAwake(): void {
    const plan: [AudioTrackAsset, number][] = [
      [UI_CLICK, 1], [MARBLE_DROP, 2], [MARBLE_CLACK, 3], [MARBLE_BOUNCE, 2],
      [GOAL_CHIME, 1], [TRACK_PLACE, 1], [BELL_DING, 2], [DOMINO_CLACK, 4],
    ]
    for (let round = 0; round < 4; round++) {
      for (const [track, voices] of plan) if (round < voices) this.pending.push(track)
    }
    const builder = this.createEvent("UpdateEvent")
    builder.bind(() => {
      const track = this.pending.shift()
      if (track) this.addVoice(track)
      else builder.enabled = false
    })
    const so = global.scene.createSceneObject("Music")
    so.setParent(this.sceneObject)
    const a = so.createComponent("Component.AudioComponent") as AudioComponent
    a.audioTrack = BACKGROUND_MUSIC
    a.volume = this.musicVolume
    a.playbackMode = Audio.PlaybackMode.LowPower
    a.play(-1)
  }

  playClick(): void { this.play(UI_CLICK, 0.8) }
  playDrop(): void { this.play(MARBLE_DROP, 0.7) }
  playChime(): void { this.play(GOAL_CHIME, 1.0) }
  playTrackPlace(): void { this.play(TRACK_PLACE, 0.6) }
  /** strength 0..1 scaled from impact speed by the caller. */
  playClack(strength: number): void { this.play(MARBLE_CLACK, 0.15 + 0.6 * strength) }
  playBounce(strength: number): void { this.play(MARBLE_BOUNCE, 0.2 + 0.7 * strength) }
  playBell(strength: number): void { this.play(BELL_DING, 0.4 + 0.6 * strength) }
  playDomino(strength: number): void { this.play(DOMINO_CLACK, 0.3 + 0.7 * strength) }

  private addVoice(track: AudioTrackAsset): void {
    const list = this.pools.get(track) ?? []
    const so = global.scene.createSceneObject("Sfx_" + track.name + "_" + list.length)
    so.setParent(this.sceneObject)
    const a = so.createComponent("Component.AudioComponent") as AudioComponent
    a.audioTrack = track
    a.playbackMode = Audio.PlaybackMode.LowLatency
    list.push(a)
    this.pools.set(track, list)
    if (!this.cursors.has(track)) this.cursors.set(track, 0)
  }

  private play(track: AudioTrackAsset, gain: number): void {
    const list = this.pools.get(track)
    if (!list || list.length === 0) return
    const i = this.cursors.get(track) ?? 0
    this.cursors.set(track, (i + 1) % list.length)
    const a = list[i]
    if (a.isPlaying()) a.stop(false)
    a.volume = Math.max(0, Math.min(1, gain * this.sfxVolume))
    a.play(1)
  }
}
