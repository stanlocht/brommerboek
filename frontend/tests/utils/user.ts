import type { Page } from "@playwright/test"

// Open /signup and read the moped-plate captcha answer off the challenge
// response (the backend exposes it in local environments so the suite can
// solve the plate without OCR). The listener must be armed before the
// navigation, otherwise the response has already flown by.
export async function gotoSignupWithCaptcha(page: Page): Promise<string> {
  const challenge = page.waitForResponse(
    (r) => r.url().includes("/users/signup-captcha") && r.ok(),
  )
  await page.goto("/signup")
  const { answer } = await (await challenge).json()
  return answer
}

export async function signUpNewUser(
  page: Page,
  name: string,
  email: string,
  password: string,
) {
  const captchaAnswer = await gotoSignupWithCaptcha(page)

  await page.getByTestId("full-name-input").fill(name)
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByTestId("confirm-password-input").fill(password)
  await page.getByTestId("captcha-input").fill(captchaAnswer)
  await page.getByRole("button", { name: "aanmelden" }).click()
  await page.goto("/login")
}

export async function logInUser(page: Page, email: string, password: string) {
  await page.goto("/login")

  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByRole("button", { name: "log in" }).click()
  await page.waitForURL("/")
}

// Logging out lives on the vintage account screen (/settings) since the
// template's sidebar user menu was replaced.
export async function logOutUser(page: Page) {
  await page.goto("/settings")
  await page.getByRole("button", { name: "⎋ uitloggen" }).click()
  await page.waitForURL("/")
}
