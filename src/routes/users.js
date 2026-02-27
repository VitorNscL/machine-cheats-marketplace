const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { all, get, run } = require('../db');
const { requireAuth, requireNotBanned } = require('../middleware');
const { clampInt, maskCPF } = require('../utils/validate');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function usersRouter(db, { avatarDir }) {
  const router = express.Router();

  // ✅ FIX: define upload (avatar)
  ensureDir(avatarDir);

  const upload = multer({
    dest: avatarDir,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
      const ok = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.mimetype);
      cb(ok ? null : new Error('INVALID_FILE_TYPE'), ok);
    },
  });

  // /api/me
  router.get('/me', async (req, res) => {
    if (!req.user) return res.json({ user: null });

    // If impersonating, also return impersonator basic info
    let impersonator = null;
    if (req.isImpersonating && req.impersonatorAdminId) {
      impersonator = await get(db, 'SELECT id, nick, email FROM users WHERE id = ?', [req.impersonatorAdminId]);
    }

    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        nick: req.user.nick,
        displayName: req.user.displayName,
        bio: req.user.bio,
        role: req.user.role,
        isVip: req.user.isVip,
        isBanned: req.user.isBanned,
        walletBalanceCents: req.user.walletBalanceCents,
        sellerBalanceCents: req.user.sellerBalanceCents,
        sellerPendingCents: req.user.sellerPendingCents,
        avatarUrl: `/api/users/${encodeURIComponent(req.user.nick)}/avatar`,
      },
      session: {
        isImpersonating: req.isImpersonating,
        impersonator,
      },
    });
  });

    // Public profile
  router.get('/users/:nick', async (req, res) => {
    try {
      const nick = String(req.params.nick || '').trim();

      const u = await get(
        db,
        `SELECT id, nick, display_name as displayName, bio, role,
                is_vip as isVip, is_banned as isBanned,
                created_at as createdAt
           FROM users
          WHERE nick = ?`,
        [nick]
      );
      if (!u) return res.status(404).json({ error: 'NOT_FOUND' });

      const ratingAgg = await get(
        db,
        `SELECT AVG(rating) as avgRating, COUNT(*) as count
           FROM profile_ratings
          WHERE to_user_id = ?`,
        [u.id]
      );

      const avg = ratingAgg?.avgRating ? Number(ratingAgg.avgRating) : 0;
      const count = ratingAgg?.count ? Number(ratingAgg.count) : 0;

      // Viewer permissions
      const viewer = { isOwner: false, canRate: false, existingRating: null };

      if (req.user) {
        viewer.isOwner = req.user.id === u.id;

        if (!viewer.isOwner) {
          // ✅ prova de compra (compatível com PAID_HOLD/RELEASED e sem depender de orders.seller_id)
          const order = await get(
            db,
            `SELECT o.id
               FROM orders o
               JOIN products p ON p.id = o.product_id
              WHERE o.buyer_id = ?
                AND p.seller_id = ?
                AND o.status IN ('PAID_HOLD','RELEASED','PAID')
              ORDER BY o.created_at DESC
              LIMIT 1`,
            [req.user.id, u.id]
          );
          viewer.canRate = !!order;

          const existing = await get(
            db,
            `SELECT rating, comment,
                    order_id as orderId,
                    created_at as createdAt,
                    updated_at as updatedAt
               FROM profile_ratings
              WHERE from_user_id = ? AND to_user_id = ?`,
            [req.user.id, u.id]
          );
          viewer.existingRating = existing || null;
        }
      }

      // ✅ resposta do perfil público é o "u"
      // ✅ só manda saldos se for o dono do perfil
      const isOwner = req.user && req.user.id === u.id;

      res.json({
        user: {
          id: u.id,
          nick: u.nick,
          displayName: u.displayName,
          bio: u.bio,
          role: u.role,
          isVip: !!u.isVip,
          isBanned: !!u.isBanned,
          createdAt: u.createdAt,
          avatarUrl: `/api/users/${encodeURIComponent(u.nick)}/avatar`,
          rating: { avg, count },

          ...(isOwner
            ? {
                walletBalanceCents: req.user.walletBalanceCents || 0,
                sellerBalanceCents: req.user.sellerBalanceCents || 0,
                sellerPendingCents: req.user.sellerPendingCents || 0,
              }
            : {}),
        },
        viewer,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Public: seller products for profile showcase
  router.get('/users/:nick/products', async (req, res) => {
    try {
      const nick = String(req.params.nick || '').trim();
      const seller = await get(db, 'SELECT id FROM users WHERE nick = ?', [nick]);
      if (!seller) return res.status(404).json({ error: 'NOT_FOUND' });
      const products = await all(
        db,
        `SELECT p.id, p.title, p.description, p.price_cents as priceCents, p.stock,
                p.created_at as createdAt
           FROM products p
          WHERE p.seller_id = ? AND p.is_hidden = 0 AND p.is_deleted = 0
          ORDER BY p.created_at DESC`,
        [seller.id]
      );
      res.json({ data: products.map((p) => ({ ...p, imageUrl: `/api/products/${p.id}/image` })) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Update profile (owner)
  router.put('/me/profile', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const displayName = String(req.body.displayName || '').trim().slice(0, 40);
      const bio = String(req.body.bio || '').trim().slice(0, 500);
      await run(db, 'UPDATE users SET display_name = ?, bio = ? WHERE id = ?', [displayName || null, bio, req.user.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Upload avatar (owner)
  router.post('/me/avatar', requireAuth, requireNotBanned, upload.single('avatar'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'NO_FILE' });
      const key = req.file.filename;
      await run(db, 'UPDATE users SET avatar_key = ? WHERE id = ?', [key, req.user.id]);
      res.json({ ok: true, avatarUrl: `/api/users/${encodeURIComponent(req.user.nick)}/avatar?ts=${Date.now()}` });
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: 'UPLOAD_ERROR' });
    }
  });

  // Serve avatar (public)
  router.get('/users/:nick/avatar', async (req, res) => {
    try {
      const nick = String(req.params.nick || '').trim();
      const u = await get(db, 'SELECT avatar_key as avatarKey FROM users WHERE nick = ?', [nick]);
      const avatarKey = u?.avatarKey;
      const fallback = path.join(__dirname, '..', '..', 'public', 'img', 'avatar-default.svg');

      if (!avatarKey) {
        if (fs.existsSync(fallback)) return res.sendFile(fallback);
        return res.status(204).end();
      }

      const filePath = path.join(avatarDir, avatarKey);
      if (!fs.existsSync(filePath)) {
        if (fs.existsSync(fallback)) return res.sendFile(fallback);
        return res.status(204).end();
      }

      res.sendFile(filePath);
    } catch (err) {
      console.error(err);
      res.status(500).end();
    }
  });

  // Profile ratings
  router.get('/users/:nick/ratings', async (req, res) => {
    try {
      const nick = String(req.params.nick || '').trim();
      const u = await get(db, 'SELECT id FROM users WHERE nick = ?', [nick]);
      if (!u) return res.status(404).json({ error: 'NOT_FOUND' });

      const rows = await all(
        db,
        `SELECT pr.rating, pr.comment, pr.created_at as createdAt, pr.updated_at as updatedAt,
                fu.nick as fromNick
           FROM profile_ratings pr
           JOIN users fu ON fu.id = pr.from_user_id
          WHERE pr.to_user_id = ?
          ORDER BY pr.created_at DESC
          LIMIT 50`,
        [u.id]
      );

      res.json({ data: rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  router.post('/users/:nick/ratings', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const nick = String(req.params.nick || '').trim();
      const to = await get(db, 'SELECT id FROM users WHERE nick = ?', [nick]);
      if (!to) return res.status(404).json({ error: 'NOT_FOUND' });
      if (to.id === req.user.id) return res.status(400).json({ error: 'CANNOT_RATE_SELF' });

      const rating = clampInt(req.body.rating, 0, 5);
      if (rating === null) return res.status(400).json({ error: 'RATING_INVALID' });
      const comment = String(req.body.comment || '').trim().slice(0, 500);

      // Proof of purchase: at least 1 PAID order with this seller
      const order = await get(
        db,
        `SELECT id FROM orders WHERE buyer_id = ? AND seller_id = ? AND status = 'PAID' ORDER BY created_at DESC LIMIT 1`,
        [req.user.id, to.id]
      );
      if (!order) return res.status(403).json({ error: 'PURCHASE_REQUIRED' });

      const existing = await get(
        db,
        `SELECT id FROM profile_ratings WHERE from_user_id = ? AND to_user_id = ?`,
        [req.user.id, to.id]
      );

      const now = new Date().toISOString();
      if (existing) {
        await run(
          db,
          `UPDATE profile_ratings SET rating = ?, comment = ?, order_id = ?, updated_at = ? WHERE id = ?`,
          [rating, comment || null, order.id, now, existing.id]
        );
      } else {
        await run(
          db,
          `INSERT INTO profile_ratings (from_user_id, to_user_id, rating, comment, order_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [req.user.id, to.id, rating, comment || null, order.id, now]
        );
      }

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Withdrawals (seller converts wallet -> PIX CPF)
  router.get('/me/withdrawals', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const rows = await all(
        db,
        `SELECT id,
                gross_amount_cents as grossAmountCents,
                fee_bps as feeBps,
                fee_amount_cents as feeAmountCents,
                net_amount_cents as netAmountCents,
                pix_cpf as pixCpf,
                receipt_code as receiptCode,
                status,
                created_at as createdAt,
                paid_at as paidAt
           FROM withdrawals
          WHERE seller_id = ?
          ORDER BY created_at DESC
          LIMIT 100`,
        [req.user.id]
      );
      res.json({ ok: true, withdrawals: rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  router.post('/me/withdraw', requireAuth, requireNotBanned, async (req, res) => {
    try {
      if (!req.user.cpf) return res.status(400).json({ error: 'CPF_REQUIRED' });

      const amountCents = clampInt(req.body.amountCents, 1, 100_000_000); // up to R$ 1M
      if (!amountCents) return res.status(400).json({ error: 'AMOUNT_INVALID' });

      // Must have available seller balance
      const u = await get(
        db,
        'SELECT seller_balance_cents as sellerBalanceCents, is_vip as isVip, cpf FROM users WHERE id = ?',
        [req.user.id]
      );
      if (!u) return res.status(401).json({ error: 'UNAUTHORIZED' });
      if (u.cpf !== req.user.cpf) return res.status(400).json({ error: 'CPF_MISMATCH' });

      if (u.sellerBalanceCents < amountCents) return res.status(400).json({ error: 'INSUFFICIENT_SELLER_BALANCE' });

      // No extra fee on withdrawal; platform fee is applied on sale release.
      const feeBps = 0;
      const feeAmountCents = 0;
      const netAmountCents = amountCents;

      const receiptCode = `PIX-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase()}`;
      const nowIso = new Date().toISOString();

      await run(db, 'BEGIN');
      try {
        await run(db, 'UPDATE users SET seller_balance_cents = seller_balance_cents - ? WHERE id = ?', [
          amountCents,
          req.user.id,
        ]);

        await run(
          db,
          `INSERT INTO withdrawals (
             seller_id, gross_amount_cents, fee_bps, fee_amount_cents, net_amount_cents,
             pix_cpf, receipt_code, status, created_at, paid_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PAID', ?, ?)`,
          [req.user.id, amountCents, feeBps, feeAmountCents, netAmountCents, req.user.cpf, receiptCode, nowIso, nowIso]
        );

        await run(db, 'COMMIT');
      } catch (e) {
        await run(db, 'ROLLBACK');
        throw e;
      }

      res.json({
        ok: true,
        receipt: {
          receiptCode,
          grossAmountCents: amountCents,
          feeBps,
          feeAmountCents,
          netAmountCents,
          pixCpf: maskCPF(req.user.cpf),
          paidAt: nowIso,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  return router;
}

module.exports = { usersRouter };