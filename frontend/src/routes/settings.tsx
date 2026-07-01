import { createFileRoute, redirect } from "@tanstack/react-router"
import AccountScreen from "@/brommerboek/AccountScreen"
import { isLoggedIn } from "@/hooks/useAuth"

export const Route = createFileRoute("/settings")({
  component: AccountScreen,
  beforeLoad: async () => {
    if (!isLoggedIn()) {
      throw redirect({ to: "/login" })
    }
  },
  head: () => ({
    meta: [{ title: "Brommerboek — Account" }],
  }),
})
