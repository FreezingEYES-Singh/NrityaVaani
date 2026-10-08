// Records the site's own 3D dancer (the /learn lesson player) as a test video for /compare.
//   node record-3d-dancer.mjs <lesson> <startSec> <durSec> <outDir> [baseUrl]
// Prints JSON: the raw .webm, when the clip starts (seconds into the recording, after Play
// was pressed and the page settled) and the 3D canvas box, for the ffmpeg crop (see README.md).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "/opt/node22/lib/node_modules/playwright");

const [lesson, startS, durS, outDir, base = "http://localhost:3200"] = process.argv.slice(2);
const start = Number(startS);
const dur = Number(durS);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: outDir, size: { width: 1280, height: 800 } } });
const t0 = Date.now();
const page = await context.newPage();
await page.goto(`${base}/learn/bharatanatyam/${lesson}`, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 60000 });
await page.waitForTimeout(4000); // the clip and the figure load
// mute the narration and move to the start
const mute = page.locator('button[aria-label="Mute narration"]');
if (await mute.count()) await mute.first().click();
const scrub = page.locator('input[aria-label="Position in the lesson"]');
// start 2 s early: pressing Play scrolls the page for a moment, so the clip starts once it has settled
await scrub.fill(String(Math.max(0, start - 2)));
await page.waitForTimeout(1500);
await page.locator('button[aria-label="Play"]').first().click();
await page.waitForTimeout(1200);
const canvas = page.locator("canvas").first();
await page.evaluate(() => window.scrollTo(0, 0));
await canvas.scrollIntoViewIfNeeded();
await page.waitForTimeout(800);
const box = await canvas.boundingBox();
const tPlay = (Date.now() - t0) / 1000; // the clip starts here (lesson time is about `start`)
await page.waitForTimeout(dur * 1000 + 500);
const video = await page.video().path();
await context.close();
await browser.close();
console.log(JSON.stringify({ video, tPlay, box }));
