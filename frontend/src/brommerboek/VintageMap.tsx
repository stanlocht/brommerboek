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
import { C, PIN_ROTS } from "./theme"
import type { Stop } from "./types"

const FOLLOW_ZOOM = 6.3

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
  repairOnly: boolean
  onPinClick: (index: number) => void
}

export default function VintageMap({
  stops,
  route,
  progress,
  dragging,
  repairOnly,
  onPinClick,
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
      bob.innerHTML = cubSvgString(40, 54)
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
  const syncCub = useCallback(
    (t: number, follow: boolean) => {
      const map = mapRef.current
      const cub = cubRef.current
      if (!map || !cub || !readyRef.current) return
      const pt = pointAt(route, t)
      cub.setLngLat([pt.lng, pt.lat])
      if (cubRotRef.current)
        cubRotRef.current.style.transform = cubTransform(pt.bearing)
      if (follow) {
        if (dragging) {
          map.jumpTo({ center: [pt.lng, pt.lat] })
        } else if (interactedRef.current) {
          map.easeTo({
            center: [pt.lng, pt.lat],
            zoom: FOLLOW_ZOOM,
            duration: 650,
            easing: (x) => 1 - (1 - x) ** 3,
          })
        }
      }
    },
    [route, dragging],
  )

  useEffect(() => {
    if (dragging) interactedRef.current = true
    syncCub(progress, true)
  }, [progress, dragging, syncCub])

  // --- repair filter: hide normal pins + fade route -------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    pinsRef.current.forEach((m, i) => {
      const hide = repairOnly && stops[i].type !== "repair"
      m.getElement().style.display = hide ? "none" : ""
    })
    if (map.getLayer("route-line")) {
      map.setPaintProperty("route-line", "line-opacity", repairOnly ? 0.25 : 1)
      map.setPaintProperty(
        "route-casing",
        "line-opacity",
        repairOnly ? 0.15 : 1,
      )
    }
  }, [repairOnly, stops])

  return <div ref={containerRef} className="bb-map-canvas" />
}
