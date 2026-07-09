import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Suspense } from "react"

import { UsersService } from "@/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { type AdminStatus, readStatus } from "@/lib/status"

function getStatusQueryOptions() {
  return {
    queryFn: () => readStatus(),
    queryKey: ["status"],
  }
}

export const Route = createFileRoute("/_layout/status")({
  component: Status,
  beforeLoad: async () => {
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({
        to: "/",
      })
    }
  },
  head: () => ({
    meta: [
      {
        title: "Brommerboek — Status",
      },
    ],
  }),
})

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

interface StatCardProps {
  title: string
  value: string
  detail?: string
}

function StatCard({ title, value, detail }: StatCardProps) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        {detail && (
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        )}
      </CardContent>
    </Card>
  )
}

function StatTiles({ status }: { status: AdminStatus }) {
  const { server, media, database } = status
  const memory = server.memory

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        title="Omgeving"
        value={status.environment}
        detail={status.release_tag ? `release ${status.release_tag}` : "—"}
      />
      <StatCard
        title="Load average"
        value={server.load_avg.map((v) => v.toFixed(2)).join(" / ")}
        detail={server.cpu_count != null ? `${server.cpu_count} CPU's` : "—"}
      />
      <StatCard
        title="Geheugen"
        value={`${formatBytes(memory.available_bytes)} vrij`}
        detail={`van ${formatBytes(memory.total_bytes)}`}
      />
      <StatCard
        title="Schijf"
        value={`${formatBytes(server.disk.free_bytes)} vrij`}
        detail={`van ${formatBytes(server.disk.total_bytes)}`}
      />
      <StatCard
        title="Uptime host"
        value={formatDuration(server.host_uptime_seconds)}
        detail={`worker gestart ${formatDateTime(server.worker_started_at)}`}
      />
      <StatCard
        title="Media"
        value={`${media.file_count} bestanden`}
        detail={formatBytes(media.total_bytes)}
      />
      <StatCard title="Database" value={formatBytes(database.size_bytes)} />
    </div>
  )
}

function DatabaseCard({ database }: { database: AdminStatus["database"] }) {
  const rows: [string, number][] = [
    ["Gebruikers", database.users],
    ["Stops", database.stops],
    ["Reacties", database.comments],
    ["Honks", database.honks],
    ["Pushabonnementen", database.push_subscriptions],
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Database</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {rows.map(([label, count]) => (
            <div key={label}>
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-xl font-semibold tabular-nums">{count}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

function UsageCard({ usage }: { usage: AdminStatus["usage"] }) {
  const buckets = Array.from(
    new Set(usage.flatMap((day) => Object.keys(day.buckets))),
  ).sort()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gebruik (laatste 30 dagen)</CardTitle>
      </CardHeader>
      <CardContent>
        {usage.length === 0 || buckets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nog geen gebruiksdata — kom morgen terug.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Dag</TableHead>
                  {buckets.map((bucket) => (
                    <TableHead key={bucket} className="text-right">
                      {bucket}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Totaal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.map((day) => {
                  const total = Object.values(day.buckets).reduce(
                    (sum, count) => sum + count,
                    0,
                  )
                  return (
                    <TableRow key={day.day}>
                      <TableCell className="whitespace-nowrap">
                        {formatDay(day.day)}
                      </TableCell>
                      {buckets.map((bucket) => (
                        <TableCell
                          key={bucket}
                          className="text-right tabular-nums"
                        >
                          {day.buckets[bucket] ?? 0}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium tabular-nums">
                        {total}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatusContent() {
  const { data: status } = useSuspenseQuery(getStatusQueryOptions())

  return (
    <div className="flex flex-col gap-6">
      <StatTiles status={status} />
      <DatabaseCard database={status.database} />
      <UsageCard usage={status.usage} />
    </div>
  )
}

function PendingStatus() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 7 }).map((_, index) => (
          <Card key={index} className="gap-2 py-4">
            <CardHeader className="px-4">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent className="px-4">
              <Skeleton className="h-6 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}

function Status() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Status</h1>
        <p className="text-muted-foreground">
          Server, database en gebruik van de afgelopen 30 dagen
        </p>
      </div>
      <Suspense fallback={<PendingStatus />}>
        <StatusContent />
      </Suspense>
    </div>
  )
}
