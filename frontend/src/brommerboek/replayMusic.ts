// The little tune under the "rij de reis" replay. It is synthesised with the
// Web Audio API rather than shipped as an audio file: no megabytes to load
// before the replay can start, no licensing, and it loops forever without a
// seam. Two voices — a bouncing oom-pah bass and a jaunty melody on top —
// in G major at a putt-putt tempo.
//
// The note maths lives in the exported pure helpers so vitest can check the
// loop without an AudioContext; the class below only does scheduling.

export interface TuneNote {
  // Position in beats from the start of the loop.
  beat: number
  midi: number
  // Length in beats.
  dur: number
  voice: "lead" | "bass"
}

export const BPM = 132
// Four bars of 4/4 — long enough not to nag, short enough to stay catchy.
export const TUNE_BEATS = 16

const lead = (beat: number, midi: number, dur: number): TuneNote => ({
  beat,
  midi,
  dur,
  voice: "lead",
})
const bass = (beat: number, midi: number): TuneNote => ({
  beat,
  midi,
  dur: 0.45,
  voice: "bass",
})

// G — C — D — G, the friendliest four chords there are.
export const TUNE: TuneNote[] = [
  lead(0, 74, 1),
  lead(1, 71, 0.5),
  lead(1.5, 72, 0.5),
  lead(2, 74, 1),
  lead(3, 76, 1),
  lead(4, 74, 1.5),
  lead(5.5, 71, 0.5),
  lead(6, 69, 2),
  lead(8, 71, 1),
  lead(9, 74, 1),
  lead(10, 76, 0.5),
  lead(10.5, 74, 0.5),
  lead(11, 71, 1),
  lead(12, 72, 1),
  lead(13, 71, 0.5),
  lead(13.5, 69, 0.5),
  lead(14, 67, 2),
  // oom-pah: root on the beat, fifth off it
  bass(0, 43),
  bass(1, 50),
  bass(2, 43),
  bass(3, 50),
  bass(4, 48),
  bass(5, 55),
  bass(6, 48),
  bass(7, 55),
  bass(8, 50),
  bass(9, 57),
  bass(10, 50),
  bass(11, 57),
  bass(12, 43),
  bass(13, 50),
  bass(14, 43),
  bass(15, 50),
]

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

export function beatSeconds(bpm = BPM): number {
  return 60 / bpm
}

// Every note starting in the half-open beat window [from, to), with `beat`
// rewritten to its absolute position on the endless timeline — so the caller
// can schedule straight through the loop seam.
export function notesInWindow(
  from: number,
  to: number,
  tune: TuneNote[] = TUNE,
  loop = TUNE_BEATS,
): TuneNote[] {
  if (!(to > from) || loop <= 0) return []
  const out: TuneNote[] = []
  const firstCycle = Math.floor(from / loop)
  const lastCycle = Math.floor((to - Number.EPSILON) / loop)
  for (let c = firstCycle; c <= lastCycle; c++) {
    for (const n of tune) {
      const beat = c * loop + n.beat
      if (beat >= from && beat < to) out.push({ ...n, beat })
    }
  }
  return out.sort((a, b) => a.beat - b.beat)
}

type Ctor = typeof AudioContext
function audioCtor(): Ctor | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as {
    AudioContext?: Ctor
    webkitAudioContext?: Ctor
  }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

export function audioSupported(): boolean {
  return audioCtor() !== null
}

// How far ahead of the clock notes are queued, and how often we top the queue
// up. A generous lookahead is what keeps the tune steady while the main
// thread is busy drawing the map.
const LOOKAHEAD_S = 0.3
const TICK_MS = 60
const VOLUME = 0.16

export class ReplayMusic {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private startTime = 0
  private cursor = 0
  private muted = false
  private stopped = false

  constructor(muted = false) {
    this.muted = muted
  }

  // Must be called from a user gesture (the replay's play button) or the
  // browser leaves the context suspended.
  start(): void {
    const Ctor = audioCtor()
    if (!Ctor || this.ctx) return
    let ctx: AudioContext
    try {
      ctx = new Ctor()
    } catch {
      return
    }
    this.ctx = ctx
    this.stopped = false
    const master = ctx.createGain()
    master.gain.setValueAtTime(0, ctx.currentTime)
    master.gain.linearRampToValueAtTime(
      this.muted ? 0 : VOLUME,
      ctx.currentTime + 0.6,
    )
    master.connect(ctx.destination)
    this.master = master
    this.startTime = ctx.currentTime + 0.12
    this.cursor = 0
    void ctx.resume?.()
    this.pump()
    this.timer = setInterval(() => this.pump(), TICK_MS)
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    // Ramp instead of a hard set: a step in the gain is an audible click.
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime)
    master.gain.linearRampToValueAtTime(
      muted ? 0 : VOLUME,
      ctx.currentTime + 0.25,
    )
    if (!muted) void ctx.resume?.()
  }

  // Silence without tearing down — used while the replay is paused or the tab
  // is in the background, so resuming picks the tune straight back up.
  setPlaying(playing: boolean): void {
    const ctx = this.ctx
    if (!ctx || this.stopped) return
    if (playing) {
      void ctx.resume?.()
      if (!this.timer) this.timer = setInterval(() => this.pump(), TICK_MS)
    } else {
      void ctx.suspend?.()
    }
  }

  stop(): void {
    const ctx = this.ctx
    const master = this.master
    this.stopped = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.ctx = null
    this.master = null
    if (!ctx || !master) return
    // Fade out, then close — closing mid-note pops.
    try {
      void ctx.resume?.()
      master.gain.cancelScheduledValues(ctx.currentTime)
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime)
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35)
    } catch {
      // a context already torn down by the browser — nothing to fade
    }
    setTimeout(() => void ctx.close?.().catch(() => {}), 500)
  }

  private pump(): void {
    const ctx = this.ctx
    if (!ctx || this.stopped) return
    // A suspended context's clock is frozen, so the window below stays put
    // and no notes pile up while the replay is paused.
    if (ctx.state === "suspended") return
    const spb = beatSeconds()
    const horizon = (ctx.currentTime + LOOKAHEAD_S - this.startTime) / spb
    if (horizon <= this.cursor) return
    for (const n of notesInWindow(this.cursor, horizon)) {
      this.playNote(n, this.startTime + n.beat * spb, n.dur * spb)
    }
    this.cursor = horizon
  }

  private playNote(note: TuneNote, at: number, dur: number): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const t = Math.max(at, ctx.currentTime)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const isLead = note.voice === "lead"
    osc.type = isLead ? "triangle" : "square"
    osc.frequency.setValueAtTime(midiToFreq(note.midi), t)
    const peak = isLead ? 0.75 : 0.35
    const hold = Math.max(0.08, dur * (isLead ? 0.85 : 0.5))
    // Plucked envelope: quick in, gentle out, always back to zero so notes
    // never smear into each other.
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.linearRampToValueAtTime(peak, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + hold)
    osc.connect(gain)
    if (isLead) {
      gain.connect(master)
    } else {
      // Roll the square wave's fizz off so the bass stays a warm putt-putt.
      const lp = ctx.createBiquadFilter()
      lp.type = "lowpass"
      lp.frequency.setValueAtTime(700, t)
      gain.connect(lp).connect(master)
    }
    osc.start(t)
    osc.stop(t + hold + 0.05)
  }
}
