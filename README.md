# Sujal Wagholikar Toolkit — Credit System Backend

A professional Node.js + SQLite credit system with **email/password authentication** and per-user credit tracking.

---

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start

# OR for development (auto-restart on file changes):
npm run dev
```

Then open `http://localhost:3000` in your browser.

> ⚠️ **Important:** Delete any old `credits.db` before first run — the new schema has auth columns that are incompatible with the old format. A fresh DB is auto-created on startup.

---

## 📁 File Structure

```
toolkit-backend/
├── server.js         ← Express backend (auth + credit system API)
├── index.html        ← Toolkit frontend
├── credits.db        ← SQLite database (auto-created on first run)
├── package.json
├── package-lock.json
└── README.md
```

---

## 🔐 Authentication

Users register and log in with **email + password**. No third-party service needed.

- Passwords are hashed with **SHA-256 + random salt** (never stored plain)
- Sessions use a **random 32-byte token** stored as an httpOnly cookie (`tk_session`)
- Sessions expire after **30 days**
- Each browser/user gets a completely **isolated credit balance**

### Auth API

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create account → returns session + 100 free credits |
| `POST` | `/api/auth/login` | Log in → returns session |
| `POST` | `/api/auth/logout` | Destroys session |
| `GET` | `/api/auth/me` | Check if logged in (used on page load) |

---

## 💳 Credit System

| Event | Credits |
|---|---|
| New user signup | **+100** free credits |
| Every tool use | **−10** credits |

All credit routes require login. Unauthenticated requests return `401`.

### 🎟 Coupon Codes

Coupon codes are stored **server-side only** in `server.js` — they are never exposed in the frontend HTML or JavaScript.

To add or edit coupons, modify the `COUPONS` object in `server.js`:

```js
const COUPONS = {
  'SUJAL100':   { credits: 100,  description: '100 Bonus Credits' },
  'SUJAL500':   { credits: 500,  description: '500 Bonus Credits' },
  'SUJAL1000':  { credits: 1000, description: '1000 Bonus Credits' },
  'WELCOME50':  { credits: 50,   description: '50 Welcome Credits' },
  'TOOLKIT200': { credits: 200,  description: '200 Toolkit Credits' },
  // Add your own:
  'MYNEWCODE':  { credits: 250,  description: 'Custom Coupon' },
};
```

Each coupon can be redeemed **once per user account**.

---

## 🔌 API Endpoints

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/api/auth/me` | No | Check session status |
| `POST` | `/api/auth/register` | No | Register new account |
| `POST` | `/api/auth/login` | No | Login |
| `POST` | `/api/auth/logout` | No | Logout |
| `GET` | `/api/credits` | ✅ Yes | Balance + recent transactions |
| `POST` | `/api/use` | ✅ Yes | Deduct 10 credits for tool use |
| `POST` | `/api/redeem` | ✅ Yes | Redeem a coupon code |
| `GET` | `/api/transactions` | ✅ Yes | Full transaction history |
| `GET` | `/api/stats` | No | Site-wide stats (admin) |

---

## 🗄 Database Schema

```sql
users (id, email, password_hash, credits, created_at, last_seen)
sessions (token, user_id, expires_at)
transactions (id, user_id, type, amount, description, tool, balance_after, created_at)
coupon_uses (id, user_id, coupon, credits_added, used_at)
```

---

## ⚙️ Configuration

In `server.js`, near the top:

```js
const CREDITS_PER_NEW_USER = 100;   // free credits on signup
const CREDITS_PER_USE      = 10;    // credits per tool use
const PORT                 = 3000;  // server port
```
