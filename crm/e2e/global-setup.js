const fs = require('fs');
const path = require('path');
const { request } = require('@playwright/test');

module.exports = async (config) => {
  const baseURL = config.projects[0].use.baseURL;
  const secret = process.env.SIG_REALTY_TEST_SESSION_TOKEN || 'pw-e2e-secret';
  const context = await request.newContext({ baseURL });
  try {
    const response = await context.post('/api/auth/test-session', {
      data: { secret, userId: 'USR-0001' }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok() || !body.data?.token) {
      throw new Error(`Playwright test-session setup failed: ${JSON.stringify(body)}`);
    }
    const storagePath = path.resolve('test-results/e2e-storage.json');
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    await context.storageState({ path: storagePath });
  } finally {
    await context.dispose();
  }
};