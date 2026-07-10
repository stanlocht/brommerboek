import { createFileRoute, redirect } from "@tanstack/react-router"
import AdminScreen from "@/brommerboek/AdminScreen"
import { UsersService } from "@/client"

export const Route = createFileRoute("/admin")({
  component: AdminScreen,
  beforeLoad: async () => {
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({
        to: "/",
      })
    }
  },
  head: () => ({
    meta: [{ title: "Brommerboek — Rijdersregister" }],
  }),
})
