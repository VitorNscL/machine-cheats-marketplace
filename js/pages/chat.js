window.pages = window.pages || {};

window.pages.chat = async function chatPage(me) {
  if (!me?.user) {
    window.location.href = '/login';
    return;
  }

  const box = document.getElementById('chat-box');
  const input = document.getElementById('chat-text');
  const sendBtn = document.getElementById('chat-send');

  const canMod = me.user.role === 'ADMIN' && !me.session?.isImpersonating;

  function scrollBottom() {
    box.scrollTop = box.scrollHeight;
  }

  function renderMsg(m) {
    const isDeleted = !!m.isDeleted;
    const date = new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const text = isDeleted ? '<span class="muted">(mensagem removida)</span>' : window.api.escapeHtml(m.text);
    const delBtn = canMod && !isDeleted ? `<button class="btn-neon" data-del="${m.id}" style="padding:4px 8px; font-size:12px">Apagar</button>` : '';

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
    box.innerHTML = `<div class="alert">Não foi possível conectar no chat (auth/bloqueio). Faça login novamente.</div>`;
    sendBtn.disabled = true;
    input.disabled = true;
  });

  socket.on('connect', () => {
    socket.emit('join', { channel: 'GENERAL' });
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
    if (!canMod) return;
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
};
