// TEMPORARY e2e: Review Queue -> Digital Twin deep link (branch ci/build-check only).
import fs from "node:fs";

const { chromium } = await import(process.env.PW ?? "playwright");
const BASE = process.env.BASE ?? "http://localhost:4173";
const OUT = "e2e-out";
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const say = (...a) => {
  const s = a.join(" ");
  console.log(s);
  lines.push(s);
};

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));

let ok = true;
const check = (cond, msg) => {
  say(`${cond ? "  ok  " : "  FAIL"} ${msg}`);
  if (!cond) ok = false;
};

async function openReview() {
  await page.goto(`${BASE}/review`);
  await page.waitForSelector("table tbody tr td a[href*='/twin']", { timeout: 30000 });
}

try {
  await openReview();
  const rows = await page.$$eval("table tbody tr", (trs) =>
    trs.map((tr) => {
      const a = tr.querySelector("a[href*='/twin']");
      const tds = tr.querySelectorAll("td");
      return { href: a?.getAttribute("href") ?? null, position: tds[3]?.textContent?.trim() ?? "", conf: tds[4]?.textContent?.trim() ?? "", ocr: tds[0]?.textContent?.trim() ?? "" };
    }),
  );
  say(`Review Queue rows: ${rows.length}, with twin link: ${rows.filter((r) => r.href).length}`);
  const linkStyle = await page.$eval("table tbody tr td a[href*='/twin']", (a) => ({ color: getComputedStyle(a).color, icon: !!a.querySelector("svg") }));
  check(linkStyle.icon, `position link has an icon, colour ${linkStyle.color}`);

  // three rows from different scan points
  const picked = [];
  for (const r of rows) {
    if (!r.href) continue;
    const scan = new URL(r.href, BASE).searchParams.get("scan");
    if (!picked.some((p) => p.scan === scan)) picked.push({ ...r, scan });
    if (picked.length === 3) break;
  }
  check(picked.length === 3, `picked rows from scan points ${picked.map((p) => p.scan).join(", ")}`);

  for (const [i, r] of picked.entries()) {
    await openReview();
    const det = new URL(r.href, BASE).searchParams.get("detection");
    say(`Row ${i + 1}: ${r.position} · ${r.conf} · OCR "${r.ocr}" -> ${r.href}`);
    await page.click(`a[href="${r.href}"]`);
    await page.waitForURL(/\/twin\?/, { timeout: 10000 });
    const url = new URL(page.url());
    check(url.searchParams.get("scan") === r.scan && url.searchParams.get("detection") === det, `URL ${url.pathname}${url.search}`);
    const sheet = page.locator('[role="dialog"]').first();
    await sheet.waitFor({ timeout: 15000 });
    const sheetText = await sheet.innerText();
    check(sheetText.includes(r.conf), `side panel opened automatically and shows ${r.conf}`);
    check(sheetText.includes("Back to review queue"), "side panel has 'Back to review queue'");
    const selectText = await page.$eval('[role="combobox"]', (el) => el.textContent ?? ""); // the open panel aria-hides the page
    check(selectText.includes(`Scan point ${r.scan.replace("scan-", "")}`), `scan point selected: "${selectText.trim()}"`);
    await page.waitForSelector(".veo-pin.veo-focus", { timeout: 15000 });
    const geo = await page.evaluate(() => {
      const pin = document.querySelector(".veo-pin.veo-focus");
      const pano = document.querySelector(".pnlm-container") ?? pin?.closest(".pnlm-render-container")?.parentElement;
      const a = pin.getBoundingClientRect();
      const b = pano.getBoundingClientRect();
      return { dx: Math.round(a.x + a.width / 2 - (b.x + b.width / 2)), dy: Math.round(a.y + a.height / 2 - (b.y + b.height / 2)), w: Math.round(b.width), h: Math.round(b.height), size: Math.round(a.width) };
    });
    check(Math.abs(geo.dx) < geo.w * 0.12 && Math.abs(geo.dy) < geo.h * 0.12, `view turned to the tag: offset from centre ${geo.dx}px, ${geo.dy}px; highlighted pin ${geo.size}px`);
    await page.screenshot({ path: `${OUT}/review-to-twin-${i + 1}.png` });
    await page.waitForTimeout(3300);
    check((await page.locator(".veo-pin.veo-focus").count()) === 0, "highlight removed after ~3 s");

    if (i === 0) {
      await page.goBack();
      await page.waitForURL(/\/review$/, { timeout: 10000 });
      check(true, "browser back returns to the Review Queue");
    } else {
      await sheet.getByText("Back to review queue").click();
      await page.waitForURL(/\/review$/, { timeout: 10000 });
      check(true, "'Back to review queue' returns to the Review Queue");
    }
  }

  // reject a wrong hit after checking it in the twin
  await openReview();
  const before = await page.locator("table tbody tr").count();
  const first = await page.$eval("table tbody tr td a[href*='/twin']", (a) => a.getAttribute("href"));
  await page.click(`a[href="${first}"]`);
  await page.locator('[role="dialog"]').first().waitFor({ timeout: 15000 });
  await page.locator('[role="dialog"]').first().getByText("Back to review queue").click();
  await page.waitForURL(/\/review$/);
  const row = page.locator(`tr:has(a[href="${first}"])`);
  await row.getByRole("button", { name: /Reject/ }).click();
  await page.waitForTimeout(300);
  const after = await page.locator("table tbody tr").count();
  check(after === before - 1, `reject after viewing in twin: rows ${before} -> ${after}`);

  // a row without scan point would render plain text: none in current data, checked in code
} catch (e) {
  ok = false;
  say(`FAILED: ${e.message}`);
  await page.screenshot({ path: `${OUT}/review-failure.png` }).catch(() => {});
}
say(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
say(ok ? "RESULT: PASS" : "RESULT: FAIL");
fs.writeFileSync(`${OUT}/review-result.txt`, lines.join("\n") + "\n");
await browser.close();
process.exit(ok ? 0 : 1);
