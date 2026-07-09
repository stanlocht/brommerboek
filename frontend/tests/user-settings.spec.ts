// E2E spec for the /settings route, which renders the Dutch vintage
// AccountScreen (src/brommerboek/AccountScreen.tsx): profile card
// ("GEGEVENS"), password card ("WACHTWOORD"), logout ("SESSIE") and account
// deletion ("GEVAARZONE").
//
// NOTE: like every spec in this directory, this requires the full stack
// (backend API + Vite frontend) to be running — it does not run in
// backend-less environments. Destructive tests (rename, password change,
// delete) only ever touch throwaway users created via the private API,
// never the seeded superuser.

import { expect, type Page, test } from "@playwright/test"
import { createUser } from "./utils/privateApi.ts"
import { randomEmail, randomPassword } from "./utils/random"

async function logIn(page: Page, email: string, password: string) {
  await page.goto("/login")
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByRole("button", { name: "log in" }).click()
  await page.waitForURL("/")
}

test("Account screen shows all cards", async ({ page }) => {
  // Runs with the default (superuser) storage state from auth.setup.ts.
  await page.goto("/settings")
  await expect(page.getByText("BROMMERBOEK · ACCOUNT")).toBeVisible()
  await expect(page.getByText("Jouw hoekje")).toBeVisible()
  for (const card of ["GEGEVENS", "WACHTWOORD", "SESSIE", "GEVAARZONE"]) {
    await expect(page.getByText(card, { exact: true })).toBeVisible()
  }
  await expect(
    page.getByRole("link", { name: "Terug naar de kaart" }),
  ).toBeVisible()
})

test.describe("Anonymous access", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Visiting /settings while logged out redirects to /login", async ({
    page,
  }) => {
    await page.goto("/settings")
    await page.waitForURL(/\/login/)
  })
})

test.describe("Edit profile", () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  let email: string
  let password: string

  test.beforeAll(async () => {
    email = randomEmail()
    password = randomPassword()
    await createUser({ email, password }) // full_name: "Test User"
  })

  test.beforeEach(async ({ page }) => {
    await logIn(page, email, password)
    await page.goto("/settings")
  })

  test("Edit name with a valid name", async ({ page }) => {
    const updatedName = "Test Rijder"

    await page.getByRole("button", { name: "✎ bewerk" }).click()
    await page.getByLabel("NAAM").fill(updatedName)
    await page.getByRole("button", { name: "✓ opslaan" }).click()

    await expect(page.getByText("gegevens bijgewerkt")).toBeVisible()
    await expect(page.getByText(updatedName, { exact: true })).toBeVisible()
    // Back in read-only mode.
    await expect(page.getByRole("button", { name: "✎ bewerk" })).toBeVisible()
  })

  test("Saving without changes just closes the editor", async ({ page }) => {
    await page.getByRole("button", { name: "✎ bewerk" }).click()
    await page.getByRole("button", { name: "✓ opslaan" }).click()
    await expect(page.getByRole("button", { name: "✎ bewerk" })).toBeVisible()
    await expect(page.getByText("gegevens bijgewerkt")).not.toBeVisible()
  })

  test("Cancel restores the original values", async ({ page }) => {
    await page.getByRole("button", { name: "✎ bewerk" }).click()
    await page.getByLabel("NAAM").fill("Weggegooid")
    await page.getByRole("button", { name: "annuleer" }).click()

    await expect(page.getByText("Weggegooid")).not.toBeVisible()
    await expect(page.getByText(email, { exact: true })).toBeVisible()
  })
})

test.describe("Edit email", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Edit email with a valid email", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()
    const updatedEmail = randomEmail()
    await createUser({ email, password })
    await logIn(page, email, password)
    await page.goto("/settings")

    await page.getByRole("button", { name: "✎ bewerk" }).click()
    await page.getByLabel("E-MAIL").fill(updatedEmail)
    await page.getByRole("button", { name: "✓ opslaan" }).click()

    await expect(page.getByText("gegevens bijgewerkt")).toBeVisible()
    await expect(page.getByText(updatedEmail, { exact: true })).toBeVisible()
  })

  test("Taken email shows the error note", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()
    const otherEmail = randomEmail()
    await createUser({ email, password })
    await createUser({ email: otherEmail, password: randomPassword() })
    await logIn(page, email, password)
    await page.goto("/settings")

    await page.getByRole("button", { name: "✎ bewerk" }).click()
    await page.getByLabel("E-MAIL").fill(otherEmail) // already registered
    await page.getByRole("button", { name: "✓ opslaan" }).click()

    await expect(page.getByText("kon gegevens niet opslaan")).toBeVisible()
  })
})

test.describe("Change password", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Update password successfully and log back in", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()
    const newPassword = randomPassword()
    await createUser({ email, password })
    await logIn(page, email, password)
    await page.goto("/settings")

    await page.getByLabel("HUIDIG WACHTWOORD").fill(password)
    await page.getByLabel("NIEUW WACHTWOORD").fill(newPassword)
    await page.getByLabel("BEVESTIG WACHTWOORD").fill(newPassword)
    await page.getByRole("button", { name: "✓ wachtwoord opslaan" }).click()

    await expect(page.getByText("wachtwoord bijgewerkt")).toBeVisible()

    // Log out through the SESSIE card and back in with the new password.
    await page.getByRole("button", { name: "⎋ uitloggen" }).click()
    await logIn(page, email, newPassword)
  })
})

test.describe("Change password validation", () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  let email: string
  let password: string

  test.beforeAll(async () => {
    email = randomEmail()
    password = randomPassword()
    await createUser({ email, password })
  })

  test.beforeEach(async ({ page }) => {
    await logIn(page, email, password)
    await page.goto("/settings")
  })

  test("New password shorter than 8 characters", async ({ page }) => {
    await page.getByLabel("HUIDIG WACHTWOORD").fill(password)
    await page.getByLabel("NIEUW WACHTWOORD").fill("kort")
    await page.getByLabel("BEVESTIG WACHTWOORD").fill("kort")
    await page.getByRole("button", { name: "✓ wachtwoord opslaan" }).click()

    await expect(page.getByText("minimaal 8 tekens")).toBeVisible()
  })

  test("New password and confirmation do not match", async ({ page }) => {
    await page.getByLabel("HUIDIG WACHTWOORD").fill(password)
    await page.getByLabel("NIEUW WACHTWOORD").fill(randomPassword())
    await page.getByLabel("BEVESTIG WACHTWOORD").fill(randomPassword())
    await page.getByRole("button", { name: "✓ wachtwoord opslaan" }).click()

    await expect(page.getByText("de wachtwoorden verschillen")).toBeVisible()
  })

  test("Same password as the current one is rejected by the API", async ({
    page,
  }) => {
    await page.getByLabel("HUIDIG WACHTWOORD").fill(password)
    await page.getByLabel("NIEUW WACHTWOORD").fill(password)
    await page.getByLabel("BEVESTIG WACHTWOORD").fill(password)
    await page.getByRole("button", { name: "✓ wachtwoord opslaan" }).click()

    await expect(page.getByText("kon wachtwoord niet opslaan")).toBeVisible()
  })
})

test.describe("Log out", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Logout clears the session and returns to the map", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()
    await createUser({ email, password })
    await logIn(page, email, password)
    await page.goto("/settings")

    await page.getByRole("button", { name: "⎋ uitloggen" }).click()
    await page.waitForURL("/")
    const token = await page.evaluate(() =>
      localStorage.getItem("access_token"),
    )
    expect(token).toBeNull()
  })
})

test.describe("Delete account", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Cancel keeps the account", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()
    await createUser({ email, password })
    await logIn(page, email, password)
    await page.goto("/settings")

    await page.getByRole("button", { name: "✕ verwijder account" }).click()
    await expect(
      page.getByText("zeker weten? dit kan niet ongedaan worden gemaakt."),
    ).toBeVisible()
    await page.getByRole("button", { name: "annuleer" }).click()
    await expect(
      page.getByRole("button", { name: "✕ verwijder account" }),
    ).toBeVisible()
  })

  test("Deleting the account logs out and invalidates the credentials", async ({
    page,
  }) => {
    // Guardrail: only ever delete a user created for this very test.
    const email = randomEmail()
    const password = randomPassword()
    await createUser({ email, password })
    await logIn(page, email, password)
    await page.goto("/settings")

    await page.getByRole("button", { name: "✕ verwijder account" }).click()
    await page.getByRole("button", { name: "✕ ja, verwijder" }).click()

    await page.waitForURL("/")
    const token = await page.evaluate(() =>
      localStorage.getItem("access_token"),
    )
    expect(token).toBeNull()

    // The deleted credentials no longer work: login stays on /login.
    await page.goto("/login")
    await page.getByTestId("email-input").fill(email)
    await page.getByTestId("password-input").fill(password)
    await page.getByRole("button", { name: "log in" }).click()
    await expect(page).toHaveURL(/\/login/)
  })
})
