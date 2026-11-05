/**
 * IP klien di belakang reverse proxy (nginx di host yang sama). `CF-Connecting-IP` hanya dipercaya bila koneksi TCP
 * datang dari alamat di dalam daftar CIDR tepercaya (`TRUSTED_PROXY`; bawaan loopback); dari peer lain header itu
 * dapat dipalsukan sehingga diabaikan (pembatas percobaan salah tidak boleh bisa dikelabui dengan header acak).
 * Di Docker peer nginx host adalah gateway jaringan bridge, bukan loopback, jadi compose mematok subnet tetap dan
 * subnet itu didaftarkan di sini (keputusan I5, 2026-11-05).
 */

/** Satu CIDR dalam ruang 128 bit: IPv4 dipetakan ke `::ffff:a.b.c.d` (prefiks IPv4 + 96) agar satu perbandingan cukup. */
export interface Cidr {
  /** Alamat jaringan (bit tuan rumah nol) sebagai bilangan 128 bit. */
  readonly network: bigint;
  /** Panjang prefiks pada ruang 128 bit (0-128). */
  readonly prefix: number;
}

/** Daftar CIDR tepercaya hasil `parseTrustedProxy`. Kosong = tidak ada proxy tepercaya. */
export type TrustedProxy = readonly Cidr[];

/** Nilai bawaan `TRUSTED_PROXY`: hanya loopback (nginx di host yang sama tanpa Docker). */
export const DEFAULT_TRUSTED_PROXY = '127.0.0.1/32,::1/128';

/** Panjang maksimum alamat IPv6 tekstual (`0000:...:255.255.255.255`). */
const MAX_IP_LENGTH = 45;
const IP_CHARS = /^[0-9a-fA-F:.]+$/;
/** IPv4 yang dipetakan ke IPv6 (`::ffff:203.0.113.7`), bentuk yang dilaporkan Bun untuk soket dual-stack. */
const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const IPV4_MAPPED_PREFIX = 0xffffn << 32n;
const IPV4_STRICT = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;
const PREFIX_STRICT = /^(0|[1-9]\d{0,2})$/;

/** IPv4 bertitik ketat (tanpa nol di depan, oktet <= 255) sebagai bilangan 32 bit, atau `null`. */
function parseIpv4(text: string): bigint | null {
  const match = IPV4_STRICT.exec(text);
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
}

/** Alamat IPv4 atau IPv6 (tanpa zona) sebagai bilangan 128 bit; IPv4 dipetakan ke `::ffff:a.b.c.d`. `null` bila tak sah. */
function addressBits(text: string): bigint | null {
  if (!text.includes(':')) {
    const v4 = parseIpv4(text);
    return v4 === null ? null : IPV4_MAPPED_PREFIX | v4;
  }
  const groups = expandIpv6(text);
  if (groups === null) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
}

/** Satu entri CIDR (`alamat/prefiks`), ketat: prefiks wajib, di dalam rentang, dan tanpa bit tuan rumah. */
function parseCidr(text: string): Cidr | null {
  const parts = text.split('/');
  if (parts.length !== 2) return null;
  const [address = '', prefixText = ''] = parts;
  if (!IP_CHARS.test(address) || !PREFIX_STRICT.test(prefixText)) return null;
  const bits = addressBits(address);
  if (bits === null) return null;
  const isV4 = !address.includes(':');
  const prefix = Number(prefixText);
  if (prefix > (isV4 ? 32 : 128)) return null;
  const full = isV4 ? prefix + 96 : prefix;
  const hostBits = 128n - BigInt(full);
  if ((bits & ((1n << hostBits) - 1n)) !== 0n) return null;
  return { network: bits, prefix: full };
}

/**
 * Mengurai `TRUSTED_PROXY`: daftar CIDR IPv4/IPv6 dipisah koma (spasi di sekitar entri diabaikan). Ketat: satu entri
 * rusak, kosong, tanpa prefiks, prefiks di luar rentang, atau berbit tuan rumah membuat seluruh daftar `null`
 * (pemanggil gagal keras), bukan daftar yang diam-diam kosong atau lebih longgar dari maksud operator.
 */
export function parseTrustedProxy(text: string): TrustedProxy | null {
  const entries = text.split(',').map((entry) => entry.trim());
  const list: Cidr[] = [];
  for (const entry of entries) {
    const cidr = parseCidr(entry);
    if (cidr === null) return null;
    list.push(cidr);
  }
  return list;
}

/** Bawaan terurai (loopback saja), dipakai `clientIp` bila daftar tidak diberikan. */
const LOOPBACK_PROXY: TrustedProxy = parseTrustedProxy(DEFAULT_TRUSTED_PROXY) ?? [];

/** True bila `peerAddress` (IPv4, IPv6, atau IPv4-mapped; zona dibuang) berada di dalam salah satu CIDR. */
export function isTrustedPeer(peerAddress: string, trustedProxy: TrustedProxy): boolean {
  const normalized = normalizeAddress(peerAddress);
  if (normalized === '' || !IP_CHARS.test(normalized)) return false;
  const bits = addressBits(normalized);
  if (bits === null) return false;
  return trustedProxy.some((cidr) => {
    const shift = BigInt(128 - cidr.prefix);
    return bits >> shift === cidr.network >> shift;
  });
}

/** Alamat peer tanpa pembungkus IPv4-mapped (`::ffff:1.2.3.4` -> `1.2.3.4`) dan tanpa zona (`fe80::1%eth0`). */
export function normalizeAddress(address: string): string {
  const trimmed = address.trim().split('%')[0] ?? '';
  const mapped = MAPPED_V4.exec(trimmed);
  return mapped?.[1] ?? trimmed;
}

/** Loopback: 127.0.0.0/8 dan ::1 (termasuk bentuk IPv4-mapped). */
export function isLoopbackAddress(address: string): boolean {
  const normalized = normalizeAddress(address);
  return normalized === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
}

/**
 * IP klien untuk pembatas dan log: nilai `CF-Connecting-IP` HANYA bila peer ada di dalam `trustedProxy` (daftar
 * CIDR; bawaan loopback; "percaya semua" hanya lewat `0.0.0.0/0,::/0` yang ditulis operator), selain itu alamat peer.
 * Header yang bukan alamat IP dianggap tidak ada. Peer tak dikenal menghasilkan `unknown`.
 */
export function clientIp(
  request: Request,
  peerAddress: string,
  trustedProxy: TrustedProxy = LOOPBACK_PROXY,
): string {
  const peer = normalizeAddress(peerAddress);
  if (isTrustedPeer(peerAddress, trustedProxy)) {
    const header = request.headers.get('cf-connecting-ip')?.trim() ?? '';
    if (header !== '' && header.length <= MAX_IP_LENGTH && IP_CHARS.test(header)) {
      return normalizeAddress(header);
    }
  }
  return peer === '' ? 'unknown' : peer;
}

/** Memperluas alamat IPv6 tekstual menjadi delapan kelompok 16-bit; `null` bila bukan IPv6 yang sah. */
function expandIpv6(address: string): number[] | null {
  let text = address.toLowerCase();
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (tail) {
    const octets = tail.slice(1, 5).map(Number);
    if (octets.some((octet) => octet > 255)) return null;
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
 * Pengenal klien untuk pembatas percobaan: IPv4 per alamat, IPv6 per /64 (satu pelanggan lazimnya memegang seluruh
 * /64 dan dapat berganti alamat di dalamnya sesuka hati; tanpa pengelompokan, penyerang melewati batas dan memenuhi
 * tabel `rate_limits`). Alamat yang tak dapat diurai (mis. `unknown`) dikembalikan apa adanya.
 */
export function limiterAddress(ip: string): string {
  const address = normalizeAddress(ip);
  if (!address.includes(':')) return address;
  const groups = expandIpv6(address);
  if (groups === null) return address;
  // Bentuk yang membawa IPv4 di 32 bit terakhir dinormalkan ke IPv4 bertitiknya (satu penghitung per IPv4, bukan
  // satu ember /64 bersama alamat IPv6 lain): IPv4-mapped `::ffff:a.b.c.d`, IPv4-translated `::ffff:0:a.b.c.d`, dan
  // IPv4-compatible usang `::a.b.c.d` (6 kelompok nol; kelompok ke-7 tak nol agar `::1`, `::2`, dan `::` tetap IPv6).
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
  const zeros = (...values: number[]) => values.every((value) => value === 0);
  const embedsIpv4 =
    (zeros(g0, g1, g2, g3, g4) && g5 === 0xffff) ||
    (zeros(g0, g1, g2, g3, g5) && g4 === 0xffff) ||
    (zeros(g0, g1, g2, g3, g4, g5) && high !== 0);
  if (embedsIpv4) return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}
