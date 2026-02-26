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
      <a class="logo" href="/">MACHINE&nbsp;<span>CHEATS</span></a>
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
  return me;
}

window.shell = { mountShell };
