/**
 * Status koneksi stream SSE lonceng (satu per tab). Dipisah dari `stream.ts` agar `queries.ts` dapat membacanya
 * tanpa impor melingkar: selama stream tersambung polling melambat menjadi jaring pengaman, saat putus polling
 * kembali cepat (10 dtk).
 */

let connected = false;

export function isNotificationStreamConnected(): boolean {
  return connected;
}

export function setNotificationStreamConnected(value: boolean): void {
  connected = value;
}
