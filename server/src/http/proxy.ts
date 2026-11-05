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
