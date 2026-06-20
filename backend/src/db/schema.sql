CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crm_event_id TEXT NOT NULL,
  deal_key TEXT,
  data_source TEXT NOT NULL DEFAULT 'calendar',
  load_date TEXT,
  load_time TEXT,
  crm_lead_id TEXT,
  title TEXT NOT NULL,
  company_code TEXT,
  manager_name TEXT,
  start_date TEXT,
  end_date TEXT,
  department TEXT,
  status TEXT,
  legal_entity TEXT,
  invoice_number TEXT,
  budget TEXT,
  discount TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_company TEXT,
  contact_phone TEXT,
  address TEXT,
  venue_type TEXT,
  arrival_time TEXT,
  ready_time TEXT,
  work_time TEXT,
  dismantle_time TEXT,
  tony_order_id TEXT,
  content_hash TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  twenty_id TEXT,
  twenty_stage TEXT,
  twenty_error TEXT,
  synced_at TEXT,
  raw_description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deal_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL,
  quantity TEXT,
  discount REAL,
  comment TEXT,
  sum REAL,
  quantity_num REAL,
  classification TEXT NOT NULL DEFAULT 'unclassified',
  classification_confidence REAL,
  sync_override TEXT,
  twenty_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  action TEXT,
  twenty_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parse_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  total_events INTEGER DEFAULT 0,
  new_deals INTEGER DEFAULT 0,
  updated_deals INTEGER DEFAULT 0,
  skipped_deals INTEGER DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  twenty_id TEXT
);

CREATE TABLE IF NOT EXISTS managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company_id INTEGER REFERENCES companies(id),
  twenty_id TEXT,
  UNIQUE(name, company_id)
);

CREATE TABLE IF NOT EXISTS blacklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
  source_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pattern, match_type)
);

INSERT OR IGNORE INTO companies (code, full_name) VALUES ('ПРО', 'ProInteractive');
INSERT OR IGNORE INTO companies (code, full_name) VALUES ('АРТ', 'Art-Active');
INSERT OR IGNORE INTO companies (code, full_name) VALUES ('АРЕНДА', 'Arenda');

INSERT OR IGNORE INTO settings (key, value) VALUES ('approval_mode', 'manual');
INSERT OR IGNORE INTO settings (key, value) VALUES ('opportunity_stage', 'NOVYY');
INSERT OR IGNORE INTO settings (key, value) VALUES ('parse_schedule', '0 18 * * *');
INSERT OR IGNORE INTO settings (key, value) VALUES ('auth_mode', 'auto');
INSERT OR IGNORE INTO settings (key, value) VALUES ('keywords', '["брендинг","баннер","печать","плёнка","пленка","наклейка","логотип","вывеска","табличка","ролл-ап","rollup","стенд","press-wall","пресс-волл"]');
INSERT OR IGNORE INTO settings (key, value) VALUES ('crm_cookies', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('llm_prompt', 'Ты помощник отдела брендинга. Определи, относится ли позиция к брендингу (печать, баннеры, наклейки, вывески, оформление и т.д.). Ответь JSON: {"items": [{"name": "...", "is_branding": true/false, "confidence": 0.0-1.0}]}');

CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_deal_key ON deals(deal_key);
CREATE INDEX IF NOT EXISTS idx_deals_crm_event_id ON deals(crm_event_id);

INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_base_url', 'https://crm.apihide.com');
INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_login', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_password', '');
