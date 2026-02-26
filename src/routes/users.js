const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { all, get, run } = require('../db');
const { requireAuth, requireNotBanned } = require('../middleware');
const { clampInt } = require('../utils/validate');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function usersRouter(db, { avatarDir }) {
  const router = express.Router();

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
        `SELECT id, nick, display_name as displayName, bio, role, is_vip as isVip, created_at as createdAt
           FROM users WHERE nick = ?`,
        [nick]
      );
      if (!u) return res.status(404).json({ error: 'NOT_FOUND' });

      const ratingAgg = await get(
        db,
        `SELECT AVG(rating) as avgRating, COUNT(*) as count
           FROM profile_ratings WHERE to_user_id = ?`,
        [u.id]
      );

      const avg = ratingAgg?.avgRating ? Number(ratingAgg.avgRating) : 0;
      const count = ratingAgg?.count ? Number(ratingAgg.count) : 0;

      // Viewer permissions
      let viewer = { isOwner: false, canRate: false, existingRating: null };
      if (req.user) {
        viewer.isOwner = req.user.id === u.id;
        if (!viewer.isOwner) {
          // Can rate only if bought at least 1 product from this seller
          const order = await get(
            db,
            `SELECT id FROM orders WHERE buyer_id = ? AND seller_id = ? AND status = 'PAID' LIMIT 1`,
            [req.user.id, u.id]
          );
          viewer.canRate = !!order;
          const existing = await get(
            db,
            `SELECT rating, comment, order_id as orderId, created_at as createdAt, updated_at as updatedAt
               FROM profile_ratings WHERE from_user_id = ? AND to_user_id = ?`,
            [req.user.id, u.id]
          );
          viewer.existingRating = existing || null;
        }
      }

      res.json({
        user: {
          id: u.id,
          nick: u.nick,
          displayName: u.displayName,
          bio: u.bio,
          role: u.role,
          isVip: !!u.isVip,
          avatarUrl: `/api/users/${encodeURIComponent(u.nick)}/avatar`,
          createdAt: u.createdAt,
          rating: { avg, count },
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

  // Demo wallet top-up (portfolio)
  router.post('/me/wallet/topup', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const amountCents = clampInt(req.body.amountCents, 100, 500000); // R$ 1,00 to R$ 5.000,00
      if (amountCents === null) return res.status(400).json({ error: 'INVALID_AMOUNT' });
      await run(db, 'UPDATE users SET wallet_balance_cents = wallet_balance_cents + ? WHERE id = ?', [amountCents, req.user.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Avatar upload
  ensureDir(avatarDir);
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, avatarDir),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png';
        const name = `avatar_u${req.user.id}_${Date.now()}${safeExt}`;
        cb(null, name);
      },
    }),
    limits: {
      fileSize: 2 * 1024 * 1024, // 2MB
    },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return cb(new Error('INVALID_FILE_TYPE'));
      cb(null, true);
    },
  });

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

  return router;
}

module.exports = { usersRouter };
