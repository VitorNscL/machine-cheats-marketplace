const express = require('express');
const { get, run } = require('../db');
const { hashPassword, verifyPassword, randomToken, hashToken } = require('../utils/auth');
const {
  isValidEmail,
  normalizeEmail,
  normalizeNick,
  isValidNick,
  isValidPassword,
} = require('../utils/validate');

function cookieOptions(req, days) {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: days * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

function cookieOptionsReadable(req, days) {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: false,
    sameSite: 'lax',
    secure: isProd,
    maxAge: days * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

async function createSession(db, res, userId, { days = 7, impersonatorAdminId = null, impersonationLogId = null } = {}) {
  const token = randomToken(32);
  const csrfToken = randomToken(16);
  const tokenHash = hashToken(token);
  const now = new Date();
  const expires = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  await run(
    db,
    `INSERT INTO sessions (user_id, token_hash, csrf_token, created_at, expires_at, impersonator_admin_id, impersonation_log_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)` ,
    [
      userId,
      tokenHash,
      csrfToken,
      now.toISOString(),
      expires.toISOString(),
      impersonatorAdminId,
      impersonationLogId,
    ]
  );

  // sid/imp cookie is set by caller.
  res.cookie('csrf', csrfToken, cookieOptionsReadable(res.req, days));
  return { token, csrfToken, expiresAt: expires.toISOString() };
}

function authRouter(db) {
  const router = express.Router();

  // Register
  router.post('/register', async (req, res) => {
    try {
      const email = normalizeEmail(req.body.email);
      const password = String(req.body.password || '');
      const nick = normalizeNick(req.body.nick);

      if (!isValidEmail(email)) return res.status(400).json({ error: 'EMAIL_INVALID' });
      if (!isValidPassword(password)) return res.status(400).json({ error: 'PASSWORD_WEAK', min: 8 });
      if (!isValidNick(nick)) return res.status(400).json({ error: 'NICK_INVALID' });

      const existingEmail = await get(db, 'SELECT id FROM users WHERE email = ?', [email]);
      if (existingEmail) return res.status(409).json({ error: 'EMAIL_TAKEN' });
      const existingNick = await get(db, 'SELECT id FROM users WHERE nick = ?', [nick]);
      if (existingNick) return res.status(409).json({ error: 'NICK_TAKEN' });

      const passwordHash = await hashPassword(password);
      const nowIso = new Date().toISOString();

      // Give a small demo wallet balance so purchases can be tested.
      const demoWalletCents = 20000; // R$ 200,00

      const result = await run(
        db,
        `INSERT INTO users (email, password_hash, nick, display_name, bio, avatar_key, role, is_vip, is_banned, wallet_balance_cents, seller_balance_cents, created_at)
         VALUES (?, ?, ?, ?, '', NULL, 'USER', 0, 0, ?, 0, ?)` ,
        [email, passwordHash, nick, nick, demoWalletCents, nowIso]
      );

      const userId = result.lastID;
      const sess = await createSession(db, res, userId);
      res.cookie('sid', sess.token, cookieOptions(req, 7));

      const user = await get(
        db,
        `SELECT id, email, nick, display_name as displayName, bio, avatar_key as avatarKey,
                role, is_vip as isVip, is_banned as isBanned,
                wallet_balance_cents as walletBalanceCents, seller_balance_cents as sellerBalanceCents,
                created_at as createdAt
           FROM users WHERE id = ?`,
        [userId]
      );

      res.json({ ok: true, user });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Login
  router.post('/login', async (req, res) => {
    try {
      const email = normalizeEmail(req.body.email);
      const password = String(req.body.password || '');
      if (!isValidEmail(email)) return res.status(400).json({ error: 'EMAIL_INVALID' });

      const user = await get(
        db,
        `SELECT id, email, password_hash as passwordHash, role, is_banned as isBanned
           FROM users WHERE email = ?`,
        [email]
      );
      if (!user) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      if (user.isBanned) return res.status(403).json({ error: 'BANNED' });

      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

      const sess = await createSession(db, res, user.id);
      res.cookie('sid', sess.token, cookieOptions(req, 7));
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Logout
  router.post('/logout', async (req, res) => {
    try {
      const sid = req.cookies?.sid;
      const imp = req.cookies?.imp;
      if (sid) {
        await run(db, 'DELETE FROM sessions WHERE token_hash = ?', [hashToken(sid)]).catch(() => {});
      }
      if (imp) {
        await run(db, 'DELETE FROM sessions WHERE token_hash = ?', [hashToken(imp)]).catch(() => {});
      }
      res.clearCookie('sid');
      res.clearCookie('imp');
      res.clearCookie('csrf');
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  return router;
}

module.exports = {
  authRouter,
  createSession,
  cookieOptions,
  cookieOptionsReadable,
};
