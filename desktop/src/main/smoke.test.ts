import { expect, test } from 'vitest';
import { collectSmokeReport } from './smoke';

test('collectSmokeReport mengembalikan versi node/electron dan memuat ssh2 serta node:sqlite', async () => {
  const report = await collectSmokeReport();
  expect(report.node).toBe(process.versions.node);
  // Di Node uji tidak ada Electron: versinya kosong.
  expect(typeof report.electron).toBe('string');
  expect(report.ssh2).toBe(true);
  expect(report.sqlite).toBe(true);
  // electron-updater (pembaruan otomatis) wajib termuat dari hasil kemas, bukan sekadar terpasang di mesin pengembang.
  expect(report.updater).toBe(true);
});
