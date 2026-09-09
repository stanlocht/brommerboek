import { describe, expect, it } from "vitest"
import {
  isVideoFile,
  MAX_UPLOAD_BYTES,
  prepareUpload,
  TooLargeError,
} from "./imagePrep"

// The canvas re-encode itself needs a browser, so it's covered by the
// Playwright specs. What's checked here are the decisions taken around it:
// what passes through untouched, and what is refused before a byte is sent.

function fakeFile(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

describe("prepareUpload", () => {
  it("passes videos through untouched", async () => {
    const clip = fakeFile("ride.mp4", "video/mp4", 4 * 1024 * 1024)
    expect(await prepareUpload(clip)).toBe(clip)
  })

  it("leaves an already-small image alone", async () => {
    const small = fakeFile("pin.png", "image/png", 20 * 1024)
    expect(await prepareUpload(small)).toBe(small)
  })

  it("refuses a file the server would reject, before uploading it", async () => {
    const huge = fakeFile("long.mov", "video/quicktime", MAX_UPLOAD_BYTES + 1)
    await expect(prepareUpload(huge)).rejects.toBeInstanceOf(TooLargeError)
  })

  it("treats a typeless pick as an image unless it looks like a video", async () => {
    // Android pickers hand back a File with an empty `type` often enough
    // that guessing from the name is the difference between an upload and
    // a silent 415.
    const clip = fakeFile("VID_20260731.mp4", "", 30 * 1024)
    expect(await prepareUpload(clip)).toBe(clip)
  })
})

describe("isVideoFile", () => {
  it("goes by the declared type when there is one", () => {
    expect(isVideoFile(fakeFile("ride.mp4", "video/mp4", 10))).toBe(true)
    expect(isVideoFile(fakeFile("pin.png", "image/png", 10))).toBe(false)
  })

  it("falls back to the extension for a typeless pick", () => {
    expect(isVideoFile(fakeFile("VID_20260731.mov", "", 10))).toBe(true)
    expect(isVideoFile(fakeFile("IMG_0042.heic", "", 10))).toBe(false)
  })

  it("trusts the type over a misleading name", () => {
    // A clip saved as "clip.mp4.jpg" is still a clip; a picture named
    // ".mov" by some gallery app is still a picture.
    expect(isVideoFile(fakeFile("clip.mp4.jpg", "video/quicktime", 10))).toBe(
      true,
    )
    expect(isVideoFile(fakeFile("still.mov", "image/jpeg", 10))).toBe(false)
  })
})
