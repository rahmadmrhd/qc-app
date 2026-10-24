import { expect, test } from 'vitest';
import { makeHandover } from '../components/test-handover';
import { applyOptimisticCheck } from './optimistic-check';

test('hanya butir itu yang berubah; status turunan dan butir lain tidak disentuh', () => {
  const base = makeHandover();
  const one = applyOptimisticCheck(base, 0, true, 'qc@x', 't1');
  expect(one.checklist[0]).toMatchObject({ checked: true, by: 'qc@x', at: 't1' });
  expect(one.checklist[1]).toEqual(base.checklist[1]);
  expect(one.status).toBe(base.status);
  const back = applyOptimisticCheck(one, 0, false, 'qc@x', 't2');
  expect(back.checklist[0]).toMatchObject({ checked: false, by: '', at: '' });
});

test('indeks tak dikenal tidak mengubah apa pun', () => {
  expect(applyOptimisticCheck(makeHandover(), 9, true, 'u', 't')).toEqual(makeHandover());
});
