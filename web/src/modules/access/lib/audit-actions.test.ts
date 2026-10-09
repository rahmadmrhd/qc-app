import { expect, test } from 'vitest';
import { auditActionLabel } from './audit-actions';

test('label aksi item dalam bahasa Indonesia', () => {
  expect(auditActionLabel('item.create')).toBe('Item dibuat');
  expect(auditActionLabel('item.update')).toBe('Item diubah');
  expect(auditActionLabel('item.activate')).toBe('Item diaktifkan');
  expect(auditActionLabel('item.deactivate')).toBe('Item dinonaktifkan');
});
