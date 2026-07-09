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
import useAuth, { isLoggedIn } from "@/hooks/useAuth"

const formSchema = z
  .object({
    email: z.email("dat lijkt geen e-mailadres"),
    full_name: z.string().min(1, "vul je naam in"),
    password: z
      .string()
      .min(1, "vul een wachtwoord in")
      .min(8, "minimaal 8 tekens"),
    confirm_password: z.string().min(1, "bevestig je wachtwoord"),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: "de wachtwoorden verschillen",
    path: ["confirm_password"],
  })

type FormData = z.infer<typeof formSchema>

export const Route = createFileRoute("/signup")({
  component: SignUp,
  beforeLoad: async () => {
    if (isLoggedIn()) {
      throw redirect({
        to: "/",
      })
    }
  },
  head: () => ({
    meta: [{ title: "Brommerboek — Aanmelden" }],
  }),
})

function SignUp() {
  const { signUpMutation } = useAuth()
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      email: "",
      full_name: "",
      password: "",
      confirm_password: "",
    },
  })
  const { errors } = form.formState

  const onSubmit = (data: FormData) => {
    if (signUpMutation.isPending) return

    // exclude confirm_password from submission data
    const { confirm_password: _confirm_password, ...submitData } = data
    signUpMutation.mutate(submitData)
  }

  return (
    <AuthScreen
      kicker="BROMMERBOEK · AANMELDEN"
      title="Rij je mee?"
      intro="maak een account om te toeteren en reacties achter te laten."
    >
      <AuthCard>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <AuthField label="NAAM" error={errors.full_name?.message}>
            <input
              data-testid="full-name-input"
              type="text"
              autoComplete="name"
              style={authFieldStyle}
              {...form.register("full_name")}
            />
          </AuthField>

          <AuthField label="E-MAIL" error={errors.email?.message}>
            <input
              data-testid="email-input"
              type="email"
              autoComplete="email"
              style={authFieldStyle}
              {...form.register("email")}
            />
          </AuthField>

          <AuthField label="WACHTWOORD" error={errors.password?.message}>
            <input
              data-testid="password-input"
              type="password"
              autoComplete="new-password"
              style={authFieldStyle}
              {...form.register("password")}
            />
          </AuthField>

          <AuthField
            label="BEVESTIG WACHTWOORD"
            error={errors.confirm_password?.message}
          >
            <input
              data-testid="confirm-password-input"
              type="password"
              autoComplete="new-password"
              style={authFieldStyle}
              {...form.register("confirm_password")}
            />
          </AuthField>

          <button
            type="submit"
            disabled={signUpMutation.isPending}
            style={{
              ...authPrimaryBtn,
              opacity: signUpMutation.isPending ? 0.6 : 1,
            }}
          >
            {signUpMutation.isPending ? "…" : "aanmelden"}
          </button>
        </form>
      </AuthCard>

      <AuthFootnote>
        al een account?{" "}
        <RouterLink to="/login" style={authLinkStyle}>
          log in
        </RouterLink>
      </AuthFootnote>
    </AuthScreen>
  )
}

export default SignUp
