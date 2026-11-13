/**
 * Kebijakan endpoint langganan Web Push (spek §5.2; keputusan pemilik 2026-11-13: allowlist host). Modul murni
 * tanpa impor lain agar dipakai bersama oleh validasi (`push-validate.ts`, saat berlangganan) dan pengirim
 * (`web-push.ts`, saat mengirim) tanpa impor siklik.
 */

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.localdomain', '.home.arpa'];

/**
 * Layanan push milik peramban besar: Chrome/Edge/Opera/Brave/Samsung memakai FCM (`fcm.googleapis.com`, dan
 * `android.googleapis.com` untuk endpoint GCM lama), Firefox memakai Mozilla autopush (`*.push.services.mozilla.com`),
 * Edge lama memakai WNS (`*.notify.windows.com`), Safari/iOS memakai `web.push.apple.com` (`*.push.apple.com`).
 * Cocok pada batas label: sama persis atau berakhiran `.<domain>`. Peramban yang memakai layanan lain tidak dapat
 * berlangganan sampai daftar ini diperbarui di kode (sengaja: tanpa variabel `.env` baru).
 */
export const PUSH_ALLOWED_HOSTS = {
  exact: ['fcm.googleapis.com', 'android.googleapis.com'],
  suffix: ['push.services.mozilla.com', 'notify.windows.com', 'push.apple.com'],
} as const;

function isAllowedPushHost(host: string): boolean {
  if ((PUSH_ALLOWED_HOSTS.exact as readonly string[]).includes(host)) return true;
  return PUSH_ALLOWED_HOSTS.suffix.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Endpoint langganan harus layanan push publik yang dikenal: `https:` tanpa userinfo, port bawaan (443), nama host
 * (bukan literal IP, bukan `localhost` atau nama lokal/internal, bukan satu label) yang ada di allowlist
 * `PUSH_ALLOWED_HOSTS`. Allowlist adalah pertahanan utama terhadap SSRF: pengirim hanya pernah menghubungi host
 * layanan push, bukan alamat yang dipilih klien; pemeriksaan bentuk di atasnya tetap dipertahankan sebagai lapisan
 * kedua dan agar pesan galat spesifik tetap sama. Pemeriksaan ini TIDAK menyelesaikan DNS. Pengirim juga tidak
 * mengikuti pengalihan dan berbatas waktu.
 * Mengembalikan pesan galat, atau null bila layak.
 */
export function pushEndpointError(endpoint: string): string | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return 'Endpoint bukan URL yang sah';
  }
  if (url.protocol !== 'https:') return 'Endpoint harus memakai https';
  if (url.username !== '' || url.password !== '') return 'Endpoint tidak boleh memuat kredensial';
  if (url.port !== '' && url.port !== '443') return 'Endpoint harus memakai port 443';
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '' || host.startsWith('[') || host.includes(':')) {
    return 'Endpoint tidak boleh berupa alamat IP';
  }
  if (!host.includes('.')) return 'Endpoint harus berupa nama host publik';
  const labels = host.split('.');
  // Literal IPv4 (URL menormalkan bentuk heksa/oktal ke titik-angka) atau TLD numerik.
  if (/^\d+$/.test(labels[labels.length - 1] as string)) {
    return 'Endpoint tidak boleh berupa alamat IP';
  }
  if (host === 'localhost' || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return 'Endpoint harus berupa nama host publik';
  }
  if (!isAllowedPushHost(host)) return 'Layanan push endpoint ini tidak didukung';
  return null;
}
