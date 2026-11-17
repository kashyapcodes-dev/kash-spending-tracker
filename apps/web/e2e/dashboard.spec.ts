import { expect, test, type Page } from "@playwright/test";
import { addCategory, addRow, signUp } from "./helpers";

async function addExpense(
  page: Page,
  budgetId: string,
  name: string,
  amount: string,
  category?: string,
) {
  await page.goto(`/b/${budgetId}/expenses`);
  await addRow(page, 1, { name, amount, ...(category ? { category } : {}) });
  await page.getByRole("button", { name: "Save expenses" }).click();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
}

const edit = (page: Page) =>
  page.getByRole("button", { name: "Edit dashboard" }).click();

test("M6-E-1 a new user sees the classic dashboard with correct numbers", async ({
  page,
}) => {
  const { budgetId } = await signUp(page, "m6e1");
  await addCategory(page, budgetId, "Groceries");
  await addExpense(page, budgetId, "Trader Joes", "12.50", "Groceries");
  await page.goto(`/b/${budgetId}/dashboard`);
  await expect(page.getByTestId("stat-expenses")).toHaveText("$12.50");
  await expect(page.getByTestId("stat-expense-count")).toHaveText("1");
  await expect(page.getByTestId("stat-income")).toHaveText("$0.00");
  await expect(page.getByTestId("stat-net")).toHaveText("-$12.50");
  await expect(
    page.getByRole("cell", { name: "Trader Joes", exact: true }),
  ).toBeVisible();
});

test("M6-E-2 add a bar widget through the form, move and resize it, it persists", async ({
  page,
}) => {
  const { budgetId } = await signUp(page, "m6e2");
  await addCategory(page, budgetId, "Groceries");
  await addExpense(page, budgetId, "Milk", "4.00", "Groceries");
  await page.goto(`/b/${budgetId}/dashboard`);
  await edit(page);
  await page.getByLabel("Add widget").selectOption({ label: "Bar chart" });
  const dialog = page.getByRole("dialog", { name: "Edit widget" });
  await dialog.getByLabel("Title").fill("Bars by category");
  await expect(dialog.getByLabel("Preview")).toContainText("Bars by category");
  await dialog.getByRole("button", { name: "Save widget" }).click();

  const widget = page.getByTestId("widget-Bars by category");
  await expect(widget).toBeVisible();
  await expect(
    widget.getByRole("img", { name: "Bars by category" }),
  ).toBeVisible();
  await widget.scrollIntoViewIfNeeded();
  const before = await widget.boundingBox();

  // Move it by dragging its title upwards, then resize with the corner handle.
  const title = await widget.getByRole("heading").boundingBox();
  if (!title || !before) throw new Error("widget not laid out");
  await page.mouse.move(title.x + 20, title.y + 5);
  await page.mouse.down();
  await page.mouse.move(title.x + 20, title.y - 250, { steps: 15 });
  await page.mouse.up();
  await widget.scrollIntoViewIfNeeded();
  const handle = widget.locator(".react-resizable-handle");
  const hb = await handle.boundingBox();
  if (!hb) throw new Error("no resize handle");
  await page.mouse.move(hb.x + 4, hb.y + 4);
  await page.mouse.down();
  await page.mouse.move(hb.x + 4, hb.y + 90, { steps: 15 });
  await page.mouse.up();
  await expect(
    page.getByRole("status").filter({ hasText: "Saving" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();

  await page.reload();
  const again = page.getByTestId("widget-Bars by category");
  await expect(again).toBeVisible();
  const after = await again.boundingBox();
  expect(after?.height).toBeGreaterThan(before.height);
  expect(after?.y).not.toBe(before.y);
});

test("M6-E-3 advanced JSON: a valid spec renders, an invalid one shows the message and saves nothing", async ({
  page,
}) => {
  const { budgetId } = await signUp(page, "m6e3");
  await page.goto(`/b/${budgetId}/dashboard`);
  await edit(page);
  const count = () => page.locator("[data-testid^='widget-']").count();
  const start = await count();

  await page.getByLabel("Add widget").selectOption({ label: "Stat" });
  const dialog = page.getByRole("dialog", { name: "Edit widget" });
  await dialog.getByRole("button", { name: "Advanced" }).click();
  const spec = {
    version: 1,
    type: "stat",
    title: "Pasted count",
    query: {
      version: 1,
      source: "transactions",
      filters: {},
      groupBy: "none",
      measure: "count",
    },
    display: { format: "number" },
  };
  await dialog.getByLabel("Widget JSON").fill(JSON.stringify(spec));
  // Validation is a server call; saving before it answers would save the unapplied draft.
  const validated = page.waitForResponse(r =>
    r.url().includes("/widgets/validate"),
  );
  await dialog.getByRole("button", { name: "Validate and apply" }).click();
  await validated;
  await dialog.getByRole("button", { name: "Save widget" }).click();
  await expect(page.getByTestId("widget-Pasted count")).toBeVisible();
  expect(await count()).toBe(start + 1);

  await page.getByLabel("Add widget").selectOption({ label: "Stat" });
  await dialog.getByRole("button", { name: "Advanced" }).click();
  await dialog.getByLabel("Widget JSON").fill(
    JSON.stringify({
      ...spec,
      title: "Bad",
      query: { ...spec.query, groupBy: "category" },
    }),
  );
  await dialog.getByRole("button", { name: "Validate and apply" }).click();
  await expect(dialog.getByRole("alert").first()).toContainText("groupBy");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(await count()).toBe(start + 1);
  await expect(page.getByTestId("widget-Bad")).toHaveCount(0);
});

test("M6-E-4 changing the date range updates the widgets", async ({ page }) => {
  const { budgetId } = await signUp(page, "m6e4");
  await addExpense(page, budgetId, "Lunch", "8.00");
  await page.goto(`/b/${budgetId}/dashboard`);
  await expect(page.getByTestId("stat-expenses")).toHaveText("$8.00");
  await page.getByLabel("Date range").selectOption("last_year");
  await expect(page.getByTestId("stat-expenses")).toHaveText("$0.00");
  await page.getByLabel("Date range").selectOption("this_month");
  await expect(page.getByTestId("stat-expenses")).toHaveText("$8.00");
});

test("M6-E-5 a second dashboard from a template, set as default, opens first", async ({
  page,
}) => {
  const { budgetId } = await signUp(page, "m6e5");
  await page.goto(`/b/${budgetId}/dashboard`);
  await edit(page);
  page.once("dialog", d => void d.accept("Trends"));
  await page.getByRole("button", { name: "New from Monthly trends" }).click();
  await expect(page.getByLabel("Dashboard", { exact: true })).toContainText(
    "Trends",
  );
  await page.getByRole("button", { name: "Make default" }).click();
  await page.reload();
  await expect(
    page.getByLabel("Dashboard", { exact: true }).locator("option:checked"),
  ).toHaveText("Trends (default)");
});

test("M6-E-6 a monthly target shows in budget vs actual", async ({ page }) => {
  const { budgetId } = await signUp(page, "m6e6");
  await addCategory(page, budgetId, "Dining");
  await addExpense(page, budgetId, "Pizza", "30.00", "Dining");
  await page.goto(`/b/${budgetId}/categories`);
  await page.getByLabel("Dining monthly target").fill("100");
  await page.getByRole("button", { name: "Save Dining target" }).click();
  await expect(page.getByLabel("Dining monthly target")).toHaveValue("100.00");

  await page.goto(`/b/${budgetId}/dashboard`);
  await edit(page);
  page.once("dialog", d => void d.accept("Budget"));
  await page.getByRole("button", { name: "New from Budget check" }).click();
  const table = page.getByRole("table", { name: "Budget vs actual" });
  const row = table.getByRole("row", { name: /Dining/ });
  await expect(row).toContainText("$100.00");
  await expect(row).toContainText("$30.00");
  await expect(row).toContainText("$70.00");
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 800 } });
  test("M6-E-7 widgets stack in one column with no horizontal scroll", async ({
    page,
  }) => {
    const { budgetId } = await signUp(page, "m6e7");
    await page.goto(`/b/${budgetId}/dashboard`);
    await expect(page.getByTestId("widget-Income")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit dashboard" }),
    ).toHaveCount(0);
    const xs = await page
      .locator("[data-testid^='widget-']")
      .evaluateAll(els =>
        els.map(e => Math.round(e.getBoundingClientRect().x)),
      );
    expect(new Set(xs).size).toBe(1);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
