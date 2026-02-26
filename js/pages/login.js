window.pages = window.pages || {};

window.pages.login = async function loginPage(me) {
  if (me?.user) {
    window.location.href = '/';
    return;
  }

  const form = document.getElementById('login-form');
  const alertBox = document.getElementById('login-alert');

  function showError(msg) {
    alertBox.style.display = 'block';
    alertBox.textContent = msg;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.style.display = 'none';

    const fd = new FormData(form);
    const payload = {
      email: String(fd.get('email') || '').trim(),
      password: String(fd.get('password') || ''),
    };
    try {
      await window.api.apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      window.location.href = '/';
    } catch (err) {
      const code = err?.data?.error;
      if (code === 'BANNED') return showError('Sua conta foi banida.');
      if (code === 'INVALID_CREDENTIALS') return showError('Email ou senha inválidos.');
      showError('Falha ao entrar.');
    }
  });
};
