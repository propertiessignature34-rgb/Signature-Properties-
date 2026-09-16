const fs = require('fs');
const { defineConfig } = require('@playwright/test');

const configuredChromium = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || (fs.existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : '');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 15000,
  globalSetup: require.resolve('./e2e/global-setup'),
  webServer: {
    command: 'TMP_DIR=$(mktemp -d) && DB_FILE="$TMP_DIR/sig-realty-db.json" && node e2e/seed-test-db.js "$DB_FILE" && PORT=4173 NODE_ENV=test SIG_REALTY_TEST_SESSION_TOKEN="${SIG_REALTY_TEST_SESSION_TOKEN:-pw-e2e-secret}" SIG_REALTY_DB_FILE="$DB_FILE" node server.js',
    url: 'http://127.0.0.1:4173/api/dashboard',
    reuseExistingServer: false,
    timeout: 30000
  },
  use: {
    headless: true,
    baseURL: 'http://localhost:4173',
    storageState: 'test-results/e2e-storage.json',
    ...(configuredChromium ? { launchOptions: { executablePath: configuredChromium } } : {})
  },
  reporter: [['line']]
});
