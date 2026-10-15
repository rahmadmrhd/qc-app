import type { HandoverDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { handoverFormSchema, toHandoverFormDefaults, toSaveHandoverInput } from './schemas';

const valid = {
  locationId: 'loc-a',
  customerName: ' PT Maju ',
  note: ' catatan ',
  lines: [{ itemId: 'i1', label: 'Ubiquiti ES 24', qty: 5 }],
};

test('skema menerima isian sah dan merapikan teks', () => {
  const parsed = handoverFormSchema.parse(valid);
  expect(parsed.customerName).toBe('PT Maju');
  expect(parsed.note).toBe('catatan');
});

test('skema menolak: lokasi kosong, customer kosong/tanda baca, catatan > 500, tanpa baris, qty tak sah, tipe ganda', () => {
  const issues = (over: Record<string, unknown>) => {
    const result = handoverFormSchema.safeParse({ ...valid, ...over });
    return result.success
      ? []
      : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  };
  expect(issues({ locationId: '' })).toContain('locationId: Pilih lokasi');
  expect(issues({ customerName: '  ' })).toContain('customerName: Wajib diisi');
  expect(issues({ customerName: '--' })).toContain(
    'customerName: Nama customer harus memuat huruf atau angka',
  );
  expect(issues({ note: 'x'.repeat(501) })).toContain('note: Maksimal 500 karakter');
  expect(issues({ lines: [] })).toContain('lines: Minimal satu baris');
  for (const qty of [0, -1, 1.5, 100_001, Number.NaN]) {
    expect(issues({ lines: [{ itemId: 'i1', label: 'x', qty }] }).join('|')).toContain(
      'lines.0.qty',
    );
  }
  expect(
    issues({
      lines: [
        { itemId: 'i1', label: 'a', qty: 1 },
        { itemId: 'i1', label: 'a', qty: 2 },
      ],
    }),
  ).toContain('lines: Tipe yang sama muncul dua kali');
});

test('toSaveHandoverInput membuang label dan menyertakan id untuk ubah', () => {
  expect(toSaveHandoverInput(handoverFormSchema.parse(valid))).toEqual({
    locationId: 'loc-a',
    customerName: 'PT Maju',
    note: 'catatan',
    lines: [{ itemId: 'i1', qty: 5 }],
  });
  expect(toSaveHandoverInput(handoverFormSchema.parse(valid), 'h1')).toMatchObject({ id: 'h1' });
});

test('toHandoverFormDefaults: kosong untuk baru (dengan lokasi awal) dan terisi untuk ubah', () => {
  expect(toHandoverFormDefaults(undefined, 'loc-a')).toEqual({
    locationId: 'loc-a',
    customerName: '',
    note: '',
    lines: [],
  });
  const existing = {
    id: 'h1',
    locationId: 'loc-b',
    customerName: 'PT A',
    note: 'n',
    lines: [
      {
        id: 'l1',
        itemId: 'i1',
        itemLabel: 'Ubiquiti ES 24',
        qty: 5,
        doneQty: 2,
        doneAt: '',
        doneBy: '',
      },
    ],
  } as HandoverDto;
  expect(toHandoverFormDefaults(existing)).toEqual({
    locationId: 'loc-b',
    customerName: 'PT A',
    note: 'n',
    lines: [{ itemId: 'i1', label: 'Ubiquiti ES 24', qty: 5 }],
  });
});
