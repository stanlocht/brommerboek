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

const handleApiError = (error: Error) => {
  if (error instanceof ApiError && [401, 403].includes(error.status)) {
    localStorage.removeItem("access_token")
    window.location.href = "/login"
    return
  }
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
