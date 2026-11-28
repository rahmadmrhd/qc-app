import { describe, expect, test } from 'bun:test';
import {
  validateWarehouseItemOptions,
  validateWarehouseListOrders,
  validateWarehouseLookup,
  validateWarehouseSerials,
  validateWarehouseSubmit,
} from './validate';

const UUID = '11111111-1111-4111-8111-111111111111';

const header = (over: Record<string, unknown> = {}) => ({
  dispatchedOn: '2026-11-12',
  orderNumber: '  SO-1 ',
  buId: 'bu-a',
  customerName: ' PT Maju ',
  itemId: 'i-a1',
  note: ' catatan ',
  handoverIds: [],
  total: 2,
  chunkSize: 200,
  ...over,
});

const newRow = (serial: string) => ({
  kind: 'new',
  clientId: UUID,
  serial,
  locationId: 'loc',
  testDate: '2026-11-12',
});

const submit = (over: Record<string, unknown> = {}) => ({
  clientId: UUID,
  chunkIndex: 0,
  header: header(),
  rows: [newRow('aa-1'), { kind: 'existing', serialId: 's1', serial: ' bb-2 ' }],
  ...over,
});

describe('validateWarehouseSubmit', () => {
  test('menormalkan No SO, customer, catatan, dan serial', () => {
    const out = validateWarehouseSubmit(submit());
    expect(out.header.orderNumber).toBe('SO-1');
    expect(out.header.customerName).toBe('PT Maju');
    expect(out.header.note).toBe('catatan');
    expect(out.rows.map((r) => r.serial)).toEqual(['AA-1', 'BB-2']);
  });

  test('jumlah baris harus sesuai potongan', () => {
    expect(() => validateWarehouseSubmit(submit({ rows: [newRow('A-1')] }))).toThrow();
    const out = validateWarehouseSubmit(
      submit({
        chunkIndex: 1,
        header: header({ total: 3, chunkSize: 2 }),
        rows: [newRow('A-3')],
      }),
    );
    expect(out.chunkIndex).toBe(1);
  });

  test('menolak clientId bukan UUID, chunkSize di luar 1..200, serial dobel, jenis baris asing', () => {
    expect(() => validateWarehouseSubmit(submit({ clientId: 'abc' }))).toThrow();
    expect(() => validateWarehouseSubmit(submit({ header: header({ chunkSize: 201 }) }))).toThrow();
    expect(() =>
      validateWarehouseSubmit(submit({ rows: [newRow('DUP'), newRow('dup')] })),
    ).toThrow();
    expect(() =>
      validateWarehouseSubmit(submit({ rows: [{ kind: 'x', serial: 'A' }, newRow('B')] })),
    ).toThrow();
  });

  test('menolak No SO kepanjangan, atau ber-karakter kontrol; task ganda atau lebih dari 20', () => {
    expect(() =>
      validateWarehouseSubmit(submit({ header: header({ orderNumber: 'x'.repeat(41) }) })),
    ).toThrow();
    expect(() =>
      validateWarehouseSubmit(submit({ header: header({ orderNumber: 'SO\u0007' }) })),
    ).toThrow();
    expect(() =>
      validateWarehouseSubmit(submit({ header: header({ handoverIds: ['a', 'a'] }) })),
    ).toThrow();
    expect(() =>
      validateWarehouseSubmit(
        submit({ header: header({ handoverIds: Array.from({ length: 21 }, (_, i) => `h${i}`) }) }),
      ),
    ).toThrow();
  });
});

describe('Penjualan tanpa No SO', () => {
  test('No SO kosong diterima; customer opsional; orderId ditolak', () => {
    const out = validateWarehouseSubmit(
      submit({ header: header({ orderNumber: '  ', customerName: '' }) }),
    );
    expect(out.header.orderNumber).toBe('');
    expect(out.header.customerName).toBe('');
    expect(() =>
      validateWarehouseSubmit(
        submit({ header: header({ orderNumber: '', orderId: 'o1', customerName: '' }) }),
      ),
    ).toThrow();
  });
});

describe('validator pencarian dan daftar', () => {
  test('serials: itemId wajib; testDate harus tanggal', () => {
    expect(() => validateWarehouseSerials({})).toThrow();
    expect(() => validateWarehouseSerials({ itemId: 'i', testDate: '12/11/2026' })).toThrow();
    expect(validateWarehouseSerials({ itemId: 'i', limit: 10 })).toEqual({
      itemId: 'i',
      limit: 10,
    });
  });

  test('lookup: gabungan maks. 200', () => {
    const many = Array.from({ length: 120 }, (_, i) => `S${i}`);
    expect(() => validateWarehouseLookup({ serials: many, ids: many })).toThrow();
    expect(validateWarehouseLookup({ serials: many }).serials).toHaveLength(120);
  });

  test('itemOptions dan listOrders: batas dan status', () => {
    expect(() => validateWarehouseItemOptions({ limit: 51 })).toThrow();
    expect(() => validateWarehouseListOrders({ status: 'lain' })).toThrow();
    expect(validateWarehouseListOrders({ status: 'pending', from: '2026-11-01' })).toEqual({
      status: 'pending',
      from: '2026-11-01',
    });
  });
});
