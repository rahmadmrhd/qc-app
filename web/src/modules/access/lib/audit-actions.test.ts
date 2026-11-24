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

test('aksi audit tautan dashboard berlabel Indonesia', () => {
  expect(auditActionLabel('dashboard.share_create')).toBe('Tautan dashboard dibuat');
  expect(auditActionLabel('dashboard.share_revoke')).toBe('Tautan dashboard dicabut');
  expect(auditActionLabel('dashboard.share_expire')).toBe('Tautan dashboard kedaluwarsa');
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

test('aksi audit preset QR, katalog stiker, dan pengaturan stiker berlabel Indonesia', () => {
  for (const action of [
    'qrcode.preset_create',
    'qrcode.preset_update',
    'qrcode.preset_delete',
    'qrcode.preset_clone',
    'qrcode.logo_library_update',
    'sticker.create',
    'sticker.update',
    'sticker.status',
    'sticker.settings',
    'stickerType.create',
    'stickerType.update',
    'stickerType.status',
    'stickerGuide.rename',
    'stickerGuide.remove',
  ]) {
    expect(auditActionLabel(action)).not.toBe(action);
  }
  expect(auditActionLabel('sticker.settings')).toBe('Konfigurasi stiker diubah');
});

test('aksi hapus/pulihkan (soft delete) dan Business Unit berlabel Indonesia', () => {
  for (const kind of [
    'user',
    'role',
    'location',
    'businessunit',
    'brand',
    'customer',
    'item',
    'sticker',
    'stickerType',
    'postel',
    'qrcode',
  ]) {
    expect(auditActionLabel(`${kind}.restore`), `${kind}.restore`).not.toBe(`${kind}.restore`);
  }
  for (const kind of ['user', 'location', 'businessunit', 'brand', 'customer', 'item', 'sticker']) {
    expect(auditActionLabel(`${kind}.delete`), `${kind}.delete`).not.toBe(`${kind}.delete`);
  }
  expect(auditActionLabel('businessunit.deactivate')).toBe('Business Unit dinonaktifkan');
  expect(auditActionLabel('user.restore')).toBe('User dipulihkan');
});

test('aksi audit postel.* berlabel Indonesia', () => {
  expect(auditActionLabel('postel.create')).toBe('Postel dibuat');
  expect(auditActionLabel('postel.update')).toBe('Postel diubah');
  expect(auditActionLabel('postel.delete')).toBe('Postel dihapus');
  expect(auditActionLabel('postel.settings')).toBe('Konfigurasi Postel diubah');
});
