// WOB: açılış, oturum ve sayfa yönlendirme.
import { sb, state, isAdmin, loadProfile, h, icon, fail, closeLayers, router } from './core.js';
import * as S from './screens.js';

const app = document.getElementById('app');

const TABS = [
  ['events', '#/', 'Etkinlikler', 'calendar', false],
  ['suggestions', '#/suggestions', 'Öneriler', 'bulb', false],
  ['dashboard', '#/dashboard', 'Dashboard', 'chart', true],
  ['members', '#/members', 'Üyeler', 'people', true],
  ['profile', '#/profile', 'Profil', 'person', false],
];

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [a, b] = parts;
  // Oturum durumuna göre yönlendir
  if (!state.session) return a === 'register' ? S.register : S.login;
  if (!state.profile || state.profile.status !== 'approved') return S.pending;
  if (a === 'login' || a === 'register' || a === 'pending') {
    history.replaceState(null, '', '#/');
    return S.events;
  }
  if (!a) return S.events;
  if (a === 'event' && b) return () => S.eventDetail(b);
  if (a === 'edit') return () => S.eventEdit(b);
  if (a === 'formation' && b) return () => S.formation(b);
  if (a === 'suggestions') return S.suggestions;
  if (a === 'dashboard') return S.dashboard;
  if (a === 'members') return S.members;
  if (a === 'profile') return S.profile;
  return S.events;
}

function shell(view) {
  const bar = view.bar === false ? null : h('header', { class: 'bar' },
    view.back ? h('a', { class: 'back', href: view.back }, icon('back'), 'Geri') : h('span'),
    h('h1', null, view.title ?? 'WOB'), h('span'));
  const tabs = view.tab ? h('nav', { class: 'tabs', 'aria-label': 'Ana menü' },
    TABS.filter((t) => !t[4] || isAdmin()).map(([key, href, label, ic]) =>
      h('a', { href, class: key === view.tab ? 'on' : '', 'aria-current': key === view.tab ? 'page' : null }, icon(ic), label))) : null;
  app.className = (view.tab ? 'has-tabs ' : '') + (bar ? '' : 'no-bar');
  app.replaceChildren(...[bar, h('main', { class: 'page' }, view.node), tabs].filter(Boolean));
}

let token = 0;
let lastHash = null;
async function render() {
  const my = ++token;
  const same = lastHash === location.hash;
  const y = window.scrollY;
  closeLayers();
  if (!same) {
    // Yeni sayfaya geçerken kısa bir yükleniyor göstergesi
    app.querySelector('main')?.replaceChildren(h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
  }
  let view;
  try {
    view = await route()();
  } catch (err) {
    if (my !== token) return;
    view = {
      title: 'WOB',
      back: location.hash && location.hash !== '#/' ? '#/' : null,
      node: [h('div', { class: 'empty' }, 'Veriler yüklenemedi. İnternet bağlantını kontrol et.'),
        h('button', { class: 'btn block', onclick: render }, 'Tekrar dene')],
    };
    fail(err);
  }
  if (my !== token) return; // Bu sırada başka bir sayfaya geçildi
  shell(view);
  lastHash = location.hash;
  window.scrollTo(0, same ? y : 0);
}

router.refresh = render;
window.addEventListener('hashchange', render);

// Uygulamaya geri dönüldüğünde verileri tazele (form içeren ekranlar hariç)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.session) return;
  if (/^#\/(edit|formation|profile|suggestions)/.test(location.hash) || document.getElementById('layer').children.length) return;
  render();
});

async function boot() {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  await loadProfile();
  await render();

  sb.auth.onAuthStateChange((event, session) => {
    const before = state.session?.user?.id ?? null;
    state.session = session;
    if ((session?.user?.id ?? null) === before && event !== 'SIGNED_OUT') return; // Sadece anahtar yenilendi
    // Supabase önerisi: bu geri çağrının içinde doğrudan beklemeli çağrı yapma
    setTimeout(async () => {
      await loadProfile();
      if (!session) history.replaceState(null, '', '#/login');
      render();
    }, 0);
  });
}

boot().catch((err) => {
  app.replaceChildren(h('div', { class: 'boot' }, h('div', { class: 'empty' }, 'Uygulama açılamadı. İnternet bağlantını kontrol edip sayfayı yenile.')));
  console.error(err);
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
