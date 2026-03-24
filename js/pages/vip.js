window.pages = window.pages || {};

window.pages.vip = async function vipPage(me) {
  if (!me?.user) {
    window.location.href = '/login';
    return;
  }

  const alertBox = document.getElementById('vip-alert');
  const successBox = document.getElementById('vip-success');
  const statusEl = document.getElementById('vip-status');
  const buyBtn = document.getElementById('vip-buy');

  function showError(msg) {
    alertBox.style.display = 'block';
    alertBox.textContent = msg;
    successBox.style.display = 'none';
  }
  function showSuccess(msg) {
    successBox.style.display = 'block';
    successBox.textContent = msg;
    alertBox.style.display = 'none';
  }

  async function load() {
    const s = await window.api.apiFetch('/api/vip/status');
    const fee = (s.feeBps / 100).toFixed(2).replace('.', ',');
    const vipFee = (s.vipFeeBps / 100).toFixed(2).replace('.', ',');
    statusEl.innerHTML = `
      <div class="row" style="align-items:center">
        <div>
          <div class="label">Seu status</div>
          <div style="font-size:18px;font-weight:800">${s.isVip ? 'VIP ativo ✅' : 'Usuário comum'}</div>
        </div>
      </div>
      <div class="mt-12 help">Taxa padrão: <strong>${fee}%</strong> • Taxa VIP: <strong>${vipFee}%</strong></div>
      <div class="mt-12 help">Preço VIP (demo): <strong>${window.api.formatCentsBRL(s.vipPriceCents)}</strong></div>
    `;
    if (s.isVip) {
      buyBtn.disabled = true;
      buyBtn.textContent = 'Você já é VIP';
    }
  }

  buyBtn.addEventListener('click', async () => {
    try {
      await window.api.apiFetch('/api/vip/buy', { method: 'POST' });
      showSuccess('VIP ativado! Agora você paga menos taxa nas vendas.');
      setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      const code = err?.data?.error;
      if (code === 'INSUFFICIENT_WALLET') return showError('Saldo insuficiente na wallet demo. Vá em Perfil > Wallet e adicione saldo.');
      if (code === 'ALREADY_VIP') return showError('Você já é VIP.');
      showError('Falha ao comprar VIP.');
    }
  });

  await load();
};
