import { createFileRoute } from "@tanstack/react-router"
import BrommerboekApp from "@/brommerboek/BrommerboekApp"

// Public landing: the Brommerboek trip logger. No auth — this is a personal
// trip meant to be shown off.
export const Route = createFileRoute("/")({
  component: BrommerboekApp,
  head: () => ({
    meta: [{ title: "Brommerboek — De Grote Tocht" }],
  }),
})
