// Vintage-styled superuser dashboard: server, database and usage numbers in
// the paper/atlas idiom. Replaces the template's shadcn card/table page.

import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { CSSProperties, ReactNode } from "react"
import { type AdminStatus, readStatus } from "@/lib/status"
import { C, FONT_MONO, FONT_SERIF } from "./theme"

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) {
    return "—"
  }
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const digits = i === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${units[i]}`
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) {
    return "—"
  }
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) {
    return `${days} d ${hours} u`
  }
  if (hours > 0) {
    return `${hours} u ${minutes} min`
  }
  return `${minutes} min`
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const TILE_ROTS = ["-.5deg", ".4deg", "-.3deg", ".5deg", "-.4deg", ".3deg"]

const cardStyle: CSSProperties = {
  background: C.paperCard,
  border: `1.5px solid ${C.border}`,
  borderRadius: 12,
  padding: 14,
  boxShadow: "2px 4px 0 rgba(120,90,40,.22)",
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 10,
        letterSpacing: 3,
        color: C.ochreDeep,
        margin: "18px 0 8px 2px",
      }}
    >
      {children}
    </div>
  )
}

function StatTile({
  title,
  value,
  detail,
  rot,
}: {
  title: string
  value: string
  detail?: string
  rot: string
}) {
  return (
    <div style={{ ...cardStyle, transform: `rotate(${rot})` }}>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 2,
          color: C.ochreDeep,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: FONT_SERIF,
          fontWeight: 700,
          fontSize: 20,
          color: C.ink,
          marginTop: 4,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {detail && (
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.sepia,
            marginTop: 4,
          }}
        >
          {detail}
        </div>
      )}
    </div>
  )
}

function StatTiles({ status }: { status: AdminStatus }) {
  const { server, media, database } = status
  const memory = server.memory

  const tiles: { title: string; value: string; detail?: string }[] = [
    {
      title: "OMGEVING",
      value: status.environment,
      detail: status.release_tag ? `release ${status.release_tag}` : "—",
    },
    {
      title: "LOAD AVERAGE",
      value: server.load_avg.map((v) => v.toFixed(2)).join(" / "),
      detail: server.cpu_count != null ? `${server.cpu_count} CPU's` : "—",
    },
    {
      title: "GEHEUGEN",
      value: `${formatBytes(memory.available_bytes)} vrij`,
      detail: `van ${formatBytes(memory.total_bytes)}`,
    },
    {
      title: "SCHIJF",
      value: `${formatBytes(server.disk.free_bytes)} vrij`,
      detail: `van ${formatBytes(server.disk.total_bytes)}`,
    },
    {
      title: "UPTIME HOST",
      value: formatDuration(server.host_uptime_seconds),
      detail: `worker gestart ${formatDateTime(server.worker_started_at)}`,
    },
    {
      title: "MEDIA",
      value: `${media.file_count} bestanden`,
      detail: formatBytes(media.total_bytes),
    },
    { title: "DATABASE", value: formatBytes(database.size_bytes) },
  ]

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        gap: 12,
      }}
    >
      {tiles.map((tile, i) => (
        <StatTile
          key={tile.title}
          {...tile}
          rot={TILE_ROTS[i % TILE_ROTS.length]}
        />
      ))}
    </div>
  )
}

function DatabaseCard({ database }: { database: AdminStatus["database"] }) {
  const rows: [string, number][] = [
    ["GEBRUIKERS", database.users],
    ["STOPS", database.stops],
    ["REACTIES", database.comments],
    ["HONKS", database.honks],
    ["PUSHABONNEMENTEN", database.push_subscriptions],
  ]

  return (
    <div style={{ ...cardStyle, transform: "rotate(-.3deg)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
          gap: 12,
        }}
      >
        {rows.map(([label, count]) => (
          <div key={label}>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 1,
                color: C.sepia,
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontFamily: FONT_SERIF,
                fontWeight: 700,
                fontSize: 20,
                color: C.ink,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {count}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const thStyle: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  letterSpacing: 1,
  color: C.ochreDeep,
  textAlign: "right",
  padding: "4px 6px",
  borderBottom: `1.5px solid ${C.border}`,
  whiteSpace: "nowrap",
}

const tdStyle: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 11,
  color: C.ink,
  textAlign: "right",
  padding: "4px 6px",
  borderBottom: `1px solid ${C.borderSoft}`,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
}

function UsageCard({ usage }: { usage: AdminStatus["usage"] }) {
  const buckets = Array.from(
    new Set(usage.flatMap((day) => Object.keys(day.buckets))),
  ).sort()

  return (
    <div style={{ ...cardStyle, transform: "rotate(.2deg)" }}>
      {usage.length === 0 || buckets.length === 0 ? (
        <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.sepia }}>
          nog geen gebruiksdata — kom morgen terug.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }} className="bb-scroll">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: "left" }}>DAG</th>
                {buckets.map((bucket) => (
                  <th key={bucket} style={thStyle}>
                    {bucket}
                  </th>
                ))}
                <th style={thStyle}>TOTAAL</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((day) => {
                const total = Object.values(day.buckets).reduce(
                  (sum, count) => sum + count,
                  0,
                )
                return (
                  <tr key={day.day}>
                    <td style={{ ...tdStyle, textAlign: "left" }}>
                      {formatDay(day.day)}
                    </td>
                    {buckets.map((bucket) => (
                      <td key={bucket} style={tdStyle}>
                        {day.buckets[bucket] ?? 0}
                      </td>
                    ))}
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{total}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function StatusScreen() {
  const { data: status, isError } = useQuery({
    queryFn: () => readStatus(),
    queryKey: ["status"],
  })

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
              BROMMERBOEK · STATUS
            </div>
            <h1
              style={{
                fontFamily: FONT_SERIF,
                fontWeight: 700,
                fontSize: 30,
                lineHeight: 1,
                margin: "2px 0 0",
              }}
            >
              Machinekamer
            </h1>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.sepia,
                marginTop: 4,
                textAlign: "center",
              }}
            >
              server, database en gebruik van de laatste 30 dagen
              {" · "}
              <Link to="/admin" style={{ color: C.ochreDeep }}>
                rijdersregister
              </Link>
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "0 16px 40px",
            maxWidth: 760,
            margin: "0 auto",
          }}
        >
          {status ? (
            <>
              <SectionTitle>DE METERS</SectionTitle>
              <StatTiles status={status} />
              <SectionTitle>DATABASE</SectionTitle>
              <DatabaseCard database={status.database} />
              <SectionTitle>GEBRUIK (LAATSTE 30 DAGEN)</SectionTitle>
              <UsageCard usage={status.usage} />
            </>
          ) : (
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 12,
                color: isError ? C.red : C.sepia,
                textAlign: "center",
                marginTop: 24,
              }}
            >
              {isError
                ? "kon de status niet ophalen — probeer het straks nog eens."
                : "meterstanden worden opgenomen…"}
            </div>
          )}
        </div>
      </div>

      <div className="bb-grain" />
      <div className="bb-vignette" />
    </div>
  )
}
