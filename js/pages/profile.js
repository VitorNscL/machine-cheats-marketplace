window.pages = window.pages || {};

function getNickFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[parts.length - 1];
}

function starsText(avg, count) {
  const n = Math.round(Number(avg || 0) * 10) / 10;
  let s = '';
  const full = Math.floor(n);
  for (let i = 0; i < 5; i++) s += i < full ? '★' : '☆';
  return `${s} ${n} (${count})`;
}

function badge(label, variant = 'badge') {
  return `<span class="${variant}">${label}</span>`;
}

window.pages.profile = async function profilePage(me) {
  const nick = decodeURIComponent(getNickFromPath());
  const alertBox = document.getElementById('profile-alert');

  const els = {
    avatar: document.getElementById('u-avatar'),
    nick: document.getElementById('u-nick'),
    badges: document.getElementById('u-badges'),
    rating: document.getElementById('u-rating'),
    bio: document.getElementById('u-bio'),
    editLink: document.getElementById('edit-profile-link'),

    prForm: document.getElementById('pr-form'),
    prHint: document.getElementById('pr-hint'),
    prRating: document.getElementById('pr-rating'),
    prComment: document.getElementById('pr-comment'),
    prSend: document.getElementById('pr-send'),

    prodGrid: document.getElementById('seller-products'),
    prodEmpty: document.getElementById('seller-empty'),
    prList: document.getElementById('pr-list'),
  };

  function showError(msg) {
    alertBox.className = 'alert';
    alertBox.style.display = 'block';
    alertBox.textContent = msg;
  }

  async function loadProfile() {
    const data = await window.api.apiFetch(`/api/users/${encodeURIComponent(nick)}`);
    const u = data.user;
    document.title = `@${u.nick} | NeonMods`;
    els.avatar.src = u.avatarUrl;
    els.nick.textContent = `@${u.nick}${u.displayName ? ` • ${u.displayName}` : ''}`;
    els.bio.textContent = u.bio || 'Sem bio.';
    els.rating.textContent = `Reputação: ${starsText(u.rating.avg, u.rating.count)}`;

    const badges = [];
    if (u.isVip) badges.push(badge('VIP', 'badge'));
    if (u.role === 'ADMIN') badges.push(badge('Admin', 'badge-soft'));
    els.badges.innerHTML = badges.join('') || '<span class="help">Sem badges</span>';

    // Owner can edit
    if (data.viewer?.isOwner) {
      els.editLink.style.display = 'inline-block';
    }

    // Rating form
    if (!me?.user) {
      els.prForm.style.display = 'none';
      els.prHint.innerHTML = `Faça <a href="/login" style="color:var(--neon-purple)">login</a> para avaliar.`;
    } else if (data.viewer?.isOwner) {
      els.prForm.style.display = 'none';
      els.prHint.textContent = 'Você não pode avaliar seu próprio perfil.';
    } else if (!data.viewer?.canRate) {
      els.prForm.style.display = 'none';
      els.prHint.textContent = 'Você só pode avaliar após comprar pelo menos 1 produto deste vendedor.';
    } else {
      els.prForm.style.display = 'block';
      els.prHint.textContent = data.viewer.existingRating ? 'Você pode editar sua avaliação.' : 'Deixe sua avaliação.';
      if (data.viewer.existingRating) {
        els.prRating.value = data.viewer.existingRating.rating;
        els.prComment.value = data.viewer.existingRating.comment || '';
      }
    }

    return data;
  }

  async function loadProducts() {
    const data = await window.api.apiFetch(`/api/users/${encodeURIComponent(nick)}/products`);
    const items = data.data || [];
    els.prodGrid.innerHTML = items
      .map((p) => {
        return `
          <article class="mod-card">
            <img src="${p.imageUrl}" alt="Imagem" style="width:100%;height:160px;object-fit:cover;border-radius:12px;border:1px solid rgba(255,255,255,0.08)" />
            <h3 class="mt-12">${window.api.escapeHtml(p.title)}</h3>
            <p>${window.api.escapeHtml(p.description).slice(0, 140)}${p.description.length > 140 ? '…' : ''}</p>
            <div class="row" style="align-items:center">
              <div>
                <div class="price" style="margin-bottom:0">${window.api.formatCentsBRL(p.priceCents)}</div>
                <div class="help">Estoque: ${p.stock}</div>
              </div>
            </div>
            <div class="mt-12"><a class="btn-comprar btn-block" href="/mod/${p.id}">Ver</a></div>
          </article>
        `;
      })
      .join('');
    els.prodEmpty.style.display = items.length ? 'none' : 'block';
  }

  async function loadRatings() {
    const data = await window.api.apiFetch(`/api/users/${encodeURIComponent(nick)}/ratings`);
    const rows = data.data || [];
    if (!rows.length) {
      els.prList.innerHTML = '<div class="muted">Ainda sem avaliações.</div>';
      return;
    }
    els.prList.innerHTML = rows
      .map((r) => {
        return `
          <div class="card" style="margin-bottom:12px">
            <div class="help">@${window.api.escapeHtml(r.fromNick)} • ${starsText(r.rating, 1).split('(')[0].trim()} (${r.rating})</div>
            <div>${window.api.escapeHtml(r.comment || '')}</div>
          </div>
        `;
      })
      .join('');
  }

  els.prSend.addEventListener('click', async () => {
    const rating = Number(els.prRating.value);
    const comment = String(els.prComment.value || '').trim();
    try {
      await window.api.apiFetch(`/api/users/${encodeURIComponent(nick)}/ratings`, {
        method: 'POST',
        body: JSON.stringify({ rating, comment }),
      });
      await loadRatings();
      alertBox.className = 'success';
      alertBox.style.display = 'block';
      alertBox.textContent = 'Avaliação salva.';
    } catch (err) {
      const code = err?.data?.error;
      if (code === 'PURCHASE_REQUIRED') return showError('Você precisa comprar do vendedor para avaliar.');
      showError('Falha ao salvar avaliação.');
    }
  });

  try {
    await loadProfile();
    await loadProducts();
    await loadRatings();
  } catch (err) {
    console.error(err);
    showError('Perfil não encontrado.');
  }
};
