import { expect, type Page, test } from "@playwright/test"

import { randomEmail, randomPassword } from "./utils/random"
import { gotoSignupWithCaptcha } from "./utils/user"

test.use({ storageState: { cookies: [], origins: [] } })

const fillForm = async (
  page: Page,
  full_name: string,
  email: string,
  password: string,
  confirm_password: string,
) => {
  await page.getByTestId("full-name-input").fill(full_name)
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByTestId("confirm-password-input").fill(confirm_password)
}

const verifyInput = async (page: Page, testId: string) => {
  const input = page.getByTestId(testId)
  await expect(input).toBeVisible()
  await expect(input).toHaveText("")
  await expect(input).toBeEditable()
}

test("Inputs are visible, empty and editable", async ({ page }) => {
  await page.goto("/signup")

  await verifyInput(page, "full-name-input")
  await verifyInput(page, "email-input")
  await verifyInput(page, "password-input")
  await verifyInput(page, "confirm-password-input")
  await verifyInput(page, "captcha-input")
})

test("Captcha plate and refresh button are visible", async ({ page }) => {
  await page.goto("/signup")

  await expect(page.getByTestId("captcha-image")).toBeVisible()
  await expect(page.getByTestId("captcha-refresh")).toBeVisible()
})

test("Aanmelden button is visible", async ({ page }) => {
  await page.goto("/signup")

  await expect(page.getByRole("button", { name: "aanmelden" })).toBeVisible()
})

test("Log in link is visible", async ({ page }) => {
  await page.goto("/signup")

  await expect(page.getByRole("link", { name: "log in" })).toBeVisible()
})

test("Sign up with valid name, email, and password", async ({ page }) => {
  const full_name = "Test User"
  const email = randomEmail()
  const password = randomPassword()

  const captchaAnswer = await gotoSignupWithCaptcha(page)
  await fillForm(page, full_name, email, password, password)
  await page.getByTestId("captcha-input").fill(captchaAnswer)
  await page.getByRole("button", { name: "aanmelden" }).click()

  await page.waitForURL("/login")
})

test("Sign up with wrong captcha answer shows an error", async ({ page }) => {
  await gotoSignupWithCaptcha(page)
  await fillForm(page, "Test User", randomEmail(), "changethis", "changethis")
  await page.getByTestId("captcha-input").fill("XX-00-XX")
  await page.getByRole("button", { name: "aanmelden" }).click()

  await expect(
    page.getByText("dat kenteken klopt niet — probeer een nieuwe plaat"),
  ).toBeVisible()
})

test("Sign up with invalid email", async ({ page }) => {
  await page.goto("/signup")

  await fillForm(
    page,
    "Playwright Test",
    "invalid-email",
    "changethis",
    "changethis",
  )
  await page.getByRole("button", { name: "aanmelden" }).click()

  await expect(page.getByText("dat lijkt geen e-mailadres")).toBeVisible()
})

test("Sign up with existing email", async ({ page }) => {
  const fullName = "Test User"
  const email = randomEmail()
  const password = randomPassword()

  const firstAnswer = await gotoSignupWithCaptcha(page)

  await fillForm(page, fullName, email, password, password)
  await page.getByTestId("captcha-input").fill(firstAnswer)
  await page.getByRole("button", { name: "aanmelden" }).click()
  await page.waitForURL("/login")

  const secondAnswer = await gotoSignupWithCaptcha(page)

  await fillForm(page, fullName, email, password, password)
  await page.getByTestId("captcha-input").fill(secondAnswer)
  await page.getByRole("button", { name: "aanmelden" }).click()

  await page
    .getByText("The user with this email already exists in the system")
    .click()
})

test("Sign up with weak password", async ({ page }) => {
  const fullName = "Test User"
  const email = randomEmail()
  const password = "weak"

  await page.goto("/signup")

  await fillForm(page, fullName, email, password, password)
  await page.getByRole("button", { name: "aanmelden" }).click()

  await expect(page.getByText("minimaal 8 tekens")).toBeVisible()
})

test("Sign up with mismatched passwords", async ({ page }) => {
  const fullName = "Test User"
  const email = randomEmail()
  const password = randomPassword()
  const password2 = randomPassword()

  await page.goto("/signup")

  await fillForm(page, fullName, email, password, password2)
  await page.getByRole("button", { name: "aanmelden" }).click()

  await expect(page.getByText("de wachtwoorden verschillen")).toBeVisible()
})

test("Sign up with missing full name", async ({ page }) => {
  const fullName = ""
  const email = randomEmail()
  const password = randomPassword()

  await page.goto("/signup")

  await fillForm(page, fullName, email, password, password)
  await page.getByRole("button", { name: "aanmelden" }).click()

  await expect(page.getByText("vul je naam in")).toBeVisible()
})

test("Sign up with missing email", async ({ page }) => {
  const fullName = "Test User"
  const email = ""
  const password = randomPassword()

  await page.goto("/signup")

  await fillForm(page, fullName, email, password, password)
  await page.getByRole("button", { name: "aanmelden" }).click()

  await expect(page.getByText("dat lijkt geen e-mailadres")).toBeVisible()
})

test("Sign up with missing password", async ({ page }) => {
  const fullName = ""
  const email = randomEmail()
  const password = ""

  await page.goto("/signup")

  await fillForm(page, fullName, email, password, password)
  await page.getByRole("button", { name: "aanmelden" }).click()

  await expect(page.getByText("vul een wachtwoord in")).toBeVisible()
})
