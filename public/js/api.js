// Simple API helper (adds CSRF automatically)

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}

async function apiFetch(url, options = {}) {
  const opts = { ...options };
  opts.headers = new Headers(opts.headers || {});

  // Add CSRF for state-changing requests
  const method = (opts.method || 'GET').toUpperCase();
  const safe = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (!safe) {
    const csrf = getCookie('csrf');
    if (csrf) opts.headers.set('X-CSRF-Token', csrf);
  }

  // Default JSON
  if (opts.body && !(opts.body instanceof FormData) && !opts.headers.has('Content-Type')) {
    opts.headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, opts);
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (!res.ok) {
    const err = new Error('API_ERROR');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function formatCentsBRL(cents) {
  const n = (Number(cents || 0) / 100);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

window.api = { apiFetch, getCookie, formatCentsBRL, escapeHtml };
