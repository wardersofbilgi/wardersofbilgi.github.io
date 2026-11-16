// Sezonlar, sıralama ve rozetler. Rozetler saklanmaz; yoklama ve öneri verisinden hesaplanır.
import { sb, me, isAdmin, h, toast, confirmBox, sheet, busy, btn, field, input, pad, router } from './core.js';

// Tek rozet, puanla: etkinlik 2 puan, Çarşamba Buluşması 1 puan (sezonluk)
export const POINTS = { normal: 2, wednesday: 1 };
export const TIERS = [
  { key: 'gold', name: 'Altın', min: 32 },
  { key: 'silver', name: 'Gümüş', min: 24 },
  { key: 'bronze', name: 'Bronz', min: 16 },
];
const STREAK_MIN = 3; // bu kadar art arda katılımdan sonra seri yazısı görünür
const tierOf = (n) => TIERS.find((t) => n >= t.min) ?? null;
const dayFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const day = (iso) => dayFmt.format(new Date(iso));

// ---------- Veri ----------
export async function loadBoard() {
  const [{ data, error }, aw, st] = await Promise.all([
    sb.rpc('leaderboard'),
    sb.from('awards').select('id, user_id, title, icon, created_at').order('created_at'),
    sb.from('app_settings').select('value').eq('key', 'badge_tiers').maybeSingle(),
  ]);
  if (error) throw error;
  // Rozet puanları yönetici ayarından gelir; ayar yoksa varsayılan 16 / 24 / 32
  const v = st.error ? null : st.data?.value;
  for (const t of TIERS) if (Number.isInteger(v?.[t.key]) && v[t.key] > 0) t.min = v[t.key];
  const awards = aw.error ? [] : aw.data; // tablo henüz yoksa rozetsiz devam et
  const members = data.members.map((m) => ({ ...m, awards: awards.filter((a) => a.user_id === m.id) }));
  const seasons = data.seasons.map((s) => {
    const ideas = data.top_suggestions.filter((x) => x.season_id === s.id);
    const count = (kind) => new Map(data.stats.filter((x) => x.season_id === s.id && (x.kind ?? 'normal') === kind).map((x) => [x.user_id, x.attended]));
    const ev = count('normal');
    const wd = count('wednesday');
    const base = members.map((m) => {
      const attended = ev.get(m.id) ?? 0;
      const wed = wd.get(m.id) ?? 0;
      return { ...m, attended, wed, points: attended * POINTS.normal + wed * POINTS.wednesday, idea: ideas.find((x) => x.user_id === m.id) ?? null };
    });
    // Sıra: aynı puandakiler aynı sırayı paylaşır, sonraki sıra bir artar (1, 1, 2, 3)
    const levels = [...new Set(base.map((r) => r.points).filter((n) => n > 0))].sort((a, b) => b - a);
    const rows = base
      .map((r) => ({ ...r, rank: r.points > 0 ? levels.indexOf(r.points) + 1 : null, tier: tierOf(r.points) }))
      .sort((a, b) => b.points - a.points || a.full_name.localeCompare(b.full_name, 'tr'));
    return { ...s, open: !s.ends_at, rows, byId: new Map(rows.map((r) => [r.id, r])) };
  });
  return { seasons, current: seasons.find((s) => s.open) ?? null, members: new Map(members.map((m) => [m.id, m])), awards };
}
// Rozet verisi yüklenemese de ekranlar çalışsın
export const loadBoardSafe = () => loadBoard().catch(() => null);

// ---------- Rozet simgeleri ----------
const SVG = {
  medal: '<path d="M8.5 2.500l3.5 6 3.5-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="15" r="6.5" fill="currentColor"/>',
  flame: '<path d="M12 2.500c.8 3.7 5 5.2 5 10.500a5 5 0 0 1-10 0c0-2 .9-3.3 2-4.3 0 2 .8 3.3 2 3.3.3-3.2-.8-5.5 1-9.500z" fill="currentColor"/>',
  shield: '<path d="M12 3l7.500 2.500v5.500c0 4.600-3 8.300-7.500 10-4.500-1.700-7.500-5.400-7.500-10V5.500z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  star: '<path d="M12 3l2.700 5.600 6.100.800-4.500 4.300 1.100 6.100L12 16.900l-5.400 2.900 1.100-6.100-4.500-4.300 6.100-.800z" fill="currentColor"/>',
  crown: '<path d="M3 8l4.500 4L12 5l4.500 7L21 8l-1.800 10H4.800z" fill="currentColor"/>',
  road: '<path d="M8 3L4 21M16 3l4 18M12 4v3M12 10.500v3M12 17v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  helmet: '<path d="M4 15a8 8 0 0 1 16 0v2H11l-2-4H4.300M4 15v2h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  heart: '<path d="M12 20s-7-4.400-7-9.800A4.200 4.200 0 0 1 12 7.500a4.200 4.200 0 0 1 7 2.700C19 15.600 12 20 12 20z" fill="currentColor"/>',
  wrench: '<path d="M14.500 6.500a4 4 0 0 0 5 5L11 20a2.100 2.100 0 0 1-3-3l8.500-8.500a4 4 0 0 0-2-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.500c.7.7 1 1.5 1 2.500h6c0-1 .3-1.8 1-2.500A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
};
function svg(name) {
  const s = document.createElement('span');
  s.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">${SVG[name]}</svg>`;
  return s.firstChild;
}

// Seviye rozeti (sezon puanına göre). Tek rozet türü budur; isimlerin yanında yalnızca bu görünür.
const tierBadge = (row) => (row?.tier ? [{ key: `tier:${row.tier.key}`, cls: row.tier.key, icon: 'medal', keep: true, text: row.tier.name, title: `${row.tier.name} üye: bu sezon ${row.points} puan` }] : []);
const ideaBadge = (row) => (row?.idea ? [{ key: 'idea', cls: 'idea', icon: 'bulb', text: 'Fikir', title: `Sezonun en beğenilen önerisi: ${row.idea.title} (${row.idea.likes} beğeni)` }] : []);

const chip = (b, mini) =>
  h('span', { class: `bdg ${b.cls}` + (mini ? ' mini' : ''), title: b.title, role: 'img', 'aria-label': b.title }, b.icon ? svg(b.icon) : null, mini && b.icon && !b.keep ? null : b.text);

// Yöneticinin elle verdiği özel rozetler (kalıcı; profilde görünür)
export const AWARD_ICONS = ['star', 'crown', 'road', 'helmet', 'heart', 'wrench'];
export const awardChip = (a, mini) => chip({ key: 'award', cls: 'award', icon: AWARD_ICONS.includes(a.icon) ? a.icon : 'star', text: a.title, title: a.title ? `Özel rozet: ${a.title}` : 'Özel rozet' }, mini);

// İsimlerin yanında: yalnızca açık sezonun seviye rozeti
export function nameBadges(board, uid) {
  const list = board ? tierBadge(board.current?.byId.get(uid)) : [];
  return list.length ? h('span', { class: 'bdgs' }, list.map((b) => chip(b, true))) : null;
}

const streakText = (m) => [
  m.streak >= STREAK_MIN ? `${m.streak} etkinlik art arda` : null,
  m.wed_streak >= STREAK_MIN ? `${m.wed_streak} Çarşamba art arda` : null,
].filter(Boolean).join(' · ');

// Sezon özeti kartı için veriler
export function seasonSummary(board, season, uid) {
  const r = season?.byId.get(uid);
  const m = board.members.get(uid);
  return {
    season: season?.name ?? '', name: m?.full_name ?? '',
    events: r?.attended ?? 0, wed: r?.wed ?? 0, points: r?.points ?? 0, rank: r?.rank ?? null, tier: r?.tier?.name ?? null,
    streak: m?.streak ?? 0, wedStreak: m?.wed_streak ?? 0,
    idea: r?.idea?.title ?? null, awards: (m?.awards ?? []).map((a) => a.title),
  };
}

// Yeni kazanılan rozeti bir kez duyur (bu telefonda)
export function announceNew(board) {
  const uid = me();
  if (!board?.current || !uid) return;
  const row = board.current.byId.get(uid);
  const now = [...tierBadge(row), ...ideaBadge(row)].map((b) => ({ id: `${board.current.id}:p:${b.key}`, b }));
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

// ---------- Rozet puanları (yönetici ayarı) ----------
function tierSheet() {
  const num = (t) => input({ type: 'number', inputmode: 'numeric', min: 1, max: 1000, value: t.min, 'aria-label': `${t.name} puanı` });
  const [gold, silver, bronze] = TIERS.map(num);
  sheet((close) => [
    h('h2', null, 'Rozet puanları'),
    h('div', { class: 'muted' }, `Bir sezonda kaç puanda hangi rozetin kazanılacağını belirler. Etkinlik ${POINTS.normal} puan, Çarşamba Buluşması ${POINTS.wednesday} puan sayılır.`),
    field('Bronz', bronze), field('Gümüş', silver), field('Altın', gold),
    h('div', { class: 'muted small' }, 'Değişiklik hemen geçerli olur ve açık sezondaki rozetler yeni puanlara göre yeniden hesaplanır. Geçmiş sezonlar da yeni puanlarla gösterilir.'),
    btn('Kaydet', busy(async () => {
      const b = Number(bronze.value), s = Number(silver.value), g = Number(gold.value);
      if (![b, s, g].every((n) => Number.isInteger(n) && n >= 1 && n <= 1000)) return toast('Puanlar 1 ile 1000 arasında tam sayı olmalı.', true);
      if (!(b < s && s < g)) return toast('Puanlar sırayla artmalı: Bronz < Gümüş < Altın.', true);
      const { error } = await sb.from('app_settings').upsert({ key: 'badge_tiers', value: { bronze: b, silver: s, gold: g } });
      if (error) return toast(error.message, true);
      close();
      toast('Rozet puanları güncellendi.');
      router.refresh();
    }), 'block'),
    btn('Vazgeç', close, 'ghost block'),
  ]);
}

// ---------- Sıralama ----------
let selected = null; // seçili sezonun kimliği
const rules = () => `Etkinlik ${POINTS.normal} puan, Çarşamba Buluşması ${POINTS.wednesday} puan. Rozetler: Bronz ${TIERS[2].min}, Gümüş ${TIERS[1].min}, Altın ${TIERS[0].min} puan.`;
export function ranking(board) {
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  let query = '';
  function draw() {
    const season = board.seasons.find((s) => s.id === selected) ?? board.current ?? board.seasons[0] ?? null;
    const q = query.trim().toLocaleLowerCase('tr');
    const rows = season ? season.rows.filter((r) => !q || r.full_name.toLocaleLowerCase('tr').includes(q)) : [];
    const max = Math.max(TIERS[0].min, ...(season ? season.rows.map((r) => r.points) : [0]));
    const kids = [
      isAdmin() ? seasonAdmin(board) : null,
      isAdmin() ? btn(`Rozet puanları: ${TIERS[2].min} / ${TIERS[1].min} / ${TIERS[0].min}`, tierSheet, 'ghost block') : null,
      !season ? h('div', { class: 'empty' }, 'Henüz sezon başlatılmadı. Sezon başlayınca sıralama burada görünecek.') : null,
      season && board.seasons.length > 1
        ? h('select', { class: 'in', 'aria-label': 'Sezon', onchange: (e) => { selected = e.target.value; draw(); } },
            board.seasons.map((s) => h('option', { value: s.id, selected: s.id === season.id }, s.name + (s.open ? ' (açık)' : ''))))
        : null,
      season ? h('div', { class: 'muted' },
        `${season.name}: ${day(season.starts_at)} – ${season.open ? 'devam ediyor' : day(season.ends_at)} · ${season.events} etkinlik, ${season.wed_events ?? 0} Çarşamba Buluşması. `, rules()) : null,
      season ? h('div', { class: 'card' },
        rows.length ? null : h('div', { class: 'muted' }, q ? 'Aramayla eşleşen üye yok.' : 'Henüz üye yok.'),
        rows.map((r) => h('div', { class: 'rank' + (r.id === me() ? ' me' : '') },
          h('span', { class: 'n' + (r.rank && r.rank <= 3 ? ` top p${r.rank}` : '') }, r.rank ?? '–'),
          h('span', { class: 'who2' }, h('span', { style: { fontWeight: '600' } }, r.full_name),
            h('span', { class: 'bdgs' }, tierBadge(r).map((b) => chip(b)))),
          h('span', { class: 'v' }, r.points, h('small', null, ' puan')),
          h('div', { class: 'track' }, h('i', { style: { width: `${(r.points / max) * 100}%` } })),
          h('div', { class: 'sub' }, `${r.attended} etkinlik · ${r.wed} Çarşamba`, season.open && streakText(r) ? ` · ${streakText(r)}` : '')))) : null,
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
    const next = [...TIERS].reverse().find((t) => row.points < t.min) ?? null;
    const goal = next?.min ?? TIERS[0].min;
    out.push(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', { class: 'grow' }, cur.name), h('span', { class: 'muted small' }, row.rank ? `${row.rank}. sıra` : 'Sırada değil')),
      h('div', { class: 'row' }, h('span', { class: 'pts' }, row.points, h('small', null, ' puan')), h('span', { class: 'bdgs' }, tierBadge(row).map((b) => chip(b)))),
      h('div', { class: 'track', style: { height: '8px' } }, h('i', { style: { width: `${Math.min(100, (row.points / goal) * 100)}%` } })),
      h('div', { class: 'muted small' }, `${row.attended} etkinlik × ${POINTS.normal} + ${row.wed} Çarşamba × ${POINTS.wednesday} = ${row.points} puan. `,
        next ? `${next.name} rozete ${next.min - row.points} puan kaldı.` : 'En üst rozete ulaştın.'),
      h('div', { class: 'muted small' }, rules())));
  } else {
    out.push(h('div', { class: 'card muted' }, 'Şu an açık bir sezon yok. Sezon başlayınca rozetin burada görünecek.'));
  }
  const extra = [...ideaBadge(row).map((b) => chip(b)), ...(m?.awards ?? []).map((a) => awardChip(a))];
  if (extra.length) {
    out.push(h('div', { class: 'card' },
      h('b', null, 'Diğer rozetler'),
      h('div', { class: 'bdgs' }, extra),
      h('div', { class: 'muted small' }, 'Fikir: sezonun en beğenilen önerisi. Özel rozetleri yöneticiler verir ve kalıcıdır.')));
  }
  if (m) {
    out.push(h('div', { class: 'card' },
      h('b', null, 'Katılım serisi'),
      h('div', { class: 'muted' }, `Etkinlik: art arda ${m.streak} · En uzun: ${m.best_streak} · Toplam ${m.total}`),
      h('div', { class: 'muted' }, `Çarşamba: art arda ${m.wed_streak ?? 0} · En uzun: ${m.wed_best_streak ?? 0} · Toplam ${m.wed_total ?? 0}`),
      h('div', { class: 'muted small' }, 'Kaçırılan her etkinlik kendi serisini sıfırlar. Seri sezonla sıfırlanmaz.')));
  }
  const past = board.seasons.filter((s) => !s.open).map((s) => ({ s, r: s.byId.get(uid) })).filter(({ r }) => r && (r.points > 0 || r.idea));
  if (past.length) {
    out.push(h('div', { class: 'card' },
      h('b', null, 'Geçmiş sezonlar'),
      past.map(({ s, r }) => h('div', { class: 'prow' },
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: '600' } }, s.name),
          h('div', { class: 'muted small' }, `${r.points} puan${r.rank ? ` · ${r.rank}. sıra` : ''} · ${r.attended} etkinlik, ${r.wed} Çarşamba`)),
        h('span', { class: 'bdgs' }, [...tierBadge(r), ...ideaBadge(r)].map((b) => chip(b)))))));
  }
  return out;
}
