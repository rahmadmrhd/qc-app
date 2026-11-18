import { describe, expect, test } from 'bun:test';
import { miniDump } from './fixture';
import {
  buildPlan,
  buNameOf,
  defaultBuOfBrand,
  junkSerialReason,
  legacyDateToIso,
  locationNameOf,
  parseUpdateAction,
  wibDateOf,
  wibToIso,
} from './plan';

const NOW = '2026-11-17T16:00:00.000Z';
const plan = () => buildPlan(miniDump(), { itemBu: 'brand+serials', now: NOW });
const serialOf = (p: ReturnType<typeof plan>, legacyId: number) => {
  const found = p.serials.find((serial) => serial.legacyId === legacyId);
  if (!found) throw new Error(`serial ${legacyId} tidak ada`);
  return found;
};

describe('pemetaan BU dan lokasi (keputusan pemilik 2026-11-17)', () => {
  test('BU menurut merk: Alta/Ubiquiti Spectrum, Mikrotik Teakwave, VSOL/Voltech IJW', () => {
    expect(defaultBuOfBrand('Ubiquiti')).toBe('Spectrum');
    expect(defaultBuOfBrand('ALTA')).toBe('Spectrum');
    expect(defaultBuOfBrand('Mikrotik')).toBe('Teakwave');
    expect(defaultBuOfBrand('VSOL')).toBe('IJW');
    expect(defaultBuOfBrand('Voltech')).toBe('IJW');
    expect(defaultBuOfBrand('Lainnya')).toBeNull();
  });

  test('BU lama 1 dan 3 digabung menjadi Spectrum, 2 Teakwave, 0 mengikuti merk', () => {
    expect(buNameOf(1, 'Mikrotik')).toBe('Spectrum');
    expect(buNameOf(3, 'Mikrotik')).toBe('Spectrum');
    expect(buNameOf(2, 'Ubiquiti')).toBe('Teakwave');
    expect(buNameOf(0, 'Mikrotik')).toBe('Teakwave');
    expect(buNameOf(0, 'Lainnya')).toBeNull();
    expect(buNameOf(-1, 'Ubiquiti')).toBeNull();
  });

  test('lokasi 1 Surabaya, 2 Jakarta, 0 (None) Surabaya', () => {
    expect(locationNameOf(1)).toBe('Surabaya');
    expect(locationNameOf(2)).toBe('Jakarta');
    expect(locationNameOf(0)).toBe('Surabaya');
  });
});

describe('fungsi bantu', () => {
  test('wibToIso: WIB (UTC+7) ke UTC; wibDateOf kembali ke tanggal WIB', () => {
    expect(wibToIso('2024-01-10 09:00:00')).toBe('2024-01-10T02:00:00.000Z');
    expect(wibToIso('2024-01-10 03:00:00')).toBe('2024-01-09T20:00:00.000Z');
    expect(wibToIso('bukan waktu')).toBeNull();
    expect(wibDateOf('2024-01-09T20:00:00.000Z')).toBe('2024-01-10');
  });

  test('legacyDateToIso membaca dd/mm/yyyy (diverifikasi terhadap dump), selain itu apa adanya', () => {
    expect(legacyDateToIso('02/03/2024')).toBe('2024-03-02');
    expect(legacyDateToIso('2/3/2024')).toBe('2024-03-02');
    expect(legacyDateToIso('2024-03-02')).toBe('2024-03-02');
    expect(legacyDateToIso('')).toBe('');
  });

  test('parseUpdateAction memecah bidang dan melaporkan bagian tak dikenal', () => {
    expect(
      parseUpdateAction('Update on:Tipe=A B->C D, Test Date=01/02/2024->03/04/2024, '),
    ).toEqual({
      changes: [
        { field: 'Tipe', from: 'A B', to: 'C D' },
        { field: 'Test Date', from: '01/02/2024', to: '03/04/2024' },
      ],
      unknown: [],
    });
    expect(parseUpdateAction('Update on:aneh, ').unknown).toEqual(['aneh']);
  });

  test('junkSerialReason: spasi, pendek, hanya huruf; nomor sah lolos', () => {
    expect(junkSerialReason('AB 12')).toBe('mengandung spasi');
    expect(junkSerialReason('AC8BA')).toBe('kurang dari 6 karakter');
    expect(junkSerialReason('INTERRUPTED')).toBe('hanya huruf');
    expect(junkSerialReason('F5BC0F1E4059')).toBeNull();
    expect(junkSerialReason('YSZ243201586')).toBeNull();
  });
});

describe('buildPlan', () => {
  test('klasifikasi: terhapus dan sampah dilewati; serial dinormalkan', () => {
    const p = plan();
    expect(p.skipped.map((row) => `${row.legacyId}:${row.reason}`).sort()).toEqual([
      '105:deleted',
      '106:junk-serial',
      '107:junk-serial',
    ]);
    expect(p.serials.map((s) => s.legacyId)).toEqual([100, 101, 102, 104, 108, 109]);
    expect(serialOf(p, 100).serial).toBe('F5BC0F1E4059');
    expect(serialOf(p, 108).serial).toBe('AC8BA9543AD8');
  });

  test('BU dan lokasi serial: tabel lama digabung/menurut merk; None -> Surabaya', () => {
    const p = plan();
    expect(serialOf(p, 100)).toMatchObject({ buName: 'Spectrum', locationName: 'Surabaya' });
    expect(serialOf(p, 101)).toMatchObject({ buName: 'Teakwave', locationName: 'Jakarta' });
    expect(serialOf(p, 102)).toMatchObject({ buName: 'IJW', locationName: 'Surabaya' });
    expect(serialOf(p, 104)).toMatchObject({ buName: 'Spectrum', locationName: 'Jakarta' });
    expect(p.buNames).toEqual(['IJW', 'Spectrum', 'Teakwave']);
    expect(p.locationNames).toEqual(['Jakarta', 'Surabaya']);
  });

  test('bentrok (BU, serial): yang terbaru menang dan yang lama dilipat ke riwayatnya', () => {
    const p = plan();
    expect(p.folded).toEqual([
      {
        winnerLegacyId: 104,
        loserLegacyId: 103,
        serial: 'DUP12345X',
        buName: 'Spectrum',
        winnerItem: 'Ubiquiti UAP AC LR',
        loserItem: 'Ubiquiti UAP AC Lite',
      },
    ]);
    const winner = serialOf(p, 104);
    expect(winner.foldedLegacyIds).toEqual([103]);
    expect(winner.testDate).toBe('2024-05-01');
    expect(winner.events.map((e) => `${e.seq}:${e.type}`)).toEqual([
      '1:recorded',
      '2:note',
      '3:note',
      '4:note',
    ]);
    // Kejadian "Added" paling awal (milik catatan 103 yang dilipat) menjadi recorded; sisanya catatan berlabel tipe.
    expect(winner.events[0]?.data.legacyId).toBe(103);
    expect(winner.events[1]?.message).toBe('Dicatat sebagai Ubiquiti UAP AC LR (data lama)');
    expect(winner.events[2]?.message).toBe('Dicatat ulang sebagai Ubiquiti UAP AC LR (data lama)');
    expect(winner.events[3]?.message).toBe(
      'Dicatat ulang sebagai Ubiquiti UAP AC Lite (catatan lama #103, digabung) (data lama)',
    );
    expect(p.serials.some((s) => s.legacyId === 103)).toBe(false);
  });

  test('riwayat Update: Tipe dan Test Date menjadi data_changed berlabel merk + tipe, tanggal ISO', () => {
    const events = serialOf(plan(), 100).events;
    expect(events.map((e) => e.type)).toEqual(['recorded', 'data_changed']);
    expect(events[1]?.changes).toEqual([
      { field: 'item', from: 'Ubiquiti UAP AC LR', to: 'Ubiquiti UAP AC Lite' },
      { field: 'testDate', from: '2024-01-09', to: '2024-01-10' },
    ]);
    expect(events[0]).toMatchObject({
      actorName: 'Rahmad Maulana',
      createdAt: '2024-01-10T02:00:00.000Z',
      occurredOn: '2024-01-10',
      message: '',
    });
    expect(events[0]?.data).toMatchObject({ source: 'legacy', stickers: [] });
  });

  test('serial tanpa riwayat mendapat recorded sintetis dan dicap legacy', () => {
    const synthetic = serialOf(plan(), 108);
    expect(synthetic.events).toHaveLength(1);
    expect(synthetic.events[0]).toMatchObject({
      seq: 1,
      type: 'recorded',
      actorName: 'Migrasi data lama',
    });
    expect(synthetic.events[0]?.data).toMatchObject({ source: 'legacy', synthetic: true });
  });

  test('metadata serial: created dari kejadian pertama, updated dari terakhir; stiker tidak dibuat', () => {
    const s = serialOf(plan(), 100);
    expect(s.createdAt).toBe('2024-01-10T02:00:00.000Z');
    expect(s.createdBy).toBe('Rahmad Maulana');
    expect(s.updatedAt).toBe('2024-01-11T03:00:00.000Z');
    expect(s.sample).toBe(false);
    expect(serialOf(plan(), 101)).toMatchObject({ sample: true, note: 'Jakarta' });
  });

  test('firmware: dibawa ke kolom hanya bila Country Lock dan kodenya sah untuk merk; sisanya masuk detail + peringatan', () => {
    const p = plan();
    const byId = (id: number) => p.items.find((i) => i.legacyId === id);
    expect(byId(3)).toMatchObject({ firmware: 'AC', detail: '' });
    expect(byId(8)?.firmware).toBe('M');
    expect(byId(9)?.firmware).toBe('WA');
    // Bukan Country Lock (tipe 1, 'fw1'), kode tak dikenal (10), merk tanpa daftar (11): kolom kosong, nilai lama tetap terbaca.
    for (const id of [1, 10, 11]) {
      expect(byId(id)?.firmware).toBe('');
      expect(byId(id)?.detail).toContain('Firmware (aplikasi lama):');
    }
    expect(byId(1)?.detail).toContain('Firmware (aplikasi lama): fw1');
    expect(byId(2)?.firmware).toBe('');
    const warned = (needle: string) => p.warnings.some((w) => w.includes(needle));
    expect(warned('bukan Country Lock')).toBe(true);
    expect(warned('tidak ada di daftar firmware merk Mikrotik')).toBe(true);
    expect(warned('tidak ada di daftar firmware merk VSOL')).toBe(true);
  });

  test('firmware: tipe yang dilebur memberi firmware sah bila tipe induk belum punya', () => {
    const dump = miniDump();
    // Tipe 12 memakai kunci yang sama dengan tipe 3 setelah normalisasi, tetapi tipe 3 sengaja dikosongkan.
    dump.typeItem = [
      [3, 'Mikrotik', 'RB-4011', 1, '', '', 0],
      [12, 'Mikrotik', 'RB 4011', 1, 'AX', '', 0],
    ];
    const merged = buildPlan(dump, { itemBu: 'brand', now: NOW });
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]).toMatchObject({ legacyId: 3, firmware: 'AX', mergedLegacyIds: [12] });
  });

  test('item: kunci sama dilebur; dihapus = nonaktif; lampiran dan firmware masuk detail', () => {
    const p = plan();
    expect(p.items.map((i) => i.legacyId)).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 11]);
    expect(p.items.find((i) => i.legacyId === 5)?.mergedLegacyIds).toEqual([6]);
    expect(p.items.find((i) => i.legacyId === 7)).toMatchObject({
      status: 'inactive',
      isCountryLock: false,
    });
    expect(p.items.find((i) => i.legacyId === 3)?.isCountryLock).toBe(true);
    const detail = p.items.find((i) => i.legacyId === 1)?.detail ?? '';
    expect(detail).toContain('Firmware (aplikasi lama): fw1');
    expect(detail).toContain('https://drive.google.com/file/d/DRIVEID1/view');
    expect(p.items.find((i) => i.legacyId === 2)?.detail).toBe('');
    expect(p.items.find((i) => i.legacyId === 1)?.createdAt).toBe('2022-03-01T03:00:00.000Z');
    expect(p.warnings.some((w) => w.includes('dilebur'))).toBe(true);
  });

  test('BU item: bawaan merk; "brand+serials" menambah BU tempat serialnya tercatat', () => {
    const both = plan();
    expect(both.items.find((i) => i.legacyId === 1)?.buNames).toEqual(['Spectrum', 'Teakwave']);
    expect(both.items.find((i) => i.legacyId === 3)?.buNames).toEqual(['Teakwave']);
    expect(both.items.find((i) => i.legacyId === 4)?.buNames).toEqual(['IJW']);
    const brandOnly = buildPlan(miniDump(), { itemBu: 'brand', now: NOW });
    expect(brandOnly.items.find((i) => i.legacyId === 1)?.buNames).toEqual(['Spectrum']);
  });

  test('deterministik: id turunan identik antar putaran dan berbentuk UUID', () => {
    const first = plan();
    const second = plan();
    expect(first.serials.map((s) => [s.id, s.clientId])).toEqual(
      second.serials.map((s) => [s.id, s.clientId]),
    );
    expect(first.serials[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(new Set(first.serials.flatMap((s) => s.events.map((e) => e.id))).size).toBe(
      first.serials.reduce((sum, s) => sum + s.events.length, 0),
    );
  });
});
