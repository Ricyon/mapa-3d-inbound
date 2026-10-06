CREATE TABLE IF NOT EXISTS inventory_positions (
  position TEXT PRIMARY KEY,
  items_json TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imported_at TEXT NOT NULL,
  source_file TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  position_count INTEGER NOT NULL DEFAULT 0,
  version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_import_history_date ON import_history(imported_at DESC);
