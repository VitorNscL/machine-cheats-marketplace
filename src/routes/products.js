const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { all, get, run } = require('../db');
const { requireAuth, requireNotBanned } = require('../middleware');
const { clampInt, parseMoneyToCents } = require('../utils/validate');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function productsRouter(db, { imagesDir, modFilesDir }) {
  const router = express.Router();

  ensureDir(imagesDir);
  ensureDir(modFilesDir);

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        if (file.fieldname === 'image') return cb(null, imagesDir);
        if (file.fieldname === 'modFile') return cb(null, modFilesDir);
        return cb(null, modFilesDir);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const ts = Date.now();
        if (file.fieldname === 'image') {
          const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png';
          return cb(null, `pimg_u${req.user.id}_${ts}${safeExt}`);
        }
        // mod file
        const safeExt = ['.zip', '.rar', '.7z'].includes(ext) ? ext : '.zip';
        return cb(null, `pfile_u${req.user.id}_${ts}${safeExt}`);
      },
    }),
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB (mods)
    },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (file.fieldname === 'image') {
        if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return cb(new Error('INVALID_IMAGE'));
        return cb(null, true);
      }
      if (file.fieldname === 'modFile') {
        if (!['.zip', '.rar', '.7z'].includes(ext)) return cb(new Error('INVALID_MOD_FILE'));
        return cb(null, true);
      }
      return cb(new Error('INVALID_FIELD'));
    },
  });

  // List products
  router.get('/products', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const sellerNick = String(req.query.seller || '').trim();

      const params = [];
      let where = 'p.is_deleted = 0 AND p.is_hidden = 0';
      if (q) {
        where += ' AND (p.title LIKE ? OR p.description LIKE ?)';
        params.push(`%${q}%`, `%${q}%`);
      }
      if (sellerNick) {
        where += ' AND u.nick = ?';
        params.push(sellerNick);
      }

      const rows = await all(
        db,
        `SELECT p.id, p.title, p.description, p.price_cents as priceCents, p.stock,
                p.created_at as createdAt, u.nick as sellerNick
           FROM products p
           JOIN users u ON u.id = p.seller_id
          WHERE ${where}
          ORDER BY p.created_at DESC
          LIMIT 200`,
        params
      );

      res.json({
        data: rows.map((r) => ({
          ...r,
          imageUrl: `/api/products/${r.id}/image`,
          seller: { nick: r.sellerNick },
        })),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Compatibility with original route
  router.get('/produtos', async (req, res) => {
    const rows = await all(db, 'SELECT id, title as name, description, price_cents/100.0 as price FROM products WHERE is_deleted=0 AND is_hidden=0 ORDER BY created_at DESC');
    res.json({ data: rows });
  });

  // Product details
  router.get('/products/:id', async (req, res) => {
    try {
      const id = clampInt(req.params.id, 1, 1_000_000_000);
      if (!id) return res.status(400).json({ error: 'ID_INVALID' });

      const p = await get(
        db,
        `SELECT p.*, u.nick as sellerNick, u.display_name as sellerDisplayName
           FROM products p
           JOIN users u ON u.id = p.seller_id
          WHERE p.id = ?`,
        [id]
      );
      if (!p || p.is_deleted) return res.status(404).json({ error: 'NOT_FOUND' });

      const agg = await get(
        db,
        `SELECT AVG(rating) as avgRating, COUNT(*) as count
           FROM product_reviews WHERE product_id = ?`,
        [id]
      );
      const avg = agg?.avgRating ? Number(agg.avgRating) : 0;
      const count = agg?.count ? Number(agg.count) : 0;

      let viewer = { hasPurchased: false, canReview: false, existingReview: null, isSeller: false };
      if (req.user) {
        viewer.isSeller = req.user.id === p.seller_id;
        const order = await get(
          db,
          `SELECT id FROM orders WHERE buyer_id = ? AND product_id = ? AND status = 'PAID' LIMIT 1`,
          [req.user.id, id]
        );
        viewer.hasPurchased = !!order;
        viewer.canReview = !!order;
        const existing = await get(
          db,
          `SELECT rating, comment, order_id as orderId, created_at as createdAt, updated_at as updatedAt
             FROM product_reviews WHERE buyer_id = ? AND product_id = ?`,
          [req.user.id, id]
        );
        viewer.existingReview = existing || null;
      }

      res.json({
        product: {
          id: p.id,
          title: p.title,
          description: p.description,
          priceCents: p.price_cents,
          stock: p.stock,
          seller: { nick: p.sellerNick, displayName: p.sellerDisplayName },
          imageUrl: `/api/products/${p.id}/image`,
          createdAt: p.created_at,
          updatedAt: p.updated_at,
          isHidden: !!p.is_hidden,
        },
        rating: { avg, count },
        viewer,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // Serve product image (public)
  router.get('/products/:id/image', async (req, res) => {
    try {
      const id = clampInt(req.params.id, 1, 1_000_000_000);
      if (!id) return res.status(400).end();
      const p = await get(db, 'SELECT image_key as imageKey FROM products WHERE id = ?', [id]);
      const imageKey = p?.imageKey;
      const fallback = path.join(__dirname, '..', '..', 'public', 'img', 'mod-default.svg');
      if (!imageKey) {
        if (fs.existsSync(fallback)) return res.sendFile(fallback);
        return res.status(204).end();
      }
      const filePath = path.join(imagesDir, imageKey);
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

  // Create product (seller)
  router.post(
    '/products',
    requireAuth,
    requireNotBanned,
    upload.fields([
      { name: 'image', maxCount: 1 },
      { name: 'modFile', maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        const title = String(req.body.title || '').trim().slice(0, 80);
        const description = String(req.body.description || '').trim().slice(0, 2000);
        const priceCents = parseMoneyToCents(req.body.price);
        const stock = clampInt(req.body.stock, 1, 1_000_000);

        if (!title) return res.status(400).json({ error: 'TITLE_REQUIRED' });
        if (!description) return res.status(400).json({ error: 'DESCRIPTION_REQUIRED' });
        if (priceCents === null || priceCents <= 0) return res.status(400).json({ error: 'PRICE_INVALID' });
        if (stock === null) return res.status(400).json({ error: 'STOCK_INVALID' });

        const image = req.files?.image?.[0] || null;
        const modFile = req.files?.modFile?.[0] || null;
        if (!modFile) return res.status(400).json({ error: 'MOD_FILE_REQUIRED' });

        const now = new Date().toISOString();
        const result = await run(
          db,
          `INSERT INTO products (seller_id, title, description, price_cents, stock, image_key, file_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
          [
            req.user.id,
            title,
            description,
            priceCents,
            stock,
            image ? image.filename : null,
            modFile.filename,
            now,
            now,
          ]
        );
        res.json({ ok: true, productId: result.lastID });
      } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'UPLOAD_OR_VALIDATION_ERROR' });
      }
    }
  );

  // Update product (seller or admin)
  router.put(
    '/products/:id',
    requireAuth,
    requireNotBanned,
    upload.fields([
      { name: 'image', maxCount: 1 },
      { name: 'modFile', maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        const id = clampInt(req.params.id, 1, 1_000_000_000);
        if (!id) return res.status(400).json({ error: 'ID_INVALID' });
        const p = await get(db, 'SELECT * FROM products WHERE id = ?', [id]);
        if (!p || p.is_deleted) return res.status(404).json({ error: 'NOT_FOUND' });
        const isOwner = p.seller_id === req.user.id;
        const isAdmin = req.user.role === 'ADMIN' && !req.isImpersonating;
        if (!isOwner && !isAdmin) return res.status(403).json({ error: 'FORBIDDEN' });

        const title = String(req.body.title || p.title).trim().slice(0, 80);
        const description = String(req.body.description || p.description).trim().slice(0, 2000);
        const priceCents = req.body.price !== undefined ? parseMoneyToCents(req.body.price) : p.price_cents;
        const stock = req.body.stock !== undefined ? clampInt(req.body.stock, 0, 1_000_000) : p.stock;
        const isHidden = req.body.isHidden !== undefined ? (req.body.isHidden ? 1 : 0) : p.is_hidden;

        if (!title) return res.status(400).json({ error: 'TITLE_REQUIRED' });
        if (!description) return res.status(400).json({ error: 'DESCRIPTION_REQUIRED' });
        if (priceCents === null || priceCents < 0) return res.status(400).json({ error: 'PRICE_INVALID' });
        if (stock === null) return res.status(400).json({ error: 'STOCK_INVALID' });

        const image = req.files?.image?.[0] || null;
        const modFile = req.files?.modFile?.[0] || null;

        const now = new Date().toISOString();
        await run(
          db,
          `UPDATE products
              SET title = ?, description = ?, price_cents = ?, stock = ?,
                  image_key = COALESCE(?, image_key),
                  file_key = COALESCE(?, file_key),
                  is_hidden = ?, updated_at = ?
            WHERE id = ?`,
          [
            title,
            description,
            priceCents,
            stock,
            image ? image.filename : null,
            modFile ? modFile.filename : null,
            isHidden,
            now,
            id,
          ]
        );

        res.json({ ok: true });
      } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'UPDATE_ERROR' });
      }
    }
  );

  // Delete product (soft)
  router.delete('/products/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const id = clampInt(req.params.id, 1, 1_000_000_000);
      if (!id) return res.status(400).json({ error: 'ID_INVALID' });
      const p = await get(db, 'SELECT * FROM products WHERE id = ?', [id]);
      if (!p || p.is_deleted) return res.status(404).json({ error: 'NOT_FOUND' });
      const isOwner = p.seller_id === req.user.id;
      const isAdmin = req.user.role === 'ADMIN' && !req.isImpersonating;
      if (!isOwner && !isAdmin) return res.status(403).json({ error: 'FORBIDDEN' });
      const now = new Date().toISOString();
      await run(db, 'UPDATE products SET is_deleted = 1, updated_at = ? WHERE id = ?', [now, id]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  // My products
  router.get('/me/products', requireAuth, async (req, res) => {
    try {
      const rows = await all(
        db,
        `SELECT id, title, description, price_cents as priceCents, stock, is_hidden as isHidden,
                created_at as createdAt, updated_at as updatedAt
           FROM products
          WHERE seller_id = ? AND is_deleted = 0
          ORDER BY created_at DESC`,
        [req.user.id]
      );
      res.json({ data: rows.map((r) => ({ ...r, imageUrl: `/api/products/${r.id}/image` })) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  return router;
}

module.exports = { productsRouter };
