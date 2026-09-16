'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const builderProjectsHtml = fs.readFileSync(
  require.resolve('../builder-projects.html'),
  'utf8'
);

test('frontend uses the verified internal brochure endpoint and not the external URL', () => {
  assert.match(
    builderProjectsHtml,
    /brochure\.verified === true[\s\S]*hasInternalPath\(brochure\.Url, 'brochure'\)/
  );
  assert.match(
    builderProjectsHtml,
    /return `\/api\/v2\/builder-projects\/\$\{encodeURIComponent\(project\.ProjectID\)\}\/brochure`/
  );
  assert.match(builderProjectsHtml, /\/api\/v2\/admin\/brochure-import/);
  assert.doesNotMatch(
    builderProjectsHtml,
    /preferredBrochureUrl[\s\S]{0,500}OriginalUrl/
  );
});