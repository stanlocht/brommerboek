// Shrink camera clips in the browser before they go up the wire.
//
// Photos have been shrunk client-side for a while (see imagePrep.ts); videos
// were passed through untouched, and that is what made attaching a clip feel
// like a coin flip. A phone shoots 1080p60 or 4K at 15-50 Mbps, so a clip is
// over the 25 MB ceiling after a handful of seconds — refused outright — and
// anything just under it is still minutes of uploading on a rural mobile
// uplink, which is plenty of time for the connection to drop.
//
// So we re-encode: draw the clip onto a downscaled canvas, record that canvas
// (plus the original audio) with MediaRecorder at a modest bitrate, and trim
// at MAX_VIDEO_SECONDS. A clip that came off the phone at 60 MB leaves here
// at ~5 MB, which uploads in seconds and survives a bad moment on the road.
// Short clips are the trade — that is the deal the logbook wants.
//
// Every failure path returns the original file. A slightly-too-big upload
// that might still work beats refusing a clip because this browser lacks
// MediaRecorder.

// Longest edge after downscaling: 720p-class, which is more than a phone
// screen shows of a clip embedded in a gallery card.
const MAX_DIM = 1280
// Hard cap on clip length. Re-encoding runs in real time (the video has to
// play through), so this doubles as the ceiling on how long the rider waits.
export const MAX_VIDEO_SECONDS = 20
const VIDEO_BITS_PER_SECOND = 2_000_000
const AUDIO_BITS_PER_SECOND = 96_000
const FPS = 30

// Clips already this small AND this short go up untouched — re-encoding
// costs the clip's full duration in wall time and buys nothing.
const SKIP_BELOW_BYTES = 4 * 1024 * 1024

// Give up waiting for `loadedmetadata` — a file the browser can't demux
// never fires it, and without a timeout the flow would hang forever.
const METADATA_TIMEOUT_MS = 15_000
// Backstop on the recording itself: playback stalling mid-clip would
// otherwise leave the recorder running with nothing arriving.
const RECORD_GRACE_MS = 15_000

// Recording containers, best first. MP4 leads on purpose: iOS Safari plays
// no WebM, so a WebM re-encode would upload fine and then show a black box
// to half the people following the trip.
const MIME_PREFERENCE = [
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  "video/mp4;codecs=avc1",
  "video/mp4",
  'video/webm;codecs="vp8,opus"',
  "video/webm",
]

export interface RecordingType {
  mime: string
  ext: "mp4" | "webm"
}

/** The best container this browser can record, or null if it can't record. */
export function pickRecordingType(
  supported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
): RecordingType | null {
  for (const mime of MIME_PREFERENCE) {
    if (supported(mime)) {
      return { mime, ext: mime.startsWith("video/mp4") ? "mp4" : "webm" }
    }
  }
  return null
}

/** Canvas size for a source frame, capped at MAX_DIM on its longest edge. */
export function videoTargetSize(
  w: number,
  h: number,
): { w: number; h: number } {
  const longest = Math.max(w, h)
  // Encoders reject odd dimensions on some Android devices, so round to even.
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  if (longest <= MAX_DIM) return { w: even(w), h: even(h) }
  const scale = MAX_DIM / longest
  return { w: even(w * scale), h: even(h * scale) }
}

/**
 * Whether a clip is already small and short enough to send as-is.
 *
 * `duration` may be NaN or Infinity — some Android recordings ship without
 * usable metadata — in which case we can't vouch for the length and re-encode.
 */
export function canSkipReencode(size: number, duration: number): boolean {
  if (!Number.isFinite(duration) || duration <= 0) return false
  return size <= SKIP_BELOW_BYTES && duration <= MAX_VIDEO_SECONDS
}

/**
 * Whether re-encoding into `type` is worth doing for this clip.
 *
 * MP4 is always worth it. WebM only when the original would be refused
 * anyway (`overCeiling`): an unplayable-on-iOS clip is a poor outcome, but
 * it beats the clip never reaching the stop at all.
 */
export function shouldReencode(
  type: RecordingType,
  overCeiling: boolean,
): boolean {
  return type.ext === "mp4" || overCeiling
}

function loadMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("video metadata timeout")),
      METADATA_TIMEOUT_MS,
    )
    const done = (err?: Error) => {
      clearTimeout(timer)
      video.removeEventListener("loadedmetadata", onLoaded)
      video.removeEventListener("error", onError)
      err ? reject(err) : resolve()
    }
    const onLoaded = () => done()
    const onError = () => done(new Error("video decode failed"))
    video.addEventListener("loadedmetadata", onLoaded)
    video.addEventListener("error", onError)
  })
}

// Tap the element's audio through Web Audio rather than reading it off
// `video.captureStream()`: routing it into a MediaStreamDestination (and
// deliberately *not* into `ctx.destination`) captures the sound while the
// clip plays back silently, so re-encoding doesn't blast the rider's own
// video out of the phone speaker.
function tapAudio(
  video: HTMLVideoElement,
): { track: MediaStreamTrack; close: () => void } | null {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Ctx) return null
    const ctx = new Ctx()
    const source = ctx.createMediaElementSource(video)
    const dest = ctx.createMediaStreamDestination()
    source.connect(dest)
    const track = dest.stream.getAudioTracks()[0]
    if (!track) {
      void ctx.close()
      return null
    }
    return {
      track,
      close: () => {
        track.stop()
        void ctx.close()
      },
    }
  } catch {
    // Silent clip beats no clip.
    return null
  }
}

/**
 * Downscale, re-encode and trim a video, ready to upload.
 *
 * Returns the original file unchanged when the clip is already small, when
 * the browser can't record, or when anything at all goes wrong — never
 * throws. Callers still apply the upload size ceiling afterwards.
 *
 * @param onProgress fraction 0..1 of the clip processed so far.
 */
export async function prepareVideo(
  file: File,
  onProgress?: (fraction: number) => void,
  overCeiling = false,
): Promise<File> {
  const type = pickRecordingType()
  if (!type || !shouldReencode(type, overCeiling)) return file
  if (typeof document === "undefined") return file

  const url = URL.createObjectURL(file)
  const video = document.createElement("video")
  video.preload = "auto"
  video.playsInline = true
  // Some mobile browsers refuse to decode a detached element; keeping it in
  // the document (invisible, 1px) is the reliable way to get frames.
  video.style.cssText =
    "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none"
  video.src = url

  let audio: ReturnType<typeof tapAudio> = null
  let recorder: MediaRecorder | null = null
  let raf = 0
  let cleaned = false
  // Runs on every exit path — including the early "nothing to do" returns —
  // so a decoded clip never keeps a MediaRecorder, an AudioContext and a
  // detached <video> alive behind the flow.
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    cancelAnimationFrame(raf)
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop()
    } catch {
      // Already stopped — nothing to undo.
    }
    audio?.close()
    video.pause()
    video.removeAttribute("src")
    video.load()
    video.remove()
    URL.revokeObjectURL(url)
  }

  try {
    document.body.appendChild(video)
    await loadMetadata(video)
    if (canSkipReencode(file.size, video.duration)) return file
    const size = videoTargetSize(
      video.videoWidth || MAX_DIM,
      video.videoHeight || MAX_DIM,
    )
    const canvas = document.createElement("canvas")
    canvas.width = size.w
    canvas.height = size.h
    const ctx = canvas.getContext("2d")
    if (!ctx || typeof canvas.captureStream !== "function") return file

    const stream = canvas.captureStream(FPS)
    audio = tapAudio(video)
    if (audio) stream.addTrack(audio.track)

    // An unmuted element needs user activation to play. The file picker was
    // a click, so this normally holds; if it doesn't, fall back to a muted
    // (and therefore silent) pass rather than losing the clip.
    try {
      await video.play()
    } catch {
      audio?.close()
      audio = null
      video.muted = true
      video.currentTime = 0
      await video.play()
    }

    const target = Math.min(
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : MAX_VIDEO_SECONDS,
      MAX_VIDEO_SECONDS,
    )
    const chunks: Blob[] = []
    recorder = new MediaRecorder(stream, {
      mimeType: type.mime,
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    })
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }

    const recording = new Promise<void>((resolve, reject) => {
      const rec = recorder as MediaRecorder
      const guard = setTimeout(
        () => {
          clearTimeout(guard)
          reject(new Error("recording stalled"))
        },
        target * 1000 + RECORD_GRACE_MS,
      )
      rec.onstop = () => {
        clearTimeout(guard)
        resolve()
      }
      rec.onerror = () => {
        clearTimeout(guard)
        reject(new Error("recording failed"))
      }
      const stop = () => {
        if (rec.state !== "inactive") rec.stop()
      }
      video.addEventListener("ended", stop)
      // The draw loop doubles as the trim clock: once the playhead reaches
      // the cap we stop recording and let the rest of the clip go.
      const draw = () => {
        ctx.drawImage(video, 0, 0, size.w, size.h)
        onProgress?.(Math.min(video.currentTime / target, 1))
        if (video.currentTime >= target) {
          stop()
          return
        }
        if (!video.paused && !video.ended) raf = requestAnimationFrame(draw)
      }
      raf = requestAnimationFrame(draw)
      // Timeslice so chunks arrive as we go instead of one blob at the end,
      // which some Android builds never deliver for a long recording.
      rec.start(1000)
    })

    await recording
    const blob = new Blob(chunks, { type: type.mime })
    if (blob.size === 0) return file
    // A "shrink" that grew the file (already-tiny clip, pathological source)
    // is not worth the quality it cost.
    if (blob.size >= file.size && !overCeiling) return file
    const name = `${file.name.replace(/\.[^./]+$/, "") || "clip"}.${type.ext}`
    return new File([blob], name, {
      type: type.ext === "mp4" ? "video/mp4" : "video/webm",
      lastModified: file.lastModified,
    })
  } catch {
    return file
  } finally {
    cleanup()
  }
}
