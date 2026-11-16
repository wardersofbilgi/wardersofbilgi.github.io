// WOB bildirim gönderici (Supabase Edge Function, adı: push).
// Veritabanındaki tetikleyiciler bu fonksiyonu çağırır; kime ne gideceğini
// veritabanındaki push_job() belirler. Bu fonksiyon yalnızca iletir.
// Ayar: "Verify JWT" KAPALI olmalı (çağrılar gizli anahtarla doğrulanır).
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = "https://hgpncthohgxvazoizvho.supabase.co";
// Publishable key herkese açık bir anahtardır.
const KEY = "sb_publishable_KHfD-45B4nPBTxeU6Yr6DQ_PurFTKx3";
const SUBJECT = "https://wardersofbilgi.github.io";

async function rpc(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${name}: ${r.status} ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("WOB push", { status: 200 });
  try {
    const { secret, ...payload } = await req.json();
    const job = await rpc("push_job", { p_secret: secret, p_payload: payload });

    // İlk çalıştırmada bildirim anahtarlarını üret ve veritabanına kaydet
    let vapid = job.vapid;
    if (!vapid) {
      const k = webpush.generateVAPIDKeys();
      vapid = await rpc("push_set_vapid", { p_secret: secret, p_public: k.publicKey, p_private: k.privateKey });
    }
    webpush.setVapidDetails(SUBJECT, vapid.public, vapid.private);

    const subs = job.subscriptions ?? [];
    const gone: string[] = [];
    let sent = 0;
    await Promise.all(subs.map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(job.message),
          { TTL: 60 * 60 * 24 },
        );
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.endpoint); // abonelik artık geçersiz
        else console.error("push failed", code, (err as Error).message);
      }
    }));
    if (gone.length) await rpc("push_gone", { p_secret: secret, p_endpoints: gone });

    return Response.json({ ok: true, sent, removed: gone.length });
  } catch (err) {
    console.error(err);
    return Response.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
});
