import { expect, test } from "@playwright/test";
import {
  PASSWORD,
  addCategory,
  addRow,
  lastResetLink,
  signUp,
} from "./helpers";

test("M1-E-1 sign up, add a category, two expenses and an income, see correct totals", async ({
  page,
}) => {
  const { budgetId } = await signUp(page);
  await expect(page.getByLabel("Budget")).toHaveValue(budgetId);
  await expect(page.getByLabel("Budget").locator("option:checked")).toHaveText(
    "My Budget",
  );

  await addCategory(page, budgetId, "Groceries");

  await page.goto(`/b/${budgetId}/expenses`);
  await addRow(page, 1, {
    name: "Trader Joes",
    amount: "12.50",
    category: "Groceries",
  });
  await page.getByRole("button", { name: "Add row" }).click();
  await addRow(page, 2, { name: "Bus", amount: "$7.25" });
  await page.getByRole("button", { name: "Save expenses" }).click();
  await expect(
    page.getByRole("cell", { name: "Trader Joes", exact: true }),
  ).toBeVisible();

  await page.goto(`/b/${budgetId}/incomes`);
  await addRow(page, 1, { name: "Pay", amount: "1,000.00" });
  await page.getByRole("button", { name: "Save incomes" }).click();
  await expect(
    page.getByRole("cell", { name: "Pay", exact: true }),
  ).toBeVisible();

  await page.goto(`/b/${budgetId}/dashboard`);
  await expect(page.getByTestId("stat-income")).toHaveText("$1,000.00");
  await expect(page.getByTestId("stat-expenses")).toHaveText("$19.75");
  await expect(page.getByTestId("stat-expense-count")).toHaveText("2");
  await expect(page.getByTestId("stat-net")).toHaveText("$980.25");
});

test("M1-E-2 edit an expense amount and delete another; totals update", async ({
  page,
}) => {
  const { budgetId } = await signUp(page);
  await page.goto(`/b/${budgetId}/expenses`);
  await addRow(page, 1, { name: "Keep", amount: "10.00" });
  await page.getByRole("button", { name: "Add row" }).click();
  await addRow(page, 2, { name: "Drop", amount: "5.00" });
  await page.getByRole("button", { name: "Save expenses" }).click();
  await expect(
    page.getByRole("cell", { name: "Drop", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Edit Keep" }).click();
  await page.getByLabel("Amount", { exact: true }).fill("25.00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "$25.00", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete Drop" }).click();
  await expect(
    page.getByRole("cell", { name: "Drop", exact: true }),
  ).toHaveCount(0);

  await page.goto(`/b/${budgetId}/dashboard`);
  await expect(page.getByTestId("stat-expenses")).toHaveText("$25.00");
  await expect(page.getByTestId("stat-expense-count")).toHaveText("1");
});

test("M1-E-3 import a CSV: candidates fill the form with suggested categories, then submit", async ({
  page,
}) => {
  const { budgetId } = await signUp(page);
  await addCategory(page, budgetId, "Groceries");
  await page.goto(`/b/${budgetId}/expenses`);
  await addRow(page, 1, {
    name: "Trader Joes",
    amount: "1.00",
    category: "Groceries",
  });
  await page.getByRole("button", { name: "Save expenses" }).click();
  await expect(
    page.getByRole("cell", { name: "Trader Joes", exact: true }),
  ).toBeVisible();

  const csv =
    "Description,Transaction Date,Debit,Credit\nTRADER JOES #5,11/05/2026,45.10,\nPaycheck,11/06/2026,,900.00\nCoffee,11/07/2026,3.50,\n";
  await page.getByTestId("csv-input").setInputFiles({
    name: "bank.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(page.getByLabel("Name 1")).toHaveValue("TRADER JOES #5");
  await expect(page.getByLabel("Amount 1")).toHaveValue("45.10");
  await expect(
    page.getByLabel("Category 1").locator("option:checked"),
  ).toHaveText("Groceries");
  await expect(page.getByLabel("Name 2")).toHaveValue("Coffee");
  await expect(page.getByLabel("Import issues")).toContainText("Skipped");

  await page.getByRole("button", { name: "Save expenses" }).click();
  await expect(
    page.getByRole("cell", { name: "TRADER JOES #5", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Coffee", exact: true }),
  ).toBeVisible();
});

test("M1-E-4 compare shows the right delta for two periods", async ({
  page,
}) => {
  const { budgetId } = await signUp(page);
  const post = (date: string, amountCents: number) =>
    page.request.post(`/api/v1/budgets/${budgetId}/transactions`, {
      data: { items: [{ type: "expense", name: "X", amountCents, date }] },
      // A browser adds this on same-origin requests; the API refuses cookie writes without it (M9).
      headers: { "sec-fetch-site": "same-origin" },
    });
  expect((await post("2026-01-10", 10_000)).status()).toBe(201);
  expect((await post("2026-02-10", 15_000)).status()).toBe(201);

  await page.goto(`/b/${budgetId}/compare`);
  await page.getByLabel("Period A from").fill("2026-01-01");
  await page.getByLabel("Period A to").fill("2026-01-31");
  await page.getByLabel("Period B from").fill("2026-02-01");
  await page.getByLabel("Period B to").fill("2026-02-28");
  await expect(page.getByTestId("delta-expenseCents")).toHaveText(
    "$50.00 (50.0%)",
  );
});

test("M1-E-5 create a second budget, switch to it, see it empty, switch back", async ({
  page,
}) => {
  const { budgetId } = await signUp(page);
  await page.goto(`/b/${budgetId}/expenses`);
  await addRow(page, 1, { name: "In first", amount: "3.00" });
  await page.getByRole("button", { name: "Save expenses" }).click();
  await expect(
    page.getByRole("cell", { name: "In first", exact: true }),
  ).toBeVisible();

  await page.getByLabel("Budget").selectOption("__new");
  await page.getByLabel("New budget name").fill("Holiday");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(
    url =>
      /\/b\/[0-9a-f-]+\/dashboard/.test(url.pathname) &&
      !url.pathname.includes(budgetId),
  );
  await expect(page.getByLabel("Budget").locator("option:checked")).toHaveText(
    "Holiday",
  );
  await page.goto(page.url().replace("dashboard", "expenses"));
  await expect(
    page.getByRole("cell", { name: "In first", exact: true }),
  ).toHaveCount(0);

  await page.getByLabel("Budget").selectOption({ label: "My Budget" });
  await page.waitForURL(new RegExp(`/b/${budgetId}/expenses`));
  await expect(
    page.getByRole("cell", { name: "In first", exact: true }),
  ).toBeVisible();
});

test("M1-E-6 password reset: request, follow the emailed link, set a new password, sign in", async ({
  page,
}) => {
  const { email } = await signUp(page, "reset");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/sign-in/);

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("reset link was sent");

  await expect.poll(() => lastResetLink(email)).toBeTruthy();
  await page.goto(lastResetLink(email) as string);
  await page.waitForURL(/reset-password\?token=/);
  const newPassword = "an entirely new password";
  await page.getByLabel(/^New password/).fill(newPassword);
  await page.getByRole("button", { name: "Set password" }).click();
  await page.waitForURL(/sign-in/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/b\/[0-9a-f-]+\/dashboard/);
  expect(PASSWORD).not.toBe(newPassword);
});

test("M1-E-7 signed out, app pages redirect to sign in", async ({ page }) => {
  for (const path of [
    "/app",
    "/b/00000000-0000-4000-8000-000000000000/dashboard",
    "/b/00000000-0000-4000-8000-000000000000/compare",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in/);
  }
  const res = await page.request.get("/api/v1/me");
  expect(res.status()).toBe(401);
});

test("M1-E-8 another user's budget URL shows not found", async ({
  browser,
}) => {
  const a = await browser.newPage();
  const { budgetId } = await signUp(a, "alice");
  const b = await browser.newPage();
  await signUp(b, "bob");
  const res = await b.goto(`/b/${budgetId}/dashboard`);
  expect(res?.status()).toBe(404);
  await expect(b.getByText(/not found|does not exist/i).first()).toBeVisible();
  await expect(b.getByText("My Budget")).toHaveCount(0);
});
