/**
 * Browser smoke test for the real game (run against a dev server or a built
 * preview). It drives the same UI a player uses and fails on runtime errors.
 *
 *   EDEN_URL=http://localhost:5173/ CHROME_PATH=/path/to/chrome npm run test:e2e
 *
 * Without CHROME_PATH the script exits with status 0 and says it was skipped,
 * so the unit suite stays runnable on machines without a browser.
 */

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const chromePath = process.env.CHROME_PATH;
const url = process.env.EDEN_URL ?? 'http://localhost:5173/';
const shotDir = process.env.EDEN_SHOTS ?? 'e2e-artifacts';

if (!chromePath) {
  console.log('[e2e] SKIPPED: set CHROME_PATH to a Chrome/Chromium binary to run browser tests.');
  process.exit(0);
}

fs.mkdirSync(shotDir, { recursive: true });
const failures = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures.push(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  protocolTimeout: 900000,
  defaultViewport: { width: 1280, height: 720 },
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});

const page = await browser.newPage();
const runtimeErrors = [];
page.on('pageerror', (e) => runtimeErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || /Shader Error|useProgram: program not valid/.test(t)) runtimeErrors.push(`${m.type()}: ${t.slice(0, 300)}`);
});
page.on('dialog', (d) => d.accept(page.__nextPrompt ?? undefined));

try {
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.eden && document.getElementById('boot-screen')?.classList.contains('hidden'), { timeout: 240000 });
  await sleep(1500);
  check(true, 'boot completes and boot screen hides');

  const menuVisible = await page.evaluate(() => !document.getElementById('main-menu').classList.contains('hidden'));
  check(menuVisible, 'main menu is visible after boot');
  await page.screenshot({ path: path.join(shotDir, '01-menu.png') });

  // New world via the real menu flow.
  await page.click('[data-action="new"]');
  await page.waitForSelector('#nw-create', { timeout: 5000 });
  await page.click('#nw-create');
  await page.waitForFunction(() => document.getElementById('main-menu').classList.contains('hidden'), { timeout: 240000 });
  await sleep(1500);
  const hudVisible = await page.evaluate(() => !document.getElementById('hud-root').classList.contains('hidden'));
  check(hudVisible, 'new world starts and HUD is shown');
  check(await page.evaluate(() => window.eden.paused === false), 'game is unpaused after starting');
  await page.screenshot({ path: path.join(shotDir, '02-new-world.png') });

  // Regeneration must not leak lights or sky domes into the scene.
  const countLights = () => page.evaluate(() => window.eden.scene.children.filter((c) => c.isLight).length);
  const lightsA = await countLights();
  for (let i = 0; i < 2; i++) {
    await page.evaluate((seed) => window.eden.startNewWorld({ seed, name: 'Regen' }), 1234 + i);
    await sleep(800);
  }
  const lightsB = await countLights();
  check(lightsA === lightsB, `scene light count stable across world regeneration (${lightsA} -> ${lightsB})`);

  // Pause menu: real save path, with a success toast only after commit.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.eden.uiManager.isPanelOpen, { timeout: 5000 });
  await page.click('[data-pa="save"]');
  await page.waitForFunction(() => document.querySelector('#toast-root')?.textContent?.includes('World saved.'), { timeout: 15000 });
  const saves = await page.evaluate(async () => (await window.eden.listSaves()).length);
  check(saves >= 1, `save committed to storage (${saves} slot(s))`);

  // Rename a slot from the gallery.
  await page.evaluate(() => window.eden.uiManager.closePanel());
  await page.evaluate(() => window.eden.uiManager.openSavesPanel('gallery', []));
  await page.evaluate(async () => {
    window.eden.uiManager.updateSaveSlots(await window.eden.listSaves());
  });
  await sleep(300);
  page.__nextPrompt = 'Renamed Valley';
  await page.click('[data-rename]');
  await sleep(1200);
  const renamed = await page.evaluate(async () => (await window.eden.listSaves())[0]?.name);
  check(renamed === 'Renamed Valley', `rename persists to storage (got "${renamed}")`);

  // Return to menu, then continue from the saved world.
  await page.evaluate(() => window.eden.uiManager.closePanel());
  await page.evaluate(() => window.eden.uiManager.setMenuVisible(true, true));
  await sleep(300);
  const continueEnabled = await page.evaluate(() => !document.querySelector('[data-action="continue"]').disabled);
  check(continueEnabled, 'Continue is enabled once a save exists');

  const timing = await page.evaluate(() => ({ frame: window.eden.frameMs, sim: window.eden.simMs, render: window.eden.renderMs }));
  console.log(`info  engine timing (ms): frame ${timing.frame.toFixed(1)}, sim ${timing.sim.toFixed(1)}, render ${timing.render.toFixed(1)} — software GL here, not a GPU benchmark`);

  await page.evaluate(() => window.eden.uiManager.setMenuVisible(false));
  await sleep(300);
  check(await page.evaluate(() => window.eden.paused === false), 'leaving the menu unpauses the game');
} catch (err) {
  failures.push(`harness: ${err.message}`);
  console.log(`FAIL  harness error: ${err.message}`);
  await page.screenshot({ path: path.join(shotDir, 'failure.png') }).catch(() => {});
} finally {
  await browser.close();
}

const relevant = runtimeErrors.filter((e) => !/vite|\[debug\]/.test(e));
check(relevant.length === 0, `no console errors or shader failures${relevant.length ? `: ${relevant.slice(0, 3).join(' | ')}` : ''}`);

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll browser smoke checks passed.');
