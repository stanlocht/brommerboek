import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import { deleteStopMedia, mediaSrc, uploadStopMedia } from "./api"
import { type PlaceHit, searchPlaces } from "./geocode"
import { WrenchIcon } from "./icons"
import { C, FONT_MONO } from "./theme"
import type { MediaItem, NewStop, Stop, WeatherCondition } from "./types"
import { WEATHER_OPTIONS } from "./weather"

const STEP_LABELS = ["LOCATIE", "MEDIA", "VERHAAL", "TYPE"]

const labelStyle: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  color: C.ochreDeep,
  display: "block",
}
const fieldStyle: CSSProperties = {
  border: `1.5px solid ${C.border}`,
  borderRadius: 8,
  padding: "11px 12px",
  background: C.paperCard,
  fontSize: 16,
  width: "100%",
  color: C.ink,
  fontFamily: "inherit",
}

// A label that wraps its control (keeps them associated for a11y).
function Field({
  label,
  color,
  children,
}: {
  label: string
  color?: string
  children: ReactNode
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label style={{ display: "block" }}>
      <span style={{ ...labelStyle, color: color ?? C.ochreDeep }}>
        {label}
      </span>
      {children}
    </label>
  )
}

// Presentational thumbnail — an <img>/<video> when we already have a URL,
// otherwise the vintage colour swatch that used to be the whole feature.
function MediaThumb({ item }: { item: MediaItem }) {
  const src = mediaSrc(item.url)
  if (src && item.kind === "video") {
    return (
      <video
        src={src}
        muted
        playsInline
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          borderRadius: 4,
          background: "#000",
        }}
      />
    )
  }
  if (src) {
    return (
      <img
        src={src}
        alt={item.cap || ""}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          borderRadius: 4,
        }}
      />
    )
  }
  const tone = item.tone || "#c9a24e"
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 4,
        background: `linear-gradient(150deg,rgba(255,255,255,.25),rgba(0,0,0,.3)),${tone}`,
      }}
    />
  )
}

export default function AddFlow({
  suggestedKm,
  initialStop,
  onClose,
  onCreate,
  onPatch,
  onDelete,
  onMediaChanged,
}: {
  // Prefill for the km input on new stops. `null` = no prior reading —
  // the field opens empty rather than "0".
  suggestedKm: number | null
  // When set, the flow edits an existing stop instead of creating a new
  // one, and media uploads land on it immediately.
  initialStop?: Stop
  onClose: () => void
  // Called when the user submits a NEW stop (no `initialStop`).
  onCreate?: (stop: NewStop) => void
  // Called when the user submits edits to an EXISTING stop.
  onPatch?: (id: string, patch: NewStop) => void
  // Called (edit mode only) when the user confirms deletion.
  onDelete?: (id: string) => void
  // Called after a successful media upload or delete on an existing stop —
  // gives the parent a chance to invalidate its React Query cache.
  onMediaChanged?: (stop: Stop) => void
}) {
  const isEdit = !!initialStop
  const [step, setStep] = useState(0)
  const [type, setType] = useState<"stop" | "repair">(
    initialStop?.type ?? "stop",
  )
  const [picked, setPicked] = useState<PlaceHit | null>(
    initialStop
      ? {
          key: initialStop.id,
          place: initialStop.place,
          country: initialStop.country,
          code: initialStop.code,
          flag: initialStop.flag,
          region: "",
          lat: initialStop.lat,
          lng: initialStop.lng,
        }
      : null,
  )
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<PlaceHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [date, setDate] = useState(
    initialStop?.date ?? new Date().toISOString().slice(0, 10),
  )
  const [title, setTitle] = useState(initialStop?.title ?? "")
  const [weatherTemp, setWeatherTemp] = useState<string>(
    initialStop?.weather_temp != null ? String(initialStop.weather_temp) : "",
  )
  const [weatherCondition, setWeatherCondition] = useState<WeatherCondition>(
    initialStop?.weather_condition ?? "",
  )
  // Empty string = user hasn't filled it. Only prefill when there IS a
  // prior reading; leaving it blank should stay blank.
  const initialKm =
    initialStop?.km != null
      ? String(initialStop.km)
      : suggestedKm != null
        ? String(suggestedKm)
        : ""
  const [km, setKm] = useState<string>(initialKm)
  const [story, setStory] = useState(initialStop?.story ?? "")
  const [broke, setBroke] = useState(initialStop?.broke ?? "")
  const [fixed, setFixed] = useState(initialStop?.fixed ?? "")
  // Media list — for an existing stop this mirrors the server; for a new
  // stop it's just captions/placeholders that get saved with the stop.
  const [media, setMedia] = useState<MediaItem[]>(initialStop?.media ?? [])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Two-step delete: first click shows the confirm bar; second click fires
  // onDelete. Confirmation resets whenever the user navigates a step.
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Debounced search: fires 400ms after the last keystroke, cancels the
  // in-flight request when the user keeps typing.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setSearching(false)
      setSearchError(null)
      return
    }
    const ac = new AbortController()
    const t = setTimeout(() => {
      setSearching(true)
      setSearchError(null)
      searchPlaces(trimmed, ac.signal)
        .then((hits) => {
          setResults(hits)
          setSearching(false)
        })
        .catch((err) => {
          if ((err as Error).name === "AbortError") return
          setSearching(false)
          setSearchError("Kon geen plaatsen ophalen")
        })
    }, 400)
    return () => {
      clearTimeout(t)
      ac.abort()
    }
  }, [query])

  const canProceedStep0 = picked !== null

  const pick = (hit: PlaceHit) => {
    setPicked(hit)
    setResults([])
    setQuery("")
    if (!title.trim()) setTitle(hit.place)
  }

  const parsedTemp =
    weatherTemp.trim() === "" ? null : Number.parseInt(weatherTemp, 10)
  const parsedKm = km.trim() === "" ? null : Number.parseInt(km, 10)

  const submit = () => {
    if (!picked) return
    const payload: NewStop = {
      place: picked.place,
      country: picked.country,
      code: picked.code,
      lat: picked.lat,
      lng: picked.lng,
      date,
      title: title.trim() || picked.place,
      km: parsedKm !== null && Number.isFinite(parsedKm) ? parsedKm : null,
      weather_temp:
        parsedTemp !== null && Number.isFinite(parsedTemp) ? parsedTemp : null,
      weather_condition: weatherCondition,
      type,
      story: story.trim(),
      broke: type === "repair" ? broke.trim() : null,
      fixed: type === "repair" ? fixed.trim() : null,
      media,
    }
    if (isEdit && initialStop && onPatch) {
      onPatch(initialStop.id, payload)
    } else if (onCreate) {
      onCreate(payload)
    }
  }

  const next = () => {
    if (step === 0 && !canProceedStep0) return
    setConfirmingDelete(false)
    if (step < 3) setStep((s) => s + 1)
    else submit()
  }
  const back = () => {
    setConfirmingDelete(false)
    setStep((s) => Math.max(0, s - 1))
  }

  // Autofocus the search input when landing on step 0 (only for new stops).
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (step === 0 && !picked) searchInputRef.current?.focus()
  }, [step, picked])

  const onPickFile = () => fileInputRef.current?.click()

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-selecting the same file
    if (!file) return
    setUploadError(null)
    // For an existing stop we upload straight to the server so the file
    // lives on the media volume; the response reflects the new media list.
    if (isEdit && initialStop) {
      setUploading(true)
      try {
        const updated = await uploadStopMedia(initialStop.id, file)
        setMedia(updated.media)
        onMediaChanged?.(updated)
      } catch (err) {
        setUploadError((err as Error).message ?? "Upload mislukt")
      } finally {
        setUploading(false)
      }
      return
    }
    // For a NEW stop we don't have an ID yet — stash a local-preview item
    // so the user can see what they picked, and defer the real upload until
    // after the stop is created (see BrommerboekApp.tsx).
    const url = URL.createObjectURL(file)
    const kind: MediaItem["kind"] = file.type.startsWith("video/")
      ? "video"
      : "image"
    setMedia((m) => [...m, { tone: "", cap: "", kind, url }])
  }

  const onRemoveMedia = async (index: number) => {
    setUploadError(null)
    if (isEdit && initialStop && media[index]?.url?.startsWith("/media/")) {
      setUploading(true)
      try {
        const updated = await deleteStopMedia(initialStop.id, index)
        setMedia(updated.media)
        onMediaChanged?.(updated)
      } catch (err) {
        setUploadError((err as Error).message ?? "Verwijderen mislukt")
      } finally {
        setUploading(false)
      }
      return
    }
    setMedia((m) => m.filter((_, i) => i !== index))
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 70,
        background: C.paperLight,
        display: "flex",
        flexDirection: "column",
      }}
      className="bb-fadein"
    >
      <div
        style={{
          padding: "16px 18px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${C.borderSoft}`,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            border: "none",
            background: "none",
            fontSize: 15,
            fontFamily: FONT_MONO,
            color: C.sepia,
            cursor: "pointer",
          }}
        >
          ✕ sluit
        </button>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 2,
            color: C.ochreDeep,
          }}
        >
          {isEdit ? "STOP BEWERKEN" : "NIEUWE STOP"} · {STEP_LABELS[step]}
        </div>
        <div style={{ width: 44 }} />
      </div>

      {/* progress dots */}
      <div style={{ display: "flex", gap: 6, padding: "12px 18px" }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: i <= step ? C.red : C.borderSoft,
            }}
          />
        ))}
      </div>

      <div
        className="bb-scroll"
        style={{ flex: 1, overflowY: "auto", padding: "6px 18px 18px" }}
      >
        {step === 0 && (
          <div className="bb-fadein">
            <div style={{ fontWeight: 700, fontSize: 22, marginBottom: 10 }}>
              Waar ben je?
            </div>

            <Field label="ZOEK PLAATS">
              <div style={{ position: "relative", marginTop: 4 }}>
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="bv. Firenze, Grimselpass, Vernazza…"
                  style={{ ...fieldStyle, paddingLeft: 34 }}
                />
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: C.ochreDeep,
                    fontSize: 14,
                  }}
                >
                  🔍
                </span>
              </div>
            </Field>

            {searching && (
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: C.sepia,
                  marginTop: 10,
                }}
              >
                zoeken…
              </div>
            )}
            {searchError && !searching && (
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: C.red,
                  marginTop: 10,
                }}
              >
                {searchError}
              </div>
            )}

            {results.length > 0 && (
              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {results.map((hit) => (
                  <button
                    key={hit.key}
                    type="button"
                    onClick={() => pick(hit)}
                    style={{
                      textAlign: "left",
                      border: `1.5px solid ${C.border}`,
                      borderRadius: 10,
                      padding: "10px 12px",
                      background: C.paperCard,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontFamily: "inherit",
                      color: C.ink,
                    }}
                  >
                    <span style={{ fontSize: 22 }} aria-hidden="true">
                      {hit.flag || "📍"}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 15,
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {hit.place}
                      </span>
                      <span
                        style={{
                          fontFamily: FONT_MONO,
                          fontSize: 10,
                          color: C.sepia,
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {[hit.region, hit.country].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {picked && (
              <div
                style={{
                  marginTop: 14,
                  border: `1.5px solid ${C.ochre}`,
                  borderRadius: 12,
                  padding: 14,
                  background: C.paperCard,
                  boxShadow: "1px 2px 0 rgba(120,90,40,.2)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 10,
                        letterSpacing: 2,
                        color: C.ochreDeep,
                      }}
                    >
                      GEKOZEN PLEK
                    </div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 18,
                        marginTop: 2,
                      }}
                    >
                      {picked.flag} {picked.place}
                    </div>
                    <div
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 11,
                        color: C.sepia,
                        marginTop: 2,
                      }}
                    >
                      {picked.country}
                    </div>
                    <div
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 10,
                        color: C.sepia,
                        marginTop: 6,
                      }}
                    >
                      ◉ {picked.lat.toFixed(4)}° N, {picked.lng.toFixed(4)}° E
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(null)
                      setQuery("")
                    }}
                    style={{
                      border: `1.5px solid ${C.ochre}`,
                      borderRadius: 8,
                      background: "none",
                      padding: "6px 10px",
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      color: C.sepia,
                      cursor: "pointer",
                    }}
                  >
                    ✕ wissen
                  </button>
                </div>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <Field label="DATUM">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  style={{ ...fieldStyle, marginTop: 4 }}
                />
              </Field>
            </div>

            {isEdit && onDelete && (
              <div style={{ marginTop: 22 }}>
                {!confirmingDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      border: `1.5px solid ${C.red}`,
                      borderRadius: 10,
                      background: "none",
                      fontFamily: FONT_MONO,
                      fontSize: 13,
                      color: C.red,
                      cursor: "pointer",
                    }}
                  >
                    ✕ verwijder deze stop
                  </button>
                ) : (
                  <div
                    className="bb-fadein"
                    style={{
                      border: `1.5px solid ${C.red}`,
                      background: "#f7dedb",
                      borderRadius: 10,
                      padding: 12,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 12,
                        color: C.red,
                        lineHeight: 1.35,
                      }}
                    >
                      Weet je het zeker? De stop en al z'n foto's zijn dan weg.
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(false)}
                        style={{
                          flex: 1,
                          padding: "10px 14px",
                          border: `1.5px solid ${C.ochre}`,
                          borderRadius: 8,
                          background: "none",
                          fontFamily: FONT_MONO,
                          fontSize: 12,
                          color: C.sepia,
                          cursor: "pointer",
                        }}
                      >
                        nee
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingDelete(false)
                          if (initialStop) onDelete(initialStop.id)
                        }}
                        style={{
                          flex: 1,
                          padding: "10px 14px",
                          border: "none",
                          borderRadius: 8,
                          background: C.red,
                          color: C.wrappedInk,
                          fontFamily: FONT_MONO,
                          fontSize: 12,
                          letterSpacing: 1,
                          cursor: "pointer",
                          boxShadow: "0 2px 0 rgba(90,30,20,.4)",
                        }}
                      >
                        ✕ ja, verwijder
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div
              style={{
                marginTop: 12,
                fontFamily: FONT_MONO,
                fontSize: 9,
                letterSpacing: 1,
                color: C.sepia,
                opacity: 0.75,
              }}
            >
              locaties · Photon / OpenStreetMap © bijdragers
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="bb-fadein">
            <div style={{ fontWeight: 700, fontSize: 22, marginBottom: 4 }}>
              Foto's & video's
            </div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.sepia,
                marginBottom: 14,
              }}
            >
              {media.length} toegevoegd
              {isEdit ? " · uploads staan direct online" : ""}
              {uploading ? " · uploaden…" : ""}
            </div>
            {uploadError && (
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: C.red,
                  marginBottom: 10,
                }}
              >
                {uploadError}
              </div>
            )}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              {media.map((item, i) => (
                <div
                  key={`${item.url ?? item.tone}-${i}`}
                  style={{
                    position: "relative",
                    aspectRatio: "1",
                    borderRadius: 8,
                    border: "4px solid #fff",
                    boxShadow: "0 2px 5px rgba(0,0,0,.2)",
                    overflow: "hidden",
                  }}
                >
                  <MediaThumb item={item} />
                  {item.kind === "video" && (
                    <div
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        top: 6,
                        left: 6,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: "rgba(0,0,0,.55)",
                        color: "#fff",
                        fontFamily: FONT_MONO,
                        fontSize: 10,
                        letterSpacing: 1,
                      }}
                    >
                      ▶ VIDEO
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveMedia(i)}
                    aria-label="Verwijder"
                    style={{
                      position: "absolute",
                      top: 4,
                      right: 4,
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      border: "none",
                      background: "rgba(0,0,0,.55)",
                      color: "#fff",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={onPickFile}
                aria-label="Voeg foto of video toe"
                disabled={uploading}
                style={{
                  aspectRatio: "1",
                  border: `2px dashed ${C.ochre}`,
                  borderRadius: 8,
                  background: "none",
                  color: "#8a6a3a",
                  fontSize: 30,
                  cursor: uploading ? "wait" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: uploading ? 0.6 : 1,
                }}
              >
                ＋
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                onChange={onFileChange}
                style={{ display: "none" }}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="bb-fadein">
            <div style={{ fontWeight: 700, fontSize: 22, marginBottom: 12 }}>
              Het verhaal
            </div>
            <Field label="TITEL">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{
                  ...fieldStyle,
                  margin: "4px 0 14px",
                  fontSize: 17,
                  fontWeight: 600,
                }}
              />
            </Field>
            <Field label="WEER">
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 4,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    position: "relative",
                    width: 96,
                    flex: "none",
                  }}
                >
                  <input
                    value={weatherTemp}
                    onChange={(e) => setWeatherTemp(e.target.value)}
                    inputMode="numeric"
                    placeholder="°C"
                    aria-label="Temperatuur in graden Celsius"
                    style={{
                      ...fieldStyle,
                      fontSize: 15,
                      paddingRight: 26,
                    }}
                  />
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      right: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: C.sepia,
                      fontFamily: FONT_MONO,
                      fontSize: 13,
                    }}
                  >
                    °C
                  </span>
                </div>
                <select
                  value={weatherCondition}
                  onChange={(e) =>
                    setWeatherCondition(e.target.value as WeatherCondition)
                  }
                  aria-label="Weertype"
                  style={{
                    ...fieldStyle,
                    fontSize: 15,
                    flex: 1,
                    appearance: "none",
                    backgroundImage:
                      "linear-gradient(45deg, transparent 50%, #7a6f5a 50%), linear-gradient(135deg, #7a6f5a 50%, transparent 50%)",
                    backgroundPosition:
                      "calc(100% - 16px) 18px, calc(100% - 11px) 18px",
                    backgroundSize: "5px 5px, 5px 5px",
                    backgroundRepeat: "no-repeat",
                  }}
                >
                  <option value="">— kies weer —</option>
                  {WEATHER_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.icon} {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <div style={{ marginBottom: 14 }}>
              <Field label="KM-STAND">
                <input
                  value={km}
                  onChange={(e) => setKm(e.target.value.replace(/[^\d]/g, ""))}
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder={
                    suggestedKm != null
                      ? `laatste stand: ${suggestedKm}`
                      : "laat leeg als je 'm niet weet"
                  }
                  style={{ ...fieldStyle, marginTop: 4, fontSize: 15 }}
                />
              </Field>
            </div>
            <Field label="VERHAAL">
              <textarea
                value={story}
                onChange={(e) => setStory(e.target.value)}
                style={{
                  ...fieldStyle,
                  marginTop: 4,
                  minHeight: 150,
                  fontSize: 15.5,
                  lineHeight: 1.6,
                  color: C.inkSoft,
                  resize: "vertical",
                }}
              />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="bb-fadein">
            <div style={{ fontWeight: 700, fontSize: 22, marginBottom: 14 }}>
              Wat voor stop?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <button
                type="button"
                onClick={() => setType("stop")}
                style={{
                  textAlign: "left",
                  border: `2px solid ${type === "stop" ? C.red : C.border}`,
                  borderRadius: 12,
                  padding: 16,
                  background: type === "stop" ? "#f7edd6" : C.paperCard,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <svg
                  width="34"
                  height="44"
                  viewBox="0 0 30 40"
                  aria-hidden="true"
                >
                  <path
                    d="M15 0C7 0 1 6 1 14c0 10 14 26 14 26s14-16 14-26C29 6 23 0 15 0Z"
                    fill={C.red}
                    stroke={C.paperLight}
                    strokeWidth="2"
                  />
                  <circle cx="15" cy="14" r="5" fill={C.paperLight} />
                </svg>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 18 }}>
                    Gewone stop
                  </div>
                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      color: C.sepia,
                    }}
                  >
                    een plek, een verhaal
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setType("repair")}
                style={{
                  textAlign: "left",
                  border: `2px solid ${type === "repair" ? C.teal : C.border}`,
                  borderRadius: 12,
                  padding: 16,
                  background: type === "repair" ? "#eaf1f2" : C.paperCard,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: C.teal,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "none",
                  }}
                >
                  <WrenchIcon size={20} color={C.cream} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 18 }}>Reparatie</div>
                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      color: C.sepia,
                    }}
                  >
                    wat brak, wat je maakte
                  </div>
                </div>
              </button>
              {type === "repair" && (
                <div
                  className="bb-fadein"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    marginTop: 2,
                  }}
                >
                  <Field label="WAT BRAK">
                    <input
                      value={broke}
                      onChange={(e) => setBroke(e.target.value)}
                      style={{ ...fieldStyle, marginTop: 4, fontSize: 15 }}
                    />
                  </Field>
                  <Field label="WAT JE MAAKTE" color={C.teal}>
                    <input
                      value={fixed}
                      onChange={(e) => setFixed(e.target.value)}
                      style={{ ...fieldStyle, marginTop: 4, fontSize: 15 }}
                    />
                  </Field>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          padding: "14px 18px",
          borderTop: `1px solid ${C.borderSoft}`,
          display: "flex",
          gap: 10,
        }}
      >
        {step > 0 && (
          <button
            type="button"
            onClick={back}
            style={{
              flex: "none",
              padding: "14px 18px",
              border: `1.5px solid ${C.ochre}`,
              borderRadius: 10,
              background: "none",
              fontFamily: FONT_MONO,
              fontSize: 13,
              color: C.sepia,
              cursor: "pointer",
            }}
          >
            ‹ terug
          </button>
        )}
        <button
          type="button"
          onClick={next}
          style={{
            flex: 1,
            padding: 14,
            border: "none",
            borderRadius: 10,
            background: C.red,
            color: C.wrappedInk,
            fontFamily: FONT_MONO,
            fontSize: 14,
            letterSpacing: 1,
            cursor: "pointer",
            boxShadow: "0 3px 0 rgba(90,30,20,.4)",
          }}
        >
          {step < 3 ? "volgende ›" : isEdit ? "✓ opslaan" : "✓ plaats stop"}
        </button>
      </div>
    </div>
  )
}
