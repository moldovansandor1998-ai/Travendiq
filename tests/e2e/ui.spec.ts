import { test, expect } from "@playwright/test";

/**
 * UI smoke-tesztek – élő adatbázis nélkül is futnak (placeholder env mellett
 * az oldalak graceful empty state-tel renderelődnek).
 */

test.describe("publikus felület", () => {
  test("kezdőlap betölt, hero + kereső + footer látszik", async ({ page }) => {
    const res = await page.goto("/hu");
    expect(res?.status()).toBe(200);
    await expect(page.locator("header")).toBeVisible();
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.locator("footer")).toBeVisible();
  });

  test("keresőoldal renderelődik szűrőpanellel", async ({ page }) => {
    const res = await page.goto("/hu/search");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("jogi oldal renderelődik", async ({ page }) => {
    const res = await page.goto("/en/legal/terms");
    expect(res?.status()).toBeLessThan(500);
  });

  test("bejelentkezési oldal elérhető", async ({ page }) => {
    const res = await page.goto("/hu/auth/login");
    expect(res?.status()).toBe(200);
    await expect(page.locator("input[type=email]").first()).toBeVisible();
  });
});

test.describe("jogosultság-védelem", () => {
  test("admin felület anoním látogatónak átirányít", async ({ page }) => {
    await page.goto("/hu/admin");
    await expect(page).not.toHaveURL(/\/hu\/admin$/);
  });

  test("szolgáltatói dashboard anoním látogatónak átirányít", async ({ page }) => {
    await page.goto("/hu/provider/dashboard");
    await expect(page).not.toHaveURL(/\/provider\/dashboard$/);
  });

  test("fiókoldal anoním látogatónak átirányít", async ({ page }) => {
    await page.goto("/hu/account");
    await expect(page).not.toHaveURL(/\/hu\/account$/);
  });

  test("voucher API token nélkül NEM adhat ki tartalmat (403; konfighiba esetén 503)", async ({ request }) => {
    const res = await request.get("/api/voucher/TRV-26-FAKE42");
    // 403: érvénytelen/nem létező kód; 503: hiányzó Supabase-konfiguráció
    // (placeholder környezet). 200 SOHA nem elfogadható.
    expect([400, 401, 403, 404, 503]).toContain(res.status());
    if (res.ok()) throw new Error("a voucher API token nélkül tartalmat adott ki");
  });
});

test.describe("i18n és RTL", () => {
  test("arab verzió rtl iránnyal renderelődik", async ({ page }) => {
    const res = await page.goto("/ar");
    expect(res?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  });

  test("angol verzió ltr iránnyal", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });

  test("német verzió német szöveggel", async ({ page }) => {
    await page.goto("/de");
    await expect(page.locator("body")).toContainText(/Suche|Erlebnis|buchen/i);
  });
});
