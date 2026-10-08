// End-to-end check of /compare in headless Chromium (05-mvp.md §6 step 4).
//   node run-compare-e2e.mjs <teacher video> <student video> [baseUrl] [screenshot.png] [tracks.json]
// Marks the whole teacher clip as the step, prepares it, analyses the student video,
// and prints the result as JSON (found, kind, timing, tips, bands, console errors).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "/opt/node22/lib/node_modules/playwright");

const [teacher, student, base = "http://localhost:3200", shot, dump] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const t0 = Date.now();
const since = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";

await page.goto(`${base}/compare?delegate=cpu&debug=1`, { waitUntil: "networkidle" });
await page.setInputFiles('[data-testid="teacher-file"]', teacher);
await page.waitForSelector('input[type="range"]', { timeout: 30000 });
const sliders = page.locator('input[type="range"]');
const max = Number(await sliders.nth(1).getAttribute("max"));
await sliders.nth(1).fill(String(Math.floor(max * 10) / 10)); // the sliders step by 0.1 s
await sliders.nth(0).fill("0");
await page.click('[data-testid="prepare-teacher"]');
await page.waitForSelector('[data-testid="teacher-ready"]', { timeout: 15 * 60 * 1000 });
const teacherReady = await page.textContent('[data-testid="teacher-ready"]');
console.error(`[${since()}] ${teacherReady}`);
await page.setInputFiles('[data-testid="student-file"]', student);
await page.click('[data-testid="analyse-student"]');
await page.waitForSelector('[data-testid="results"]', { timeout: 20 * 60 * 1000 });
await page.waitForTimeout(1000);
console.error(`[${since()}] results`);
const text = await page.textContent('[data-testid="results"]');
if (dump) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(dump, JSON.stringify(await page.evaluate(() => window.__compare)));
}
const tips = await page.$$eval('[data-testid="results"] ol li p.font-medium', (els) => els.map((e) => e.textContent?.replace(/\s+/g, " ").trim()));
// Show me on the first tip, then Play both, to exercise the markers and the synced playback
const showMe = page.locator('button:has-text("Show me")');
if (await showMe.count()) await showMe.first().click();
await page.waitForTimeout(500);
if (shot) await page.locator('[data-testid="results"]').screenshot({ path: shot });
const play = page.locator('[data-testid="play-both"]');
let synced = null;
if (await play.isEnabled()) {
  await play.click();
  await page.waitForTimeout(3000);
  synced = await page.$$eval("video", (vs) => vs.map((v) => ({ t: +v.currentTime.toFixed(2), paused: v.paused, rate: v.playbackRate })));
}
console.log(JSON.stringify({ teacherReady, tips, synced, text: text?.replace(/\s+/g, " ").slice(0, 1500), errors, seconds: (Date.now() - t0) / 1000 }, null, 1));
await browser.close();
