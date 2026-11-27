import type { WarehouseSerialDto } from '@shared/contract';
import { CUSTODY_LABEL, STATUS_LABEL } from '@/modules/serial/lib/labels';
import { type MissingField, missingDefaults } from './draft';
import { type RowWarning, snapshotWarnings } from './warnings';

export interface ScanState {
  /** Item form saat ini; kosong = belum dipilih. */
  itemId: string;
  /** Serial (ternormalisasi) yang sudah ada di draf sesi ini. */
  draftSerials: { has(serial: string): boolean };
  draftCount: number;
  filters: { buId: string; locationId: string; testDate: string };
  /** BU form (chip BU atau BU SO) untuk warning BU. */
  formBuId: string;
  /** Tanggal uji acuan draf (lihat `referenceTestDate`). */
  referenceTestDate: string;
}

export type ScanKind =
  | 'select'
  | 'confirm_switch_item'
  | 'error_type'
  | 'not_eligible'
  | 'new_draft'
  | 'missing_defaults'
  | 'duplicate_in_session';

export interface ScanOutcome {
  kind: ScanKind;
  warnings: RowWarning[];
  /** Hanya `missing_defaults`. */
  missing?: MissingField[];
}

/** Boleh dipilih: status Lolos dan posisi QC (kondisi "tidak terhapus" dijamin server: terhapus = tidak ditemukan). */
export function isEligible(serial: Pick<WarehouseSerialDto, 'status' | 'custody'>): boolean {
  return serial.status === 'good' && serial.custody === 'qc';
}

/**
 * Hasil scan menurut tabel spek 5.4. `found` = serial yang sudah ada (lintas BU), `null` = belum ada atau terhapus.
 * "Sudah ada di SO ini" TIDAK dinilai di sini: SO belum diketahui saat scan (dinilai di dialog konfirmasi).
 */
export function classifyScan(
  state: ScanState,
  found: WarehouseSerialDto | null,
  normalized: string,
): ScanOutcome {
  if (state.draftSerials.has(normalized)) return { kind: 'duplicate_in_session', warnings: [] };
  if (found === null) {
    const missing = missingDefaults(state.itemId, {
      ...state.filters,
      hideRecorded: true,
    });
    if (missing.length > 0) return { kind: 'missing_defaults', warnings: [], missing };
    return { kind: 'new_draft', warnings: [] };
  }
  if (!isEligible(found)) return { kind: 'not_eligible', warnings: [] };
  if (state.itemId !== '' && found.itemId !== state.itemId) {
    return {
      kind: state.draftCount === 0 ? 'confirm_switch_item' : 'error_type',
      warnings: [],
    };
  }
  return {
    kind: 'select',
    warnings: snapshotWarnings(found, {
      formBuId: state.formBuId,
      referenceTestDate: state.referenceTestDate,
    }),
  };
}

/** Teks umpan balik satu baris untuk hasil scan (nada/warna ditentukan pemanggil). */
export function scanMessage(
  outcome: ScanOutcome,
  found: WarehouseSerialDto | null,
  serial: string,
): string {
  switch (outcome.kind) {
    case 'select':
      return outcome.warnings.some((warning) => warning !== 'prior_other_bu')
        ? `${serial} dipilih, ada peringatan`
        : `${serial} dipilih`;
    case 'new_draft':
      return `${serial} belum ada: jadi draf baru`;
    case 'duplicate_in_session':
      return `${serial} sudah ada di pilihan`;
    case 'not_eligible':
      return found
        ? `${serial} tidak dapat dipilih: status ${STATUS_LABEL[found.status]}, posisi ${CUSTODY_LABEL[found.custody]} (harus Lolos di QC)`
        : `${serial} tidak dapat dipilih`;
    case 'error_type':
      return `${serial} beda Tipe`;
    case 'confirm_switch_item':
      return `${serial} beda Tipe dari Item`;
    case 'missing_defaults':
      return `${serial} ditahan`;
  }
}
