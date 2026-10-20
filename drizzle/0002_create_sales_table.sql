CREATE TABLE sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  date TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'Loja',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
DROP TABLE IF EXISTS entries;
