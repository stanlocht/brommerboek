// E2E spec for the /admin route, which renders the Dutch vintage
// AdminScreen (src/brommerboek/AdminScreen.tsx): one paper card per user
// with inline edit/delete, and an inline "+ nieuwe rijder" form.
//
// NOTE: like every spec in this directory, this requires the full stack
// (backend API + Vite frontend) to be running.

import { expect, type Page, test } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { findLastEmail } from "./utils/mailcatcher"
import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"

const userCard = (page: Page, email: string) =>
  page.getByTestId("user-card").filter({ hasText: email })

async function addUser(
  page: Page,
  email: string,
  password: string,
  fullName?: string,
) {
  await page.getByRole("button", { name: "+ nieuwe rijder" }).click()
  await page.getByTestId("user-email-input").fill(email)
  if (fullName) {
    await page.getByTestId("user-name-input").fill(fullName)
  }
  await page.getByTestId("user-password-input").fill(password)
  await page.getByTestId("user-confirm-password-input").fill(password)
  await page.getByRole("button", { name: "✓ voeg toe" }).click()
}

test("Admin page is accessible and shows correct title", async ({ page }) => {
  await page.goto("/admin")
  await expect(
    page.getByRole("heading", { name: "Rijdersregister" }),
  ).toBeVisible()
  await expect(page.getByText("beheer accounts en rechten")).toBeVisible()
})

test("Add user button is visible", async ({ page }) => {
  await page.goto("/admin")
  await expect(
    page.getByRole("button", { name: "+ nieuwe rijder" }),
  ).toBeVisible()
})

test.describe("Admin user management", () => {
  test("Create a new user successfully", async ({ page }) => {
    await page.goto("/admin")

    const email = randomEmail()
    const password = randomPassword()

    await addUser(page, email, password, "Test User Admin")

    await expect(page.getByText("rijder toegevoegd")).toBeVisible()
    await expect(userCard(page, email)).toBeVisible()
  })

  test("Create a superuser", async ({ page }) => {
    await page.goto("/admin")

    const email = randomEmail()
    const password = randomPassword()

    await page.getByRole("button", { name: "+ nieuwe rijder" }).click()
    await page.getByTestId("user-email-input").fill(email)
    await page.getByTestId("user-password-input").fill(password)
    await page.getByTestId("user-confirm-password-input").fill(password)
    await page.getByLabel("superuser").check()
    await page.getByLabel("actief").check()
    await page.getByRole("button", { name: "✓ voeg toe" }).click()

    await expect(page.getByText("rijder toegevoegd")).toBeVisible()
    await expect(userCard(page, email).getByText("superuser")).toBeVisible()
  })

  test("Edit a user successfully", async ({ page }) => {
    await page.goto("/admin")

    const email = randomEmail()
    const password = randomPassword()
    const updatedName = "Updated Name"

    await addUser(page, email, password, "Original Name")
    await expect(page.getByText("rijder toegevoegd")).toBeVisible()

    const card = userCard(page, email)
    await card.getByRole("button", { name: "✎ bewerk" }).click()
    await card.getByTestId("user-name-input").fill(updatedName)
    await card.getByRole("button", { name: "✓ opslaan" }).click()

    await expect(page.getByText("rijder bijgewerkt")).toBeVisible()
    await expect(page.getByText(updatedName)).toBeVisible()
  })

  test("Delete a user successfully", async ({ page }) => {
    await page.goto("/admin")

    const email = randomEmail()
    const password = randomPassword()

    await addUser(page, email, password)
    await expect(page.getByText("rijder toegevoegd")).toBeVisible()

    const card = userCard(page, email)
    await card.getByRole("button", { name: "✕ verwijder" }).click()
    await card.getByRole("button", { name: "✕ ja, verwijder" }).click()

    await expect(page.getByText("rijder verwijderd")).toBeVisible()
    await expect(userCard(page, email)).not.toBeVisible()
  })

  test("Cancel user creation", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "+ nieuwe rijder" }).click()
    await page.getByTestId("user-email-input").fill("test@example.com")

    await page.getByRole("button", { name: "annuleer" }).click()

    await expect(page.getByTestId("user-email-input")).not.toBeVisible()
    await expect(
      page.getByRole("button", { name: "+ nieuwe rijder" }),
    ).toBeVisible()
  })

  test("Email must be valid", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "+ nieuwe rijder" }).click()
    await page.getByTestId("user-email-input").fill("invalid-email")
    await page.getByRole("button", { name: "✓ voeg toe" }).click()

    await expect(page.getByText("dat lijkt geen e-mailadres")).toBeVisible()
  })

  test("Password must be at least 8 characters", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "+ nieuwe rijder" }).click()
    await page.getByTestId("user-email-input").fill(randomEmail())
    await page.getByTestId("user-password-input").fill("short")
    await page.getByTestId("user-confirm-password-input").fill("short")
    await page.getByRole("button", { name: "✓ voeg toe" }).click()

    await expect(page.getByText("wachtwoord: minimaal 8 tekens")).toBeVisible()
  })

  test("Passwords must match", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "+ nieuwe rijder" }).click()
    await page.getByTestId("user-email-input").fill(randomEmail())
    await page.getByTestId("user-password-input").fill(randomPassword())
    await page.getByTestId("user-confirm-password-input").fill("different12345")
    await page.getByRole("button", { name: "✓ voeg toe" }).click()

    await expect(page.getByText("de wachtwoorden verschillen")).toBeVisible()
  })
})

test.describe("Admin test email", () => {
  test("Card prefills the logged-in admin's own address", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "✉ stuur een testbericht" }).click()

    await expect(page.getByTestId("test-email-input")).toHaveValue(
      firstSuperuser,
    )
  })

  test("Address must be valid", async ({ page }) => {
    await page.goto("/admin")

    await page.getByRole("button", { name: "✉ stuur een testbericht" }).click()
    await page.getByTestId("test-email-input").fill("invalid-email")
    await page.getByRole("button", { name: "✓ verstuur" }).click()

    await expect(page.getByText("dat lijkt geen e-mailadres")).toBeVisible()
  })

  // Requires the dev stack's mailcatcher (compose.dev.yml), which the backend
  // is pointed at via SMTP_HOST — the same relay the reset-password spec reads.
  test("Sends a test email to the given address", async ({ page, request }) => {
    const email = randomEmail()

    await page.goto("/admin")

    await page.getByRole("button", { name: "✉ stuur een testbericht" }).click()
    await page.getByTestId("test-email-input").fill(email)
    await page.getByRole("button", { name: "✓ verstuur" }).click()

    await expect(
      page.getByText(`testbericht verstuurd naar ${email}`),
    ).toBeVisible()
    await expect(
      page
        .getByTestId("test-email-card")
        .getByText(`✓ verstuurd naar ${email}`),
    ).toBeVisible()

    const emailData = await findLastEmail({
      request,
      filter: (e) => e.recipients.includes(`<${email}>`),
      timeout: 5000,
    })
    expect(emailData.subject).toContain("Test email")
  })
})

test.describe("Admin page access control", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Non-superuser cannot access admin page", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()

    await createUser({ email, password })
    await logInUser(page, email, password)

    await page.goto("/admin")

    await expect(
      page.getByRole("heading", { name: "Rijdersregister" }),
    ).not.toBeVisible()
    await expect(page).not.toHaveURL(/\/admin/)
  })

  test("Superuser can access admin page", async ({ page }) => {
    await logInUser(page, firstSuperuser, firstSuperuserPassword)

    await page.goto("/admin")

    await expect(
      page.getByRole("heading", { name: "Rijdersregister" }),
    ).toBeVisible()
  })
})
