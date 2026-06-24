const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const crypto = require('crypto');

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'credits.db');

// ─── Coupon definitions (BACKEND ONLY — never sent to frontend) ──────────────
const COUPONS = {
  'SUJAL100':   { credits: 100,  description: '100 Bonus Credits' },
  'SUJAL500':   { credits: 500,  description: '500 Bonus Credits' },
  'SUJAL1000':  { credits: 1000, description: '1000 Bonus Credits' },
  'WELCOME50':  { credits: 50,   description: '50 Welcome Credits' },
  'TOOLKIT200': { credits: 200,  description: '200 Toolkit Credits' },
  // Add more here — they stay server-side only
};

const CREDITS_PER_NEW_USER = 100;
const CREDITS_PER_USE      = 10;

// ─── Password hashing ────────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHmac('sha256', salt).update(password).digest('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = crypto.createHmac('sha256', salt).update(password).digest('hex');
  return attempt === hash;
}

// ─── SQLite setup (sql.js) ──────────────────────────────────────────────────
let db;

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    const fileBuffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(fileBuffer);
    console.log('📦 Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('🆕 Created new database');
  }

  // Users table — now with email + password auth
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password_hash TEXT,
      credits INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Sessions table — maps session token → user id
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      description TEXT,
      tool TEXT,
      balance_after INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS coupon_uses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      coupon TEXT NOT NULL,
      credits_added INTEGER NOT NULL,
      used_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, coupon)
    )
  `);

  saveDB();
  console.log('✅ Database initialized');
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

// ─── DB helpers ─────────────────────────────────────────────────────────────
function getUserById(id) {
  const res = db.exec(`SELECT id, email, credits, created_at, last_seen FROM users WHERE id = ?`, [id]);
  if (!res.length || !res[0].values.length) return null;
  const [uid, email, credits, created_at, last_seen] = res[0].values[0];
  return { id: uid, email, credits, created_at, last_seen };
}

function getUserByEmail(email) {
  const res = db.exec(`SELECT id, email, password_hash, credits, created_at, last_seen FROM users WHERE email = ?`, [email.toLowerCase().trim()]);
  if (!res.length || !res[0].values.length) return null;
  const [id, em, password_hash, credits, created_at, last_seen] = res[0].values[0];
  return { id, email: em, password_hash, credits, created_at, last_seen };
}

function createUser(email, passwordHash) {
  const id = 'user_' + uuidv4().replace(/-/g, '').slice(0, 16);
  db.run(
    `INSERT INTO users (id, email, password_hash, credits, created_at, last_seen)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [id, email.toLowerCase().trim(), passwordHash, CREDITS_PER_NEW_USER]
  );
  db.run(
    `INSERT INTO transactions (user_id, type, amount, description, balance_after)
     VALUES (?, 'credit', ?, 'Welcome bonus', ?)`,
    [id, CREDITS_PER_NEW_USER, CREDITS_PER_NEW_USER]
  );
  saveDB();
  return getUserById(id);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  db.run(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
    [token, userId, expires]
  );
  saveDB();
  return token;
}

function getSessionUser(token) {
  if (!token) return null;
  const res = db.exec(
    `SELECT s.user_id FROM sessions s WHERE s.token = ? AND s.expires_at > datetime('now')`,
    [token]
  );
  if (!res.length || !res[0].values.length) return null;
  const userId = res[0].values[0][0];
  return getUserById(userId);
}

function deleteSession(token) {
  db.run(`DELETE FROM sessions WHERE token = ?`, [token]);
  saveDB();
}

function updateLastSeen(id) {
  db.run(`UPDATE users SET last_seen = datetime('now') WHERE id = ?`, [id]);
  saveDB();
}

function getTransactions(userId, limit = 20) {
  const res = db.exec(
    `SELECT type, amount, description, tool, balance_after, created_at
     FROM transactions WHERE user_id = ?
     ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = row[i]);
    return obj;
  });
}

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(__dirname));

// ─── Auth middleware: resolve user from session cookie ───────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies?.tk_session;
  if (!token) {
    return res.status(401).json({ success: false, error: 'not_logged_in', message: 'Please log in.' });
  }
  const user = getSessionUser(token);
  if (!user) {
    res.clearCookie('tk_session');
    return res.status(401).json({ success: false, error: 'session_expired', message: 'Session expired. Please log in again.' });
  }
  updateLastSeen(user.id);
  req.user = user;
  next();
}

// ─── Auth Routes ─────────────────────────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email address.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
  }

  const existing = getUserByEmail(email);
  if (existing) {
    return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
  }

  const passwordHash = hashPassword(password);
  const user = createUser(email, passwordHash);
  const token = createSession(user.id);

  res.cookie('tk_session', token, {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  });

  res.json({
    success: true,
    message: `Welcome! You have ${CREDITS_PER_NEW_USER} free credits.`,
    credits: user.credits,
    email: user.email,
    userId: user.id
  });
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  const token = createSession(user.id);
  res.cookie('tk_session', token, {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  });

  res.json({
    success: true,
    message: 'Logged in successfully.',
    credits: user.credits,
    email: user.email,
    userId: user.id
  });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies?.tk_session;
  if (token) deleteSession(token);
  res.clearCookie('tk_session');
  res.json({ success: true, message: 'Logged out.' });
});

// GET /api/auth/me — check login status
app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.tk_session;
  if (!token) return res.json({ success: false, loggedIn: false });
  const user = getSessionUser(token);
  if (!user) return res.json({ success: false, loggedIn: false });
  updateLastSeen(user.id);
  res.json({ success: true, loggedIn: true, email: user.email, credits: user.credits, userId: user.id });
});

// ─── Credit Routes (all require auth) ────────────────────────────────────────

app.get('/api/credits', requireAuth, (req, res) => {
  const transactions = getTransactions(req.user.id);
  res.json({
    success: true,
    credits: req.user.credits,
    email: req.user.email,
    userId: req.user.id,
    transactions
  });
});

app.post('/api/use', requireAuth, (req, res) => {
  const { tool, toolLabel } = req.body;
  const user = req.user;

  if (user.credits < CREDITS_PER_USE) {
    return res.status(402).json({
      success: false,
      error: 'insufficient_credits',
      message: `You need ${CREDITS_PER_USE} credits to use this tool. You have ${user.credits} credits.`,
      credits: user.credits
    });
  }

  const newBalance = user.credits - CREDITS_PER_USE;
  db.run(`UPDATE users SET credits = ? WHERE id = ?`, [newBalance, user.id]);
  db.run(
    `INSERT INTO transactions (user_id, type, amount, description, tool, balance_after)
     VALUES (?, 'debit', ?, ?, ?, ?)`,
    [user.id, CREDITS_PER_USE, `Used: ${toolLabel || tool}`, tool || 'unknown', newBalance]
  );
  saveDB();

  res.json({ success: true, credits: newBalance, deducted: CREDITS_PER_USE, tool });
});

app.post('/api/redeem', requireAuth, (req, res) => {
  const { coupon } = req.body;
  const user = req.user;

  if (!coupon || typeof coupon !== 'string') {
    return res.status(400).json({ success: false, message: 'Invalid coupon code.' });
  }

  const code = coupon.trim().toUpperCase();
  const couponDef = COUPONS[code]; // looked up server-side only

  if (!couponDef) {
    return res.status(400).json({ success: false, message: `❌ Coupon code "${code}" is not valid.` });
  }

  const used = db.exec(
    `SELECT id FROM coupon_uses WHERE user_id = ? AND coupon = ?`,
    [user.id, code]
  );
  if (used.length && used[0].values.length) {
    return res.status(409).json({ success: false, message: `⚠️ You've already redeemed coupon "${code}".` });
  }

  const newBalance = user.credits + couponDef.credits;
  db.run(`UPDATE users SET credits = ? WHERE id = ?`, [newBalance, user.id]);
  db.run(
    `INSERT INTO coupon_uses (user_id, coupon, credits_added) VALUES (?, ?, ?)`,
    [user.id, code, couponDef.credits]
  );
  db.run(
    `INSERT INTO transactions (user_id, type, amount, description, balance_after)
     VALUES (?, 'credit', ?, ?, ?)`,
    [user.id, couponDef.credits, `Coupon: ${code} — ${couponDef.description}`, newBalance]
  );
  saveDB();

  res.json({
    success: true,
    message: `✅ Coupon redeemed! +${couponDef.credits} credits added.`,
    creditsAdded: couponDef.credits,
    credits: newBalance
  });
});

app.get('/api/transactions', requireAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({
    success: true,
    transactions: getTransactions(req.user.id, limit),
    credits: req.user.credits
  });
});

app.get('/api/stats', (req, res) => {
  const users = db.exec(`SELECT COUNT(*) FROM users`);
  const txns  = db.exec(`SELECT COUNT(*) FROM transactions`);
  const uses  = db.exec(`SELECT COUNT(*) FROM transactions WHERE type='debit'`);
  res.json({
    total_users: users[0]?.values[0][0] || 0,
    total_txns:  txns[0]?.values[0][0] || 0,
    total_uses:  uses[0]?.values[0][0] || 0,
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 Sujal Toolkit backend running at http://localhost:${PORT}`);
    console.log(`📊 Credits per new user : ${CREDITS_PER_NEW_USER}`);
    console.log(`💳 Credits per tool use : ${CREDITS_PER_USE}`);
    console.log(`🔐 Auth: email + password (sessions via cookie)\n`);
  });
});
