import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useMemo } from "react"
import { fetchStats, fetchStops } from "./api"
import { haversine } from "./geo"
import { CubIcon } from "./icons"
import { C, dateLabelNL, FONT_MONO, FONT_SERIF, kmLabel } from "./theme"
import { EMPTY_STATS } from "./trip"
import type { Stop } from "./types"

interface CountryTally {
  code: string
  flag: string
  country: string
  stops: number
}

interface LongestLeg {
  from: Stop
  to: Stop
  km: number
}

interface Derived {
  countryList: CountryTally[]
  longest: LongestLeg | null
  avgPerDay: number
  firstDate: string | null
  lastDate: string | null
  weathers: { label: string; count: number }[]
}

function derive(stops: Stop[], totalKm: number, days: number): Derived {
  const byCode = new Map<string, CountryTally>()
  for (const s of stops) {
    if (!s.code) continue
    const cur = byCode.get(s.code)
    if (cur) cur.stops += 1
    else
      byCode.set(s.code, {
        code: s.code,
        flag: s.flag,
        country: s.country,
        stops: 1,
      })
  }
  const countryList = Array.from(byCode.values()).sort(
    (a, b) => b.stops - a.stops,
  )

  let longest: LongestLeg | null = null
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    const km = haversine([a.lng, a.lat], [b.lng, b.lat]) / 1000
    if (!longest || km > longest.km) longest = { from: a, to: b, km }
  }

  const dates = stops.map((s) => s.date).sort()
  const firstDate = dates[0] ?? null
  const lastDate = dates[dates.length - 1] ?? null

  const weatherCounts = new Map<string, number>()
  for (const s of stops) {
    if (!s.weather) continue
    weatherCounts.set(s.weather, (weatherCounts.get(s.weather) ?? 0) + 1)
  }
  const weathers = Array.from(weatherCounts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)

  const avgPerDay = days > 0 ? Math.round(totalKm / days) : 0

  return { countryList, longest, avgPerDay, firstDate, lastDate, weathers }
}

function StatTile({
  value,
  label,
  color = C.red,
  rot = "-.5deg",
}: {
  value: string | number
  label: string
  color?: string
  rot?: string
}) {
  return (
    <div
      style={{
        background: C.paperCard,
        border: `1.5px solid ${C.border}`,
        borderRadius: 10,
        padding: "14px 12px",
        boxShadow: "1px 3px 0 rgba(120,90,40,.22)",
        transform: `rotate(${rot})`,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 32,
          lineHeight: 1,
          color,
          fontFamily: FONT_SERIF,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: C.sepia,
          marginTop: 4,
          letterSpacing: 1,
        }}
      >
        {label}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 10,
        letterSpacing: 3,
        color: C.ochreDeep,
        margin: "22px 0 10px",
      }}
    >
      {children}
    </div>
  )
}

export default function LogboekScreen() {
  const { data: stops = [] } = useQuery({
    queryKey: ["stops"],
    queryFn: fetchStops,
  })
  const { data: statsData } = useQuery({
    queryKey: ["stops", "stats"],
    queryFn: fetchStats,
  })
  const stats = statsData ?? EMPTY_STATS

  const d = useMemo(
    () => derive(stops, stats.km, stats.days),
    [stops, stats.km, stats.days],
  )

  return (
    <div className="bb-app">
      <div
        className="bb-scroll"
        style={{
          position: "absolute",
          inset: 0,
          overflowY: "auto",
          background: C.paperLight,
        }}
      >
        {/* header */}
        <div style={{ padding: "18px 18px 4px", position: "relative" }}>
          <Link
            to="/"
            aria-label="Terug naar de kaart"
            style={{
              position: "absolute",
              top: 16,
              left: 14,
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: C.paperCard,
              border: `1.5px solid ${C.border}`,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: C.ink,
              fontSize: 18,
              textDecoration: "none",
              boxShadow: "1px 2px 0 rgba(120,90,40,.25)",
            }}
          >
            ‹
          </Link>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              marginTop: 6,
            }}
          >
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 3,
                color: C.ochreDeep,
              }}
            >
              BROMMERBOEK · LOGBOEK
            </div>
            <div
              style={{
                fontFamily: FONT_SERIF,
                fontWeight: 700,
                fontSize: 30,
                lineHeight: 1,
                marginTop: 2,
              }}
            >
              Tot nu toe
            </div>
            <div style={{ marginTop: 8, opacity: 0.9 }}>
              <CubIcon width={72} height={46} />
            </div>
          </div>
        </div>

        <div style={{ padding: "10px 16px 40px" }}>
          {/* hero km */}
          <div
            style={{
              background: C.paperCard,
              border: `1.5px solid ${C.border}`,
              borderRadius: 12,
              padding: "16px 18px",
              boxShadow: "2px 4px 0 rgba(120,90,40,.25)",
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              transform: "rotate(-.4deg)",
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  letterSpacing: 2,
                  color: C.ochreDeep,
                }}
              >
                AFGELEGD
              </div>
              <div
                style={{
                  fontFamily: FONT_SERIF,
                  fontWeight: 700,
                  fontSize: 44,
                  lineHeight: 1,
                  color: C.red,
                  marginTop: 2,
                }}
              >
                {kmLabel(stats.km)}
                <span
                  style={{
                    fontSize: 16,
                    color: C.sepia,
                    marginLeft: 6,
                    fontFamily: FONT_MONO,
                  }}
                >
                  km
                </span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  letterSpacing: 2,
                  color: C.ochreDeep,
                }}
              >
                DAGEN OP PAD
              </div>
              <div
                style={{
                  fontFamily: FONT_SERIF,
                  fontWeight: 700,
                  fontSize: 32,
                  lineHeight: 1,
                  marginTop: 4,
                }}
              >
                {stats.days}
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  color: C.sepia,
                  marginTop: 4,
                }}
              >
                ø {d.avgPerDay} km/dag
              </div>
            </div>
          </div>

          <SectionTitle>DE TELLING</SectionTitle>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <StatTile value={stats.stops} label="STOPS" rot="-.6deg" />
            <StatTile
              value={stats.countries}
              label="LANDEN"
              color={C.teal}
              rot=".5deg"
            />
            <StatTile
              value={stats.repairs}
              label="REPARATIES"
              color={C.teal}
              rot=".4deg"
            />
            <StatTile
              value={stats.stamps}
              label="STEMPELS"
              color={C.ochreDeep}
              rot="-.5deg"
            />
          </div>

          {d.firstDate && d.lastDate && (
            <>
              <SectionTitle>TIJDSPANNE</SectionTitle>
              <div
                style={{
                  background: C.paperCard,
                  border: `1.5px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                  fontFamily: FONT_MONO,
                  fontSize: 12,
                  color: C.sepia,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  boxShadow: "1px 2px 0 rgba(120,90,40,.2)",
                }}
              >
                <span>{dateLabelNL(d.firstDate)}</span>
                <span style={{ color: C.ochreDeep }}>→</span>
                <span>{dateLabelNL(d.lastDate)}</span>
              </div>
            </>
          )}

          {d.longest && (
            <>
              <SectionTitle>LANGSTE ETAPPE</SectionTitle>
              <div
                style={{
                  background: C.paperCard,
                  border: `1.5px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                  boxShadow: "1px 2px 0 rgba(120,90,40,.2)",
                }}
              >
                <div
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    color: C.ochreDeep,
                    letterSpacing: 1,
                  }}
                >
                  {d.longest.from.flag} {d.longest.from.place}
                  <span style={{ margin: "0 6px", color: C.sepia }}>→</span>
                  {d.longest.to.flag} {d.longest.to.place}
                </div>
                <div
                  style={{
                    fontFamily: FONT_SERIF,
                    fontWeight: 700,
                    fontSize: 24,
                    color: C.red,
                    marginTop: 4,
                    lineHeight: 1,
                  }}
                >
                  {kmLabel(Math.round(d.longest.km))}
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 12,
                      color: C.sepia,
                      marginLeft: 4,
                    }}
                  >
                    km hemelsbreed
                  </span>
                </div>
              </div>
            </>
          )}

          {d.countryList.length > 0 && (
            <>
              <SectionTitle>LANDEN BEZOCHT</SectionTitle>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {d.countryList.map((c) => (
                  <div
                    key={c.code}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: C.paperCard,
                      border: `1.5px solid ${C.border}`,
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontFamily: FONT_MONO,
                      fontSize: 12,
                      color: C.ink,
                      boxShadow: "1px 2px 0 rgba(120,90,40,.18)",
                    }}
                  >
                    <span>
                      <span style={{ marginRight: 8 }}>{c.flag}</span>
                      {c.country}
                    </span>
                    <span style={{ color: C.ochreDeep }}>
                      {c.stops} {c.stops === 1 ? "stop" : "stops"}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {d.weathers.length > 0 && (
            <>
              <SectionTitle>WEER ONDERWEG</SectionTitle>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                }}
              >
                {d.weathers.map((w) => (
                  <div
                    key={w.label}
                    style={{
                      background: C.paperCard,
                      border: `1.5px solid ${C.border}`,
                      borderRadius: 20,
                      padding: "5px 11px",
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      color: C.sepia,
                      boxShadow: "1px 2px 0 rgba(120,90,40,.15)",
                    }}
                  >
                    {w.label}{" "}
                    <span style={{ color: C.ochreDeep }}>×{w.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="bb-grain" />
      <div className="bb-vignette" />
    </div>
  )
}
