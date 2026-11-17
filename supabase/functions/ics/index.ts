// WOB takvim dosyası (Supabase Edge Function, adı: ics).
// Uygulama etkinlik bilgisini adrese koyar; bu fonksiyon onu .ics takvim dosyasına çevirir.
// iPhone'da Safari bu dosyayı açınca "Takvime ekle" ekranı çıkar.
// Veritabanına dokunmaz. Ayar: "Verify JWT" KAPALI olmalı (düz bir bağlantıyla açılır).

const DATE = /^\d{8}T\d{6}Z$/;

const esc = (t: string) =>
  t.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");

// RFC 5545: satırlar 75 bayttan uzunsa katlanır
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (enc.encode(cur + ch).length > 73) {
      out.push(cur);
      cur = " " + ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
}

Deno.serve((req) => {
  const u = new URL(req.url);
  const get = (k: string, max: number) => (u.searchParams.get(k) ?? "").slice(0, max);
  const id = get("id", 64).replace(/[^A-Za-z0-9-]/g, "") || crypto.randomUUID();
  const start = get("s", 16);
  const end = get("e", 16);
  const title = get("t", 200) || "WOB etkinliği";
  if (!DATE.test(start) || !DATE.test(end)) {
    return new Response("Geçersiz tarih.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WOB//Warders of Bilgi//TR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${id}@wardersofbilgi`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${esc(title)}`,
    get("d", 1200) ? `DESCRIPTION:${esc(get("d", 1200))}` : "",
    get("l", 300) ? `LOCATION:${esc(get("l", 300))}` : "",
    get("u", 300).startsWith("https://") ? `URL:${get("u", 300)}` : "",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT2H",
    `DESCRIPTION:${esc(title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).map(fold);
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="wob-etkinlik.ics"',
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
