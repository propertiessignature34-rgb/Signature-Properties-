'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const file = path.resolve(__dirname, '..', 'builder-projects.html');

test('builder projects UI prefers internal media and avoids external image fallback', () => {
  const html = fs.readFileSync(file, 'utf8');

  assert.match(html, /function preferredPhotoUrl\(project, photo\)\s*{[\s\S]*isStoredPhoto\(photo\)[\s\S]*\/api\/v2\/builder-projects\/\$\{encodeURIComponent\(project\.ProjectID\)\}\/images\/\$\{encodeURIComponent\(photo\.MediaID\)\}[\s\S]*return MEDIA_PLACEHOLDER_IMAGE;/);
  assert.doesNotMatch(html, /function preferredPhotoUrl\(project, photo\)\s*{[\s\S]*return photo\.Url \|\| photo\.SourceUrl \|\| photo\.OriginalUrl \|\| '';/);
});

test('builder projects UI keeps brochure pending state and does not link external non-stored brochures', () => {
  const html = fs.readFileSync(file, 'utf8');

  assert.match(html, /function preferredBrochureUrl\(project, brochure\)\s*{[\s\S]*isStoredBrochure\(brochure\)[\s\S]{0,260}hasInternalPath\(brochure\.Url, 'brochure'\)[\s\S]*return '';/);
  assert.match(html, /Pending permanent storage/);
  assert.match(html, /const label = stored[\s\S]*<a href="\$\{esc\(preferredBrochureUrl\(p, m\)\)\}"[\s\S]*: `<span>📄 \$\{filename\}<\/span>`;/);
});
