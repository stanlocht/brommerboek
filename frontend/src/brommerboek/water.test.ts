import { describe, expect, it } from "vitest"
import type { LngLat } from "./geo"
import { haversine } from "./geo"
import { pointInPolygon, splitByWater, waterProbe } from "./water"

// A square of "sea" between lng 1 and lng 2 on the equator, with a small
// island (about 2 km across) in the middle of it.
const SEA: LngLat[][] = [
  [
    [1, -1],
    [2, -1],
    [2, 1],
    [1, 1],
    [1, -1],
  ],
  [
    [1.49, -0.01],
    [1.51, -0.01],
    [1.51, 0.01],
    [1.49, 0.01],
    [1.49, -0.01],
  ],
]

describe("pointInPolygon", () => {
  it("is inside the water but not on the island in it", () => {
    expect(pointInPolygon([1.2, 0], SEA)).toBe(true)
    expect(pointInPolygon([1.5, 0], SEA)).toBe(false)
    expect(pointInPolygon([0.5, 0], SEA)).toBe(false)
  })
})

describe("splitByWater", () => {
  // Ride east from lng 0, cross the sea between 1 and 2, ride on to 3.
  const leg: LngLat[] = [
    [0, 0],
    [3, 0],
  ]
  const probe = waterProbe([SEA])

  it("keeps the road on land and only the crossing at sea", () => {
    const runs = splitByWater(leg, probe)
    expect(runs.map((r) => r.water)).toEqual([false, true, false])
    // The cuts land on the coastline, not on the sample grid.
    expect(runs[0].points[runs[0].points.length - 1][0]).toBeCloseTo(1, 2)
    expect(runs[1].points[runs[1].points.length - 1][0]).toBeCloseTo(2, 2)
    // Runs are contiguous: each starts where the last one ended.
    expect(runs[1].points[0]).toEqual(runs[0].points[runs[0].points.length - 1])
    expect(runs[2].points[0]).toEqual(runs[1].points[runs[1].points.length - 1])
    expect(runs[2].points[runs[2].points.length - 1]).toEqual([3, 0])
  })

  it("measures each run from the start of the leg", () => {
    const runs = splitByWater(leg, probe)
    expect(runs[0].from).toBe(0)
    expect(runs[0].to).toBeCloseTo(haversine([0, 0], [1, 0]), -3)
    expect(runs[2].to).toBeCloseTo(haversine([0, 0], [3, 0]), -3)
  })

  it("sails straight past an island without breaking the sea line", () => {
    // The island is far too small to be a landfall; the crossing stays one
    // run rather than three.
    const runs = splitByWater(
      [
        [1.1, 0],
        [1.9, 0],
      ],
      probe,
    )
    expect(runs).toHaveLength(1)
    expect(runs[0].water).toBe(true)
  })

  it("does not turn a river crossing blue", () => {
    // A 2 km strip of water under a leg is a bridge, not a ferry.
    const river = waterProbe([
      [
        [
          [1.0, -1],
          [1.02, -1],
          [1.02, 1],
          [1.0, 1],
          [1.0, -1],
        ],
      ],
    ])
    const runs = splitByWater(leg, river)
    expect(runs).toHaveLength(1)
    expect(runs[0].water).toBe(false)
  })

  it("says the whole leg is sea when it never touches land", () => {
    const runs = splitByWater(
      [
        [1.1, 0],
        [1.4, 0],
      ],
      probe,
    )
    expect(runs.map((r) => r.water)).toEqual([true])
  })

  it("survives a degenerate leg", () => {
    expect(splitByWater([[0, 0]], probe)).toEqual([])
    expect(
      splitByWater(
        [
          [0, 0],
          [0, 0],
        ],
        probe,
      ),
    ).toEqual([])
  })
})
