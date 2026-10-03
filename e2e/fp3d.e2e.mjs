// TEMPORARY: 3D floor plan screenshots + interaction checks (branch ci/floorplan3d only).
import fs from "node:fs";
const { chromium } = await import(process.env.PW);
const BASE = process.env.BASE ?? "http://localhost:4173";
fs.mkdirSync("e2e-out", { recursive: true });
const lines = [];
const say = (...a) => { const s = a.join(" "); console.log(s); lines.push(s); };
let ok = true;
const check = (c, m) => { say(`${c ? "  ok  " : "  FAIL"} ${m}`); if (!c) ok = false; };
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
const badge = "button[data-device]";
try {
  await page.goto(`${BASE}/floorplan`);
  await page.waitForSelector("canvas", { timeout: 40000 });
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].some((b) => b.closest("[data-anchor]").style.visibility === "visible"), badge, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const n = await page.locator(badge).count();
  const vis = await page.$$eval(badge, (bs) => bs.filter((b) => b.closest("[data-anchor]").style.visibility === "visible").length);
  check(n > 0 && vis === n, `badges ${vis}/${n} visible`);
  const gl = await page.$eval("canvas", (c) => { const g = c.getContext("webgl2") || c.getContext("webgl"); return { w: c.width, h: c.height, gl: !!g }; });
  say("canvas", JSON.stringify(gl));
  await page.screenshot({ path: "e2e-out/3d-default.png" });

  const first = page.locator(badge).first();
  await first.hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "e2e-out/3d-hover.png" });

  // tilt + turn by dragging, then check the limits hold
  const c = await page.$eval("canvas", (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 900, c.y + 600, { steps: 25 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "e2e-out/3d-dragged-to-limit.png" });
  await page.getByRole("button", { name: "Top view" }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "e2e-out/3d-top.png" });
  await page.getByRole("button", { name: "3D view" }).click();
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "e2e-out/3d-zoomed.png" });
  await page.getByRole("button", { name: "3D view" }).click();
  await page.waitForTimeout(900);

  const p1 = page.locator(`${badge}[aria-label*="Panel 01"]`);
  check(await p1.count() === 1, "Panel 01 badge exists");
  await p1.click();
  const sheet = page.locator('[role="dialog"]').first();
  await sheet.waitFor({ timeout: 10000 });
  check((await sheet.innerText()).includes("Maintenance log"), "click opens the relay panel");
  await page.screenshot({ path: "e2e-out/3d-panel.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await page.getByRole("radio", { name: "Overdue" }).click();
  await page.waitForTimeout(500);
  const lit = await page.$$eval(badge, (bs) => bs.filter((b) => getComputedStyle(b).opacity === "1").map((b) => b.getAttribute("aria-label")));
  check(lit.length === 1 && /Panel 01/.test(lit[0]), `Overdue filter keeps only: ${lit.join(" | ")}`);
  await page.screenshot({ path: "e2e-out/3d-overdue.png" });
  await page.getByRole("radio", { name: "All" }).click();

  await page.getByRole("radio", { name: "2D" }).click();
  await page.waitForSelector('svg g[role="button"]', { timeout: 10000 });
  check(true, "2D view still available");
  await page.getByRole("radio", { name: "3D" }).click();
  await page.waitForSelector("canvas");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1200);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(sw <= 392, `mobile: no horizontal scroll (scrollWidth ${sw})`);
  await page.screenshot({ path: "e2e-out/3d-mobile.png" });
} catch (e) {
  ok = false; say("FAILED:", e.message);
  await page.screenshot({ path: "e2e-out/3d-failure.png" }).catch(() => {});
}
say("page errors:", errs.length ? errs.join(" | ") : "none");
say(ok ? "RESULT: PASS" : "RESULT: FAIL");
fs.writeFileSync("e2e-out/result3d.txt", lines.join("\n") + "\n");
await browser.close();
process.exit(ok ? 0 : 1);
