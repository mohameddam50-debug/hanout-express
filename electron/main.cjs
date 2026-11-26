const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID, scryptSync, randomBytes, timingSafeEqual } = require('node:crypto');
const Database = require('better-sqlite3');
const { initDatabase, getDatabase } = require('./database/connection.cjs');

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Convert a user-selected local calendar range to UTC SQL timestamps.
// SQLite CURRENT_TIMESTAMP stores UTC, so comparing it to local midnight
// would otherwise omit/include transactions around the local day boundary.
function localDateRangeToUtc(fromDate, toDate) {
  const parse = value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) throw new Error('نطاق التاريخ غير صحيح.');
    const [, ys, ms, ds] = match;
    const date = new Date(Number(ys), Number(ms) - 1, Number(ds), 0, 0, 0, 0);
    if (date.getFullYear() !== Number(ys) || date.getMonth() !== Number(ms) - 1 || date.getDate() !== Number(ds)) {
      throw new Error('نطاق التاريخ غير صحيح.');
    }
    return date;
  };
  const start = parse(fromDate);
  const end = parse(toDate);
  if (start > end) throw new Error('نطاق التاريخ غير صحيح.');
  const nextDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, 0, 0, 0, 0);
  const sqlUtc = date => date.toISOString().slice(0, 19).replace('T', ' ');
  return { from: sqlUtc(start), toExclusive: sqlUtc(nextDay) };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 760, minHeight: 600,
    title: 'HANOUT EXPRESS', backgroundColor: '#F7F8F8',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  if (!app.isPackaged) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '../dist/index.html'));
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const actual = scryptSync(String(password), salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return expectedBuffer.length === actual.length && timingSafeEqual(actual, expectedBuffer);
}
const authenticatedSenders = new Map();
function registerHandlers() {
  const db = getDatabase();
  // Post source-linked, balanced double-entry journal records in the same SQLite transaction.
  // source is deterministic so retrying an operation cannot duplicate its journal entry.
  function postJournal(source, description, rawLines, event) {
    if (db.prepare('SELECT id FROM journal_entries WHERE source=? LIMIT 1').get(source)) return null;
    const lines = rawLines.map(x => ({ code:String(x.code), debit:Math.round(Number(x.debit||0)*100)/100, credit:Math.round(Number(x.credit||0)*100)/100, note:x.note||null }))
      .filter(x => x.debit > 0 || x.credit > 0);
    if (lines.length < 2) return null;
    const debit = Math.round(lines.reduce((n,x)=>n+x.debit,0)*100)/100;
    const credit = Math.round(lines.reduce((n,x)=>n+x.credit,0)*100)/100;
    if (Math.abs(debit-credit) > 0.009) throw new Error(`تعذر إنشاء القيد المحاسبي للعملية ${source}: القيد غير متوازن.`);
    const account = db.prepare('SELECT id FROM accounts WHERE code=? AND active=1');
    const resolved = lines.map(x => { const a=account.get(x.code); if(!a) throw new Error(`الحساب المحاسبي ${x.code} غير موجود أو غير نشط.`); return {...x,account_id:a.id}; });
    const date = db.prepare("SELECT strftime('%Y-%m-%d','now','localtime') AS d").get().d;
    const userId = event ? authenticatedSenders.get(event.sender.id)?.id || null : null;
    const no = `AUTO-${date.replaceAll('-','')}-${randomUUID().slice(0,8).toUpperCase()}`;
    const entry = db.prepare('INSERT INTO journal_entries(entry_no,entry_date,description,source,created_by) VALUES(?,?,?,?,?)').run(no,date,String(description).slice(0,250),source,userId);
    const id=Number(entry.lastInsertRowid);
    const insert=db.prepare('INSERT INTO journal_lines(entry_id,account_id,debit,credit,note) VALUES(?,?,?,?,?)');
    for(const x of resolved) insert.run(id,x.account_id,x.debit,x.credit,x.note);
    return id;
  }
  const paymentAccount = method => method === 'cash' ? '401' : '402';
  const rawHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    if (['auth:status','auth:login','auth:logout'].includes(channel)) return rawHandle(channel, listener);
    return rawHandle(channel, (event, ...args) => {
      const session = authenticatedSenders.get(event.sender.id);
      if (!session) throw new Error('يجب تسجيل الدخول أولاً.');
      if ((channel.startsWith('auth:users:') || channel === 'audit:list') && session.role !== 'admin') throw new Error('هذه العملية متاحة لمدير النظام فقط.');
      const moduleMap = { products:'products', categories:'products', sales:'pos', purchases:'purchases', customers:'customers', suppliers:'suppliers', cash:'cash', expenses:'expenses', reports:'reports', backup:'settings', settings:'settings', audit:'audit', accounts:'accounting', journal:'accounting', accounting:'accounting' };
      const module = moduleMap[channel.split(':')[0]];
      if (module && channel !== 'settings:get' && session.role !== 'admin') {
        const cashierDefaults = ['dashboard','pos','products','customers'];
        const allowed = Object.prototype.hasOwnProperty.call(session.permissions, module)
          ? session.permissions[module] === true
          : session.role === 'manager' ? module !== 'users' : cashierDefaults.includes(module);
        if (!allowed) throw new Error('ليس لديك صلاحية لاستخدام هذا القسم.');
      }
      const result = listener(event, ...args);
      const auditMutation = /^(products|categories|sales|purchases|customers|suppliers|cash|expenses|settings|backup|auth:users|accounts|journal):/.test(channel) && !/:list$/.test(channel) && !/:get$/.test(channel) && !/:statement$/.test(channel) && !/:ledger$/.test(channel) && !/:current$/.test(channel) && !/:history$/.test(channel) && !/:select$/.test(channel) && !/:read$/.test(channel) && !/:restore$/.test(channel);
      const writeAudit = (value) => { if (auditMutation) { try { const safe = (v) => { if (Array.isArray(v)) return v.slice(0,30).map(safe); if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !/password|hash|token|secret/i.test(k)).map(([k,x]) => [k,safe(x)])); if (typeof v === 'string') return v.length > 160 ? v.slice(0,157)+'...' : v; return v; }; db.prepare('INSERT INTO audit_logs(user_id,action,details) VALUES(?,?,?)').run(session.id, channel, JSON.stringify(safe(args)).slice(0,2000)); } catch (e) { console.error('Audit log failed:', e.message); } } return value; };
      return result && typeof result.then === 'function' ? result.then(writeAudit) : writeAudit(result);
    });
  };
  // User accounts are stored locally; the first launch creates a one-time administrator.
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM app_users').get().n;
  if (!userCount) {
    db.prepare('INSERT INTO app_users(username,password_hash,role,active,permissions) VALUES(?,?,?,?,?)')
      .run('admin', hashPassword('admin12345'), 'admin', 1, '{}');
  }
  ipcMain.handle('auth:status', () => ({ configured: db.prepare('SELECT COUNT(*) AS n FROM app_users WHERE active=1').get().n > 0 }));
  ipcMain.handle('auth:logout', (event) => { const user=authenticatedSenders.get(event.sender.id); if(user) db.prepare('INSERT INTO audit_logs(user_id,action,details) VALUES(?,?,?)').run(user.id,'logout','Successful logout'); authenticatedSenders.delete(event.sender.id); return true; });
  ipcMain.handle('auth:login', (event, payload) => {
    const username = String(payload?.username || '').trim();
    const user = db.prepare('SELECT * FROM app_users WHERE username=? AND active=1').get(username);
    if (!user || !verifyPassword(payload?.password || '', user.password_hash)) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة.');
    db.prepare('INSERT INTO audit_logs(user_id,action,details) VALUES(?,?,?)').run(user.id, 'login', 'Successful login');
    const account={ id:user.id, username:user.username, role:user.role, permissions:JSON.parse(user.permissions || '{}') };
    authenticatedSenders.set(event.sender.id, account);
    event.sender.once('destroyed',()=>authenticatedSenders.delete(event.sender.id));
    return account;
  });
  ipcMain.handle('audit:list', (_event, limit=250) => db.prepare(`SELECT a.id,a.action,a.details,a.created_at,u.username FROM audit_logs a LEFT JOIN app_users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT ?`).all(Math.min(1000,Math.max(1,Number(limit)||250))));
  ipcMain.handle('auth:users:list', () => db.prepare('SELECT id,username,role,active,permissions FROM app_users ORDER BY id').all().map(u=>({...u,permissions:JSON.parse(u.permissions || '{}')})));
  ipcMain.handle('auth:users:create', (_event,payload) => {
    const username=String(payload?.username||'').trim(); const password=String(payload?.password||'');
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw new Error('اسم المستخدم يجب أن يكون 3 إلى 32 حرفاً إنجليزياً أو رقماً.');
    if (password.length < 8) throw new Error('كلمة المرور يجب ألا تقل عن 8 أحرف.');
    if (!['manager','cashier'].includes(payload?.role)) throw new Error('الدور المحدد غير صالح.');
    const permissions=JSON.stringify(payload.permissions && typeof payload.permissions==='object' ? payload.permissions : {});
    try { const r=db.prepare('INSERT INTO app_users(username,password_hash,role,active,permissions) VALUES(?,?,?,?,?)').run(username,hashPassword(password),payload.role,1,permissions); return {id:Number(r.lastInsertRowid)}; }
    catch(e){ if(String(e.message).includes('UNIQUE')) throw new Error('اسم المستخدم مستخدم بالفعل.'); throw e; }
  });
  ipcMain.handle('auth:users:update', (_event,payload) => {
    const id=Number(payload?.id); if(!Number.isInteger(id)||id<1) throw new Error('مستخدم غير صالح.');
    if(payload.role==='admin') throw new Error('لا يمكن إنشاء مدير إضافي من هذه الشاشة.');
    if(!['manager','cashier'].includes(payload.role)) throw new Error('الدور المحدد غير صالح.');
    const result=db.prepare("UPDATE app_users SET role=?,active=?,permissions=? WHERE id=? AND role<>'admin'").run(payload.role,payload.active?1:0,JSON.stringify(payload.permissions||{}),id);
    return result.changes>0;
  });
  ipcMain.handle('auth:users:delete', (_event,id) => {
    const userId=Number(id); if(!Number.isInteger(userId)||userId<1) throw new Error('مستخدم غير صالح.');
    const target=db.prepare('SELECT id,username,role FROM app_users WHERE id=?').get(userId);
    if(!target) throw new Error('المستخدم غير موجود.');
    if(target.role==='admin') throw new Error('لا يمكن حذف حساب مدير النظام.');
    const tx=db.transaction(()=>{ db.prepare('UPDATE journal_entries SET created_by=NULL WHERE created_by=?').run(userId); db.prepare('UPDATE audit_logs SET user_id=NULL WHERE user_id=?').run(userId); return db.prepare("DELETE FROM app_users WHERE id=? AND role<>'admin'").run(userId).changes>0; });
    return tx();
  });
  ipcMain.handle('auth:users:password', (_event,payload) => {
    const id=Number(payload?.id), password=String(payload?.password||'');
    if(password.length<8) throw new Error('كلمة المرور يجب ألا تقل عن 8 أحرف.');
    return db.prepare("UPDATE app_users SET password_hash=? WHERE id=?").run(hashPassword(password),id).changes>0;
  });

  ipcMain.handle('products:list', () => db.prepare(`SELECT p.*, c.name_ar AS category_ar, c.name_fr AS category_fr FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.active=1 ORDER BY p.id DESC`).all());
  ipcMain.handle('products:create', (_event, product) => {
    validateProduct(product);
    const create = db.transaction(() => {
      const result = db.prepare(`INSERT INTO products (name,barcode,category_id,purchase_price,sale_price,quantity,min_quantity,unit,image_path) VALUES (@name,@barcode,@category_id,@purchase_price,@sale_price,@quantity,@min_quantity,@unit,@image_path)`).run({ ...product, barcode: product.barcode || null, image_path: product.image_path || null });
      if (Number(product.quantity) !== 0) db.prepare(`INSERT INTO stock_movements (product_id,movement_type,quantity,note) VALUES (?,'opening',?,'Opening balance')`).run(result.lastInsertRowid, Number(product.quantity));
      return { id: Number(result.lastInsertRowid) };
    });
    return create();
  });
  ipcMain.handle('products:update', (_event, product) => {
    validateProduct(product);
    const result = db.prepare(`UPDATE products SET name=@name,barcode=@barcode,category_id=@category_id,purchase_price=@purchase_price,sale_price=@sale_price,min_quantity=@min_quantity,unit=@unit,image_path=@image_path WHERE id=@id AND active=1`).run({ ...product, barcode: product.barcode || null, image_path: product.image_path || null });
    return result.changes > 0;
  });
  // Archive instead of hard-delete: retain stock movement and accounting history.
  ipcMain.handle('products:delete', (_event, id) => db.prepare('UPDATE products SET active=0 WHERE id=? AND active=1').run(Number(id)).changes > 0);
  ipcMain.handle('categories:list', () => db.prepare('SELECT * FROM categories ORDER BY name_ar').all());
  ipcMain.handle('categories:create', (_event, category) => {
    if (!category || !category.name_ar?.trim() || !category.name_fr?.trim()) throw new Error('Category names are required in Arabic and French');
    const result = db.prepare('INSERT INTO categories(name_ar,name_fr) VALUES(?,?)').run(category.name_ar.trim(), category.name_fr.trim());
    return { id: Number(result.lastInsertRowid) };
  });
  ipcMain.handle('categories:update', (_event, category) => {
    if (!category || !Number.isInteger(Number(category.id)) || !category.name_ar?.trim() || !category.name_fr?.trim()) throw new Error('Invalid category');
    return db.prepare('UPDATE categories SET name_ar=?,name_fr=? WHERE id=?').run(category.name_ar.trim(), category.name_fr.trim(), Number(category.id)).changes > 0;
  });
  ipcMain.handle('categories:delete', (_event, id) => {
    const used = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id=? AND active=1').get(Number(id)).n;
    if (used) throw new Error('لا يمكن حذف تصنيف مرتبط بمنتجات. انقل المنتجات إلى تصنيف آخر أولاً.');
    return db.prepare('DELETE FROM categories WHERE id=?').run(Number(id)).changes > 0;
  });
  ipcMain.handle('printers:list', async (event) => {
    const win=event.sender;
    return (await win.getPrintersAsync()).map(p=>({name:p.name,displayName:p.displayName||p.name,isDefault:!!p.isDefault,status:p.status}));
  });
  async function createReceiptWindow(html, { show = false, render = false, parent = null } = {}) {
    // Validate the actual HTML separately so the UI receives a useful error
    // instead of the old generic message. Receipts may contain an embedded logo.
    if (typeof html !== 'string') {
      throw new Error(`بيانات الفاتورة غير صالحة: HTML_TYPE_INVALID (${typeof html}).`);
    }
    if (!html.trim()) throw new Error('محتوى الفاتورة فارغ. أعد فتح الفاتورة ثم حاول مجدداً.');
    if (html.length > 15_000_000) {
      throw new Error(`حجم الفاتورة كبير جداً (${html.length} حرف). قلّل حجم صورة الشعار ثم أعد المحاولة.`);
    }

    // Loading a long data: URL is unreliable on Windows/Chromium. A temporary
    // UTF-8 HTML file avoids URL-length limits and preserves Arabic characters.
    const receiptTempPath = path.join(app.getPath('temp'), `hanout-receipt-${randomUUID()}.html`);
    fs.writeFileSync(receiptTempPath, html, 'utf8');
    const printWindow = new BrowserWindow({
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      show: false, width: 900, height: 1200, autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    try {
      printWindow.__hanoutReceiptTempPath = receiptTempPath;
      await printWindow.loadFile(receiptTempPath);
      const ready = await printWindow.webContents.executeJavaScript(`(async () => {
        if (document.readyState !== 'complete') await new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        await Promise.all(Array.from(document.images).map(img => img.complete ? Promise.resolve() : new Promise(resolve => {
          img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); setTimeout(resolve, 4000);
        })));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const receipt = document.querySelector('.receipt-print');
        const rect = receipt && receipt.getBoundingClientRect();
        return { hasReceipt: !!receipt, width: rect ? Math.max(rect.width, receipt.scrollWidth) : 0, height: rect ? Math.max(rect.height, receipt.scrollHeight) : 0, text: (document.body.innerText || '').trim() };
      })()`);
      if (!ready?.hasReceipt || ready.width < 10 || ready.height < 10 || !ready.text) {
        throw new Error('تعذر تحميل محتوى الفاتورة للطباعة.');
      }
      if (show) {
        printWindow.show();
        printWindow.focus();
        await new Promise(resolve => setTimeout(resolve, 300));
      } else if (render) {
        // Chromium may return a blank PDF from a never-shown window on some Windows GPU setups.
        printWindow.showInactive();
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      return printWindow;
    } catch (error) {
      if (!printWindow.isDestroyed()) printWindow.close();
      try { fs.rmSync(receiptTempPath, { force: true }); } catch {}
      throw error;
    }
  }

  function closeReceiptWindow(printWindow) {
    const tempPath = printWindow?.__hanoutReceiptTempPath;
    if (printWindow && !printWindow.isDestroyed()) printWindow.close();
    if (tempPath) {
      try { fs.rmSync(tempPath, { force: true }); } catch {}
    }
  }

  function validatedReceiptPageSize(pageSize) {
    const size = pageSize && pageSize.pageSize ? pageSize.pageSize : pageSize;
    if (!size || !Number.isFinite(Number(size.width)) || !Number.isFinite(Number(size.height))) return undefined;
    const width = Math.round(Number(size.width)), height = Math.round(Number(size.height));
    if (width < 40000 || width > 250000 || height < 50000 || height > 500000) throw new Error('حجم ورق الفاتورة غير صالح.');
    return { width, height };
  }
  ipcMain.handle('printers:print', async (event, payload) => {
    if (!authenticatedSenders.has(event.sender.id)) throw new Error('يجب تسجيل الدخول أولاً.');
    const selected = db.prepare("SELECT value FROM settings WHERE key='printer_name'").get()?.value || '';
    const available = await event.sender.getPrintersAsync();
    const chosen = selected
      ? available.find(p => p.name === selected)
      : available.find(p => p.isDefault);
    if (selected && !chosen) throw new Error('الطابعة المختارة غير متصلة أو لم تعد مثبتة. افتح إعدادات الطابعة واختر طابعة متاحة.');
    if (!chosen) throw new Error('لم يتم العثور على طابعة افتراضية. اختر طابعة من إعدادات HANOUT EXPRESS أولاً.');
    const pageSize = validatedReceiptPageSize(payload?.pageSize);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const printWindow = await createReceiptWindow(payload?.html, { show: false, render: true, parent: owner });
    try {
      // Direct print to the printer selected in HANOUT EXPRESS. The in-app
      // receipt preview remains the user's confirmation step; no Windows dialog
      // is opened, avoiding the failing dialog-backed print path.
      const printResult = await new Promise((resolve, reject) => {
        printWindow.webContents.print({
          silent: true,
          deviceName: chosen.name,
          printBackground: true,
          margins: { marginType: 'none' },
          ...(pageSize ? { pageSize } : {})
        }, (success, failureReason) => {
          if (success) resolve({ success: true, printer: chosen.name });
          else reject(new Error(failureReason || `تعذرت الطباعة على ${chosen.displayName || chosen.name}. تحقق من حالة الطابعة وحجم الورق المحدد في تعريفها.`));
        });
      });
      return printResult;
    } finally { closeReceiptWindow(printWindow); }
  });

  // Export a standalone receipt document so application layout and print CSS cannot blank the PDF.
  ipcMain.handle('receipts:export-pdf', async (event, invoiceNo, payload) => {
    if (!authenticatedSenders.has(event.sender.id)) throw new Error('يجب تسجيل الدخول أولاً.');
    const picked = await dialog.showSaveDialog({
      title: 'تصدير الفاتورة PDF',
      defaultPath: `HANOUT-EXPRESS-${String(invoiceNo || localDateString()).replace(/[^A-Za-z0-9_-]/g, '-')}.pdf`,
      buttonLabel: 'حفظ PDF', filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (picked.canceled || !picked.filePath) return { canceled: true };
    let pageSize = validatedReceiptPageSize(payload?.pageSize);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const printWindow = await createReceiptWindow(payload?.html, { show: true, render: true, parent: owner });
    try {
      // Measure the actual standalone receipt document after fonts and images
      // have loaded. Preview container dimensions can be constrained by the UI;
      // using those dimensions produced incorrect/blank thermal PDFs.
      printWindow.focus();
      await new Promise(resolve => setTimeout(resolve, 350));
      const measured = await printWindow.webContents.executeJavaScript(`(() => { const el=document.querySelector('.receipt-print'); if(!el) return null; const r=el.getBoundingClientRect(); return {width:Math.max(r.width,el.scrollWidth),height:Math.max(r.height,el.scrollHeight)}; })()`);
      if (!measured || measured.width < 10 || measured.height < 10) throw new Error('تعذر قياس محتوى الفاتورة قبل إنشاء PDF.');
      if (pageSize && Number(payload?.pageSize?.height) !== 297000) {
        const heightMicrons = Math.max(50000, Math.min(500000, Math.ceil(measured.height * 25.4 / 96 * 1000) + 3000));
        pageSize = { width: pageSize.width, height: heightMicrons };
      }
      const pdf = await printWindow.webContents.printToPDF({
        printBackground: true,
        ...(pageSize ? { pageSize } : {}),
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        printSelectionOnly: false,
        scale: 1
      });
      if (!pdf || pdf.length < 500 || pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('لم يتمكن Chromium من إنشاء مستند PDF صالح من محتوى الفاتورة.');
      fs.writeFileSync(picked.filePath, pdf);
      return { canceled: false, path: picked.filePath };
    } finally { closeReceiptWindow(printWindow); }
  });

  // Full local backup: SQLite database plus managed product/shop images.
  ipcMain.handle('backup:create', async () => {
    const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(picked.filePaths[0], `HANOUT-EXPRESS-backup-${stamp}`);
    fs.mkdirSync(target, { recursive: true });
    const databasePath = path.join(target, 'database.sqlite');
    db.pragma('wal_checkpoint(TRUNCATE)');
    await db.backup(databasePath);
    const imagesPath = path.join(app.getPath('userData'), 'images');
    const backupImagesPath = path.join(target, 'images');
    // Always include the images folder so restore can reproduce an empty image state too.
    fs.mkdirSync(backupImagesPath, { recursive: true });
    if (fs.existsSync(imagesPath)) fs.cpSync(imagesPath, backupImagesPath, { recursive: true });
    fs.writeFileSync(path.join(target, 'BACKUP-INFO.txt'), `HANOUT EXPRESS backup\nCreated: ${new Date().toISOString()}\nContains: database.sqlite and images/ (if present).\nKeep this folder in a safe place.`);
    return { canceled: false, path: target };
  });
  ipcMain.handle('backup:restore', async () => {
    const picked = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
    const source = path.join(picked.filePaths[0], 'database.sqlite');
    if (!fs.existsSync(source)) throw new Error('لم نعثر على database.sqlite داخل مجلد النسخة الاحتياطية.');
    const check = new Database(source, { readonly: true, fileMustExist: true });
    try {
      const result = check.pragma('integrity_check', { simple: true });
      if (result !== 'ok') throw new Error('ملف قاعدة البيانات غير سليم، لم يتم استرجاعه.');
      const tables = check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='products'").get().n;
      if (!tables) throw new Error('الملف المحدد لا يبدو نسخة من HANOUT EXPRESS.');
    } finally { check.close(); }
    const userData = app.getPath('userData');
    const dataFolder = path.join(userData, 'data');
    fs.mkdirSync(dataFolder, { recursive: true });
    const liveDatabase = path.join(dataFolder, 'hanout-express.sqlite');
    const targetImages = path.join(userData, 'images');
    const token = randomUUID();
    const stagedDatabase = path.join(dataFolder, `.restore-${token}.sqlite`);
    const previousDatabase = path.join(dataFolder, `.previous-${token}.sqlite`);
    const stagedImages = path.join(userData, `.images-restore-${token}`);
    const previousImages = path.join(userData, `.images-previous-${token}`);
    let databaseClosed = false;
    let databaseMoved = false;
    let databaseInstalled = false;
    let imagesMoved = false;
    let imagesInstalled = false;
    try {
      // Prepare and validate every restored asset before touching the live data.
      fs.copyFileSync(source, stagedDatabase);
      const stagedCheck = new Database(stagedDatabase, { readonly: true, fileMustExist: true });
      try {
        if (stagedCheck.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('تعذر التحقق من قاعدة البيانات المستعادة.');
      } finally { stagedCheck.close(); }
      const sourceImages = path.join(picked.filePaths[0], 'images');
      if (fs.existsSync(sourceImages)) {
        if (!fs.statSync(sourceImages).isDirectory()) throw new Error('مجلد صور النسخة الاحتياطية غير صالح.');
        fs.cpSync(sourceImages, stagedImages, { recursive: true });
      } else fs.mkdirSync(stagedImages, { recursive: true });

      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      databaseClosed = true;
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = `${liveDatabase}${suffix}`;
        if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
      }
      if (fs.existsSync(liveDatabase)) { fs.renameSync(liveDatabase, previousDatabase); databaseMoved = true; }
      fs.renameSync(stagedDatabase, liveDatabase);
      databaseInstalled = true;
      if (fs.existsSync(targetImages)) { fs.renameSync(targetImages, previousImages); imagesMoved = true; }
      fs.renameSync(stagedImages, targetImages);
      imagesInstalled = true;

      // Installation is complete. Cleanup is best-effort and must never trigger
      // rollback after one of the rollback copies has already been removed.
      for (const [label, target, options] of [
        ['previous database', previousDatabase, { force: true }],
        ['previous images', previousImages, { recursive: true, force: true }]
      ]) {
        try {
          if ((label === 'previous database' && databaseMoved) || (label === 'previous images' && imagesMoved)) fs.rmSync(target, options);
        } catch (cleanupError) {
          console.warn(`Could not remove ${label} after successful restore:`, cleanupError.message);
        }
      }
    } catch (error) {
      // If any filesystem operation fails, put the original database and images back.
      try {
        if (databaseInstalled && fs.existsSync(liveDatabase)) fs.rmSync(liveDatabase, { force: true });
        if (databaseMoved && fs.existsSync(previousDatabase)) fs.renameSync(previousDatabase, liveDatabase);
        if (imagesInstalled && fs.existsSync(targetImages)) fs.rmSync(targetImages, { recursive: true, force: true });
        if (imagesMoved && fs.existsSync(previousImages)) fs.renameSync(previousImages, targetImages);
      } catch (rollbackError) {
        console.error('Restore rollback failed:', rollbackError);
      }
      for (const temp of [stagedDatabase, stagedImages]) {
        try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
      }
      if (databaseClosed) { app.relaunch(); app.exit(1); }
      throw new Error(`فشل استرجاع النسخة الاحتياطية، وتمت محاولة الحفاظ على البيانات السابقة: ${error.message}`);
    }
    app.relaunch();
    app.exit(0);
    return { canceled: false, restarting: true };
  });
  ipcMain.handle('settings:get', () => Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(row => [row.key, row.value])));
  ipcMain.handle('settings:update', (_event, values) => {
    const allowed = ['shop_name','shop_phone','shop_address','shop_footer','shop_logo_path','receipt_size','currency','printer_name'];
    if (!values || typeof values !== 'object') throw new Error('Invalid settings');
    const save = db.transaction(() => {
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(values, key)) {
          const value = String(values[key] ?? '').trim();
          if (key === 'receipt_size' && !['58mm','80mm','A4'].includes(value)) throw new Error('Invalid receipt paper size');
          db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
        }
      }
    });
    save();
    return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(row => [row.key, row.value]));
  });

  // Customers, customer balances and payment allocation.
  ipcMain.handle('customers:list', () => db.prepare(`
    SELECT c.*, COALESCE((SELECT SUM(s.total-s.paid) FROM sales s WHERE s.customer_id=c.id),0) AS balance,
      (SELECT COUNT(*) FROM sales s WHERE s.customer_id=c.id) AS sales_count
    FROM customers c ORDER BY c.name COLLATE NOCASE
  `).all());
  ipcMain.handle('customers:create', (_event, payload) => {
    if (!payload || !String(payload.name || '').trim()) throw new Error('اسم الزبون مطلوب.');
    const result = db.prepare('INSERT INTO customers(name,phone,address,balance) VALUES(?,?,?,0)')
      .run(String(payload.name).trim(), String(payload.phone||'').trim()||null, String(payload.address||'').trim()||null);
    return { id: Number(result.lastInsertRowid) };
  });
  ipcMain.handle('customers:update', (_event, payload) => {
    if (!payload || !Number.isInteger(Number(payload.id)) || !String(payload.name || '').trim()) throw new Error('بيانات الزبون غير صالحة.');
    return db.prepare('UPDATE customers SET name=?,phone=?,address=? WHERE id=?')
      .run(String(payload.name).trim(), String(payload.phone||'').trim()||null, String(payload.address||'').trim()||null, Number(payload.id)).changes > 0;
  });
  ipcMain.handle('customers:delete', (_event, id) => {
    const used = db.prepare('SELECT COUNT(*) AS n FROM sales WHERE customer_id=?').get(Number(id)).n;
    if (used) throw new Error('لا يمكن حذف زبون لديه فواتير. احتفظ بسجله المحاسبي.');
    return db.prepare('DELETE FROM customers WHERE id=?').run(Number(id)).changes > 0;
  });
  ipcMain.handle('customers:pay', (event, payload) => {
    const customerId=Number(payload?.customer_id), amount=Number(payload?.amount);
    if(!Number.isInteger(customerId)||customerId<=0||!Number.isFinite(amount)||amount<=0) throw new Error('بيانات التسديد غير صالحة.');
    return db.transaction(()=>{
      const customer=db.prepare('SELECT id FROM customers WHERE id=?').get(customerId);
      if(!customer) throw new Error('الزبون غير موجود.');
      const balance=Number(db.prepare('SELECT COALESCE(SUM(total-paid),0) AS balance FROM sales WHERE customer_id=?').get(customerId).balance);
      if(amount>balance+0.00001) throw new Error('مبلغ التسديد أكبر من الدين المتبقي.');
      const method=['cash','card','transfer'].includes(payload.method)?payload.method:'cash';
      const paymentResult=db.prepare(`INSERT INTO payments(related_type,related_id,amount,method) VALUES('customer_payment',?,?,?)`).run(customerId,amount,method);
      postJournal(`customer_payment:${Number(paymentResult.lastInsertRowid)}`, 'تسديد دين زبون', [{code:paymentAccount(method),debit:amount},{code:'202',credit:amount}], event);
      let remaining=amount;
      const open=db.prepare('SELECT id,total,paid FROM sales WHERE customer_id=? AND total>paid ORDER BY id').all(customerId);
      const update=db.prepare('UPDATE sales SET paid=paid+? WHERE id=?');
      for(const inv of open){if(remaining<=0.00001)break;const due=Number(inv.total)-Number(inv.paid);const part=Math.min(due,remaining);update.run(part,inv.id);remaining-=part;}
      return {balance:Math.max(0,Math.round((balance-amount)*100)/100)};
    })();
  });
  ipcMain.handle('customers:statement', (_event, customerId) => {
    const id=Number(customerId), customer=db.prepare('SELECT * FROM customers WHERE id=?').get(id);
    if(!customer) throw new Error('الزبون غير موجود.');
    const rows=db.prepare(`
      SELECT id,invoice_no AS label,(subtotal-discount) AS debit,0 AS credit,created_at,'sale' AS kind FROM sales WHERE customer_id=?
      UNION ALL
      SELECT p.id,'أداء عند البيع' AS label,0 AS debit,p.amount AS credit,p.created_at,'payment' AS kind
        FROM payments p JOIN sales s ON s.id=p.related_id WHERE p.related_type='sale' AND s.customer_id=?
      UNION ALL
      SELECT id,'تسديد من الزبون' AS label,0 AS debit,amount AS credit,created_at,'payment' AS kind FROM payments WHERE related_type='customer_payment' AND related_id=?
      UNION ALL
      SELECT r.id,r.return_no AS label,0 AS debit,r.total AS credit,r.created_at,'return' AS kind FROM sale_returns r JOIN sales s ON s.id=r.sale_id WHERE s.customer_id=?
      UNION ALL
      SELECT p.id,'مبلغ مسترجع للزبون' AS label,p.amount AS debit,0 AS credit,p.created_at,'refund' AS kind FROM payments p JOIN sales s ON s.id=p.related_id WHERE p.related_type='sale_refund' AND s.customer_id=?
      ORDER BY created_at,id
    `).all(id,id,id,id,id);
    const balance=Number(db.prepare('SELECT COALESCE(SUM(total-paid),0) AS n FROM sales WHERE customer_id=?').get(id).n);
    return {customer,balance,rows};
  });

  // Suppliers and purchases
  ipcMain.handle('suppliers:list', () => db.prepare(`SELECT s.*, COALESCE((SELECT SUM(p.total-p.paid) FROM purchases p WHERE p.supplier_id=s.id),0) AS balance FROM suppliers s ORDER BY s.name COLLATE NOCASE`).all());
  ipcMain.handle('suppliers:create', (_event, payload) => {
    if (!payload || !String(payload.name || '').trim()) throw new Error('اسم المورد مطلوب.');
    const result = db.prepare('INSERT INTO suppliers(name,phone,address,balance) VALUES(?,?,?,0)').run(String(payload.name).trim(), String(payload.phone||'').trim()||null, String(payload.address||'').trim()||null);
    return { id: Number(result.lastInsertRowid) };
  });
  ipcMain.handle('suppliers:update', (_event, payload) => {
    if (!payload || !Number.isInteger(Number(payload.id)) || !String(payload.name || '').trim()) throw new Error('بيانات المورد غير صالحة.');
    return db.prepare('UPDATE suppliers SET name=?,phone=?,address=? WHERE id=?').run(String(payload.name).trim(), String(payload.phone||'').trim()||null, String(payload.address||'').trim()||null, Number(payload.id)).changes > 0;
  });
  ipcMain.handle('suppliers:delete', (_event, id) => {
    const used = db.prepare('SELECT COUNT(*) AS n FROM purchases WHERE supplier_id=?').get(Number(id)).n;
    if (used) throw new Error('لا يمكن حذف مورد لديه فواتير شراء. احتفظ بسجله المحاسبي.');
    return db.prepare('DELETE FROM suppliers WHERE id=?').run(Number(id)).changes > 0;
  });
  ipcMain.handle('purchases:list', (_event, limit=100) => {
    const safeLimit = Math.min(500, Math.max(1, Number(limit)||100));
    return db.prepare(`SELECT p.*, s.name AS supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id ORDER BY p.id DESC LIMIT ?`).all(safeLimit);
  });
  ipcMain.handle('purchases:get', (_event, id) => {
    const purchase = db.prepare('SELECT p.*,s.name AS supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=?').get(Number(id));
    if (!purchase) throw new Error('فاتورة الشراء غير موجودة.');
    const items = db.prepare(`SELECT pi.*,pr.name,pr.unit FROM purchase_items pi JOIN products pr ON pr.id=pi.product_id WHERE pi.purchase_id=? ORDER BY pi.id`).all(purchase.id);
    return {...purchase,items};
  });
  ipcMain.handle('purchases:create', (event, payload) => {
    if (!payload || !Number.isInteger(Number(payload.supplier_id)) || !Array.isArray(payload.items) || !payload.items.length) throw new Error('اختر المورد وأضف منتجاً واحداً على الأقل.');
    const paid = Number(payload.paid||0);
    if (!Number.isFinite(paid) || paid < 0) throw new Error('مبلغ الأداء غير صالح.');
    const normalized = payload.items.map(x=>({product_id:Number(x.product_id),quantity:Number(x.quantity),unit_cost:Number(x.unit_cost)}));
    for (const x of normalized) if (!Number.isInteger(x.product_id)||x.product_id<=0||!Number.isFinite(x.quantity)||x.quantity<=0||!Number.isFinite(x.unit_cost)||x.unit_cost<0) throw new Error('تحقق من المنتجات والكميات وأسعار الشراء.');
    const tx = db.transaction(()=>{
      const supplier=db.prepare('SELECT id FROM suppliers WHERE id=?').get(Number(payload.supplier_id));
      if(!supplier) throw new Error('المورد غير موجود.');
      const lines=[]; let total=0;
      for(const x of normalized){
        const product=db.prepare('SELECT id,name,quantity,purchase_price,unit,active FROM products WHERE id=?').get(x.product_id);
        if(!product||product.active!==1) throw new Error('يوجد منتج غير موجود أو مؤرشف.');
        if(product.unit==='service') throw new Error(`لا يمكن إضافة الخدمة إلى المخزون: ${product.name}`);
        const line=Math.round(x.quantity*x.unit_cost*100)/100; total+=line; lines.push({product,...x,line});
      }
      total=Math.round(total*100)/100;
      if(paid>total+0.00001) throw new Error('الأداء لا يمكن أن يتجاوز مجموع الفاتورة.');
      const ref=String(payload.reference||'').trim() || `ACH-${localDateString().replaceAll('-','')}-${randomUUID().slice(0,6).toUpperCase()}`;
      const result=db.prepare('INSERT INTO purchases(supplier_id,reference,total,paid) VALUES(?,?,?,?)').run(Number(payload.supplier_id),ref,total,paid);
      const purchaseId=Number(result.lastInsertRowid);
      const addItem=db.prepare('INSERT INTO purchase_items(purchase_id,product_id,quantity,unit_cost,line_total) VALUES(?,?,?,?,?)');
      const updateProduct=db.prepare('UPDATE products SET quantity=quantity+?,purchase_price=? WHERE id=?');
      const movement=db.prepare(`INSERT INTO stock_movements(product_id,movement_type,quantity,note) VALUES(?,'purchase',?,?)`);
      const stockTotals=new Map();
      for(const line of lines){
        addItem.run(purchaseId,line.product_id,line.quantity,line.unit_cost,line.line);
        const current=stockTotals.get(line.product_id)||{product:line.product,quantity:0,costTotal:0};
        current.quantity+=line.quantity;
        current.costTotal+=line.quantity*line.unit_cost;
        stockTotals.set(line.product_id,current);
        movement.run(line.product_id,line.quantity,`Purchase ${ref}`);
      }
      // Update each product once, so duplicate invoice lines with different costs
      // produce the correct weighted average based on the complete purchase.
      for(const [productId,entry] of stockTotals){
        const oldQty=Number(entry.product.quantity), newQty=oldQty+entry.quantity;
        const avg=newQty>0?((oldQty*Number(entry.product.purchase_price)+entry.costTotal)/newQty):0;
        updateProduct.run(entry.quantity,Math.round(avg*10000)/10000,productId);
      }
      const method=['cash','card','transfer'].includes(payload.payment_method)?payload.payment_method:'cash';
      if(paid>0) db.prepare(`INSERT INTO payments(related_type,related_id,amount,method) VALUES('purchase',?,?,?)`).run(purchaseId,paid,method);
      postJournal(`purchase:${purchaseId}`, `فاتورة شراء ${ref}`, [
        {code:'301',debit:total},{code:paymentAccount(method),credit:paid},{code:'201',credit:Math.max(0,Math.round((total-paid)*100)/100)}
      ], event);
      return {id:purchaseId,reference:ref,total,paid,balance:Math.round((total-paid)*100)/100};
    });
    return tx();
  });
  ipcMain.handle('suppliers:pay', (event, payload) => {
    const supplierId=Number(payload?.supplier_id), amount=Number(payload?.amount);
    if(!Number.isInteger(supplierId)||supplierId<=0||!Number.isFinite(amount)||amount<=0) throw new Error('بيانات التسديد غير صالحة.');
    return db.transaction(()=>{
      const supplier=db.prepare('SELECT id FROM suppliers WHERE id=?').get(supplierId);
      if(!supplier) throw new Error('المورد غير موجود.');
      const balance=Number(db.prepare('SELECT COALESCE(SUM(total-paid),0) AS balance FROM purchases WHERE supplier_id=?').get(supplierId).balance);
      if(amount>balance+0.00001) throw new Error('مبلغ التسديد أكبر من الدين المتبقي.');
      const method=['cash','card','transfer'].includes(payload.method)?payload.method:'cash';
      const paymentResult=db.prepare(`INSERT INTO payments(related_type,related_id,amount,method) VALUES('supplier_payment',?,?,?)`).run(supplierId,amount,method);
      postJournal(`supplier_payment:${Number(paymentResult.lastInsertRowid)}`, 'تسديد دين مورد', [{code:'201',debit:amount},{code:paymentAccount(method),credit:amount}], event);
      // Allocate payment to oldest unpaid purchase invoices first.
      let remaining=amount;
      const open=db.prepare('SELECT id,total,paid FROM purchases WHERE supplier_id=? AND total>paid ORDER BY id').all(supplierId);
      const update=db.prepare('UPDATE purchases SET paid=paid+? WHERE id=?');
      for(const inv of open){if(remaining<=0.00001)break;const due=Number(inv.total)-Number(inv.paid);const part=Math.min(due,remaining);update.run(part,inv.id);remaining-=part;}
      return {balance:Math.max(0,Math.round((balance-amount)*100)/100)};
    })();
  });
  ipcMain.handle('suppliers:statement', (_event, supplierId) => {
    const id=Number(supplierId);
    const supplier=db.prepare('SELECT * FROM suppliers WHERE id=?').get(id);
    if(!supplier) throw new Error('المورد غير موجود.');
    const rows=db.prepare(`SELECT id,reference AS label,total AS debit,0 AS credit,created_at,'purchase' AS kind FROM purchases WHERE supplier_id=?
      UNION ALL SELECT id,'أداء عند الشراء' AS label,0 AS debit,amount AS credit,created_at,'payment' AS kind FROM payments WHERE related_type='purchase' AND related_id IN (SELECT id FROM purchases WHERE supplier_id=?)
      UNION ALL SELECT id,'تسديد للمورد' AS label,0 AS debit,amount AS credit,created_at,'payment' AS kind FROM payments WHERE related_type='supplier_payment' AND related_id=? ORDER BY created_at,id`).all(id,id,id);
    const balance=Number(db.prepare('SELECT COALESCE(SUM(total-paid),0) AS n FROM purchases WHERE supplier_id=?').get(id).n);
    return {supplier,balance,rows};
  });

  ipcMain.handle('sales:list', (_event, limit = 20) => {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    return db.prepare(`SELECT s.id, s.invoice_no, s.subtotal, s.discount, s.total, s.paid,
      s.payment_method, s.status, s.created_at, s.customer_id, c.name AS customer_name,
      (s.total-s.paid) AS due, COUNT(si.id) AS items_count,
      COALESCE((SELECT SUM(r.total) FROM sale_returns r WHERE r.sale_id=s.id),0) AS returned_total
      FROM sales s LEFT JOIN sale_items si ON si.sale_id=s.id LEFT JOIN customers c ON c.id=s.customer_id
      GROUP BY s.id ORDER BY s.id DESC LIMIT ?`).all(safeLimit);
  });
  ipcMain.handle('sales:get', (_event, id) => {
    const sale = db.prepare('SELECT s.*, c.name AS customer_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=?').get(Number(id));
    if (!sale) throw new Error('الفاتورة غير موجودة.');
    const items = db.prepare(`SELECT si.product_id, COALESCE(p.name, 'منتج محذوف') AS name, p.unit, si.quantity, si.unit_price, si.line_total,
      COALESCE((SELECT SUM(ri.quantity) FROM sale_return_items ri JOIN sale_returns r ON r.id=ri.return_id WHERE r.sale_id=si.sale_id AND ri.product_id=si.product_id),0) AS returned_quantity
      FROM sale_items si LEFT JOIN products p ON p.id=si.product_id WHERE si.sale_id=? ORDER BY si.id`).all(sale.id);
    const returns=db.prepare('SELECT id,return_no,total,refund_amount,refund_method,note,created_at FROM sale_returns WHERE sale_id=? ORDER BY id DESC').all(sale.id);
    const originalPaid=Number(db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE related_type='sale' AND related_id=?").get(sale.id).n);
    const originalTotal=Math.max(0,Number(sale.subtotal)-Number(sale.discount));
    return { ...sale, total:originalTotal, paid:originalPaid, due: Math.max(0, Math.round((originalTotal-originalPaid)*100)/100), items:items.map(x=>({...x,remaining_quantity:Math.max(0,Number(x.quantity)-Number(x.returned_quantity))})), returns };
  });
  function processSaleReturn(saleId, requestedItems, refundMethod, note, event) {
    const method=['cash','card','transfer'].includes(refundMethod)?refundMethod:'cash';
    if(!Array.isArray(requestedItems)||!requestedItems.length) throw new Error('حدد منتجاً واحداً على الأقل للإرجاع.');
    const sale=db.prepare('SELECT * FROM sales WHERE id=?').get(Number(saleId));
    if(!sale) throw new Error('الفاتورة غير موجودة.');
    if(sale.status==='cancelled') throw new Error('هذه الفاتورة ملغاة بالكامل.');
    const requested=new Map();
    for(const item of requestedItems){const id=Number(item.product_id),qty=Number(item.quantity);if(!Number.isInteger(id)||id<=0||!Number.isFinite(qty)||qty<=0)throw new Error('بيانات الإرجاع غير صالحة.');requested.set(id,(requested.get(id)||0)+qty);}
    const transaction=db.transaction(()=>{
      const returnedRows=[];let returnTotal=0;
      for(const [productId,qty] of requested){
        const original=db.prepare('SELECT si.*,p.name,p.unit FROM sale_items si JOIN products p ON p.id=si.product_id WHERE si.sale_id=? AND si.product_id=?').get(sale.id,productId);
        if(!original) throw new Error('المنتج المحدد ليس ضمن هذه الفاتورة.');
        const already=Number(db.prepare('SELECT COALESCE(SUM(ri.quantity),0) AS n FROM sale_return_items ri JOIN sale_returns r ON r.id=ri.return_id WHERE r.sale_id=? AND ri.product_id=?').get(sale.id,productId).n);
        const remaining=Number(original.quantity)-already;
        if(qty>remaining+1e-9) throw new Error(`الكمية القابلة للإرجاع من ${original.name} هي ${Math.max(0,remaining)} فقط.`);
        const netUnit=Number(original.unit_price)*(1-(Number(sale.discount)/Math.max(0.01,Number(sale.subtotal))));
        const amount=Math.round(qty*netUnit*100)/100;
        returnedRows.push({product_id:productId,quantity:qty,unit_price:netUnit,line_total:amount,unit:original.unit,name:original.name});
        returnTotal+=amount;
      }
      returnTotal=Math.round(returnTotal*100)/100;
      if(returnTotal<=0) throw new Error('قيمة الإرجاع غير صالحة.');
      const due=Math.max(0,Number(sale.total)-Number(sale.paid));
      const refundAmount=Math.round(Math.min(Number(sale.paid),Math.max(0,returnTotal-due))*100)/100;
      const returnNo=`RET-${localDateString().replaceAll('-','')}-${randomUUID().slice(0,6).toUpperCase()}`;
      const result=db.prepare('INSERT INTO sale_returns(sale_id,return_no,total,refund_amount,refund_method,note) VALUES(?,?,?,?,?,?)').run(sale.id,returnNo,returnTotal,refundAmount,method,String(note||'').trim()||null);
      const returnId=Number(result.lastInsertRowid);
      const addLine=db.prepare('INSERT INTO sale_return_items(return_id,product_id,quantity,unit_price,line_total) VALUES(?,?,?,?,?)');
      for(const row of returnedRows){
        addLine.run(returnId,row.product_id,row.quantity,row.unit_price,row.line_total);
        if(row.unit!=='service'){
          db.prepare('UPDATE products SET quantity=quantity+? WHERE id=?').run(row.quantity,row.product_id);
          db.prepare("INSERT INTO stock_movements(product_id,movement_type,quantity,note) VALUES(?,'sale_return',?,?)").run(row.product_id,row.quantity,`Return ${returnNo} / ${sale.invoice_no}`);
        }
      }
      const newTotal=Math.max(0,Math.round((Number(sale.total)-returnTotal)*100)/100);
      const newPaid=Math.max(0,Math.round((Number(sale.paid)-refundAmount)*100)/100);
      const remaining=db.prepare(`SELECT COUNT(*) AS n FROM sale_items si WHERE si.sale_id=? AND si.quantity > COALESCE((SELECT SUM(ri.quantity) FROM sale_return_items ri JOIN sale_returns r ON r.id=ri.return_id WHERE r.sale_id=si.sale_id AND ri.product_id=si.product_id),0)+0.0000001`).get(sale.id).n;
      db.prepare('UPDATE sales SET total=?,paid=?,status=? WHERE id=?').run(newTotal,newPaid,remaining===0?'cancelled':'partially_returned',sale.id);
      if(refundAmount>0) db.prepare("INSERT INTO payments(related_type,related_id,amount,method) VALUES('sale_refund',?,?,?)").run(sale.id,refundAmount,method);
      const costReturned=Math.round(returnedRows.reduce((sum,row)=>{if(row.unit==='service')return sum;const original=db.prepare('SELECT cost_price FROM sale_items WHERE sale_id=? AND product_id=?').get(sale.id,row.product_id);return sum+Number(original?.cost_price||0)*row.quantity;},0)*100)/100;
      postJournal(`sale_return:${returnId}`, `إرجاع ${returnNo} / ${sale.invoice_no}`, [
        {code:'603',debit:returnTotal},{code:'202',credit:Math.max(0,Math.round((returnTotal-refundAmount)*100)/100)},{code:paymentAccount(method),credit:refundAmount},
        {code:'301',debit:costReturned},{code:'604',credit:costReturned}
      ], event);
      return {id:returnId,return_no:returnNo,total:returnTotal,refund_amount:refundAmount,refund_method:method,status:remaining===0?'cancelled':'partially_returned',invoice_no:sale.invoice_no};
    });
    return transaction();
  }
  ipcMain.handle('sales:return', (event,payload)=>processSaleReturn(payload?.sale_id,payload?.items,payload?.refund_method,payload?.note,event));
  ipcMain.handle('sales:cancel', (event,payload)=>{
    const sale=db.prepare('SELECT id,status FROM sales WHERE id=?').get(Number(payload?.sale_id));
    if(!sale) throw new Error('الفاتورة غير موجودة.');
    if(sale.status==='cancelled') throw new Error('الفاتورة ملغاة بالفعل.');
    const items=db.prepare('SELECT si.product_id, si.quantity-COALESCE((SELECT SUM(ri.quantity) FROM sale_return_items ri JOIN sale_returns r ON r.id=ri.return_id WHERE r.sale_id=si.sale_id AND ri.product_id=si.product_id),0) AS quantity FROM sale_items si WHERE si.sale_id=?').all(sale.id).filter(x=>x.quantity>0.0000001);
    if(!items.length) throw new Error('لا توجد كميات متبقية للإرجاع.');
    return processSaleReturn(sale.id,items,payload?.refund_method,payload?.note||'إلغاء كامل للفاتورة',event);
  });
  ipcMain.handle('sales:create', (event, payload) => {
    if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
      throw new Error('أضف منتجاً واحداً على الأقل إلى الفاتورة.');
    }
    const discount = Number(payload.discount || 0);
    if (!Number.isFinite(discount) || discount < 0) throw new Error('قيمة التخفيض غير صالحة.');
    const paymentMethod = ['cash', 'card', 'transfer'].includes(payload.payment_method) ? payload.payment_method : 'cash';
    const customerId = payload.customer_id ? Number(payload.customer_id) : null;
    const paidInput = payload.paid === undefined || payload.paid === null || payload.paid === '' ? null : Number(payload.paid);
    if (customerId !== null && (!Number.isInteger(customerId) || customerId <= 0)) throw new Error('الزبون غير صالح.');
    if (paidInput !== null && (!Number.isFinite(paidInput) || paidInput < 0)) throw new Error('مبلغ الأداء غير صالح.');
    const normalized = payload.items.map(item => ({
      product_id: Number(item.product_id),
      quantity: Number(item.quantity)
    }));
    for (const item of normalized) {
      if (!Number.isInteger(item.product_id) || item.product_id <= 0 || !Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new Error('توجد بيانات منتج أو كمية غير صالحة في الفاتورة.');
      }
    }
    // Merge duplicate product lines before checking stock and saving.
    const quantities = new Map();
    for (const item of normalized) quantities.set(item.product_id, (quantities.get(item.product_id) || 0) + item.quantity);
    const transaction = db.transaction(() => {
      const rows = [];
      let subtotal = 0;
      for (const [productId, quantity] of quantities) {
        const product = db.prepare('SELECT id,name,purchase_price,sale_price,quantity,unit,active FROM products WHERE id=?').get(productId);
        if (!product || product.active !== 1) throw new Error(`المنتج رقم ${productId} غير موجود أو مؤرشف.`);
        if (product.unit !== 'service' && Number(product.quantity) + 1e-9 < quantity) throw new Error(`المخزون غير كافٍ للمنتج: ${product.name}. المتوفر: ${product.quantity}`);
        const unitPrice = Number(product.sale_price);
        const lineTotal = Math.round(quantity * unitPrice * 100) / 100;
        subtotal += lineTotal;
        rows.push({ product, quantity, unitPrice, lineTotal });
      }
      subtotal = Math.round(subtotal * 100) / 100;
      if (discount > subtotal) throw new Error('التخفيض لا يمكن أن يتجاوز مجموع الفاتورة.');
      const total = Math.round((subtotal - discount) * 100) / 100;
      if (total <= 0) throw new Error('مجموع الفاتورة يجب أن يكون أكبر من صفر.');
      if (customerId !== null && !db.prepare('SELECT id FROM customers WHERE id=?').get(customerId)) throw new Error('الزبون غير موجود.');
      const paid = paidInput === null ? total : Math.round(paidInput * 100) / 100;
      if (paid > total + 0.00001) throw new Error('مبلغ الأداء لا يمكن أن يتجاوز مجموع الفاتورة.');
      if (paid < total && customerId === null) throw new Error('اختر زبوناً لتسجيل الفاتورة بالدين.');
      const invoiceNo = `HE-${localDateString().replaceAll('-','')}-${randomUUID().slice(0,6).toUpperCase()}`;
      const sale = db.prepare(`INSERT INTO sales(invoice_no,customer_id,subtotal,discount,total,paid,payment_method,status)
        VALUES(@invoice_no,@customer_id,@subtotal,@discount,@total,@paid,@payment_method,'completed')`).run({
          invoice_no: invoiceNo, customer_id: customerId, subtotal, discount, total, paid, payment_method: paymentMethod
        });
      const saleId = Number(sale.lastInsertRowid);
      const addItem = db.prepare(`INSERT INTO sale_items(sale_id,product_id,quantity,unit_price,cost_price,line_total)
        VALUES(?,?,?,?,?,?)`);
      const reduceStock = db.prepare('UPDATE products SET quantity=quantity-? WHERE id=? AND quantity>=?');
      const addMovement = db.prepare(`INSERT INTO stock_movements(product_id,movement_type,quantity,note)
        VALUES(?,'sale',?,?)`);
      for (const row of rows) {
        addItem.run(saleId, row.product.id, row.quantity, row.unitPrice, Number(row.product.purchase_price), row.lineTotal);
        if (row.product.unit !== 'service') {
          const updated = reduceStock.run(row.quantity, row.product.id, row.quantity);
          if (updated.changes !== 1) throw new Error(`تعذر تحديث مخزون المنتج: ${row.product.name}`);
          addMovement.run(row.product.id, -row.quantity, `Sale ${invoiceNo}`);
        }
      }
      if (paid > 0) db.prepare(`INSERT INTO payments(related_type,related_id,amount,method) VALUES('sale',?,?,?)`)
        .run(saleId, paid, paymentMethod);
      const costTotal=Math.round(rows.reduce((sum,row)=>sum+(row.product.unit==='service'?0:Number(row.product.purchase_price||0)*row.quantity),0)*100)/100;
      postJournal(`sale:${saleId}`, `فاتورة بيع ${invoiceNo}`, [
        {code:paymentAccount(paymentMethod),debit:paid},{code:'202',debit:Math.max(0,Math.round((total-paid)*100)/100)},{code:'501',credit:total},
        {code:'604',debit:costTotal},{code:'301',credit:costTotal}
      ], event);
      return { id: saleId, invoice_no: invoiceNo, subtotal, discount, total, paid, due: Math.round((total-paid)*100)/100, customer_id: customerId, customer_name: customerId ? db.prepare('SELECT name FROM customers WHERE id=?').get(customerId).name : null, payment_method: paymentMethod, created_at: new Date().toISOString(), items: rows.map(row => ({ product_id: row.product.id, name: row.product.name, unit: row.product.unit, quantity: row.quantity, unit_price: row.unitPrice, line_total: row.lineTotal })), item_count: rows.length };
    });
    return transaction();
  });


  // Expenses and cash register.
  ipcMain.handle('expenses:list', (_event, limit=100) => {
    const safeLimit=Math.min(500,Math.max(1,Number(limit)||100));
    return db.prepare('SELECT * FROM expenses ORDER BY id DESC LIMIT ?').all(safeLimit);
  });
  ipcMain.handle('expenses:create', (event, payload) => {
    const title=String(payload?.title||'').trim(), amount=Number(payload?.amount);
    const method=['cash','card','transfer'].includes(payload?.method)?payload.method:'cash';
    if(!title||!Number.isFinite(amount)||amount<=0) throw new Error('أدخل بيان المصروف ومبلغاً صحيحاً أكبر من صفر.');
    return db.transaction(()=>{
      const result = db.prepare('INSERT INTO expenses(title,amount,note,method) VALUES(?,?,?,?)')
        .run(title,amount,String(payload.note||'').trim()||null,method);
      const id=Number(result.lastInsertRowid);
      postJournal(`expense:${id}`, `مصروف: ${title}`, [{code:'602',debit:amount},{code:paymentAccount(method),credit:amount}], event);
      return {id};
    })();
  });
  ipcMain.handle('expenses:delete', (event,id) => db.transaction(()=>{
    const expense=db.prepare('SELECT * FROM expenses WHERE id=?').get(Number(id));
    if(!expense) return false;
    const original=db.prepare(`SELECT a.code,l.debit,l.credit FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id WHERE e.source=?`).all(`expense:${expense.id}`);
    if(original.length) postJournal(`expense_delete:${expense.id}`, `عكس حذف مصروف: ${expense.title}`, original.map(x=>({code:x.code,debit:x.credit,credit:x.debit})), event);
    db.prepare('DELETE FROM expenses WHERE id=?').run(expense.id);
    return true;
  })());

  function cashTotals(from, to) {
    const p=db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN related_type IN ('sale','customer_payment') AND method='cash' THEN amount ELSE 0 END),0) AS cash_in,
      COALESCE(SUM(CASE WHEN related_type IN ('purchase','supplier_payment','sale_refund') AND method='cash' THEN amount ELSE 0 END),0) AS cash_out
      FROM payments WHERE created_at>=? AND created_at<=?`).get(from,to);
    const e=db.prepare("SELECT COALESCE(SUM(amount),0) AS amount FROM expenses WHERE method='cash' AND created_at>=? AND created_at<=?").get(from,to);
    return {cash_in:Number(p.cash_in),cash_out:Number(p.cash_out)+Number(e.amount),expenses:Number(e.amount)};
  }
  ipcMain.handle('cash:current', () => {
    const session=db.prepare('SELECT * FROM cash_sessions WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1').get();
    if(!session) return {session:null,totals:{cash_in:0,cash_out:0,expenses:0},expected:0};
    const totals=cashTotals(session.opened_at, '9999-12-31 23:59:59');
    const expected=Math.round((Number(session.opening_amount)+totals.cash_in-totals.cash_out)*100)/100;
    return {session,totals,expected};
  });
  ipcMain.handle('cash:open', (event,payload) => {
    const amount=Number(payload?.opening_amount||0);
    if(!Number.isFinite(amount)||amount<0) throw new Error('رصيد افتتاح الصندوق غير صالح.');
    return db.transaction(()=>{
      const active=db.prepare('SELECT id FROM cash_sessions WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1').get();
      if(active) throw new Error('يوجد صندوق مفتوح بالفعل. أغلق الجلسة الحالية أولاً.');
      const r=db.prepare('INSERT INTO cash_sessions(opening_amount) VALUES(?)').run(amount);
      const id=Number(r.lastInsertRowid);
      if(amount>0) postJournal(`cash_open:${id}`, 'رصيد افتتاح الصندوق', [{code:'401',debit:amount},{code:'101',credit:amount}], event);
      return {id,opening_amount:amount};
    })();
  });
  ipcMain.handle('cash:close', (_event,payload) => {
    const counted=Number(payload?.closing_amount);
    if(!Number.isFinite(counted)||counted<0) throw new Error('المبلغ الفعلي في الصندوق غير صالح.');
    return db.transaction(()=>{
      const session=db.prepare('SELECT * FROM cash_sessions WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1').get();
      if(!session) throw new Error('لا توجد جلسة صندوق مفتوحة.');
      const totals=cashTotals(session.opened_at,'9999-12-31 23:59:59');
      const expected=Math.round((Number(session.opening_amount)+totals.cash_in-totals.cash_out)*100)/100;
      const diff=Math.round((counted-expected)*100)/100;
      db.prepare('UPDATE cash_sessions SET closing_amount=?,closed_at=CURRENT_TIMESTAMP WHERE id=?').run(counted,session.id);
      return {expected,counted,difference:diff,totals};
    })();
  });
  ipcMain.handle('cash:history', (_event,limit=30) => {
    const safeLimit=Math.min(200,Math.max(1,Number(limit)||30));
    return db.prepare('SELECT * FROM cash_sessions ORDER BY id DESC LIMIT ?').all(safeLimit);
  });
  ipcMain.handle('reports:summary', (_event,payload={}) => {
    const range=localDateRangeToUtc(payload.from||localDateString(),payload.to||localDateString());
    const from=range.from, to=range.toExclusive;
    // Invoice totals/due are grouped by invoice date; collected amounts are grouped
    // by the actual payment date, including later customer/supplier settlements.
    const sales=db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(total),0) AS total,
      COALESCE(SUM(total-paid),0) AS due FROM sales WHERE created_at >= ? AND created_at < ?`).get(from,to);
    sales.paid=Number(db.prepare(`SELECT COALESCE(SUM(CASE WHEN related_type='sale_refund' THEN -amount ELSE amount END),0) AS n FROM payments
      WHERE created_at >= ? AND created_at < ? AND related_type IN ('sale','customer_payment','sale_refund')`).get(from,to).n);
    const purchases=db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(total),0) AS total,
      COALESCE(SUM(total-paid),0) AS due FROM purchases WHERE created_at >= ? AND created_at < ?`).get(from,to);
    purchases.paid=Number(db.prepare(`SELECT COALESCE(SUM(amount),0) AS n FROM payments
      WHERE created_at >= ? AND created_at < ? AND related_type IN ('purchase','supplier_payment')`).get(from,to).n);
    const expenses=db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE created_at >= ? AND created_at < ?').get(from,to);
    // Allocate each invoice-level discount proportionally to its item lines before
    // calculating margin, so reported revenue and gross profit reflect the actual total.
    const profit=db.prepare(`SELECT COALESCE(SUM(
      (si.line_total * CASE WHEN s.subtotal>0 THEN (s.subtotal-s.discount)/s.subtotal ELSE 1 END)
      -COALESCE((SELECT SUM(ri.line_total) FROM sale_return_items ri JOIN sale_returns r ON r.id=ri.return_id WHERE r.sale_id=s.id AND ri.product_id=si.product_id),0)
      -((si.quantity-COALESCE((SELECT SUM(ri.quantity) FROM sale_return_items ri JOIN sale_returns r ON r.id=ri.return_id WHERE r.sale_id=s.id AND ri.product_id=si.product_id),0))*si.cost_price)),0) AS gross
      FROM sale_items si JOIN sales s ON s.id=si.sale_id
      WHERE s.created_at >= ? AND s.created_at < ?`).get(from,to);
    const top=db.prepare(`SELECT p.name,
      SUM(si.quantity-COALESCE((SELECT SUM(ri.quantity) FROM sale_return_items ri JOIN sale_returns r ON r.id=ri.return_id WHERE r.sale_id=s.id AND ri.product_id=si.product_id),0)) AS quantity,
      SUM(si.line_total * CASE WHEN s.subtotal>0 THEN (s.subtotal-s.discount)/s.subtotal ELSE 1 END
        -COALESCE((SELECT SUM(ri.line_total) FROM sale_return_items ri JOIN sale_returns r ON r.id=ri.return_id WHERE r.sale_id=s.id AND ri.product_id=si.product_id),0)) AS revenue
      FROM sale_items si JOIN sales s ON s.id=si.sale_id
      LEFT JOIN products p ON p.id=si.product_id
      WHERE s.created_at >= ? AND s.created_at < ? GROUP BY si.product_id
      HAVING SUM(si.quantity-COALESCE((SELECT SUM(ri.quantity) FROM sale_return_items ri JOIN sale_returns r ON r.id=ri.return_id WHERE r.sale_id=s.id AND ri.product_id=si.product_id),0))>0
      ORDER BY revenue DESC LIMIT 10`).all(from,to);
    const grossProfit=Math.round(Number(profit.gross)*100)/100;
    return {sales,purchases,expenses:Number(expenses.total),gross_profit:grossProfit,
      net_profit:Math.round((grossProfit-Number(expenses.total))*100)/100,top_products:top};
  });

  ipcMain.handle('accounts:list', () => db.prepare(`SELECT a.*, COALESCE((SELECT SUM(CASE WHEN a.account_type IN ('liability','equity','income') THEN l.credit-l.debit ELSE l.debit-l.credit END) FROM journal_lines l WHERE l.account_id=a.id),0) AS balance FROM accounts a WHERE a.active=1 ORDER BY a.code`).all());
  ipcMain.handle('accounts:ledger', (_event,payload={}) => {
    const accountId=Number(payload.accountId), from=String(payload.from||'0001-01-01'), to=String(payload.to||'9999-12-31');
    if(!Number.isInteger(accountId)||accountId<1) throw new Error('اختر حساباً صحيحاً.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to) throw new Error('نطاق التاريخ غير صحيح.');
    const account=db.prepare('SELECT id,code,name_ar,name_fr,account_type FROM accounts WHERE id=? AND active=1').get(accountId);
    if(!account) throw new Error('الحساب غير موجود أو غير نشط.');
    const normalCredit=['liability','equity','income'].includes(account.account_type);
    const signed=normalCredit?'credit-debit':'debit-credit';
    const opening=Number(db.prepare(`SELECT COALESCE(SUM(${signed}),0) AS balance FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=? AND e.entry_date<?`).get(accountId,from).balance);
    const rows=db.prepare(`SELECT e.id AS entry_id,e.entry_no,e.entry_date,e.description,l.id AS line_id,l.debit,l.credit,l.note,u.username
      FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id LEFT JOIN app_users u ON u.id=e.created_by
      WHERE l.account_id=? AND e.entry_date BETWEEN ? AND ? ORDER BY e.entry_date,e.id,l.id`).all(accountId,from,to);
    let running=opening;
    const lines=rows.map(row=>{running+=normalCredit?Number(row.credit)-Number(row.debit):Number(row.debit)-Number(row.credit);return {...row,balance:Math.round(running*100)/100};});
    const totals=lines.reduce((v,row)=>({debit:v.debit+Number(row.debit),credit:v.credit+Number(row.credit)}),{debit:0,credit:0});
    return {account,from,to,opening:Math.round(opening*100)/100,closing:Math.round(running*100)/100,totals:{debit:Math.round(totals.debit*100)/100,credit:Math.round(totals.credit*100)/100},lines};
  });
  ipcMain.handle('accounts:create', (_event,payload) => {
    const code=String(payload?.code||'').trim(), ar=String(payload?.name_ar||'').trim(), fr=String(payload?.name_fr||'').trim(), type=String(payload?.account_type||'');
    if(!/^\d{3,8}$/.test(code)||!ar||!fr||!['asset','liability','equity','income','expense'].includes(type)) throw new Error('بيانات الحساب غير صالحة.');
    try { const r=db.prepare('INSERT INTO accounts(code,name_ar,name_fr,account_type) VALUES(?,?,?,?)').run(code,ar,fr,type); return {id:Number(r.lastInsertRowid)}; }
    catch(e){ if(String(e.message).includes('UNIQUE')) throw new Error('رقم الحساب مستخدم بالفعل.'); throw e; }
  });
  ipcMain.handle('journal:list', (_event,payload={}) => {
    const from=String(payload.from||'0001-01-01'), to=String(payload.to||'9999-12-31');
    if(from>to) throw new Error('نطاق التاريخ غير صحيح.');
    return db.prepare(`SELECT e.*,u.username,COALESCE(SUM(l.debit),0) AS total_debit,COALESCE(SUM(l.credit),0) AS total_credit,
      COUNT(l.id) AS line_count FROM journal_entries e LEFT JOIN journal_lines l ON l.entry_id=e.id LEFT JOIN app_users u ON u.id=e.created_by
      WHERE e.entry_date BETWEEN ? AND ? GROUP BY e.id ORDER BY e.entry_date DESC,e.id DESC LIMIT 500`).all(from,to);
  });
  ipcMain.handle('journal:get', (_event,id) => {
    const entry=db.prepare('SELECT * FROM journal_entries WHERE id=?').get(Number(id));
    if(!entry) throw new Error('القيد غير موجود.');
    const lines=db.prepare(`SELECT l.*,a.code,a.name_ar,a.name_fr FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id=? ORDER BY l.id`).all(entry.id);
    return {...entry,lines};
  });
  ipcMain.handle('accounting:period:get', () => {
    const get = key => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || null;
    const today = localDateString();
    const year = today.slice(0,4);
    return { start: get('accounting.fiscal_year_start') || `${year}-01-01`, end: get('accounting.fiscal_year_end') || `${year}-12-31` };
  });
  ipcMain.handle('accounting:period:update', (_event,payload={}) => {
    const start=String(payload.start||''), end=String(payload.end||'');
    const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
    if(!valid(start)||!valid(end)||start>end) throw new Error('تواريخ السنة المالية غير صحيحة.');
    const save=db.transaction(()=>{
      db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('accounting.fiscal_year_start',start);
      db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('accounting.fiscal_year_end',end);
    });
    save();
    return {start,end};
  });
  ipcMain.handle('accounting:period:check', (_event,payload={}) => {
    const start=String(payload.start||''), end=String(payload.end||'');
    const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
    if(!valid(start)||!valid(end)||start>end) throw new Error('حدد فترة مالية صحيحة.');
    const totals=db.prepare(`SELECT COUNT(DISTINCT e.id) AS entries, COUNT(l.id) AS lines,
      ROUND(COALESCE(SUM(l.debit),0),2) AS debit, ROUND(COALESCE(SUM(l.credit),0),2) AS credit
      FROM journal_entries e LEFT JOIN journal_lines l ON l.entry_id=e.id WHERE e.entry_date BETWEEN ? AND ?`).get(start,end);
    const unbalanced=db.prepare(`SELECT COUNT(*) AS n FROM (SELECT e.id FROM journal_entries e LEFT JOIN journal_lines l ON l.entry_id=e.id
      WHERE e.entry_date BETWEEN ? AND ? GROUP BY e.id HAVING ABS(COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0))>0.009 OR COUNT(l.id)<2)`).get(start,end).n;
    const opening=db.prepare(`SELECT a.id,a.code,a.name_ar,a.name_fr,a.account_type,
      ROUND(COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.debit ELSE 0 END),0),2) AS debit, ROUND(COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.credit ELSE 0 END),0),2) AS credit
      FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journal_entries e ON e.id=l.entry_id AND e.entry_date<?
      WHERE a.active=1 GROUP BY a.id ORDER BY a.code`).all(start);
    const activity=db.prepare(`SELECT a.account_type,
      ROUND(SUM(CASE WHEN a.account_type='income' THEN l.credit-l.debit ELSE 0 END),2) AS revenue,
      ROUND(SUM(CASE WHEN a.account_type='expense' THEN l.debit-l.credit ELSE 0 END),2) AS expenses
      FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
      WHERE e.entry_date BETWEEN ? AND ? GROUP BY a.account_type`).all(start,end);
    const sums=Object.fromEntries(activity.map(x=>[x.account_type,x]));
    const revenue=Number(sums.income?.revenue||0), expenses=Number(sums.expense?.expenses||0);
    const equity=db.prepare("SELECT id FROM accounts WHERE code='101' AND active=1").get()||null;
    const previous=db.prepare("SELECT value FROM settings WHERE key='accounting.last_closed_end'").get()?.value||null;
    const totalDebit=Number(totals.debit), totalCredit=Number(totals.credit);
    return {start,end,entries:Number(totals.entries),lines:Number(totals.lines),debit:totalDebit,credit:totalCredit,
      difference:Math.round((totalDebit-totalCredit)*100)/100,unbalanced:Number(unbalanced),
      revenue:Math.round(revenue*100)/100,expenses:Math.round(expenses*100)/100,
      result:Math.round((revenue-expenses)*100)/100,opening_accounts:opening,
      opening_debit:Math.round(opening.reduce((n,x)=>n+Number(x.debit),0)*100)/100,
      opening_credit:Math.round(opening.reduce((n,x)=>n+Number(x.credit),0)*100)/100,
      equity_account_available:!!equity,last_closed_end:previous,
      ready:Math.abs(totalDebit-totalCredit)<=0.009&&Number(unbalanced)===0&&!!equity};
  });

  ipcMain.handle('accounting:reports', (_event,payload={}) => {
    const from=String(payload.from||`${localDateString().slice(0,4)}-01-01`);
    const to=String(payload.to||localDateString());
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to) throw new Error('فترة التقرير غير صحيحة.');
    const trial=db.prepare(`SELECT a.id,a.code,a.name_ar,a.name_fr,a.account_type,
      ROUND(COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.debit ELSE 0 END),0),2) AS debit,ROUND(COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.credit ELSE 0 END),0),2) AS credit,
      ROUND(CASE WHEN a.account_type IN ('liability','equity','income') THEN COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.credit-l.debit ELSE 0 END),0) ELSE COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.debit-l.credit ELSE 0 END),0) END,2) AS balance
      FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journal_entries e ON e.id=l.entry_id AND e.entry_date<=?
      WHERE a.active=1 GROUP BY a.id ORDER BY a.code`).all(to);
    // Restrict aggregate rows to the requested closing date; left-join date filter is applied in the join.
    const period=db.prepare(`SELECT a.account_type,
      ROUND(SUM(CASE WHEN a.account_type='income' THEN l.credit-l.debit ELSE 0 END),2) AS revenue,
      ROUND(SUM(CASE WHEN a.account_type='expense' THEN l.debit-l.credit ELSE 0 END),2) AS expenses
      FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
      WHERE e.entry_date BETWEEN ? AND ? GROUP BY a.account_type`).all(from,to);
    const allThrough=db.prepare(`SELECT a.account_type,
      SUM(CASE WHEN a.account_type='income' THEN l.credit-l.debit ELSE 0 END) AS revenue,
      SUM(CASE WHEN a.account_type='expense' THEN l.debit-l.credit ELSE 0 END) AS expenses
      FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
      WHERE e.entry_date<=? GROUP BY a.account_type`).all(to);
    const sums=Object.fromEntries(period.map(x=>[x.account_type,x]));
    const cumulative=Object.fromEntries(allThrough.map(x=>[x.account_type,x]));
    const revenue=Number(sums.income?.revenue||0), expenses=Number(sums.expense?.expenses||0);
    const netProfit=Math.round((revenue-expenses)*100)/100;
    const cumulativeProfit=Math.round((Number(cumulative.income?.revenue||0)-Number(cumulative.expense?.expenses||0))*100)/100;
    const assets=Math.round(trial.filter(x=>x.account_type==='asset').reduce((n,x)=>n+Number(x.balance),0)*100)/100;
    const liabilities=Math.round(trial.filter(x=>x.account_type==='liability').reduce((n,x)=>n+Number(x.balance),0)*100)/100;
    const equityBase=Math.round(trial.filter(x=>x.account_type==='equity').reduce((n,x)=>n+Number(x.balance),0)*100)/100;
    const equity=Math.round((equityBase+cumulativeProfit)*100)/100;
    const debitTotal=Math.round(trial.reduce((n,x)=>n+Math.max(0,Number(x.balance)),0)*100)/100;
    const creditTotal=Math.round(trial.reduce((n,x)=>n+Math.max(0,-Number(x.balance)),0)*100)/100;
    return {from,to,trial_balance:trial,income:{revenue,expenses,net_profit:netProfit},balance_sheet:{assets,liabilities,equity,liabilities_equity:Math.round((liabilities+equity)*100)/100,difference:Math.round((assets-liabilities-equity)*100)/100},trial_totals:{debit:debitTotal,credit:creditTotal}};
  });
  ipcMain.handle('accounting:reconciliation', (_event) => {
    const controlBalance = (code, normal) => {
      const row = db.prepare(`SELECT COALESCE(SUM(${normal==='debit'?'l.debit-l.credit':'l.credit-l.debit'}),0) AS balance
        FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id WHERE a.code=?`).get(code);
      return Math.round(Number(row.balance)*100)/100;
    };
    const customers = db.prepare(`SELECT c.id,c.name,c.phone,ROUND(COALESCE(SUM(s.total-s.paid),0),2) AS balance
      FROM customers c LEFT JOIN sales s ON s.customer_id=c.id GROUP BY c.id ORDER BY c.name COLLATE NOCASE`).all();
    const suppliers = db.prepare(`SELECT s.id,s.name,s.phone,ROUND(COALESCE(SUM(p.total-p.paid),0),2) AS balance
      FROM suppliers s LEFT JOIN purchases p ON p.supplier_id=s.id GROUP BY s.id ORDER BY s.name COLLATE NOCASE`).all();
    const customerTotal = Math.round(customers.reduce((n,x)=>n+Number(x.balance),0)*100)/100;
    const supplierTotal = Math.round(suppliers.reduce((n,x)=>n+Number(x.balance),0)*100)/100;
    const receivables = controlBalance('202','debit');
    const payables = controlBalance('201','credit');
    return {
      customers, suppliers,
      customers_total: customerTotal, suppliers_total: supplierTotal,
      receivables_gl: receivables, payables_gl: payables,
      customers_difference: Math.round((receivables-customerTotal)*100)/100,
      suppliers_difference: Math.round((payables-supplierTotal)*100)/100
    };
  });

  ipcMain.handle('journal:create', (event,payload) => {
    const date=String(payload?.entry_date||''); const description=String(payload?.description||'').trim(); const lines=Array.isArray(payload?.lines)?payload.lines:[];
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||!description||description.length>250) throw new Error('تاريخ القيد والبيان مطلوبان.');
    if(lines.length<2||lines.length>30) throw new Error('يجب إدخال سطرين على الأقل وبحد أقصى 30 سطراً.');
    let debit=0,credit=0; const clean=[];
    for(const line of lines){const accountId=Number(line.account_id),d=Number(line.debit||0),c=Number(line.credit||0); if(!Number.isInteger(accountId)||accountId<1||!Number.isFinite(d)||!Number.isFinite(c)||d<0||c<0||((d>0)===(c>0))) throw new Error('كل سطر يجب أن يحتوي على مدين أو دائن فقط.'); if(!db.prepare('SELECT id FROM accounts WHERE id=? AND active=1').get(accountId)) throw new Error('أحد الحسابات غير موجود أو غير نشط.'); debit+=d;credit+=c;clean.push({accountId,debit:Math.round(d*100)/100,credit:Math.round(c*100)/100,note:String(line.note||'').slice(0,160)});}
    debit=Math.round(debit*100)/100;credit=Math.round(credit*100)/100;
    if(debit<=0||Math.abs(debit-credit)>0.009) throw new Error('القيد غير متوازن: مجموع المدين يجب أن يساوي مجموع الدائن.');
    const create=db.transaction(()=>{const no=`JV-${date.replaceAll('-','')}-${randomUUID().slice(0,6).toUpperCase()}`;const r=db.prepare('INSERT INTO journal_entries(entry_no,entry_date,description,source,created_by) VALUES(?,?,?,\'manual\',?)').run(no,date,description,authenticatedSenders.get(event.sender.id)?.id||null);const id=Number(r.lastInsertRowid);const ins=db.prepare('INSERT INTO journal_lines(entry_id,account_id,debit,credit,note) VALUES(?,?,?,?,?)');clean.forEach(x=>ins.run(id,x.accountId,x.debit,x.credit,x.note||null));return {id,entry_no:no,total:debit};});
    return create();
  });

  ipcMain.handle('images:read', (_event, imagePath) => {
    if (!imagePath) return null;
    const folder = path.resolve(app.getPath('userData'), 'images');
    const target = path.resolve(String(imagePath));
    const relative = path.relative(folder, target);
    // Reject paths outside the app-managed image folder (case-insensitive on Windows).
    const escapesFolder = relative === '' || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
    if (escapesFolder || !fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
    const ext = path.extname(target).toLowerCase();
    const mime = ({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'})[ext];
    if (!mime) return null;
    return `data:${mime};base64,${fs.readFileSync(target).toString('base64')}`;
  });
  ipcMain.handle('images:select', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg','jpeg','png','webp'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const ext = path.extname(source).toLowerCase();
    const folder = path.join(app.getPath('userData'), 'images');
    fs.mkdirSync(folder, { recursive: true });
    const filename = `${randomUUID()}${ext}`;
    fs.copyFileSync(source, path.join(folder, filename));
    return { path: path.join(folder, filename), name: path.basename(source) };
  });
}
function validateProduct(p) {
  if (!p || !p.name?.trim()) throw new Error('اسم المنتج مطلوب');
  for (const key of ['purchase_price','sale_price','quantity','min_quantity']) {
    if (!Number.isFinite(Number(p[key])) || Number(p[key]) < 0) throw new Error(`قيمة غير صالحة: ${key}`);
  }
  if (p.barcode && !String(p.barcode).trim()) p.barcode = null;
}
app.whenReady().then(() => { initDatabase(); registerHandlers(); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
