const express = require("express");
const path = require("path");
const fs = require("fs");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "GANTI_SECRET_INI_SEBELUM_PRODUKSI";

const dataDir = path.join(__dirname, "data");
const uploadDir = path.join(__dirname, "public", "uploads");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, "restoran.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  image TEXT DEFAULT '',
  description TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_no TEXT NOT NULL,
  customer_name TEXT DEFAULT '',
  note TEXT DEFAULT '',
  total INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'kasir',
  status TEXT NOT NULL DEFAULT 'baru',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_id INTEGER NOT NULL,
  menu_name TEXT NOT NULL,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  subtotal INTEGER NOT NULL
);
`);

const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
if (!count) {
  const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || "admin123", 12);
  db.prepare("INSERT INTO users(username,password_hash) VALUES(?,?)").run("admin", hash);
}

const defaults = [
  ["restaurant_name", "RESTORAN KITA"],
  ["restaurant_logo", ""],
  ["restaurant_location", ""]
];
const insertSetting = db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)");
for (const row of defaults) insertSetting.run(...row);

const defaultMenus = [
  ["Nasi Goreng Spesial","Makanan",18000,20,"https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=900&q=80","Nasi goreng dengan telur dan ayam."],
  ["Ayam Geprek","Makanan",20000,20,"https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=900&q=80","Ayam crispy dengan sambal."],
  ["Mie Goreng","Makanan",15000,20,"https://images.unsplash.com/photo-1612929633738-8fe44f7ec841?auto=format&fit=crop&w=900&q=80","Mie goreng dengan telur dan sayuran."],
  ["Es Teh Manis","Minuman",5000,30,"https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=900&q=80","Es teh manis menyegarkan."],
  ["Jus Jeruk","Minuman",10000,20,"https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&w=900&q=80","Jus jeruk segar."],
  ["Kentang Goreng","Snack",12000,20,"https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=80","Kentang goreng renyah."]
];
if (db.prepare("SELECT COUNT(*) AS n FROM menus").get().n === 0) {
  const stmt = db.prepare("INSERT INTO menus(name,category,price,stock,image,description) VALUES(?,?,?,?,?,?)");
  const tx = db.transaction(rows => rows.forEach(r => stmt.run(...r)));
  tx(defaultMenus);
}

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,9)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

function auth(req, res, next) {
  const token = req.cookies.admin_token;
  if (!token) return res.status(401).json({ error: "Belum login." });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie("admin_token");
    return res.status(401).json({ error: "Sesi admin tidak valid." });
  }
}

function getSetting(key) {
  return db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value || "";
}

app.get("/api/settings", (_, res) => {
  res.json({ name: getSetting("restaurant_name"), logo: getSetting("restaurant_logo"), location: getSetting("restaurant_location") });
});

app.get("/api/menus", (_, res) => {
  res.json(db.prepare("SELECT id,name,category,price,stock,image,description,active FROM menus WHERE active=1 ORDER BY id").all());
});

app.post("/api/orders", (req, res) => {
  const { table_no, customer_name = "", note = "", items = [] } = req.body;
  if (!table_no || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: "Meja dan pesanan wajib diisi." });
  }

  const placeOrder = db.transaction(() => {
    let total = 0;
    const cleanItems = [];

    for (const raw of items) {
      const id = Number(raw.menu_id);
      const qty = Math.max(1, Number(raw.quantity) || 0);
      const menu = db.prepare("SELECT * FROM menus WHERE id=? AND active=1").get(id);
      if (!menu) throw new Error("Menu tidak ditemukan.");
      if (menu.stock < qty) throw new Error(`Stok ${menu.name} tidak mencukupi.`);
      const subtotal = menu.price * qty;
      total += subtotal;
      cleanItems.push({ menu, qty, subtotal });
    }

    const order = db.prepare(`
      INSERT INTO orders(table_no,customer_name,note,total,payment_method,status)
      VALUES(?,?,?,?,?,'baru')
    `).run(String(table_no), String(customer_name).slice(0,100), String(note).slice(0,500), total, "kasir");

    const itemStmt = db.prepare(`
      INSERT INTO order_items(order_id,menu_id,menu_name,price,quantity,subtotal)
      VALUES(?,?,?,?,?,?)
    `);
    const stockStmt = db.prepare("UPDATE menus SET stock=stock-?,updated_at=CURRENT_TIMESTAMP WHERE id=?");
    for (const x of cleanItems) {
      itemStmt.run(order.lastInsertRowid, x.menu.id, x.menu.name, x.menu.price, x.qty, x.subtotal);
      stockStmt.run(x.qty, x.menu.id);
    }
    return Number(order.lastInsertRowid);
  });

  try {
    const orderId = placeOrder();
    res.json({ ok: true, order_id: orderId, message: "Pesanan berhasil. Silakan bayar di kasir." });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/login", (req, res) => {
  const { username = "", password = "" } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username=?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Username atau password salah." });
  }
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "12h" });
  res.cookie("admin_token", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 12*60*60*1000 });
  res.json({ ok: true });
});

app.post("/api/logout", (_, res) => {
  res.clearCookie("admin_token");
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => res.json({ username: req.admin.username }));

app.get("/api/admin/orders", auth, (_, res) => {
  const orders = db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 200").all();
  const items = db.prepare("SELECT * FROM order_items ORDER BY id").all();
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.order_id)) map.set(item.order_id, []);
    map.get(item.order_id).push(item);
  }
  res.json(orders.map(o => ({ ...o, items: map.get(o.id) || [] })));
});

app.patch("/api/admin/orders/:id/status", auth, (req, res) => {
  const allowed = ["baru","diproses","siap","selesai","dibatalkan"];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: "Status tidak valid." });
  const result = db.prepare("UPDATE orders SET status=? WHERE id=?").run(req.body.status, Number(req.params.id));
  res.json({ ok: result.changes > 0 });
});

app.get("/api/admin/menus", auth, (_, res) => {
  res.json(db.prepare("SELECT * FROM menus ORDER BY id").all());
});

app.post("/api/admin/menus", auth, (req, res) => {
  const { name, category, price, stock, image = "", description = "", active = 1 } = req.body;
  if (!name || !Number(price) && Number(price) !== 0) return res.status(400).json({ error: "Nama dan harga wajib diisi." });
  const r = db.prepare(`
    INSERT INTO menus(name,category,price,stock,image,description,active)
    VALUES(?,?,?,?,?,?,?)
  `).run(String(name), String(category || "Makanan"), Math.max(0,Number(price)), Math.max(0,Number(stock)||0), String(image), String(description), active ? 1 : 0);
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
});

app.put("/api/admin/menus/:id", auth, (req, res) => {
  const { name, category, price, stock, image = "", description = "", active = 1 } = req.body;
  const r = db.prepare(`
    UPDATE menus SET name=?,category=?,price=?,stock=?,image=?,description=?,active=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(String(name), String(category || "Makanan"), Math.max(0,Number(price)), Math.max(0,Number(stock)||0), String(image), String(description), active ? 1 : 0, Number(req.params.id));
  res.json({ ok: r.changes > 0 });
});

app.delete("/api/admin/menus/:id", auth, (req, res) => {
  const r = db.prepare("DELETE FROM menus WHERE id=?").run(Number(req.params.id));
  res.json({ ok: r.changes > 0 });
});

app.post("/api/admin/upload", auth, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "File gambar tidak valid." });
  res.json({ ok: true, url: `/uploads/${req.file.filename}` });
});

app.put("/api/admin/settings", auth, (req, res) => {
  const name = String(req.body.name || "").trim();
  const logo = String(req.body.logo || "").trim();
  const location = String(req.body.location || "").trim();
  if (!name) return res.status(400).json({ error: "Nama restoran wajib diisi." });
  const stmt = db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const tx = db.transaction(() => { stmt.run("restaurant_name", name); stmt.run("restaurant_logo", logo); stmt.run("restaurant_location", location); });
  tx();
  res.json({ ok: true });
});

app.put("/api/admin/password", auth, (req, res) => {
  const { old_password, new_password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.admin.id);
  if (!user || !bcrypt.compareSync(old_password || "", user.password_hash)) return res.status(400).json({ error: "Password lama salah." });
  if (!new_password || String(new_password).length < 6) return res.status(400).json({ error: "Password baru minimal 6 karakter." });
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(String(new_password), 12), req.admin.id);
  res.json({ ok: true });
});

app.get("/admin", (_, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

app.listen(PORT, () => {
  console.log(`Restoran Kita berjalan di http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
});
