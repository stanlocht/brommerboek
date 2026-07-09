import type { Page } from "@playwright/test"

export async function signUpNewUser(
  page: Page,
  name: string,
  email: string,
  password: string,
) {
  await page.goto("/signup")

  await page.getByTestId("full-name-input").fill(name)
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByTestId("confirm-password-input").fill(password)
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
