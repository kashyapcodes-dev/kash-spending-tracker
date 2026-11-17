import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";
import { signUp, PASSWORD } from "./helpers";
import { E2E_DB_URL, MAIL_FILE, PORT, VERIFY_PORT } from "./env";

const BASE = `http://localhost:${PORT}`;

/** Submit the sign-in form and wait for the server's answer, so attempts never overlap. */
async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  const answer = page.waitForResponse(r =>
    r.url().includes("/api/auth/sign-in/email"),
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  return answer;
}

test("M9-E-1 sign-in lockout shows a wait time and unlocks", async ({
  page,
}) => {
  const { email } = await signUp(page, "lock");
  await page.context().clearCookies();
  for (let i = 0; i < 5; i++) {
    expect(
      (await signIn(page, email, "definitely wrong password")).status(),
    ).toBe(401);
  }
  // Even the right password is refused, with the wait time.
  await signIn(page, email);
  await expect(
    page.getByText(/Too many attempts\. Try again in \d+ minutes?/),
  ).toBeVisible();
  // The server clock cannot be driven from the browser, so expire the lock in the database.
  const db = new Client({ connectionString: E2E_DB_URL });
  await db.connect();
  await db.query(
    "update auth_throttle set locked_until = now() - interval '1 second'",
  );
  await db.end();
  await signIn(page, email);
  await page.waitForURL(/\/b\/[0-9a-f-]+\/dashboard/);
});

test("M9-E-2 verification required: gate, then the emailed link, then the app", async ({
  page,
}) => {
  const base = `http://localhost:${VERIFY_PORT}`;
  const email = `verify-${Date.now()}@example.test`;
  await page.goto(`${base}/sign-up`);
  await page.getByLabel("Name").fill("Verify");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(
    page.getByRole("heading", { name: "Verify your email" }),
  ).toBeVisible();
  await page.goto(`${base}/app`);
  await expect(
    page.getByRole("heading", { name: "Verify your email" }),
  ).toBeVisible();
  await expect.poll(() => verifyLink(email)).toBeTruthy();
  await page.goto(verifyLink(email)!);
  await page.goto(`${base}/app`);
  await page.waitForURL(/\/b\/[0-9a-f-]+\/dashboard/);
});

function verifyLink(email: string): string | undefined {
  const rows = readFileSync(MAIL_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(l => JSON.parse(l) as { to: string; kind: string; url: string })
    .filter(m => m.to === email && m.kind === "verify");
  return rows.at(-1)?.url;
}

async function secondContext(browser: Browser, email: string) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await signIn(page, email);
  await page.waitForURL(/\/b\/[0-9a-f-]+\/dashboard/);
  return { ctx, page };
}

test("M9-E-3 changing the password signs the other browser out", async ({
  page,
  browser,
}) => {
  const { email, budgetId } = await signUp(page, "pw");
  const other = await secondContext(browser, email);
  const res = await page.request.post("/api/auth/change-password", {
    headers: { origin: BASE },
    data: { currentPassword: PASSWORD, newPassword: "a different password 99" },
  });
  expect(res.ok()).toBe(true);
  await other.page.goto(`/b/${budgetId}/dashboard`);
  await expect(other.page).toHaveURL(/\/sign-in/);
  await other.ctx.close();
  // The browser that changed it stays signed in on its fresh session.
  await page.goto(`/b/${budgetId}/dashboard`);
  await expect(page).toHaveURL(/\/dashboard/);
});

test("M9-E-4 the app cannot be framed by another origin", async ({ page }) => {
  await page.route("http://embedder.test/**", route =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><iframe id="f" src="${BASE}/sign-in" width="600" height="400"></iframe>`,
    }),
  );
  await page.goto("http://embedder.test/");
  await page.waitForTimeout(1500);
  // The browser refuses the frame: it ends on its error page and none of the app renders.
  const urls = page.frames().map(f => f.url());
  expect(urls.some(u => u.startsWith(BASE))).toBe(false);
  expect(urls).toContain("chrome-error://chromewebdata/");
  // The refusal comes from both headers. (Chrome does not surface the CSP violation to the
  // embedding page's console under automation, so the headers are asserted directly.)
  const res = await page.request.get(`${BASE}/sign-in`);
  expect(res.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(res.headers()["x-frame-options"]).toBe("DENY");
});

test("M9-E-5 settings: token expiry is listed, sign out everywhere ends the other browser", async ({
  page,
  browser,
}) => {
  const { email, budgetId } = await signUp(page, "sec");
  const other = await secondContext(browser, email);
  await page.goto(`/b/${budgetId}/settings`);
  await page.getByLabel("Token name").fill("ci");
  await page.getByRole("button", { name: "Create token" }).click();
  await expect(page.getByTestId("new-token")).toBeVisible();
  const row = page.getByTestId("token-row").filter({ hasText: "ci" });
  await expect(row).toContainText(/expires \d/);
  // "Never" asks for a second, deliberate click.
  await page.getByLabel("Token name").fill("forever");
  await page.getByLabel("Token expiry").selectOption("never");
  await page.getByRole("button", { name: "Create token" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /never expires/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: /never expires/ }).click();
  await expect(
    page.getByTestId("token-row").filter({ hasText: "forever" }),
  ).toContainText("never expires");

  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await other.page.goto(`/b/${budgetId}/dashboard`);
  await expect(other.page).toHaveURL(/\/sign-in/);
  await other.ctx.close();
});
