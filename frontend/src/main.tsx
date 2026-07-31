// Keep this first: API polyfills must run before any dependency code.
import "./lib/polyfills"
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import ReactDOM from "react-dom/client"
import { OpenAPI } from "./client"
import { ThemeProvider } from "./components/theme-provider"
import { Toaster } from "./components/ui/sonner"
import { classifyQueryError } from "./lib/queryErrorPolicy"
import { claimStaleChunkReload } from "./lib/staleChunkReload"
import {
  installGlobalErrorReporting,
  reportError,
  suppressErrorReporting,
} from "./lib/telemetry"
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
//
// preventDefault() is safe for exactly one of the two failures Vite reports
// through this event, and unsafe for the other. Vite's preload helper reads:
//
//     for (const item of settledDeps) if (rejected) handlePreloadError(...)
//     return baseModule().catch(handlePreloadError)
//
// and handlePreloadError only rethrows when the event wasn't prevented.
//   - A failed CSS *dependency*: preventing the throw lets the loop fall
//     through to baseModule(), so the route's real module still loads and
//     the page keeps working — only the stylesheet is missing.
//   - A failed baseModule(): preventing the throw resolves the import with
//     undefined, which the router then dereferences ("m.component"). That
//     was #78/#79 — so those must keep propagating.
//
// Either way we reload once to pick up the new deploy. claimStaleChunkReload
// owns the "have we already tried?" bookkeeping — including surviving a
// browser that refuses storage — and never throws, because an exception here
// would skip both the reload and the suppression below. It deliberately does
// not gate the preventDefault above, so a second CSS failure within the
// minute still degrades gracefully instead of blanking the app.
window.addEventListener("vite:preloadError", (event) => {
  const payload = (event as Event & { payload?: unknown }).payload
  const isCssDep =
    payload instanceof Error &&
    payload.message.startsWith("Unable to preload CSS for")
  if (isCssDep) event.preventDefault()

  if (!claimStaleChunkReload()) return
  suppressErrorReporting()
  window.location.reload()
})

// Errors that used to vanish silently now land in the backend's error
// telemetry (deduped client- and server-side). Which ones deserve that, and
// which are expected outcomes or the visitor's connectivity, is decided by
// classifyQueryError — see its tests for the full set of rules.
const handleApiError = (error: Error) => {
  const decision = classifyQueryError(error, window.location.origin)
  if (decision.kind === "logout") {
    localStorage.removeItem("access_token")
    window.location.href = "/login"
    return
  }
  if (decision.kind === "ignore") return
  reportError(error, decision.context)
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
