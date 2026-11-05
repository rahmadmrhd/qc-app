import { describe, expect, test } from 'bun:test';
import { captureAppError } from '@server-test/errors';
import {
  validateAddComment,
  validateBoardPage,
  validateSaveHandover,
  validateSaveHandoverBatch,
  validateSetCheck,
  validateSetDone,
} from './validate';

const base = { locationId: 'loc-a', customerName: 'PT Maju', note: '- [ ] A = 1' };

describe('validasi serah terima berbasis catatan', () => {
  test('simpan: catatan sampai 5.000 karakter diterima, 5.001 ditolak', () => {
    expect(validateSaveHandover({ ...base, note: 'a'.repeat(5000) }).note).toHaveLength(5000);
    const error = captureAppError(() => validateSaveHandover({ ...base, note: 'a'.repeat(5001) }));
    expect(error.code).toBe('VALIDATION');
    expect(error.fields?.note).toBeDefined();
  });

  test('simpan: nama customer terlalu panjang ditolak, kosong diterima', () => {
    const error = captureAppError(() =>
      validateSaveHandover({ ...base, customerName: 'x'.repeat(101) }),
    );
    expect(error.fields?.customerName).toBeDefined();
    expect(validateSaveHandover({ ...base, customerName: '' }).customerName).toBe('');
  });

  test('simpan: id dan expectedUpdatedAt diteruskan', () => {
    expect(validateSaveHandover({ ...base, id: 'h1', expectedUpdatedAt: 't1' })).toEqual({
      ...base,
      id: 'h1',
      expectedUpdatedAt: 't1',
    });
  });

  test('batch: kosong dan 31 task ditolak (batas 30), 30 diterima', () => {
    const task = { customerName: 'A', note: '- [ ] X = 1' };
    expect(
      captureAppError(() => validateSaveHandoverBatch({ locationId: 'l', tasks: [] })).code,
    ).toBe('VALIDATION');
    const many = (n: number) => ({ locationId: 'l', tasks: Array.from({ length: n }, () => task) });
    expect(captureAppError(() => validateSaveHandoverBatch(many(31))).fields?.tasks).toBe(
      'Maksimal 30 task per permintaan',
    );
    expect(validateSaveHandoverBatch(many(30)).tasks).toHaveLength(30);
  });

  test('batch: galat menyebut nomor task', () => {
    const ok = { customerName: 'A', note: 'x' };
    const error = captureAppError(() =>
      validateSaveHandoverBatch({
        locationId: 'l',
        tasks: [ok, ok, { customerName: 'B', note: 'a'.repeat(5001) }],
      }),
    );
    expect(error.fields?.tasks).toContain('Task 3');
  });

  test('setCheck: indeks negatif ditolak', () => {
    const input = { id: 'h1', locationId: 'l', index: 0, text: 'A', checked: true };
    expect(validateSetCheck(input)).toEqual(input);
    expect(
      captureAppError(() => validateSetCheck({ ...input, index: -1 })).fields?.index,
    ).toBeDefined();
    expect(
      captureAppError(() => validateSetCheck({ ...input, checked: 'ya' })).fields?.checked,
    ).toBeDefined();
  });

  test('setDone: tanpa field done; done apa pun ditolak', () => {
    expect(validateSetDone({ id: 'h1', locationId: 'l' })).toEqual({ id: 'h1', locationId: 'l' });
    expect(
      captureAppError(() => validateSetDone({ id: 'h1', locationId: 'l', done: false })).fields
        ?.done,
    ).toBeDefined();
    expect(
      captureAppError(() => validateSetDone({ id: 'h1', locationId: 'l', done: true })).fields
        ?.done,
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
    expect(validateAddComment(input).body).toBe('Ok');
    expect(
      captureAppError(() => validateAddComment({ ...input, body: '  ' })).fields?.body,
    ).toBeDefined();
    expect(
      captureAppError(() => validateAddComment({ ...input, body: 'a'.repeat(1001) })).fields?.body,
    ).toBeDefined();
    expect(validateAddComment({ ...input, body: 'a'.repeat(1000) }).body).toHaveLength(1000);
  });

  test('komentar: kutipan boleh kosong (komentar umum), maks 500, konteks <= 40', () => {
    const input = { id: 'h1', locationId: 'l', quote: 'q', before: '', after: '', body: 'Ok' };
    expect(validateAddComment({ ...input, quote: '' }).quote).toBe('');
    expect(validateAddComment({ id: 'h1', locationId: 'l', body: 'Ok' })).toMatchObject({
      quote: '',
      before: '',
      after: '',
    });
    expect(
      captureAppError(() => validateAddComment({ ...input, quote: 'q'.repeat(501) })).fields?.quote,
    ).toBeDefined();
    expect(
      captureAppError(() => validateAddComment({ ...input, before: 'b'.repeat(41) })).fields
        ?.before,
    ).toBeDefined();
    expect(
      captureAppError(() => validateAddComment({ ...input, after: 'b'.repeat(41) })).fields?.after,
    ).toBeDefined();
  });

  test('catatan kosong atau hanya spasi ditolak di simpan dan batch', () => {
    expect(
      captureAppError(() => validateSaveHandover({ ...base, note: '   ' })).fields?.note,
    ).toBeDefined();
    expect(
      captureAppError(() => validateSaveHandover({ ...base, note: undefined })).fields?.note,
    ).toBeDefined();
    const error = captureAppError(() =>
      validateSaveHandoverBatch({ locationId: 'l', tasks: [{ customerName: 'A', note: '  ' }] }),
    );
    expect(error.fields?.tasks).toContain('Task 1');
  });

  test('maks. 300 butir checklist per catatan (save dan batch)', () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => `- [ ] B${i} = 1`).join('\n');
    expect(validateSaveHandover({ ...base, note: items(300) }).note).toContain('B299');
    const error = captureAppError(() => validateSaveHandover({ ...base, note: items(301) }));
    expect(error.fields?.note).toContain('300');
    const batch = captureAppError(() =>
      validateSaveHandoverBatch({
        locationId: 'l',
        tasks: [{ customerName: 'A', note: items(301) }],
      }),
    );
    expect(batch.fields?.tasks).toContain('300');
  });

  test('karakter kontrol ditolak (kecuali tab/baris baru) pada note, customer, dan komentar', () => {
    const ctrl = String.fromCharCode(1);
    expect(validateSaveHandover({ ...base, note: 'a\tb\r\nc' }).note).toContain('a');
    expect(
      captureAppError(() => validateSaveHandover({ ...base, note: `- [ ] a${ctrl}` })).fields?.note,
    ).toBeDefined();
    expect(
      captureAppError(() => validateSaveHandover({ ...base, customerName: `PT${ctrl}` })).fields
        ?.customerName,
    ).toBeDefined();
    expect(
      captureAppError(() =>
        validateSaveHandoverBatch({
          locationId: 'l',
          tasks: [{ customerName: 'A', note: `x${ctrl}` }],
        }),
      ).fields?.tasks,
    ).toBeDefined();
    const input = { id: 'h1', locationId: 'l', quote: 'q', before: '', after: '', body: 'Ok' };
    for (const key of ['quote', 'before', 'after', 'body'] as const) {
      expect(
        captureAppError(() => validateAddComment({ ...input, [key]: `x${ctrl}` })).fields?.[key],
      ).toBeDefined();
    }
  });
});

describe('validateBoardPage', () => {
  test('kolom, batas, dan kursor', () => {
    expect(validateBoardPage({ locationIds: ['a'], status: 'new' })).toEqual({
      locationIds: ['a'],
      status: 'new',
      limit: 20,
    });
    expect(
      validateBoardPage({
        locationIds: ['a'],
        status: 'done',
        limit: 3,
        cursor: '2026-01-01T00:00:00.000Z|ST-1',
      }),
    ).toMatchObject({ cursor: '2026-01-01T00:00:00.000Z|ST-1' });
    expect(
      validateBoardPage({
        locationIds: ['a'],
        status: 'in_progress',
        cursor: '500|2026-01-01T00:00:00.000Z|ST-1',
      }).cursor,
    ).toBe('500|2026-01-01T00:00:00.000Z|ST-1');
    expect(validateBoardPage({ locationIds: ['a'], status: 'new', limit: 50 }).limit).toBe(50);
    expect(
      captureAppError(() => validateBoardPage({ locationIds: ['a'], status: 'x' })).fields?.status,
    ).toBeDefined();
    for (const bad of [
      { limit: 0 },
      { limit: 51 },
      { limit: 3.5 },
      { cursor: 'x' },
      { cursor: 5 },
    ]) {
      const e = captureAppError(() =>
        validateBoardPage({ locationIds: ['a'], status: 'new', ...bad }),
      );
      expect(e.fields?.limit ?? e.fields?.cursor).toBeDefined();
    }
    expect(
      captureAppError(() =>
        validateBoardPage({ locationIds: ['a'], status: 'in_progress', cursor: 'a|b|c' }),
      ).fields?.cursor,
    ).toBeDefined();
    expect(
      captureAppError(() => validateBoardPage({ status: 'new' })).fields?.locationIds,
    ).toBeDefined();
  });
});
