import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
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
  AuthNote,
  authFieldStyle,
  authLinkStyle,
  authPrimaryBtn,
} from "@/brommerboek/AuthScreen"
import { C } from "@/brommerboek/theme"
import { LoginService } from "@/client"
import { isLoggedIn } from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const formSchema = z.object({
  email: z.email("dat lijkt geen e-mailadres"),
})

type FormData = z.infer<typeof formSchema>

export const Route = createFileRoute("/recover-password")({
  component: RecoverPassword,
  beforeLoad: async () => {
    if (isLoggedIn()) {
      throw redirect({
        to: "/",
      })
    }
  },
  head: () => ({
    meta: [{ title: "Brommerboek — Wachtwoord vergeten" }],
  }),
})

function RecoverPassword() {
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
    },
  })
  const { errors } = form.formState
  const { showErrorToast } = useCustomToast()

  const recoverPassword = async (data: FormData) => {
    await LoginService.recoverPassword({
      email: data.email,
    })
  }

  const mutation = useMutation({
    mutationFn: recoverPassword,
    onSuccess: () => {
      form.reset()
    },
    onError: handleError.bind(showErrorToast),
  })

  const onSubmit = async (data: FormData) => {
    if (mutation.isPending) return
    mutation.mutate(data)
  }

  return (
    <AuthScreen
      kicker="BROMMERBOEK · WACHTWOORD"
      title="Wachtwoord vergeten"
      intro="vul je e-mail in, dan sturen we je een herstel-link."
    >
      <AuthCard>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <AuthField label="E-MAIL" error={errors.email?.message}>
            <input
              data-testid="email-input"
              type="email"
              autoComplete="email"
              style={authFieldStyle}
              {...form.register("email")}
            />
          </AuthField>

          <button
            type="submit"
            disabled={mutation.isPending}
            style={{
              ...authPrimaryBtn,
              opacity: mutation.isPending ? 0.6 : 1,
            }}
          >
            {mutation.isPending ? "…" : "stuur herstel-link"}
          </button>

          {mutation.isSuccess && (
            <AuthNote color={C.teal}>
              herstel-link verstuurd — check je mail.
            </AuthNote>
          )}
        </form>
      </AuthCard>

      <AuthFootnote>
        toch weer te binnen geschoten?{" "}
        <RouterLink to="/login" style={authLinkStyle}>
          log in
        </RouterLink>
      </AuthFootnote>
    </AuthScreen>
  )
}
