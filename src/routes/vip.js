const express = require('express');
const { get, run } = require('../db');
const { requireAuth, requireNotBanned } = require('../middleware');

function vipRouter(db) {
  const router = express.Router();

  // Fixed demo price
  const vipPriceCents = 5000; // R$ 50,00

  router.get('/vip/status', requireAuth, async (req, res) => {
    const settings = await get(db, 'SELECT fee_bps as feeBps, vip_fee_bps as vipFeeBps FROM platform_settings WHERE id = 1');
    res.json({
      isVip: req.user.isVip,
      vipPriceCents,
      feeBps: settings.feeBps,
      vipFeeBps: settings.vipFeeBps,
    });
  });

  router.post('/vip/buy', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const user = await get(db, 'SELECT is_vip as isVip, wallet_balance_cents as wallet FROM users WHERE id = ?', [req.user.id]);
      if (user.isVip) return res.status(400).json({ error: 'ALREADY_VIP' });
      if (user.wallet < vipPriceCents) return res.status(400).json({ error: 'INSUFFICIENT_WALLET' });

      const now = new Date().toISOString();
      await run(db, 'BEGIN IMMEDIATE TRANSACTION');
      try {
        await run(db, 'UPDATE users SET wallet_balance_cents = wallet_balance_cents - ?, is_vip = 1 WHERE id = ?', [vipPriceCents, req.user.id]);
        await run(db, 'UPDATE platform_settings SET platform_balance_cents = platform_balance_cents + ?, updated_at = ? WHERE id = 1', [vipPriceCents, now]);
        await run(
          db,
          `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, meta_json, created_at)
           VALUES (?, 'VIP_PURCHASE', 'USER', ?, ?, ?)` ,
          [req.user.id, req.user.id, JSON.stringify({ vipPriceCents }), now]
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

module.exports = { vipRouter };
