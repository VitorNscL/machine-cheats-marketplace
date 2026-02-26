window.pages = window.pages || {};

window.pages.perfilConfig = async function perfilConfigPage(me) {
  if (!me?.user) {
    window.location.href = '/login';
    return;
  }

  const alertBox = document.getElementById('pc-alert');
  const successBox = document.getElementById('pc-success');

  const avatar = document.getElementById('pc-avatar');
  const avatarForm = document.getElementById('avatar-form');
  const profileForm = document.getElementById('profile-form');
  const nickEl = document.getElementById('pc-nick');
  const displayEl = document.getElementById('pc-display');
  const bioEl = document.getElementById('pc-bio');
  const topupEl = document.getElementById('topup');
  const topupBtn = document.getElementById('topup-btn');

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

  // Fill
  nickEl.value = me.user.nick;
  displayEl.value = me.user.displayName || '';
  bioEl.value = me.user.bio || '';
  avatar.src = `/api/users/${encodeURIComponent(me.user.nick)}/avatar?ts=${Date.now()}`;

  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await window.api.apiFetch('/api/me/profile', {
        method: 'PUT',
        body: JSON.stringify({
          displayName: displayEl.value,
          bio: bioEl.value,
        }),
      });
      showSuccess('Perfil atualizado!');
      // Refresh shell balances etc
      window.location.reload();
    } catch {
      showError('Falha ao salvar.');
    }
  });

  avatarForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(avatarForm);
    try {
      await window.api.apiFetch('/api/me/avatar', { method: 'POST', body: fd });
      showSuccess('Avatar atualizado!');
      avatar.src = `/api/users/${encodeURIComponent(me.user.nick)}/avatar?ts=${Date.now()}`;
      // Update sidebar avatar without reload
      const sideImg = document.querySelector(`#sidebar img[alt="Avatar"]`);
      if (sideImg) sideImg.src = avatar.src;
    } catch (err) {
      const code = err?.data?.error;
      if (code === 'UPLOAD_ERROR') return showError('Arquivo inválido (png/jpg/webp) ou muito grande.');
      showError('Falha ao enviar avatar.');
    }
  });

  topupBtn.addEventListener('click', async () => {
    const amountCents = Number(topupEl.value || 0);
    if (!amountCents || amountCents < 100) return showError('Valor inválido.');
    try {
      await window.api.apiFetch('/api/me/wallet/topup', {
        method: 'POST',
        body: JSON.stringify({ amountCents }),
      });
      showSuccess('Saldo adicionado!');
      window.location.reload();
    } catch {
      showError('Falha ao adicionar saldo.');
    }
  });
};
