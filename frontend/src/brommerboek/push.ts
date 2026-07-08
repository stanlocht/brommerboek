// Web Push helpers voor "volg de reis". Self-hosted: the backend signs pushes
// with its own VAPID key and posts straight to the browser vendor's relay —
// no third-party service involved.

import { fetchPushPublicKey, subscribePush, unsubscribePush } from "./api"

// applicationServerKey wants raw bytes; the backend serves it base64url.
// (The explicit ArrayBuffer type parameter keeps it assignable to
// BufferSource under TS's split ArrayBuffer/SharedArrayBuffer typings.)
export function urlBase64ToUint8Array(
  base64url: string,
): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4)
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

// iOS Safari only allows Web Push from an installed ("zet op beginscherm")
// PWA. Pure helper so the heuristic is unit-testable; `readIosEnv()` feeds it
// the real browser values.
export interface IosEnv {
  userAgent: string
  maxTouchPoints: number
  // Safari-only `navigator.standalone`; undefined elsewhere.
  standalone?: boolean
  // matchMedia("(display-mode: standalone)").matches
  displayModeStandalone: boolean
}

export function needsIosInstall(env: IosEnv): boolean {
  const iosDevice =
    /iPhone|iPad|iPod/.test(env.userAgent) ||
    // iPadOS masquerades as macOS Safari but exposes touch points.
    (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1)
  if (!iosDevice) return false
  return !(env.standalone === true || env.displayModeStandalone)
}

export function readIosEnv(): IosEnv {
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    displayModeStandalone:
      window.matchMedia?.("(display-mode: standalone)").matches ?? false,
  }
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return null
  return reg.pushManager.getSubscription()
}

export type SubscribeResult = "subscribed" | "denied" | "unsupported"

// Register the worker, ask permission, subscribe at the browser's push relay
// and hand the subscription to the backend. Safe to call repeatedly — an
// existing subscription is reused, and re-POSTing upserts (that is also how
// `wantsReactions` gets updated).
export async function subscribe(
  wantsReactions = false,
): Promise<SubscribeResult> {
  if (!isPushSupported()) return "unsupported"
  const permission = await Notification.requestPermission()
  if (permission !== "granted") return "denied"
  const reg = await navigator.serviceWorker.register("/sw.js")
  await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    const publicKey = await fetchPushPublicKey()
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Push subscription is missing keys")
  }
  await subscribePush(
    {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    },
    wantsReactions,
  )
  return "subscribed"
}

export async function unsubscribe(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  await unsubscribePush(endpoint)
}
