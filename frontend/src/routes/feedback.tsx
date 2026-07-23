import { createFileRoute, redirect } from "@tanstack/react-router"
import FeedbackScreen from "@/brommerboek/FeedbackScreen"
import { isLoggedIn } from "@/hooks/useAuth"

export const Route = createFileRoute("/feedback")({
  component: FeedbackScreen,
  beforeLoad: async () => {
    if (!isLoggedIn()) {
      throw redirect({ to: "/login" })
    }
  },
  head: () => ({
    meta: [{ title: "Brommerboek — Storingsdienst" }],
  }),
})
