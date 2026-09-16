-- Signature Realty OS Phase 5.0-B relational foundation.
-- This is a design/migration artifact only. It is not executed by the application yet.

create extension if not exists pgcrypto;

create table companies (
  id uuid primary key default gen_random_uuid(),
  company_id text not null unique,
  name text not null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table brokerages (
  id uuid primary key default gen_random_uuid(),
  brokerage_id text not null unique,
  company_id uuid not null references companies(id),
  name text not null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  role_id text not null unique,
  name text not null unique,
  description text,
  status text not null default 'ACTIVE',
  system_role boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  permission_id text not null unique,
  code text not null unique,
  module text not null,
  action text not null,
  scope text,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  name text not null,
  mobile text,
  email text,
  role_name text,
  status text not null default 'ACTIVE',
  password_hash text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table user_roles (
  user_id uuid not null references users(id),
  role_id uuid not null references roles(id),
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  client_name text,
  city text,
  phone text,
  email text,
  lead_source text,
  lead_status text,
  assigned_agent_id uuid references users(id),
  archive_flag boolean not null default false,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  lead_id uuid not null references leads(id),
  type text not null,
  status text,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table requirements (
  id uuid primary key default gen_random_uuid(),
  requirement_id text not null unique,
  requirement_code text,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  lead_id uuid not null references leads(id),
  transaction_id uuid not null references transactions(id),
  transaction_type text,
  category text,
  sub_category text,
  property_type text,
  budget_min numeric(18,2),
  budget_max numeric(18,2),
  location_1 text,
  location_2 text,
  location_3 text,
  bhk_min numeric,
  bhk_max numeric,
  area_min numeric,
  area_max numeric,
  possession text,
  urgency text,
  special_notes text,
  status text,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table requirement_history (
  id uuid primary key default gen_random_uuid(),
  requirement_history_id text not null unique,
  requirement_id uuid not null references requirements(id),
  status text,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table builders (
  id uuid primary key default gen_random_uuid(),
  builder_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  name text not null,
  mobile text,
  email text,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  project_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  builder_id uuid references builders(id),
  project_name text not null,
  rera text,
  address text,
  city text,
  location text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  status text,
  possession text,
  description text,
  amenities jsonb not null default '[]'::jsonb,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  property_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  project_id uuid references projects(id),
  builder_id uuid references builders(id),
  owner_id text,
  transaction_type text,
  category text,
  sub_category text,
  property_type text,
  configuration text,
  bhk numeric,
  area numeric,
  price numeric(18,2),
  possession text,
  project text,
  location text,
  city text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  rera text,
  status text,
  visibility text not null default 'PRIVATE',
  broker_id text,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table inventory_media (
  id uuid primary key default gen_random_uuid(),
  media_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  entity_type text not null,
  entity_id uuid,
  property_id uuid references properties(id),
  project_id uuid references projects(id),
  media_type text not null,
  title text,
  storage_provider text not null,
  storage_path text not null,
  thumbnail_path text,
  mime_type text,
  size_bytes bigint,
  checksum text,
  visibility text not null default 'PRIVATE',
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  document_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  entity_type text not null,
  entity_id uuid,
  lead_id uuid references leads(id),
  document_type text,
  storage_provider text,
  storage_path text,
  storage_url text,
  mime_type text,
  size_bytes bigint,
  checksum text,
  status text not null default 'ACTIVE',
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  match_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  lead_id uuid references leads(id),
  requirement_id uuid not null references requirements(id),
  property_id uuid not null references properties(id),
  score numeric,
  match_level text,
  matched_criteria jsonb,
  failed_criteria jsonb,
  unknown_criteria jsonb,
  score_breakdown jsonb,
  explanation text,
  status text,
  algorithm_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table shortlists (
  id uuid primary key default gen_random_uuid(),
  shortlist_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  lead_id uuid references leads(id),
  transaction_id uuid references transactions(id),
  requirement_id uuid references requirements(id),
  property_id uuid not null references properties(id),
  status text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table site_visits (
  id uuid primary key default gen_random_uuid(),
  visit_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  lead_id uuid references leads(id),
  transaction_id uuid references transactions(id),
  requirement_id uuid references requirements(id),
  property_id uuid references properties(id),
  agent_id uuid references users(id),
  visit_date date,
  visit_time time,
  status text,
  feedback text,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table negotiations (
  id uuid primary key default gen_random_uuid(),
  negotiation_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  lead_id uuid references leads(id),
  requirement_id uuid references requirements(id),
  transaction_id uuid references transactions(id),
  property_id uuid references properties(id),
  match_id uuid references matches(id),
  shortlist_id uuid references shortlists(id),
  site_visit_id uuid references site_visits(id),
  asking_price numeric(18,2),
  initial_offer numeric(18,2),
  current_offer numeric(18,2),
  counter_offer numeric(18,2),
  final_offer numeric(18,2),
  agreed_price numeric(18,2),
  brokerage_type text,
  brokerage_percent numeric(8,4),
  brokerage_amount numeric(18,2),
  brokerage_payer text,
  token_amount numeric(18,2),
  token_date date,
  payment_terms text,
  possession_date date,
  agreement_date date,
  registration_date date,
  special_terms text,
  notes text,
  assigned_agent_id uuid references users(id),
  created_by uuid references users(id),
  updated_by uuid references users(id),
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz
);

create table negotiation_history (
  id uuid primary key default gen_random_uuid(),
  negotiation_history_id text not null unique,
  negotiation_id uuid not null references negotiations(id),
  action text not null,
  previous_status text,
  new_status text,
  previous_offer numeric(18,2),
  new_offer numeric(18,2),
  user_id uuid references users(id),
  timestamp timestamptz not null default now(),
  notes text,
  payload jsonb not null default '{}'::jsonb
);

create table tokens (
  id uuid primary key default gen_random_uuid(),
  token_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  lead_id uuid references leads(id),
  requirement_id uuid references requirements(id),
  property_id uuid references properties(id),
  negotiation_id uuid references negotiations(id),
  shortlist_id uuid references shortlists(id),
  token_amount numeric(18,2),
  paid_amount numeric(18,2),
  pending_amount numeric(18,2),
  token_date date,
  status text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table token_history (
  id uuid primary key default gen_random_uuid(),
  token_history_id text not null unique,
  token_id uuid not null references tokens(id),
  action text not null,
  previous_status text,
  new_status text,
  amount numeric(18,2),
  actor_id uuid references users(id),
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table deals (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  lead_id uuid references leads(id),
  requirement_id uuid references requirements(id),
  property_id uuid references properties(id),
  negotiation_id uuid references negotiations(id),
  token_id uuid references tokens(id),
  buyer text,
  seller text,
  transaction text,
  price numeric(18,2),
  brokerage numeric(18,2),
  status text,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table deal_history (
  id uuid primary key default gen_random_uuid(),
  deal_history_id text not null unique,
  deal_id uuid not null references deals(id),
  action text not null,
  previous_status text,
  new_status text,
  actor_id uuid references users(id),
  created_at timestamptz not null default now(),
  notes text,
  payload jsonb not null default '{}'::jsonb
);

create table commissions (
  id uuid primary key default gen_random_uuid(),
  commission_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  deal_id uuid references deals(id),
  token_id uuid references tokens(id),
  negotiation_id uuid references negotiations(id),
  transaction_id uuid references transactions(id),
  lead_id uuid references leads(id),
  requirement_id uuid references requirements(id),
  property_id uuid references properties(id),
  agent_id uuid references users(id),
  broker_id text,
  referral_id text,
  commission_type text,
  commission_basis text,
  commission_rate numeric(8,4),
  fixed_commission numeric(18,2),
  base_amount numeric(18,2),
  commission_amount numeric(18,2),
  gross_commission numeric(18,2),
  agent_share_percent numeric(8,4),
  company_share_percent numeric(8,4),
  referral_share_percent numeric(8,4),
  agent_share_amount numeric(18,2),
  company_share_amount numeric(18,2),
  referral_share_amount numeric(18,2),
  gst_rate numeric(8,4),
  gst_amount numeric(18,2),
  tds_rate numeric(8,4),
  tds_amount numeric(18,2),
  other_deductions numeric(18,2),
  deductions_total numeric(18,2),
  net_payable numeric(18,2),
  received_amount numeric(18,2),
  pending_amount numeric(18,2),
  status text,
  due_date date,
  received_date date,
  payment_reference text,
  notes text,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table commission_ledger (
  id uuid primary key default gen_random_uuid(),
  ledger_id text not null unique,
  commission_id uuid not null references commissions(id),
  deal_id uuid references deals(id),
  token_id uuid references tokens(id),
  negotiation_id uuid references negotiations(id),
  transaction_id uuid references transactions(id),
  lead_id uuid references leads(id),
  property_id uuid references properties(id),
  entry_type text not null,
  entry_date timestamptz not null default now(),
  entry_value numeric(18,2),
  status text,
  payment_id text,
  notes text,
  payload jsonb not null default '{}'::jsonb
);

create table closings (
  id uuid primary key default gen_random_uuid(),
  closing_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  deal_id uuid not null references deals(id),
  token_id uuid references tokens(id),
  negotiation_id uuid references negotiations(id),
  transaction_id uuid references transactions(id),
  lead_id uuid references leads(id),
  requirement_id uuid references requirements(id),
  property_id uuid references properties(id),
  status text,
  checklist jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  notes text,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table closing_history (
  id uuid primary key default gen_random_uuid(),
  closing_history_id text not null unique,
  closing_id uuid not null references closings(id),
  deal_id uuid references deals(id),
  lead_id uuid references leads(id),
  event_type text not null,
  event_date timestamptz not null default now(),
  actor_id uuid references users(id),
  notes text,
  payload jsonb not null default '{}'::jsonb
);

create table followups (
  id uuid primary key default gen_random_uuid(),
  followup_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  lead_id uuid references leads(id),
  transaction_id uuid references transactions(id),
  assigned_to uuid references users(id),
  due_date date,
  due_time time,
  type text,
  priority text,
  notes text,
  status text,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  task_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  entity_type text,
  entity_id uuid,
  assigned_to uuid references users(id),
  title text not null,
  status text,
  due_at timestamptz,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table timeline (
  id uuid primary key default gen_random_uuid(),
  timeline_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  lead_id uuid references leads(id),
  entity_type text not null,
  entity_id uuid,
  event_type text not null,
  event_title text,
  event_date timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid references users(id)
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  report_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  report_name text not null,
  category text,
  schedule text,
  status text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table settings (
  id uuid primary key default gen_random_uuid(),
  settings_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  key text not null,
  value jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  audit_id text not null unique,
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  actor_id uuid references users(id),
  action text not null,
  module text,
  entity_type text,
  entity_id text,
  before_state jsonb,
  after_state jsonb,
  ip inet,
  device text,
  result text,
  created_at timestamptz not null default now()
);

create table broker_relationships (
  id uuid primary key default gen_random_uuid(),
  broker_relationship_id text not null unique,
  originating_broker_id text not null,
  receiving_broker_id text not null,
  originating_company_id uuid references companies(id),
  receiving_company_id uuid references companies(id),
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table shared_requirements (
  id uuid primary key default gen_random_uuid(),
  shared_requirement_id text not null unique,
  requirement_id uuid not null references requirements(id),
  originating_broker_id text not null,
  originating_company_id uuid references companies(id),
  originating_brokerage_id uuid references brokerages(id),
  share_token_hash text not null unique,
  status text not null default 'ACTIVE',
  expires_at timestamptz not null,
  access_count integer not null default 0,
  last_accessed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table shared_requirement_properties (
  id uuid primary key default gen_random_uuid(),
  shared_requirement_property_id text not null unique,
  shared_requirement_id uuid not null references shared_requirements(id),
  property_id uuid not null references properties(id),
  submitting_broker_id text not null,
  submitting_company_id uuid references companies(id),
  submitting_brokerage_id uuid references brokerages(id),
  submitted_at timestamptz not null default now(),
  status text not null default 'SUBMITTED',
  message text,
  attribution jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table broker_network_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  shared_requirement_id uuid references shared_requirements(id),
  shared_requirement_property_id uuid references shared_requirement_properties(id),
  company_id uuid references companies(id),
  brokerage_id uuid references brokerages(id),
  actor_id uuid references users(id),
  event_type text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_brokerages_company on brokerages(company_id);
create index idx_users_tenant on users(company_id, brokerage_id, status);
create index idx_leads_tenant_status on leads(company_id, brokerage_id, lead_status, created_at);
create index idx_leads_assigned_agent on leads(assigned_agent_id, status);
create index idx_transactions_lead on transactions(lead_id, status);
create index idx_requirements_tenant_status on requirements(company_id, brokerage_id, status, created_at);
create index idx_requirements_lead_transaction on requirements(lead_id, transaction_id);
create index idx_properties_search on properties(category, property_type, location, price, bhk, area);
create index idx_properties_tenant_visibility on properties(company_id, brokerage_id, visibility, status);
create index idx_projects_builder_status on projects(builder_id, status);
create index idx_matches_requirement_property on matches(requirement_id, property_id, score);
create index idx_shortlists_requirement_property on shortlists(requirement_id, property_id, status);
create index idx_site_visits_requirement_property on site_visits(requirement_id, property_id, status);
create index idx_negotiations_requirement_property on negotiations(requirement_id, property_id, status);
create index idx_tokens_requirement_property on tokens(requirement_id, property_id, status);
create index idx_deals_tenant_status on deals(company_id, brokerage_id, status, created_at);
create index idx_commissions_deal_status on commissions(deal_id, status, due_date);
create index idx_closings_deal_status on closings(deal_id, status);
create index idx_timeline_lead_date on timeline(lead_id, event_date desc);
create index idx_audit_tenant_entity on audit_logs(company_id, brokerage_id, entity_type, entity_id, created_at desc);
create index idx_shared_requirements_token on shared_requirements(share_token_hash);
create index idx_shared_requirements_origin on shared_requirements(originating_broker_id, originating_company_id, status, expires_at);
create index idx_shared_requirement_properties_parent on shared_requirement_properties(shared_requirement_id, property_id, status);
create index idx_shared_requirement_properties_submitter on shared_requirement_properties(submitting_broker_id, submitting_company_id, property_id);
create index idx_network_events_parent on broker_network_events(shared_requirement_id, created_at desc);

-- Row-level security policies are intentionally deferred to the auth/RBAC phase.
-- The tenant columns and indexes above are the required database foundation.
