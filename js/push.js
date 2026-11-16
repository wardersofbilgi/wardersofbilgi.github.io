// Telefon bildirimleri (Web Push). iPhone'da yalnızca ana ekrana eklenmiş uygulamada çalışır.
import { sb } from './core.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const b64ToBytes = (b64) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const registration = () => navigator.serviceWorker.getRegistration();

// 'unsupported' | 'denied' | 'on' | 'off'
export async function pushStatus() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await (await registration())?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function save(sub) {
  const j = sub.toJSON();
  const { error } = await sb.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  if (error) throw error;
}

export async function enablePush() {
  // İzin sorusu doğrudan düğmeye basılınca sorulmalı (iPhone şartı)
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Bildirim izni verilmedi. Telefonun ayarlarından WOB için bildirimlere izin verebilirsin.');
  const reg = await navigator.serviceWorker.ready;
  const { data: key, error } = await sb.rpc('push_public_key');
  if (error) throw error;
  if (!key) throw new Error('Bildirim sistemi henüz kurulmadı. Yöneticiye haber ver.');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await save(sub);
}

export async function disablePush() {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (!sub) return;
  await sb.rpc('push_unsubscribe', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}

// Açılışta: bu telefondaki abonelik, giriş yapan üyeye bağlı kalsın
export async function syncPush() {
  try {
    if ((await pushStatus()) !== 'on') return;
    await save(await (await registration()).pushManager.getSubscription());
  } catch { /* önemli değil */ }
}

// Bildirime dokunulunca service worker hangi sayfanın açılacağını söyler
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open' && typeof e.data.url === 'string' && e.data.url.startsWith('#/')) location.hash = e.data.url;
  });
}
