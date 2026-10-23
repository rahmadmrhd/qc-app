import type { HandoverDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import {
  handoverBatchSchema,
  handoverFormSchema,
  toHandoverFormDefaults,
  toSaveHandoverBatchInput,
  toSaveHandoverInput,
} from './schemas';

const valid = { locationId: 'loc-a', customerName: ' PT Maju ', note: ' - [ ] A = 1 ' };

const issues = (schema: typeof handoverFormSchema, input: Record<string, unknown>) => {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

test('skema menerima isian sah dan merapikan teks', () => {
  const parsed = handoverFormSchema.parse(valid);
  expect(parsed).toEqual({ locationId: 'loc-a', customerName: 'PT Maju', note: '- [ ] A = 1' });
});

test('skema menolak: lokasi kosong, customer tanda baca, catatan > 5.000; customer kosong sah', () => {
  expect(issues(handoverFormSchema, { ...valid, locationId: '' })).toContain(
    'locationId: Pilih lokasi',
  );
  expect(issues(handoverFormSchema, { ...valid, customerName: '  ' })).toEqual([]);
  expect(issues(handoverFormSchema, { ...valid, customerName: '--' })).toContain(
    'customerName: Nama customer harus memuat huruf atau angka',
  );
  expect(issues(handoverFormSchema, { ...valid, note: 'a'.repeat(5001) })).toContain(
    'note: Maksimal 5000 karakter',
  );
  expect(issues(handoverFormSchema, { ...valid, note: 'a'.repeat(5000) })).toEqual([]);
});

test('skema: catatan kosong/spasi ditolak dan maks. 300 butir checklist', () => {
  expect(issues(handoverFormSchema, { ...valid, note: '   ' })).toContain(
    'note: Catatan wajib diisi',
  );
  const items = (n: number) => Array.from({ length: n }, () => '- [ ] a').join('\n');
  expect(issues(handoverFormSchema, { ...valid, note: items(300) })).toEqual([]);
  expect(issues(handoverFormSchema, { ...valid, note: items(301) })).toContain(
    'note: Maksimal 300 butir checklist per catatan',
  );
});

test('skema batch: 1-30 task, catatan wajib, lokasi wajib', () => {
  const task = { customerName: '', note: 'x' };
  const parse = (input: unknown) => handoverBatchSchema.safeParse(input);
  expect(parse({ locationId: 'l', tasks: [] }).success).toBe(false);
  expect(parse({ locationId: 'l', tasks: Array.from({ length: 31 }, () => task) }).success).toBe(
    false,
  );
  expect(parse({ locationId: 'l', tasks: Array.from({ length: 30 }, () => task) }).success).toBe(
    true,
  );
  expect(parse({ locationId: 'l', tasks: [{ customerName: '', note: '  ' }] }).success).toBe(false);
  expect(parse({ locationId: '', tasks: [task] }).success).toBe(false);
});

test('toSaveHandoverInput menyertakan id dan expectedUpdatedAt hanya untuk ubah', () => {
  const values = handoverFormSchema.parse(valid);
  expect(toSaveHandoverInput(values)).toEqual({
    locationId: 'loc-a',
    customerName: 'PT Maju',
    note: '- [ ] A = 1',
  });
  expect(toSaveHandoverInput(values, 'h1', 't1')).toMatchObject({
    id: 'h1',
    expectedUpdatedAt: 't1',
  });
  expect(toSaveHandoverInput(values, 'h1')).not.toHaveProperty('expectedUpdatedAt');
});

test('toSaveHandoverBatchInput dan defaults dari task', () => {
  const parsed = handoverBatchSchema.parse({
    locationId: 'l',
    tasks: [{ customerName: ' A ', note: ' x ' }],
  });
  expect(toSaveHandoverBatchInput(parsed)).toEqual({
    locationId: 'l',
    tasks: [{ customerName: 'A', note: 'x' }],
  });
  expect(toHandoverFormDefaults(undefined, 'loc-a')).toEqual({
    locationId: 'loc-a',
    customerName: '',
    note: '',
  });
  const dto = { locationId: 'loc-b', customerName: 'PT', note: 'n' } as HandoverDto;
  expect(toHandoverFormDefaults(dto)).toEqual({
    locationId: 'loc-b',
    customerName: 'PT',
    note: 'n',
  });
});
