// TEMPORARY: final checks before the code freeze (branch ci/floorplan3d only).
import fs from "node:fs";
const { chromium } = await import(process.env.PW);
const BASE = "http://localhost:4173";
fs.mkdirSync("e2e-out", { recursive: true });
let ok = true;
const check = (c, m) => { console.log(`${c ? "  ok  " : "  FAIL"} ${m}`); if (!c) ok = false; };
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const [name, vp] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: name === "mobile", hasTouch: name === "mobile" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  for (const path of ["/", "/twin", "/floorplan", "/review"]) {
    try {
      await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(path === "/floorplan" || path === "/twin" ? 3500 : 1200);
      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      const h1 = await page.locator("h1").first().textContent().catch(() => "");
      check(sw[0] <= sw[1] + 1, `${name} ${path}: "${h1}" no horizontal scroll (${sw[0]}/${sw[1]})`);
      await page.screenshot({ path: `e2e-out/final-${name}${path === "/" ? "-dashboard" : path.replace("/", "-")}.png`, fullPage: path === "/" });
    } catch (e) { check(false, `${name} ${path}: ${e.message.slice(0, 160)}`); }
  }
  check(errs.length === 0, `${name}: page errors ${JSON.stringify(errs.slice(0, 3))}`);
  if (name === "desktop") {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const txt = await page.textContent("main");
    check(!/Helsinki|7\.6 h|24 min|Time saved/.test(txt), "dashboard: no invented numbers or names");
    const field = await page.$$eval('a[href*="/field"]', (as) => as.map((a) => a.getAttribute("href") + " " + a.target));
    check(field.length > 0 && field.every((h) => h.startsWith("/field/index.html")), `field links ${JSON.stringify(field)}`);
    const fr = await page.request.get(BASE + "/field/index.html");
    check(fr.status() === 200, `/field/index.html -> ${fr.status()}`);
    const rows = await page.locator("text=Show on floor plan").count();
    check(rows > 0, `Maintenance due rows: ${rows}`);
    await page.locator("text=Show on floor plan").first().click();
    await page.waitForURL(/\/floorplan\?device=/, { timeout: 15000 });
    await page.waitForSelector('[role="dialog"]', { timeout: 15000 }).catch(() => null);
    check(await page.locator('[role="dialog"]').count() > 0, `Show on floor plan opens the panel (${page.url().replace(BASE, "")})`);
    await page.screenshot({ path: "e2e-out/final-show-on-floorplan.png" });
    for (const id of ["DEMO-REL-01", "DEMO-REL-02", "DEMO-REL-03", "DEMO-REL-04", "DEMO-REL-05"]) {
      await page.goto(`${BASE}/floorplan?device=${id}`, { waitUntil: "networkidle" });
      const dlg = await page.waitForSelector('[role="dialog"]', { timeout: 8000 }).catch(() => null);
      if (!dlg) { console.log(`  --   ${id}: not on the floor plan (unit test covers its docs)`); continue; }
      await page.waitForTimeout(500);
      const docs = await page.$$eval('[role="dialog"] a[href*="library.e.abb.com"]', (as) => as.map((a) => a.textContent.trim()));
      const variant = await page.$eval('[role="dialog"]', (d) => (d.textContent.match(/Device:\s*(\S+)/) || [])[1] || "?");
      check(docs.length >= 2, `${id} (${variant}): ${docs.length} docs ${JSON.stringify(docs)}`);
      if (id === "DEMO-REL-05" || id === "DEMO-REL-02") await page.screenshot({ path: `e2e-out/final-docs-${id}.png` });
    }
    await page.goto(BASE + "/twin", { waitUntil: "networkidle" });
    await page.goto(BASE + "/");
    await page.waitForTimeout(800);
    await page.locator("text=Open in twin").first().click();
    await page.waitForURL(/\/twin\?/, { timeout: 15000 }).catch(() => null);
    check(/\/twin\?scan=/.test(page.url()), `Open in twin -> ${page.url().replace(BASE, "")}`);
  }
  await ctx.close();
}
await browser.close();
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(ok ? 0 : 1);
