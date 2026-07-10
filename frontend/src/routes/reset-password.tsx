import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import {
  createFileRoute,
  Link as RouterLink,
  redirect,
  useNavigate,
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
import { LoginService } from "@/client"
import { isLoggedIn } from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const searchSchema = z.object({
  token: z.string().catch(""),
})

const formSchema = z
  .object({
    new_password: z
      .string()
      .min(1, "vul een wachtwoord in")
      .min(8, "minimaal 8 tekens"),
    confirm_password: z.string().min(1, "bevestig je wachtwoord"),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: "de wachtwoorden verschillen",
    path: ["confirm_password"],
  })

type FormData = z.infer<typeof formSchema>

export const Route = createFileRoute("/reset-password")({
  component: ResetPassword,
  validateSearch: searchSchema,
  beforeLoad: async ({ search }) => {
    if (isLoggedIn()) {
      throw redirect({ to: "/" })
    }
    if (!search.token) {
      throw redirect({ to: "/login" })
    }
  },
  head: () => ({
    meta: [{ title: "Brommerboek — Nieuw wachtwoord" }],
  }),
})

function ResetPassword() {
  const { token } = Route.useSearch()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const navigate = useNavigate()

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      new_password: "",
      confirm_password: "",
    },
  })
  const { errors } = form.formState

  const mutation = useMutation({
    mutationFn: (data: { new_password: string; token: string }) =>
      LoginService.resetPassword({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("wachtwoord bijgewerkt — je kunt weer inloggen")
      form.reset()
      navigate({ to: "/login" })
    },
    onError: handleError.bind(showErrorToast),
  })

  const onSubmit = (data: FormData) => {
    mutation.mutate({ new_password: data.new_password, token })
  }

  return (
    <AuthScreen
      kicker="BROMMERBOEK · WACHTWOORD"
      title="Nieuw wachtwoord"
      intro="kies een nieuw wachtwoord voor je account."
    >
      <AuthCard>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <AuthField
            label="NIEUW WACHTWOORD"
            error={errors.new_password?.message}
          >
            <input
              data-testid="new-password-input"
              type="password"
              autoComplete="new-password"
              style={authFieldStyle}
              {...form.register("new_password")}
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
            disabled={mutation.isPending}
            style={{
              ...authPrimaryBtn,
              opacity: mutation.isPending ? 0.6 : 1,
            }}
          >
            {mutation.isPending ? "…" : "wachtwoord opslaan"}
          </button>
        </form>
      </AuthCard>

      <AuthFootnote>
        weet je het toch nog?{" "}
        <RouterLink to="/login" style={authLinkStyle}>
          log in
        </RouterLink>
      </AuthFootnote>
    </AuthScreen>
  )
}
