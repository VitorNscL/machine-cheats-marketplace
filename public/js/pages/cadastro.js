window.pages = window.pages || {};

window.pages.cadastro = async function cadastroPage(me) {
  if (me?.user) {
    window.location.href = '/';
    return;
  }

  const form = document.getElementById('register-form');
  const alertBox = document.getElementById('register-alert');
  const cpfInput = document.getElementById('cpf');

  function showError(msg) {
    alertBox.style.display = 'block';
    alertBox.textContent = msg;
  }

  // Simple CPF mask: 000.000.000-00
  if (cpfInput) {
    cpfInput.addEventListener('input', () => {
      const digits = String(cpfInput.value || '').replace(/\D/g, '').slice(0, 11);
      const p1 = digits.slice(0, 3);
      const p2 = digits.slice(3, 6);
      const p3 = digits.slice(6, 9);
      const p4 = digits.slice(9, 11);

      let out = p1;
      if (p2) out += '.' + p2;
      if (p3) out += '.' + p3;
      if (p4) out += '-' + p4;
      cpfInput.value = out;
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.style.display = 'none';

    const fd = new FormData(form);
    const payload = {
      nick: String(fd.get('nick') || '').trim(),
      email: String(fd.get('email') || '').trim(),
      password: String(fd.get('password') || ''),
      cpf: String(fd.get('cpf') || '').trim(),
      birthDate: String(fd.get('birthDate') || '').trim(),
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
      if (code === 'NICK_INVALID') return showError('Nick inválido (3-20: letras/números/_/-).');
      if (code === 'EMAIL_INVALID') return showError('Email inválido.');
      if (code === 'PASSWORD_WEAK') return showError('Senha fraca. Use 8+ caracteres.');
      if (code === 'CPF_INVALID') return showError('CPF inválido. Confira os dígitos.');
      if (code === 'CPF_TAKEN') return showError('CPF já está cadastrado.');
      if (code === 'CPF_BANNED') return showError('CPF bloqueado. Contate o suporte.');
      if (code === 'BIRTHDATE_INVALID') return showError('Data de nascimento inválida.');
      return showError('Erro ao cadastrar. Tente novamente.');
    }
  });
};
