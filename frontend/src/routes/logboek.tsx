import { createFileRoute } from "@tanstack/react-router"
import LogboekScreen from "@/brommerboek/LogboekScreen"

export const Route = createFileRoute("/logboek")({
  component: LogboekScreen,
  head: () => ({
    meta: [{ title: "Brommerboek — Logboek" }],
  }),
})
