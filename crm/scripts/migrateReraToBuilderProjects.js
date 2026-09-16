'use strict';

/**
 * One-off migration: convert existing IsReraMaster=true Inventory rows
 * (from the old RERA scraper/import module, now removed) into the new
 * BuilderProjects collection, then remove them from Inventory.
 */

const path = require('path');
const { SignatureRealtyRuntime } = require('../src/runtime/app');
const mongoStore = require('../src/data/mongoStore');

async function main() {
  if (mongoStore.isEnabled()) {
    const fallbackJson = path.join(__dirname, '..', 'data', 'sig-realty-db.json');
    const initRes = await mongoStore.initMongo(fallbackJson);
    console.log('[mongo] init:', initRes);
  }

  const runtime = new SignatureRealtyRuntime();
  const db = runtime.repository.read();
  db.Inventory = db.Inventory || [];
  db.BuilderProjects = db.BuilderProjects || [];

  const reraRows = db.Inventory.filter((p) => p.IsReraMaster === true);
  console.log(`Found ${reraRows.length} IsReraMaster=true Inventory rows to migrate.`);

  const now = new Date().toISOString();
  let migrated = 0;
  for (const p of reraRows) {
    const already = db.BuilderProjects.some((bp) => bp.RERANumber && p.RERANumber && bp.RERANumber === p.RERANumber);
    if (!already) {
      db.BuilderProjects.push({
        ProjectID: runtime.repository.createId('BLDP'),
        ProjectName: p.ProjectName || (p.Title || '').split('—')[0].trim() || 'Untitled Project',
        BuilderName: p.BuilderName || 'Unknown Builder',
        Location1: p.Location1 || null,
        Address: null,
        RERANumber: p.RERANumber || null,
        ProjectStatus: p.ProjectStatus === 'Ongoing' ? 'Under Construction' : (p.ProjectStatus === 'Completed' ? 'Completed' : (p.ProjectStatus === 'Lapsed' ? 'Completed' : 'Under Construction')),
        Configurations: Array.isArray(p.Configurations) ? p.Configurations : [],
        TotalUnits: p.TotalUnits || null,
        AreaRange: p.AreaRange || null,
        PriceRange: null,
        PossessionDate: p.PossessionDate || null,
        Amenities: [],
        Notes: null,
        ImportedFrom: 'MigratedFromReraModule',
        Active: true,
        CreatedAt: p.CreatedAt || now,
        UpdatedAt: now,
        CreatedBy: p.CreatedBy || 'system'
      });
      migrated += 1;
    }
  }

  db.Inventory = db.Inventory.filter((p) => p.IsReraMaster !== true);
  delete db._ReraImports;
  delete db._ReraConfig;
  delete db._ReraScrapeRuns;

  runtime.repository.write(db);
  if (mongoStore.isEnabled()) {
    const flushResult = await mongoStore.flush();
    console.log('[mongo] flush:', flushResult);
  }
  console.log(`Migrated ${migrated} projects into BuilderProjects. Removed ${reraRows.length} rows from Inventory.`);
  process.exit(0);
}

main().catch((e) => { console.error('Migration failed:', e); process.exit(1); });
