const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
const schemaSql = fs.readFileSync(schemaPath, 'utf8').toLowerCase();

const requiredTables = [
  'companies', 'brokerages', 'users', 'roles', 'permissions', 'user_roles',
  'leads', 'transactions', 'requirements', 'requirement_history', 'builders',
  'projects', 'properties', 'inventory_media', 'documents', 'matches',
  'shortlists', 'site_visits', 'negotiations', 'negotiation_history', 'tokens',
  'token_history', 'deals', 'deal_history', 'commissions', 'commission_ledger',
  'closings', 'closing_history', 'followups', 'tasks', 'timeline', 'reports',
  'settings', 'audit_logs', 'broker_relationships', 'shared_requirements',
  'shared_requirement_properties', 'broker_network_events'
];

test('production schema declares required entities and controls', () => {
  for (const table of requiredTables) {
    assert.match(schemaSql, new RegExp(`create table ${table}\\s*\\(`), `missing table ${table}`);
  }

  for (const column of ['company_id', 'brokerage_id', 'created_by', 'updated_by', 'archived_at', 'deleted_at']) {
    assert.match(schemaSql, new RegExp(`\\b${column}\\b`), `missing schema field ${column}`);
  }

  for (const index of [
    'idx_properties_search',
    'idx_matches_requirement_property',
    'idx_shared_requirements_token',
    'idx_shared_requirements_origin',
    'idx_audit_tenant_entity'
  ]) {
    assert.match(schemaSql, new RegExp(`create index ${index}\\s+on`), `missing index ${index}`);
  }

  assert.match(schemaSql, /share_token_hash\s+text\s+not null\s+unique/);
  assert.match(schemaSql, /storage_provider\s+text\s+not null/);
  assert.match(schemaSql, /before_state\s+jsonb/);
  assert.match(schemaSql, /after_state\s+jsonb/);
});