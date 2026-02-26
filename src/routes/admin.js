const express = require('express');
const { all, get, run } = require('../db');
const { requireAdmin, requireAdminSession } = require('../middleware');
const { clampInt } = require('../utils/validate');
const { createSession, cookieOptions } = require('./auth');

function adminRouter(db) {
  const router = express.Router();

  router.get('/admin/overview', requireAdmin, async (req, res) => {
    try {
      const [users, products, orders, settings] = await Promise.all([
        get(db, 'SELECT COUNT(*) as c FROM users', []),
        get(db, 'SELECT COUNT(*) as c FROM products WHERE is_deleted = 0', []),
        get(db, 'SELECT COUNT(*) as c FROM orders', []),
        get(db, 'SELECT fee_bps as feeBps, vip_fee_bps as vipFeeBps, platform_balance_cents as platformBalanceCents FROM platform_settings WHERE id = 1', []),
      ]);
      res.json({
        counts: {
          users: users.c,
          products: products.c,
          orders: orders.c,
        },
        settings,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  router.get('/admin/users', requireAdmin, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const params = [];
      let where = '1=1';
      if (q) {
        where += ' AND (email LIKE ? OR nick LIKE ?)';
        params.push(`%${q}%`, `%${q}%`);
      }
      const rows = await all(
        db,
        `SELECT id, email, nick, role, is_vip as isVip, is_banned as isBanned, wallet_balance_cents as walletBalanceCents, created_at as createdAt
           FROM users
          WHERE ${where}
          ORDER BY created_at DESC
          LIMIT 200`,
        params
      );
      res.json({ data: rows.map((u) => ({ ...u, isVip: !!u.isVip, isBanned: !!u.isBanned })) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  router.post('/admin/users/:id/ban', requireAdmin, async (req, res) => {
    try {
      const id = clampInt(req.params.id, 1, 1_000_000_000);
      if (!id) return res.status(400).json({ error: 'ID_INVALID' });
      const isBanned = req.body.isBanned ? 1 : 0;
      await run(db, 'UPDATE users SET is_banned = ? WHERE id = ?', [isBanned, id]);
      const now = new Date().toISOString();
      await run(
        db,
        `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'BAN_TOGGLE', 'USER', ?, ?, ?)` ,
        [req.user.id, id, JSON.stringify({ isBanned: !!isBanned }), now]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  router.post('/admin/users/:id/promote', requireAdmin, async (req, res) => {
    try {
      const id = clampInt(req.params.id, 1, 1_000_000_000);
      if (!id) return res.status(400).json({ error: 'ID_INVALID' });
      await run(db, "UPDATE users SET role = 'ADMIN' WHERE id = ?", [id]);
      const now = new Date().toISOString();
      await run(
        db,
        `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'PROMOTE_ADMIN', 'USER', ?, NULL, ?)` ,
        [req.user.id, id, now]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  router.post('/admin/users/:id/vip', requireAdmin, async (req, res) => {
    try {
      const id = clampInt(req.params.id, 1, 1_000_000_000);
      if (!id) return res.status(400).json({ error: 'ID_INVALID' });
      const isVip = req.body.isVip ? 1 : 0;
      await run(db, 'UPDATE users SET is_vip = ? WHERE id = ?', [isVip, id]);
      const now = new Date().toISOString();
      await run(
        db,
        `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'VIP_TOGGLE', 'USER', ?, ?, ?)` ,
        [req.user.id, id, JSON.stringify({ isVip: !!isVip }), now]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Products list (admin)
  router.get('/admin/products', requireAdmin, async (req, res) => {
    try {
      const rows = await all(
        db,
        `SELECT p.id, p.title, p.price_cents as priceCents, p.stock, p.is_hidden as isHidden, p.is_deleted as isDeleted,
                p.created_at as createdAt, u.nick as sellerNick
           FROM products p
           JOIN users u ON u.id = p.seller_id
          ORDER BY p.created_at DESC
          LIMIT 300`,
        []
      );
      res.json({ data: rows.map((p) => ({ ...p, isHidden: !!p.isHidden, isDeleted: !!p.isDeleted })) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  router.post('/admin/products/:id/hide', requireAdmin, async (req, res) => {
    try {
      const id = clampInt(req.params.id, 1, 1_000_000_000);
      if (!id) return res.status(400).json({ error: 'ID_INVALID' });
      const isHidden = req.body.isHidden ? 1 : 0;
      const now = new Date().toISOString();
      await run(db, 'UPDATE products SET is_hidden = ?, updated_at = ? WHERE id = ?', [isHidden, now, id]);
      await run(
        db,
        `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'PRODUCT_HIDE_TOGGLE', 'PRODUCT', ?, ?, ?)` ,
        [req.user.id, id, JSON.stringify({ isHidden: !!isHidden }), now]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Fee settings
  router.get('/admin/settings/fees', requireAdmin, async (req, res) => {
    const s = await get(db, 'SELECT fee_bps as feeBps, vip_fee_bps as vipFeeBps FROM platform_settings WHERE id = 1');
    res.json({ settings: s });
  });

  router.put('/admin/settings/fees', requireAdmin, async (req, res) => {
    try {
      const feeBps = clampInt(req.body.feeBps, 0, 5000);
      const vipFeeBps = clampInt(req.body.vipFeeBps, 0, 5000);
      if (feeBps === null || vipFeeBps === null) return res.status(400).json({ error: 'INVALID_INPUT' });
      const now = new Date().toISOString();
      await run(db, 'UPDATE platform_settings SET fee_bps = ?, vip_fee_bps = ?, updated_at = ? WHERE id = 1', [feeBps, vipFeeBps, now]);
      await run(
        db,
        `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, meta_json, created_at)
         VALUES (?, 'FEE_UPDATE', 'SETTINGS', 1, ?, ?)` ,
        [req.user.id, JSON.stringify({ feeBps, vipFeeBps }), now]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Impersonation (requires admin session even if not currently admin as active user)
  router.post('/admin/impersonate', requireAdminSession, async (req, res) => {
    try {
      const targetNick = String(req.body.nick || '').trim();
      const targetId = clampInt(req.body.userId, 1, 1_000_000_000);

      const target = targetId
        ? await get(db, 'SELECT id, nick, is_banned as isBanned FROM users WHERE id = ?', [targetId])
        : await get(db, 'SELECT id, nick, is_banned as isBanned FROM users WHERE nick = ?', [targetNick]);
      if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
      if (target.isBanned) return res.status(403).json({ error: 'TARGET_BANNED' });

      const adminId = req.adminSession.userId;
      const now = new Date().toISOString();
      const ip = req.ip;
      const userAgent = req.get('user-agent') || '';

      const log = await run(
        db,
        `INSERT INTO admin_impersonation_logs (admin_id, target_user_id, created_at, ip, user_agent)
         VALUES (?, ?, ?, ?, ?)` ,
        [adminId, target.id, now, ip, userAgent]
      );

      const sess = await createSession(db, res, target.id, {
        days: 1,
        impersonatorAdminId: adminId,
        impersonationLogId: log.lastID,
      });

      res.cookie('imp', sess.token, cookieOptions(req, 1));
      res.json({ ok: true, targetNick: target.nick });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  router.post('/admin/impersonation/stop', requireAdminSession, async (req, res) => {
    try {
      const imp = req.cookies?.imp;
      if (!imp) return res.json({ ok: true });
      const impHash = require('../utils/auth').hashToken(imp);
      const sess = await get(db, 'SELECT id, impersonation_log_id as logId FROM sessions WHERE token_hash = ?', [impHash]);
      if (sess?.logId) {
        const now = new Date().toISOString();
        await run(db, 'UPDATE admin_impersonation_logs SET ended_at = ? WHERE id = ? AND ended_at IS NULL', [now, sess.logId]);
      }
      await run(db, 'DELETE FROM sessions WHERE token_hash = ?', [impHash]).catch(() => {});
      res.clearCookie('imp');

      // Restore CSRF token from the admin session.
      const adminSid = req.cookies?.sid;
      if (adminSid) {
        const { hashToken } = require('../utils/auth');
        const adminSess = await get(db, 'SELECT csrf_token as csrfToken, expires_at as expiresAt FROM sessions WHERE token_hash = ?', [hashToken(adminSid)]);
        if (adminSess?.csrfToken) {
          const days = 7;
          res.cookie('csrf', adminSess.csrfToken, {
            httpOnly: false,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: days * 24 * 60 * 60 * 1000,
            path: '/',
          });
        }
      }

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  router.get('/admin/impersonation/logs', requireAdmin, async (req, res) => {
    try {
      const rows = await all(
        db,
        `SELECT l.id, a.nick as adminNick, t.nick as targetNick, l.created_at as createdAt, l.ended_at as endedAt, l.ip, l.user_agent as userAgent
           FROM admin_impersonation_logs l
           JOIN users a ON a.id = l.admin_id
           JOIN users t ON t.id = l.target_user_id
          ORDER BY l.created_at DESC
          LIMIT 100`,
        []
      );
      res.json({ data: rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  return router;
}

module.exports = { adminRouter };
