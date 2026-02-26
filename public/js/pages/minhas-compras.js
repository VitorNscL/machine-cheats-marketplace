window.pages = window.pages || {};

window.pages.minhasCompras = async function minhasComprasPage(me) {
  if (!me?.user) {
    window.location.href = '/login';
    return;
  }

  const tbody = document.getElementById('orders-body');
  const empty = document.getElementById('orders-empty');
  const alertBox = document.getElementById('orders-alert');

  function showError(msg) {
    alertBox.style.display = 'block';
    alertBox.textContent = msg;
  }

  try {
    const data = await window.api.apiFetch('/api/me/orders');
    const orders = data.data || [];
    empty.style.display = orders.length ? 'none' : 'block';

    tbody.innerHTML = orders
      .map((o) => {
        const date = new Date(o.createdAt).toLocaleString('pt-BR');
        const total = window.api.formatCentsBRL(o.grossAmountCents);
        const download = o.status === 'PAID'
          ? `<a class="btn-neon" href="/api/download/${o.productId}">Baixar</a>`
          : '';
        return `
          <tr>
            <td>${date}</td>
            <td><a href="/mod/${o.productId}" style="color:var(--neon-purple)">${window.api.escapeHtml(o.product.title)}</a></td>
            <td><a href="/u/${encodeURIComponent(o.seller.nick)}" style="color:var(--neon-purple)">@${window.api.escapeHtml(o.seller.nick)}</a></td>
            <td class="right">${total}</td>
            <td>${o.status}</td>
            <td class="right">${download}</td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    console.error(err);
    showError('Falha ao carregar suas compras.');
  }
};
