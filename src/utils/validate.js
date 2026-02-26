function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  // Simple but effective email validation for demo/portfolio
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeNick(nick) {
  return String(nick || '').trim();
}

function isValidNick(nick) {
  // 3-20 chars, letters numbers underscore hyphen
  return /^[a-zA-Z0-9_-]{3,20}$/.test(nick);
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

function clampInt(value, min, max) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function parseMoneyToCents(value) {
  // Accept "29,90" or "29.90" or number
  const str = String(value || '').trim().replace(',', '.');
  const num = Number(str);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

function formatCentsBRL(cents) {
  const n = Number(cents || 0) / 100;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

module.exports = {
  isValidEmail,
  normalizeEmail,
  normalizeNick,
  isValidNick,
  isValidPassword,
  clampInt,
  parseMoneyToCents,
  formatCentsBRL,
};
