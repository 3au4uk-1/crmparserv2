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
  tony_updated_at TEXT,
  content_hash TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  twenty_id TEXT,
  twenty_stage TEXT,
  calendar_miss_streak INTEGER NOT NULL DEFAULT 0,
  pre_cancel_opportunity_stage TEXT,
  line_item_stage_snapshot_json TEXT,
  payment_amount REAL,
  payment_status TEXT,
  payment_count INTEGER,
  payment_hash TEXT,
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

CREATE TABLE IF NOT EXISTS restoration_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
  source_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pattern, match_type)
);

CREATE TABLE IF NOT EXISTS podryad_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
  source_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pattern, match_type)
);

CREATE TABLE IF NOT EXISTS banner_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
  source_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pattern, match_type)
);

CREATE TABLE IF NOT EXISTS expense_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'queued',
  trigger TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  deals_targeted INTEGER DEFAULT 0,
  deals_updated INTEGER DEFAULT 0,
  deals_with_expenses INTEGER DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expense_beznal_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storage_path TEXT NOT NULL,
  original_filename TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bulk_resync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'queued',
  trigger TEXT NOT NULL DEFAULT 'manual',
  started_at TEXT,
  finished_at TEXT,
  deals_total INTEGER DEFAULT 0,
  deals_done INTEGER DEFAULT 0,
  deals_updated INTEGER DEFAULT 0,
  deals_failed INTEGER DEFAULT 0,
  errors_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_stream_backfill_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'queued',
  trigger TEXT NOT NULL DEFAULT 'manual',
  started_at TEXT,
  finished_at TEXT,
  deals_total INTEGER DEFAULT 0,
  deals_done INTEGER DEFAULT 0,
  deals_updated INTEGER DEFAULT 0,
  deals_failed INTEGER DEFAULT 0,
  errors_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS restore_missing_twenty_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'queued',
  trigger TEXT NOT NULL DEFAULT 'manual',
  started_at TEXT,
  finished_at TEXT,
  deals_total INTEGER DEFAULT 0,
  deals_done INTEGER DEFAULT 0,
  deals_restored INTEGER DEFAULT 0,
  deals_skipped INTEGER DEFAULT 0,
  deals_failed INTEGER DEFAULT 0,
  errors_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS decor_mk_scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'queued',
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  deals_total INTEGER DEFAULT 0,
  deals_done INTEGER DEFAULT 0,
  deals_updated INTEGER DEFAULT 0,
  deals_failed INTEGER DEFAULT 0,
  errors_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS telegram_send_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  line_item_id TEXT NOT NULL,
  opportunity_id TEXT,
  chat_id TEXT,
  sent_by TEXT,
  payload_hash TEXT,
  telegram_message_ids TEXT,
  load_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deal_bitrix_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bitrix_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('payment', 'booking', 'other')),
  is_canonical INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (deal_id, bitrix_id)
);
CREATE INDEX IF NOT EXISTS idx_deal_bitrix_links_bitrix ON deal_bitrix_links(bitrix_id);

CREATE TABLE IF NOT EXISTS deal_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twenty_parent_id TEXT,
  name TEXT NOT NULL,
  name_locked INTEGER NOT NULL DEFAULT 0,
  canonical_deal_id INTEGER NOT NULL REFERENCES deals(id),
  canonical_bitrix_id TEXT NOT NULL,
  canonical_locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deal_group_members (
  group_id INTEGER NOT NULL REFERENCES deal_groups(id) ON DELETE CASCADE,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  UNIQUE (deal_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_send_log_event_line
  ON telegram_send_log(event, line_item_id);

CREATE TABLE IF NOT EXISTS telegram_okleyka_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_item_id TEXT NOT NULL,
  opportunity_id TEXT,
  text TEXT NOT NULL,
  file_urls_json TEXT NOT NULL DEFAULT '[]',
  sent_by TEXT,
  force INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  sending_started_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_okleyka_outbox_open
  ON telegram_okleyka_outbox(line_item_id)
  WHERE status IN ('pending', 'sending');

CREATE TABLE IF NOT EXISTS telegram_chats (
  chat_id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  is_forum INTEGER NOT NULL DEFAULT 0,
  username TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS telegram_topics (
  chat_id TEXT NOT NULL,
  thread_id INTEGER NOT NULL,
  name TEXT,
  source TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, thread_id)
);
CREATE TABLE IF NOT EXISTS telegram_auto_invite_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  user_id TEXT,
  display_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS telegram_auto_invite_runs (
  chat_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  detail_json TEXT
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


INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_base_url', 'https://crm.apihide.com');
INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_login', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_password', '');

INSERT OR IGNORE INTO settings (key, value) VALUES ('expense_sheet_field_team', '1cqOIF0MBJggXdUzJ_ll4GaW9jVcDmFPKyrsbWr3ofwk');
INSERT OR IGNORE INTO settings (key, value) VALUES ('expense_sheet_printing', '1OYLaUJukGnjvx5qmdHAaKWuVaCTscDsdffzCTqy64pA');
INSERT OR IGNORE INTO settings (key, value) VALUES ('expense_sheet_milling', '1fKlBKDQlOQgvqyEz-qVDWIE5oBKin40RSuRkWvrw-xA');
INSERT OR IGNORE INTO settings (key, value) VALUES ('expense_sheet_logistics', '1MtGMGzsSS-0ci1HVwdjXcapQQrkaC6qOdI8MdH2mTFM');
INSERT OR IGNORE INTO settings (key, value) VALUES ('expense_sheet_beznal', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('expense_sync_schedule', '30 7 * * *');
INSERT OR IGNORE INTO settings (key, value) VALUES ('office_photo_task_cron', '0 7 * * *');

INSERT OR IGNORE INTO settings (key, value) VALUES ('telegram_bot_token', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('telegram_chat_map', '{"okleyka.send":""}');
INSERT OR IGNORE INTO settings (key, value) VALUES ('telegram_webhook_secret', '');
