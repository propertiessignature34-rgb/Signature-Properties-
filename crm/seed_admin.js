// Seeds/updates the ADMIN user so the platform-managed Google account can sign in.
// The CRM authorizes a Google login only if an ACTIVE user with a matching
// Email (and tenant scope) already exists. We attach the admin email to the
// built-in USR-SYSTEM-ADMIN record.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');
const mongoStore = require('./src/data/mongoStore');
const { SignatureRealtyRuntime } = require('./src/runtime/app');

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'propertiessignature34@gmail.com').trim().toLowerCase();
const ADMIN_NAME = String(process.env.ADMIN_NAME || 'Signature Realty Admin').trim();

async function main() {
  if (mongoStore.isEnabled()) {
    const fallbackJson = path.join(__dirname, 'data', 'sig-realty-db.json');
    await mongoStore.initMongo(fallbackJson);
    if (!mongoStore.isInitialized()) throw new Error('Mongo init failed');
  }

  const runtime = new SignatureRealtyRuntime();
  runtime.repository.ensureStarterSeed();

  const repo = runtime.repository;
  const users = repo.listUsers();
  const existing = users.find((u) => String(u.Email || '').trim().toLowerCase() === ADMIN_EMAIL);

  if (existing) {
    repo.updateUser(existing.UserID, {
      Name: existing.Name || ADMIN_NAME,
      Email: ADMIN_EMAIL,
      Role: 'ADMIN',
      Status: 'Active',
      CompanyID: existing.CompanyID || 'COMP-DEFAULT',
      BrokerageID: existing.BrokerageID || 'BRK-DEFAULT',
      Permissions: ['*'],
    }, { userId: 'seed-script' });
    console.log('[seed] updated existing admin user', existing.UserID, ADMIN_EMAIL);
  } else {
    const sysAdmin = users.find((u) => u.UserID === 'USR-SYSTEM-ADMIN');
    if (sysAdmin) {
      repo.updateUser('USR-SYSTEM-ADMIN', {
        Name: ADMIN_NAME,
        Email: ADMIN_EMAIL,
        Role: 'ADMIN',
        Status: 'Active',
        CompanyID: sysAdmin.CompanyID || 'COMP-DEFAULT',
        BrokerageID: sysAdmin.BrokerageID || 'BRK-DEFAULT',
        Permissions: ['*'],
      }, { userId: 'seed-script' });
      console.log('[seed] attached admin email to USR-SYSTEM-ADMIN', ADMIN_EMAIL);
    } else {
      const res = repo.createUser({
        Name: ADMIN_NAME,
        Email: ADMIN_EMAIL,
        Role: 'ADMIN',
        Status: 'Active',
        CompanyID: 'COMP-DEFAULT',
        BrokerageID: 'BRK-DEFAULT',
        Permissions: ['*'],
      }, { userId: 'seed-script' });
      console.log('[seed] created admin user', res);
    }
  }

  if (mongoStore.isEnabled() && mongoStore.isInitialized()) {
    await mongoStore.flush();
    await mongoStore.close();
  }
  console.log('[seed] done');
  process.exit(0);
}

main().catch((e) => { console.error('[seed] failed:', e); process.exit(1); });
