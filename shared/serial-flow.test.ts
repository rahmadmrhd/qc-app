import { describe, expect, test } from 'bun:test';
import {
  type ActorModules,
  availableActions,
  type FlowRow,
  resolveAction,
  SERIAL_FLOW,
  SERVICE_STATUSES,
  sendLegOf,
} from './serial-flow';
import {
  SERIAL_ACTIONS,
  SERIAL_CUSTODIES,
  SERIAL_STATUSES,
  type SerialAction,
  type SerialCustody,
  type SerialStatus,
  type ServiceDiagnosisStage,
} from './serials';

const QC: ActorModules = { serial: true, serialservice: false };
const SERVICE: ActorModules = { serial: false, serialservice: true };
const BOTH: ActorModules = { serial: true, serialservice: true };
const NONE: ActorModules = { serial: false, serialservice: false };

interface Positive {
  n: number;
  action: SerialAction;
  result?: 'pass' | 'fail';
  stage?: ServiceDiagnosisStage;
  status: SerialStatus;
  custody: SerialCustody;
  actor: ActorModules;
  toStatus: SerialStatus | 'same';
  toCustody: SerialCustody | 'same';
  caseEffect: FlowRow['caseEffect'];
  team: 'qc' | 'service';
  leg?: FlowRow['leg'];
}

/** Satu kasus positif per baris tabel rencana (nomor = baris tabel). */
const POSITIVES: Positive[] = [
  {
    n: 1,
    action: 'report_failure',
    status: 'good',
    custody: 'qc',
    actor: QC,
    toStatus: 'reported',
    toCustody: 'qc',
    caseEffect: 'open',
    team: 'qc',
  },
  {
    n: 2,
    action: 'send',
    status: 'reported',
    custody: 'qc',
    actor: QC,
    toStatus: 'at_service',
    toCustody: 'transit',
    caseEffect: null,
    team: 'qc',
    leg: 'to_service',
  },
  {
    n: 3,
    action: 'receive',
    status: 'at_service',
    custody: 'transit',
    actor: SERVICE,
    toStatus: 'same',
    toCustody: 'service',
    caseEffect: null,
    team: 'service',
    leg: 'at_service',
  },
  {
    n: 4,
    action: 'service_diagnosis',
    stage: 'diagnosis',
    status: 'at_service',
    custody: 'transit',
    actor: SERVICE,
    toStatus: 'diagnosis',
    toCustody: 'service',
    caseEffect: null,
    team: 'service',
  },
  {
    n: 4,
    action: 'service_diagnosis',
    stage: 'diagnosis',
    status: 'service_repair',
    custody: 'service',
    actor: SERVICE,
    toStatus: 'diagnosis',
    toCustody: 'service',
    caseEffect: null,
    team: 'service',
  },
  {
    n: 5,
    action: 'service_diagnosis',
    stage: 'repairing',
    status: 'diagnosis',
    custody: 'service',
    actor: SERVICE,
    toStatus: 'service_repair',
    toCustody: 'service',
    caseEffect: null,
    team: 'service',
  },
  {
    n: 6,
    action: 'service_diagnosis',
    stage: 'done',
    status: 'service_repair',
    custody: 'service',
    actor: SERVICE,
    toStatus: 'recheck',
    toCustody: 'transit',
    caseEffect: null,
    team: 'service',
  },
  {
    n: 6,
    action: 'service_diagnosis',
    stage: 'done',
    status: 'at_service',
    custody: 'transit',
    actor: SERVICE,
    toStatus: 'recheck',
    toCustody: 'transit',
    caseEffect: null,
    team: 'service',
  },
  {
    n: 7,
    action: 'declare_broken',
    status: 'diagnosis',
    custody: 'service',
    actor: SERVICE,
    toStatus: 'broken',
    toCustody: 'service',
    caseEffect: 'close_broken',
    team: 'service',
  },
  {
    n: 7,
    action: 'declare_broken',
    status: 'at_service',
    custody: 'transit',
    actor: SERVICE,
    toStatus: 'broken',
    toCustody: 'service',
    caseEffect: 'close_broken',
    team: 'service',
  },
  {
    n: 8,
    action: 'receive',
    status: 'recheck',
    custody: 'transit',
    actor: QC,
    toStatus: 'same',
    toCustody: 'qc',
    caseEffect: null,
    team: 'qc',
    leg: 'at_qc',
  },
  {
    n: 9,
    action: 'recheck_pass',
    status: 'reported',
    custody: 'qc',
    actor: QC,
    toStatus: 'good',
    toCustody: 'qc',
    caseEffect: 'close_good',
    team: 'qc',
  },
  {
    n: 9,
    action: 'recheck_pass',
    status: 'recheck',
    custody: 'transit',
    actor: QC,
    toStatus: 'good',
    toCustody: 'qc',
    caseEffect: 'close_good',
    team: 'qc',
  },
  {
    n: 10,
    action: 'recheck_fail',
    status: 'reported',
    custody: 'qc',
    actor: QC,
    toStatus: 'reported',
    toCustody: 'qc',
    caseEffect: null,
    team: 'qc',
  },
  {
    n: 10,
    action: 'recheck_fail',
    status: 'recheck',
    custody: 'qc',
    actor: QC,
    toStatus: 'reported',
    toCustody: 'qc',
    caseEffect: null,
    team: 'qc',
  },
  {
    n: 11,
    action: 'recheck',
    result: 'pass',
    status: 'good',
    custody: 'qc',
    actor: QC,
    toStatus: 'good',
    toCustody: 'qc',
    caseEffect: null,
    team: 'qc',
  },
  {
    n: 12,
    action: 'recheck',
    result: 'fail',
    status: 'good',
    custody: 'qc',
    actor: QC,
    toStatus: 'reported',
    toCustody: 'qc',
    caseEffect: 'open',
    team: 'qc',
  },
  {
    n: 13,
    action: 'note',
    status: 'good',
    custody: 'qc',
    actor: QC,
    toStatus: 'same',
    toCustody: 'same',
    caseEffect: null,
    team: 'qc',
  },
  {
    n: 13,
    action: 'note',
    status: 'broken',
    custody: 'service',
    actor: QC,
    toStatus: 'same',
    toCustody: 'same',
    caseEffect: null,
    team: 'qc',
  },
  {
    n: 14,
    action: 'note',
    status: 'at_service',
    custody: 'transit',
    actor: SERVICE,
    toStatus: 'same',
    toCustody: 'same',
    caseEffect: null,
    team: 'service',
  },
  {
    n: 14,
    action: 'note',
    status: 'diagnosis',
    custody: 'service',
    actor: SERVICE,
    toStatus: 'same',
    toCustody: 'same',
    caseEffect: null,
    team: 'service',
  },
];

describe('SERIAL_FLOW', () => {
  test('tepat 14 baris', () => {
    expect(SERIAL_FLOW).toHaveLength(14);
  });

  test('semua baris punya jalur dari status asal: setiap baris punya kasus positif yang menghasilkannya', () => {
    const covered = new Set<number>();
    for (const p of POSITIVES) {
      const resolved = resolveAction(
        p.action,
        { status: p.status, custody: p.custody },
        p.actor,
        p.result,
        p.stage,
      );
      if (!('row' in resolved)) throw new Error(`baris ${p.n} ditolak: ${resolved.error}`);
      const { row } = resolved;
      expect(row.toStatus).toBe(p.toStatus);
      expect(row.toCustody).toBe(p.toCustody);
      expect(row.caseEffect).toBe(p.caseEffect);
      expect(row.team).toBe(p.team);
      expect(row.leg).toBe(p.leg);
      expect(SERIAL_FLOW.indexOf(row) + 1).toBe(p.n);
      covered.add(p.n);
    }
    expect([...covered].sort((a, b) => a - b)).toEqual(SERIAL_FLOW.map((_, i) => i + 1));
  });

  test('bidang wajib dan stiker sesuai tabel', () => {
    const requiredOf = (index: number) => SERIAL_FLOW[index - 1]?.required;
    expect(requiredOf(1)).toEqual(['message']);
    expect(requiredOf(2)).toEqual([]);
    expect(requiredOf(7)).toEqual(['message']);
    expect(requiredOf(10)).toEqual(['message']);
    expect(requiredOf(12)).toEqual(['message']);
    expect(requiredOf(13)).toEqual(['message']);
    expect(requiredOf(14)).toEqual(['message']);
    expect(requiredOf(9)).toEqual([]);
    const withStickers = SERIAL_FLOW.map((row, i) => (row.allowStickers ? i + 1 : 0)).filter(
      Boolean,
    );
    expect(withStickers).toEqual([9, 10, 11, 12]);
  });

  test('SERVICE_STATUSES memuat diagnosis', () => {
    expect(SERVICE_STATUSES).toEqual(['at_service', 'diagnosis', 'service_repair']);
  });
});

describe('resolveAction: keadaan di luar tabel = state', () => {
  // Daftar tulisan tangan, bebas dari tabel yang diuji. Format: aksi|hasil|status|custody (tahap tak diuji di sini).
  const SERVICE_STATE = [
    ['at_service', 'transit'],
    ['at_service', 'service'],
    ['diagnosis', 'transit'],
    ['diagnosis', 'service'],
    ['service_repair', 'transit'],
    ['service_repair', 'service'],
  ] as const;
  const VALID = new Set<string>([
    'report_failure|-|good|qc',
    'send|-|reported|qc',
    'receive|-|at_service|transit',
    'receive|-|recheck|transit',
    'recheck_pass|-|reported|qc',
    'recheck_pass|-|reported|transit',
    'recheck_pass|-|recheck|qc',
    'recheck_pass|-|recheck|transit',
    'recheck_fail|-|reported|qc',
    'recheck_fail|-|reported|transit',
    'recheck_fail|-|recheck|qc',
    'recheck_fail|-|recheck|transit',
    'recheck|pass|good|qc',
    'recheck|fail|good|qc',
    ...SERVICE_STATE.flatMap(([status, custody]) => [
      `service_diagnosis|-|${status}|${custody}`,
      `declare_broken|-|${status}|${custody}`,
    ]),
    ...SERIAL_STATUSES.flatMap((status) =>
      SERIAL_CUSTODIES.map((custody) => `note|-|${status}|${custody}`),
    ),
  ]);

  test('SETIAP pasangan (aksi x 7 status x 3 custody) di luar tabel = state, di dalamnya diterima (pelaku punya kedua modul)', () => {
    let checked = 0;
    for (const action of SERIAL_ACTIONS) {
      const results: ('pass' | 'fail' | undefined)[] =
        action === 'recheck' ? ['pass', 'fail'] : [undefined];
      for (const result of results) {
        for (const status of SERIAL_STATUSES) {
          for (const custody of SERIAL_CUSTODIES) {
            const resolved = resolveAction(action, { status, custody }, BOTH, result);
            const key = `${action}|${result ?? '-'}|${status}|${custody}`;
            if (VALID.has(key)) expect('row' in resolved).toBe(true);
            else expect(resolved).toEqual({ error: 'state' });
            checked++;
          }
        }
      }
    }
    expect(checked).toBe((SERIAL_ACTIONS.length + 1) * 7 * 3);
  });

  test('tahap diagnosis menentukan baris; tanpa tahap = baris pertama', () => {
    const state = { status: 'at_service', custody: 'service' } as const;
    for (const [stage, toStatus] of [
      ['diagnosis', 'diagnosis'],
      ['repairing', 'service_repair'],
      ['done', 'recheck'],
    ] as const) {
      const resolved = resolveAction('service_diagnosis', state, SERVICE, undefined, stage);
      expect('row' in resolved && resolved.row.toStatus).toBe(toStatus);
    }
    const none = resolveAction('service_diagnosis', state, SERVICE);
    expect('row' in none && none.row.stage).toBe('diagnosis');
  });

  test('recheck tanpa result = pass', () => {
    const resolved = resolveAction('recheck', { status: 'good', custody: 'qc' }, QC);
    expect('row' in resolved && resolved.row.result).toBe('pass');
  });

  test('broken final: hanya note', () => {
    for (const action of SERIAL_ACTIONS) {
      for (const custody of SERIAL_CUSTODIES) {
        const resolved = resolveAction(action, { status: 'broken', custody }, BOTH);
        if (action === 'note') expect('row' in resolved).toBe(true);
        else expect(resolved).toEqual({ error: 'state' });
      }
    }
  });

  test('sendLegOf menurut status', () => {
    expect(sendLegOf('send', 'reported')).toBe('to_service');
    expect(sendLegOf('receive', 'at_service')).toBe('at_service');
    expect(sendLegOf('receive', 'recheck')).toBe('at_qc');
    expect(sendLegOf('send', 'good')).toBeNull();
  });
});

describe('resolveAction: izin', () => {
  test('serial-saja pada baris servis = permission', () => {
    expect(resolveAction('receive', { status: 'at_service', custody: 'transit' }, QC)).toEqual({
      error: 'permission',
    });
    expect(
      resolveAction('service_diagnosis', { status: 'at_service', custody: 'service' }, QC),
    ).toEqual({ error: 'permission' });
    expect(
      resolveAction('declare_broken', { status: 'service_repair', custody: 'service' }, QC),
    ).toEqual({ error: 'permission' });
  });

  test('QC tidak melihat aksi servis (FORBIDDEN di server)', () => {
    expect(
      availableActions({ status: 'at_service', custody: 'transit' }, QC).map((row) => row.action),
    ).toEqual(['note']);
  });

  test('serialservice-saja pada baris QC = permission', () => {
    const cases: [SerialAction, SerialStatus, SerialCustody, ('pass' | 'fail')?][] = [
      ['report_failure', 'good', 'qc'],
      ['send', 'reported', 'qc'],
      ['receive', 'recheck', 'transit'],
      ['recheck_pass', 'recheck', 'qc'],
      ['recheck_fail', 'reported', 'qc'],
      ['recheck', 'good', 'qc', 'pass'],
      ['recheck', 'good', 'qc', 'fail'],
    ];
    for (const [action, status, custody, result] of cases) {
      expect(resolveAction(action, { status, custody }, SERVICE, result)).toEqual({
        error: 'permission',
      });
    }
  });

  test('serialservice note pada good/reported/recheck/broken = permission', () => {
    for (const status of ['good', 'reported', 'recheck', 'broken'] as const) {
      expect(resolveAction('note', { status, custody: 'qc' }, SERVICE)).toEqual({
        error: 'permission',
      });
    }
  });

  test('tanpa modul sama sekali = permission untuk aksi yang ada, state untuk yang tak ada', () => {
    expect(resolveAction('note', { status: 'good', custody: 'qc' }, NONE)).toEqual({
      error: 'permission',
    });
    expect(resolveAction('declare_broken', { status: 'good', custody: 'qc' }, NONE)).toEqual({
      error: 'state',
    });
  });

  test('pemegang kedua modul: note servis = tim service, note QC = tim qc', () => {
    const at = resolveAction('note', { status: 'at_service', custody: 'service' }, BOTH);
    expect('row' in at && at.row.team).toBe('service');
    expect('row' in at && at.row.module).toBe('serialservice');
    const reported = resolveAction('note', { status: 'reported', custody: 'qc' }, BOTH);
    expect('row' in reported && reported.row.team).toBe('qc');
    const repair = resolveAction('note', { status: 'service_repair', custody: 'service' }, QC);
    expect('row' in repair && repair.row.team).toBe('qc');
  });

  test('pemegang kedua modul memenuhi baris mana pun yang modulnya ia punya', () => {
    for (const p of POSITIVES) {
      const resolved = resolveAction(
        p.action,
        { status: p.status, custody: p.custody },
        BOTH,
        p.result,
        p.stage,
      );
      expect('row' in resolved).toBe(true);
    }
  });
});

describe('availableActions', () => {
  const names = (rows: FlowRow[]) => rows.map((row) => row.action);

  test('good/qc untuk serial-saja: Lapor rusak, Cek ulang, Catatan', () => {
    expect(names(availableActions({ status: 'good', custody: 'qc' }, QC))).toEqual([
      'note',
      'recheck',
      'report_failure',
    ]);
  });

  test('reported: kirim ke servis, cek ulang lolos/gagal, catatan', () => {
    expect(names(availableActions({ status: 'reported', custody: 'qc' }, QC))).toEqual([
      'note',
      'send',
      'recheck_pass',
      'recheck_fail',
    ]);
  });

  test('servis: di servis (transit) = terima, diagnosis, rusak, catatan', () => {
    expect(names(availableActions({ status: 'good', custody: 'qc' }, SERVICE))).toEqual([]);
    expect(names(availableActions({ status: 'at_service', custody: 'transit' }, SERVICE))).toEqual([
      'note',
      'receive',
      'service_diagnosis',
      'declare_broken',
    ]);
    expect(
      names(availableActions({ status: 'service_repair', custody: 'service' }, SERVICE)),
    ).toEqual(['note', 'service_diagnosis', 'declare_broken']);
  });

  test('recheck/transit di QC: terima atau cek ulang langsung', () => {
    expect(names(availableActions({ status: 'recheck', custody: 'transit' }, QC))).toEqual([
      'note',
      'receive',
      'recheck_pass',
      'recheck_fail',
    ]);
  });

  test('broken hanya note; tanpa duplikat aksi', () => {
    expect(names(availableActions({ status: 'broken', custody: 'service' }, BOTH))).toEqual([
      'note',
    ]);
    for (const status of SERIAL_STATUSES) {
      for (const custody of SERIAL_CUSTODIES) {
        const list = names(availableActions({ status, custody }, BOTH));
        expect(new Set(list).size).toBe(list.length);
      }
    }
  });
});
