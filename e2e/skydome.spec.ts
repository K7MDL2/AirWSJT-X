import { test, expect } from "@playwright/test";

test("Sky Dome controls remain accessible and remember visibility", async ({ page }) => {
  await page.goto("/");
  const controls = page.getByRole("group", { name: "Sky Dome display controls" });
  const panel = page.getByRole("region", { name: "Sky Dome", exact: true });
  await expect(panel).toHaveCount(0);
  await expect(controls.getByRole("button", { name: "Hide", exact: true })).toHaveAttribute("aria-pressed", "true");
  await controls.getByRole("button", { name: "Show", exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(panel.locator("xpath=..")).toHaveClass(/display-panels/);
  const dome = panel.locator("svg");
  for (const [elevation, radius] of [[22.5, 144], [45, 96], [67.5, 48]]) {
    await expect(dome.getByText(`${elevation}°`, { exact: true })).toBeVisible();
    await expect(dome.locator(`circle[r="${radius}"][fill="none"]`)).toHaveCount(1);
  }
  await page.reload();
  await expect(panel).toBeVisible();
  await expect(controls.getByRole("button", { name: "Show", exact: true })).toHaveAttribute("aria-pressed", "true");
  await controls.getByRole("button", { name: "Hide", exact: true }).click();
  await page.reload();
  await expect(panel).toHaveCount(0);
  await expect(controls).toBeVisible();
  await expect(controls.getByRole("button", { name: "Hide", exact: true })).toHaveAttribute("aria-pressed", "true");
});

for (const platform of [
  { name: "Android", userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36" },
  { name: "iOS", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" },
]) {
  test.describe(`Sky Dome is unavailable on ${platform.name}`, () => {
    test.use({ userAgent: platform.userAgent, viewport: { width: 390, height: 844 } });

    test("does not render even with the desktop preference enabled", async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem("airwsjtx.showSkyDome", "true");
      });
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
      await expect(page.getByRole("group", { name: "Sky Dome display controls" })).toHaveCount(0);
      await expect(page.locator("#skydome-panel, .skydome-container")).toHaveCount(0);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByText("Sky Dome", { exact: true })).toHaveCount(0);
    });
  });
}

for (const viewport of [
  { width: 900, height: 600 },
  { width: 1100, height: 720 },
  { width: 1440, height: 900 },
]) {
  test(`Sky Dome fits ${viewport.width}x${viewport.height} with every Az/El mode`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("group", { name: "Sky Dome display controls" })
      .getByRole("button", { name: "Show", exact: true }).click();
    const azElControls = page.getByRole("group", { name: "Az / El display controls" });
    await azElControls.getByRole("slider", { name: "Scale" }).fill("180");
    for (const mode of ["Panel", "Overlay", "Hide"]) {
      await azElControls.getByRole("button", { name: mode, exact: true }).click();
      const panel = await page.locator("#skydome-panel").boundingBox();
      const dome = await page.locator(".skydome-container svg").boundingBox();
      const content = await page.locator(".content").boundingBox();
      const footer = await page.locator(".bottombar").boundingBox();
      expect(panel).not.toBeNull();
      expect(dome).not.toBeNull();
      expect(content).not.toBeNull();
      expect(footer).not.toBeNull();
      expect(panel!.width).toBeGreaterThan(400);
      expect(dome!.width).toBeCloseTo(dome!.height, 0);
      expect(dome!.x).toBeGreaterThanOrEqual(panel!.x);
      expect(dome!.x + dome!.width).toBeLessThanOrEqual(panel!.x + panel!.width);
      expect(dome!.y + dome!.height).toBeLessThanOrEqual(panel!.y + panel!.height);
      expect(content!.height).toBeGreaterThanOrEqual(160);
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(viewport.height);
      expect(await page.locator(".display-panels").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      if (mode === "Panel") {
        expect(await page.locator(".portable-panel").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      }
    }
  });
}

test("pointing uses SVG coordinates after resizing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("group", { name: "Sky Dome display controls" })
    .getByRole("button", { name: "Show", exact: true }).click();
  const dome = page.locator(".skydome-container svg");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 900, height: 600 }]) {
    await page.setViewportSize(viewport);
    const bounds = await dome.boundingBox();
    expect(bounds).not.toBeNull();
    await dome.click({ position: {
      x: bounds!.width * (0.5 + 96 / 430),
      y: bounds!.height * 0.5,
    } });
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "__mockRotatorTarget")))
      .toEqual({ azimuth: 90, elevation: 45 });
    await dome.click({ position: {
      x: bounds!.width * 0.5,
      y: bounds!.height * (0.5 + 96 / 430),
    } });
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "__mockRotatorTarget")))
      .toEqual({ azimuth: 180, elevation: 45 });
  }
});
