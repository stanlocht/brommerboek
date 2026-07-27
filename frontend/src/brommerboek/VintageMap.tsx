// The real, pannable vintage map. MapLibre renders OpenMapTiles vector data in
// the atlas palette (see mapStyle.ts); on top we draw the red route line, a
// rotated pin per stop and the Cub. Dragging the scrubber updates `progress`,
// which drives the Cub along the geographic route while the camera follows —
// the signature interaction.

import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { useCallback, useEffect, useRef, useState } from "react"
import type { RouteGeometry } from "./geo"
import { pointAt } from "./geo"
import { cubSvgString, flagSvgString, WRENCH_INNER } from "./icons"
import { isLiveFresh, trailGeoJSON } from "./live"
import { vintageStyle } from "./mapStyle"
import { bearingDelta, dampenBearing, INTRO_MS } from "./replayMath"
import { C, FONT_MONO, FONT_SERIF, PIN_ROTS } from "./theme"
import type {
  LiveLocation,
  LiveTrailPoint,
  MapFlag,
  MapFlagKind,
  Stop,
} from "./types"

const FOLLOW_ZOOM = 6.3
// Where the "zoom to the Cub" fly-to lands: close enough to name the town,
// far enough to keep some surrounding country for orientation.
const LIVE_ZOOM = 9.5
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

// The drawn route line follows the same geometry the cub drives — real
// ridden roads where leg tracks exist, straight pin-to-pin lines elsewhere.
function routeGeoJSON(points: RouteGeometry["points"]) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: points,
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
  // Start/finish flags. Independent of the stops — the finish flag marks
  // where the trip is headed, not where the latest stop is.
  flags?: MapFlag[]
  // Present for admins only: clicking a flag opens the flag editor.
  onFlagClick?: (kind: MapFlagKind) => void
  // Last GPS fix of the Cub from the tracker; null/absent hides the marker.
  live?: LiveLocation | null
  // Recent breadcrumbs (oldest first) drawn as a dotted teal trail under the
  // route; null/absent or fewer than 2 points draws nothing.
  trail?: LiveTrailPoint[] | null
  // Increments when the user asks to see the live fix (the LIVE chip); each
  // bump flies the camera to `live`. 0 (the initial value) never fires.
  liveFocus?: number
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
  flags = [],
  onFlagClick,
  live = null,
  trail = null,
  liveFocus = 0,
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
  const onFlagClickRef = useRef(onFlagClick)
  onFlagClickRef.current = onFlagClick
  const flagsRef = useRef(flags)
  flagsRef.current = flags
  const replayingRef = useRef(replaying)
  replayingRef.current = replaying
  const replayFollowRef = useRef(replayFollow)
  replayFollowRef.current = replayFollow
  const replayReducedRef = useRef(replayReduced)
  replayReducedRef.current = replayReduced
  const onReplayGestureRef = useRef(onReplayGesture)
  onReplayGestureRef.current = onReplayGesture
  const camBearingRef = useRef(0)
  // Latest geometry for the init load handler: the real ridden roads can
  // arrive before or after the style loads, so init reads through this ref
  // and the redraw effect below covers every later change.
  const routeRef = useRef(route)
  routeRef.current = route
  // Set on replay exit so the next progress sync skips the camera — the exit
  // easeTo below owns the restore and must not be cancelled.
  const skipFollowRef = useRef(false)
  // Machines without a working WebGL context (old GPUs, driver blocklists,
  // sandboxed browsers) make the Map constructor throw. That's the device's
  // limitation, not a crash — degrade to a static panel instead of letting
  // the error boundary take down the whole page.
  const [mapFailed, setMapFailed] = useState(false)

  // --- init map + layers (once) ---------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: init runs once
  useEffect(() => {
    if (!containerRef.current || stops.length === 0) return
    let map: maplibregl.Map
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: vintageStyle(),
        center: [stops[0].lng, stops[0].lat],
        zoom: 5,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      })
    } catch {
      setMapFailed(true)
      return
    }
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

    // A lost WebGL context (GPU reset, tab woken from sleep) nulls the map's
    // style while the Map object stays alive — any getSource/addLayer in
    // that window throws. Down tools until MapLibre has restored the style
    // (it re-applies the lost style, our sources and layers included).
    map.on("webglcontextlost", () => {
      readyRef.current = false
    })
    map.on("webglcontextrestored", () => {
      map.once("style.load", () => {
        if (mapRef.current === map) readyRef.current = true
      })
    })

    map.on("load", () => {
      // route line: cream casing + red dashed line
      map.addSource("route", {
        type: "geojson",
        data: routeGeoJSON(routeRef.current.points),
      })
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
        // Preparation posts keep the plain dot but in ochre — part of the
        // journal, visibly not part of the ride.
        const dotColor = s.type === "preparation" ? C.ochre : C.red
        const rot = PIN_ROTS[i % PIN_ROTS.length]
        el.innerHTML = `
          <div class="bb-pin-dot" style="transform:translate(-50%,-50%) rotate(${rot}deg)">
            ${
              isRepair
                ? `<svg width="24" height="24" viewBox="-12 -12 24 24"><circle cx="0" cy="0" r="12" fill="${C.teal}" stroke="${C.cream}" stroke-width="2.5"></circle><g transform="translate(-8,-8)" style="color:${C.cream}"><svg width="16" height="16" viewBox="0 0 24 24">${WRENCH_INNER}</svg></g></svg>`
                : `<svg width="22" height="22" viewBox="-11 -11 22 22"><circle cx="0" cy="0" r="9" fill="${dotColor}" stroke="${C.cream}" stroke-width="2.5"></circle><circle cx="0" cy="0" r="3" fill="${C.cream}"></circle></svg>`
            }
          </div>
          ${
            s.honk_count > 0
              ? `<span class="bb-pin-badge" aria-hidden="true">📯 ${s.honk_count}</span>`
              : ""
          }
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

      // frame the whole trip — flags included (when already loaded), so the
      // finish flag far beyond the latest stop stays in view
      const b = new maplibregl.LngLatBounds()
      for (const s of stops) b.extend([s.lng, s.lat])
      for (const f of flagsRef.current) b.extend([f.lng, f.lat])
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

  // --- start/finish flags ----------------------------------------------------
  // Markers are DOM overlays, so they can attach before the style finishes
  // loading — no need to wait for the map's `load` event. For admins the
  // flags are clickable and open the flag editor.
  const flagsClickable = !!onFlagClick
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stops` re-creates the markers after the init effect rebuilds the map
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const markers = flags.map((f) => {
      const el = document.createElement("div")
      el.className = flagsClickable ? "bb-flag bb-flag-editable" : "bb-flag"
      el.innerHTML = `${flagSvgString(f.kind)}${
        f.label ? `<span class="bb-flag-label">${f.label}</span>` : ""
      }`
      if (flagsClickable)
        el.addEventListener("click", (ev) => {
          ev.stopPropagation()
          onFlagClickRef.current?.(f.kind)
        })
      // The pole base sits 4px from the left and 2px above the bottom of
      // the flag art — offset so exactly that point lands on the coordinate.
      const marker = new maplibregl.Marker({
        element: el,
        anchor: "bottom-left",
        offset: [-4, 2],
      })
        .setLngLat([f.lng, f.lat])
        .addTo(map)
      return marker
    })
    return () => {
      for (const m of markers) m.remove()
    }
  }, [flags, flagsClickable, stops])

  // --- route line redraw -----------------------------------------------------
  // The route source is created at init from routeRef; this keeps it in sync
  // when the geometry changes afterwards (leg tracks loading in).
  useEffect(() => {
    const map = mapRef.current
    // The style re-check catches the webglcontextlost window (#68): the
    // event that clears readyRef only fires after MapLibre already nulled
    // map.style.
    if (!map || !readyRef.current || !map.style) return
    const source = map.getSource("route") as
      | maplibregl.GeoJSONSource
      | undefined
    source?.setData(routeGeoJSON(route.points))
  }, [route])

  // --- breadcrumb trail ------------------------------------------------------
  // A dotted teal line of the tracker's recent positions, slotted beneath the
  // route casing so the red route stays dominant. Unlike the markers this is
  // a style layer, so it must wait for the map's `load`; the init effect
  // registers its handler first, meaning route-casing already exists by the
  // time ours runs after a rebuild on `stops`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stops` re-adds the layer after the init effect rebuilds the map
  useEffect(() => {
    const map = mapRef.current
    if (!map || !trail || trail.length < 2) return
    const apply = () => {
      // Second check as in the route effect: no style, no sources (#68).
      if (mapRef.current !== map || !map.style) return
      const source = map.getSource("live-trail") as
        | maplibregl.GeoJSONSource
        | undefined
      if (source) {
        source.setData(trailGeoJSON(trail))
        return
      }
      map.addSource("live-trail", {
        type: "geojson",
        data: trailGeoJSON(trail),
      })
      map.addLayer(
        {
          id: "live-trail-line",
          type: "line",
          source: "live-trail",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": C.teal,
            "line-width": 2.4,
            // Tight round dashes: literal breadcrumbs, visibly different
            // from the long red dashes of the trip route.
            "line-dasharray": [0.1, 1.8],
            "line-opacity": 0.85,
          },
        },
        "route-casing",
      )
    }
    if (readyRef.current) apply()
    else map.once("load", apply)
    return () => {
      map.off("load", apply)
    }
  }, [trail, stops])

  // --- zoom to the live fix on demand ---------------------------------------
  // Flies the camera to the last GPS fix. Reads `live` through a ref so a
  // fresh fix arriving on its own never moves the camera — only a press does.
  const liveRef = useRef(live)
  liveRef.current = live
  const focusLive = useCallback(() => {
    const map = mapRef.current
    const fix = liveRef.current
    if (!map || !readyRef.current || !fix) return
    map.flyTo({
      center: [fix.lng, fix.lat],
      zoom: LIVE_ZOOM,
      pitch: 0,
      bearing: 0,
      duration: 1400,
    })
  }, [])
  // Every liveFocus bump means the LIVE chip was pressed; 0 is the initial
  // value and must not fire on mount.
  useEffect(() => {
    if (liveFocus) focusLive()
  }, [liveFocus, focusLive])

  // --- live GPS marker -------------------------------------------------------
  // Like the flags: a DOM overlay recreated per update (the fix changes at
  // most once a minute), so it also survives the map rebuild on `stops`.
  // Fresh fixes pulse; stale ones grey out but stay visible — the last known
  // spot is still the answer to "waar is de brommer nu?".
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stops` re-adds the marker after the init effect rebuilds the map
  useEffect(() => {
    const map = mapRef.current
    if (!map || !live) return
    const el = document.createElement("div")
    el.className = isLiveFresh(live.fix_time, Date.now())
      ? "bb-live-marker"
      : "bb-live-marker bb-live-stale"
    el.innerHTML = `<div class="bb-live-ring"></div><div class="bb-live-dot"></div>`
    el.style.cursor = "pointer"
    el.addEventListener("click", (ev) => {
      ev.stopPropagation()
      focusLive()
    })
    const marker = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([live.lng, live.lat])
      .addTo(map)
    return () => {
      marker.remove()
    }
  }, [live, stops, focusLive])

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

  if (mapFailed)
    return (
      <div
        className="bb-map-canvas"
        data-testid="map-fallback"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: 20,
          textAlign: "center",
          background: C.paperLight,
        }}
      >
        <div
          style={{
            fontFamily: FONT_SERIF,
            fontWeight: 700,
            fontSize: 22,
            color: C.ink,
          }}
        >
          De kaart doet het hier niet
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: C.sepia,
            maxWidth: 280,
          }}
        >
          dit apparaat kan geen WebGL-kaart tekenen — de rest van het
          brommerboek werkt gewoon.
        </div>
      </div>
    )

  return <div ref={containerRef} className="bb-map-canvas" />
}
