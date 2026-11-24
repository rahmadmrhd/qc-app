/**
 * Data kunjungan tautan dashboard publik (keputusan pemilik 2026-11-24): fungsi murni tanpa dependensi dan tanpa API
 * runtime/DOM. IP asli dan User-Agent mentah TIDAK pernah disimpan: yang disimpan hanya IP terpotong (/24 atau /48),
 * negara (dua huruf), dan ringkasan perangkat yang HANYA tersusun dari daftar putih nama di bawah.
 */

export const VISIT_LIMITS = {
  /** Baris kunjungan yang disimpan per tautan (terbaru); `visit_count` tetap menghitung semuanya. */
  keep: 50,
  /** Pemuatan ulang dari IP terpotong dan perangkat yang sama dalam jendela ini dihitung satu kunjungan. */
  dedupMs: 30 * 60_000,
} as const;

/** Satu kunjungan yang ditampilkan di View tautan. */
export interface ShareVisitDto {
  visitedAt: string;
  /** Kode negara dua huruf; kosong = tak diketahui. */
  country: string;
  /** Ringkasan, mis. "Desktop · Chrome · Windows". */
  device: string;
  /** IP terpotong, mis. "203.0.113.0/24" atau "2001:db8:abcd::/48". */
  ipPrefix: string;
}

const IPV4_STRICT = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;
const IPV6_CHARS = /^[0-9a-fA-F:.]+$/;
const MAX_IP_LENGTH = 45;

function ipv4Octets(text: string): number[] | null {
  const match = IPV4_STRICT.exec(text);
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  return octets.some((octet) => octet > 255) ? null : octets;
}

/** Delapan kelompok 16 bit dari IPv6 tekstual (ekor IPv4 bertitik diterima), atau `null` bila tak sah. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail) {
    const octets = ipv4Octets(tail[1] as string);
    if (octets === null) return null;
    const high = ((octets[0] as number) << 8) | (octets[1] as number);
    const low = ((octets[2] as number) << 8) | (octets[3] as number);
    text = `${text.slice(0, tail.index)}${high.toString(16)}:${low.toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
    return groups.map((group) => Number.parseInt(group, 16));
  };
  const head = parse(halves[0] ?? '');
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (head === null || rest === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...rest];
}

/**
 * IP terpotong untuk disimpan: IPv4 menjadi `a.b.c.0/24`, IPv6 menjadi tiga kelompok pertama `x:y:z::/48`, IPv4-mapped
 * IPv6 diperlakukan sebagai IPv4. Alamat tak sah atau kosong = `''`. Keluarannya tak pernah memuat alamat asli.
 */
export function truncateIp(ip: string): string {
  if (typeof ip !== 'string') return '';
  const trimmed = ip.trim();
  if (trimmed === '' || trimmed.length > MAX_IP_LENGTH + 20) return '';
  if (!trimmed.includes(':')) {
    const octets = ipv4Octets(trimmed);
    return octets === null ? '' : `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }
  const address = trimmed.split('%')[0] ?? '';
  if (address === '' || address.length > MAX_IP_LENGTH || !IPV6_CHARS.test(address)) return '';
  const groups = ipv6Groups(address);
  if (groups === null) return '';
  const [g0, g1, g2, g3, g4, g5, high, low] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return `${high >> 8}.${high & 0xff}.${low >> 8}.0/24`;
  }
  return `${g0.toString(16)}:${g1.toString(16)}:${g2.toString(16)}::/48`;
}

/** Kode negara dari header `CF-IPCountry`: tepat dua huruf (huruf besar); `XX`, `T1`, atau nilai lain = `''`. */
export function cleanCountry(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  const text = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(text) && text !== 'XX' ? text : '';
}

const UA_MAX = 512;

function deviceType(ua: string): string {
  if (/bot|crawler|spider|curl|wget|python-requests|httpclient|headless/i.test(ua)) return 'Bot';
  if (/ipad|tablet|kindle/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) {
    return 'Tablet';
  }
  if (/mobi|iphone|ipod|android/i.test(ua)) return 'Ponsel';
  return 'Desktop';
}

function browserName(ua: string): string {
  if (/edg(e|a|ios)?\//i.test(ua)) return 'Edge';
  if (/opr\/|opera/i.test(ua)) return 'Opera';
  if (/samsungbrowser/i.test(ua)) return 'Samsung Internet';
  if (/firefox\/|fxios\//i.test(ua)) return 'Firefox';
  if (/chrome\/|chromium\/|crios\//i.test(ua)) return 'Chrome';
  if (/safari\//i.test(ua) && /version\//i.test(ua)) return 'Safari';
  return 'Browser lain';
}

function osName(ua: string): string {
  if (/windows/i.test(ua)) return 'Windows';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/cros/i.test(ua)) return 'ChromeOS';
  if (/macintosh|mac os x/i.test(ua)) return 'macOS';
  if (/linux|x11/i.test(ua)) return 'Linux';
  return 'OS lain';
}

/**
 * Ringkasan perangkat dari User-Agent, mis. "Desktop · Chrome · Windows". Hasilnya hanya tersusun dari daftar putih
 * nama (jenis, peramban, sistem operasi), jadi pendek dan aman dirender; User-Agent mentah tidak ikut. Kosong atau
 * bukan string = `''`.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  if (typeof userAgent !== 'string') return '';
  const ua = userAgent.slice(0, UA_MAX).trim();
  if (ua === '') return '';
  return `${deviceType(ua)} · ${browserName(ua)} · ${osName(ua)}`;
}
