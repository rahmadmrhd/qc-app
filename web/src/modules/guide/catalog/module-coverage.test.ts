import { describe, expect, test } from 'vitest';
import { MODULE_LINKS } from '@/app/module-links';
import { GUIDE_CATALOG } from './index';

/**
 * Modul di `MODULE_LINKS` yang BELUM punya panduan `dasar` (spek 4.7 meminta tiap modul berhalaman punya, tetapi
 * spek 7 hanya mencakup layout, PWA, push, dan Serah Terima pada tahap awal). Daftar ini sengaja eksplisit: modul
 * baru di `MODULE_LINKS` tanpa panduan dan tanpa dicantumkan di sini menggagalkan tes. Hapus entri begitu
 * panduannya ada.
 */
const MODULES_WITHOUT_GUIDE_YET: readonly string[] = [
  // Tahap berikutnya (spek 7 butir 4).
  'access',
  'item',
  'sticker',
  'stickerstock',
  // `serial` sudah punya panduan dasar (2026-11-17); tim servis (`serialservice`) belum dicakup.
  'serialservice',
  // Keluar Gudang (serialwh): panduan menyusul setelah fitur diuji di perangkat.
  'serialwh',
  // Dashboard: panduan interaktif di luar cakupan v1.
  'dashboard',
];

function modulesWithDasar(): Set<string> {
  const modules = new Set<string>();
  for (const entry of GUIDE_CATALOG) {
    if (entry.kind !== 'dasar' || entry.izin === undefined) continue;
    const alternatives = Array.isArray(entry.izin) ? entry.izin : [entry.izin];
    for (const permission of alternatives) modules.add(permission.module);
  }
  return modules;
}

describe('cakupan panduan dasar per modul', () => {
  const linked = Object.keys(MODULE_LINKS);

  test('setiap modul di MODULE_LINKS punya panduan dasar atau tercantum di daftar "belum"', () => {
    const covered = modulesWithDasar();
    const missing = linked.filter(
      (module) => !covered.has(module) && !MODULES_WITHOUT_GUIDE_YET.includes(module),
    );
    expect(missing).toEqual([]);
  });

  test('daftar "belum" tidak basi: hanya modul nyata yang belum punya panduan', () => {
    const covered = modulesWithDasar();
    const stale = MODULES_WITHOUT_GUIDE_YET.filter(
      (module) => !linked.includes(module) || covered.has(module),
    );
    expect(stale).toEqual([]);
  });
});
