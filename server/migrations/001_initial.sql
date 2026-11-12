CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vat_rate_basis_points INTEGER NOT NULL DEFAULT 2200,
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  role TEXT NOT NULL CHECK (role IN ('office', 'driver')),
  login TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  birth_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, login)
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE tractors (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  brand TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  plate_number TEXT NOT NULL,
  vin TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'sold')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, plate_number)
);

CREATE TABLE trailers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  brand TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  plate_number TEXT NOT NULL,
  axles INTEGER CHECK (axles IS NULL OR axles > 0),
  capacity_kg INTEGER CHECK (capacity_kg IS NULL OR capacity_kg >= 0),
  trailer_type TEXT NOT NULL DEFAULT '',
  oversized_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'sold')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, plate_number)
);

CREATE TABLE rigs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE rig_periods (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  rig_id TEXT NOT NULL REFERENCES rigs(id),
  tractor_id TEXT NOT NULL REFERENCES tractors(id),
  trailer_id TEXT NOT NULL REFERENCES trailers(id),
  driver_id TEXT REFERENCES users(id),
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX rig_periods_one_open_period
  ON rig_periods(rig_id) WHERE valid_to IS NULL;
CREATE UNIQUE INDEX rig_periods_one_active_tractor
  ON rig_periods(tractor_id) WHERE valid_to IS NULL;
CREATE UNIQUE INDEX rig_periods_one_active_trailer
  ON rig_periods(trailer_id) WHERE valid_to IS NULL;
CREATE UNIQUE INDEX rig_periods_one_active_driver
  ON rig_periods(driver_id) WHERE valid_to IS NULL AND driver_id IS NOT NULL;

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  short_name TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  inn TEXT NOT NULL DEFAULT '',
  default_payment_term_days INTEGER CHECK (default_payment_term_days IS NULL OR default_payment_term_days >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE customer_contacts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  full_name TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE customer_contact_phones (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  contact_id TEXT NOT NULL REFERENCES customer_contacts(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  number TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL REFERENCES customers(id),
  rig_id TEXT NOT NULL REFERENCES rigs(id),
  rig_period_id TEXT NOT NULL REFERENCES rig_periods(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  tractor_id TEXT NOT NULL REFERENCES tractors(id),
  trailer_id TEXT NOT NULL REFERENCES trailers(id),
  loading_address TEXT NOT NULL,
  planned_loading_date TEXT NOT NULL,
  unloading_address TEXT NOT NULL,
  unloading_address_is_approximate INTEGER NOT NULL DEFAULT 0 CHECK (unloading_address_is_approximate IN (0, 1)),
  cargo_description TEXT NOT NULL DEFAULT '',
  driver_instructions TEXT NOT NULL DEFAULT '',
  agreed_rate_kopecks INTEGER NOT NULL CHECK (agreed_rate_kopecks >= 0),
  vat_mode TEXT NOT NULL CHECK (vat_mode IN ('with_vat', 'without_vat')),
  vat_rate_basis_points INTEGER NOT NULL DEFAULT 2200,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('bank', 'cash', 'card_transfer')),
  payment_term_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_term_days >= 0),
  payment_term_day_type TEXT NOT NULL DEFAULT 'calendar' CHECK (payment_term_day_type IN ('calendar', 'business')),
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('draft', 'assigned', 'awaiting_loading', 'in_progress', 'completed_by_driver', 'pending_review', 'needs_explanation', 'confirmed', 'closed')),
  assigned_at TEXT,
  loaded_at TEXT,
  unloaded_at TEXT,
  confirmed_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  confirmed_by TEXT REFERENCES users(id),
  start_client_mutation_id TEXT,
  complete_client_mutation_id TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX trips_by_driver_status ON trips(driver_id, status);
CREATE INDEX trips_by_rig_created ON trips(rig_id, created_at);
CREATE INDEX trips_by_customer_created ON trips(customer_id, created_at);
CREATE UNIQUE INDEX trips_one_active_driver
  ON trips(driver_id) WHERE status = 'in_progress';
CREATE UNIQUE INDEX trips_one_active_tractor
  ON trips(tractor_id) WHERE status = 'in_progress';
CREATE UNIQUE INDEX trips_unique_start_mutation
  ON trips(organization_id, start_client_mutation_id) WHERE start_client_mutation_id IS NOT NULL;
CREATE UNIQUE INDEX trips_unique_complete_mutation
  ON trips(organization_id, complete_client_mutation_id) WHERE complete_client_mutation_id IS NOT NULL;

CREATE TABLE trip_documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  trip_id TEXT NOT NULL REFERENCES trips(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  attachment_id TEXT NOT NULL REFERENCES attachments(id),
  document_type TEXT NOT NULL DEFAULT 'contract_application',
  version_number INTEGER NOT NULL DEFAULT 1,
  processing_status TEXT NOT NULL DEFAULT 'not_processed',
  extracted_json TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE odometer_readings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  trip_id TEXT NOT NULL REFERENCES trips(id),
  tractor_id TEXT NOT NULL REFERENCES tractors(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  reading_type TEXT NOT NULL CHECK (reading_type IN ('start', 'end')),
  entered_value_km INTEGER NOT NULL CHECK (entered_value_km >= 0),
  recognized_value_km INTEGER CHECK (recognized_value_km IS NULL OR recognized_value_km >= 0),
  recognition_confidence REAL,
  attachment_id TEXT NOT NULL REFERENCES attachments(id),
  latitude REAL,
  longitude REAL,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (trip_id, reading_type)
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  trip_id TEXT NOT NULL REFERENCES trips(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  rig_id TEXT NOT NULL REFERENCES rigs(id),
  tractor_id TEXT NOT NULL REFERENCES tractors(id),
  trailer_id TEXT NOT NULL REFERENCES trailers(id),
  amount_kopecks INTEGER NOT NULL CHECK (amount_kopecks > 0),
  category TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'transfer', 'fuel_card')),
  payment_source TEXT NOT NULL CHECK (payment_source IN ('driver_personal', 'driver_advance', 'company_card', 'company_fuel_card', 'company_cash')),
  supplier TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  location_text TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,
  receipt_attachment_id TEXT NOT NULL REFERENCES attachments(id),
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('draft', 'submitted', 'pending_review', 'confirmed', 'rejected', 'needs_explanation', 'suspicious')),
  risk_flags_json TEXT NOT NULL DEFAULT '[]',
  client_mutation_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  review_comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, client_mutation_id)
);

CREATE INDEX expenses_by_trip_status ON expenses(trip_id, status);

CREATE TABLE trip_rate_adjustments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  trip_id TEXT NOT NULL REFERENCES trips(id),
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('surcharge', 'discount', 'penalty', 'other')),
  amount_kopecks INTEGER NOT NULL,
  reason TEXT NOT NULL,
  attachment_id TEXT REFERENCES attachments(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  reversed_at TEXT,
  reversal_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE incoming_payments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  amount_kopecks INTEGER NOT NULL CHECK (amount_kopecks > 0),
  payment_type TEXT NOT NULL CHECK (payment_type IN ('advance', 'partial', 'final', 'other')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('bank', 'cash', 'card_transfer')),
  received_at TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  attachment_id TEXT REFERENCES attachments(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  reversed_at TEXT,
  reversal_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE payment_allocations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  payment_id TEXT NOT NULL REFERENCES incoming_payments(id),
  trip_id TEXT NOT NULL REFERENCES trips(id),
  amount_kopecks INTEGER NOT NULL CHECK (amount_kopecks > 0),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (payment_id, trip_id)
);

CREATE TABLE recurring_costs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('tractor', 'trailer', 'rig')),
  subject_id TEXT NOT NULL,
  category TEXT NOT NULL,
  total_amount_kopecks INTEGER NOT NULL CHECK (total_amount_kopecks >= 0),
  allocation_mode TEXT NOT NULL CHECK (allocation_mode IN ('monthly', 'equal_months')),
  allocation_months INTEGER NOT NULL DEFAULT 1 CHECK (allocation_months > 0),
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  comment TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  reversed_at TEXT,
  reversed_by TEXT REFERENCES users(id),
  reversal_reason TEXT,
  created_at TEXT NOT NULL,
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor_user_id TEXT REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX audit_by_entity ON audit_events(entity_type, entity_id, created_at);
