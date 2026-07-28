import { useQuery } from "@tanstack/react-query"
import { fetchRiddenSince } from "./api"

// Kilometres ridden since the last stop, live from the tracker. Shared by
// the map's logbook card and the logbook screen so both show the same
// total. The backend caches the Traccar history query for 2 minutes, so
// polling faster buys nothing. 0 (no tracker, Traccar down, offline) just
// leaves the plain stats total.
export default function useLiveKm(): number {
  const { data: ridden } = useQuery({
    queryKey: ["ridden"],
    queryFn: fetchRiddenSince,
    refetchInterval: 120_000,
    staleTime: 60_000,
  })
  return ridden ? Math.round(ridden.km) : 0
}
