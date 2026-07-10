import { zodResolver } from "@hookform/resolvers/zod"
import {
  createFileRoute,
  Link as RouterLink,
  redirect,
} from "@tanstack/react-router"
import { useForm } from "react-hook-form"
import { z } from "zod"

import AuthScreen, {
  AuthCard,
  AuthField,
  AuthFootnote,
  authFieldStyle,
  authLinkStyle,
  authPrimaryBtn,
} from "@/brommerboek/AuthScreen"
import { FONT_MONO } from "@/brommerboek/theme"
import type { Body_login_login_access_token as AccessToken } from "@/client"
import useAuth, { isLoggedIn } from "@/hooks/useAuth"

const formSchema = z.object({
  username: z.email("dat lijkt geen e-mailadres"),
  password: z
    .string()
    .min(1, "vul je wachtwoord in")
    .min(8, "minimaal 8 tekens"),
}) satisfies z.ZodType<AccessToken>

type FormData = z.infer<typeof formSchema>

export const Route = createFileRoute("/login")({
  component: Login,
  beforeLoad: async () => {
    if (isLoggedIn()) {
      throw redirect({
        to: "/",
      })
    }
  },
  head: () => ({
    meta: [{ title: "Brommerboek — Inloggen" }],
  }),
})

function Login() {
  const { loginMutation } = useAuth()
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      username: "",
      password: "",
    },
  })
  const { errors } = form.formState

  const onSubmit = (data: FormData) => {
    if (loginMutation.isPending) return
    loginMutation.mutate(data)
  }

  return (
    <AuthScreen kicker="BROMMERBOEK · INLOGGEN" title="Welkom terug">
      <AuthCard>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <AuthField label="E-MAIL" error={errors.username?.message}>
            <input
              data-testid="email-input"
              type="email"
              autoComplete="email"
              style={authFieldStyle}
              {...form.register("username")}
            />
          </AuthField>

          <AuthField label="WACHTWOORD" error={errors.password?.message}>
            <input
              data-testid="password-input"
              type="password"
              autoComplete="current-password"
              style={authFieldStyle}
              {...form.register("password")}
            />
          </AuthField>

          <div
            style={{
              textAlign: "right",
              marginTop: -6,
              marginBottom: 12,
              fontFamily: FONT_MONO,
              fontSize: 11,
            }}
          >
            <RouterLink to="/recover-password" style={authLinkStyle}>
              wachtwoord vergeten?
            </RouterLink>
          </div>

          <button
            type="submit"
            disabled={loginMutation.isPending}
            style={{
              ...authPrimaryBtn,
              opacity: loginMutation.isPending ? 0.6 : 1,
            }}
          >
            {loginMutation.isPending ? "…" : "log in"}
          </button>
        </form>
      </AuthCard>

      <AuthFootnote>
        nog geen account?{" "}
        <RouterLink to="/signup" style={authLinkStyle}>
          aanmelden
        </RouterLink>
      </AuthFootnote>
    </AuthScreen>
  )
}
