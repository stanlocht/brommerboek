import { createFileRoute } from "@tanstack/react-router"
import StatusScreen from "@/brommerboek/StatusScreen"
import { requireSuperuser } from "@/hooks/useAuth"

export const Route = createFileRoute("/status")({
  component: StatusScreen,
  beforeLoad: requireSuperuser,
  head: () => ({
    meta: [{ title: "Brommerboek — Machinekamer" }],
  }),
})
