import { describe, expect, test } from 'bun:test';
import { captureAppError } from '@gas-test/errors';
import {
  validateAddComment_,
  validateSaveHandover_,
  validateSaveHandoverBatch_,
  validateSetCheck_,
  validateSetDone_,
} from './validate';

const base = { locationId: 'loc-a', customerName: 'PT Maju', note: '- [ ] A = 1' };

describe('validasi serah terima berbasis catatan', () => {
  test('simpan: catatan sampai 5.000 karakter diterima, 5.001 ditolak', () => {
    expect(validateSaveHandover_({ ...base, note: 'a'.repeat(5000) }).note).toHaveLength(5000);
    const error = captureAppError(() => validateSaveHandover_({ ...base, note: 'a'.repeat(5001) }));
    expect(error.code).toBe('VALIDATION');
    expect(error.fields?.note).toBeDefined();
  });

  test('simpan: nama customer terlalu panjang ditolak, kosong diterima', () => {
    const error = captureAppError(() =>
      validateSaveHandover_({ ...base, customerName: 'x'.repeat(101) }),
    );
    expect(error.fields?.customerName).toBeDefined();
    expect(validateSaveHandover_({ ...base, customerName: '' }).customerName).toBe('');
  });

  test('simpan: id dan expectedUpdatedAt diteruskan', () => {
    expect(validateSaveHandover_({ ...base, id: 'h1', expectedUpdatedAt: 't1' })).toEqual({
      ...base,
      id: 'h1',
      expectedUpdatedAt: 't1',
    });
  });

  test('batch: kosong dan 31 task ditolak, 30 diterima', () => {
    const task = { customerName: 'A', note: '- [ ] X = 1' };
    expect(
      captureAppError(() => validateSaveHandoverBatch_({ locationId: 'l', tasks: [] })).code,
    ).toBe('VALIDATION');
    const many = (n: number) => ({ locationId: 'l', tasks: Array.from({ length: n }, () => task) });
    expect(captureAppError(() => validateSaveHandoverBatch_(many(31))).fields?.tasks).toBeDefined();
    expect(validateSaveHandoverBatch_(many(30)).tasks).toHaveLength(30);
  });

  test('batch: galat menyebut nomor task', () => {
    const ok = { customerName: 'A', note: 'x' };
    const error = captureAppError(() =>
      validateSaveHandoverBatch_({
        locationId: 'l',
        tasks: [ok, ok, { customerName: 'B', note: 'a'.repeat(5001) }],
      }),
    );
    expect(error.fields?.tasks).toContain('Task 3');
  });

  test('setCheck: indeks negatif ditolak', () => {
    const input = { id: 'h1', locationId: 'l', index: 0, text: 'A', checked: true };
    expect(validateSetCheck_(input)).toEqual(input);
    expect(
      captureAppError(() => validateSetCheck_({ ...input, index: -1 })).fields?.index,
    ).toBeDefined();
    expect(
      captureAppError(() => validateSetCheck_({ ...input, checked: 'ya' })).fields?.checked,
    ).toBeDefined();
  });

  test('setDone: done wajib boolean', () => {
    expect(validateSetDone_({ id: 'h1', locationId: 'l', done: false }).done).toBe(false);
    expect(
      captureAppError(() => validateSetDone_({ id: 'h1', locationId: 'l' })).fields?.done,
    ).toBeDefined();
  });

  test('komentar: kosong dan 1.001 karakter ditolak', () => {
    const input = {
      id: 'h1',
      locationId: 'l',
      quote: 'kirim sore',
      before: 'a',
      after: 'b',
      body: 'Ok',
    };
    expect(validateAddComment_(input).body).toBe('Ok');
    expect(
      captureAppError(() => validateAddComment_({ ...input, body: '  ' })).fields?.body,
    ).toBeDefined();
    expect(
      captureAppError(() => validateAddComment_({ ...input, body: 'a'.repeat(1001) })).fields?.body,
    ).toBeDefined();
    expect(validateAddComment_({ ...input, body: 'a'.repeat(1000) }).body).toHaveLength(1000);
  });

  test('komentar: kutipan tidak boleh kosong atau > 500, konteks <= 40', () => {
    const input = { id: 'h1', locationId: 'l', quote: 'q', before: '', after: '', body: 'Ok' };
    expect(
      captureAppError(() => validateAddComment_({ ...input, quote: '' })).fields?.quote,
    ).toBeDefined();
    expect(
      captureAppError(() => validateAddComment_({ ...input, quote: 'q'.repeat(501) })).fields
        ?.quote,
    ).toBeDefined();
    expect(
      captureAppError(() => validateAddComment_({ ...input, before: 'b'.repeat(41) })).fields
        ?.before,
    ).toBeDefined();
    expect(
      captureAppError(() => validateAddComment_({ ...input, after: 'b'.repeat(41) })).fields?.after,
    ).toBeDefined();
  });
});
