// A hand-tuned MapLibre style that renders real OpenMapTiles vector data in the
// 1970s road-atlas palette: warm paper land, faded sea, muted green terrain,
// ochre roads, dashed brown borders and sparse typewriter-ish labels. This is
// what lets the vintage identity ride on a real, pannable, zoomable map.
//
// Tiles come from OpenFreeMap (https://openfreemap.org) — free, keyless, no
// sign-up. Swap TILE_SOURCE / GLYPHS for your own provider (MapTiler,
// Protomaps, a self-host) if you prefer.

import type { StyleSpecification } from "maplibre-gl"

export const TILE_SOURCE = "https://tiles.openfreemap.org/planet"
export const GLYPHS =
  "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf"

// palette
const PAPER = "#e7d9b6"
const SEA = "#a9c6cb"
const WATERLINE = "#9fbcc0"
const WOOD = "#aebb86"
const GRASS = "#c4cc9e"
const ICE = "#eae4d6"
const SAND = "#e6d9b0"
const PARK = "#bcc79a"
const OCHRE = "#cc9a4e"
const OCHRE_CASING = "#b98f4e"
const OCHRE_LIGHT = "#d8b06a"
const OCHRE_MINOR = "#d9c08a"
const BROWN = "#9c6b3a"
const INK = "#5a4a30"
const SEA_INK = "#5f8b93"

const LABEL_FONT = ["Noto Sans Italic"]
const nameField: unknown = ["coalesce", ["get", "name:nl"], ["get", "name"]]

export function vintageStyle(): StyleSpecification {
  const src = "openmaptiles"
  const style = {
    version: 8,
    name: "Brommerboek Atlas",
    glyphs: GLYPHS,
    sources: {
      openmaptiles: { type: "vector", url: TILE_SOURCE },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": PAPER },
      },

      // ---- water & terrain -------------------------------------------------
      {
        id: "water",
        type: "fill",
        source: src,
        "source-layer": "water",
        filter: ["all", ["==", ["geometry-type"], "Polygon"]],
        paint: { "fill-color": SEA },
      },
      {
        id: "waterway",
        type: "line",
        source: src,
        "source-layer": "waterway",
        paint: {
          "line-color": WATERLINE,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 14, 2.2],
          "line-opacity": 0.8,
        },
      },
      {
        id: "wood",
        type: "fill",
        source: src,
        "source-layer": "landcover",
        filter: ["==", ["get", "class"], "wood"],
        paint: { "fill-color": WOOD, "fill-opacity": 0.42 },
      },
      {
        id: "grass",
        type: "fill",
        source: src,
        "source-layer": "landcover",
        filter: ["in", ["get", "class"], ["literal", ["grass", "farmland"]]],
        paint: { "fill-color": GRASS, "fill-opacity": 0.32 },
      },
      {
        id: "ice",
        type: "fill",
        source: src,
        "source-layer": "landcover",
        filter: ["==", ["get", "class"], "ice"],
        paint: { "fill-color": ICE, "fill-opacity": 0.8 },
      },
      {
        id: "sand",
        type: "fill",
        source: src,
        "source-layer": "landcover",
        filter: ["==", ["get", "class"], "sand"],
        paint: { "fill-color": SAND, "fill-opacity": 0.7 },
      },
      {
        id: "park",
        type: "fill",
        source: src,
        "source-layer": "park",
        paint: { "fill-color": PARK, "fill-opacity": 0.3 },
      },

      // ---- roads: casing then fill ----------------------------------------
      {
        id: "road-minor",
        type: "line",
        source: src,
        "source-layer": "transportation",
        minzoom: 11,
        filter: ["in", ["get", "class"], ["literal", ["minor", "service"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": OCHRE_MINOR,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.4, 16, 3],
        },
      },
      {
        id: "road-path",
        type: "line",
        source: src,
        "source-layer": "transportation",
        minzoom: 12,
        filter: ["in", ["get", "class"], ["literal", ["path", "track"]]],
        paint: {
          "line-color": OCHRE_CASING,
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.4, 16, 1.6],
          "line-dasharray": [2, 2],
          "line-opacity": 0.6,
        },
      },
      {
        id: "road-secondary-casing",
        type: "line",
        source: src,
        "source-layer": "transportation",
        filter: [
          "in",
          ["get", "class"],
          ["literal", ["secondary", "tertiary"]],
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": OCHRE_CASING,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 14, 5],
          "line-opacity": 0.5,
        },
      },
      {
        id: "road-secondary",
        type: "line",
        source: src,
        "source-layer": "transportation",
        filter: [
          "in",
          ["get", "class"],
          ["literal", ["secondary", "tertiary"]],
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": OCHRE_LIGHT,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.3, 14, 3],
        },
      },
      {
        id: "road-major-casing",
        type: "line",
        source: src,
        "source-layer": "transportation",
        filter: [
          "in",
          ["get", "class"],
          ["literal", ["motorway", "trunk", "primary"]],
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": OCHRE_CASING,
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0.8,
            10,
            4.5,
            16,
            22,
          ],
        },
      },
      {
        id: "road-major",
        type: "line",
        source: src,
        "source-layer": "transportation",
        filter: [
          "in",
          ["get", "class"],
          ["literal", ["motorway", "trunk", "primary"]],
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": OCHRE,
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0.4,
            10,
            2.8,
            16,
            15,
          ],
        },
      },

      // ---- boundaries ------------------------------------------------------
      {
        id: "boundary-state",
        type: "line",
        source: src,
        "source-layer": "boundary",
        filter: [
          "all",
          [">=", ["get", "admin_level"], 3],
          ["<=", ["get", "admin_level"], 4],
        ],
        paint: {
          "line-color": BROWN,
          "line-opacity": 0.25,
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 10, 1],
          "line-dasharray": [2, 3],
        },
      },
      {
        id: "boundary-country",
        type: "line",
        source: src,
        "source-layer": "boundary",
        filter: ["<=", ["get", "admin_level"], 2],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": BROWN,
          "line-opacity": 0.55,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 8, 2],
          "line-dasharray": [3, 2],
        },
      },

      // ---- labels ----------------------------------------------------------
      {
        id: "water-name",
        type: "symbol",
        source: src,
        "source-layer": "water_name",
        layout: {
          "text-field": nameField,
          "text-font": LABEL_FONT,
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 8, 16],
          "text-letter-spacing": 0.2,
          "text-max-width": 6,
          "text-transform": "uppercase",
        },
        paint: {
          "text-color": SEA_INK,
          "text-halo-color": SEA,
          "text-halo-width": 1,
          "text-opacity": 0.85,
        },
      },
      {
        id: "place-city",
        type: "symbol",
        source: src,
        "source-layer": "place",
        minzoom: 5,
        filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
        layout: {
          "text-field": nameField,
          "text-font": LABEL_FONT,
          "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10, 10, 14],
          "text-letter-spacing": 0.1,
          "text-max-width": 7,
        },
        paint: {
          "text-color": INK,
          "text-halo-color": PAPER,
          "text-halo-width": 1.6,
          "text-opacity": 0.8,
        },
      },
      {
        id: "place-country",
        type: "symbol",
        source: src,
        "source-layer": "place",
        maxzoom: 9,
        filter: ["==", ["get", "class"], "country"],
        layout: {
          "text-field": nameField,
          "text-font": LABEL_FONT,
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 12, 6, 20],
          "text-letter-spacing": 0.35,
          "text-transform": "uppercase",
          "text-max-width": 8,
        },
        paint: {
          "text-color": BROWN,
          "text-halo-color": PAPER,
          "text-halo-width": 1.6,
          "text-opacity": 0.6,
        },
      },
    ],
  }
  return style as unknown as StyleSpecification
}
