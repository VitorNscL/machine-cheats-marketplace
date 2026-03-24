const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Database lives in the project root (same behavior as the original project)
const DB_PATH = path.join(__dirname, '..', 'database.db');

/**
 * @returns {sqlite3.Database}
 */
function openDb() {
  return new sqlite3.Database(DB_PATH);
}

/**
 * Promisified helpers
 */
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function tableHasColumn(db, tableName, columnName) {
  const cols = await all(db, `PRAGMA table_info(${tableName})`);
  return cols.some((c) => c.name === columnName);
}

async function tableExists(db, tableName) {
  const row = await get(
    db,
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [tableName]
  );
  return !!row;
}

async function migrateLegacyTables(db) {
  // Original project had simple users/products tables.
  // If they don't contain the new schema, we rename them to preserve data.
  const nowTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  if (await tableExists(db, 'users')) {
    const hasEmail = await tableHasColumn(db, 'users', 'email');
    const hasPasswordHash = await tableHasColumn(db, 'users', 'password_hash');
    const hasNick = await tableHasColumn(db, 'users', 'nick');
    if (!hasEmail || !hasPasswordHash || !hasNick) {
      await run(db, `ALTER TABLE users RENAME TO users_legacy_${nowTag}`);
    }
  }

  if (await tableExists(db, 'products')) {
    const hasSeller = await tableHasColumn(db, 'products', 'seller_id');
    const hasFileKey = await tableHasColumn(db, 'products', 'file_key');
    const hasPriceCents = await tableHasColumn(db, 'products', 'price_cents');
    if (!hasSeller || !hasFileKey || !hasPriceCents) {
      await run(db, `ALTER TABLE products RENAME TO products_legacy_${nowTag}`);
    }
  }
}

async function initSchema(db) {
  await run(db, 'PRAGMA foreign_keys = ON');

  await migrateLegacyTables(db);

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nick TEXT UNIQUE NOT NULL,
      display_name TEXT,
      bio TEXT,
      avatar_key TEXT,
      role TEXT NOT NULL DEFAULT 'USER',
      is_vip INTEGER NOT NULL DEFAULT 0,
      is_banned INTEGER NOT NULL DEFAULT 0,
      wallet_balance_cents INTEGER NOT NULL DEFAULT 0,
      seller_balance_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`
  );


  // ---- User schema extensions (CPF / escrow / compliance) ----
  if (!(await tableHasColumn(db, 'users', 'cpf'))) {
    await run(db, "ALTER TABLE users ADD COLUMN cpf TEXT");
  }
  if (!(await tableHasColumn(db, 'users', 'birth_date'))) {
    await run(db, "ALTER TABLE users ADD COLUMN birth_date TEXT");
  }
  if (!(await tableHasColumn(db, 'users', 'seller_pending_cents'))) {
    await run(db, "ALTER TABLE users ADD COLUMN seller_pending_cents INTEGER NOT NULL DEFAULT 0");
  }
  // Unique CPF (SQLite allows multiple NULLs)
  await run(db, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cpf ON users(cpf)');

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      stock INTEGER NOT NULL,
      image_key TEXT,
      file_key TEXT NOT NULL,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (seller_id) REFERENCES users(id)
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_id INTEGER NOT NULL,
      seller_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      gross_amount_cents INTEGER NOT NULL,
      fee_amount_cents INTEGER NOT NULL,
      net_amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (buyer_id) REFERENCES users(id),
      FOREIGN KEY (seller_id) REFERENCES users(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`
  );


  // ---- Orders schema extensions (escrow hold) ----
  if (!(await tableHasColumn(db, 'orders', 'hold_until'))) {
    await run(db, "ALTER TABLE orders ADD COLUMN hold_until TEXT");
  }
  if (!(await tableHasColumn(db, 'orders', 'released_at'))) {
    await run(db, "ALTER TABLE orders ADD COLUMN released_at TEXT");
  }
  if (!(await tableHasColumn(db, 'orders', 'refunded_at'))) {
    await run(db, "ALTER TABLE orders ADD COLUMN refunded_at TEXT");
  }

  // Back-compat: old 'PAID' orders become 'RELEASED' (funds already considered settled in old model)
  await run(db, "UPDATE orders SET status = 'RELEASED' WHERE status = 'PAID'");

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS product_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (author_id) REFERENCES users(id)
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS product_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (question_id) REFERENCES product_questions(id),
      FOREIGN KEY (author_id) REFERENCES users(id)
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS product_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      buyer_id INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      order_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      UNIQUE(product_id, buyer_id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (buyer_id) REFERENCES users(id),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS profile_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id INTEGER NOT NULL,
      to_user_id INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      order_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      UNIQUE(from_user_id, to_user_id),
      FOREIGN KEY (from_user_id) REFERENCES users(id),
      FOREIGN KEY (to_user_id) REFERENCES users(id),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      author_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (author_id) REFERENCES users(id)
    )`
  );


  // ---- Withdrawals (wallet -> PIX) ----
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL,
      gross_amount_cents INTEGER NOT NULL,
      fee_bps INTEGER NOT NULL,
      fee_amount_cents INTEGER NOT NULL,
      net_amount_cents INTEGER NOT NULL,
      pix_cpf TEXT NOT NULL,
      receipt_code TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      paid_at TEXT,
      FOREIGN KEY (seller_id) REFERENCES users(id)
    )`
  );

  // ---- Support chat (1:1 user <-> admin) ----
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS support_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS support_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES support_threads(id),
      FOREIGN KEY (author_id) REFERENCES users(id)
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS admin_impersonation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      target_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      ended_at TEXT,
      ip TEXT,
      user_agent TEXT,
      FOREIGN KEY (admin_id) REFERENCES users(id),
      FOREIGN KEY (target_user_id) REFERENCES users(id)
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      impersonator_admin_id INTEGER,
      impersonation_log_id INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (impersonator_admin_id) REFERENCES users(id),
      FOREIGN KEY (impersonation_log_id) REFERENCES admin_impersonation_logs(id)
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS platform_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      fee_bps INTEGER NOT NULL,
      vip_fee_bps INTEGER NOT NULL,
      platform_balance_cents INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      meta_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (admin_id) REFERENCES users(id)
    )`
  );

  // Basic indexes
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_chat_channel ON chat_messages(channel, created_at)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_withdrawals_seller ON withdrawals(seller_id, created_at)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_support_threads_status ON support_threads(status, updated_at)');
  await run(db, 'CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages(thread_id, created_at)');

  // Default platform settings
  const settings = await get(db, 'SELECT * FROM platform_settings WHERE id = 1');
  if (!settings) {
    const now = new Date().toISOString();
    // fee_bps: 10.00%, vip_fee_bps: 5.00%
    await run(
      db,
      'INSERT INTO platform_settings (id, fee_bps, vip_fee_bps, platform_balance_cents, updated_at) VALUES (1, 1000, 600, 0, ?)',
      [now]
    );
  }

  // If project was created with old default VIP fee (5%), bump to 6% (can be changed in admin).
  await run(db, "UPDATE platform_settings SET vip_fee_bps = 600 WHERE id = 1 AND vip_fee_bps = 500");

}

module.exports = {
  openDb,
  run,
  get,
  all,
  initSchema,
  DB_PATH,
};
