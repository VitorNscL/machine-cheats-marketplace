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

function normalizeCPF(cpf) {
  return String(cpf || '').replace(/\D/g, '');
}

function isValidCPF(cpf) {
  const c = normalizeCPF(cpf);
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false; // all digits equal

  function calcCheckDigit(base) {
    let sum = 0;
    for (let i = 0; i < base.length; i++) {
      sum += Number(base[i]) * (base.length + 1 - i);
    }
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  }

  const d1 = calcCheckDigit(c.slice(0, 9));
  const d2 = calcCheckDigit(c.slice(0, 10));
  return d1 === Number(c[9]) && d2 === Number(c[10]);
}

function isValidBirthDate(dateStr, { minAgeYears = 13 } = {}) {
  if (typeof dateStr !== 'string') return false;
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(dateStr.trim());
  if (!m) return false;
  const d = new Date(dateStr + 'T00:00:00.000Z');
  if (Number.isNaN(d.getTime())) return false;
  // Must not be in the future
  const now = new Date();
  if (d.getTime() > now.getTime()) return false;

  // Age check
  const ageMs = now.getTime() - d.getTime();
  const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365.25);
  return ageYears >= minAgeYears;
}

function maskCPF(cpf) {
  const c = normalizeCPF(cpf);
  if (c.length !== 11) return '';
  return c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
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
  normalizeCPF,
  isValidCPF,
  isValidBirthDate,
  maskCPF,
};
