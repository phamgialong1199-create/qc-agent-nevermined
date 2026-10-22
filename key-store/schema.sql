CREATE TABLE IF NOT EXISTS inventory (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 code TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','sold')),
 order_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 sold_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_inventory_available ON inventory(status,id);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY,
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100),
 amount_cents INTEGER NOT NULL,
 currency TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','paid','delivered','failed','refunded')),
 payment_reference TEXT UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status,created_at);
