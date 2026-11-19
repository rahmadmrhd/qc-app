// Pembaca DHCP lease router jump (legacy L4.3). Murni: hanya mengurai teks keluaran RouterOS.

import type { Lease } from './types';

/** Perintah RouterOS persis untuk membaca lease aktif (`terse` = satu baris per lease). */
export const LEASE_COMMAND =
  '/ip dhcp-server lease print terse proplist=address,mac-address,status where status=bound';

/**
 * MAC ke bentuk `AA:BB:CC:DD:EE:FF`. Menerima pemisah `:`, `-`, `.` atau tanpa pemisah; selain 12 heksadesimal = `null`.
 */
export function normalizeMac(raw: string): string | null {
  const compact = raw.trim().replace(/[:\-.]/g, '');
  if (!/^[0-9A-Fa-f]{12}$/.test(compact)) return null;
  const upper = compact.toUpperCase();
  return upper.match(/.{2}/g)?.join(':') ?? null;
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** Nilai `kunci=...` di baris terse (kunci harus didahului awal baris atau spasi, agar `mac-address=` tak terbaca `address=`). */
function field(line: string, key: string): string | null {
  const m = new RegExp(`(?:^|\\s)${key}=(\\S*)`).exec(line);
  return m ? (m[1] ?? '') : null;
}

/**
 * Mengurai keluaran `LEASE_COMMAND`. Baris tanpa IP/MAC sah atau berstatus selain `bound` dibuang; keluaran aneh = `[]`
 * (tidak melempar). MAC kembar: baris terakhir yang dipakai.
 */
export function parseDhcpLeases(output: string): Lease[] {
  const byMac = new Map<string, Lease>();
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const ip = field(line, 'address');
    if (!ip || !IPV4.test(ip)) continue;
    const rawMac = field(line, 'mac-address');
    const mac = rawMac ? normalizeMac(rawMac) : null;
    if (!mac) continue;
    const status = field(line, 'status');
    if (status !== null && status !== 'bound') continue;
    byMac.set(mac, { ip, mac });
  }
  return [...byMac.values()];
}
