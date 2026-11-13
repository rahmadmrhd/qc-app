import { describe, expect, test } from 'bun:test';
import {
  type ActorModules,
  availableActions,
  type FlowRow,
  resolveAction,
  SERIAL_FLOW,
  sendLegOf,
} from './serial-flow';
import {
  SERIAL_ACTIONS,
  SERIAL_CUSTODIES,
  SERIAL_STATUSES,
  type SerialAction,
  type SerialCustody,
  type SerialStatus,
} from './serials';

const QC: ActorModules = { serial: true, serialservice: false };
const SERVICE: ActorModules = { serial: false, serialservice: true };
const BOTH: ActorModules = { serial: true, serialservice: true };
const NONE: ActorModules = { serial: false, serialservice: false };

interface Positive {
  n: number;
  action: SerialAction;
  result?: 'pass' | 'fail';
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
    toStatus: 'failed',
    toCustody: 'qc',
    caseEffect: 'open',
    team: 'qc',
  },
  {
    n: 2,
    action: 'identify_damage',
    status: 'failed',
    custody: 'qc',
    actor: QC,
    toStatus: 'same',
    toCustody: 'same',
    caseEffect: 'update_damage',
    team: 'qc',
  },
  {
    n: 2,
    action: 'identify_damage',
    status: 'qc_repair',
    custody: 'qc',
    actor: QC,
    toStatus: 'same',
    toCustody: 'same',
    caseEffect: 'update_damage',
    team: 'qc',
  },
  {
    n: 3,
    action: 'attempt_repair',
    status: 'failed',
    custody: 'qc',
    actor: QC,
    toStatus: 'qc_repair',
    toCustody: 'qc',
    caseEffect: null,
    team: 'qc',
  },
  {
    n: 4,
    action: 'send',
    status: 'failed',
    custody: 'qc',
    actor: QC,
    toStatus: 'at_service',
    toCustody: 'transit',
    caseEffect: null,
    team: 'qc',
    leg: 'to_service',
  },
  {
    n: 4,
    action: 'send',
    status: 'qc_repair',
    custody: 'qc',
    actor: QC,
    toStatus: 'at_service',
    toCustody: 'transit',
    caseEffect: null,
    team: 'qc',
    leg: 'to_service',
  },
  {
    n: 5,
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
    n: 6,
    action: 'service_diagnosis',
    status: 'at_service',
    custody: 'service',
    actor: SERVICE,
    toStatus: 'service_repair',
    toCustody: 'service',
    caseEffect: 'update_damage',
    team: 'service',
  },
  {
    n: 7,
    action: 'declare_broken',
    status: 'at_service',
    custody: 'service',
    actor: SERVICE,
    toStatus: 'broken',
    toCustody: 'same',
    caseEffect: 'close_broken',
    team: 'service',
  },
  {
    n: 7,
    action: 'declare_broken',
    status: 'service_repair',
    custody: 'service',
    actor: SERVICE,
    toStatus: 'broken',
    toCustody: 'same',
    caseEffect: 'close_broken',
    team: 'service',
  },
  {
    n: 8,
    action: 'send',
    status: 'service_repair',
    custody: 'service',
    actor: SERVICE,
    toStatus: 'recheck',
    toCustody: 'transit',
    caseEffect: null,
    team: 'service',
    leg: 'to_qc',
  },
  {
    n: 9,
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
    n: 10,
    action: 'recheck_pass',
    status: 'recheck',
    custody: 'qc',
    actor: QC,
    toStatus: 'good',
    toCustody: 'qc',
    caseEffect: 'close_good',
    team: 'qc',
  },
  {
    n: 10,
    action: 'recheck_pass',
    status: 'qc_repair',
    custody: 'qc',
    actor: QC,
    toStatus: 'good',
    toCustody: 'qc',
    caseEffect: 'close_good',
    team: 'qc',
  },
  {
    n: 11,
    action: 'recheck_fail',
    status: 'recheck',
    custody: 'qc',
    actor: QC,
    toStatus: 'failed',
    toCustody: 'qc',
    caseEffect: null,
    team: 'qc',
  },
  {
    n: 12,
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
    n: 13,
    action: 'recheck',
    result: 'fail',
    status: 'good',
    custody: 'qc',
    actor: QC,
    toStatus: 'failed',
    toCustody: 'qc',
    caseEffect: 'open',
    team: 'qc',
  },
  {
    n: 14,
    action: 'send',
    status: 'good',
    custody: 'qc',
    actor: QC,
    toStatus: 'good',
    toCustody: 'transit',
    caseEffect: null,
    team: 'qc',
    leg: 'between',
  },
  {
    n: 15,
    action: 'receive',
    status: 'good',
    custody: 'transit',
    actor: QC,
    toStatus: 'good',
    toCustody: 'qc',
    caseEffect: null,
    team: 'qc',
    leg: 'between',
  },
  {
    n: 16,
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
    n: 16,
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
    n: 17,
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
    n: 17,
    action: 'note',
    status: 'service_repair',
    custody: 'service',
    actor: SERVICE,
    toStatus: 'same',
    toCustody: 'same',
    caseEffect: null,
    team: 'service',
  },
];

describe('SERIAL_FLOW', () => {
  test('tepat 17 baris', () => {
    expect(SERIAL_FLOW).toHaveLength(17);
  });

  test('setiap baris tabel punya kasus positif yang menghasilkan baris itu', () => {
    for (const p of POSITIVES) {
      const resolved = resolveAction(
        p.action,
        { status: p.status, custody: p.custody },
        p.actor,
        p.result,
      );
      if (!('row' in resolved)) throw new Error(`baris ${p.n} ditolak: ${resolved.error}`);
      const { row } = resolved;
      expect(row.toStatus).toBe(p.toStatus);
      expect(row.toCustody).toBe(p.toCustody);
      expect(row.caseEffect).toBe(p.caseEffect);
      expect(row.team).toBe(p.team);
      expect(row.leg).toBe(p.leg);
      expect(SERIAL_FLOW.indexOf(row) + 1).toBe(p.n);
    }
  });

  test('bidang wajib dan stiker sesuai tabel', () => {
    const requiredOf = (index: number) => SERIAL_FLOW[index - 1]?.required;
    expect(requiredOf(1)).toEqual(['damage']);
    expect(requiredOf(2)).toEqual(['damage']);
    expect(requiredOf(4)).toEqual(['toLocationId']);
    expect(requiredOf(8)).toEqual(['toLocationId']);
    expect(requiredOf(13)).toEqual(['damage']);
    expect(requiredOf(14)).toEqual(['toLocationId']);
    expect(requiredOf(16)).toEqual(['message']);
    expect(requiredOf(17)).toEqual(['message']);
    expect(requiredOf(10)).toEqual([]);
    const withStickers = SERIAL_FLOW.map((row, i) => (row.allowStickers ? i + 1 : 0)).filter(
      Boolean,
    );
    expect(withStickers).toEqual([10, 11, 12, 13]);
  });
});

describe('resolveAction: keadaan di luar tabel = state', () => {
  // Daftar tulisan tangan, bebas dari tabel yang diuji.
  const VALID = new Set<string>([
    'report_failure|-|good|qc',
    'identify_damage|-|failed|qc',
    'identify_damage|-|qc_repair|qc',
    'attempt_repair|-|failed|qc',
    'send|-|failed|qc',
    'send|-|qc_repair|qc',
    'send|-|service_repair|service',
    'send|-|good|qc',
    'receive|-|at_service|transit',
    'receive|-|recheck|transit',
    'receive|-|good|transit',
    'service_diagnosis|-|at_service|service',
    'declare_broken|-|at_service|service',
    'declare_broken|-|service_repair|service',
    'recheck_pass|-|recheck|qc',
    'recheck_pass|-|qc_repair|qc',
    'recheck_fail|-|recheck|qc',
    'recheck|pass|good|qc',
    'recheck|fail|good|qc',
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
});

describe('resolveAction: izin', () => {
  test('serial-saja pada baris servis (5, 6, 7, 8) = permission', () => {
    expect(resolveAction('receive', { status: 'at_service', custody: 'transit' }, QC)).toEqual({
      error: 'permission',
    });
    expect(
      resolveAction('service_diagnosis', { status: 'at_service', custody: 'service' }, QC),
    ).toEqual({ error: 'permission' });
    expect(
      resolveAction('declare_broken', { status: 'service_repair', custody: 'service' }, QC),
    ).toEqual({ error: 'permission' });
    expect(resolveAction('send', { status: 'service_repair', custody: 'service' }, QC)).toEqual({
      error: 'permission',
    });
  });

  test('serialservice-saja pada baris QC (1, 2, 3, 4, 9-15) = permission', () => {
    const cases: [SerialAction, SerialStatus, SerialCustody, ('pass' | 'fail')?][] = [
      ['report_failure', 'good', 'qc'],
      ['identify_damage', 'failed', 'qc'],
      ['attempt_repair', 'failed', 'qc'],
      ['send', 'failed', 'qc'],
      ['receive', 'recheck', 'transit'],
      ['recheck_pass', 'recheck', 'qc'],
      ['recheck_fail', 'recheck', 'qc'],
      ['recheck', 'good', 'qc', 'pass'],
      ['recheck', 'good', 'qc', 'fail'],
      ['send', 'good', 'qc'],
      ['receive', 'good', 'transit'],
    ];
    for (const [action, status, custody, result] of cases) {
      expect(resolveAction(action, { status, custody }, SERVICE, result)).toEqual({
        error: 'permission',
      });
    }
  });

  test('serialservice note pada good/failed/recheck/broken = permission', () => {
    for (const status of ['good', 'failed', 'recheck', 'broken'] as const) {
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
    const failed = resolveAction('note', { status: 'failed', custody: 'qc' }, BOTH);
    expect('row' in failed && failed.row.team).toBe('qc');
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
      );
      expect('row' in resolved).toBe(true);
    }
  });
});

describe('availableActions', () => {
  const names = (rows: FlowRow[]) => rows.map((row) => row.action);

  test('good/qc untuk serial-saja', () => {
    expect(names(availableActions({ status: 'good', custody: 'qc' }, QC))).toEqual([
      'note',
      'recheck',
      'report_failure',
      'send',
    ]);
  });

  test('servis hanya melihat note pada at_service/service_repair', () => {
    expect(names(availableActions({ status: 'good', custody: 'qc' }, SERVICE))).toEqual([]);
    expect(names(availableActions({ status: 'at_service', custody: 'transit' }, SERVICE))).toEqual([
      'note',
      'receive',
    ]);
    expect(names(availableActions({ status: 'at_service', custody: 'service' }, SERVICE))).toEqual([
      'note',
      'service_diagnosis',
      'declare_broken',
    ]);
    expect(
      names(availableActions({ status: 'service_repair', custody: 'service' }, SERVICE)),
    ).toEqual(['note', 'send', 'declare_broken']);
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

describe('sendLegOf', () => {
  test('menurunkan jenis dari status', () => {
    expect(sendLegOf('send', 'failed')).toBe('to_service');
    expect(sendLegOf('send', 'qc_repair')).toBe('to_service');
    expect(sendLegOf('send', 'service_repair')).toBe('to_qc');
    expect(sendLegOf('send', 'good')).toBe('between');
    expect(sendLegOf('send', 'broken')).toBeNull();
    expect(sendLegOf('receive', 'at_service')).toBe('at_service');
    expect(sendLegOf('receive', 'recheck')).toBe('at_qc');
    expect(sendLegOf('receive', 'good')).toBe('between');
  });
});
