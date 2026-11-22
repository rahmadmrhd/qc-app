import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';

/**
 * Bus event kecil (tahap 5a): kode penerbit (serial) hanya memanggil `statementsFor` dan tidak mengenal isi pendengar
 * (stiker). Pendaftaran pendengar terjadi lewat impor efek-samping `@server/modules/sticker/serial-listener` di
 * `serial/service.ts` (titik perakitan; satu-satunya tempat modul serial menyentuh modul stiker, dan hanya agar
 * pendengar terdaftar). Pendengar TIDAK menulis sendiri: ia menyusun pernyataan SQL yang dipasang penerbit ke dalam `batch()` yang sama, sehingga
 * efek samping (mis. pemotongan stok) atomik dengan penulisan penerbit. Pendengar didaftarkan sekali saat modul
 * dimuat (`onEvent` idempoten per pasangan jenis dan fungsi).
 */
export type StatementListener<P> = (env: Env, payload: P) => DbStatement[] | Promise<DbStatement[]>;

export interface SerialStockPayload {
  serialId: string;
  eventId: string;
  locationId: string;
  picks: readonly { stickerId: string; qty: number }[];
  actor: string;
  now: string;
  /**
   * Hanya `serial.stickers_added`: penerbit yang merangkai banyak serial dalam satu `batch()` menunda penonaktifan
   * otomatis stiker `deprecated` ke akhir batch dan memasangnya sendiri (lihat `serialDeductStmts`).
   */
  deferInactivate?: boolean;
}

/** Serial dinyatakan rusak (5b): pendengar antrean memasang job surel ke `batch()` aksi, atomik dengan aksinya. */
export interface SerialBrokenPayload {
  serialId: string;
  caseId: string;
  eventId: string;
  now: string;
}

/** Akhir batch tempel stiker banyak serial: stiker yang tersentuh diselesaikan sekali (mis. penonaktifan otomatis). */
export interface SerialStickersSettledPayload {
  stickerIds: readonly string[];
  actor: string;
  now: string;
}

export interface EventPayloads {
  'serial.recorded': SerialStockPayload;
  'serial.stickers_added': SerialStockPayload;
  'serial.stickers_settled': SerialStickersSettledPayload;
  'serial.declared_broken': SerialBrokenPayload;
}

type AnyListener = StatementListener<never>;
const listeners = new Map<keyof EventPayloads, AnyListener[]>();

export function onEvent<K extends keyof EventPayloads>(
  type: K,
  listener: StatementListener<EventPayloads[K]>,
): void {
  const list = listeners.get(type) ?? [];
  if (!list.includes(listener as AnyListener)) list.push(listener as AnyListener);
  listeners.set(type, list);
}

/** Pernyataan semua pendengar `type`, berurutan sesuai pendaftaran (tanpa pendengar: `[]`). */
export async function statementsFor<K extends keyof EventPayloads>(
  env: Env,
  type: K,
  payload: EventPayloads[K],
): Promise<DbStatement[]> {
  const statements: DbStatement[] = [];
  for (const listener of listeners.get(type) ?? []) {
    statements.push(...(await (listener as StatementListener<EventPayloads[K]>)(env, payload)));
  }
  return statements;
}

/** Hanya untuk tes: mengosongkan semua pendengar. */
export function resetEventListenersForTest(): void {
  listeners.clear();
}
