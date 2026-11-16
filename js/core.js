// WOB çekirdek: Supabase bağlantısı, küçük arayüz araçları, pencere ve bildirimler.

// Publishable key herkese açık bir anahtardır; verileri veritabanındaki güvenlik kuralları korur.
const SUPABASE_URL = 'https://hgpncthohgxvazoizvho.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KHfD-45B4nPBTxeU6Yr6DQ_PurFTKx3';

// E-postadaki bağlantıyla gelindiyse (şifre sıfırlama, doğrulama) bilgiyi Supabase adresi temizlemeden önce al
const linkParams = new URLSearchParams(location.hash.replace(/^#/, ''));
const linkRecovery = linkParams.get('type') === 'recovery';
const linkError = linkParams.get('error_description');

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const state = { session: null, profile: null, recovery: linkRecovery, linkError };
export const me = () => state.session?.user?.id ?? null;
export const isAdmin = () => state.profile?.role === 'admin' && state.profile?.status === 'approved';

export async function loadProfile() {
  if (!state.session) {
    state.profile = null;
    return;
  }
  const { data } = await sb.from('profiles').select('*').eq('id', state.session.user.id).maybeSingle();
  state.profile = data ?? null;
}

// ---------- DOM ----------
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden']);
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let later = null;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (PROPS.has(k)) (later ||= []).push([k, v]);
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  if (later) for (const [k, v] of later) el[k] = v;
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (k == null || k === false || k === true) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k instanceof Node ? k : String(k));
  }
}

const ICONS = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.500A6 6 0 0 0 12 3z"/>',
  chart: '<path d="M5 21V11M12 21V4M19 21v-7"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.500a5 5 0 0 1 4.5 5"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  like: '<path d="M7 11v9H4v-9zM7 11l4-8c1.5 0 2.5 1 2.5 2.500V9h5a2 2 0 0 1 2 2.300l-1.2 7A2 2 0 0 1 17.3 20H7"/>',
  dislike: '<path d="M7 13V4H4v9zM7 13l4 8c1.5 0 2.5-1 2.5-2.500V15h5a2 2 0 0 0 2-2.300l-1.2-7A2 2 0 0 0 17.3 4H7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6"/>',
};
export function icon(name) {
  const s = h('span', { class: 'ico', 'aria-hidden': 'true', style: { display: 'inline-flex' } });
  s.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return s.firstChild;
}

// ---------- Tarih ----------
const dayFmt = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
const monFmt = new Intl.DateTimeFormat('tr-TR', { month: 'short' });
export const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${dayFmt.format(d)} · ${timeFmt.format(d)}`;
};
export const fmtMonth = (d) => monFmt.format(d).replace('.', '');
export const pad = (n) => String(n).padStart(2, '0');

// ---------- Katman: bildirim, pencere, alt sayfa ----------
const layer = () => document.getElementById('layer');
let toastTimer = null;
export function toast(msg, bad = false) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, msg);
  layer().append(t);
  toastTimer = setTimeout(() => t.remove(), bad ? 5000 : 2600);
}
export const fail = (error) => toast(typeof error === 'string' ? error : error?.message || 'Bir hata oluştu.', true);

// Onay penceresi. Evet'e basılırsa true döner.
export function confirmBox(title, message, { yes = 'Evet', no = 'Vazgeç', danger = false } = {}) {
  return new Promise((resolve) => {
    const done = (v) => {
      ov.remove();
      resolve(v);
    };
    const ov = h('div', { class: 'overlay mid', onclick: (e) => e.target === ov && done(false) },
      h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true' },
        h('h2', null, title),
        message ? h('div', { class: 'muted' }, message) : null,
        h('div', { class: 'row', style: { marginTop: '8px' } },
          h('button', { class: 'btn ghost grow', onclick: () => done(false) }, no),
          h('button', { class: 'btn grow' + (danger ? ' bad' : ''), onclick: () => done(true) }, yes))));
    layer().append(ov);
  });
}

// Alt sayfa. build(close) içeriği döndürür.
export function sheet(build) {
  const close = () => ov.remove();
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
  const ov = h('div', { class: 'overlay bottom', onclick: (e) => e.target === ov && close() }, box);
  add(box, [build(close)]);
  layer().append(ov);
  return close;
}
export const closeLayers = () => layer().replaceChildren();

// Düğmeyi işlem boyunca kilitler; hata olursa bildirim gösterir.
export function busy(fn) {
  return async (e) => {
    const b = e.currentTarget;
    if (b.disabled) return;
    b.disabled = true;
    try {
      await fn(e);
    } catch (err) {
      fail(err);
    } finally {
      b.disabled = false;
    }
  };
}

// Sık kullanılan parçalar
export const btn = (label, onclick, cls = '') => h('button', { class: 'btn ' + cls, type: 'button', onclick }, label);
export const field = (label, input) => h('label', { class: 'field' }, label, input);
export const input = (attrs) => h('input', { class: 'in', ...attrs });
export const textarea = (attrs) => h('textarea', { class: 'in', ...attrs });
export const badge = (text, cls = '') => h('span', { class: 'badge ' + cls }, text);
export const section = (text) => h('h2', { class: 'section' }, text);
export const logo = (w) => h('img', { src: 'icons/logo.png', alt: 'Warders of Bilgi logosu', width: w, style: { height: 'auto' } });

// Yönlendirme: app.js doldurur
export const router = { refresh: () => {}, go: (hash) => { location.hash = hash; } };

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
