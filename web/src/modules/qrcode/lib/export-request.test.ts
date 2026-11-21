import { afterEach, expect, test, vi } from 'vitest';
import { requestExportOnView, takeExportRequest } from './export-request';

afterEach(() => {
  vi.useRealTimers();
  takeExportRequest('d1');
});

test('permintaan diambil sekali untuk konfigurasi yang sama', () => {
  requestExportOnView('d1');
  expect(takeExportRequest('d2')).toBe(false);
  expect(takeExportRequest('d1')).toBe(true);
  expect(takeExportRequest('d1')).toBe(false);
});

test('permintaan basi (> 15 detik) diabaikan', () => {
  vi.useFakeTimers();
  requestExportOnView('d1');
  vi.advanceTimersByTime(16_000);
  expect(takeExportRequest('d1')).toBe(false);
});
