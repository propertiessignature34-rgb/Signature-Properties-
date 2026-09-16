let chromium;
try { ({ chromium } = require('playwright')); } catch {
  console.log('[browser-smoke] playwright not installed — skipping browser E2E smoke test');
  process.exit(0);
}
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 4193;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-browser-smoke-')), 'sig-realty-db.json');

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  throw new Error(`Browser smoke server did not start at ${BASE_URL}`);
}

(async() => {
  const serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), SIG_REALTY_DB_FILE: DB_FILE },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.setEncoding('utf8');
  serverProcess.stderr.setEncoding('utf8');

  await waitForServer();

  const browser = await chromium.launch({ args: ['--headless'] });
  const page = await browser.newPage();

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 10000 });

  const title = await page.title();
  const bodyText = await page.locator('body').innerText();
  const bodyHtml = await page.locator('body').evaluate((element) => element.innerHTML);

  await page.screenshot({ path: 'test/e2e/screenshots/home.png', fullPage: true });

  console.log(JSON.stringify({
    title,
    bodyTextLength: bodyText.length,
    bodyHtmlLength: bodyHtml.length,
    loaded: Boolean(title)
  }));

  await browser.close();
  serverProcess.kill('SIGTERM');
})().catch((error) => {
  // If browser binaries aren't installed, skip gracefully instead of failing CI
  if (error && (error.message || '').includes("Executable doesn't exist")) {
    console.log('[browser-smoke] Browser binaries not installed (run npx playwright install) — skipping');
    process.exit(0);
  }
  console.error('BROWSER_LAUNCH_ERROR:', error);
  process.exit(1);
});
