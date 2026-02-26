const express = require('express');
const path = require('path');
const fs = require('fs');
const { all, get, run } = require('../db');
const { requireAuth, requireNotBanned, requireAdmin } = require('../middleware');
const { clampInt } = require('../utils/validate');

function ordersRouter(db, { modFilesDir }) {
  const router = express.Router();

  router.post('/orders', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const productId = clampInt(req.body.productId, 1, 1_000_000_000);
      const qty = clampInt(req.body.qty || 1, 1, 100);
      if (!productId || !qty) return res.status(400).json({ error: 'INVALID_INPUT' });

      const product = await get(
        db,
        `SELECT p.id, p.seller_id as sellerId, p.price_cents as priceCents, p.stock, p.title
           FROM products p
          WHERE p.id = ? AND p.is_deleted = 0`,
        [productId]
      );
      if (!product) return res.status(404).json({ error: 'NOT_FOUND' });
      if (product.stock < qty) return res.status(400).json({ error: 'OUT_OF_STOCK' });
      if (product.sellerId === req.user.id) return res.status(400).json({ error: 'CANNOT_BUY_OWN_PRODUCT' });

      const settings = await get(db, 'SELECT fee_bps as feeBps, vip_fee_bps as vipFeeBps FROM platform_settings WHERE id = 1');
      const feeBps = req.user.isVip ? settings.vipFeeBps : settings.feeBps;

      const gross = product.priceCents * qty;
      const fee = Math.round((gross * feeBps) / 10000);
      const net = gross - fee;

      // Wallet demo
      const buyer = await get(db, 'SELECT wallet_balance_cents as wallet FROM users WHERE id = ?', [req.user.id]);
      if ((buyer?.wallet || 0) < gross) {
        return res.status(400).json({ error: 'INSUFFICIENT_WALLET', neededCents: gross, walletCents: buyer?.wallet || 0 });
      }

      const now = new Date().toISOString();

      await run(db, 'BEGIN IMMEDIATE TRANSACTION');
      try {
        // Re-check stock inside transaction
        const p2 = await get(db, 'SELECT stock FROM products WHERE id = ? AND is_deleted = 0', [productId]);
        if (!p2 || p2.stock < qty) {
          await run(db, 'ROLLBACK');
          return res.status(400).json({ error: 'OUT_OF_STOCK' });
        }

        await run(db, 'UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?', [qty, now, productId]);
        await run(db, 'UPDATE users SET wallet_balance_cents = wallet_balance_cents - ? WHERE id = ?', [gross, req.user.id]);
        await run(db, 'UPDATE users SET seller_balance_cents = seller_balance_cents + ? WHERE id = ?', [net, product.sellerId]);
        await run(db, 'UPDATE platform_settings SET platform_balance_cents = platform_balance_cents + ?, updated_at = ? WHERE id = 1', [fee, now]);

        const result = await run(
          db,
          `INSERT INTO orders (buyer_id, seller_id, product_id, qty, gross_amount_cents, fee_amount_cents, net_amount_cents, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'PAID', ?)` ,
          [req.user.id, product.sellerId, productId, qty, gross, fee, net, now]
        );
        await run(db, 'COMMIT');
        res.json({ ok: true, orderId: result.lastID });
      } catch (e) {
        await run(db, 'ROLLBACK');
        throw e;
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  router.get('/me/orders', requireAuth, async (req, res) => {
    try {
      const rows = await all(
        db,
        `SELECT o.id, o.qty, o.gross_amount_cents as grossAmountCents, o.fee_amount_cents as feeAmountCents, o.net_amount_cents as netAmountCents,
                o.status, o.created_at as createdAt,
                p.id as productId, p.title as productTitle,
                s.nick as sellerNick
           FROM orders o
           JOIN products p ON p.id = o.product_id
           JOIN users s ON s.id = o.seller_id
          WHERE o.buyer_id = ?
          ORDER BY o.created_at DESC
          LIMIT 200`,
        [req.user.id]
      );
      res.json({
        data: rows.map((r) => ({
          ...r,
          product: { id: r.productId, title: r.productTitle, imageUrl: `/api/products/${r.productId}/image` },
          seller: { nick: r.sellerNick },
        })),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Download mod file (only for buyers with PAID order)
  router.get('/download/:productId', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const productId = clampInt(req.params.productId, 1, 1_000_000_000);
      if (!productId) return res.status(400).end();
      const order = await get(
        db,
        `SELECT id FROM orders WHERE buyer_id = ? AND product_id = ? AND status = 'PAID' ORDER BY created_at DESC LIMIT 1`,
        [req.user.id, productId]
      );
      if (!order) return res.status(403).json({ error: 'NOT_PURCHASED' });
      const product = await get(db, 'SELECT title, file_key as fileKey FROM products WHERE id = ? AND is_deleted = 0', [productId]);
      if (!product) return res.status(404).end();
      const filePath = path.join(modFilesDir, product.fileKey);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'FILE_MISSING' });

      const safeTitle = String(product.title || 'mod').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 50);
      const ext = path.extname(product.fileKey || '').toLowerCase() || '.zip';
      res.download(filePath, `${safeTitle}${ext}`);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Admin: all transactions
  router.get('/admin/transactions', requireAdmin, async (req, res) => {
    try {
      const rows = await all(
        db,
        `SELECT o.id, o.qty, o.gross_amount_cents as grossAmountCents, o.fee_amount_cents as feeAmountCents, o.net_amount_cents as netAmountCents,
                o.status, o.created_at as createdAt,
                b.nick as buyerNick, s.nick as sellerNick,
                p.title as productTitle
           FROM orders o
           JOIN users b ON b.id = o.buyer_id
           JOIN users s ON s.id = o.seller_id
           JOIN products p ON p.id = o.product_id
          ORDER BY o.created_at DESC
          LIMIT 500`,
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

module.exports = { ordersRouter };
