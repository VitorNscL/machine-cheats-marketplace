const express = require('express');
const { all, run } = require('../db');
const { requireAuth, requireNotBanned, requireAdmin } = require('../middleware');

function chatRouter(db) {
  const router = express.Router();

  router.get('/chat/messages', requireAuth, async (req, res) => {
    try {
      const channel = String(req.query.channel || 'GENERAL').toUpperCase();
      if (!['GENERAL', 'ADMIN'].includes(channel)) return res.status(400).json({ error: 'CHANNEL_INVALID' });
      if (channel === 'ADMIN' && (req.user.role !== 'ADMIN' || req.isImpersonating)) {
        return res.status(403).json({ error: 'ADMIN_ONLY' });
      }

      const rows = await all(
        db,
        `SELECT m.id, m.text, m.is_deleted as isDeleted, m.created_at as createdAt,
                u.nick as authorNick
           FROM chat_messages m
           JOIN users u ON u.id = m.author_id
          WHERE m.channel = ?
          ORDER BY m.created_at DESC
          LIMIT 50`,
        [channel]
      );
      res.json({ data: rows.reverse().map((r) => ({ ...r, isDeleted: !!r.isDeleted })) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  router.post('/chat/messages', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const channel = String(req.body.channel || 'GENERAL').toUpperCase();
      if (!['GENERAL', 'ADMIN'].includes(channel)) return res.status(400).json({ error: 'CHANNEL_INVALID' });
      if (channel === 'ADMIN' && (req.user.role !== 'ADMIN' || req.isImpersonating)) {
        return res.status(403).json({ error: 'ADMIN_ONLY' });
      }
      const text = String(req.body.text || '').trim().slice(0, 500);
      if (!text) return res.status(400).json({ error: 'TEXT_REQUIRED' });
      const now = new Date().toISOString();
      await run(
        db,
        `INSERT INTO chat_messages (channel, author_id, text, created_at)
         VALUES (?, ?, ?, ?)`,
        [channel, req.user.id, text, now]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  router.post('/admin/chat/messages/:id/delete', requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: 'ID_INVALID' });
      await run(db, 'UPDATE chat_messages SET is_deleted = 1 WHERE id = ?', [id]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  return router;
}

module.exports = { chatRouter };
