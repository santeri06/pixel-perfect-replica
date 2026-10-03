// TEMPORARY demo e2e against the production build (vite preview). Branch ci/build-check only.
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

const reg = JSON.parse(fs.readFileSync("src/data/registry.generated.json", "utf8"));
const dets = JSON.parse(fs.readFileSync("src/data/detections.json", "utf8"));
/** Scan points where the device has an auto-tagged detection among its anchors. */
function scansFor(id) {
  const inst = reg.instances.find((i) => i.id === id);
  const set = new Set();
  for (const d of dets) {
    if (d.confidence < 0.75) continue;
    if (inst.anchors.some((a) => a.scanPointId === d.scanPointId && Math.abs(a.yaw - d.yaw) < 0.02 && Math.abs(a.pitch - d.pitch) < 0.02)) set.add(d.scanPointId);
  }
  return [...set].sort();
}

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors = [];
const watch = (p, n) => {
  p.on("pageerror", (e) => errors.push(`${n}: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`${n} console: ${m.text().slice(0, 200)}`));
};
const app = await ctx.newPage();
watch(app, "autotag");

async function dashboard() {
  await app.goto(`${BASE}/`);
  await app.waitForSelector("text=Overdue maintenance", { timeout: 30000 });
  await app.waitForFunction(() => {
    const l = [...document.querySelectorAll("div")].find((d) => d.textContent === "Overdue maintenance");
    return l && l.previousElementSibling && l.previousElementSibling.textContent !== "–";
  }, null, { timeout: 15000 });
  return app.evaluate(() => {
    const val = (label) => [...document.querySelectorAll("div")].find((d) => d.textContent === label)?.previousElementSibling?.textContent;
    return { overdue: val("Overdue maintenance"), open: val("Open notices") };
  });
}

async function selectScan(scanId) {
  const n = scanId.replace("scan-", "");
  await app.getByRole("combobox").first().click();
  await app.getByRole("option", { name: new RegExp(`^Scan point ${n} `) }).click();
  await app.waitForFunction(() => document.querySelectorAll(".veo-pin").length > 0, null, { timeout: 30000 });
  await app.waitForTimeout(500);
}

const sheet = () => app.locator('[role="dialog"]').first();
async function closeSheet() {
  if (await app.locator('[role="dialog"]').count()) {
    await app.keyboard.press("Escape");
    await app.locator('[role="dialog"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
}

async function openDevice(id) {
  await app.goto(`${BASE}/twin`);
  await app.waitForSelector("text=assets tagged automatically", { timeout: 30000 });
  for (const scan of scansFor(id)) {
    await closeSheet();
    await selectScan(scan);
    const pins = await app.locator(".veo-pin").count();
    for (let i = 0; i < pins; i++) {
      await closeSheet();
      await app.evaluate((k) => document.querySelectorAll(".veo-pin")[k].click(), i);
      await sheet().waitFor({ timeout: 5000 });
      if ((await sheet().innerText()).includes(id)) return scan;
    }
  }
  throw new Error(`device ${id} not found in the Digital Twin`);
}

const TARGET = "DEMO-REL-01";
const OTHER = "DEMO-REL-04";
let ok = true;
try {
  const before = await dashboard();
  say(`0. Dashboard before: Overdue maintenance ${before.overdue}, Open notices ${before.open}`);

  const scan = await openDevice(TARGET);
  const t1 = await sheet().innerText();
  say(`1. Digital Twin ${scan}: tag opened ${TARGET}; card shows overdue=${t1.includes("Overdue")}, history entries visible=${t1.includes("Annual inspection")}`);
  await app.screenshot({ path: `${OUT}/1-autotag-before.png` });

  const field = await ctx.newPage();
  watch(field, "field");
  await field.setViewportSize({ width: 390, height: 844 });
  await field.goto(`${BASE}/field/index.html?asset=${TARGET}`);
  await field.waitForSelector('[data-new="entry"]', { timeout: 15000 });
  await field.click('[data-new="entry"]');
  await field.fill("#f-performedBy", "E2E Technician");
  await field.fill("#f-findings", "Demo test entry from the Field App");
  await field.selectOption("#f-result", "ok");
  await field.click('button[type="submit"]');
  await field.waitForSelector("#confirm");
  await field.screenshot({ path: `${OUT}/2-field-confirm.png`, fullPage: true });
  await field.click("[data-confirm]");
  const t0 = Date.now();
  say(`2. Field App: entry saved to ${TARGET} after device confirmation`);

  await app.waitForFunction(
    () => [...document.querySelectorAll('[role="dialog"]')].some((d) => d.innerText.includes("E2E Technician")),
    null,
    { timeout: 5000 },
  );
  const ms = Date.now() - t0;
  const t2 = await sheet().innerText();
  say(`3. AutoTag card updated WITHOUT reload after ${ms} ms; overdue now=${t2.includes("Overdue")}`);
  await app.screenshot({ path: `${OUT}/3-autotag-after.png` });

  await app.reload();
  await openDevice(TARGET);
  const t3 = await sheet().innerText();
  say(`4. After page reload the entry is ${t3.includes("E2E Technician") ? "still visible" : "MISSING"}`);
  if (!t3.includes("E2E Technician")) ok = false;

  await closeSheet();
  await openDevice(OTHER);
  const t4 = await sheet().innerText();
  say(`5. Other relay ${OTHER}: entry ${t4.includes("E2E Technician") ? "VISIBLE (wrong)" : "not shown (correct)"}`);
  if (t4.includes("E2E Technician")) ok = false;
  await app.screenshot({ path: `${OUT}/5-other-relay.png` });

  const after = await dashboard();
  say(`6. Dashboard after: Overdue maintenance ${after.overdue}, Open notices ${after.open}`);
  await app.screenshot({ path: `${OUT}/6-dashboard.png` });
} catch (e) {
  ok = false;
  say(`FAILED: ${e.message}`);
  await app.screenshot({ path: `${OUT}/failure.png` }).catch(() => {});
}
say(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
say(ok ? "RESULT: PASS" : "RESULT: FAIL");
fs.writeFileSync(`${OUT}/result.txt`, lines.join("\n") + "\n");
await browser.close();
process.exit(ok ? 0 : 1);
