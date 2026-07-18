import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery } from "@tanstack/react-query"
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
import { C, FONT_MONO } from "@/brommerboek/theme"
import { UsersService } from "@/client"
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
    captcha_answer: z.string().min(1, "typ het kenteken van de plaat"),
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
      captcha_answer: "",
    },
  })
  const { errors } = form.formState

  // The plate is single-use and short-lived server-side, so fetch a fresh
  // one per page visit and never behind the user's back mid-form.
  const captchaQuery = useQuery({
    queryKey: ["signup-captcha"],
    queryFn: () => UsersService.getSignupCaptcha(),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })

  const refreshCaptcha = () => {
    form.setValue("captcha_answer", "")
    captchaQuery.refetch()
  }

  const onSubmit = (data: FormData) => {
    if (signUpMutation.isPending) return

    // exclude confirm_password from submission data
    const { confirm_password: _confirm_password, ...submitData } = data
    signUpMutation.mutate(
      { ...submitData, captcha_token: captchaQuery.data?.token ?? "" },
      // Whatever went wrong (bad plate, taken email), the token is burned
      // server-side — stamp a fresh plate for the next attempt.
      { onError: refreshCaptcha },
    )
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

          <AuthField
            label="KENTEKEN-CONTROLE"
            error={errors.captcha_answer?.message}
          >
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.sepia,
                marginBottom: 6,
              }}
            >
              geen robot? typ het kenteken van deze brommerplaat.
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 8,
              }}
            >
              {captchaQuery.data ? (
                <img
                  data-testid="captcha-image"
                  src={captchaQuery.data.image}
                  alt="kentekenplaat van een brommer"
                  style={{
                    width: 168,
                    borderRadius: 8,
                    transform: "rotate(-1.2deg)",
                    boxShadow: "1px 2px 0 rgba(120,90,40,.25)",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 168,
                    height: 61,
                    borderRadius: 8,
                    border: `1.5px dashed ${C.border}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    color: C.sepia,
                  }}
                >
                  {captchaQuery.isError
                    ? "plaat kwijt — probeer opnieuw"
                    : "plaat wordt gestempeld…"}
                </div>
              )}
              <button
                type="button"
                data-testid="captcha-refresh"
                onClick={refreshCaptcha}
                style={{
                  border: `1.5px solid ${C.border}`,
                  borderRadius: 8,
                  background: C.paperLight,
                  color: C.ochreDeep,
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  letterSpacing: 1,
                  padding: "8px 10px",
                  cursor: "pointer",
                }}
              >
                ↻ ANDERE
                <br />
                PLAAT
              </button>
            </div>
            <input
              data-testid="captcha-input"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="bv. FK-38-HD"
              style={authFieldStyle}
              {...form.register("captcha_answer")}
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
