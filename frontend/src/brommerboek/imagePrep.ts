// Shrink camera photos in the browser before they go up the wire.
//
// A phone camera writes 4-15 MB per shot (more on the 50/108 MP Android
// sensors), while the app never shows more than a 640px thumbnail and a
// lightbox. Sending the original was costing minutes per stop on a mobile
// uplink and, worse, tended to die halfway. Re-encoding to a 2048px JPEG
// turns ~10 MB into a few hundred KB — the same picture as far as any
// screen is concerned, roughly 25x less to upload.
//
// Re-encoding also normalises the format. Android pickers hand back HEIC/
// HEIF (and occasionally a File with an empty `type`), which the upload
// endpoint used to reject or store as a file no browser can display; a
// canvas round-trip makes all of it plain image/jpeg.

// Longest edge after downscaling. 2048 keeps a photo sharp on a retina
// lightbox while staying an order of magnitude under a camera original.
const MAX_DIM = 2048
const JPEG_QUALITY = 0.82

// Images already smaller than this are sent untouched — re-encoding a
// screenshot or an already-shrunk photo only loses quality.
const SKIP_BELOW_BYTES = 512 * 1024

// Mirrors MAX_UPLOAD_BYTES in backend/app/api/routes/stops.py. Checked
// client-side too so an oversized clip fails instantly instead of after a
// multi-minute upload that ends in a 413.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

// Extensions the phone pickers hand back for clips. Only consulted when the
// File carries no `type` at all — the same fallback the upload endpoints
// apply server-side.
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|3gp)$/i

/** Whether a picked file is a clip rather than a picture. */
export function isVideoFile(file: File): boolean {
  if (file.type) return file.type.startsWith("video/")
  return VIDEO_EXT.test(file.name)
}

export class TooLargeError extends Error {
  constructor(file: File) {
    super(
      `${file.name || "Bestand"} is ${Math.round(file.size / (1024 * 1024))} MB — max ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`,
    )
    this.name = "TooLargeError"
  }
}

function scaledSize(w: number, h: number): { w: number; h: number } | null {
  const longest = Math.max(w, h)
  if (longest <= MAX_DIM) return null
  const scale = MAX_DIM / longest
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
}

// Decode to a bitmap, preferring createImageBitmap: it decodes off the main
// thread and lets us close the bitmap the moment we're done, so peak memory
// is one image rather than one per picked file. The <img> fallback covers
// browsers where createImageBitmap chokes on the source format.
async function decode(
  file: File,
): Promise<{ src: CanvasImageSource; w: number; h: number; close(): void }> {
  if (typeof createImageBitmap === "function") {
    // `from-image` bakes in the EXIF rotation phones write instead of
    // rotating pixels; the canvas output carries no EXIF at all, so an
    // unrotated decode would upload the photo lying on its side.
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    })
    return {
      src: bitmap,
      w: bitmap.width,
      h: bitmap.height,
      close: () => bitmap.close(),
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("decode failed"))
      el.src = url
    })
    return {
      src: img,
      w: img.naturalWidth,
      h: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    }
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  )
}

/**
 * Downscale + re-encode an image to a modest JPEG, ready to upload.
 *
 * Videos and small images pass through untouched. Anything the browser
 * can't decode (HEIC on a browser without HEIC support, a corrupt file)
 * also passes through untouched — the backend accepts HEIF and makes a
 * thumbnail for it, so the worst case is the old slow-but-working path
 * rather than a lost photo.
 *
 * @throws TooLargeError when the file can't be brought under the server's
 * size ceiling — the only case where it's kinder to refuse up front.
 */
export async function prepareUpload(file: File): Promise<File> {
  const isImage =
    file.type.startsWith("image/") ||
    // Android pickers sometimes report no type at all; treat a
    // not-obviously-video file as an image and let the decode decide.
    (!file.type && !VIDEO_EXT.test(file.name))
  if (!isImage || file.size <= SKIP_BELOW_BYTES) {
    if (file.size > MAX_UPLOAD_BYTES) throw new TooLargeError(file)
    return file
  }

  let decoded: Awaited<ReturnType<typeof decode>> | null = null
  try {
    decoded = await decode(file)
    const target = scaledSize(decoded.w, decoded.h) ?? {
      w: decoded.w,
      h: decoded.h,
    }
    const canvas = document.createElement("canvas")
    canvas.width = target.w
    canvas.height = target.h
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("no 2d context")
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(decoded.src, 0, 0, target.w, target.h)
    const blob = await toBlob(canvas)
    // Free the backing store on the spot; some mobile browsers hang onto a
    // 2048px canvas well past the last reference to it.
    canvas.width = 0
    canvas.height = 0
    if (!blob) throw new Error("encode failed")
    // A re-encode that came out bigger (rare, but small PNGs and already
    // heavily compressed sources manage it) is not worth the quality loss.
    if (blob.size >= file.size) {
      if (file.size > MAX_UPLOAD_BYTES) throw new TooLargeError(file)
      return file
    }
    const name = `${file.name.replace(/\.[^./]+$/, "") || "foto"}.jpg`
    return new File([blob], name, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    })
  } catch (err) {
    if (err instanceof TooLargeError) throw err
    // Couldn't process it — fall back to the original, but still refuse
    // what the server is going to reject anyway.
    if (file.size > MAX_UPLOAD_BYTES) throw new TooLargeError(file)
    return file
  } finally {
    decoded?.close()
  }
}
