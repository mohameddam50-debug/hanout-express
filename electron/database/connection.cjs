const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');
let db;
function initDatabase() {
  const folder = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(folder, { recursive: true });
  db = new Database(path.join(folder, 'hanout-express.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name_ar TEXT NOT NULL, name_fr TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, barcode TEXT UNIQUE,
      category_id INTEGER, purchase_price REAL NOT NULL DEFAULT 0 CHECK(purchase_price>=0),
      sale_price REAL NOT NULL DEFAULT 0 CHECK(sale_price>=0), quantity REAL NOT NULL DEFAULT 0,
      min_quantity REAL NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT 'piece', image_path TEXT,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, movement_type TEXT NOT NULL,
      quantity REAL NOT NULL, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, address TEXT, balance REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, address TEXT, balance REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sales (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_no TEXT UNIQUE, customer_id INTEGER, subtotal REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0, paid REAL NOT NULL DEFAULT 0, payment_method TEXT NOT NULL DEFAULT 'cash', status TEXT NOT NULL DEFAULT 'completed', created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(customer_id) REFERENCES customers(id));
    CREATE TABLE IF NOT EXISTS sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity REAL NOT NULL, unit_price REAL NOT NULL, cost_price REAL NOT NULL, line_total REAL NOT NULL, FOREIGN KEY(sale_id) REFERENCES sales(id), FOREIGN KEY(product_id) REFERENCES products(id));
    CREATE TABLE IF NOT EXISTS sale_returns (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, return_no TEXT UNIQUE NOT NULL, total REAL NOT NULL, refund_amount REAL NOT NULL DEFAULT 0, refund_method TEXT NOT NULL DEFAULT 'cash', note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(sale_id) REFERENCES sales(id));
    CREATE TABLE IF NOT EXISTS sale_return_items (id INTEGER PRIMARY KEY AUTOINCREMENT, return_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity REAL NOT NULL, unit_price REAL NOT NULL, line_total REAL NOT NULL, FOREIGN KEY(return_id) REFERENCES sale_returns(id), FOREIGN KEY(product_id) REFERENCES products(id));
    CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER, reference TEXT, total REAL NOT NULL DEFAULT 0, paid REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(supplier_id) REFERENCES suppliers(id));
    CREATE TABLE IF NOT EXISTS purchase_items (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity REAL NOT NULL, unit_cost REAL NOT NULL, line_total REAL NOT NULL, FOREIGN KEY(purchase_id) REFERENCES purchases(id), FOREIGN KEY(product_id) REFERENCES products(id));
    CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, amount REAL NOT NULL CHECK(amount>=0), note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS cash_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, opening_amount REAL NOT NULL DEFAULT 0, closing_amount REAL, opened_at TEXT DEFAULT CURRENT_TIMESTAMP, closed_at TEXT);
    CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, related_type TEXT NOT NULL, related_id INTEGER NOT NULL, amount REAL NOT NULL, method TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS app_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'cashier', active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name_ar TEXT NOT NULL, name_fr TEXT NOT NULL,
      account_type TEXT NOT NULL CHECK(account_type IN ('asset','liability','equity','income','expense')),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entry_no TEXT NOT NULL UNIQUE, entry_date TEXT NOT NULL,
      description TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(created_by) REFERENCES app_users(id)
    );
    CREATE TABLE IF NOT EXISTS journal_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL, account_id INTEGER NOT NULL,
      debit REAL NOT NULL DEFAULT 0 CHECK(debit>=0), credit REAL NOT NULL DEFAULT 0 CHECK(credit>=0),
      note TEXT, FOREIGN KEY(entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    );
  `);
  // Safe additive migration: expense payment method is required for cash reconciliation.
  const expenseColumns = db.prepare('PRAGMA table_info(expenses)').all().map(x => x.name);
  if (!expenseColumns.includes('method')) db.exec("ALTER TABLE expenses ADD COLUMN method TEXT NOT NULL DEFAULT 'cash'");
  const count = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  if (!count) db.prepare('INSERT INTO categories (name_ar,name_fr) VALUES (?,?),(?,?),(?,?)').run('عام','Général','مواد غذائية','Épicerie','ملابس','Vêtements');
  db.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC); CREATE INDEX IF NOT EXISTS idx_sale_returns_sale_id ON sale_returns(sale_id); CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date DESC); CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id);');
  db.prepare("INSERT OR IGNORE INTO accounts(code,name_ar,name_fr,account_type) VALUES('604','تكلفة البضاعة المباعة','Coût des marchandises vendues','expense')").run();
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_source_unique ON journal_entries(source) WHERE source <> 'manual';");
  const accountCount = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
  if (!accountCount) {
    const insertAccount = db.prepare('INSERT INTO accounts(code,name_ar,name_fr,account_type) VALUES(?,?,?,?)');
    const seed = [
      ['101','رأس المال','Capital','equity'],['201','الموردون','Fournisseurs','liability'],['202','ديون الزبائن','Créances clients','asset'],
      ['301','المخزون','Stock','asset'],['401','الصندوق','Caisse','asset'],['402','البنك','Banque','asset'],
      ['501','مبيعات السلع','Ventes de marchandises','income'],['601','مشتريات السلع','Achats de marchandises','expense'],
      ['602','مصاريف التشغيل','Charges d’exploitation','expense'],['603','مرتجعات المبيعات','Retours sur ventes','income']
    ];
    const seedTx = db.transaction(() => seed.forEach(row => insertAccount.run(...row)));
    seedTx();
  }
  const userColumns = db.prepare('PRAGMA table_info(app_users)').all().map(x => x.name);
  if (!userColumns.includes('permissions')) db.exec("ALTER TABLE app_users ADD COLUMN permissions TEXT NOT NULL DEFAULT '{}'");
}
function getDatabase() { if (!db) throw new Error('Database is not initialized'); return db; }
module.exports = { initDatabase, getDatabase };
