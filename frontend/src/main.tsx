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
// Deliberately NO event.preventDefault() here: preventing it makes Vite's
// preload helper swallow the failure and resolve the import with an
// undefined module, which the router then dereferences ("m.component") in
// the moment before the reload lands. Let the rejection propagate — the
// reload wins the race either way — and just keep the dying page from
// filing telemetry about its own teardown.
window.addEventListener("vite:preloadError", () => {
  const KEY = "bb-chunk-reload-at"
  const last = Number(sessionStorage.getItem(KEY) ?? 0)
  if (Date.now() - last < 60_000) return
  sessionStorage.setItem(KEY, String(Date.now()))
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
