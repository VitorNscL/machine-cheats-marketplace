window.pages = window.pages || {};

window.pages.meusProdutos = async function meusProdutosPage(me) {
  if (!me?.user) {
    window.location.href = '/login';
    return;
  }

  const btnOpen = document.getElementById('open-create');
  const btnCancel = document.getElementById('cancel-create');
  const card = document.getElementById('create-card');
  const form = document.getElementById('product-form');
  const listEl = document.getElementById('my-products');
  const emptyEl = document.getElementById('my-empty');
  const alertBox = document.getElementById('mp-alert');
  const formTitle = document.getElementById('form-title');

  const fields = {
    productId: document.getElementById('productId'),
    title: document.getElementById('title'),
    description: document.getElementById('description'),
    price: document.getElementById('price'),
    stock: document.getElementById('stock'),
    image: document.getElementById('image'),
    modFile: document.getElementById('modFile'),
  };

  function showError(msg) {
    alertBox.style.display = 'block';
    alertBox.className = 'alert mt-18';
    alertBox.textContent = msg;
  }
  function showSuccess(msg) {
    alertBox.style.display = 'block';
    alertBox.className = 'success mt-18';
    alertBox.textContent = msg;
  }

  function openForm(mode) {
    card.style.display = 'block';
    if (mode === 'create') {
      formTitle.textContent = 'Novo mod';
      fields.productId.value = '';
      fields.title.value = '';
      fields.description.value = '';
      fields.price.value = '';
      fields.stock.value = 1;
      fields.image.value = '';
      fields.modFile.value = '';
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeForm() {
    card.style.display = 'none';
    fields.modFile.value = '';
    fields.image.value = '';
  }

  btnOpen.addEventListener('click', () => openForm('create'));
  btnCancel.addEventListener('click', closeForm);

  async function loadList() {
    const data = await window.api.apiFetch('/api/me/products');
    const items = data.data || [];
    emptyEl.style.display = items.length ? 'none' : 'block';

    if (!items.length) {
      listEl.innerHTML = '';
      return;
    }

    listEl.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Produto</th>
            <th class="right">Preço</th>
            <th class="right">Estoque</th>
            <th>Status</th>
            <th class="right">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map((p) => {
              const status = p.isHidden ? '<span class="badge-soft">Oculto</span>' : '<span class="badge">Ativo</span>';
              return `
                <tr>
                  <td>
                    <div style="font-weight:700">${window.api.escapeHtml(p.title)}</div>
                    <div class="help">${window.api.escapeHtml(p.description).slice(0, 80)}${p.description.length > 80 ? '…' : ''}</div>
                  </td>
                  <td class="right">${window.api.formatCentsBRL(p.priceCents)}</td>
                  <td class="right">${p.stock}</td>
                  <td>${status}</td>
                  <td class="right">
                    <a class="btn-neon" href="/mod/${p.id}">Ver</a>
                    <button class="btn-neon" data-edit="${p.id}">Editar</button>
                    <button class="btn-neon" data-del="${p.id}" style="border-color:rgba(255,51,102,0.4); color:#ffd1dd">Excluir</button>
                  </td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    `;

    // Bind edit/delete
    listEl.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pid = btn.getAttribute('data-edit');
        const p = items.find((x) => String(x.id) === String(pid));
        if (!p) return;
        openForm('edit');
        formTitle.textContent = `Editar: ${p.title}`;
        fields.productId.value = p.id;
        fields.title.value = p.title;
        fields.description.value = p.description;
        fields.price.value = (Number(p.priceCents || 0) / 100).toFixed(2).replace('.', ',');
        fields.stock.value = p.stock;
        fields.image.value = '';
        fields.modFile.value = '';
      });
    });

    listEl.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pid = btn.getAttribute('data-del');
        if (!confirm('Excluir este mod? (soft delete)')) return;
        try {
          await window.api.apiFetch(`/api/products/${pid}`, { method: 'DELETE' });
          showSuccess('Produto excluído.');
          await loadList();
        } catch {
          showError('Falha ao excluir.');
        }
      });
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.style.display = 'none';

    const pid = fields.productId.value;
    const fd = new FormData();
    fd.append('title', fields.title.value);
    fd.append('description', fields.description.value);
    fd.append('price', fields.price.value);
    fd.append('stock', fields.stock.value);
    if (fields.image.files && fields.image.files[0]) fd.append('image', fields.image.files[0]);
    if (fields.modFile.files && fields.modFile.files[0]) fd.append('modFile', fields.modFile.files[0]);

    try {
      if (!pid) {
        if (!fields.modFile.files || !fields.modFile.files[0]) {
          return showError('Selecione o arquivo do mod (.zip/.rar/.7z).');
        }
        await window.api.apiFetch('/api/products', { method: 'POST', body: fd });
        showSuccess('Produto criado!');
      } else {
        await window.api.apiFetch(`/api/products/${pid}`, { method: 'PUT', body: fd });
        showSuccess('Produto atualizado!');
      }
      closeForm();
      await loadList();
    } catch (err) {
      const code = err?.data?.error;
      if (code === 'PRICE_INVALID') return showError('Preço inválido. Use formato 29,90');
      if (code === 'MOD_FILE_REQUIRED') return showError('Arquivo do mod é obrigatório no cadastro.');
      showError('Falha ao salvar produto.');
    }
  });

  await loadList();
};
