import { expect, test } from 'vitest';
import { auditActionLabel } from './audit-actions';

test('label aksi item dalam bahasa Indonesia', () => {
  expect(auditActionLabel('item.create')).toBe('Item dibuat');
  expect(auditActionLabel('item.update')).toBe('Item diubah');
  expect(auditActionLabel('item.activate')).toBe('Item diaktifkan');
  expect(auditActionLabel('item.deactivate')).toBe('Item dinonaktifkan');
});

test('label aksi customer dan serah terima', () => {
  expect(auditActionLabel('customer.create')).toBe('Customer dibuat');
  expect(auditActionLabel('customer.rename')).toBe('Customer diganti nama');
  expect(auditActionLabel('customer.activate')).toBe('Customer diaktifkan');
  expect(auditActionLabel('customer.deactivate')).toBe('Customer dinonaktifkan');
  expect(auditActionLabel('handover.create')).toBe('Task serah terima dibuat');
  expect(auditActionLabel('handover.update')).toBe('Task serah terima diubah');
  expect(auditActionLabel('handover.cancel')).toBe('Task serah terima dibatalkan');
  expect(auditActionLabel('handover.check')).toBe('Butir checklist dicentang');
  expect(auditActionLabel('handover.uncheck')).toBe('Centang butir checklist dibatalkan');
  expect(auditActionLabel('handover.done')).toBe('Task serah terima ditandai selesai');
  expect(auditActionLabel('handover.uncancel')).toBe(
    'Task serah terima dibuka kembali (batal dicabut)',
  );
  expect(auditActionLabel('handover.comment')).toBe('Komentar serah terima ditambahkan');
});

test('aksi audit qrcode.* berlabel Indonesia', () => {
  for (const action of [
    'create',
    'update',
    'delete',
    'export',
    'pdf_upload',
    'pdf_clone',
    'defaults_update',
  ]) {
    expect(auditActionLabel(`qrcode.${action}`)).not.toBe(`qrcode.${action}`);
  }
  expect(auditActionLabel('qrcode.export')).toBe('Label QR diekspor ke Drive');
});
