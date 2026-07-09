// Hand-rolled client for the superuser-only status endpoint.
//
// The generated client (src/client) is produced from the OpenAPI schema via
// scripts/generate-client.sh; until it is regenerated we mirror the backend's
// AdminStatus model (backend/app/models.py) here and call the same request
// core so auth (OpenAPI.TOKEN) keeps working.

import { OpenAPI } from "@/client"
import type { CancelablePromise } from "@/client/core/CancelablePromise"
import { request as __request } from "@/client/core/request"

export type StatusMemory = {
  total_bytes: number | null
  available_bytes: number | null
}

export type StatusDisk = {
  total_bytes: number
  free_bytes: number
}

export type StatusServer = {
  load_avg: number[]
  cpu_count: number | null
  memory: StatusMemory
  disk: StatusDisk
  host_uptime_seconds: number | null
  worker_started_at: string
}

export type StatusMedia = {
  file_count: number
  total_bytes: number
}

export type StatusDatabase = {
  size_bytes: number
  users: number
  stops: number
  comments: number
  honks: number
  push_subscriptions: number
}

export type UsageDayPublic = {
  day: string
  buckets: Record<string, number>
}

export type AdminStatus = {
  environment: string
  release_tag: string | null
  server: StatusServer
  media: StatusMedia
  database: StatusDatabase
  // Last 30 days, newest first.
  usage: UsageDayPublic[]
}

/**
 * Read Status
 * Server/database/usage snapshot for the superuser dashboard.
 * @returns AdminStatus Successful Response
 * @throws ApiError
 */
export function readStatus(): CancelablePromise<AdminStatus> {
  return __request(OpenAPI, {
    method: "GET",
    url: "/api/v1/status/",
  })
}
