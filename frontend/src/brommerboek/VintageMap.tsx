// The real, pannable vintage map. MapLibre renders OpenMapTiles vector data in
// the atlas palette (see mapStyle.ts); on top we draw the red route line, a
// rotated pin per stop and the Cub. Dragging the scrubber updates `progress`,
// which drives the Cub along the geographic route while the camera follows —
// the signature interaction.

import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { useCallback, useEffect, useRef } from "react"
import type { RouteGeometry } from "./geo"
import { pointAt } from "./geo"
import { cubSvgString, WRENCH_INNER } from "./icons"
import { vintageStyle } from "./mapStyle"
import { bearingDelta, dampenBearing, INTRO_MS } from "./replayMath"
import { C, PIN_ROTS } from "./theme"
import type { Stop } from "./types"

const FOLLOW_ZOOM = 6.3
// Cinematic replay camera: slightly closer than the scrub follow, pitched for
// depth, and rotated (dampened) toward the travel bearing. Per-frame bearing
// eases toward the target so leg changes swing gently instead of snapping.
const CINE_ZOOM = 7
const CINE_PITCH = 40
const CINE_BEARING_EASE = 0.06

// CSS transform that points the (right-facing) Cub along the travel bearing
// while keeping it wheels-down — mirrors horizontally for westbound legs
// instead of flipping upside down. Tilt is capped so the Cub always reads as
// mostly horizontal even for near-north/south headings.
const MAX_TILT_DEG = 22
function cubTransform(bearing: number): string {
  const westbound = bearing > 180
  const anchor = westbound ? 270 : 90
  const raw = bearing - anchor
  const phi = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, raw))
  const mirror = westbound ? " scaleX(-1)" : ""
  return `rotate(${phi.toFixed(1)}deg)${mirror}`
}

function routeGeoJSON(stops: Stop[]) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: stops.map((s) => [s.lng, s.lat]),
        },
        properties: {},
      },
    ],
  } as GeoJSON.FeatureCollection
}

interface Props {
  stops: Stop[]
  route: RouteGeometry
  progress: number
  dragging: boolean
  onPinClick: (index: number) => void
  // Cinematic replay mode: while true the camera follows the cub with pitch,
  // closer zoom and dampened rotation toward the travel bearing.
  replaying?: boolean
  // False while the user has taken the map over mid-replay — the timeline
  // keeps running but the camera stays hands-off.
  replayFollow?: boolean
  // Reduced motion: step the camera stop-to-stop without swoops or rotation.
  replayReduced?: boolean
  // A user gesture hit the map during a replay; the app pauses camera follow.
  onReplayGesture?: () => void
}

export default function VintageMap({
  stops,
  route,
  progress,
  dragging,
  onPinClick,
  replaying = false,
  replayFollow = true,
  replayReduced = false,
  onReplayGesture,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const readyRef = useRef(false)
  const pinsRef = useRef<maplibregl.Marker[]>([])
  const cubRef = useRef<maplibregl.Marker | null>(null)
  const cubRotRef = useRef<HTMLDivElement | null>(null)
  const interactedRef = useRef(false)
  const onPinClickRef = useRef(onPinClick)
  onPinClickRef.current = onPinClick
  const replayingRef = useRef(replaying)
  replayingRef.current = replaying
  const replayFollowRef = useRef(replayFollow)
  replayFollowRef.current = replayFollow
  const replayReducedRef = useRef(replayReduced)
  replayReducedRef.current = replayReduced
  const onReplayGestureRef = useRef(onReplayGesture)
  onReplayGestureRef.current = onReplayGesture
  const camBearingRef = useRef(0)
  // Set on replay exit so the next progress sync skips the camera — the exit
  // easeTo below owns the restore and must not be cancelled.
  const skipFollowRef = useRef(false)

  // --- init map + layers (once) ---------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: init runs once
  useEffect(() => {
    if (!containerRef.current || stops.length === 0) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: vintageStyle(),
      center: [stops[0].lng, stops[0].lat],
      zoom: 5,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    })
    map.touchZoomRotate.disableRotation()
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    )
    mapRef.current = map

    // Any real user gesture during a replay hands the camera back to the
    // user — originalEvent distinguishes input from our own easeTo/jumpTo.
    const gesture = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent && replayingRef.current)
        onReplayGestureRef.current?.()
    }
    map.on("dragstart", gesture)
    map.on("zoomstart", gesture)

    map.on("load", () => {
      // route line: cream casing + red dashed line
      map.addSource("route", { type: "geojson", data: routeGeoJSON(stops) })
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": C.cream, "line-width": 7, "line-opacity": 1 },
      })
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": C.routeRed,
          "line-width": 3.2,
          "line-dasharray": [0.2, 1.6],
          "line-opacity": 1,
        },
      })

      // pins
      stops.forEach((s, i) => {
        const el = document.createElement("div")
        el.className = "bb-pin"
        const isRepair = s.type === "repair"
        const rot = PIN_ROTS[i % PIN_ROTS.length]
        el.innerHTML = `
          <div class="bb-pin-dot" style="transform:translate(-50%,-50%) rotate(${rot}deg)">
            ${
              isRepair
                ? `<svg width="24" height="24" viewBox="-12 -12 24 24"><circle cx="0" cy="0" r="12" fill="${C.teal}" stroke="${C.cream}" stroke-width="2.5"></circle><g transform="translate(-8,-8)" style="color:${C.cream}"><svg width="16" height="16" viewBox="0 0 24 24">${WRENCH_INNER}</svg></g></svg>`
                : `<svg width="22" height="22" viewBox="-11 -11 22 22"><circle cx="0" cy="0" r="9" fill="${C.red}" stroke="${C.cream}" stroke-width="2.5"></circle><circle cx="0" cy="0" r="3" fill="${C.cream}"></circle></svg>`
            }
          </div>
          <span class="bb-pin-label">${s.place}</span>`
        el.addEventListener("click", (ev) => {
          ev.stopPropagation()
          onPinClickRef.current(i)
        })
        const marker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([s.lng, s.lat])
          .addTo(map)
        pinsRef.current.push(marker)
      })

      // cub
      const cubEl = document.createElement("div")
      cubEl.className = "bb-cub-marker"
      const rot = document.createElement("div")
      rot.className = "bb-cub-rot"
      const bob = document.createElement("div")
      bob.className = "bb-cub-bob"
      bob.innerHTML = cubSvgString(60, 81)
      rot.appendChild(bob)
      cubEl.appendChild(rot)
      cubRotRef.current = rot
      const last = stops[stops.length - 1]
      cubRef.current = new maplibregl.Marker({
        element: cubEl,
        anchor: "center",
      })
        .setLngLat([last.lng, last.lat])
        .addTo(map)

      readyRef.current = true

      // frame the whole trip
      const b = new maplibregl.LngLatBounds()
      for (const s of stops) b.extend([s.lng, s.lat])
      map.fitBounds(b, {
        padding: { top: 120, bottom: 250, left: 55, right: 55 },
        duration: 0,
      })
      // place cub at the current progress
      syncCub(progress, false)
    })

    return () => {
      map.remove()
      mapRef.current = null
      readyRef.current = false
      pinsRef.current = []
      cubRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops])

  // --- move cub + follow camera on progress/drag ----------------------------
  // ALL camera math lives here (plus the replay enter/exit effect below).
  const syncCub = useCallback(
    (t: number, follow: boolean) => {
      const map = mapRef.current
      const cub = cubRef.current
      if (!map || !cub || !readyRef.current) return
      const pt = pointAt(route, t)
      cub.setLngLat([pt.lng, pt.lat])
      if (cubRotRef.current)
        cubRotRef.current.style.transform = cubTransform(pt.bearing)
      if (!follow) return
      if (replayingRef.current) {
        // The user owns the camera after a gesture; the intro flyTo (which
        // keeps the map moving) also finishes undisturbed.
        if (!replayFollowRef.current || map.isMoving()) return
        if (replayReducedRef.current) {
          map.jumpTo({ center: [pt.lng, pt.lat], zoom: CINE_ZOOM })
        } else {
          const target = dampenBearing(pt.bearing)
          camBearingRef.current +=
            bearingDelta(camBearingRef.current, target) * CINE_BEARING_EASE
          map.jumpTo({
            center: [pt.lng, pt.lat],
            zoom: CINE_ZOOM,
            pitch: CINE_PITCH,
            bearing: camBearingRef.current,
          })
        }
        return
      }
      if (dragging) {
        map.jumpTo({ center: [pt.lng, pt.lat], pitch: 0, bearing: 0 })
      } else if (interactedRef.current) {
        map.easeTo({
          center: [pt.lng, pt.lat],
          zoom: FOLLOW_ZOOM,
          pitch: 0,
          bearing: 0,
          duration: 650,
          easing: (x) => 1 - (1 - x) ** 3,
        })
      }
    },
    [route, dragging],
  )

  // Replay enter/exit transitions: an initial swoop down to the first stop,
  // and a smooth north-up pitch-0 restore on the way out. Declared before the
  // progress sync so the flyTo is already running (and wins) when the first
  // replay progress lands.
  const prevReplayingRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    const was = prevReplayingRef.current
    prevReplayingRef.current = replaying
    if (!map || !readyRef.current || was === replaying) return
    if (replaying) {
      camBearingRef.current = 0
      const pt = pointAt(route, 0)
      if (replayReduced) {
        map.jumpTo({
          center: [pt.lng, pt.lat],
          zoom: CINE_ZOOM,
          pitch: 0,
          bearing: 0,
        })
      } else {
        map.flyTo({
          center: [pt.lng, pt.lat],
          zoom: CINE_ZOOM,
          pitch: CINE_PITCH,
          bearing: 0,
          duration: INTRO_MS,
        })
      }
    } else {
      skipFollowRef.current = true
      const pt = pointAt(route, progress)
      map.easeTo({
        center: [pt.lng, pt.lat],
        zoom: FOLLOW_ZOOM,
        pitch: 0,
        bearing: 0,
        duration: 650,
        easing: (x) => 1 - (1 - x) ** 3,
      })
    }
  }, [replaying, replayReduced, route, progress])

  // biome-ignore lint/correctness/useExhaustiveDependencies: replayFollow re-frames the camera when follow resumes
  useEffect(() => {
    if (dragging) interactedRef.current = true
    const skip = skipFollowRef.current
    skipFollowRef.current = false
    syncCub(progress, !skip)
  }, [progress, dragging, replayFollow, syncCub])

  return <div ref={containerRef} className="bb-map-canvas" />
}
