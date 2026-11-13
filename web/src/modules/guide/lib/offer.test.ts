import type { LocationAccessDto, MeDto } from '@shared/contract';
import { GUIDE_VERSIONS } from '@shared/guides';
import { describe, expect, test } from 'vitest';
import { eligibleGuides, greetingDue, hasAccess, offeredGuides, stepsFor } from './offer';
import type { GuideEntry, GuideStep } from './types';

function me(overrides: Partial<MeDto> = {}): MeDto {
  return {
    email: 'a@qc.local',
    name: 'A',
    isSuperAdmin: false,
    permissions: {} as MeDto['permissions'],
    locations: [],
    businessUnits: [],
    sharedAccount: false,
    ...overrides,
  };
}

/** Pengguna dengan izin GLOBAL `item: view` saja. */
const viewer = me({ permissions: { item: 'view' } as MeDto['permissions'] });

function location(id: string, handover: 'view' | 'edit' | 'manage'): LocationAccessDto {
  return {
    id,
    code: id,
    name: id,
    permissions: { handover } as LocationAccessDto['permissions'],
  } as LocationAccessDto;
}

function step(overrides: Partial<GuideStep> = {}): GuideStep {
  return { target: 'x', text: 't', advance: 'next', ...overrides };
}

function entry(overrides: Partial<GuideEntry> = {}): GuideEntry {
  return {
    id: 'g1',
    kind: 'dasar',
    status: 'disimpan',
    version: 1,
    title: 'Judul',
    izin: { module: 'item', level: 'view' },
    steps: [step()],
    ...overrides,
  };
}

const none = new Map<string, number>();
const offer = (
  input: Partial<Parameters<typeof offeredGuides>[0]> & { catalog: readonly GuideEntry[] },
) => offeredGuides({ me: viewer, done: none, derived: new Map(), ...input });
const ids = (input: Parameters<typeof offer>[0]) => offer(input).map((o) => o.entry.id);

describe('hasAccess', () => {
  test('tanpa izin = semua pengguna', () => {
    expect(hasAccess(me(), undefined)).toBe(true);
  });
  test('satu izin dicek dengan level', () => {
    expect(hasAccess(viewer, { module: 'item', level: 'view' })).toBe(true);
    expect(hasAccess(viewer, { module: 'item', level: 'edit' })).toBe(false);
    expect(hasAccess(viewer, { module: 'qrcode', level: 'view' })).toBe(false);
  });
  test('daftar: salah satu cukup', () => {
    const list = [
      { module: 'qrcode', level: 'view' },
      { module: 'item', level: 'view' },
    ] as const;
    expect(hasAccess(viewer, list)).toBe(true);
    expect(hasAccess(me(), list)).toBe(false);
  });
  test('scope location dibatasi lokasi aktif', () => {
    const user = me({ locations: [location('L1', 'view'), location('L2', 'edit')] });
    const need = { module: 'handover', level: 'edit', scope: 'location' } as const;
    expect(hasAccess(user, need)).toBe(true);
    expect(hasAccess(user, need, ['L1'])).toBe(false);
    expect(hasAccess(user, need, ['L2'])).toBe(true);
  });
});

describe('offeredGuides', () => {
  test('pengguna tanpa izin modul tidak ditawari', () => {
    expect(ids({ me: me(), catalog: [entry()] })).toEqual([]);
  });

  test('tanpa izin entri = ditawari semua pengguna', () => {
    expect(ids({ me: me(), catalog: [entry({ izin: undefined })] })).toEqual(['g1']);
  });

  test('izin cukup dan belum selesai: ditawari beserta jumlah langkah', () => {
    const [first] = offer({ catalog: [entry({ steps: [step(), step()] })] });
    expect(first?.entry.id).toBe('g1');
    expect(first?.stepCount).toBe(2);
  });

  test('sudah selesai pada versi katalog: tidak ditawari', () => {
    expect(ids({ catalog: [entry()], done: new Map([['g1', 1]]) })).toEqual([]);
  });

  test('versi tersimpan lebih rendah dari katalog: ditawari lagi', () => {
    expect(ids({ catalog: [entry({ version: 2 })], done: new Map([['g1', 1]]) })).toEqual(['g1']);
    expect(ids({ catalog: [entry({ version: 2 })], done: new Map([['g1', 2]]) })).toEqual([]);
  });

  test('tip dan sapaan tidak ikut daftar penawaran', () => {
    const catalog = [
      entry({ id: 'tip-a', kind: 'tip' }),
      entry({ id: 'sapaan-awal', kind: 'sapaan', izin: undefined }),
    ];
    expect(ids({ catalog })).toEqual([]);
  });

  describe('panduan baru', () => {
    const dasar = entry({ id: 'dasar-x', kind: 'dasar', covers: ['baru-x'] });
    const baru = entry({ id: 'baru-x', kind: 'baru', dasar: 'dasar-x' });

    test('tidak ditawari sebelum dasar modulnya selesai', () => {
      expect(ids({ catalog: [dasar, baru] })).toEqual(['dasar-x']);
    });

    test('ditawari sesudah dasar selesai', () => {
      expect(ids({ catalog: [dasar, baru], done: new Map([['dasar-x', 1]]) })).toEqual(['baru-x']);
    });

    test('dasar versi lama belum dihitung selesai', () => {
      const v2 = { ...dasar, version: 2 };
      expect(ids({ catalog: [v2, baru], done: new Map([['dasar-x', 1]]) })).toEqual(['dasar-x']);
    });

    test('M3: prasyarat hanya dasar yang disebut eksplisit, bukan irisan modul izin', () => {
      const lain = entry({ id: 'dasar-lain', kind: 'dasar' });
      const baruY = entry({ id: 'baru-y', kind: 'baru', dasar: 'dasar-x' });
      // `dasar-lain` seizin dengan baru-y tetapi bukan induknya: tak menahan; `dasar-x` selesai.
      expect(ids({ catalog: [dasar, lain, baruY], done: new Map([['dasar-x', 1]]) })).toEqual([
        'dasar-lain',
        'baru-y',
      ]);
    });

    test('M3: baru tanpa izin (tata letak) tetap menunggu dasar-layout', () => {
      const layout = entry({ id: 'dasar-layout', kind: 'dasar', izin: undefined });
      const baruLayout = entry({
        id: 'baru-layout',
        kind: 'baru',
        izin: undefined,
        dasar: 'dasar-layout',
      });
      expect(ids({ me: me(), catalog: [layout, baruLayout] })).toEqual(['dasar-layout']);
      expect(
        ids({ me: me(), catalog: [layout, baruLayout], done: new Map([['dasar-layout', 1]]) }),
      ).toEqual(['baru-layout']);
    });

    test('dasar yang langkahnya gugur bagi pengguna tidak menahan baru', () => {
      const kosong = { ...dasar, steps: [step({ izin: { module: 'access', level: 'manage' } })] };
      expect(ids({ catalog: [kosong, baru] })).toEqual(['baru-x']);
    });

    test('baru yang dasarnya tak ada di katalog ditawari biasa (tes katalog menjaganya)', () => {
      expect(ids({ catalog: [baru] })).toEqual(['baru-x']);
    });
  });

  describe('N1: label "Diperbarui"', () => {
    test('updated true bila versi tersimpan ada tetapi lebih rendah dari katalog', () => {
      const [first] = offer({ catalog: [entry({ version: 2 })], done: new Map([['g1', 1]]) });
      expect(first?.updated).toBe(true);
    });
    test('updated false bila belum pernah selesai', () => {
      expect(offer({ catalog: [entry({ version: 2 })] })[0]?.updated).toBe(false);
    });
    test('updated false untuk panduan diturunkan', () => {
      const turunan = entry({ id: 'pwa', status: 'diturunkan', izin: undefined });
      const result = offer({
        catalog: [turunan],
        derived: new Map([['pwa', true]]),
        done: new Map([['pwa', 0]]),
      });
      expect(result[0]?.updated).toBe(false);
    });
  });

  test('stepCount hanya menghitung langkah yang lolos izin', () => {
    const catalog = [
      entry({
        steps: [
          step(),
          step({ izin: { module: 'item', level: 'view' } }),
          step({ izin: { module: 'item', level: 'manage' } }),
        ],
      }),
    ];
    expect(offer({ catalog })[0]?.stepCount).toBe(2);
  });

  test('Review Focus 3: semua langkah gugur (stepCount 0) = tidak ditawari', () => {
    const catalog = [entry({ steps: [step({ izin: { module: 'item', level: 'manage' } })] })];
    expect(ids({ catalog })).toEqual([]);
  });

  describe('diturunkan', () => {
    const turunan = entry({ id: 'pwa', status: 'diturunkan', izin: undefined });

    test('ditawari menurut derived, tidak pernah membaca done', () => {
      expect(ids({ catalog: [turunan], derived: new Map([['pwa', true]]) })).toEqual(['pwa']);
      expect(
        ids({
          catalog: [turunan],
          derived: new Map([['pwa', true]]),
          done: new Map([['pwa', 99]]),
        }),
      ).toEqual(['pwa']);
    });

    test('derived false atau tak ada = tidak ditawari', () => {
      expect(ids({ catalog: [turunan], derived: new Map([['pwa', false]]) })).toEqual([]);
      expect(ids({ catalog: [turunan] })).toEqual([]);
    });
  });

  test('urutan katalog dipertahankan', () => {
    const catalog = [entry({ id: 'b' }), entry({ id: 'a' })];
    expect(ids({ catalog })).toEqual(['b', 'a']);
  });

  test('izin berlokasi mengikuti lokasi aktif', () => {
    const user = me({ locations: [location('L1', 'view')] });
    const catalog = [entry({ izin: { module: 'handover', level: 'view', scope: 'location' } })];
    expect(ids({ me: user, catalog, activeLocationIds: ['L1'] })).toEqual(['g1']);
    expect(ids({ me: user, catalog, activeLocationIds: ['L9'] })).toEqual([]);
  });
});

describe('stepsFor', () => {
  test('menyaring langkah menurut izin', () => {
    const open = step({ target: 'a' });
    const closed = step({ target: 'b', izin: { module: 'access', level: 'manage' } });
    expect(stepsFor(entry({ steps: [open, closed] }), viewer)).toEqual([open]);
  });
});

describe('greetingDue', () => {
  test('true bila sapaan-awal belum ada di done', () => {
    expect(greetingDue(new Map())).toBe(true);
    expect(greetingDue(new Map([['lain', 1]]))).toBe(true);
  });
  test('false bila sapaan-awal sudah tercatat pada versi terdaftar', () => {
    expect(greetingDue(new Map([['sapaan-awal', 1]]))).toBe(false);
  });
  test('M4: true bila versi tersimpan lebih rendah dari GUIDE_VERSIONS', () => {
    expect(greetingDue(new Map([['sapaan-awal', 0]]))).toBe(true);
    expect(greetingDue(new Map([['sapaan-awal', GUIDE_VERSIONS['sapaan-awal'] - 1]]))).toBe(true);
  });
});

describe('eligibleGuides', () => {
  test('memuat semua panduan yang berhak, termasuk yang sudah selesai; tanpa tip/sapaan', () => {
    const catalog = [
      entry({ id: 'a' }),
      entry({ id: 'tip-a', kind: 'tip' }),
      entry({ id: 'sapaan-awal', kind: 'sapaan', izin: undefined }),
      entry({ id: 'pwa', status: 'diturunkan', izin: undefined }),
    ];
    expect(eligibleGuides({ me: viewer, catalog }).map((o) => o.entry.id)).toEqual(['a', 'pwa']);
  });

  test('tanpa izin atau tanpa langkah yang berlaku: tidak ikut', () => {
    const catalog = [
      entry({ id: 'x', izin: { module: 'access', level: 'manage' } }),
      entry({ id: 'y', steps: [step({ izin: { module: 'access', level: 'manage' } })] }),
    ];
    expect(eligibleGuides({ me: viewer, catalog })).toEqual([]);
  });

  test('panduan baru ikut walau dasarnya belum selesai', () => {
    const catalog = [
      entry({ id: 'dasar-x', covers: ['baru-x'] }),
      entry({ id: 'baru-x', kind: 'baru' }),
    ];
    expect(eligibleGuides({ me: viewer, catalog }).map((o) => o.entry.id)).toEqual([
      'dasar-x',
      'baru-x',
    ]);
  });

  test('membawa stepCount per pengguna', () => {
    const catalog = [
      entry({ steps: [step(), step({ izin: { module: 'access', level: 'manage' } })] }),
    ];
    expect(eligibleGuides({ me: viewer, catalog })[0]?.stepCount).toBe(1);
  });
});
