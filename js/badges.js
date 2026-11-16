// Sezonlar, sıralama ve rozetler. Rozetler saklanmaz; yoklama ve öneri verisinden hesaplanır.
import { sb, me, isAdmin, h, toast, confirmBox, sheet, busy, btn, field, input, pad, router } from './core.js';

export const TIERS = [
  { key: 'gold', name: 'Altın', min: 16 },
  { key: 'silver', name: 'Gümüş', min: 12 },
  { key: 'bronze', name: 'Bronz', min: 8 },
];
const STREAK_MIN = 3; // bu kadar art arda katılımdan sonra seri rozeti görünür
const tierOf = (n) => TIERS.find((t) => n >= t.min) ?? null;
const dayFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const day = (iso) => dayFmt.format(new Date(iso));

// ---------- Veri ----------
export async function loadBoard() {
  const { data, error } = await sb.rpc('leaderboard');
  if (error) throw error;
  const members = data.members;
  const seasons = data.seasons.map((s) => {
    const att = new Map(data.stats.filter((x) => x.season_id === s.id).map((x) => [x.user_id, x.attended]));
    const ideas = data.top_suggestions.filter((x) => x.season_id === s.id);
    // Sıra: aynı sayıda katılanlar aynı sırayı paylaşır, sonraki sıra bir artar (1, 1, 2, 3)
    const levels = [...new Set([...att.values()])].sort((a, b) => b - a);
    const rows = members
      .map((m) => {
        const attended = att.get(m.id) ?? 0;
        return {
          ...m,
          attended,
          rank: attended > 0 ? levels.indexOf(attended) + 1 : null,
          tier: tierOf(attended),
          idea: ideas.find((x) => x.user_id === m.id) ?? null,
        };
      })
      .sort((a, b) => b.attended - a.attended || a.full_name.localeCompare(b.full_name, 'tr'));
    return { ...s, open: !s.ends_at, rows, byId: new Map(rows.map((r) => [r.id, r])) };
  });
  return { seasons, current: seasons.find((s) => s.open) ?? null, members: new Map(members.map((m) => [m.id, m])) };
}
// Rozet verisi yüklenemese de ekranlar çalışsın
export const loadBoardSafe = () => loadBoard().catch(() => null);

// ---------- Rozet simgeleri ----------
const SVG = {
  medal: '<path d="M8.5 2.500l3.5 6 3.5-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="15" r="6.5" fill="currentColor"/>',
  flame: '<path d="M12 2.500c.8 3.7 5 5.2 5 10.500a5 5 0 0 1-10 0c0-2 .9-3.3 2-4.3 0 2 .8 3.3 2 3.3.3-3.2-.8-5.5 1-9.500z" fill="currentColor"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.500c.7.7 1 1.5 1 2.500h6c0-1 .3-1.8 1-2.500A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
};
function svg(name) {
  const s = document.createElement('span');
  s.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">${SVG[name]}</svg>`;
  return s.firstChild;
}

// Bir üyenin bir sezondaki rozetleri: [{ key, cls, icon, text, title }]
function seasonBadges(row) {
  if (!row) return [];
  const out = [];
  if (row.rank && row.rank <= 3) out.push({ key: `rank:${row.rank}`, cls: `place p${row.rank}`, text: `${row.rank}.`, title: `Sezon sıralamasında ${row.rank}.` });
  if (row.tier) out.push({ key: `tier:${row.tier.key}`, cls: row.tier.key, icon: 'medal', text: row.tier.name, title: `${row.tier.name} üye: bu sezon ${row.attended} etkinlik` });
  if (row.idea) out.push({ key: 'idea', cls: 'idea', icon: 'bulb', text: 'Fikir', title: `Sezonun en beğenilen önerisi: ${row.idea.title} (${row.idea.likes} beğeni)` });
  return out;
}
const streakBadge = (m) =>
  m && m.streak >= STREAK_MIN ? [{ key: 'streak', cls: 'streak', icon: 'flame', text: String(m.streak), title: `${m.streak} etkinliktir art arda katılıyor` }] : [];

const chip = (b, mini) =>
  h('span', { class: `bdg ${b.cls}` + (mini ? ' mini' : ''), title: b.title, role: 'img', 'aria-label': b.title }, b.icon ? svg(b.icon) : null, mini && b.icon && b.key !== 'streak' ? null : b.text);

// İsimlerin yanında gösterilen küçük rozetler (açık sezon + seri)
export function nameBadges(board, uid) {
  if (!board) return null;
  const list = [...seasonBadges(board.current?.byId.get(uid)), ...streakBadge(board.members.get(uid))];
  return list.length ? h('span', { class: 'bdgs' }, list.map((b) => chip(b, true))) : null;
}

// Yeni kazanılan rozeti bir kez duyur (bu telefonda)
export function announceNew(board) {
  const uid = me();
  if (!board?.current || !uid) return;
  const now = seasonBadges(board.current.byId.get(uid)).map((b) => ({ id: `${board.current.id}:${b.key}`, b }));
  const store = `wob-badges-${uid}`;
  try {
    const raw = localStorage.getItem(store);
    const seen = new Set(raw ? JSON.parse(raw) : []);
    const fresh = now.filter((x) => !seen.has(x.id));
    if (raw && fresh.length) toast(`Yeni rozet: ${fresh.map((x) => x.b.title.split(':')[0]).join(', ')} 🏅`);
    localStorage.setItem(store, JSON.stringify([...new Set([...seen, ...now.map((x) => x.id)])]));
  } catch { /* depolama kapalıysa duyurma */ }
}

// ---------- Sezon yönetimi (yönetici) ----------
function startSeasonSheet(board) {
  const last = board.seasons[0] ?? null; // en yeni sezon (kapalı)
  const today = new Date();
  const name = input({ value: `${today.getFullYear()} Sezonu`, placeholder: 'Örn: 2027 Sezonu' });
  const date = input({ type: 'date', value: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}` });
  sheet((close) => [
    h('h2', null, 'Sezon başlat'),
    h('div', { class: 'muted' }, 'Sıralama ve rozetler bu tarihten sonraki etkinliklere göre hesaplanır. Tarihi geçmişe alırsan daha önce yapılmış etkinlikler de sezona girer.'),
    field('Sezon adı', name),
    field('Başlangıç tarihi', date),
    btn('Sezonu başlat', busy(async () => {
      if (name.value.trim().length < 2) return toast('Sezona bir ad ver.', true);
      let start = new Date(`${date.value}T00:00`);
      if (!date.value || Number.isNaN(start.getTime())) return toast('Başlangıç tarihi seç.', true);
      // Önceki sezonun bittiği günü seçtiyse, bittiği andan başlat
      if (last?.ends_at && start < new Date(last.ends_at) && start >= new Date(new Date(last.ends_at).toDateString())) start = new Date(last.ends_at);
      const { error } = await sb.from('seasons').insert({ name: name.value.trim(), starts_at: start.toISOString() });
      if (error) return toast(error.message, true);
      close();
      toast('Sezon başladı.');
      router.refresh();
    }), 'block'),
    btn('Vazgeç', close, 'ghost block'),
  ]);
}

function seasonAdmin(board) {
  const cur = board.current;
  if (!cur) {
    return h('div', { class: 'card' },
      h('b', null, 'Açık sezon yok'),
      h('div', { class: 'muted' }, 'Sezon başlatılana kadar etkinlikler sıralamaya ve sezon rozetlerine sayılmaz.'),
      btn('+ Sezon başlat', () => startSeasonSheet(board), 'block'));
  }
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('b', { class: 'grow' }, cur.name), h('span', { class: 'badge ok' }, 'Açık sezon')),
    h('div', { class: 'muted' }, `${day(cur.starts_at)} tarihinden beri · ${cur.events} etkinlik`),
    btn('Sezonu bitir', busy(async () => {
      const warn = cur.open_events > 0
        ? `Bu sezonda tarihi geçtiği halde tamamlanmamış ${cur.open_events} etkinlik var. Önce onları tamamlayıp yoklamalarını almanı öneririm. `
        : '';
      if (!(await confirmBox(`${cur.name} bitsin mi?`, `${warn}Sezon kapanır ve sonuçları üyelerin profilinde kalır. Yeni sezonu sonra başlatırsın.`, { yes: 'Sezonu bitir', danger: cur.open_events > 0 }))) return;
      const { error } = await sb.from('seasons').update({ ends_at: new Date().toISOString() }).eq('id', cur.id);
      if (error) return toast(error.message, true);
      toast('Sezon bitti.');
      router.refresh();
    }), 'ghost block'));
}

// ---------- Sıralama ----------
let selected = null; // seçili sezonun kimliği
export function ranking(board) {
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  let query = '';
  function draw() {
    const season = board.seasons.find((s) => s.id === selected) ?? board.current ?? board.seasons[0] ?? null;
    const q = query.trim().toLocaleLowerCase('tr');
    const rows = season ? season.rows.filter((r) => !q || r.full_name.toLocaleLowerCase('tr').includes(q)) : [];
    const max = Math.max(TIERS[0].min, ...(season ? season.rows.map((r) => r.attended) : [0]));
    const kids = [
      isAdmin() ? seasonAdmin(board) : null,
      !season ? h('div', { class: 'empty' }, 'Henüz sezon başlatılmadı. Sezon başlayınca sıralama burada görünecek.') : null,
      season && board.seasons.length > 1
        ? h('select', { class: 'in', 'aria-label': 'Sezon', onchange: (e) => { selected = e.target.value; draw(); } },
            board.seasons.map((s) => h('option', { value: s.id, selected: s.id === season.id }, s.name + (s.open ? ' (açık)' : ''))))
        : null,
      season ? h('div', { class: 'muted' },
        `${season.name}: ${day(season.starts_at)} – ${season.open ? 'devam ediyor' : day(season.ends_at)} · ${season.events} etkinlik. `,
        `Sıralama yoklamaya göredir. Rozetler: Bronz ${TIERS[2].min}, Gümüş ${TIERS[1].min}, Altın ${TIERS[0].min} etkinlik.`) : null,
      season ? h('div', { class: 'card' },
        rows.length ? null : h('div', { class: 'muted' }, q ? 'Aramayla eşleşen üye yok.' : 'Henüz üye yok.'),
        rows.map((r) => h('div', { class: 'rank' + (r.id === me() ? ' me' : '') },
          h('span', { class: 'n' }, r.rank ?? '–'),
          h('span', { class: 'who2' }, h('span', { style: { fontWeight: '600' } }, r.full_name),
            h('span', { class: 'bdgs' }, [...seasonBadges(r), ...(season.open ? streakBadge(r) : [])].map((b) => chip(b)))),
          h('span', { class: 'v' }, r.attended),
          h('div', { class: 'track' }, h('i', { style: { width: `${(r.attended / max) * 100}%` } }))))) : null,
    ].filter(Boolean);
    el.replaceChildren(...kids);
  }
  draw();
  return { el, search: (v) => { query = v; draw(); } };
}

// ---------- Profil: rozetlerim ----------
export function myBadges(board) {
  const uid = me();
  const m = board.members.get(uid);
  const cur = board.current;
  const row = cur?.byId.get(uid);
  const out = [];
  if (cur && row) {
    const next = [...TIERS].reverse().find((t) => row.attended < t.min) ?? null;
    const goal = next?.min ?? TIERS[0].min;
    const badges = seasonBadges(row);
    out.push(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', { class: 'grow' }, cur.name), h('span', { class: 'muted small' }, row.rank ? `${row.rank}. sıra` : 'Sırada değil')),
      badges.length ? h('div', { class: 'bdgs' }, badges.map((b) => chip(b))) : h('div', { class: 'muted' }, 'Bu sezon henüz rozetin yok.'),
      h('div', { class: 'track', style: { height: '8px' } }, h('i', { style: { width: `${Math.min(100, (row.attended / goal) * 100)}%` } })),
      h('div', { class: 'muted small' }, next
        ? `${row.attended} etkinliğe katıldın. ${next.name} rozete ${next.min - row.attended} etkinlik kaldı.`
        : `${row.attended} etkinliğe katıldın. En üst rozete ulaştın.`)));
  } else {
    out.push(h('div', { class: 'card muted' }, 'Şu an açık bir sezon yok. Sezon başlayınca rozetlerin burada görünecek.'));
  }
  if (m) {
    out.push(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', { class: 'grow' }, 'Katılım serisi'), m.streak >= STREAK_MIN ? chip(streakBadge(m)[0]) : null),
      h('div', { class: 'muted' }, `Art arda ${m.streak} etkinlik · En uzun serin: ${m.best_streak} · Toplam ${m.total} etkinlik`),
      h('div', { class: 'muted small' }, `Seri rozeti art arda ${STREAK_MIN} etkinlikte başlar; kaçırılan her etkinlik seriyi sıfırlar.`)));
  }
  const past = board.seasons.filter((s) => !s.open).map((s) => ({ s, r: s.byId.get(uid) })).filter(({ r }) => r && (r.attended > 0 || r.idea));
  if (past.length) {
    out.push(h('div', { class: 'card' },
      h('b', null, 'Geçmiş sezonlar'),
      past.map(({ s, r }) => h('div', { class: 'prow' },
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: '600' } }, s.name),
          h('div', { class: 'muted small' }, `${r.attended} etkinlik${r.rank ? ` · ${r.rank}. sıra` : ''}`)),
        h('span', { class: 'bdgs' }, seasonBadges(r).map((b) => chip(b)))))));
  }
  return out;
}

