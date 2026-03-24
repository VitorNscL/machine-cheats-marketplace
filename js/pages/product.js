window.pages = window.pages || {};

function getProductIdFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[parts.length - 1];
}

function stars(avg) {
  const n = Math.round(Number(avg || 0) * 10) / 10;
  const full = Math.floor(n);
  const half = n - full >= 0.5;
  let s = '';
  for (let i = 0; i < 5; i++) {
    if (i < full) s += '★';
    else if (i === full && half) s += '☆';
    else s += '☆';
  }
  return `${s} (${n})`;
}

window.pages.product = async function productPage(me) {
  const id = getProductIdFromPath();
  const alertBox = document.getElementById('product-alert');

  const els = {
    img: document.getElementById('p-image'),
    title: document.getElementById('p-title'),
    seller: document.getElementById('p-seller'),
    desc: document.getElementById('p-desc'),
    price: document.getElementById('p-price'),
    stock: document.getElementById('p-stock'),
    rating: document.getElementById('p-rating'),
    qty: document.getElementById('qty'),
    buy: document.getElementById('buy-btn'),
    download: document.getElementById('download-area'),

    qList: document.getElementById('q-list'),
    qForm: document.getElementById('q-form'),
    qLogin: document.getElementById('q-login'),
    qText: document.getElementById('q-text'),
    qSend: document.getElementById('q-send'),

    rList: document.getElementById('r-list'),
    rForm: document.getElementById('r-form'),
    rHint: document.getElementById('r-hint'),
    rRating: document.getElementById('r-rating'),
    rComment: document.getElementById('r-comment'),
    rSend: document.getElementById('r-send'),
  };

  function showError(msg) {
    alertBox.className = 'alert';
    alertBox.style.display = 'block';
    alertBox.textContent = msg;
  }

  async function loadProduct() {
    alertBox.style.display = 'none';
    const data = await window.api.apiFetch(`/api/products/${encodeURIComponent(id)}`);
    const p = data.product;
    document.title = `${p.title} | NeonMods`;

    els.img.src = p.imageUrl;
    els.title.textContent = p.title;
    els.seller.innerHTML = `Vendedor: <a href="/u/${encodeURIComponent(p.seller.nick)}" style="color:var(--neon-purple)">@${window.api.escapeHtml(p.seller.nick)}</a>`;
    els.desc.textContent = p.description;
    els.price.textContent = window.api.formatCentsBRL(p.priceCents);
    els.stock.textContent = String(p.stock);
    els.rating.textContent = `${stars(data.rating.avg)} • ${data.rating.count} avaliações`;

    // Buy button state
    if (!me?.user) {
      els.buy.textContent = 'Fazer login para comprar';
    } else if (data.viewer.isSeller) {
      els.buy.textContent = 'Você é o vendedor';
      els.buy.disabled = true;
    } else if (p.stock <= 0) {
      els.buy.textContent = 'Sem estoque';
      els.buy.disabled = true;
    } else {
      els.buy.textContent = 'Comprar (demo)';
      els.buy.disabled = false;
    }

    // Download area
    if (me?.user && data.viewer.hasPurchased) {
      els.download.style.display = 'block';
      els.download.innerHTML = `
        <div class="success">Compra confirmada. <a href="/api/download/${p.id}" style="color:var(--neon-purple); font-weight:700">Baixar arquivo do mod</a></div>
      `;
    } else {
      els.download.style.display = 'none';
    }

    // Questions form
    if (me?.user) {
      els.qForm.style.display = 'block';
      els.qLogin.style.display = 'none';
    } else {
      els.qForm.style.display = 'none';
      els.qLogin.style.display = 'block';
    }

    // Reviews form
    if (!me?.user) {
      els.rForm.style.display = 'none';
      els.rHint.textContent = 'Faça login para ver/avaliar.';
    } else if (!data.viewer.canReview) {
      els.rForm.style.display = 'none';
      els.rHint.textContent = 'Apenas compradores podem avaliar este produto.';
    } else {
      els.rForm.style.display = 'block';
      els.rHint.textContent = data.viewer.existingReview ? 'Você pode editar sua avaliação.' : 'Deixe sua avaliação.';
      if (data.viewer.existingReview) {
        els.rRating.value = data.viewer.existingReview.rating;
        els.rComment.value = data.viewer.existingReview.comment || '';
      }
    }

    return data;
  }

  async function loadQuestions(viewer) {
    const data = await window.api.apiFetch(`/api/products/${encodeURIComponent(id)}/questions`);
    const rows = data.data || [];
    const isSellerOrAdmin = !!me?.user && (viewer?.isSeller || (me.user.role === 'ADMIN' && !me.session?.isImpersonating));

    if (!rows.length) {
      els.qList.innerHTML = `<div class="muted">Ainda sem perguntas.</div>`;
      return;
    }

    els.qList.innerHTML = rows
      .map((q) => {
        const answered = !!q.answerId;
        const answerBlock = answered
          ? `<div class="mt-12" style="padding:10px;border-left:3px solid rgba(188, 19, 254, 0.45);background:rgba(188,19,254,0.06);border-radius:10px">
               <div class="help">Resposta de @${window.api.escapeHtml(q.answerAuthorNick || 'seller')}:</div>
               <div>${window.api.escapeHtml(q.answerText || '')}</div>
             </div>`
          : isSellerOrAdmin
          ? `<div class="mt-12">
               <textarea class="input" data-answer="${q.id}" rows="2" placeholder="Responder..."></textarea>
               <button class="btn-neon mt-12" data-answer-btn="${q.id}">Enviar resposta</button>
             </div>`
          : `<div class="help mt-12">Aguardando resposta do vendedor.</div>`;

        return `
          <div class="card" style="margin-bottom:12px">
            <div class="help">@${window.api.escapeHtml(q.authorNick)} perguntou:</div>
            <div>${window.api.escapeHtml(q.text)}</div>
            ${answerBlock}
          </div>
        `;
      })
      .join('');

    // Bind answer buttons
    els.qList.querySelectorAll('[data-answer-btn]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const qid = btn.getAttribute('data-answer-btn');
        const textarea = els.qList.querySelector(`[data-answer="${qid}"]`);
        const text = String(textarea?.value || '').trim();
        if (!text) return;
        try {
          await window.api.apiFetch(`/api/questions/${qid}/answer`, {
            method: 'POST',
            body: JSON.stringify({ text }),
          });
          const updated = await loadProduct();
          await loadQuestions(updated.viewer);
        } catch {
          alert('Falha ao responder.');
        }
      });
    });
  }

  async function loadReviews() {
    const data = await window.api.apiFetch(`/api/products/${encodeURIComponent(id)}/reviews`);
    const rows = data.data || [];
    if (!rows.length) {
      els.rList.innerHTML = `<div class="muted">Ainda sem avaliações.</div>`;
      return;
    }
    els.rList.innerHTML = rows
      .map((r) => {
        return `
          <div class="card" style="margin-bottom:12px">
            <div class="help">@${window.api.escapeHtml(r.buyerNick)} • ${stars(r.rating)}</div>
            <div>${window.api.escapeHtml(r.comment || '')}</div>
          </div>
        `;
      })
      .join('');
  }

  // Buy action
  els.buy.addEventListener('click', async () => {
    if (!me?.user) {
      window.location.href = `/login`;
      return;
    }
    const qty = Math.max(1, Number(els.qty.value || 1));
    try {
      const r = await window.api.apiFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ productId: Number(id), qty }),
      });
      await loadProduct();
      await loadReviews();
      showError(`Compra confirmada! Pedido #${r.orderId}. O download foi liberado.`);
      alertBox.className = 'success';
      alertBox.style.display = 'block';
    } catch (err) {
      const code = err?.data?.error;
      if (code === 'INSUFFICIENT_WALLET') return showError('Saldo insuficiente na wallet demo. Vá em Perfil > Wallet e adicione saldo.');
      if (code === 'OUT_OF_STOCK') return showError('Sem estoque disponível.');
      if (code === 'CANNOT_BUY_OWN_PRODUCT') return showError('Você não pode comprar seu próprio produto.');
      if (code === 'BANNED') return showError('Sua conta foi banida.');
      showError('Falha ao comprar.');
    }
  });

  // Question send
  els.qSend.addEventListener('click', async () => {
    const text = String(els.qText.value || '').trim();
    if (!text) return;
    try {
      await window.api.apiFetch(`/api/products/${encodeURIComponent(id)}/questions`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      els.qText.value = '';
      const updated = await loadProduct();
      await loadQuestions(updated.viewer);
    } catch {
      alert('Falha ao enviar pergunta.');
    }
  });

  // Review save
  els.rSend.addEventListener('click', async () => {
    const rating = Number(els.rRating.value);
    const comment = String(els.rComment.value || '').trim();
    try {
      await window.api.apiFetch(`/api/products/${encodeURIComponent(id)}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ rating, comment }),
      });
      await loadReviews();
      const updated = await loadProduct();
      alertBox.className = 'success';
      alertBox.style.display = 'block';
      alertBox.textContent = 'Avaliação salva.';
    } catch (err) {
      const code = err?.data?.error;
      if (code === 'PURCHASE_REQUIRED') return showError('Você precisa comprar para avaliar.');
      showError('Falha ao salvar avaliação.');
    }
  });

  // Initial load
  try {
    const data = await loadProduct();
    await loadQuestions(data.viewer);
    await loadReviews();
  } catch (err) {
    console.error(err);
    showError('Produto não encontrado.');
  }
};
