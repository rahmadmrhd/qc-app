import { type ActorModules, availableActions, type SerialFlowState } from '@shared/serial-flow';
import { flowRowLabel } from '../lib/labels';

/**
 * Jenis dialog aksi alur. Beberapa aksi tabel transisi digabung jadi satu dialog: Diagnosis memuat tahap diagnosis,
 * diperbaiki, selesai, dan Rusak; Cek ulang memuat hasil lolos atau tidak lolos (rancangan laporan rusak §4.4).
 */
export type ActKind = 'report' | 'send' | 'receive' | 'diagnosis' | 'recheck' | 'stickers' | 'note';

export interface ActButtonSpec {
  kind: ActKind;
  label: string;
}

const KIND_OF = {
  report_failure: 'report',
  send: 'send',
  receive: 'receive',
  service_diagnosis: 'diagnosis',
  declare_broken: 'diagnosis',
  recheck: 'recheck',
  recheck_pass: 'recheck',
  recheck_fail: 'recheck',
  apply_stickers: 'stickers',
  note: 'note',
} as const;

/** Urutan entri aksi di header (grup Update: aksi alur dulu, Catatan terakhir) dan dialog; Tempel stiker sesudah Cek ulang. */
const KIND_ORDER: readonly ActKind[] = [
  'report',
  'send',
  'receive',
  'diagnosis',
  'recheck',
  'stickers',
  'note',
];

const KIND_LABEL: Record<ActKind, string> = {
  report: 'Lapor rusak',
  send: 'Kirim ke servis',
  receive: 'Terima',
  diagnosis: 'Diagnosis',
  recheck: 'Cek ulang',
  stickers: 'Tempel stiker',
  note: 'Catatan',
};

/** Tombol yang tersedia (satu per jenis dialog) menurut tabel transisi: sumber yang sama dengan server. */
export function actButtonSpecs(state: SerialFlowState, actor: ActorModules): ActButtonSpec[] {
  const rows = availableActions(state, actor);
  const kinds = new Set(rows.map((row) => KIND_OF[row.action]));
  return KIND_ORDER.filter((kind) => kinds.has(kind)).map((kind) => {
    const receive = rows.find((row) => row.action === 'receive');
    return {
      kind,
      label: kind === 'receive' && receive ? flowRowLabel(receive) : KIND_LABEL[kind],
    };
  });
}

/**
 * Lapor rusak tersedia menurut tabel transisi. Tombolnya memakai `ACTIONS.reportDamage` dan ada di header View Serial
 * di sebelah Ubah data (`useSerialActions`), serta sebagai aksi baris di daftar.
 */
export function canReportDamage(state: SerialFlowState, actor: ActorModules): boolean {
  return actButtonSpecs(state, actor).some((spec) => spec.kind === 'report');
}
