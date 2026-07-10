import { createFileRoute, redirect } from "@tanstack/react-router"
import StatusScreen from "@/brommerboek/StatusScreen"
import { UsersService } from "@/client"

export const Route = createFileRoute("/status")({
  component: StatusScreen,
  beforeLoad: async () => {
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({
        to: "/",
      })
    }
  },
  head: () => ({
    meta: [{ title: "Brommerboek — Machinekamer" }],
  }),
})
