import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useMemo } from "react"
import { fetchStats, fetchStops } from "./api"
import { haversine } from "./geo"
import { CubIcon } from "./icons"
import { buildTempChart, TEMP_CHART_PAD, type TempChart } from "./tempChart"
import { C, dateLabelNL, FONT_MONO, FONT_SERIF, kmLabel } from "./theme"
import { EMPTY_STATS } from "./trip"
import type { Stop } from "./types"
import { weatherLabel } from "./weather"

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
    // Prefer the odometer delta (real road distance); fall back to the
    // straight-line haversine when either endpoint has no km value.
    const legKm =
      a.km != null && b.km != null && b.km >= a.km
        ? b.km - a.km
        : haversine([a.lng, a.lat], [b.lng, b.lat]) / 1000
    if (!longest || legKm > longest.km) longest = { from: a, to: b, km: legKm }
  }

  const dates = stops.map((s) => s.date).sort()
  const firstDate = dates[0] ?? null
  const lastDate = dates[dates.length - 1] ?? null

  const weatherCounts = new Map<string, number>()
  for (const s of stops) {
    const label = weatherLabel(s.weather_condition, s.weather_temp)
    if (!label) continue
    weatherCounts.set(label, (weatherCounts.get(label) ?? 0) + 1)
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

// Hand-drawn temperature line over the trip: x = stops in route order,
// y = °C, gaps where a stop has no temperature. Data prep lives in
// tempChart.ts; this only draws it.
function TempChartCard({ chart }: { chart: TempChart }) {
  const left = TEMP_CHART_PAD.left
  const right = chart.width - TEMP_CHART_PAD.right
  const top = TEMP_CHART_PAD.top
  const bottom = chart.height - TEMP_CHART_PAD.bottom
  // Edge labels hug their axis end so they don't clip out of the viewBox.
  const anchor = (x: number) =>
    x <= left ? "start" : x >= right ? "end" : "middle"
  return (
    <div
      style={{
        background: C.paperCard,
        border: `1.5px solid ${C.border}`,
        borderRadius: 10,
        padding: "10px 8px 4px",
        boxShadow: "1px 2px 0 rgba(120,90,40,.2)",
        transform: "rotate(.3deg)",
      }}
    >
      <svg
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        role="img"
        aria-label="Temperatuur per stop onderweg"
        style={{ width: "100%", minHeight: 120, display: "block" }}
      >
        {chart.ticks.map((t) => (
          <g key={t.label}>
            <line
              x1={left}
              x2={right}
              y1={t.y}
              y2={t.y}
              stroke={C.borderSoft}
              strokeWidth={0.8}
              strokeDasharray="2 5"
            />
            <text
              x={left - 5}
              y={t.y + 3}
              textAnchor="end"
              fontSize={9}
              fontFamily={FONT_MONO}
              fill={C.sepia}
            >
              {t.label}
            </text>
          </g>
        ))}
        <line
          x1={left}
          x2={left}
          y1={top - 6}
          y2={bottom}
          stroke={C.border}
          strokeWidth={1}
        />
        <line
          x1={left}
          x2={right}
          y1={bottom}
          y2={bottom}
          stroke={C.border}
          strokeWidth={1}
        />
        <path
          d={chart.path}
          fill="none"
          stroke={C.ochreDeep}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {chart.segments.flat().map((p) => (
          <g key={`${p.x}-${p.y}`}>
            {p.icon && (
              <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize={10}>
                {p.icon}
              </text>
            )}
            <circle
              cx={p.x}
              cy={p.y}
              r={3}
              fill={C.red}
              stroke={C.paperCard}
              strokeWidth={1.2}
            />
          </g>
        ))}
        {chart.labels.map((l) => (
          <text
            key={`${l.x}-${l.text}`}
            x={l.x}
            y={chart.height - 7}
            textAnchor={anchor(l.x)}
            fontSize={9}
            fontFamily={FONT_MONO}
            fill={C.sepia}
          >
            {l.text}
          </text>
        ))}
      </svg>
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
  const {
    data: stops = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["stops"],
    queryFn: fetchStops,
  })
  const { data: statsData, isError: statsUnavailable } = useQuery({
    queryKey: ["stops", "stats"],
    queryFn: fetchStats,
  })
  const stats = statsData ?? EMPTY_STATS

  // Preparation posts are journal-only; every recap figure counts the trip.
  const tripStops = useMemo(
    () => stops.filter((s) => s.type !== "preparation"),
    [stops],
  )
  const d = useMemo(
    () => derive(tripStops, stats.km, stats.days),
    [tripStops, stats.km, stats.days],
  )
  // Null when fewer than 2 stops carry a temperature — then the plain
  // weather list below is shown instead.
  const tempChart = useMemo(() => buildTempChart(tripStops), [tripStops])

  if (isLoading) {
    return (
      <div
        className="bb-app"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
        }}
      >
        <div className="bb-cub-bob">
          <CubIcon width={70} height={94} />
        </div>
        <div
          style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.ochreDeep }}
        >
          het logboek wordt geladen…
        </div>
      </div>
    )
  }
  if (isError) {
    return (
      <div
        className="bb-app"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            background: C.paperCard,
            border: `1.5px solid ${C.border}`,
            borderRadius: 10,
            padding: "14px 16px",
            boxShadow: "1px 3px 0 rgba(120,90,40,.22)",
            fontFamily: FONT_MONO,
            fontSize: 12,
            color: C.sepia,
            textAlign: "center",
          }}
        >
          kon het logboek niet laden — draait de backend?
        </div>
      </div>
    )
  }

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
          {statsUnavailable && (
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.sepia,
                textAlign: "center",
                marginBottom: 10,
              }}
            >
              statistieken niet beschikbaar — de cijfers kunnen onvolledig zijn
            </div>
          )}
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
            <Link
              to="/stempels"
              aria-label="Bekijk de stempelmuur"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <StatTile
                value={stats.stamps}
                label="STEMPELS"
                color={C.ochreDeep}
                rot="-.5deg"
              />
            </Link>
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
                    km
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

          {(tempChart || d.weathers.length > 0) && (
            <>
              <SectionTitle>WEER ONDERWEG</SectionTitle>
              {tempChart ? (
                <TempChartCard chart={tempChart} />
              ) : (
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
              )}
            </>
          )}
        </div>
      </div>

      <div className="bb-grain" />
      <div className="bb-vignette" />
    </div>
  )
}
