const express = require('express');
const { all, get, run } = require('../db');
const { requireAuth, requireNotBanned } = require('../middleware');
const { clampInt } = require('../utils/validate');

function interactionsRouter(db) {
  const router = express.Router();

  // Questions
  router.get('/products/:id/questions', async (req, res) => {
    try {
      const productId = clampInt(req.params.id, 1, 1_000_000_000);
      if (!productId) return res.status(400).json({ error: 'ID_INVALID' });
      const rows = await all(
        db,
        `SELECT q.id, q.text, q.created_at as createdAt,
                au.nick as authorNick,
                a.id as answerId, a.text as answerText, a.created_at as answerCreatedAt,
                su.nick as answerAuthorNick
           FROM product_questions q
           JOIN users au ON au.id = q.author_id
      LEFT JOIN product_answers a ON a.question_id = q.id
      LEFT JOIN users su ON su.id = a.author_id
          WHERE q.product_id = ?
          ORDER BY q.created_at DESC
          LIMIT 100`,
        [productId]
      );
      res.json({ data: rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  router.post('/products/:id/questions', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const productId = clampInt(req.params.id, 1, 1_000_000_000);
      if (!productId) return res.status(400).json({ error: 'ID_INVALID' });
      const text = String(req.body.text || '').trim().slice(0, 500);
      if (!text) return res.status(400).json({ error: 'TEXT_REQUIRED' });

      const product = await get(db, 'SELECT id FROM products WHERE id = ? AND is_deleted = 0', [productId]);
      if (!product) return res.status(404).json({ error: 'NOT_FOUND' });

      const now = new Date().toISOString();
      await run(
        db,
        `INSERT INTO product_questions (product_id, author_id, text, created_at)
         VALUES (?, ?, ?, ?)`,
        [productId, req.user.id, text, now]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  router.post('/questions/:id/answer', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const questionId = clampInt(req.params.id, 1, 1_000_000_000);
      if (!questionId) return res.status(400).json({ error: 'ID_INVALID' });
      const text = String(req.body.text || '').trim().slice(0, 500);
      if (!text) return res.status(400).json({ error: 'TEXT_REQUIRED' });

      const q = await get(
        db,
        `SELECT q.id, q.product_id as productId, p.seller_id as sellerId
           FROM product_questions q
           JOIN products p ON p.id = q.product_id
          WHERE q.id = ?`,
        [questionId]
      );
      if (!q) return res.status(404).json({ error: 'NOT_FOUND' });

      const isSeller = q.sellerId === req.user.id;
      const isAdmin = req.user.role === 'ADMIN' && !req.isImpersonating;
      if (!isSeller && !isAdmin) return res.status(403).json({ error: 'FORBIDDEN' });

      const existing = await get(db, 'SELECT id FROM product_answers WHERE question_id = ?', [questionId]);
      const now = new Date().toISOString();
      if (existing) {
        await run(db, 'UPDATE product_answers SET text = ?, created_at = ? WHERE id = ?', [text, now, existing.id]);
      } else {
        await run(
          db,
          `INSERT INTO product_answers (question_id, author_id, text, created_at)
           VALUES (?, ?, ?, ?)`,
          [questionId, req.user.id, text, now]
        );
      }

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Reviews
  router.get('/products/:id/reviews', async (req, res) => {
    try {
      const productId = clampInt(req.params.id, 1, 1_000_000_000);
      if (!productId) return res.status(400).json({ error: 'ID_INVALID' });
      const rows = await all(
        db,
        `SELECT r.rating, r.comment, r.created_at as createdAt, r.updated_at as updatedAt,
                u.nick as buyerNick
           FROM product_reviews r
           JOIN users u ON u.id = r.buyer_id
          WHERE r.product_id = ?
          ORDER BY r.created_at DESC
          LIMIT 50`,
        [productId]
      );
      res.json({ data: rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  router.post('/products/:id/reviews', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const productId = clampInt(req.params.id, 1, 1_000_000_000);
      if (!productId) return res.status(400).json({ error: 'ID_INVALID' });
      const rating = clampInt(req.body.rating, 0, 5);
      if (rating === null) return res.status(400).json({ error: 'RATING_INVALID' });
      const comment = String(req.body.comment || '').trim().slice(0, 500);

      const order = await get(
        db,
        `SELECT id FROM orders WHERE buyer_id = ? AND product_id = ? AND status = 'PAID' ORDER BY created_at DESC LIMIT 1`,
        [req.user.id, productId]
      );
      if (!order) return res.status(403).json({ error: 'PURCHASE_REQUIRED' });

      const existing = await get(
        db,
        `SELECT id FROM product_reviews WHERE buyer_id = ? AND product_id = ?`,
        [req.user.id, productId]
      );
      const now = new Date().toISOString();
      if (existing) {
        await run(
          db,
          `UPDATE product_reviews SET rating = ?, comment = ?, order_id = ?, updated_at = ? WHERE id = ?`,
          [rating, comment || null, order.id, now, existing.id]
        );
      } else {
        await run(
          db,
          `INSERT INTO product_reviews (product_id, buyer_id, rating, comment, order_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [productId, req.user.id, rating, comment || null, order.id, now]
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

module.exports = { interactionsRouter };
