window.pages = window.pages || {};

window.pages.cadastro = async function cadastroPage(me) {
  if (me?.user) {
    window.location.href = '/';
    return;
  }

  const form = document.getElementById('register-form');
  const alertBox = document.getElementById('register-alert');

  function showError(msg) {
    alertBox.style.display = 'block';
    alertBox.textContent = msg;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.style.display = 'none';

    const fd = new FormData(form);
    const payload = {
      nick: String(fd.get('nick') || '').trim(),
      email: String(fd.get('email') || '').trim(),
      password: String(fd.get('password') || ''),
    };

    try {
      await window.api.apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      window.location.href = '/';
    } catch (err) {
      const code = err?.data?.error;
      if (code === 'EMAIL_TAKEN') return showError('Email já está em uso.');
      if (code === 'NICK_TAKEN') return showError('Nick já está em uso.');
      if (code === 'NICK_INVALID') return showError('Nick inválido. Use 3-20 caracteres: letras/números/_/-');
      if (code === 'PASSWORD_WEAK') return showError('Senha fraca. Use no mínimo 8 caracteres.');
      if (code === 'EMAIL_INVALID') return showError('Email inválido.');
      showError('Falha ao cadastrar.');
    }
  });
};
