const { get, run } = require('./db');
const { hashToken } = require('./utils/auth');

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

async function loadSession(db, req, res, next) {
  try {
    const cookies = req.cookies || parseCookies(req.headers.cookie);
    const sid = cookies.sid;
    const imp = cookies.imp;

    req.user = null;
    req.session = null;
    req.isImpersonating = false;
    req.impersonatorAdminId = null;
    req.adminSession = null;

    const nowIso = new Date().toISOString();

    async function loadByToken(token) {
      if (!token) return null;
      const tokenHash = hashToken(token);
      const sess = await get(
        db,
        `SELECT s.*, u.email, u.nick, u.display_name, u.bio, u.avatar_key, u.role, u.is_vip, u.is_banned,
                u.wallet_balance_cents, u.seller_balance_cents
           FROM sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ?`,
        [tokenHash]
      );
      if (!sess) return null;
      if (sess.expires_at <= nowIso) {
        // expired
        await run(db, 'DELETE FROM sessions WHERE id = ?', [sess.id]).catch(() => {});
        return null;
      }
      return sess;
    }

    const adminSess = await loadByToken(sid);
    if (adminSess) {
      req.adminSession = {
        id: adminSess.id,
        userId: adminSess.user_id,
        csrfToken: adminSess.csrf_token,
        role: adminSess.role,
      };
    }

    let activeSess = null;
    if (imp) {
      const impSess = await loadByToken(imp);
      if (impSess && impSess.impersonator_admin_id) {
        // Only accept impersonation if there's also a valid admin session
        if (adminSess && adminSess.role === 'ADMIN') {
          activeSess = impSess;
          req.isImpersonating = true;
          req.impersonatorAdminId = impSess.impersonator_admin_id;
        }
      }

      if (!activeSess) {
        // stale cookie
        res.clearCookie('imp');
      }
    }

    if (!activeSess && adminSess) {
      activeSess = adminSess;
    }

    if (activeSess) {
      req.session = {
        id: activeSess.id,
        userId: activeSess.user_id,
        csrfToken: activeSess.csrf_token,
        expiresAt: activeSess.expires_at,
        impersonatorAdminId: activeSess.impersonator_admin_id || null,
        impersonationLogId: activeSess.impersonation_log_id || null,
      };
      req.user = {
        id: activeSess.user_id,
        email: activeSess.email,
        nick: activeSess.nick,
        displayName: activeSess.display_name,
        bio: activeSess.bio,
        avatarKey: activeSess.avatar_key,
        role: activeSess.role,
        isVip: !!activeSess.is_vip,
        isBanned: !!activeSess.is_banned,
        walletBalanceCents: activeSess.wallet_balance_cents,
        sellerBalanceCents: activeSess.seller_balance_cents,
      };
    }

    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  return next();
}

function requireNotBanned(req, res, next) {
  if (req.user?.isBanned) return res.status(403).json({ error: 'BANNED' });
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  if (req.isImpersonating) return res.status(403).json({ error: 'ADMIN_ONLY' });
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'ADMIN_ONLY' });
  return next();
}

function requireAdminSession(req, res, next) {
  if (!req.adminSession) return res.status(401).json({ error: 'ADMIN_SESSION_REQUIRED' });
  if (req.adminSession.role !== 'ADMIN') return res.status(403).json({ error: 'ADMIN_ONLY' });
  return next();
}

function requireVip(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  if (!req.user.isVip) return res.status(403).json({ error: 'VIP_ONLY' });
  return next();
}

function csrfProtect(req, res, next) {
  // Protect state-changing requests with a CSRF token header.
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  if (safeMethods.has(req.method)) return next();

  // Allow login/register without CSRF (no session yet)
  if (req.path.startsWith('/api/auth/login') || req.path.startsWith('/api/auth/register')) {
    return next();
  }

  if (!req.session) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  const header = req.get('x-csrf-token');
  const cookie = req.cookies?.csrf;
  if (!header || !cookie || header !== cookie) {
    return res.status(403).json({ error: 'CSRF' });
  }
  return next();
}

module.exports = {
  loadSession,
  requireAuth,
  requireNotBanned,
  requireAdmin,
  requireAdminSession,
  requireVip,
  csrfProtect,
};
