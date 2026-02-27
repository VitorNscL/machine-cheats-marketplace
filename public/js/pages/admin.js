window.pages = window.pages || {};

function showTab(name) {
  const tabs = ['overview', 'transactions', 'withdrawals', 'users', 'products', 'fees', 'chat', 'impersonation'];
  for (const t of tabs) {
    const el = document.getElementById(`tab-${t}`);
    if (!el) continue;
    el.style.display = t === name ? 'block' : 'none';
  }
}

function setAlert(type, msg) {
  const a = document.getElementById('admin-alert');
  const s = document.getElementById('admin-success');
  if (type === 'error') {
    a.style.display = 'block';
    a.textContent = msg;
    s.style.display = 'none';
  } else {
    s.style.display = 'block';
    s.textContent = msg;
    a.style.display = 'none';
  }
}

function clearAlerts() {
  document.getElementById('admin-alert').style.display = 'none';
  document.getElementById('admin-success').style.display = 'none';
}

function bpsToPercent(bps) {
  return (Number(bps || 0) / 100).toFixed(2).replace('.', ',');
}

function percentToBps(text) {
  const n = Number(String(text).replace(',', '.'));
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

window.pages.admin = async function adminPage(me) {
  if (!me?.user) {
    window.location.href = '/login';
    return;
  }
  if (me.session?.isImpersonating) {
    window.location.href = '/';
    return;
  }
  if (me.user.role !== 'ADMIN') {
    window.location.href = '/';
    return;
  }

  // Tabs
  function currentTab() {
    const h = (window.location.hash || '#overview').replace('#', '');
    return ['overview', 'transactions', 'users', 'products', 'fees', 'chat', 'impersonation'].includes(h) ? h : 'overview';
  }

  async function renderOverview() {
    const el = document.getElementById('tab-overview');
    el.innerHTML = '<h3>Visão geral</h3><div class="muted">Carregando...</div>';
    const data = await window.api.apiFetch('/api/admin/overview');
    el.innerHTML = `
      <h3>Visão geral</h3>
      <div class="row mt-12" style="align-items:center">
        <div class="card" style="flex:1">
          <div class="label">Usuários</div>
          <div style="font-size:28px;font-weight:900">${data.counts.users}</div>
        </div>
        <div class="card" style="flex:1">
          <div class="label">Produtos</div>
          <div style="font-size:28px;font-weight:900">${data.counts.products}</div>
        </div>
        <div class="card" style="flex:1">
          <div class="label">Pedidos</div>
          <div style="font-size:28px;font-weight:900">${data.counts.orders}</div>
        </div>
      </div>
      <div class="card mt-18">
        <div class="row" style="align-items:center">
          <div>
            <div class="label">Saldo da plataforma (fees + VIP)</div>
            <div style="font-size:22px;font-weight:900">${window.api.formatCentsBRL(data.settings.platformBalanceCents)}</div>
          </div>
          <div>
            <div class="label">Taxa padrão</div>
            <div style="font-size:18px;font-weight:800">${bpsToPercent(data.settings.feeBps)}%</div>
          </div>
          <div>
            <div class="label">Taxa VIP</div>
            <div style="font-size:18px;font-weight:800">${bpsToPercent(data.settings.vipFeeBps)}%</div>
          </div>
        </div>
      </div>
      <div class="help mt-18">Dica: use “Impersonação” para suporte (gera logs e sessão temporária).</div>
    `;
  }

  async function renderTransactions() {
    const el = document.getElementById('tab-transactions');
    el.innerHTML = '<h3>Transações</h3><div class="muted">Carregando...</div>';
    const data = await window.api.apiFetch('/api/admin/transactions');
    const rows = data.data || [];
    el.innerHTML = `
      <h3>Transações</h3>
      <table class="table mt-18">
        <thead>
          <tr>
            <th>ID</th>
            <th>Data</th>
            <th>Comprador</th>
            <th>Vendedor</th>
            <th>Produto</th>
            <th class="right">Bruto</th>
            <th class="right">Taxa</th>
            <th class="right">Líquido</th>
            <th>Status</th>
            <th>Hold até</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((r) => {
              return `
                <tr>
                  <td>#${r.id}</td>
                  <td>${new Date(r.createdAt).toLocaleString('pt-BR')}</td>
                  <td>@${window.api.escapeHtml(r.buyerNick)}</td>
                  <td>@${window.api.escapeHtml(r.sellerNick)}</td>
                  <td>${window.api.escapeHtml(r.productTitle)}</td>
                  <td class="right">${window.api.formatCentsBRL(r.grossAmountCents)}</td>
                  <td class="right">${window.api.formatCentsBRL(r.feeAmountCents)}</td>
                  <td class="right">${window.api.formatCentsBRL(r.netAmountCents)}</td>
                  <td>${r.status}</td>
            <td>${r.holdUntil ? new Date(r.holdUntil).toLocaleString() : '-'}</td>
            <td>${r.status === 'PAID_HOLD' ? `<button class=\"btn\" data-refund=\"${r.id}\">Reembolsar</button>` : ''}</td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    `;
  }

  

async function renderWithdrawals() {
  const sec = document.querySelector('#tab-withdrawals');
  sec.innerHTML = `<h2>Saques / PIX</h2>
    <div class="muted mt-8">Lista de conversões de wallet para Pix (CPF) + comprovante (código).</div>
    <div class="mt-12">Carregando...</div>`;

  const data = await window.api.apiFetch('/api/admin/withdrawals');
  const rows = data.withdrawals || [];

  function fmtIso(iso) {
    if (!iso) return '-';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }
  function fmtCpf(cpf) {
    if (!cpf) return '-';
    const d = String(cpf).replace(/\D/g, '');
    if (d.length !== 11) return cpf;
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  function fmtBRL(cents) {
    const v = (Number(cents || 0) / 100).toFixed(2).replace('.', ',');
    return `R$ ${v}`;
  }

  const html = `
    <div class="table-wrap mt-12">
      <table class="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Vendedor</th>
            <th>CPF Pix</th>
            <th>Bruto</th>
            <th>Taxa</th>
            <th>Líquido</th>
            <th>Status</th>
            <th>Hold até</th>
            <th>Ações</th>
            <th>Data</th>
            <th>Comprovante</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((w) => `
            <tr>
              <td>${w.id}</td>
              <td>${w.sellerNick} <span class="muted">(#${w.sellerId})</span></td>
              <td>${fmtCpf(w.pixCpf)}</td>
              <td>${fmtBRL(w.grossAmountCents)}</td>
              <td>${w.feeBps / 100}% (${fmtBRL(w.feeAmountCents)})</td>
              <td>${fmtBRL(w.netAmountCents)}</td>
              <td>${w.status}</td>
              <td>${fmtIso(w.createdAt)}</td>
              <td><code>${w.receiptCode}</code></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  sec.innerHTML = `<h2>Saques / PIX</h2>${html}`;

  // refund buttons
  sec.querySelectorAll('button[data-refund]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-refund');
      if (!confirm('Reembolsar esta compra? Isso devolve o saldo ao comprador e remove do hold do vendedor.')) return;
      await window.api.apiFetch(`/api/admin/orders/${id}/refund`, { method: 'POST' });
      await renderTransactions();
    });
  });

}

async function renderUsers() {
    const el = document.getElementById('tab-users');
    el.innerHTML = `
      <h3>Usuários</h3>
      <div class="row mt-12" style="align-items:flex-end">
        <div style="flex:3">
          <div class="label">Buscar (email ou nick)</div>
          <input class="input" id="user-q" placeholder="Ex: vitor, admin@..." />
        </div>
        <div style="flex:1">
          <button class="btn-neon" id="user-search">Buscar</button>
        </div>
      </div>
      <div id="users-table" class="mt-18"></div>
    `;

    const qEl = document.getElementById('user-q');
    const btn = document.getElementById('user-search');
    const table = document.getElementById('users-table');

    async function load(q) {
      const data = await window.api.apiFetch(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      const rows = data.data || [];

      const fmtCpf = (cpf) => {
        if (!cpf) return '-';
        const d = String(cpf).replace(/\D/g, '');
        if (d.length !== 11) return cpf;
        return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      };

      table.innerHTML = `
        <table class="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nick</th>
            <th>CPF</th>
              <th>Email</th>
              <th>Role</th>
              <th>VIP</th>
              <th>Ban</th>
              <th class="right">Wallet</th>
              <th class="right">Ações</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map((u) => {
                const roleBadge = u.role === 'ADMIN' ? '<span class="badge-soft">ADMIN</span>' : '<span class="badge">USER</span>';
                const vipBadge = u.isVip ? '<span class="badge">VIP</span>' : '<span class="muted">—</span>';
                const banBadge = u.isBanned ? '<span class="badge-soft">BANIDO</span>' : '<span class="muted">OK</span>';
                return `
                  <tr>
                    <td>${u.id}</td>
                    <td><a href="/u/${encodeURIComponent(u.nick)}" style="color:var(--neon-purple)">@${window.api.escapeHtml(u.nick)}</a></td>
                    <td>${window.api.escapeHtml(u.email)}</td>
                    <td>${roleBadge}</td>
                    <td>${vipBadge}</td>
                    <td>${banBadge}</td>
                    <td class="right">${window.api.formatCentsBRL(u.walletBalanceCents)}</td>
                    <td class="right">
                      <button class="btn-neon" data-ban="${u.id}" data-banv="${u.isBanned ? 0 : 1}">${u.isBanned ? 'Desbanir' : 'Banir'}</button>
                      <button class="btn-neon" data-vip="${u.id}" data-vipv="${u.isVip ? 0 : 1}">${u.isVip ? 'Remover VIP' : 'Dar VIP'}</button>
                      ${u.role !== 'ADMIN' ? `<button class="btn-neon" data-promote="${u.id}">Promover</button>` : ''}
                      ${u.role !== 'ADMIN' ? '' : ''}
                      <button class="btn-neon" data-imp="${u.id}">Entrar como</button>
                      <button class="btn-neon" data-topup="${u.id}">Saldo +</button>
                    </td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      `;

      // Bind actions
      table.querySelectorAll('[data-ban]').forEach((b) => {
        b.addEventListener('click', async () => {
          clearAlerts();
          const id = b.getAttribute('data-ban');
          const isBanned = b.getAttribute('data-banv') === '1';
          try {
            await window.api.apiFetch(`/api/admin/users/${id}/ban`, {
              method: 'POST',
              body: JSON.stringify({ isBanned }),
            });
            setAlert('success', isBanned ? 'Usuário banido.' : 'Usuário desbanido.');
            await load(qEl.value.trim());
          } catch {
            setAlert('error', 'Falha ao atualizar ban.');
          }
        });
      });

      table.querySelectorAll('[data-vip]').forEach((b) => {
        b.addEventListener('click', async () => {
          clearAlerts();
          const id = b.getAttribute('data-vip');
          const isVip = b.getAttribute('data-vipv') === '1';
          try {
            await window.api.apiFetch(`/api/admin/users/${id}/vip`, {
              method: 'POST',
              body: JSON.stringify({ isVip }),
            });
            setAlert('success', isVip ? 'VIP concedido.' : 'VIP removido.');
            await load(qEl.value.trim());
          } catch {
            setAlert('error', 'Falha ao atualizar VIP.');
          }
        });
      });

      table.querySelectorAll('[data-promote]').forEach((b) => {
        b.addEventListener('click', async () => {
          clearAlerts();
          const id = b.getAttribute('data-promote');
          if (!confirm('Promover este usuário para ADMIN?')) return;
          try {
            await window.api.apiFetch(`/api/admin/users/${id}/promote`, { method: 'POST' });
            setAlert('success', 'Usuário promovido para ADMIN.');
            await load(qEl.value.trim());
          } catch {
            setAlert('error', 'Falha ao promover.');
          }
        });
      });

      table.querySelectorAll('[data-imp]').forEach((b) => {
        b.addEventListener('click', async () => {
          clearAlerts();
          const id = b.getAttribute('data-imp');
          if (!confirm('Entrar como este usuário? Será criada uma sessão de impersonação temporária com logs.')) return;
          try {
            await window.api.apiFetch('/api/admin/impersonate', {
              method: 'POST',
              body: JSON.stringify({ userId: Number(id) }),
            });
            // Now you're impersonating; go home
            window.location.href = '/';
          } catch {
            setAlert('error', 'Falha ao iniciar impersonação.');
          }
        });
      });
      table.querySelectorAll('[data-topup]').forEach((b) => {
        b.addEventListener('click', async () => {
          clearAlerts();
          const id = b.getAttribute('data-topup');
          const v = prompt('Valor para adicionar na wallet (R$):', '10,00');
          if (!v) return;

          const normalized = String(v).trim().replace(/\./g, '').replace(',', '.');
          const num = Number(normalized);
          if (!Number.isFinite(num) || num <= 0) return alert('Valor inválido.');

          const amountCents = Math.round(num * 100);

          try {
            await window.api.apiFetch(`/api/admin/users/${id}/wallet/topup`, {
              method: 'POST',
              body: JSON.stringify({ amountCents }),
            });
            setAlert('success', 'Saldo adicionado.');
            await load(qEl.value.trim());
          } catch (e) {
            console.error(e);
            setAlert('error', 'Falha ao adicionar saldo.');
          }
        });
      });

    }

    btn.addEventListener('click', () => load(qEl.value.trim()));
    qEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') load(qEl.value.trim());
    });
    await load('');
  }

  async function renderProducts() {
    const el = document.getElementById('tab-products');
    el.innerHTML = '<h3>Produtos</h3><div class="muted">Carregando...</div>';
    const data = await window.api.apiFetch('/api/admin/products');
    const rows = data.data || [];
    el.innerHTML = `
      <h3>Produtos</h3>
      <div class="help">Admin pode ocultar itens (moderação). Delete é soft via rota normal.</div>
      <table class="table mt-18" id="admin-products-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Título</th>
            <th>Vendedor</th>
            <th class="right">Preço</th>
            <th class="right">Estoque</th>
            <th>Status</th>
            <th>Hold até</th>
            <th>Ações</th>
            <th class="right">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((p) => {
              const status = p.isDeleted
                ? '<span class="badge-soft">Excluído</span>'
                : p.isHidden
                ? '<span class="badge-soft">Oculto</span>'
                : '<span class="badge">Ativo</span>';
              return `
                <tr>
                  <td>${p.id}</td>
                  <td>${window.api.escapeHtml(p.title)}</td>
                  <td>@${window.api.escapeHtml(p.sellerNick)}</td>
                  <td class="right">${window.api.formatCentsBRL(p.priceCents)}</td>
                  <td class="right">${p.stock}</td>
                  <td>${status}</td>
                  <td class="right">
                    <a class="btn-neon" href="/mod/${p.id}">Ver</a>
                    ${p.isDeleted ? '' : `<button class="btn-neon" data-editp="${p.id}">Editar</button>`}
                    ${p.isDeleted ? '' : `<button class="btn-neon" data-hide="${p.id}" data-hidev="${p.isHidden ? 0 : 1}">${p.isHidden ? 'Mostrar' : 'Ocultar'}</button>`}
                    ${p.isDeleted ? '' : `<button class="btn-neon" data-delp="${p.id}" style="border-color:rgba(255,51,102,0.4); color:#ffd1dd">Excluir</button>`}
                  </td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    `;

    const table = document.getElementById('admin-products-table');

    table.querySelectorAll('[data-editp]').forEach((b) => {
      b.addEventListener('click', async () => {
        clearAlerts();
        const id = b.getAttribute('data-editp');
        const p = rows.find((x) => String(x.id) === String(id));
        if (!p) return;
        const title = prompt('Novo título:', p.title);
        if (title === null) return;
        const price = prompt('Novo preço (ex: 29,90):', (Number(p.priceCents) / 100).toFixed(2).replace('.', ','));
        if (price === null) return;
        const stock = prompt('Novo estoque:', String(p.stock));
        if (stock === null) return;

        const fd = new FormData();
        fd.append('title', title);
        fd.append('price', price);
        fd.append('stock', stock);
        try {
          await window.api.apiFetch(`/api/products/${id}`, { method: 'PUT', body: fd });
          setAlert('success', 'Produto atualizado.');
          await renderProducts();
        } catch {
          setAlert('error', 'Falha ao editar produto.');
        }
      });
    });

    table.querySelectorAll('[data-hide]').forEach((b) => {
      b.addEventListener('click', async () => {
        clearAlerts();
        const id = b.getAttribute('data-hide');
        const isHidden = b.getAttribute('data-hidev') === '1';
        try {
          await window.api.apiFetch(`/api/admin/products/${id}/hide`, {
            method: 'POST',
            body: JSON.stringify({ isHidden }),
          });
          setAlert('success', isHidden ? 'Produto ocultado.' : 'Produto reexibido.');
          await renderProducts();
        } catch {
          setAlert('error', 'Falha ao atualizar produto.');
        }
      });
    });

    table.querySelectorAll('[data-delp]').forEach((b) => {
      b.addEventListener('click', async () => {
        clearAlerts();
        const id = b.getAttribute('data-delp');
        if (!confirm('Excluir (soft delete) este produto?')) return;
        try {
          await window.api.apiFetch(`/api/products/${id}`, { method: 'DELETE' });
          setAlert('success', 'Produto excluído.');
          await renderProducts();
        } catch {
          setAlert('error', 'Falha ao excluir produto.');
        }
      });
    });
  }

  async function renderFees() {
    const el = document.getElementById('tab-fees');
    el.innerHTML = '<h3>Taxas</h3><div class="muted">Carregando...</div>';
    const data = await window.api.apiFetch('/api/admin/settings/fees');
    el.innerHTML = `
      <h3>Taxas (fee)</h3>
      <div class="help">Valores em porcentagem. Internamente o sistema usa basis points (bps).</div>
      <div class="row mt-18" style="align-items:flex-end">
        <div style="flex:1">
          <div class="label">Taxa padrão (%)</div>
          <input class="input" id="fee" value="${bpsToPercent(data.settings.feeBps)}" />
        </div>
        <div style="flex:1">
          <div class="label">Taxa VIP (%)</div>
          <input class="input" id="vipFee" value="${bpsToPercent(data.settings.vipFeeBps)}" />
        </div>
        <div style="flex:1">
          <button class="btn-comprar" id="save-fees">Salvar</button>
        </div>
      </div>
    `;

    document.getElementById('save-fees').addEventListener('click', async () => {
      clearAlerts();
      const feeBps = percentToBps(document.getElementById('fee').value);
      const vipFeeBps = percentToBps(document.getElementById('vipFee').value);
      if (feeBps === null || vipFeeBps === null) return setAlert('error', 'Valores inválidos.');
      try {
        await window.api.apiFetch('/api/admin/settings/fees', {
          method: 'PUT',
          body: JSON.stringify({ feeBps, vipFeeBps }),
        });
        setAlert('success', 'Taxas atualizadas.');
      } catch {
        setAlert('error', 'Falha ao salvar taxas.');
      }
    });
  }

  async function renderImpersonation() {
    const el = document.getElementById('tab-impersonation');
    el.innerHTML = `
      <h3>Impersonação (suporte)</h3>
      <div class="help">Sem backdoor: o admin inicia uma sessão temporária, com logs e botão “Voltar para Admin”.</div>
      <div class="row mt-18" style="align-items:flex-end">
        <div style="flex:2">
          <div class="label">Nick do usuário</div>
          <input class="input" id="imp-nick" placeholder="ex: vitor" />
        </div>
        <div style="flex:1">
          <button class="btn-neon" id="imp-start">Entrar como</button>
        </div>
      </div>
      <div class="mt-18" id="imp-logs"></div>
    `;

    document.getElementById('imp-start').addEventListener('click', async () => {
      clearAlerts();
      const nick = document.getElementById('imp-nick').value.trim();
      if (!nick) return setAlert('error', 'Informe um nick.');
      if (!confirm(`Entrar como @${nick}?`)) return;
      try {
        await window.api.apiFetch('/api/admin/impersonate', {
          method: 'POST',
          body: JSON.stringify({ nick }),
        });
        window.location.href = '/';
      } catch {
        setAlert('error', 'Falha ao iniciar impersonação.');
      }
    });

    // Logs
    const logs = await window.api.apiFetch('/api/admin/impersonation/logs');
    const rows = logs.data || [];
    document.getElementById('imp-logs').innerHTML = `
      <h4>Logs recentes</h4>
      <table class="table mt-12">
        <thead>
          <tr>
            <th>ID</th>
            <th>Admin</th>
            <th>Alvo</th>
            <th>Início</th>
            <th>Fim</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((l) => {
              return `
                <tr>
                  <td>${l.id}</td>
                  <td>@${window.api.escapeHtml(l.adminNick)}</td>
                  <td>@${window.api.escapeHtml(l.targetNick)}</td>
                  <td>${new Date(l.createdAt).toLocaleString('pt-BR')}</td>
                  <td>${l.endedAt ? new Date(l.endedAt).toLocaleString('pt-BR') : '<span class="muted">(ativa)</span>'}</td>
                  <td>${window.api.escapeHtml(l.ip || '')}</td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    `;
  }

  async function renderChatAdmin() {
    const el = document.getElementById('tab-chat');
    el.innerHTML = `
      <h3>Chat Admin</h3>
      <div class="help">Canal exclusivo para ADMIN. (Impersonação não entra aqui.)</div>
      <div class="mt-18" style="height:360px; overflow:auto; border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:12px" id="admin-chat-box"></div>
      <div class="row mt-12" style="align-items:center">
        <input class="input" id="admin-chat-text" placeholder="Mensagem para admins..." />
        <button class="btn-comprar" id="admin-chat-send">Enviar</button>
      </div>
    `;

    const box = document.getElementById('admin-chat-box');
    const input = document.getElementById('admin-chat-text');
    const sendBtn = document.getElementById('admin-chat-send');

    function scrollBottom() {
      box.scrollTop = box.scrollHeight;
    }

    function renderMsg(m) {
      const isDeleted = !!m.isDeleted;
      const date = new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const text = isDeleted ? '<span class="muted">(mensagem removida)</span>' : window.api.escapeHtml(m.text);
      const delBtn = !isDeleted ? `<button class="btn-neon" data-del="${m.id}" style="padding:4px 8px; font-size:12px">Apagar</button>` : '';
      return `
        <div class="row" style="align-items:flex-start; margin-bottom:10px" data-msg="${m.id}">
          <div style="flex:1">
            <div class="help"><strong>@${window.api.escapeHtml(m.authorNick)}</strong> • ${date}</div>
            <div class="chat-text" data-text>${text}</div>
          </div>
          <div>${delBtn}</div>
        </div>
      `;
    }

    const socket = io({ withCredentials: true });

    socket.on('connect_error', (err) => {
      console.error(err);
      box.innerHTML = `<div class="alert">Falha ao conectar no chat admin.</div>`;
      sendBtn.disabled = true;
      input.disabled = true;
    });

    socket.on('connect', () => {
      socket.emit('join', { channel: 'ADMIN' });
    });

    socket.on('history', (rows) => {
      box.innerHTML = rows.map(renderMsg).join('');
      bindDeletes();
      scrollBottom();
    });

    socket.on('message', (m) => {
      box.insertAdjacentHTML('beforeend', renderMsg(m));
      bindDeletes();
      scrollBottom();
    });

    socket.on('messageDeleted', ({ id }) => {
      const row = box.querySelector(`[data-msg="${id}"]`);
      if (row) {
        const textEl = row.querySelector('[data-text]');
        if (textEl) textEl.innerHTML = '<span class="muted">(mensagem removida)</span>';
        const btn = row.querySelector('[data-del]');
        if (btn) btn.remove();
      }
    });

    function bindDeletes() {
      box.querySelectorAll('[data-del]').forEach((btn) => {
        if (btn.__bound) return;
        btn.__bound = true;
        btn.addEventListener('click', () => {
          const id = Number(btn.getAttribute('data-del'));
          socket.emit('deleteMessage', { id });
        });
      });
    }

    function send() {
      const text = String(input.value || '').trim();
      if (!text) return;
      socket.emit('message', { text });
      input.value = '';
      input.focus();
    }

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      }
    });
  }

  async function render() {
    const tab = currentTab();
    showTab(tab);
    clearAlerts();
    try {
      if (tab === 'overview') await renderOverview();
  if (tab === 'withdrawals') await renderWithdrawals();
      if (tab === 'transactions') await renderTransactions();
      if (tab === 'users') await renderUsers();
      if (tab === 'products') await renderProducts();
      if (tab === 'fees') await renderFees();
      if (tab === 'chat') await renderChatAdmin();
      if (tab === 'impersonation') await renderImpersonation();
    } catch (err) {
      console.error(err);
      setAlert('error', 'Falha ao carregar esta seção.');
    }
  }

  window.addEventListener('hashchange', render);
  await render();
};
