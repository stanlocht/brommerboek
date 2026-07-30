import { createFileRoute } from "@tanstack/react-router"
import AdminScreen from "@/brommerboek/AdminScreen"
import { requireSuperuser } from "@/hooks/useAuth"

export const Route = createFileRoute("/admin")({
  component: AdminScreen,
  beforeLoad: requireSuperuser,
  head: () => ({
    meta: [{ title: "Brommerboek — Rijdersregister" }],
  }),
})
