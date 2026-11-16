// Ek özellikler: listeye kişi ekleme, takvim, duyurular, özel rozetler, sezon özeti kartı, işlem kaydı.
import { sb, me, isAdmin, h, fmtDate, toast, confirmBox, sheet, busy, btn, field, input, textarea, section, router } from './core.js';
import { AWARD_ICONS, awardChip, seasonSummary } from './badges.js';

const check = ({ data, error }) => {
  if (error) throw error;
  return data;
};
const norm = (t) => String(t ?? '').toLocaleLowerCase('tr');

// ---------- Yönetici: katılım listesine kişi ekle ----------
export async function addAttendeeSheet(ev, atts) {
  const people = check(await sb.from('profiles').select('id, full_name').eq('status', 'approved').order('full_name'));
  const going = new Set(atts.filter((a) => a.going).map((a) => a.user_id));
  const free = people.filter((p) => !going.has(p.id));
  const rollcall = ev.has_rollcall !== false;
  sheet((close) => {
    const list = h('div', { class: 'results' });
    const draw = (q) => {
      const shown = free.filter((p) => !q.trim() || norm(p.full_name).includes(norm(q.trim())));
      list.replaceChildren(...(shown.length ? shown.map((p) => h('button', { type: 'button', class: 'pick', onclick: busy(async () => {
        check(await sb.from('attendances').upsert({ event_id: ev.id, user_id: p.id, going: true, reason: null, present: rollcall ? true : null }));
        close();
        toast(`${p.full_name} listeye eklendi.`);
        router.refresh();
      }) }, h('b', null, p.full_name || '(isimsiz)'))) : [h('div', { class: 'muted' }, free.length ? 'Eşleşen üye yok.' : 'Tüm üyeler zaten listede.')]));
    };
    draw('');
    return [
      h('h2', null, 'Listeye kişi ekle'),
      h('div', { class: 'muted' }, rollcall
        ? 'Yanıt vermeden gelen üyeyi seç. “Katılıyorum” olarak eklenir ve yoklamada “geldi” işaretlenir.'
        : 'Yanıt vermeyen üyeyi seç. “Katılıyorum” olarak eklenir.'),
      input({ type: 'search', placeholder: 'Üye ara', 'aria-label': 'Üye ara', oninput: (e) => draw(e.target.value) }),
      list,
      btn('Kapat', close, 'ghost block'),
    ];
  });
}

// ---------- Takvime ekle (.ics) ----------
const icsEsc = (t) => String(t ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
const icsDate = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function calendarLink(ev, stops) {
  const start = new Date(ev.starts_at);
  const end = new Date(start.getTime() + 3 * 3600 * 1000); // bitiş saati tutulmuyor: 3 saat varsayılır
  const desc = [ev.meeting_note, ev.description, `${location.origin}${location.pathname}#/event/${ev.id}`].filter(Boolean).join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WOB//Warders of Bilgi//TR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${ev.id}@wardersofbilgi`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEsc(ev.title)}`, `DESCRIPTION:${icsEsc(desc)}`,
    stops?.[0]?.name ? `LOCATION:${icsEsc(stops[0].name)}` : null,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  return h('a', { class: 'btn sec block', href: `data:text/calendar;charset=utf-8,${encodeURIComponent(lines)}`, download: 'wob-etkinlik.ics' }, 'Takvime ekle');
}

// ---------- Duyurular ----------
const loadAnnouncements = (limit) =>
  sb.from('announcements').select('id, title, body, created_at, profiles(full_name)').order('created_at', { ascending: false }).limit(limit).then(check);

// Etkinlikler ekranının üstündeki kutu (sayfayı bekletmeden dolar)
export function announcementsBlock() {
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' }, hidden: true });
  loadAnnouncements(2).then((items) => {
    if (!items.length && !isAdmin()) return;
    box.hidden = false;
    box.replaceChildren(
      ...items.map((a) => h('a', { class: 'hint', href: '#/announcements', style: { textDecoration: 'none' } },
        h('div', { class: 'row' }, h('b', { class: 'grow' }, a.title), h('span', { class: 'muted small' }, fmtDate(a.created_at))),
        a.body ? h('div', { class: 'muted clamp2' }, a.body) : null)),
      h('a', { href: '#/announcements', class: 'muted small', style: { textAlign: 'right' } }, items.length ? 'Tüm duyurular ›' : 'Duyuru yayınla ›'));
  }).catch(() => {});
  return box;
}

export async function announcements() {
  const items = await loadAnnouncements(100);
  const title = input({ placeholder: 'Örn: Aidat hatırlatması', 'aria-label': 'Duyuru başlığı' });
  const body = textarea({ placeholder: 'Duyurunun detayı...', 'aria-label': 'Duyuru metni' });
  return {
    title: 'Duyurular',
    back: '#/',
    tab: 'events',
    node: [
      isAdmin() && [
        section('Duyuru yayınla'),
        h('div', { class: 'muted' }, 'Tüm onaylı üyeler görür; bildirimi açık olanlara bildirim gider.'),
        title, body,
        btn('Yayınla', busy(async () => {
          if (title.value.trim().length < 3) return toast('Duyuruya bir başlık yaz.', true);
          check(await sb.from('announcements').insert({ title: title.value.trim(), body: body.value.trim() || null }));
          toast('Duyuru yayınlandı.');
          router.refresh();
        }), 'block'),
      ],
      section(`Duyurular (${items.length})`),
      items.length ? null : h('div', { class: 'empty' }, 'Henüz duyuru yok.'),
      items.map((a) => h('div', { class: 'card' },
        h('b', null, a.title),
        a.body ? h('div', { class: 'pre' }, a.body) : null,
        h('div', { class: 'row' },
          h('div', { class: 'muted small grow' }, (a.profiles?.full_name ? `${a.profiles.full_name} · ` : '') + fmtDate(a.created_at)),
          isAdmin() ? btn('Sil', busy(async () => {
            if (!(await confirmBox('Duyuruyu sil', `“${a.title}” silinsin mi?`, { yes: 'Sil', danger: true }))) return;
            check(await sb.from('announcements').delete().eq('id', a.id));
            router.refresh();
          }), 'ghost sm') : null))),
    ],
  };
}

// ---------- Yönetici işlem kaydı ----------
export async function adminLog() {
  if (!isAdmin()) return { title: 'İşlem kaydı', back: '#/', node: h('div', { class: 'empty' }, 'Bu ekran sadece yöneticiler içindir.') };
  const rows = check(await sb.from('admin_log').select('id, actor_name, message, created_at').order('id', { ascending: false }).limit(300));
  let query = '';
  const list = h('div', { class: 'card' });
  const draw = () => {
    const shown = rows.filter((r) => !query.trim() || norm(`${r.actor_name} ${r.message}`).includes(norm(query.trim())));
    list.replaceChildren(...(shown.length ? shown.map((r) => h('div', { class: 'prow' },
      h('div', { class: 'grow' },
        h('div', null, r.message),
        h('div', { class: 'muted small' }, `${r.actor_name || 'Yönetici'} · ${fmtDate(r.created_at)}`))))
      : [h('div', { class: 'muted' }, rows.length ? 'Aramayla eşleşen kayıt yok.' : 'Henüz kayıt yok. Yöneticilerin yaptığı işlemler burada listelenir.')]));
  };
  draw();
  return {
    title: 'İşlem kaydı',
    back: '#/dashboard',
    tab: 'dashboard',
    node: [
      h('div', { class: 'muted' }, 'Yöneticilerin yaptığı işlemler: onaylar, yetkiler, etkinlikler, yoklama, sezon, rozet ve duyurular. Son 300 kayıt gösterilir.'),
      input({ type: 'search', placeholder: 'Kayıtlarda ara', 'aria-label': 'Kayıtlarda ara', oninput: (e) => { query = e.target.value; draw(); } }),
      list,
    ],
  };
}

// ---------- Yönetici: üyeye özel rozet ver ----------
const ICON_NAMES = { star: 'Yıldız', crown: 'Taç', road: 'Yol', helmet: 'Kask', heart: 'Kalp', wrench: 'Anahtar' };
export function awardSheet(member, board) {
  const mine = (board?.awards ?? []).filter((a) => a.user_id === member.id);
  let icon = 'star';
  sheet((close) => {
    const title = input({ placeholder: 'Örn: Yılın Head’i', maxlength: 40, 'aria-label': 'Rozet adı' });
    const picker = h('div', { class: 'seg', role: 'group', 'aria-label': 'Simge' });
    const drawPicker = () => picker.replaceChildren(...AWARD_ICONS.map((k) =>
      h('button', { type: 'button', class: icon === k ? 'on' : '', 'aria-label': ICON_NAMES[k], 'aria-pressed': String(icon === k), onclick: () => { icon = k; drawPicker(); } },
        awardChip({ title: '', icon: k }, true))));
    drawPicker();
    return [
      h('h2', null, `${member.full_name}: özel rozet`),
      mine.length ? h('div', { class: 'card', style: { background: 'transparent' } }, mine.map((a) => h('div', { class: 'prow' },
        h('div', { class: 'grow' }, awardChip(a)),
        btn('Geri al', busy(async () => {
          check(await sb.from('awards').delete().eq('id', a.id));
          close();
          toast('Rozet geri alındı.');
          router.refresh();
        }), 'ghost sm')))) : h('div', { class: 'muted' }, 'Bu üyenin henüz özel rozeti yok.'),
      field('Rozet adı', title),
      picker,
      h('div', { class: 'muted small' }, 'Özel rozet kalıcıdır; sezonla sıfırlanmaz. Üyenin profilinde ve adının yanında görünür.'),
      btn('Rozeti ver', busy(async () => {
        if (title.value.trim().length < 2) return toast('Rozete bir ad yaz.', true);
        check(await sb.from('awards').insert({ user_id: member.id, title: title.value.trim(), icon }));
        close();
        toast('Rozet verildi.');
        router.refresh();
      }), 'block'),
      btn('Kapat', close, 'ghost block'),
    ];
  });
}

// ---------- Sezon özeti kartı (paylaşılabilir görsel) ----------
const loadImg = (src) => new Promise((res) => {
  const im = new Image();
  im.onload = () => res(im);
  im.onerror = () => res(null);
  im.src = src;
});
async function drawSummary(d) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const font = (w, s) => `${w} ${s}px Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  x.fillStyle = '#0B0A08'; x.fillRect(0, 0, W, H);
  const g = x.createRadialGradient(W / 2, 330, 40, W / 2, 330, 760);
  g.addColorStop(0, 'rgba(201,161,90,.24)'); g.addColorStop(1, 'rgba(201,161,90,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#C9A15A'; x.lineWidth = 6; x.strokeRect(36, 36, W - 72, H - 72);
  const logo = await loadImg('icons/logo.png');
  if (logo) x.drawImage(logo, W / 2 - 130, 80, 260, 260);
  x.textAlign = 'center';
  x.fillStyle = '#C9A15A'; x.font = font(800, 52); x.fillText('WARDERS OF BİLGİ', W / 2, 410);
  x.fillStyle = '#B9AE9A'; x.font = font(600, 38); x.fillText(d.season, W / 2, 468);
  x.fillStyle = '#F2EBDD'; x.font = font(800, 84);
  let name = d.name;
  while (x.measureText(name).width > W - 160 && name.length > 4) name = `${name.slice(0, -2).trimEnd()}…`;
  x.fillText(name, W / 2, 590);
  // İki kutu: etkinlik ve Çarşamba
  const box = (bx, label, count, rank, tier) => {
    x.fillStyle = '#17140F'; x.strokeStyle = '#3A3226'; x.lineWidth = 3;
    x.beginPath(); x.roundRect(bx, 660, 460, 330, 32); x.fill(); x.stroke();
    x.fillStyle = '#C9A15A'; x.font = font(800, 150); x.fillText(String(count), bx + 230, 815);
    x.fillStyle = '#F2EBDD'; x.font = font(700, 40); x.fillText(label, bx + 230, 880);
    x.fillStyle = '#B9AE9A'; x.font = font(600, 34);
    x.fillText([rank ? `${rank}. sıra` : null, tier ? `${tier} rozet` : null].filter(Boolean).join(' · ') || 'Sırada değil', bx + 230, 940);
  };
  box(70, 'Etkinlik', d.events, d.rank, d.tier);
  box(550, 'Çarşamba Buluşması', d.wed, d.wedRank, d.wedTier);
  x.fillStyle = '#F2EBDD'; x.font = font(600, 40);
  const lines = [
    d.streak >= 3 || d.wedStreak >= 3 ? [d.streak >= 3 ? `${d.streak} etkinlik art arda` : null, d.wedStreak >= 3 ? `${d.wedStreak} Çarşamba art arda` : null].filter(Boolean).join(' · ') : null,
    d.idea ? `Sezonun fikri: ${d.idea}` : null,
    d.awards.length ? `Özel rozet: ${d.awards.join(', ')}` : null,
  ].filter(Boolean);
  lines.slice(0, 3).forEach((t, i) => {
    let s = t;
    while (x.measureText(s).width > W - 160 && s.length > 8) s = `${s.slice(0, -2).trimEnd()}…`;
    x.fillText(s, W / 2, 1075 + i * 62);
  });
  x.fillStyle = '#8C8272'; x.font = font(600, 30); x.fillText('wardersofbilgi.github.io', W / 2, H - 70);
  return c;
}

export function summarySheet(board) {
  const seasons = board.seasons;
  if (!seasons.length) return toast('Henüz sezon yok.', true);
  let sel = (board.current ?? seasons[0]).id;
  sheet((close) => {
    const holder = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
    const draw = async () => {
      const d = seasonSummary(board, seasons.find((s) => s.id === sel), me());
      holder.replaceChildren(h('div', { class: 'muted' }, 'Hazırlanıyor…'));
      const canvas = await drawSummary(d);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      const url = URL.createObjectURL(blob);
      const file = new File([blob], 'wob-sezon-ozeti.png', { type: 'image/png' });
      const canShare = !!navigator.canShare?.({ files: [file] });
      holder.replaceChildren(
        h('img', { src: url, alt: `${d.season} özet kartı: ${d.events} etkinlik, ${d.wed} Çarşamba Buluşması`, style: { width: '100%', borderRadius: '12px', border: '1px solid var(--border)' } }),
        canShare ? btn('Paylaş', busy(async () => {
          try { await navigator.share({ files: [file], title: 'WOB sezon özeti' }); } catch (e) { if (e?.name !== 'AbortError') throw e; }
        }), 'block') : null,
        h('a', { class: 'btn sec block', href: url, download: 'wob-sezon-ozeti.png' }, 'Görseli indir'));
    };
    draw();
    return [
      h('h2', null, 'Sezon özeti kartı'),
      seasons.length > 1 ? h('select', { class: 'in', 'aria-label': 'Sezon', onchange: (e) => { sel = e.target.value; draw(); } },
        seasons.map((s) => h('option', { value: s.id, selected: s.id === sel }, s.name + (s.open ? ' (açık)' : '')))) : null,
      holder,
      btn('Kapat', close, 'ghost block'),
    ];
  });
}
