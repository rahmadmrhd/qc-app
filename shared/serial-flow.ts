import {
  SERIAL_ACTIONS,
  type SerialAction,
  type SerialCustody,
  type SerialStatus,
  type SerialTeam,
  type ServiceDiagnosisStage,
} from './serials';

/**
 * Mesin transisi alur laporan rusak dan servis (rancangan 2026-11-14 §4.1), SATU sumber: server menegakkannya di
 * `serials.act` dan web memakainya untuk menampilkan aksi yang tersedia. Murni (tanpa API runtime/DOM). Tabel adalah
 * data, bukan rantai `if`.
 */

/** Jenis pengiriman/penerimaan; diturunkan dari status serial, tidak dikirim klien. */
export type SendLeg = 'to_service' | 'at_service' | 'at_qc';
export type CaseEffect = 'open' | 'close_good' | 'close_broken' | null;
export type FlowField = 'message' | 'toLocationId';

export interface FlowRow {
  action: SerialAction;
  /** Hanya `send`/`receive`. */
  leg?: SendLeg;
  /** Hanya `recheck`. */
  result?: 'pass' | 'fail';
  /** Hanya `service_diagnosis`; baris tanpa `stage` cocok untuk tahap apa pun. */
  stage?: ServiceDiagnosisStage;
  from: readonly SerialStatus[];
  custody: readonly SerialCustody[] | 'any';
  toStatus: SerialStatus | 'same';
  toCustody: SerialCustody | 'same';
  caseEffect: CaseEffect;
  /** Field yang wajib berisi; yang lain opsional. */
  required: readonly FlowField[];
  /** Penambahan stiker diizinkan (hanya cek ulang, rancangan §4.2). */
  allowStickers: boolean;
  module: 'serial' | 'serialservice';
  team: SerialTeam;
}

const ALL_STATUSES: readonly SerialStatus[] = [
  'good',
  'reported',
  'at_service',
  'diagnosis',
  'service_repair',
  'recheck',
  'broken',
];

/** Status yang ditangani tim servis (`serialservice` hanya menindak serial berstatus ini). */
export const SERVICE_STATUSES: readonly SerialStatus[] = [
  'at_service',
  'diagnosis',
  'service_repair',
];

const SERVICE_CUSTODIES: readonly SerialCustody[] = ['transit', 'service'];

export const SERIAL_FLOW: readonly FlowRow[] = [
  // 1: Lapor rusak
  {
    action: 'report_failure',
    from: ['good'],
    custody: ['qc'],
    toStatus: 'reported',
    toCustody: 'qc',
    caseEffect: 'open',
    required: ['message'],
    allowStickers: false,
    module: 'serial',
    team: 'qc',
  },
  // 2: Kirim ke servis (lokasi tujuan opsional; divalidasi server terhadap konfigurasi lokasi servis)
  {
    action: 'send',
    leg: 'to_service',
    from: ['reported'],
    custody: ['qc'],
    toStatus: 'at_service',
    toCustody: 'transit',
    caseEffect: null,
    required: [],
    allowStickers: false,
    module: 'serial',
    team: 'qc',
  },
  // 3: Terima (servis)
  {
    action: 'receive',
    leg: 'at_service',
    from: ['at_service'],
    custody: ['transit'],
    toStatus: 'same',
    toCustody: 'service',
    caseEffect: null,
    required: [],
    allowStickers: false,
    module: 'serialservice',
    team: 'service',
  },
  // 4: Diagnosis (custody transit = diterima otomatis oleh server)
  {
    action: 'service_diagnosis',
    stage: 'diagnosis',
    from: SERVICE_STATUSES,
    custody: SERVICE_CUSTODIES,
    toStatus: 'diagnosis',
    toCustody: 'service',
    caseEffect: null,
    required: [],
    allowStickers: false,
    module: 'serialservice',
    team: 'service',
  },
  // 5: Sedang diperbaiki
  {
    action: 'service_diagnosis',
    stage: 'repairing',
    from: SERVICE_STATUSES,
    custody: SERVICE_CUSTODIES,
    toStatus: 'service_repair',
    toCustody: 'service',
    caseEffect: null,
    required: [],
    allowStickers: false,
    module: 'serialservice',
    team: 'service',
  },
  // 6: Selesai -> kembali ke QC untuk cek ulang
  {
    action: 'service_diagnosis',
    stage: 'done',
    from: SERVICE_STATUSES,
    custody: SERVICE_CUSTODIES,
    toStatus: 'recheck',
    toCustody: 'transit',
    caseEffect: null,
    required: [],
    allowStickers: false,
    module: 'serialservice',
    team: 'service',
  },
  // 7: Rusak (final), menutup laporan
  {
    action: 'declare_broken',
    from: SERVICE_STATUSES,
    custody: SERVICE_CUSTODIES,
    toStatus: 'broken',
    toCustody: 'service',
    caseEffect: 'close_broken',
    required: ['message'],
    allowStickers: false,
    module: 'serialservice',
    team: 'service',
  },
  // 8: Terima (QC)
  {
    action: 'receive',
    leg: 'at_qc',
    from: ['recheck'],
    custody: ['transit'],
    toStatus: 'same',
    toCustody: 'qc',
    caseEffect: null,
    required: [],
    allowStickers: false,
    module: 'serial',
    team: 'qc',
  },
  // 9: Cek ulang lolos (dari transit = diterima otomatis)
  {
    action: 'recheck_pass',
    from: ['reported', 'recheck'],
    custody: ['qc', 'transit'],
    toStatus: 'good',
    toCustody: 'qc',
    caseEffect: 'close_good',
    required: [],
    allowStickers: true,
    module: 'serial',
    team: 'qc',
  },
  // 10: Cek ulang gagal pada laporan yang sudah terbuka (laporan tetap terbuka)
  {
    action: 'recheck_fail',
    from: ['reported', 'recheck'],
    custody: ['qc', 'transit'],
    toStatus: 'reported',
    toCustody: 'qc',
    caseEffect: null,
    required: ['message'],
    allowStickers: true,
    module: 'serial',
    team: 'qc',
  },
  // 11: Cek ulang lolos pada serial Lolos
  {
    action: 'recheck',
    result: 'pass',
    from: ['good'],
    custody: ['qc'],
    toStatus: 'good',
    toCustody: 'qc',
    caseEffect: null,
    required: [],
    allowStickers: true,
    module: 'serial',
    team: 'qc',
  },
  // 12: Cek ulang gagal pada serial Lolos membuka laporan
  {
    action: 'recheck',
    result: 'fail',
    from: ['good'],
    custody: ['qc'],
    toStatus: 'reported',
    toCustody: 'qc',
    caseEffect: 'open',
    required: ['message'],
    allowStickers: true,
    module: 'serial',
    team: 'qc',
  },
  // 13: Catatan oleh QC (semua status, termasuk Rusak)
  {
    action: 'note',
    from: ALL_STATUSES,
    custody: 'any',
    toStatus: 'same',
    toCustody: 'same',
    caseEffect: null,
    required: ['message'],
    allowStickers: false,
    module: 'serial',
    team: 'qc',
  },
  // 14: Catatan oleh tim servis (status servis)
  {
    action: 'note',
    from: SERVICE_STATUSES,
    custody: 'any',
    toStatus: 'same',
    toCustody: 'same',
    caseEffect: null,
    required: ['message'],
    allowStickers: false,
    module: 'serialservice',
    team: 'service',
  },
];

export interface SerialFlowState {
  status: SerialStatus;
  custody: SerialCustody;
}

/** Modul yang dipegang pelaku pada level `edit` di BU serial. */
export interface ActorModules {
  serial: boolean;
  serialservice: boolean;
}

/** Jenis pengiriman/penerimaan menurut status serial (klien tidak mengirimnya); `null` bila tak ada baris. */
export function sendLegOf(action: 'send' | 'receive', status: SerialStatus): SendLeg | null {
  const row = SERIAL_FLOW.find((entry) => entry.action === action && entry.from.includes(status));
  return row?.leg ?? null;
}

function stateMatches(row: FlowRow, state: SerialFlowState): boolean {
  return (
    row.from.includes(state.status) &&
    (row.custody === 'any' || row.custody.includes(state.custody))
  );
}

/** Dari beberapa baris yang cocok (hanya `note`: baris 13/14), pilih yang modulnya dimiliki; servis diutamakan di status servis. */
function pickOwned(
  rows: readonly FlowRow[],
  actor: ActorModules,
  status: SerialStatus,
): FlowRow | null {
  const owned = rows.filter((row) => actor[row.module]);
  if (owned.length === 0) return null;
  if (owned.length > 1 && SERVICE_STATUSES.includes(status)) {
    return owned.find((row) => row.module === 'serialservice') ?? owned[0] ?? null;
  }
  return owned[0] ?? null;
}

/**
 * Baris tabel untuk (aksi, keadaan serial, pelaku). `state` = tidak ada baris untuk aksi pada keadaan itu (`CONFLICT`);
 * `permission` = ada baris tetapi tak satu pun modulnya dimiliki pelaku (`FORBIDDEN`). `result` hanya dibaca untuk
 * `recheck` (bawaan `pass`); `stage` hanya untuk `service_diagnosis` (tanpa `stage`: baris pertama yang cocok).
 */
export function resolveAction(
  action: SerialAction,
  state: SerialFlowState,
  actor: ActorModules,
  result?: 'pass' | 'fail',
  stage?: ServiceDiagnosisStage,
): { row: FlowRow } | { error: 'state' | 'permission' } {
  const wanted = action === 'recheck' ? (result ?? 'pass') : undefined;
  const matching = SERIAL_FLOW.filter(
    (row) =>
      row.action === action &&
      (wanted === undefined || row.result === wanted) &&
      (action !== 'service_diagnosis' || stage === undefined || row.stage === stage) &&
      stateMatches(row, state),
  );
  if (matching.length === 0) return { error: 'state' };
  const row = pickOwned(matching, actor, state.status);
  return row ? { row } : { error: 'permission' };
}

/**
 * Aksi yang tersedia bagi pelaku pada keadaan itu, tanpa duplikat aksi (`recheck` memakai baris `pass`,
 * `service_diagnosis` baris pertama, `note` baris yang dipilih `resolveAction`). Urut menurut `SERIAL_ACTIONS`.
 */
export function availableActions(state: SerialFlowState, actor: ActorModules): FlowRow[] {
  const rows: FlowRow[] = [];
  for (const action of SERIAL_ACTIONS) {
    const resolved = resolveAction(action, state, actor);
    if ('row' in resolved) rows.push(resolved.row);
  }
  return rows;
}
