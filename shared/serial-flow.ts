import {
  SERIAL_ACTIONS,
  type SerialAction,
  type SerialCustody,
  type SerialStatus,
  type SerialTeam,
} from './serials';

/**
 * Mesin transisi alur tidak lolos dan servis (spek §5.3), SATU sumber: server menegakkannya di `serials.act` dan web
 * memakainya untuk menampilkan aksi yang tersedia. Murni (tanpa API runtime/DOM). Tabel adalah data, bukan rantai `if`.
 */

/** Jenis pengiriman/penerimaan; diturunkan dari status serial, tidak dikirim klien. */
export type SendLeg = 'to_service' | 'at_service' | 'to_qc' | 'at_qc' | 'between';
export type CaseEffect = 'open' | 'update_damage' | 'close_good' | 'close_broken' | null;
export type FlowField = 'damage' | 'toLocationId' | 'message';

export interface FlowRow {
  action: SerialAction;
  /** Hanya `send`/`receive`. */
  leg?: SendLeg;
  /** Hanya `recheck`. */
  result?: 'pass' | 'fail';
  from: readonly SerialStatus[];
  custody: readonly SerialCustody[] | 'any';
  toStatus: SerialStatus | 'same';
  toCustody: SerialCustody | 'same';
  caseEffect: CaseEffect;
  required: readonly FlowField[];
  /** Kenaikan jumlah stiker diizinkan (hanya cek ulang, spek §3 butir 13). */
  allowStickers: boolean;
  module: 'serial' | 'serialservice';
  team: SerialTeam;
}

const ALL_STATUSES: readonly SerialStatus[] = [
  'good',
  'failed',
  'qc_repair',
  'at_service',
  'service_repair',
  'recheck',
  'broken',
];

export const SERIAL_FLOW: readonly FlowRow[] = [
  // 1
  {
    action: 'report_failure',
    from: ['good'],
    custody: ['qc'],
    toStatus: 'failed',
    toCustody: 'qc',
    caseEffect: 'open',
    required: ['damage'],
    allowStickers: false,
    module: 'serial',
    team: 'qc',
  },
  // 2
  {
    action: 'identify_damage',
    from: ['failed', 'qc_repair'],
    custody: ['qc'],
    toStatus: 'same',
    toCustody: 'same',
    caseEffect: 'update_damage',
    required: ['damage'],
    allowStickers: false,
    module: 'serial',
    team: 'qc',
  },
  // 3
  {
    action: 'attempt_repair',
    from: ['failed'],
    custody: ['qc'],
    toStatus: 'qc_repair',
    toCustody: 'qc',
    caseEffect: null,
    required: [],
    allowStickers: false,
    module: 'serial',
    team: 'qc',
  },
  // 4
  {
    action: 'send',
    leg: 'to_service',
    from: ['failed', 'qc_repair'],
    custody: ['qc'],
    toStatus: 'at_service',
    toCustody: 'transit',
    caseEffect: null,
    required: ['toLocationId'],
    allowStickers: false,
    module: 'serial',
    team: 'qc',
  },
  // 5
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
  // 6
  {
    action: 'service_diagnosis',
    from: ['at_service'],
    custody: ['service'],
    toStatus: 'service_repair',
    toCustody: 'service',
    caseEffect: 'update_damage',
    required: ['damage'],
    allowStickers: false,
    module: 'serialservice',
    team: 'service',
  },
  // 7
  {
    action: 'declare_broken',
    from: ['at_service', 'service_repair'],
    custody: ['service'],
    toStatus: 'broken',
    toCustody: 'same',
    caseEffect: 'close_broken',
    required: [],
    allowStickers: false,
    module: 'serialservice',
    team: 'service',
  },
  // 8
  {
    action: 'send',
    leg: 'to_qc',
    from: ['service_repair'],
    custody: ['service'],
    toStatus: 'recheck',
    toCustody: 'transit',
    caseEffect: null,
    required: ['toLocationId'],
    allowStickers: false,
    module: 'serialservice',
    team: 'service',
  },
  // 9
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
  // 10
  {
    action: 'recheck_pass',
    from: ['recheck', 'qc_repair'],
    custody: ['qc'],
    toStatus: 'good',
    toCustody: 'qc',
    caseEffect: 'close_good',
    required: [],
    allowStickers: true,
    module: 'serial',
    team: 'qc',
  },
  // 11 (kasus tetap terbuka; `damage` opsional diubah oleh aksi, bukan efek kasus wajib)
  {
    action: 'recheck_fail',
    from: ['recheck'],
    custody: ['qc'],
    toStatus: 'failed',
    toCustody: 'qc',
    caseEffect: null,
    required: [],
    allowStickers: true,
    module: 'serial',
    team: 'qc',
  },
  // 12
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
  // 13
  {
    action: 'recheck',
    result: 'fail',
    from: ['good'],
    custody: ['qc'],
    toStatus: 'failed',
    toCustody: 'qc',
    caseEffect: 'open',
    required: ['damage'],
    allowStickers: true,
    module: 'serial',
    team: 'qc',
  },
  // 14
  {
    action: 'send',
    leg: 'between',
    from: ['good'],
    custody: ['qc'],
    toStatus: 'good',
    toCustody: 'transit',
    caseEffect: null,
    required: ['toLocationId'],
    allowStickers: false,
    module: 'serial',
    team: 'qc',
  },
  // 15
  {
    action: 'receive',
    leg: 'between',
    from: ['good'],
    custody: ['transit'],
    toStatus: 'good',
    toCustody: 'qc',
    caseEffect: null,
    required: [],
    allowStickers: false,
    module: 'serial',
    team: 'qc',
  },
  // 16
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
  // 17
  {
    action: 'note',
    from: ['at_service', 'service_repair'],
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

const SERVICE_STATUSES: readonly SerialStatus[] = ['at_service', 'service_repair'];

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

/** Dari beberapa baris yang cocok (hanya `note`: baris 16/17), pilih yang modulnya dimiliki; servis diutamakan di status servis. */
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
 * `recheck` (bawaan `pass`).
 */
export function resolveAction(
  action: SerialAction,
  state: SerialFlowState,
  actor: ActorModules,
  result?: 'pass' | 'fail',
): { row: FlowRow } | { error: 'state' | 'permission' } {
  const wanted = action === 'recheck' ? (result ?? 'pass') : undefined;
  const matching = SERIAL_FLOW.filter(
    (row) =>
      row.action === action &&
      (wanted === undefined || row.result === wanted) &&
      stateMatches(row, state),
  );
  if (matching.length === 0) return { error: 'state' };
  const row = pickOwned(matching, actor, state.status);
  return row ? { row } : { error: 'permission' };
}

/**
 * Aksi yang tersedia bagi pelaku pada keadaan itu, tanpa duplikat aksi (`recheck` memakai baris `pass`, `note` baris
 * yang dipilih `resolveAction`). Urut menurut `SERIAL_ACTIONS`.
 */
export function availableActions(state: SerialFlowState, actor: ActorModules): FlowRow[] {
  const rows: FlowRow[] = [];
  for (const action of SERIAL_ACTIONS) {
    const resolved = resolveAction(action, state, actor);
    if ('row' in resolved) rows.push(resolved.row);
  }
  return rows;
}
