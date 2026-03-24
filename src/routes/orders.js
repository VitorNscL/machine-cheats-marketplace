const express = require('express');
const path = require('path');
const fs = require('fs');
const { all, get, run } = require('../db');
const { requireAuth, requireNotBanned, requireAdmin } = require('../middleware');
const { clampInt } = require('../utils/validate');

function ordersRouter(db, { modFilesDir }) {
  const router = express.Router();

  // BUY
  router.post('/orders', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const productId = clampInt(req.body.productId, 1, 1_000_000_000);
      const qty = clampInt(req.body.qty, 1, 100);

      if (!productId || !qty) return res.status(400).json({ error: 'INVALID_INPUT' });

      // ✅ pega o produto + seller_id
      const p = await get(
        db,
        `SELECT p.id,
                p.price_cents as priceCents,
                p.stock,
                p.seller_id as sellerId
           FROM products p
          WHERE p.id = ? AND p.is_deleted = 0`,
        [productId]
      );

      if (!p) return res.status(404).json({ error: 'NOT_FOUND' });
      if (!p.sellerId) return res.status(500).json({ error: 'PRODUCT_WITHOUT_SELLER' });
      if (p.stock < qty) return res.status(400).json({ error: 'OUT_OF_STOCK' });

      const grossAmountCents = p.priceCents * qty;

      // Fee is based on the seller VIP status (not the buyer)
      const seller = await get(db, 'SELECT id, is_vip as isVip FROM users WHERE id = ?', [p.sellerId]);
      if (!seller) return res.status(400).json({ error: 'SELLER_NOT_FOUND' });

      const settings = await get(
        db,
        'SELECT fee_bps as feeBps, vip_fee_bps as vipFeeBps FROM platform_settings WHERE id = 1',
        []
      );
      if (!settings) return res.status(500).json({ error: 'SETTINGS_MISSING' });

      const feeBps = seller?.isVip ? settings.vipFeeBps : settings.feeBps;
      const feeAmountCents = Math.ceil((grossAmountCents * feeBps) / 10_000);
      const netAmountCents = grossAmountCents - feeAmountCents;

      const now = new Date();
      const nowIso = now.toISOString();
      const holdUntilIso = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(); // 48h

      await run(db, 'BEGIN');
      try {
        // ✅ re-check stock inside TX
        const fresh = await get(
          db,
          'SELECT stock, seller_id as sellerId, price_cents as priceCents FROM products WHERE id = ? AND is_deleted = 0',
          [productId]
        );
        if (!fresh || !fresh.sellerId) {
          await run(db, 'ROLLBACK');
          return res.status(400).json({ error: 'PRODUCT_MISSING' });
        }
        if (fresh.stock < qty) {
          await run(db, 'ROLLBACK');
          return res.status(400).json({ error: 'OUT_OF_STOCK' });
        }

        // ✅ buyer balance
        const buyer = await get(db, 'SELECT wallet_balance_cents as walletBalanceCents FROM users WHERE id = ?', [
          req.user.id,
        ]);
        if (!buyer || buyer.walletBalanceCents < grossAmountCents) {
          await run(db, 'ROLLBACK');
          return res.status(400).json({ error: 'INSUFFICIENT_FUNDS' });
        }

        // ✅ update stock + buyer wallet
        await run(db, 'UPDATE products SET stock = stock - ? WHERE id = ?', [qty, productId]);
        await run(db, 'UPDATE users SET wallet_balance_cents = wallet_balance_cents - ? WHERE id = ?', [
          grossAmountCents,
          req.user.id,
        ]);

        // ✅ Credit seller in PENDING (locked for 48h)
        await run(db, 'UPDATE users SET seller_pending_cents = seller_pending_cents + ? WHERE id = ?', [
          grossAmountCents,
          fresh.sellerId,
        ]);

        // ✅ IMPORTANT: orders needs seller_id (NOT NULL)
        const r = await run(
          db,
          `INSERT INTO orders (
             buyer_id, seller_id, product_id, qty,
             gross_amount_cents, fee_amount_cents, net_amount_cents,
             status, created_at, hold_until
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PAID_HOLD', ?, ?)`,
          [
            req.user.id,
            fresh.sellerId, // ✅ aqui estava faltando
            productId,
            qty,
            grossAmountCents,
            feeAmountCents,
            netAmountCents,
            nowIso,
            holdUntilIso,
          ]
        );

        await run(db, 'COMMIT');
        res.json({ ok: true, orderId: r.lastID, holdUntil: holdUntilIso });
      } catch (e) {
        await run(db, 'ROLLBACK');
        throw e;
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // My orders
  router.get('/me/orders', requireAuth, async (req, res) => {
    try {
      const rows = await all(
        db,
        `SELECT o.id, o.qty,
                o.gross_amount_cents as grossAmountCents,
                o.fee_amount_cents as feeAmountCents,
                o.net_amount_cents as netAmountCents,
                o.status, o.created_at as createdAt,
                o.hold_until as holdUntil, o.released_at as releasedAt, o.refunded_at as refundedAt,
                p.id as productId, p.title as productTitle,
                s.nick as sellerNick
           FROM orders o
           JOIN products p ON p.id = o.product_id
           JOIN users s ON s.id = p.seller_id
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

  // Download mod file (only for buyers with PAID_HOLD or RELEASED order)
  router.get('/download/:productId', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const productId = clampInt(req.params.productId, 1, 1_000_000_000);
      if (!productId) return res.status(400).end();

      const order = await get(
        db,
        `SELECT id
           FROM orders
          WHERE buyer_id = ? AND product_id = ? AND status IN ('PAID_HOLD','RELEASED')
          ORDER BY created_at DESC
          LIMIT 1`,
        [req.user.id, productId]
      );
      if (!order) return res.status(403).json({ error: 'NOT_PURCHASED' });

      const product = await get(
        db,
        'SELECT title, file_key as fileKey FROM products WHERE id = ? AND is_deleted = 0',
        [productId]
      );
      if (!product) return res.status(404).end();

      const filePath = path.join(modFilesDir, product.fileKey);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'FILE_MISSING' });

      const safeTitle = String(product.title || 'mod')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .slice(0, 50);
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
        `SELECT o.id, o.qty,
                o.gross_amount_cents as grossAmountCents,
                o.fee_amount_cents as feeAmountCents,
                o.net_amount_cents as netAmountCents,
                o.status, o.created_at as createdAt,
                o.hold_until as holdUntil, o.released_at as releasedAt, o.refunded_at as refundedAt,
                b.nick as buyerNick, s.nick as sellerNick,
                p.title as productTitle
           FROM orders o
           JOIN products p ON p.id = o.product_id
           JOIN users b ON b.id = o.buyer_id
           JOIN users s ON s.id = p.seller_id
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

  // Refund (ADMIN) - only while funds are still in HOLD window
  router.post('/admin/orders/:id/refund', requireAdmin, async (req, res) => {
    try {
      const orderId = clampInt(req.params.id, 1, 1_000_000_000);
      if (!orderId) return res.status(400).json({ error: 'ID_INVALID' });

      const o = await get(
        db,
        `SELECT o.id, o.status, o.buyer_id as buyerId, o.product_id as productId, o.qty,
                o.gross_amount_cents as grossAmountCents,
                o.hold_until as holdUntil
           FROM orders o
          WHERE o.id = ?`,
        [orderId]
      );
      if (!o) return res.status(404).json({ error: 'NOT_FOUND' });
      if (o.status !== 'PAID_HOLD') return res.status(400).json({ error: 'NOT_REFUNDABLE' });

      const now = new Date();
      if (o.holdUntil && new Date(o.holdUntil).getTime() <= now.getTime()) {
        return res.status(400).json({ error: 'HOLD_EXPIRED' });
      }

      const p = await get(db, 'SELECT seller_id as sellerId FROM products WHERE id = ?', [o.productId]);
      if (!p) return res.status(400).json({ error: 'PRODUCT_MISSING' });

      const nowIso = now.toISOString();

      await run(db, 'BEGIN');
      try {
        await run(db, "UPDATE orders SET status = 'REFUNDED', refunded_at = ? WHERE id = ?", [nowIso, orderId]);
        await run(db, 'UPDATE products SET stock = stock + ? WHERE id = ?', [o.qty, o.productId]);

        // Return money to buyer
        await run(db, 'UPDATE users SET wallet_balance_cents = wallet_balance_cents + ? WHERE id = ?', [
          o.grossAmountCents,
          o.buyerId,
        ]);

        // Remove from seller pending
        await run(db, 'UPDATE users SET seller_pending_cents = seller_pending_cents - ? WHERE id = ?', [
          o.grossAmountCents,
          p.sellerId,
        ]);

        // Audit
        await run(
          db,
          `INSERT INTO admin_audit_logs (admin_id, action, meta_json, created_at)
           VALUES (?, 'ORDER_REFUND', ?, ?)`,
          [
            req.user.id,
            JSON.stringify({ orderId, buyerId: o.buyerId, sellerId: p.sellerId, grossAmountCents: o.grossAmountCents }),
            nowIso,
          ]
        );

        await run(db, 'COMMIT');
      } catch (e) {
        await run(db, 'ROLLBACK');
        throw e;
      }

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  return router;
}

module.exports = { ordersRouter };