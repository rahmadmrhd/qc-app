/**
 * IP klien di belakang reverse proxy (nginx di host yang sama). `CF-Connecting-IP` hanya dipercaya bila koneksi TCP
 * datang dari proxy tepercaya; dari peer lain header itu dapat dipalsukan sehingga diabaikan (pembatas percobaan
 * salah tidak boleh bisa dikelabui dengan header acak).
 */
export type TrustedProxy = 'loopback' | 'any';

/** Panjang maksimum alamat IPv6 tekstual (`0000:...:255.255.255.255`). */
const MAX_IP_LENGTH = 45;
const IP_CHARS = /^[0-9a-fA-F:.]+$/;
/** IPv4 yang dipetakan ke IPv6 (`::ffff:203.0.113.7`), bentuk yang dilaporkan Bun untuk soket dual-stack. */
const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

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
 * IP klien untuk pembatas dan log: nilai `CF-Connecting-IP` HANYA bila peer adalah proxy tepercaya (loopback;
 * atau siapa pun bila `trustedProxy` = `any`, untuk penempatan di balik proxy lain), selain itu alamat peer.
 * Header yang bukan alamat IP dianggap tidak ada. Peer tak dikenal menghasilkan `unknown`.
 */
export function clientIp(
  request: Request,
  peerAddress: string,
  trustedProxy: TrustedProxy = 'loopback',
): string {
  const peer = normalizeAddress(peerAddress);
  if (trustedProxy === 'any' || isLoopbackAddress(peerAddress)) {
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
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}
