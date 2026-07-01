// Route geometry over real [lng, lat] coordinates: cumulative distances,
// point-at-fraction interpolation and travel bearing. Distances use the
// haversine formula; interpolation between two adjacent stops is linear in
// lng/lat, which is visually smooth at these scales.

export type LngLat = [number, number]

const R = 6371000 // earth radius, metres
const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(a[0] - b[0]) // magnitude only
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Initial great-circle bearing from a → b, in degrees clockwise from north.
export function bearing(a: LngLat, b: LngLat): number {
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const dLng = toRad(b[0] - a[0])
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

export interface RouteGeometry {
  points: LngLat[]
  cum: number[] // cumulative distance to each vertex
  total: number
}

export function buildRoute(points: LngLat[]): RouteGeometry {
  const cum = [0]
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1], points[i])
    cum.push(total)
  }
  return { points, cum, total }
}

export interface RoutePoint {
  lng: number
  lat: number
  bearing: number
}

// Position along the route at fraction t ∈ [0, 1] of total distance.
export function pointAt(route: RouteGeometry, t: number): RoutePoint {
  const { points, cum, total } = route
  if (points.length === 0) return { lng: 0, lat: 0, bearing: 0 }
  if (points.length === 1)
    return { lng: points[0][0], lat: points[0][1], bearing: 0 }
  const dist = Math.max(0, Math.min(1, t)) * total
  for (let i = 1; i < points.length; i++) {
    if (dist <= cum[i] || i === points.length - 1) {
      const segLen = cum[i] - cum[i - 1] || 1
      const f = (dist - cum[i - 1]) / segLen
      const a = points[i - 1]
      const b = points[i]
      return {
        lng: a[0] + (b[0] - a[0]) * f,
        lat: a[1] + (b[1] - a[1]) * f,
        bearing: bearing(a, b),
      }
    }
  }
  const last = points[points.length - 1]
  return { lng: last[0], lat: last[1], bearing: 0 }
}

// Fraction of the total route at which vertex i sits.
export function stopFraction(route: RouteGeometry, i: number): number {
  return route.total ? route.cum[i] / route.total : 0
}

// Index of the stop whose fraction is closest to t.
export function nearestStop(route: RouteGeometry, t: number): number {
  let best = 0
  let bd = Infinity
  for (let i = 0; i < route.points.length; i++) {
    const d = Math.abs(stopFraction(route, i) - t)
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return best
}

// [ [minLng,minLat], [maxLng,maxLat] ] bounding box of the route.
export function routeBounds(points: LngLat[]): [LngLat, LngLat] {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng
    if (lat < minLat) minLat = lat
    if (lng > maxLng) maxLng = lng
    if (lat > maxLat) maxLat = lat
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ]
}
