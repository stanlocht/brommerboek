import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { redirect, useNavigate } from "@tanstack/react-router"

import {
  type Body_login_login_access_token as AccessToken,
  ApiError,
  LoginService,
  type UserPublic,
  type UserRegister,
  UsersService,
} from "@/client"
import { handleError } from "@/utils"
import useCustomToast from "./useCustomToast"

const isLoggedIn = () => {
  return localStorage.getItem("access_token") !== null
}

// beforeLoad guard for the superuser-only screens (/admin, /status).
//
// Errors thrown here are NOT react-query errors, so they never reach the
// query cache's handler — an unguarded readUserMe() surfaces as a full-page
// "Motorpech" instead of a login prompt. The backend answers an expired or
// malformed token with 403 (not 401), so both statuses mean "log in again";
// on this endpoint neither can mean "not an admin", since it only requires a
// valid user.
const requireSuperuser = async () => {
  if (!isLoggedIn()) throw redirect({ to: "/login" })
  let user: UserPublic
  try {
    user = await UsersService.readUserMe()
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) {
      localStorage.removeItem("access_token")
      throw redirect({ to: "/login" })
    }
    throw error
  }
  if (!user.is_superuser) throw redirect({ to: "/" })
}

const useAuth = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()

  const { data: user } = useQuery<UserPublic | null, Error>({
    queryKey: ["currentUser"],
    queryFn: UsersService.readUserMe,
    enabled: isLoggedIn(),
  })

  const signUpMutation = useMutation({
    mutationFn: (data: UserRegister) =>
      UsersService.registerUser({ requestBody: data }),
    onSuccess: () => {
      navigate({ to: "/login" })
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] })
    },
  })

  const login = async (data: AccessToken) => {
    const response = await LoginService.loginAccessToken({
      formData: data,
    })
    localStorage.setItem("access_token", response.access_token)
  }

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: () => {
      navigate({ to: "/" })
    },
    onError: handleError.bind(showErrorToast),
  })

  const logout = () => {
    localStorage.removeItem("access_token")
    navigate({ to: "/login" })
  }

  return {
    signUpMutation,
    loginMutation,
    logout,
    user,
  }
}

export { isLoggedIn, requireSuperuser }
export default useAuth
