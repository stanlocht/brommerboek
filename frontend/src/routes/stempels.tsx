import { createFileRoute } from "@tanstack/react-router"
import StampScreen from "@/brommerboek/StampScreen"

export const Route = createFileRoute("/stempels")({
  component: StampScreen,
  head: () => ({
    meta: [{ title: "Brommerboek — Stempelmuur" }],
  }),
})
