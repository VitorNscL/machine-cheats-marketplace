window.pages = window.pages || {};

window.pages.perfilConfig = async function perfilConfigPage(me) {
  if (!me?.user) {
    window.location.href = '/login';
    return;
  }

  const nickEl = document.querySelector('#pc-nick');
  const cpfEl = document.querySelector('#pc-cpf');
  const birthDateEl = document.querySelector('#pc-birthDate');

  const displayEl = document.querySelector('#pc-display');
  const bioEl = document.querySelector('#pc-bio');
  const btn = document.querySelector('#pc-save');
  const alertEl = document.querySelector('#pc-alert');

  const avatarEl = document.querySelector('#pc-avatar');
  const avatarPreview = document.querySelector('#pc-avatar-preview');

  const sellerBalanceEl = document.querySelector('#pc-seller-balance');
  const sellerPendingEl = document.querySelector('#pc-seller-pending');

  const withdrawAmountEl = document.querySelector('#pc-withdraw-amount');
  const withdrawBtn = document.querySelector('#pc-withdraw-btn');
  const withdrawAlertEl = document.querySelector('#pc-withdraw-alert');
  const withdrawListEl = document.querySelector('#pc-withdraw-list');

  function clearAlert() {
    alertEl.style.display = 'none';
    alertEl.textContent = '';
    alertEl.className = 'alert';
  }
  function setAlert(kind, msg) {
    alertEl.style.display = 'block';
    alertEl.textContent = msg;
    alertEl.className = 'alert ' + (kind === 'success' ? 'ok' : 'err');
  }

  function clearWithdrawAlert() {
    if (!withdrawAlertEl) return;
    withdrawAlertEl.style.display = 'none';
    withdrawAlertEl.textContent = '';
    withdrawAlertEl.className = 'alert';
  }
  function setWithdrawAlert(kind, msg) {
    if (!withdrawAlertEl) return;
    withdrawAlertEl.style.display = 'block';
    withdrawAlertEl.textContent = msg;
    withdrawAlertEl.className = 'alert ' + (kind === 'success' ? 'ok' : 'err');
  }

  function parseMoneyToCents(str) {
    const s = String(str || '').trim();
    if (!s) return null;
    const normalized = s.replace(/\./g, '').replace(',', '.');
    const num = Number(normalized);
    if (!Number.isFinite(num) || num <= 0) return null;
    return Math.round(num * 100);
  }

  function renderBalances(user) {
    if (sellerBalanceEl) sellerBalanceEl.textContent = window.api.formatCentsBRL(user.sellerBalanceCents || 0);
    if (sellerPendingEl) sellerPendingEl.textContent = window.api.formatCentsBRL(user.sellerPendingCents || 0);
  }

  async function loadWithdrawals() {
    if (!withdrawListEl) return;
    withdrawListEl.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      const data = await window.api.apiFetch('/api/me/withdrawals');
      const rows = data.withdrawals || [];
      if (!rows.length) {
        withdrawListEl.innerHTML = '<div class="muted">Nenhum saque ainda.</div>';
        return;
      }
      withdrawListEl.innerHTML = `
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Bruto</th>
                <th>Taxa</th>
                <th>Líquido</th>
                <th>Comprovante</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((w) => `
                <tr>
                  <td>${w.createdAt ? new Date(w.createdAt).toLocaleString() : '-'}</td>
                  <td>${window.api.formatCentsBRL(w.grossAmountCents)}</td>
                  <td>${(w.feeBps / 100).toFixed(2)}% (${window.api.formatCentsBRL(w.feeAmountCents)})</td>
                  <td>${window.api.formatCentsBRL(w.netAmountCents)}</td>
                  <td><code>${w.receiptCode}</code></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      console.error(e);
      withdrawListEl.innerHTML = '<div class="muted">Falha ao carregar histórico.</div>';
    }
  }

  // initial fill
  nickEl.value = me.user.nick;
  if (cpfEl) cpfEl.value = me.user.cpf || '';
  if (birthDateEl) birthDateEl.value = me.user.birthDate || '';
  displayEl.value = me.user.displayName || '';
  bioEl.value = me.user.bio || '';
  if (avatarPreview) avatarPreview.src = window.api.userAvatarUrl(me.user.nick);

  renderBalances(me.user);
  loadWithdrawals();

  btn.addEventListener('click', async () => {
    clearAlert();
    try {
      const payload = {
        displayName: displayEl.value.trim(),
        bio: bioEl.value.trim(),
      };
      await window.api.apiFetch('/api/me/profile', { method: 'PUT', body: JSON.stringify(payload) });
      setAlert('success', 'Perfil atualizado.');
    } catch (e) {
      console.error(e);
      setAlert('error', 'Falha ao salvar.');
    }
  });

  avatarEl.addEventListener('change', async () => {
    clearAlert();
    const f = avatarEl.files?.[0];
    if (!f) return;

    try {
      const fd = new FormData();
      fd.append('avatar', f);

      await window.api.apiFetch('/api/me/avatar', {
        method: 'POST',
        body: fd,
      });

      if (avatarPreview) avatarPreview.src = window.api.userAvatarUrl(me.user.nick) + `&t=${Date.now()}`;
      setAlert('success', 'Avatar atualizado.');
    } catch (e) {
      console.error(e);
      setAlert('error', 'Falha ao atualizar avatar.');
    }
  });

  if (withdrawBtn) {
    withdrawBtn.addEventListener('click', async () => {
      clearWithdrawAlert();
      if (!withdrawAmountEl) return;

      const amountCents = parseMoneyToCents(withdrawAmountEl.value);
      if (!amountCents) return setWithdrawAlert('error', 'Valor inválido.');

      const confirmMsg = `Converter ${window.api.formatCentsBRL(amountCents)} para Pix?\n\nO Pix será enviado somente para o CPF cadastrado (${me.user.cpf || '---'}).`;
      if (!confirm(confirmMsg)) return;

      try {
        const r = await window.api.apiFetch('/api/me/withdraw', {
          method: 'POST',
          body: JSON.stringify({ amountCents }),
        });

        withdrawAmountEl.value = '';
        setWithdrawAlert('success', `Conversão realizada. Comprovante: ${r.receipt.receiptCode}`);

        // Refresh me + balances
        const me2 = await window.api.apiFetch('/api/me');
        me.user = me2.user;
        renderBalances(me.user);

        loadWithdrawals();
      } catch (e) {
        console.error(e);
        const code = e?.data?.error;
        if (code === 'CPF_REQUIRED') return setWithdrawAlert('error', 'CPF obrigatório na conta.');
        if (code === 'INSUFFICIENT_SELLER_BALANCE') return setWithdrawAlert('error', 'Saldo disponível insuficiente.');
        return setWithdrawAlert('error', 'Falha ao converter. Tente novamente.');
      }
    });
  }
};
