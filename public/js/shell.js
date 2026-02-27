async function loadMe() {
  try {
    return await window.api.apiFetch('/api/me');
  } catch {
    return { user: null, session: { isImpersonating: false } };
  }
}

function renderNavbar(me) {
  const user = me?.user;
  const isAdmin = !!user && user.role === 'ADMIN' && !me?.session?.isImpersonating;
  const isVip = !!user && user.isVip;
  const impersonating = !!me?.session?.isImpersonating;
  const targetNick = user?.nick;
  const impAdmin = me?.session?.impersonator?.nick;

  return `
  <nav class="navbar">
    <div class="nav-left">
      <button class="burger" id="sidebar-open" aria-label="Abrir menu">☰</button>
      <a class="logo" href="/">
        <span class="machine">MACHINE</span>
        <span class="cheats">CHEATS</span>
      </a>
    </div>
    <div class="menu">
      <a href="/">Início</a>
      <a href="/mods">Mods</a>
      ${user ? `<a href="/chat">Chat</a>` : ''}
      ${isVip ? `<a href="/vip">VIP</a>` : `<a href="/vip">Virar VIP</a>`}
      ${isAdmin ? `<a href="/admin" class="admin-link">Painel Admin</a>` : ''}
      ${user
        ? `<button class="btn-neon" id="logout-btn">Sair</button>`
        : `<a class="btn-neon" href="/login">Login</a>`}
    </div>
  </nav>
  ${impersonating ? `
    <div class="container">
      <div class="alert">
        <strong>Impersonação ativa:</strong> você está navegando como <strong>@${window.api.escapeHtml(targetNick)}</strong> (admin: @${window.api.escapeHtml(impAdmin || 'admin')}).
        <button class="btn-neon" style="margin-left:10px" id="stop-impersonation">Voltar para Admin</button>
      </div>
    </div>
  ` : ''}
  `;
}

function sidebarLink(href, label) {
  return `<a href="${href}">${label}</a>`;
}

function renderSidebar(me) {
  const user = me?.user;
  const impersonating = !!me?.session?.isImpersonating;
  const isAdmin = !!user && user.role === 'ADMIN' && !impersonating;
  const isVip = !!user && user.isVip;

  const links = [];
  if (user) {
    links.push(sidebarLink(`/u/${encodeURIComponent(user.nick)}`, 'Meu perfil'));
    links.push(sidebarLink('/meus-produtos', 'Meus produtos'));
    links.push(sidebarLink('/minhas-compras', 'Minhas compras'));
    links.push(sidebarLink('/perfil', 'Configurações do perfil'));
    links.push(sidebarLink('/vip', isVip ? 'Painel VIP' : 'Virar VIP'));
    if (isAdmin) links.push(sidebarLink('/admin', 'Painel Admin'));
    links.push(`<button class="danger" id="logout-btn-side">Sair</button>`);
  } else {
    links.push(sidebarLink('/login', 'Login'));
    links.push(sidebarLink('/cadastro', 'Cadastro'));
    links.push(sidebarLink('/mods', 'Explorar mods'));
  }

  return `
    <div class="overlay" id="sidebar-overlay"></div>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title">Menu</div>
        <button class="close-btn" id="sidebar-close" aria-label="Fechar menu">✕</button>
      </div>
      ${user ? `
        <div class="card" style="margin-bottom:12px">
          <div class="row" style="align-items:center">
            <img src="/api/users/${encodeURIComponent(user.nick)}/avatar" alt="Avatar" style="width:44px;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,0.08)" />
            <div style="flex:3">
              <div style="font-weight:700">@${window.api.escapeHtml(user.nick)}</div>
              <div class="muted" style="font-size:12px">Saldo: ${window.api.formatCentsBRL(user.walletBalanceCents)}</div>
            </div>
          </div>
        </div>
      ` : ''}
      <div class="sidebar-links">${links.join('')}</div>
      ${impersonating ? `<p class="help mt-12">Impersonação ativa. Use “Voltar para Admin” no topo.</p>` : ''}
    </aside>
  `;
}

function bindShellEvents() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const openBtn = document.getElementById('sidebar-open');
  const closeBtn = document.getElementById('sidebar-close');

  function open() {
    sidebar?.classList.add('open');
    overlay?.classList.add('show');
  }
  function close() {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('show');
  }

  openBtn?.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  overlay?.addEventListener('click', close);

  const logout1 = document.getElementById('logout-btn');
  const logout2 = document.getElementById('logout-btn-side');
  async function logout() {
    try {
      await window.api.apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    window.location.href = '/';
  }
  logout1?.addEventListener('click', logout);
  logout2?.addEventListener('click', logout);

  const stopImp = document.getElementById('stop-impersonation');
  stopImp?.addEventListener('click', async () => {
    try {
      await window.api.apiFetch('/api/admin/impersonation/stop', { method: 'POST' });
      window.location.href = '/admin';
    } catch (e) {
      alert('Não foi possível encerrar a impersonação.');
    }
  });
}

async function mountShell() {
  const me = await loadMe();
  window.__ME__ = me;

  const navbarEl = document.getElementById('navbar');
  const sidebarEl = document.getElementById('sidebar-root');

  if (navbarEl) navbarEl.innerHTML = renderNavbar(me);
  if (sidebarEl) sidebarEl.innerHTML = renderSidebar(me);
  bindShellEvents();
  // Support bubble
  try { mountSupportWidget(me); } catch (e) { console.error(e); }

  return me;
}



// ----------------------------
// Support Widget (bubble chat)
// ----------------------------
async function loadSocketIoClient() {
  if (window.io) return;
  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-socketio]');
    if (existing) {
      existing.addEventListener('load', resolve);
      existing.addEventListener('error', reject);
      // if already loaded, resolve soon
      if (window.io) resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = '/socket.io/socket.io.js';
    s.async = true;
    s.dataset.socketio = '1';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function ensureSupportWidgetStyles() {
  if (document.getElementById('support-widget-style')) return;
  const style = document.createElement('style');
  style.id = 'support-widget-style';
  style.textContent = `
    .support-bubble {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 999px;
      cursor: pointer;
      user-select: none;
      background: rgba(188, 19, 254, 0.18);
      border: 1px solid rgba(188, 19, 254, 0.55);
      color: #fff;
      backdrop-filter: blur(6px);
      box-shadow: 0 0 28px rgba(188, 19, 254, 0.20);
      opacity: 0.85;
    }
    .support-bubble:hover { opacity: 1; }
    .support-bubble .icon {
      width: 26px; height: 26px;
      display: grid; place-items: center;
      border-radius: 50%;
      background: rgba(188, 19, 254, 0.25);
      border: 1px solid rgba(188, 19, 254, 0.65);
    }
    .support-bubble .label { font-weight: 700; letter-spacing: .2px; }
    .support-bubble .badge {
      margin-left: 4px;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      border-radius: 999px;
      display: none;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      background: rgba(255, 68, 68, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.18);
    }

    .support-panel {
      position: fixed;
      right: 18px;
      bottom: 86px;
      width: 340px;
      max-width: calc(100vw - 36px);
      height: 420px;
      max-height: calc(100vh - 120px);
      z-index: 9999;
      display: none;
      flex-direction: column;
      background: rgba(20, 20, 24, 0.98);
      border: 1px solid rgba(188, 19, 254, 0.35);
      border-radius: 16px;
      box-shadow: 0 0 30px rgba(0,0,0,0.55);
      overflow: hidden;
    }
    .support-panel .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .support-panel .head .title { font-weight: 800; }
    .support-panel .head .close {
      background: transparent;
      border: 1px solid rgba(255,255,255,0.16);
      color: #fff;
      border-radius: 10px;
      padding: 6px 10px;
      cursor: pointer;
    }
    .support-panel .subhead {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .support-panel select {
      width: 100%;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      color: #fff;
      padding: 10px 10px;
      outline: none;
    }

    .support-panel .msgs {
      flex: 1;
      padding: 12px 12px;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .support-msg {
      max-width: 85%;
      padding: 10px 10px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.10);
      background: rgba(255,255,255,0.05);
      color: #fff;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .support-msg.me {
      align-self: flex-end;
      background: rgba(188, 19, 254, 0.16);
      border-color: rgba(188, 19, 254, 0.32);
    }
    .support-msg .meta {
      font-size: 11px;
      opacity: 0.7;
      margin-top: 6px;
    }

    .support-panel .composer {
      padding: 10px 10px;
      border-top: 1px solid rgba(255,255,255,0.06);
      display: flex;
      gap: 8px;
    }
    .support-panel .composer input {
      flex: 1;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      color: #fff;
      padding: 10px 10px;
      outline: none;
    }
    .support-panel .composer button {
      background: rgba(188, 19, 254, 0.28);
      border: 1px solid rgba(188, 19, 254, 0.55);
      color: #fff;
      border-radius: 12px;
      padding: 10px 12px;
      cursor: pointer;
      font-weight: 700;
    }
  `;
  document.head.appendChild(style);
}

function supportFormatTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function mountSupportWidget(me) {
  ensureSupportWidgetStyles();

  // Avoid duplicating widget when pages re-mount
  if (document.getElementById('support-bubble')) return;

  const bubble = document.createElement('div');
  bubble.id = 'support-bubble';
  bubble.className = 'support-bubble';
  bubble.innerHTML = `
    <div class="icon">💬</div>
    <div class="label">Suporte</div>
    <div class="badge" id="support-badge">0</div>
  `;
  document.body.appendChild(bubble);

  const panel = document.createElement('div');
  panel.id = 'support-panel';
  panel.className = 'support-panel';
  panel.innerHTML = `
    <div class="head">
      <div class="title">Suporte</div>
      <button class="close" id="support-close">Fechar</button>
    </div>
    <div class="subhead" id="support-subhead" style="display:none">
      <select id="support-thread-select"></select>
    </div>
    <div class="msgs" id="support-msgs"></div>
    <div class="composer">
      <input id="support-input" placeholder="Digite sua mensagem..." />
      <button id="support-send">Enviar</button>
    </div>
  `;
  document.body.appendChild(panel);

  const badge = panel.ownerDocument.getElementById('support-badge');
  const closeBtn = panel.ownerDocument.getElementById('support-close');
  const msgsEl = panel.ownerDocument.getElementById('support-msgs');
  const inputEl = panel.ownerDocument.getElementById('support-input');
  const sendBtn = panel.ownerDocument.getElementById('support-send');
  const subheadEl = panel.ownerDocument.getElementById('support-subhead');
  const threadSelectEl = panel.ownerDocument.getElementById('support-thread-select');

  let isOpen = false;
  let socket = null;
  let unread = 0;
  let activeThreadId = null;
  const isAdmin = me?.user?.role === 'ADMIN';

  function setBadge(n) {
    unread = n;
    if (!badge) return;
    if (unread > 0) {
      badge.style.display = 'flex';
      badge.textContent = String(unread);
    } else {
      badge.style.display = 'none';
    }
  }

  function addMsg(m) {
    const mine = m.authorNick === me?.user?.nick;
    const el = document.createElement('div');
    el.className = 'support-msg' + (mine ? ' me' : '');
    const meta = `${m.authorNick || ''}${m.authorRole ? ' • ' + m.authorRole : ''} • ${supportFormatTime(m.createdAt)}`;
    el.innerHTML = `<div class="text"></div><div class="meta"></div>`;
    el.querySelector('.text').textContent = m.text || '';
    el.querySelector('.meta').textContent = meta;
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function setHistory(messages) {
    msgsEl.innerHTML = '';
    (messages || []).forEach(addMsg);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  async function ensureSocket() {
    if (socket) return socket;
    await loadSocketIoClient();
    socket = window.io({ withCredentials: true });

    socket.on('connect', () => {
      // join support rooms on connect
      socket.emit('support:join');
    });

    socket.on('support:history', (payload) => {
      activeThreadId = payload.threadId;
      setHistory(payload.messages || []);
      if (isOpen) setBadge(0);
    });

    socket.on('support:message', (m) => {
      // if admin, only show messages of selected thread in the panel
      if (isAdmin && activeThreadId && m.threadId !== activeThreadId) {
        if (!isOpen) setBadge(unread + 1);
        return;
      }
      addMsg(m);
      if (!isOpen) setBadge(unread + 1);
    });

    socket.on('support:threads', (threads) => {
      if (!isAdmin) return;
      subheadEl.style.display = 'block';
      const items = threads || [];
      threadSelectEl.innerHTML = items.map((t) => {
        const label = `#${t.threadId} • ${t.userNick} • ${t.lastText ? t.lastText.slice(0, 30) : 'sem msg'}`;
        return `<option value="${t.threadId}">${label}</option>`;
      }).join('');
      if (items.length && !activeThreadId) {
        activeThreadId = items[0].threadId;
        socket.emit('support:selectThread', { threadId: activeThreadId });
      }
    });

    socket.on('support:notify', (n) => {
      // Admin notifications (new thread / new message)
      if (!isAdmin) return;
      if (!isOpen) setBadge(unread + 1);
      // refresh thread list to keep admin updated
      socket.emit('support:join');
    });

    return socket;
  }

  async function openPanel() {
    if (!me?.user) {
      window.location.href = '/login';
      return;
    }
    isOpen = true;
    panel.style.display = 'flex';
    setBadge(0);
    await ensureSocket();
    // Ensure we have history loaded for current context
    socket.emit('support:join');
  }

  function closePanel() {
    isOpen = false;
    panel.style.display = 'none';
  }

  bubble.addEventListener('click', () => {
    if (isOpen) closePanel();
    else openPanel();
  });
  closeBtn.addEventListener('click', closePanel);

  if (isAdmin) {
    threadSelectEl.addEventListener('change', () => {
      const v = Number(threadSelectEl.value);
      if (!v || !socket) return;
      activeThreadId = v;
      socket.emit('support:selectThread', { threadId: v });
    });
  }

  async function send() {
    const text = String(inputEl.value || '').trim();
    if (!text) return;
    inputEl.value = '';
    await ensureSocket();
    socket.emit('support:message', { threadId: activeThreadId, text });
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
  });
}



window.shell = { mountShell };
