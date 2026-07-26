import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import ReactDOM from "react-dom/client"
import { ApiError, OpenAPI } from "./client"
import { ThemeProvider } from "./components/theme-provider"
import { Toaster } from "./components/ui/sonner"
import { installGlobalErrorReporting, reportError } from "./lib/telemetry"
import "./index.css"
// Load the vintage stylesheet globally: route-based code splitting would
// otherwise only ship it with the "/" chunk, leaving screens like /login or
// a directly-visited /settings without their .bb-app styles.
import "./brommerboek/brommerboek.css"
import { routeTree } from "./routeTree.gen"

OpenAPI.BASE = import.meta.env.VITE_API_URL
OpenAPI.TOKEN = async () => {
  return localStorage.getItem("access_token") || ""
}

installGlobalErrorReporting()

// A deploy replaces the hashed chunk files, so a client that kept an old
// index.html open fails its next lazy-route import ("'text/html' is not a
// valid JavaScript MIME type" / a 404). Reloading picks up the new index.html
// with the new hashes. The timestamp guard makes sure a genuinely broken
// asset can't reload-loop: within a minute of a reload the error is left to
// the route error boundary instead.
window.addEventListener("vite:preloadError", (event) => {
  const KEY = "bb-chunk-reload-at"
  const last = Number(sessionStorage.getItem(KEY) ?? 0)
  if (Date.now() - last < 60_000) return
  sessionStorage.setItem(KEY, String(Date.now()))
  event.preventDefault()
  window.location.reload()
})

const handleApiError = (error: Error) => {
  if (error instanceof ApiError && [401, 403].includes(error.status)) {
    localStorage.removeItem("access_token")
    window.location.href = "/login"
    return
  }
  // The request never reached the API (visitor offline, connection dropped,
  // page navigated away mid-flight). Nothing in this codebase to fix — and
  // when the API itself is truly down the report can't be delivered anyway.
  const code = (error as { code?: string }).code
  if (code === "ERR_NETWORK" || code === "ERR_CANCELED") return
  // Everything else used to vanish silently; now it lands in the backend's
  // error telemetry (deduped client- and server-side).
  // A bare "ApiError: Bad Request" is untriageable — put the endpoint in the
  // context so reports name the failing call. Path only: query strings can
  // carry tokens, and their variety would defeat server-side deduping.
  if (error instanceof ApiError) {
    let path = error.url
    try {
      path = new URL(error.url, window.location.origin).pathname
    } catch {}
    // Path params can be personal data (/password-recovery/{email}) — mask
    // them, which also keeps one endpoint one fingerprint.
    path = path
      .split("/")
      .map((seg) =>
        seg.includes("@") || seg.toLowerCase().includes("%40") ? ":email" : seg,
      )
      .join("/")
    // A wrong password on the login form is a user event the form already
    // answers with a message, not a defect — don't let it fill the tracker.
    if (
      error.status === 400 &&
      error.request.method === "POST" &&
      path.endsWith("/login/access-token")
    )
      return
    reportError(error, `query ${error.request.method} ${path}`)
    return
  }
  reportError(error, "query")
}
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: handleApiError,
  }),
  mutationCache: new MutationCache({
    onError: handleApiError,
  }),
})

const router = createRouter({ routeTree })
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster richColors closeButton />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
