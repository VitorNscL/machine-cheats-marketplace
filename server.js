/*
  MACHINE CHEATS Marketplace (portfolio)
  - Express + SQLite
  - Auth w/ bcrypt + session cookies
  - Marketplace de mods digitais com entrega automática
  - VIP + Admin panel + impersonação segura (com logs)
*/

const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');

const { clampInt } = require('./src/utils/validate');
const { openDb, initSchema, get, run, all } = require('./src/db');
const { loadSession, csrfProtect } = require('./src/middleware');
const { authRouter } = require('./src/routes/auth');
const { usersRouter } = require('./src/routes/users');
const { productsRouter } = require('./src/routes/products');
const { interactionsRouter } = require('./src/routes/interactions');
const { ordersRouter } = require('./src/routes/orders');
const { vipRouter } = require('./src/routes/vip');
const { adminRouter } = require('./src/routes/admin');
const { chatRouter } = require('./src/routes/chat');
const { hashPassword } = require('./src/utils/auth');

const PORT = Number(process.env.PORT || 3000);

const app = express();
const server = http.createServer(app);

// ---- Basic hardening (minimal, portfolio) ----
app.use(
  helmet({
    contentSecurityPolicy: false, // easier for a static + JS app; keep other headers
  })
);

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Login/register brute-force mitigation
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

// Static assets
// Primary: serve files from /public at the site root ("/style.css", "/js/*", etc.)
const PUBLIC_DIR = path.join(__dirname, 'public');

// Compat: some environments (VSCode Live Preview / simple static hosting) may open pages like
// http://localhost:3000/public/index.html. To avoid confusion, we support both:
// 1) redirect common /public/*.html to the friendly routes
// 2) also serve the same static folder under /public
const PUBLIC_REDIRECTS = {
  '/public': '/',
  '/public/': '/',
  '/public/index.html': '/',
  '/public/login.html': '/login',
  '/public/cadastro.html': '/cadastro',
  '/public/marketplace.html': '/mods',
  '/public/meus-produtos.html': '/meus-produtos',
  '/public/minhas-compras.html': '/minhas-compras',
  '/public/perfil-config.html': '/perfil',
  '/public/vip.html': '/vip',
  '/public/chat.html': '/chat',
  '/public/admin.html': '/admin',
};

app.get(Object.keys(PUBLIC_REDIRECTS), (req, res) => {
  return res.redirect(302, PUBLIC_REDIRECTS[req.path] || '/');
});

app.use('/public', express.static(PUBLIC_DIR));
app.use(express.static(PUBLIC_DIR));

// Storage paths (outside public)
const STORAGE_DIR = path.join(__dirname, 'storage');
const AVATAR_DIR = path.join(STORAGE_DIR, 'avatars');
const PRODUCT_IMG_DIR = path.join(STORAGE_DIR, 'product-images');
const MOD_FILES_DIR = path.join(STORAGE_DIR, 'mod-files');

fs.mkdirSync(AVATAR_DIR, { recursive: true });
fs.mkdirSync(PRODUCT_IMG_DIR, { recursive: true });
fs.mkdirSync(MOD_FILES_DIR, { recursive: true });

// DB
const db = openDb();

async function bootstrap() {
  await initSchema(db);

  // Seed admin (idempotent)
  const adminEmail = 'admin@site.com';
  const existing = await get(db, 'SELECT id FROM users WHERE email = ?', [adminEmail]);
  if (!existing) {
    const passwordHash = await hashPassword('admin123');
    const now = new Date().toISOString();
    // Give admin a demo balance
    await run(
      db,
      `INSERT INTO users (email, password_hash, nick, display_name, bio, avatar_key, role, is_vip, is_banned, cpf, birth_date, wallet_balance_cents, seller_balance_cents, seller_pending_cents, created_at)
       VALUES (?, ?, 'admin', 'Admin', 'Conta seed do admin (portfólio).', NULL, 'ADMIN', 1, 0, '11144477735', '1990-01-01', 999999, 0, 0, ?)` ,
      [adminEmail, passwordHash, now]
    );
    console.log('Seed admin created: admin@site.com / admin123');
  }
  // Escrow release loop (48h hold)
  releaseMaturedEscrow();
  setInterval(releaseMaturedEscrow, 30 * 1000);
}


async function releaseMaturedEscrow() {
  try {
    const nowIso = new Date().toISOString();
    const rows = await all(
      db,
      `SELECT o.id as orderId,
              o.gross_amount_cents as grossAmountCents,
              o.fee_amount_cents as feeAmountCents,
              o.net_amount_cents as netAmountCents,
              o.hold_until as holdUntil,
              p.seller_id as sellerId
         FROM orders o
         JOIN products p ON p.id = o.product_id
        WHERE o.status = 'PAID_HOLD'
          AND o.hold_until IS NOT NULL
          AND o.hold_until <= ?
        ORDER BY o.hold_until ASC
        LIMIT 200`,
      [nowIso]
    );

    for (const r of rows) {
      await run(db, 'BEGIN');
      try {
        await run(
          db,
          "UPDATE orders SET status = 'RELEASED', released_at = ? WHERE id = ? AND status = 'PAID_HOLD'",
          [nowIso, r.orderId]
        );
        await run(
          db,
          `UPDATE users
              SET seller_pending_cents = seller_pending_cents - ?,
                  seller_balance_cents = seller_balance_cents + ?
            WHERE id = ?`,
          [r.grossAmountCents, r.netAmountCents, r.sellerId]
        );
        await run(
          db,
          'UPDATE platform_settings SET platform_balance_cents = platform_balance_cents + ? WHERE id = 1',
          [r.feeAmountCents]
        );
        await run(db, 'COMMIT');
      } catch (e) {
        await run(db, 'ROLLBACK');
        throw e;
      }
    }
  } catch (err) {
    console.error('Escrow release loop error:', err);
  }
}

// Session loader for API + page guards
app.use((req, res, next) => loadSession(db, req, res, next));

// CSRF for state-changing routes
app.use((req, res, next) => csrfProtect(req, res, next));

// ---- API ----
app.use('/api/auth', authLimiter, authRouter(db));
app.use('/api', usersRouter(db, { avatarDir: AVATAR_DIR }));
app.use('/api', productsRouter(db, { imagesDir: PRODUCT_IMG_DIR, modFilesDir: MOD_FILES_DIR }));
app.use('/api', interactionsRouter(db));
app.use('/api', ordersRouter(db, { modFilesDir: MOD_FILES_DIR }));
app.use('/api', vipRouter(db));
app.use('/api', adminRouter(db));
app.use('/api', chatRouter(db));

// Central error handler (esp. uploads)
app.use((err, req, res, next) => {
  if (!err) return next();
  const isApi = req.path.startsWith('/api');
  const code = err.code;
  if (isApi && (code === 'LIMIT_FILE_SIZE' || code === 'LIMIT_UNEXPECTED_FILE')) {
    return res.status(400).json({ error: 'UPLOAD_ERROR' });
  }
  console.error(err);
  if (isApi) return res.status(500).json({ error: 'SERVER_ERROR' });
  res.status(500).send('Server error');
});

// ---- Page routes (friendly URLs) ----
function sendPage(res, file) {
  return res.sendFile(path.join(__dirname, 'public', file));
}

function requirePageAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  return next();
}

function requirePageAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.isImpersonating) return res.redirect('/');
  if (req.user.role !== 'ADMIN') return res.redirect('/');
  return next();
}

app.get('/', (req, res) => sendPage(res, 'index.html'));
app.get('/login', (req, res) => sendPage(res, 'login.html'));
app.get('/cadastro', (req, res) => sendPage(res, 'cadastro.html'));
app.get('/mods', (req, res) => sendPage(res, 'marketplace.html'));
app.get('/mod/:id', (req, res) => sendPage(res, 'product.html'));
app.get('/u/:nick', (req, res) => sendPage(res, 'profile.html'));

app.get('/meus-produtos', requirePageAuth, (req, res) => sendPage(res, 'meus-produtos.html'));
app.get('/minhas-compras', requirePageAuth, (req, res) => sendPage(res, 'minhas-compras.html'));
app.get('/perfil', requirePageAuth, (req, res) => sendPage(res, 'perfil-config.html'));
app.get('/vip', requirePageAuth, (req, res) => sendPage(res, 'vip.html'));
app.get('/chat', requirePageAuth, (req, res) => sendPage(res, 'chat.html'));

app.get('/admin', requirePageAdmin, (req, res) => sendPage(res, 'admin.html'));
app.get('/admin/:tab', requirePageAdmin, (req, res) => sendPage(res, 'admin.html'));

// ---- Socket.IO (chat) ----
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
});

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

const { hashToken } = require('./src/utils/auth');

async function authFromCookies(cookieHeader) {
  const cookies = parseCookies(cookieHeader);
  const sid = cookies.sid;
  const imp = cookies.imp;
  const nowIso = new Date().toISOString();

  async function load(token) {
    if (!token) return null;
    const sess = await get(
      db,
      `SELECT s.*, u.id as userId, u.nick, u.role, u.is_vip as isVip, u.is_banned as isBanned
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
      [hashToken(token)]
    );
    if (!sess) return null;
    if (sess.expires_at <= nowIso) {
      await run(db, 'DELETE FROM sessions WHERE id = ?', [sess.id]).catch(() => {});
      return null;
    }
    return sess;
  }

  const adminSess = await load(sid);
  let active = adminSess;
  let isImpersonating = false;
  if (imp) {
    const impSess = await load(imp);
    if (impSess && impSess.impersonator_admin_id && adminSess && adminSess.role === 'ADMIN') {
      active = impSess;
      isImpersonating = true;
    }
  }
  if (!active) return null;
  return {
    user: {
      id: active.userId,
      nick: active.nick,
      role: active.role,
      isVip: !!active.isVip,
      isBanned: !!active.isBanned,
    },
    isImpersonating,
  };
}

io.use(async (socket, next) => {
  try {
    const auth = await authFromCookies(socket.request.headers.cookie || '');
    if (!auth) return next(new Error('AUTH_REQUIRED'));
    if (auth.user.isBanned) return next(new Error('BANNED'));
    socket.data.user = auth.user;
    socket.data.isImpersonating = auth.isImpersonating;
    next();
  } catch (err) {
    next(err);
  }
});

io.on('connection', (socket) => {
  socket.on('join', async ({ channel }) => {
    const ch = String(channel || 'GENERAL').toUpperCase();
    if (!['GENERAL', 'ADMIN'].includes(ch)) return;
    if (ch === 'ADMIN' && (socket.data.user.role !== 'ADMIN' || socket.data.isImpersonating)) return;
    socket.join(`ch:${ch}`);
    socket.data.channel = ch;

    const rows = await all(
      db,
      `SELECT m.id, m.text, m.is_deleted as isDeleted, m.created_at as createdAt,
              u.nick as authorNick,
              u.role as authorRole,
              u.is_vip as authorIsVip
        FROM chat_messages m
        JOIN users u ON u.id = m.author_id
        WHERE m.channel = ?
        ORDER BY m.created_at DESC
        LIMIT 50`,
      [ch]
    );
    socket.emit('history', rows.reverse().map((r) => ({
      ...r,
      isDeleted: !!r.isDeleted,
      authorIsVip: !!r.authorIsVip,
})));
  });

  socket.on('message', async ({ text }) => {
    const ch = socket.data.channel || 'GENERAL';
    if (ch === 'ADMIN' && (socket.data.user.role !== 'ADMIN' || socket.data.isImpersonating)) return;
    const clean = String(text || '').trim().slice(0, 500);
    if (!clean) return;
    const now = new Date().toISOString();
    const result = await run(
      db,
      `INSERT INTO chat_messages (channel, author_id, text, created_at)
       VALUES (?, ?, ?, ?)`,
      [ch, socket.data.user.id, clean, now]
    );
    io.to(`ch:${ch}`).emit('message', {
      id: result.lastID,
      text: clean,
      createdAt: now,
      authorNick: socket.data.user.nick,
      authorRole: socket.data.user.role,
      authorIsVip: !!socket.data.user.isVip,
      isDeleted: false,
    });
  });

  socket.on('deleteMessage', async ({ id }) => {
    const ch = socket.data.channel || 'GENERAL';
    if (socket.data.user.role !== 'ADMIN' || socket.data.isImpersonating) return;
    const msgId = Number(id);
    if (!msgId) return;
    await run(db, 'UPDATE chat_messages SET is_deleted = 1 WHERE id = ?', [msgId]);
    io.to(`ch:${ch}`).emit('messageDeleted', { id: msgId });
  });

  // ----------------------------
  // Support (1:1 user <-> admin)
  // ----------------------------
  socket.on('support:join', async () => {
    try {
      if (!socket.data.user) return;
      if (socket.data.user.isBanned) return;

      // Admin joins a notifications room + receives thread list
      if (socket.data.user.role === 'ADMIN') {
        socket.join('support:admins');

        const threads = await all(
          db,
          `SELECT t.id as threadId,
                  t.user_id as userId,
                  u.nick as userNick,
                  t.status,
                  t.updated_at as updatedAt,
                  (SELECT sm.text FROM support_messages sm WHERE sm.thread_id = t.id ORDER BY sm.created_at DESC LIMIT 1) as lastText,
                  (SELECT sm.created_at FROM support_messages sm WHERE sm.thread_id = t.id ORDER BY sm.created_at DESC LIMIT 1) as lastAt
             FROM support_threads t
             JOIN users u ON u.id = t.user_id
            WHERE t.status = 'OPEN'
            ORDER BY t.updated_at DESC
            LIMIT 50`
        );

        socket.emit('support:threads', threads);
        return;
      }

      // Regular user: ensure an OPEN thread exists, then join it and load history
      const nowIso = new Date().toISOString();
      let thread = await get(db, "SELECT id FROM support_threads WHERE user_id = ? AND status = 'OPEN'", [socket.data.user.id]);

      if (!thread) {
        const r = await run(
          db,
          `INSERT INTO support_threads (user_id, status, created_at, updated_at)
           VALUES (?, 'OPEN', ?, ?)`,
          [socket.data.user.id, nowIso, nowIso]
        );
        thread = { id: r.lastID };

        io.to('support:admins').emit('support:notify', {
          type: 'NEW_THREAD',
          threadId: thread.id,
          userId: socket.data.user.id,
          userNick: socket.data.user.nick,
          createdAt: nowIso,
        });
      }

      const room = `support:thread:${thread.id}`;
      socket.join(room);
      socket.data.supportThreadId = thread.id;
      socket.data.supportThreadRoom = room;

      const messages = await all(
        db,
        `SELECT m.id, m.text, m.created_at as createdAt,
                u.nick as authorNick,
                u.role as authorRole
           FROM support_messages m
           JOIN users u ON u.id = m.author_id
          WHERE m.thread_id = ?
          ORDER BY m.created_at ASC
          LIMIT 100`,
        [thread.id]
      );

      socket.emit('support:history', { threadId: thread.id, messages });
    } catch (err) {
      console.error('support:join error', err);
    }
  });

  socket.on('support:selectThread', async ({ threadId } = {}) => {
    try {
      if (!socket.data.user) return;
      if (socket.data.user.role !== 'ADMIN') return;

      const id = clampInt(threadId, 1, 1_000_000_000);
      if (!id) return;

      // leave previous selected thread room
      if (socket.data.supportThreadRoom) socket.leave(socket.data.supportThreadRoom);

      const room = `support:thread:${id}`;
      socket.join(room);
      socket.data.supportThreadId = id;
      socket.data.supportThreadRoom = room;

      const messages = await all(
        db,
        `SELECT m.id, m.text, m.created_at as createdAt,
                u.nick as authorNick,
                u.role as authorRole
           FROM support_messages m
           JOIN users u ON u.id = m.author_id
          WHERE m.thread_id = ?
          ORDER BY m.created_at ASC
          LIMIT 200`,
        [id]
      );

      socket.emit('support:history', { threadId: id, messages });
    } catch (err) {
      console.error('support:selectThread error', err);
    }
  });

  socket.on('support:message', async ({ threadId, text } = {}) => {
    try {
      if (!socket.data.user) return;
      if (socket.data.user.isBanned) return;

      const clean = String(text || '').trim();
      if (!clean) return;
      if (clean.length > 2000) return;

      const nowIso = new Date().toISOString();

      let id = clampInt(threadId, 1, 1_000_000_000);

      if (socket.data.user.role !== 'ADMIN') {
        // user can only write to own thread
        id = socket.data.supportThreadId;
        if (!id) {
          // lazy join if needed
          socket.emit('support:error', { error: 'THREAD_NOT_READY' });
          return;
        }
      }

      // verify thread exists
      const t = await get(db, 'SELECT id, user_id as userId, status FROM support_threads WHERE id = ?', [id]);
      if (!t) return;

      // If regular user, ensure it's their thread
      if (socket.data.user.role !== 'ADMIN' && t.userId !== socket.data.user.id) return;

      const r = await run(
        db,
        `INSERT INTO support_messages (thread_id, author_id, text, created_at)
         VALUES (?, ?, ?, ?)`,
        [id, socket.data.user.id, clean, nowIso]
      );
      await run(db, 'UPDATE support_threads SET updated_at = ? WHERE id = ?', [nowIso, id]);

      const payload = {
        id: r.lastID,
        threadId: id,
        text: clean,
        createdAt: nowIso,
        authorNick: socket.data.user.nick,
        authorRole: socket.data.user.role,
      };

      io.to(`support:thread:${id}`).emit('support:message', payload);

      // Notify admins when user messages
      if (socket.data.user.role !== 'ADMIN') {
        io.to('support:admins').emit('support:notify', {
          type: 'NEW_MESSAGE',
          threadId: id,
          userId: socket.data.user.id,
          userNick: socket.data.user.nick,
          preview: clean.slice(0, 120),
          createdAt: nowIso,
        });
      }
    } catch (err) {
      console.error('support:message error', err);
    }
  });


});

// ---- Start ----
bootstrap()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Servidor rodando! Acesse: http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
