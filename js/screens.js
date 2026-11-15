// WOB ekranları. Her ekran { title, tab, back, bar, node } döndürür.
import {
  sb, state, me, isAdmin, loadProfile, h, icon, fmtDate, fmtMonth, pad, toast, fail, confirmBox, sheet, busy,
  btn, field, input, textarea, badge, section, logo, isStandalone, router,
} from './core.js';
import { routeMap, mapsUrl } from './map.js';

const APP_NAME = 'WARDERS OF BİLGİ';
const check = ({ data, error }) => {
  if (error) throw error;
  return data;
};

// Arama: Türkçe harflere duyarlı, büyük/küçük harf ayırmaz
const norm = (t) => String(t ?? '').toLocaleLowerCase('tr');
const matches = (q, ...fields) => !q.trim() || fields.some((x) => norm(x).includes(norm(q.trim())));
const searchBox = (value, placeholder, oninput) =>
  input({ type: 'search', value, placeholder, 'aria-label': placeholder, enterkeyhint: 'search', oninput: (e) => oninput(e.target.value) });

const EDU = { student: 'Okuyor', graduate: 'Mezun' };
function eduPicker(initial) {
  let val = initial || null;
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': 'Öğrencilik durumu' });
  const draw = () => el.replaceChildren(...[['student', 'Okuyorum'], ['graduate', 'Mezunum']].map(([k, label]) =>
    h('button', { type: 'button', class: val === k ? 'on' : '', 'aria-pressed': String(val === k), onclick: () => { val = k; draw(); } }, label)));
  draw();
  return { el, get value() { return val; } };
}

// =====================================================================
// Giriş, kayıt, onay bekleme
// =====================================================================
export function login() {
  const email = input({ type: 'email', autocomplete: 'email', inputmode: 'email', placeholder: 'ornek@mail.com', autocapitalize: 'none' });
  const pass = input({ type: 'password', autocomplete: 'current-password', placeholder: '••••••' });
  const submit = busy(async () => {
    if (!email.value.trim() || !pass.value) return toast('E-posta ve şifreyi gir.', true);
    const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
    if (error) {
      toast(/confirm/i.test(error.message) ? 'Önce e-postandaki doğrulama bağlantısına tıkla.' : 'E-posta veya şifre hatalı.', true);
    }
  });
  const go = btn('Giriş yap', submit, 'block');
  const form = h('form', { class: 'page', style: { padding: '0', gap: '12px' }, onsubmit: (e) => { e.preventDefault(); go.click(); } },
    field('E-posta', email), field('Şifre', pass), go, h('button', { type: 'submit', hidden: true }));
  return {
    bar: false,
    node: [
      h('div', { class: 'brand', style: { margin: '24px 0' } },
        logo(210), h('div', { class: 'short' }, 'WOB'),
        h('div', { style: { fontWeight: '700', letterSpacing: '3px' } }, APP_NAME),
        h('div', { class: 'muted' }, 'Etkinlikler, rotalar ve sürüş düzeni')),
      form,
      h('a', { href: '#/reset', class: 'center', style: { marginTop: '8px' } }, 'Şifremi unuttum'),
      h('a', { href: '#/register', class: 'center' }, 'Hesabın yok mu? Kayıt ol'),
      isStandalone() ? null : h('div', { class: 'hint', style: { marginTop: '16px' } },
        h('b', null, 'Uygulama gibi kullan'),
        h('div', { class: 'muted' }, 'iPhone: Safari’de Paylaş simgesine dokun, “Ana Ekrana Ekle”yi seç.'),
        h('div', { class: 'muted' }, 'Android: Chrome menüsünden “Uygulamayı yükle” ya da “Ana ekrana ekle”yi seç.')),
    ],
  };
}

export function register() {
  const name = input({ autocomplete: 'name', placeholder: 'Adın Soyadın' });
  const phone = input({ type: 'tel', autocomplete: 'tel', placeholder: '05xx...' });
  const bike = input({ placeholder: 'Marka / model' });
  const email = input({ type: 'email', autocomplete: 'email', autocapitalize: 'none' });
  const pass = input({ type: 'password', autocomplete: 'new-password', placeholder: 'En az 6 karakter' });
  const edu = eduPicker();
  const submit = busy(async () => {
    if (name.value.trim().length < 3) return toast('Ad soyad gir.', true);
    if (!edu.value) return toast('Okuyorum ya da mezunum seç.', true);
    if (!email.value.includes('@')) return toast('Geçerli bir e-posta gir.', true);
    if (pass.value.length < 6) return toast('Şifre en az 6 karakter olmalı.', true);
    const { data, error } = await sb.auth.signUp({
      email: email.value.trim(),
      password: pass.value,
      options: { data: { full_name: name.value.trim(), phone: phone.value.trim(), bike: bike.value.trim(), edu_status: edu.value } },
    });
    if (error) return fail(error);
    if (!data.session) {
      toast('Kaydın alındı. E-postandaki doğrulama bağlantısına tıkla, sonra giriş yap.');
      router.go('#/login');
    }
  });
  return {
    title: 'Kayıt ol',
    back: '#/login',
    node: [
      h('div', { class: 'muted' }, 'Kaydın, kulüp yöneticisi onayladıktan sonra aktif olur.'),
      field('Ad soyad', name),
      h('div', { class: 'field', style: { display: 'flex', flexDirection: 'column', gap: '6px', color: 'var(--muted)', fontSize: '13px', fontWeight: '600' } }, 'Bilgi Üniversitesi', edu.el),
      field('Telefon', phone), field('Motosiklet', bike), field('E-posta', email), field('Şifre', pass),
      btn('Kayıt ol', submit, 'block'),
    ],
  };
}

// Şifre sıfırlama: e-postaya bağlantı gönder
export function reset() {
  const email = input({ type: 'email', autocomplete: 'email', inputmode: 'email', placeholder: 'ornek@mail.com', autocapitalize: 'none' });
  return {
    title: 'Şifremi unuttum',
    back: '#/login',
    node: [
      h('div', { class: 'muted' }, 'Kayıtlı e-posta adresini yaz. Sana yeni şifre belirleyebileceğin bir bağlantı göndereceğiz.'),
      field('E-posta', email),
      btn('Bağlantı gönder', busy(async () => {
        if (!email.value.includes('@')) return toast('Geçerli bir e-posta gir.', true);
        const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname });
        if (error) return fail(/rate|limit|seconds/i.test(error.message) ? 'Çok sık denendi. Birkaç dakika sonra tekrar dene.' : error);
        toast('Bağlantı gönderildi. E-postanı (gereksiz klasörü dahil) kontrol et.');
      }), 'block'),
    ],
  };
}

// E-postadaki bağlantıyla gelindi: yeni şifre belirle
export function newPassword() {
  const p1 = input({ type: 'password', autocomplete: 'new-password', placeholder: 'En az 6 karakter' });
  const p2 = input({ type: 'password', autocomplete: 'new-password' });
  return {
    title: 'Yeni şifre',
    node: [
      h('div', { class: 'muted' }, 'Hesabın için yeni bir şifre belirle.'),
      field('Yeni şifre', p1), field('Yeni şifre (tekrar)', p2),
      btn('Şifreyi kaydet', busy(async () => {
        if (p1.value.length < 6) return toast('Şifre en az 6 karakter olmalı.', true);
        if (p1.value !== p2.value) return toast('Şifreler aynı değil.', true);
        const { error } = await sb.auth.updateUser({ password: p1.value });
        if (error) return fail(error);
        state.recovery = false;
        toast('Şifren değişti.');
        history.replaceState(null, '', '#/');
        router.refresh();
      }), 'block'),
    ],
  };
}

export function pending() {
  const rejected = state.profile?.status === 'rejected';
  return {
    bar: false,
    node: [
      h('div', { class: 'brand', style: { margin: '24px 0' } }, logo(160), h('div', { class: 'short', style: { fontSize: '28px' } }, 'WOB')),
      h('div', { class: 'card' },
        h('h1', { class: 'title' }, rejected ? 'Başvurun onaylanmadı' : 'Onay bekleniyor'),
        h('div', { class: 'muted' }, rejected
          ? 'Kulüp yöneticisi kaydını onaylamadı. Bir hata olduğunu düşünüyorsan yöneticiyle iletişime geç.'
          : `Merhaba ${state.profile?.full_name ?? ''}! Warders of Bilgi’ye kaydın alındı. Kulüp yöneticisi onayladıktan sonra uygulamayı kullanabilirsin.`)),
      rejected ? null : btn('Durumu kontrol et', busy(async () => {
        await loadProfile();
        if (state.profile?.status === 'approved') router.go('#/');
        else toast('Henüz onaylanmadı.');
        router.refresh();
      }), 'block'),
      btn('Çıkış yap', () => sb.auth.signOut(), 'ghost block'),
    ],
  };
}

// =====================================================================
// Etkinlikler
// =====================================================================
let evTab = 'active';
let evQuery = '';
const endOfDay = (iso) => {
  const d = new Date(iso);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
};

export async function events() {
  const [evs, att] = await Promise.all([
    sb.from('events').select('*').order('starts_at', { ascending: true }).then(check),
    sb.from('attendances').select('event_id, user_id, going').then(check),
  ]);
  const mine = {};
  const counts = {};
  for (const a of att) {
    if (a.user_id === me()) mine[a.event_id] = a.going;
    if (a.going) counts[a.event_id] = (counts[a.event_id] ?? 0) + 1;
  }
  // Etkinlik, yönetici "Tamamlandı" diyene kadar aktif kalır
  const now = Date.now();
  const active = evs.filter((e) => !e.completed_at);
  const past = evs.filter((e) => e.completed_at).reverse();

  const card = (e, tab) => {
    const d = new Date(e.starts_at);
    const a = mine[e.id];
    const due = tab === 'active' && new Date(e.starts_at).getTime() < now;
    return h('button', { class: 'card ev' + (tab === 'past' ? ' past' : ''), onclick: () => router.go(`#/event/${e.id}`) },
      h('div', { class: 'day' }, h('b', null, d.getDate()), h('span', null, fmtMonth(d))),
      h('div', { class: 'grow', style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('div', { class: 'name' }, e.title),
        h('div', { class: 'muted' }, fmtDate(e.starts_at)),
        h('div', { class: 'row wrap' },
          !e.published && badge('Taslak', 'warn'),
          tab === 'past' && badge('Tamamlandı'),
          due && isAdmin() && badge('Tamamlanmayı bekliyor', 'warn'),
          tab === 'active' && e.registration_closed && badge('Liste kapalı'),
          a === true && badge('Katılıyorum', 'ok'),
          a === false && badge('Katılamıyorum', 'bad'),
          a === undefined && tab === 'active' && e.published && !e.registration_closed && badge('Yanıt bekleniyor', 'gold'))),
      h('div', { class: 'count' }, icon('people'), h('b', null, counts[e.id] ?? 0)));
  };

  // Sekme değişince yalnızca bu bölüm yeniden çizilir (sayfa titremesin)
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  const search = searchBox(evQuery, 'Etkinlik ara', (v) => { evQuery = v; draw(); });
  function draw() {
    const list = (evTab === 'active' ? active : past).filter((e) => matches(evQuery, e.title, e.description, e.meeting_note));
    const seg = (key, label) => h('button', { class: evTab === key ? 'on' : '', onclick: () => { if (evTab !== key) { evTab = key; draw(); } } }, label);
    body.replaceChildren(...[
      h('div', { class: 'seg' }, seg('active', `Aktif (${active.length})`), seg('past', `Geçmiş (${past.length})`)),
      isAdmin() && evTab === 'active' ? btn('+ Yeni etkinlik', () => router.go('#/edit'), 'block') : null,
      ...(list.length ? list.map((e) => card(e, evTab)) : [h('div', { class: 'empty' }, evQuery.trim() ? 'Aramayla eşleşen etkinlik yok.' : evTab === 'active' ? 'Aktif etkinlik yok.' : 'Henüz tamamlanan etkinlik yok.')]),
    ].filter(Boolean));
  }
  draw();

  return {
    title: 'WOB',
    tab: 'events',
    node: [
      h('div', { class: 'brand' }, logo(110), h('div', { class: 'name' }, APP_NAME),
        state.profile?.full_name ? h('div', { class: 'muted' }, `Hoş geldin, ${state.profile.full_name.split(' ')[0]}`) : null),
      evs.length > 1 || evQuery ? search : null,
      body,
    ],
  };
}

// ---------- Etkinlik detayı ----------
export async function eventDetail(id) {
  const [ev, stops, atts, reacts] = await Promise.all([
    sb.from('events').select('*').eq('id', id).maybeSingle().then(check),
    sb.from('event_stops').select('*').eq('event_id', id).order('position').then(check),
    sb.from('attendances').select('event_id, user_id, going, reason, present, updated_at, profiles!attendances_user_id_fkey(full_name, bike)').eq('event_id', id).then(check),
    sb.from('reactions').select('*').eq('event_id', id).then(check),
  ]);
  if (!ev) return { title: 'Etkinlik', back: '#/', node: h('div', { class: 'empty' }, 'Etkinlik bulunamadı.') };

  const uid = me();
  const mine = atts.find((a) => a.user_id === uid);
  const going = atts.filter((a) => a.going);
  const notGoing = atts.filter((a) => !a.going);
  const likes = reacts.filter((r) => r.value === 1).length;
  const dislikes = reacts.filter((r) => r.value === -1).length;
  const myReact = reacts.find((r) => r.user_id === uid)?.value;
  const done = !!ev.completed_at;
  const canRespond = ev.published && !ev.registration_closed && !done;
  const presentCount = going.filter((a) => a.present === true).length;
  const marked = going.filter((a) => a.present != null).length;
  // Yoklama: aynı düğmeye ikinci kez basmak işareti kaldırır
  const mark = (a, value) => busy(async () => {
    check(await sb.from('attendances').update({ present: a.present === value ? null : value }).eq('event_id', ev.id).eq('user_id', a.user_id));
    router.refresh();
  });

  // "reason" sütunu: katılanlar için isteğe bağlı not, katılamayanlar için zorunlu sebep
  async function respond(isGoing, text) {
    check(await sb.from('attendances').upsert({ event_id: ev.id, user_id: uid, going: isGoing, reason: text?.trim() || null }));
    router.refresh();
  }
  function ask(isGoing) {
    const same = mine && mine.going === isGoing;
    sheet((close) => {
      const ta = textarea({ value: same ? mine.reason ?? '' : '', placeholder: isGoing ? 'Örn: Yolcumla geliyorum, yolda katılacağım… (isteğe bağlı)' : 'Örn: İş seyahatindeyim' });
      const send = btn(isGoing ? 'Katılımı onayla' : 'Gönder', busy(async () => {
        if (!isGoing && ta.value.trim().length < 3) return toast('Katılamama sebebini yaz.', true);
        await respond(isGoing, ta.value);
        close();
      }), (isGoing ? 'ok' : 'bad') + ' block');
      return [
        h('h2', null, isGoing ? 'Katılıyorum 🏍️' : 'Neden katılamıyorsun?'),
        h('div', { class: 'muted' }, isGoing ? 'İstersen bir not ekle. Notun katılımcı listesinde herkese görünür.' : 'Sebep yazmak zorunlu. Sebebi yalnızca yöneticiler görür.'),
        ta, send, btn('Vazgeç', close, 'ghost block'),
      ];
    });
  }
  const react = (value) => busy(async () => {
    if (myReact === value) check(await sb.from('reactions').delete().eq('event_id', ev.id).eq('user_id', uid));
    else check(await sb.from('reactions').upsert({ event_id: ev.id, user_id: uid, value }));
    router.refresh();
  });
  const patch = (values) => busy(async () => {
    check(await sb.from('events').update(values).eq('id', ev.id));
    router.refresh();
  });

  const map = stops.length ? routeMap(stops) : null;
  const n = stops.length;

  return {
    title: 'Etkinlik',
    back: '#/',
    node: [
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('div', { class: 'row wrap' },
          !ev.published && badge('Taslak – üyeler göremez', 'warn'),
          done && badge('Tamamlandı', 'ok'),
          !done && ev.registration_closed && badge('Katılım listesi kapalı')),
        h('h1', { class: 'title' }, ev.title),
        h('div', { class: 'row muted' }, icon('clock'), fmtDate(ev.starts_at))),
      ev.description ? h('div', { class: 'pre' }, ev.description) : null,
      ev.meeting_note ? h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Buluşma notu'), h('div', { class: 'pre' }, ev.meeting_note)) : null,

      map && [
        section('Rota'),
        map.el,
        h('div', { class: 'card' }, stops.map((s, i) => h('div', { class: 'stopline' },
          h('b', { style: { color: `var(${i === 0 ? '--ok' : i === n - 1 ? '--bad' : '--gold'})` } }, i + 1), h('span', null, s.name)))),
        h('a', { class: 'btn sec block', href: mapsUrl(stops), target: '_blank', rel: 'noopener' }, 'Google Maps’te yol tarifi al'),
      ],

      h('div', { class: 'row' },
        h('button', { class: 'react up' + (myReact === 1 ? ' on' : ''), 'aria-label': 'Beğen', onclick: react(1) }, icon('like'), likes),
        h('button', { class: 'react down' + (myReact === -1 ? ' on' : ''), 'aria-label': 'Beğenme', onclick: react(-1) }, icon('dislike'), dislikes)),

      section('Katılım'),
      h('div', { class: 'card' },
        mine
          ? h('div', null, 'Yanıtın: ', h('b', { style: { color: `var(${mine.going ? '--ok' : '--bad'})` } }, mine.going ? 'Katılıyorum' : 'Katılamıyorum'),
              mine.reason ? h('div', { class: 'muted' }, `${mine.going ? 'Notun' : 'Sebebin'}: ${mine.reason}`) : null)
          : h('div', { class: 'muted' }, 'Henüz yanıt vermedin.'),
        canRespond
          ? h('div', { class: 'row' },
              btn('Katılıyorum', () => ask(true), (mine?.going ? 'ok' : 'sec') + ' grow'),
              btn('Katılamıyorum', () => ask(false), (mine && !mine.going ? 'bad' : 'sec') + ' grow'))
          : h('div', { class: 'muted' }, done ? 'Etkinlik tamamlandı.' : ev.published ? 'Katılım listesi yönetici tarafından kapatıldı.' : 'Etkinlik henüz yayınlanmadı.')),

      btn('🏍️  Sürüş düzeni', () => router.go(`#/formation/${ev.id}`), 'sec block'),

      h('div', { class: 'card' },
        h('div', { class: 'row' },
          h('b', { class: 'grow', style: { color: 'var(--ok)' } }, `Katılanlar (${going.length})`),
          marked ? badge(`Yoklama: ${presentCount}/${going.length} geldi`, 'gold') : null),
        isAdmin() && going.length ? h('div', { class: 'muted small' }, 'Yoklama: gelenleri ✓, gelmeyenleri ✕ ile işaretle. Etkinliği kapatmadan da alınabilir.') : null,
        going.length ? null : h('div', { class: 'muted' }, 'Henüz kimse yok.'),
        h('div', { class: 'plist' }, going.map((a, i) => h('div', { class: 'prow' },
          h('span', { class: 'pn' }, i + 1),
          h('div', { class: 'grow' },
            h('div', { style: { fontWeight: '600' } }, a.profiles?.full_name ?? '?'),
            a.profiles?.bike ? h('div', { class: 'muted small' }, a.profiles.bike) : null,
            a.reason ? h('div', { class: 'muted small', style: { fontStyle: 'italic' } }, `“${a.reason}”`) : null),
          isAdmin()
            ? h('div', { class: 'row', style: { gap: '6px' } },
                h('button', { class: 'chk ok' + (a.present === true ? ' on' : ''), 'aria-label': 'Geldi', 'aria-pressed': String(a.present === true), onclick: mark(a, true) }, '✓'),
                h('button', { class: 'chk bad' + (a.present === false ? ' on' : ''), 'aria-label': 'Gelmedi', 'aria-pressed': String(a.present === false), onclick: mark(a, false) }, '✕'))
            : a.present === true ? badge('Geldi', 'ok') : a.present === false ? badge('Gelmedi', 'bad') : null)))),

      h('div', { class: 'card' },
        h('b', { style: { color: 'var(--bad)' } }, `Katılamayanlar (${notGoing.length})`),
        notGoing.length ? null : h('div', { class: 'muted' }, 'Yok.'),
        notGoing.map((a) => h('div', null,
          h('div', null, '• ', a.profiles?.full_name ?? '?'),
          (isAdmin() || a.user_id === uid) && a.reason ? h('div', { class: 'muted', style: { marginLeft: '12px' } }, `Sebep: ${a.reason}`) : null))),

      isAdmin() && [
        section('Yönetici'),
        btn('Düzenle', () => router.go(`#/edit/${ev.id}`), 'sec block'),
        done
          ? btn('Tamamlandı işaretini kaldır', patch({ completed_at: null }), 'ghost block')
          : btn('Etkinliği tamamla', busy(async () => {
              if (!(await confirmBox('Etkinlik tamamlansın mı?', 'Etkinlik “Geçmiş” sekmesine taşınır ve üyeler artık yanıt veremez. Yoklamayı sonra da düzenleyebilirsin.', { yes: 'Tamamla' }))) return;
              check(await sb.from('events').update({ completed_at: new Date().toISOString() }).eq('id', ev.id));
              router.refresh();
            }), 'ok block'),
        btn(ev.published ? 'Yayından kaldır' : 'Yayınla', patch({ published: !ev.published }), (ev.published ? 'ghost' : '') + ' block'),
        done ? null : btn(ev.registration_closed ? 'Katılım listesini aç' : 'Katılım listesini kapat', patch({ registration_closed: !ev.registration_closed }), 'ghost block'),
        btn('Etkinliği sil', busy(async () => {
          if (!(await confirmBox('Etkinliği sil', 'Bu etkinlik ve tüm katılım bilgileri silinecek. Bu işlem geri alınamaz.', { yes: 'Sil', danger: true }))) return;
          check(await sb.from('events').delete().eq('id', ev.id));
          router.go('#/');
        }), 'bad block'),
      ],
    ],
  };
}

// ---------- Etkinlik oluştur / düzenle ----------
export async function eventEdit(id) {
  if (!isAdmin()) return { title: 'Etkinlik', back: '#/', node: h('div', { class: 'empty' }, 'Bu ekran sadece yöneticiler içindir.') };
  let ev = null;
  let stops = [];
  if (id) {
    [ev, stops] = await Promise.all([
      sb.from('events').select('*').eq('id', id).single().then(check),
      sb.from('event_stops').select('*').eq('event_id', id).order('position').then(check),
    ]);
    stops = stops.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng }));
  }
  const start = ev ? new Date(ev.starts_at) : (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
    return d;
  })();

  const title = input({ value: ev?.title ?? '', placeholder: 'Örn: Sapanca kahvaltı turu' });
  const desc = textarea({ value: ev?.description ?? '', placeholder: 'Program, tempo, yakıt molaları, ekipman...' });
  const note = input({ value: ev?.meeting_note ?? '', placeholder: 'Örn: 08:30’da benzinlikte, depolar dolu gelin' });
  const date = input({ type: 'date', 'aria-label': 'Tarih', value: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}` });
  const time = input({ type: 'time', 'aria-label': 'Saat', value: `${pad(start.getHours())}:${pad(start.getMinutes())}` });

  const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
  const map = routeMap(stops, {
    tall: true,
    onPick: (lat, lng) => {
      stops.push({ name: stops.length === 0 ? 'Buluşma noktası' : `Durak ${stops.length + 1}`, lat, lng });
      draw();
    },
  });
  // Yazarak yer arama (OpenStreetMap). Sonuca dokununca durak olarak eklenir.
  const results = h('div', { class: 'results' });
  const query = input({ type: 'search', enterkeyhint: 'search', placeholder: 'Yer ara: örn. Sapanca Gölü', 'aria-label': 'Yer ara' });
  const searchBtn = btn('Ara', busy(async () => {
    const text = query.value.trim();
    if (text.length < 3) return toast('Aramak için en az 3 harf yaz.', true);
    results.replaceChildren(h('div', { class: 'muted' }, 'Aranıyor…'));
    let found;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=tr&q=${encodeURIComponent(text)}`);
      if (!res.ok) throw new Error(String(res.status));
      found = await res.json();
    } catch {
      results.replaceChildren();
      return toast('Arama yapılamadı. Biraz sonra tekrar dene.', true);
    }
    results.replaceChildren(...(found.length ? found.map((r) => {
      const name = r.name || r.display_name.split(',')[0];
      return h('button', { type: 'button', class: 'pick', onclick: () => {
        stops.push({ name, lat: Number(r.lat), lng: Number(r.lon) });
        draw();
        map.focus(Number(r.lat), Number(r.lon));
        results.replaceChildren();
        query.value = '';
      } }, h('b', null, name), h('span', { class: 'muted small' }, r.display_name));
    }) : [h('div', { class: 'muted' }, 'Sonuç bulunamadı. Farklı bir yazımla dene ya da haritaya dokun.')]));
  }), 'sec');
  query.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchBtn.click();
    }
  });

  function draw() {
    map.setStops(stops);
    list.replaceChildren(...stops.map((s, i) => h('div', { class: 'card', style: { flexDirection: 'row', alignItems: 'center', padding: '8px', gap: '4px' } },
      input({ value: s.name, 'aria-label': `${i + 1}. durağın adı`, style: { padding: '8px 12px' }, oninput: (e) => { s.name = e.target.value; }, onchange: () => map.setStops(stops) }),
      h('button', { class: 'iconbtn', 'aria-label': 'Yukarı taşı', disabled: i === 0, onclick: () => { [stops[i - 1], stops[i]] = [stops[i], stops[i - 1]]; draw(); } }, icon('up')),
      h('button', { class: 'iconbtn', 'aria-label': 'Aşağı taşı', disabled: i === stops.length - 1, onclick: () => { [stops[i + 1], stops[i]] = [stops[i], stops[i + 1]]; draw(); } }, icon('down')),
      h('button', { class: 'iconbtn bad', 'aria-label': 'Durağı sil', onclick: () => { stops.splice(i, 1); draw(); } }, icon('trash')))));
  }
  draw();

  const save = (publish) => busy(async () => {
    if (title.value.trim().length < 3) return toast('Etkinlik adı gir.', true);
    const when = new Date(`${date.value}T${time.value || '09:00'}`);
    if (!date.value || Number.isNaN(when.getTime())) return toast('Tarih ve saat seç.', true);
    const payload = {
      title: title.value.trim(),
      description: desc.value.trim() || null,
      meeting_note: note.value.trim() || null,
      starts_at: when.toISOString(),
      published: publish,
    };
    let eventId = id;
    if (id) check(await sb.from('events').update(payload).eq('id', id));
    else eventId = check(await sb.from('events').insert(payload).select('id').single()).id;
    // Durakları yeniden yaz
    check(await sb.from('event_stops').delete().eq('event_id', eventId));
    if (stops.length) {
      check(await sb.from('event_stops').insert(stops.map((s, i) => ({ event_id: eventId, position: i, name: s.name.trim() || `Durak ${i + 1}`, lat: s.lat, lng: s.lng }))));
    }
    toast(publish ? 'Etkinlik kaydedildi.' : 'Taslak kaydedildi.');
    history.replaceState(null, '', `#/event/${eventId}`);
    router.refresh();
  });

  return {
    title: id ? 'Etkinliği düzenle' : 'Yeni etkinlik',
    back: id ? `#/event/${id}` : '#/',
    node: [
      field('Etkinlik adı', title), field('Açıklama', desc), field('Buluşma notu', note),
      section('Tarih ve saat'),
      h('div', { class: 'dt' }, date, time),
      section('Rota'),
      h('div', { class: 'muted' }, 'Yer adını yazıp ara ya da haritaya dokunarak sırayla durak ekle. İlk durak buluşma noktası, son durak varış noktası olur.'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, query), searchBtn),
      results,
      map.el, list,
      h('div', { style: { height: '4px' } }),
      ev?.published
        ? btn('Kaydet', save(true), 'block')
        : [btn('Kaydet ve yayınla', save(true), 'block'), btn('Taslak olarak kaydet', save(false), 'ghost block')],
    ],
  };
}

// =====================================================================
// Sürüş düzeni
// =====================================================================
export async function formation(id) {
  const [ev, atts, saved] = await Promise.all([
    sb.from('events').select('title').eq('id', id).maybeSingle().then(check),
    sb.from('attendances').select('user_id, profiles!attendances_user_id_fkey(full_name)').eq('event_id', id).eq('going', true).then(check),
    sb.from('formation_slots').select('position, rider_id, passenger_id').eq('event_id', id).order('position').then(check),
  ]);
  const admin = isAdmin();
  const people = atts.map((a) => ({ id: a.user_id, name: a.profiles?.full_name ?? '?' })).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const nameOf = (uid) => people.find((p) => p.id === uid)?.name ?? '';
  let slots = saved.map((s) => ({ rider_id: s.rider_id, passenger_id: s.passenger_id }));
  let dirty = false;
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });

  const change = (fn) => {
    fn();
    if (slots[0]) slots[0].passenger_id = null; // Head tek kişi
    dirty = true;
    draw();
  };
  const free = () => {
    const used = new Set(slots.flatMap((s) => [s.rider_id, s.passenger_id]).filter(Boolean));
    return people.filter((p) => !used.has(p.id));
  };
  function pick(i, key) {
    sheet((close) => {
      const set = (uid) => { change(() => { slots[i][key] = uid; }); close(); };
      const list = free();
      return [
        h('h2', null, key === 'passenger_id' ? 'Yolcu seç' : 'Sürücü seç'),
        list.length ? list.map((p) => h('button', { class: 'pick', onclick: () => set(p.id) }, p.name))
          : h('div', { class: 'muted' }, 'Atanabilecek katılımcı kalmadı. Sadece “Katılıyorum” diyenler listelenir.'),
        btn('Boş bırak', () => set(null), 'ghost block'),
        btn('Kapat', close, 'sec block'),
      ];
    });
  }
  const who = (label, uid, i, key) => h(admin ? 'button' : 'div', { class: 'who' + (uid ? '' : ' none'), onclick: admin ? () => pick(i, key) : null },
    h('small', null, label), h('span', null, nameOf(uid) || (admin ? 'Seçmek için dokun' : '—')));

  function draw() {
    box.replaceChildren(...[
      slots.length ? null : h('div', { class: 'card muted' }, admin ? 'Henüz sürüş düzeni yok. Aşağıdan Head ekleyerek başla.' : 'Sürüş düzeni henüz oluşturulmadı.'),
      ...slots.map((s, i) => {
        const head = i === 0;
        const side = head ? 'head' : i % 2 === 1 ? 'left' : 'right';
        return h('div', { class: `card slot ${side}` + (head ? ' gold' : '') },
          h('div', { class: 'row' },
            h('div', { class: 'lab grow' }, head ? '⭐ HEAD' : `#${i + 1} · ${side === 'left' ? 'Sol' : 'Sağ'}`),
            admin && [
              h('button', { class: 'iconbtn', 'aria-label': 'Öne al', disabled: i === 0, onclick: () => change(() => { [slots[i - 1], slots[i]] = [slots[i], slots[i - 1]]; }) }, icon('up')),
              h('button', { class: 'iconbtn', 'aria-label': 'Arkaya al', disabled: i === slots.length - 1, onclick: () => change(() => { [slots[i + 1], slots[i]] = [slots[i], slots[i + 1]]; }) }, icon('down')),
              h('button', { class: 'iconbtn bad', 'aria-label': 'Motoru kaldır', onclick: () => change(() => { slots.splice(i, 1); }) }, icon('x')),
            ]),
          who('Sürücü', s.rider_id, i, 'rider_id'),
          !head && (s.passenger_id || admin) ? who('Yolcu', s.passenger_id, i, 'passenger_id') : null);
      }),
      admin && btn(slots.length ? '+ Motor ekle' : '+ Head ekle', () => change(() => { slots.push({ rider_id: null, passenger_id: null }); }), 'sec block'),
      admin && h('div', { class: 'muted' }, `Atanmamış katılımcı: ${free().length}`),
      admin && h('button', { class: 'btn block', disabled: !dirty, onclick: busy(async () => {
        if (slots.some((s) => !s.rider_id)) return toast('Her motor için bir sürücü seç ya da boş motoru kaldır.', true);
        check(await sb.rpc('save_formation', { p_event_id: id, slots }));
        toast('Sürüş düzeni kaydedildi.');
        dirty = false;
        draw();
      }) }, 'Sürüş düzenini kaydet'),
    ].filter(Boolean));
  }
  draw();

  return {
    title: 'Sürüş düzeni',
    back: `#/event/${id}`,
    node: [
      h('h1', { class: 'title' }, ev?.title ?? ''),
      h('div', { class: 'muted' }, 'En önde Head (tek kişi), arkasında motorlar fermuar düzeninde sol–sağ sıralanır. Her motorda sürücü ve isteğe bağlı bir yolcu olabilir.'),
      box,
    ],
  };
}

// =====================================================================
// Öneriler
// =====================================================================
export async function suggestions() {
  const [items, votes] = await Promise.all([
    sb.from('suggestions').select('*, profiles!suggestions_user_id_fkey(full_name)').order('created_at', { ascending: false }).then(check),
    sb.from('suggestion_votes').select('*').then(check),
  ]);
  const uid = me();
  const title = input({ placeholder: 'Örn: Kapadokya 2 günlük tur', 'aria-label': 'Öneri başlığı' });
  const body = textarea({ placeholder: 'Rota, tarih, detay fikirlerin...', 'aria-label': 'Öneri detayı' });
  const vote = (s, value, mine) => busy(async () => {
    if (mine === value) check(await sb.from('suggestion_votes').delete().eq('suggestion_id', s.id).eq('user_id', uid));
    else check(await sb.from('suggestion_votes').upsert({ suggestion_id: s.id, user_id: uid, value }));
    router.refresh();
  });
  return {
    title: 'Öneriler',
    tab: 'suggestions',
    node: [
      section('Etkinlik öner'),
      h('div', { class: 'muted' }, 'Önerileri tüm üyeler görür ve oylayabilir.'),
      title, body,
      btn('Öneriyi gönder', busy(async () => {
        if (title.value.trim().length < 3) return toast('Önerine kısa bir başlık yaz.', true);
        check(await sb.from('suggestions').insert({ title: title.value.trim(), body: body.value.trim() || null }));
        toast('Teşekkürler! Önerin eklendi.');
        router.refresh();
      }), 'block'),
      section(`Öneriler (${items.length})`),
      items.length ? null : h('div', { class: 'empty' }, 'Henüz öneri yok.'),
      items.map((s) => {
        const vs = votes.filter((v) => v.suggestion_id === s.id);
        const mine = vs.find((v) => v.user_id === uid)?.value;
        const up = vs.filter((v) => v.value === 1).length;
        const down = vs.filter((v) => v.value === -1).length;
        return h('div', { class: 'card' },
          h('b', null, s.title),
          s.body ? h('div', { class: 'pre' }, s.body) : null,
          h('div', { class: 'muted small' }, (s.profiles?.full_name ? `${s.profiles.full_name} · ` : '') + fmtDate(s.created_at)),
          h('div', { class: 'row' },
            h('div', { class: 'votes grow' },
              h('button', { class: 'react up' + (mine === 1 ? ' on' : ''), 'aria-label': 'Beğendim', onclick: vote(s, 1, mine) }, icon('like'), up),
              h('button', { class: 'react down' + (mine === -1 ? ' on' : ''), 'aria-label': 'Beğenmedim', onclick: vote(s, -1, mine) }, icon('dislike'), down)),
            isAdmin() || s.user_id === uid ? btn('Sil', busy(async () => {
              if (!(await confirmBox('Öneriyi sil', `“${s.title}” silinsin mi?`, { yes: 'Sil', danger: true }))) return;
              check(await sb.from('suggestions').delete().eq('id', s.id));
              router.refresh();
            }), 'ghost sm') : null));
      }),
    ],
  };
}

// =====================================================================
// Dashboard (yönetici)
// =====================================================================
const adminOnly = (title, tab) => ({ title, tab, node: h('div', { class: 'empty' }, 'Bu ekran sadece yöneticiler içindir.') });

let dashTab = 'members';
export async function dashboard() {
  if (!isAdmin()) return adminOnly('Dashboard', 'dashboard');
  const d = await sb.rpc('admin_dashboard').then(check);
  const max = Math.max(1, ...d.members.map((m) => m.attended));
  const tile = (value, label, cls = '') => h('div', { class: 'tile ' + cls }, h('b', null, value), h('span', null, label));
  const dot = (v) => h('i', { class: 'dot', style: { background: `var(${v})` } });
  // Sekme değişince yalnızca bu bölüm yeniden çizilir
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  function draw() {
    const seg = (key, label) => h('button', { class: dashTab === key ? 'on' : '', onclick: () => { if (dashTab !== key) { dashTab = key; draw(); } } }, label);
    const flat = (arr) => arr.flat(Infinity).filter((x) => x != null && x !== false);
    body.replaceChildren(...flat([
      h('div', { class: 'seg' }, seg('members', 'Üye katılımları'), seg('events', `Etkinlikler (${d.events.length})`)),
      dashTab === 'members' ? [
      h('div', { class: 'muted' }, 'Sıralama yoklamaya göredir: sayı, yoklamada “geldi” işaretlendiği etkinlik sayısıdır.'),
      h('div', { class: 'card' },
        d.members.length ? null : h('div', { class: 'muted' }, 'Veri yok.'),
        d.members.map((m, i) => h('div', { class: 'rank' },
          h('span', { class: 'n' }, i + 1), h('span', { style: { fontWeight: '600' } }, m.full_name, EDU[m.edu_status] ? h('span', { class: 'muted small' }, `  ${EDU[m.edu_status]}`) : null), h('span', { class: 'v' }, m.attended),
          h('div', { class: 'track' }, h('i', { style: { width: `${(m.attended / max) * 100}%` } })),
          h('div', { class: 'sub' }, dot('--ok'), `${m.yes_count} katılıyorum  `, dot('--bad'), `${m.no_count} katılamıyorum  `, dot('--muted'), `${Math.max(0, d.total_events - m.yes_count - m.no_count)} yanıtsız`)))),
      ] : [
      d.events.length ? null : h('div', { class: 'empty' }, 'Henüz yayınlanmış etkinlik yok.'),
      d.events.map((e) => h('button', { class: 'card', style: { textAlign: 'left', width: '100%', color: 'inherit' }, onclick: () => router.go(`#/event/${e.id}`) },
        h('b', null, e.title), h('div', { class: 'muted' }, fmtDate(e.starts_at)),
        h('div', { class: 'muted' }, `${e.completed_at ? 'Tamamlandı' : 'Aktif'} · ✅ ${e.going} katılıyorum · 🏁 ${e.present ?? 0} geldi · ❌ ${e.not_going} · 👍 ${e.likes} · 👎 ${e.dislikes}`))),
      ],
    ]));
  }
  draw();

  return {
    title: 'Dashboard',
    tab: 'dashboard',
    node: [
      h('div', { class: 'tiles' },
        tile(d.past_events, 'Yapılan etkinlik', 'gold'), tile(d.upcoming_events, 'Aktif'), tile(d.approved_members, 'Onaylı üye'),
        tile(d.pending_members, 'Onay bekleyen', d.pending_members > 0 ? 'warn' : ''), tile(d.open_suggestions, 'Öneri'), tile(d.total_events, 'Toplam etkinlik')),
      body,
    ],
  };
}

// =====================================================================
// Üyeler (yönetici)
// =====================================================================
let memQuery = '';
export async function members() {
  if (!isAdmin()) return adminOnly('Üyeler', 'members');
  const all = await sb.from('profiles').select('*').order('full_name').then(check);
  const patch = (id, values) => busy(async () => {
    check(await sb.from('profiles').update(values).eq('id', id));
    router.refresh();
  });
  const info = (m) => [
    h('div', { class: 'row wrap' }, h('b', { style: { fontSize: '16px' } }, m.full_name || '(isimsiz)'),
      EDU[m.edu_status] ? badge(EDU[m.edu_status], m.edu_status === 'student' ? 'gold' : 'ok') : badge('Okuyor/mezun: belirtilmemiş')),
    h('div', { class: 'muted' }, [m.bike, m.phone].filter(Boolean).join(' · ') || 'Bilgi yok'),
    h('div', { class: 'muted small' }, `Kayıt: ${fmtDate(m.created_at)}`),
  ];
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  const search = searchBox(memQuery, 'Üye ara: ad, motor, telefon', (v) => { memQuery = v; draw(); });
  const flat = (arr) => arr.flat(Infinity).filter((x) => x != null && x !== false);
  function draw() {
    const shown = all.filter((m) => matches(memQuery, m.full_name, m.bike, m.phone, EDU[m.edu_status]));
    const waiting = shown.filter((m) => m.status === 'pending');
    const approved = shown.filter((m) => m.status === 'approved');
    const rejected = shown.filter((m) => m.status === 'rejected');
    body.replaceChildren(...flat([
      memQuery.trim() && !shown.length ? h('div', { class: 'empty' }, 'Aramayla eşleşen üye yok.') : null,
      section(`Onay bekleyenler (${waiting.length})`),
      waiting.length ? null : h('div', { class: 'muted' }, 'Bekleyen başvuru yok.'),
      waiting.map((m) => h('div', { class: 'card' }, info(m),
        h('div', { class: 'row' }, btn('Onayla', patch(m.id, { status: 'approved' }), 'ok sm grow'), btn('Reddet', patch(m.id, { status: 'rejected' }), 'bad sm grow')))),
      section(`Üyeler (${approved.length})`),
      h('div', { class: 'muted' }, `Yöneticiler: ${all.filter((m) => m.status === 'approved' && m.role === 'admin').length}. Kendi yetkini buradan değiştiremezsin.`),
      approved.map((m) => {
        const admin = m.role === 'admin';
        return h('div', { class: 'card' },
          admin ? h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, badge('Yönetici', 'gold')) : null,
          info(m),
          m.id === me() ? null : h('div', { class: 'row' },
            btn(admin ? 'Yöneticiliği al' : 'Yönetici yap', busy(async (e) => {
              const ok = await confirmBox(admin ? 'Yöneticilik alınsın mı?' : 'Yönetici yapılsın mı?',
                admin ? `${m.full_name} artık etkinlik oluşturamayacak ve üye onaylayamayacak.`
                  : `${m.full_name} etkinlik oluşturabilecek, üye onaylayabilecek ve diğer yöneticileri yönetebilecek.`);
              if (!ok) return;
              check(await sb.from('profiles').update({ role: admin ? 'member' : 'admin' }).eq('id', m.id));
              router.refresh();
            }), (admin ? 'sec' : '') + ' sm grow'),
            btn('Üyelikten çıkar', busy(async () => {
              if (!(await confirmBox('Üyelikten çıkar', `${m.full_name} uygulamaya erişemeyecek.`, { yes: 'Çıkar', danger: true }))) return;
              check(await sb.from('profiles').update({ status: 'rejected', role: 'member' }).eq('id', m.id));
              router.refresh();
            }), 'ghost sm grow')));
      }),
      rejected.length ? [
        section(`Reddedilenler (${rejected.length})`),
        rejected.map((m) => h('div', { class: 'card' }, info(m), btn('Yeniden onayla', patch(m.id, { status: 'approved' }), 'sec sm'))),
      ] : null,
    ]));
  }
  draw();
  return { title: 'Üyeler', tab: 'members', node: [search, body] };
}

// =====================================================================
// Profil
// =====================================================================
export function profile() {
  const p = state.profile;
  const name = input({ value: p?.full_name ?? '', autocomplete: 'name' });
  const phone = input({ value: p?.phone ?? '', type: 'tel', autocomplete: 'tel' });
  const bike = input({ value: p?.bike ?? '' });
  const edu = eduPicker(p?.edu_status);
  return {
    title: 'Profil',
    tab: 'profile',
    node: [
      h('div', null, badge(isAdmin() ? 'Yönetici' : 'Üye', isAdmin() ? 'gold' : '')),
      h('div', { class: 'muted' }, state.session?.user?.email ?? ''),
      section('Bilgilerim'),
      field('Ad soyad', name), edu.el, field('Telefon', phone), field('Motosiklet', bike),
      btn('Kaydet', busy(async () => {
        if (name.value.trim().length < 3) return toast('Ad soyad gir.', true);
        check(await sb.from('profiles').update({ full_name: name.value.trim(), phone: phone.value.trim() || null, bike: bike.value.trim() || null, edu_status: edu.value }).eq('id', p.id));
        await loadProfile();
        toast('Kaydedildi.');
      }), 'block'),
      btn('Çıkış yap', () => sb.auth.signOut(), 'ghost block'),
    ],
  };
}
