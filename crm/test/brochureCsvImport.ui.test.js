'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync(require.resolve('../builder-projects.html'), 'utf8');

test('CSV brochure UI requires preview and explicit confirmation before commit', () => {
  assert.match(html, /data-testid="csv-brochure-import-btn"[^>]*onclick="openCsvBrochureModal\(\)"/);
  assert.match(html, /data-testid="csv-brochure-preview-btn"[^>]*onclick="previewCsvBrochures\(\)"/);
  assert.match(html, /data-testid="csv-brochure-confirm"/);
  assert.match(html, /data-testid="csv-brochure-start-btn"[^>]*onclick="startCsvBrochureImport\(\)"/);
  assert.match(html, /\/api\/v2\/admin\/brochure-import\/csv\/preview/);
  assert.match(html, /\/api\/v2\/admin\/brochure-import\/csv\/commit/);
  assert.match(html, /confirmed: true/);
  assert.match(html, /Upload alone does not start an import|upload alone does not start an import/);
});