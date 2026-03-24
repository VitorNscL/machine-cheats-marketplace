window.pages = window.pages || {};

function productCard(p) {
  const price = window.api.formatCentsBRL(p.priceCents);
  const stock = Number(p.stock || 0);
  const stockText = stock > 0 ? `${stock} em estoque` : 'Sem estoque';
  return `
    <article class="mod-card">
      <img src="${p.imageUrl}" alt="Imagem" style="width:100%;height:160px;object-fit:cover;border-radius:12px;border:1px solid rgba(255,255,255,0.08)" />
      <h3 class="mt-12">${window.api.escapeHtml(p.title)}</h3>
      <p>${window.api.escapeHtml(p.description).slice(0, 140)}${p.description.length > 140 ? '…' : ''}</p>
      <div class="row" style="align-items:center">
        <div>
          <div class="price" style="margin-bottom:0">${price}</div>
          <div class="help">${stockText} • por <a href="/u/${encodeURIComponent(p.seller.nick)}" style="color:var(--neon-purple)">@${window.api.escapeHtml(p.seller.nick)}</a></div>
        </div>
      </div>
      <div class="mt-12">
        <a class="btn-comprar btn-block" href="/mod/${p.id}">Ver detalhes</a>
      </div>
    </article>
  `;
}

window.pages.marketplace = async function marketplacePage() {
  const container = document.getElementById('products');
  const empty = document.getElementById('empty');
  const search = document.getElementById('search');

  async function load(q = '') {
    const data = await window.api.apiFetch(`/api/products${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    const items = data?.data || [];
    container.innerHTML = items.map(productCard).join('');
    empty.style.display = items.length ? 'none' : 'block';
  }

  await load('');

  let t = null;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => load(search.value.trim()), 250);
  });
};
