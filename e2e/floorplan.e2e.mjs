// TEMPORARY: /floorplan with the real floor plan data (branch ci/floorplan-data only).
import fs from "node:fs";
const { chromium } = await import(process.env.PW);
const BASE = process.env.BASE ?? "http://localhost:4173";
fs.mkdirSync("e2e-out", { recursive: true });
const lines = [];
const say = (...a) => { const s = a.join(" "); console.log(s); lines.push(s); };
let ok = true;
const check = (c, m) => { say(`${c ? "  ok  " : "  FAIL"} ${m}`); if (!c) ok = false; };

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 160)));
const devSel = 'svg g[role="button"][aria-label$="Open details"]';
const summary = async () => (await page.locator("text=relays in this room").first().locator("xpath=..").innerText()).replace(/\s+/g, " ");

try {
  await page.goto(`${BASE}/floorplan`);
  await page.waitForSelector(devSel, { timeout: 30000 });
  await page.waitForTimeout(800);
  const s0 = await summary();
  say("summary:", s0);
  const n = await page.locator(devSel).count();
  const N = Number(s0.match(/(\d+) relays in this room/)?.[1]);
  check(n === N, `markers ${n} = relays ${N}`);
  const img = await page.$eval('img[src*="floorplan"]', (i) => ({ src: i.getAttribute("src"), w: i.naturalWidth })).catch(() => null);
  check(!!img && img.w > 0, `floor plan image loaded ${JSON.stringify(img)}`);
  await page.screenshot({ path: "e2e-out/floorplan-overview.png" });

  const labels = await page.$$eval(devSel, (gs) => gs.map((g) => g.getAttribute("aria-label")));
  say("devices:\n   " + labels.join("\n   "));
  const reg = labels.findIndex((l) => /Panel 01/.test(l));
  check(reg >= 0, "Panel 01 (registered, overdue) is on the plan");
  const g = page.locator(devSel).nth(reg);
  await g.hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "e2e-out/floorplan-tooltip.png" });
  await g.click();
  const sheet = page.locator('[role="dialog"]').first();
  await sheet.waitFor({ timeout: 10000 });
  const st = await sheet.innerText();
  check(st.includes("Maintenance log") && st.includes("Open in digital twin"), "panel shows maintenance log + Open in digital twin");
  check(await page.$eval('[role="dialog"] img[alt="Detected label crop"]', (i) => i.complete && i.naturalWidth > 0).catch(() => false), "label crop image rendered");
  await page.screenshot({ path: "e2e-out/floorplan-panel.png" });
  await sheet.getByText("Open in digital twin").click();
  await page.waitForURL(/\/twin\?.*from=floorplan/, { timeout: 10000 });
  say("twin url:", new URL(page.url()).search);
  await page.waitForSelector(".veo-pin.veo-focus", { timeout: 20000 });
  const back = page.locator('[role="dialog"]').first().getByText("Back to floor plan");
  check(await back.count() > 0, "twin panel offers Back to floor plan");
  await page.screenshot({ path: "e2e-out/floorplan-to-twin.png" });
  await back.click();
  await page.waitForURL(/\/floorplan/, { timeout: 10000 });
  check(true, "back to floor plan");

  await page.waitForSelector(devSel);
  await page.getByRole("radio", { name: /Overdue/ }).or(page.getByText("Overdue", { exact: true })).first().click();
  await page.waitForTimeout(400);
  const lit = await page.$$eval(devSel, (gs) => gs.filter((g) => g.getAttribute("opacity") !== "0.2").map((g) => g.getAttribute("aria-label")));
  check(lit.length >= 1 && lit.every((l) => /overdue/i.test(l)), `Overdue filter highlights: ${lit.join(" | ")}`);
  await page.screenshot({ path: "e2e-out/floorplan-overdue.png" });
} catch (e) {
  ok = false; say("FAILED:", e.message);
  await page.screenshot({ path: "e2e-out/floorplan-failure.png" }).catch(() => {});
}
say("page errors:", errs.length ? errs.join(" | ") : "none");
say(ok ? "RESULT: PASS" : "RESULT: FAIL");
fs.writeFileSync("e2e-out/floorplan-result.txt", lines.join("\n") + "\n");
await browser.close();
process.exit(ok ? 0 : 1);
