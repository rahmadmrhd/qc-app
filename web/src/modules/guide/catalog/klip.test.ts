import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { removeTempDirSync } from '../../../test/safe-rm';
import { type DemoScene, klipUrl, loadDemoScenes } from '../lib/demo-types';
import { GUIDE_CATALOG } from './index';

const PUBLIC_ROOT = join(process.cwd(), 'public');

/**
 * Masalah pada klip sebuah daftar adegan. Konvensi `berkas` (spek 4.6): NAMA POLOS berkas di `public/klip/`;
 * pemutar membangun URL `/klip/<berkas>` lewat `klipUrl`. Karena itu `berkas` tanpa path/ekstensi aneh dan berkasnya
 * ada di disk; URL yang dibangun pemutar sama dengan jalur berkas di `public/`.
 */
function klipProblems(label: string, scenes: readonly DemoScene[], publicRoot: string): string[] {
  const problems: string[] = [];
  for (const scene of scenes) {
    if (scene.kind !== 'klip' || !scene.berkas) continue; // tanpa berkas = belum direkam, lolos
    const { berkas } = scene;
    if (!/^[A-Za-z0-9._-]+\.(webm|mp4)$/.test(berkas) || berkas.includes('..')) {
      problems.push(`${label}: berkas "${berkas}" harus nama polos .webm/.mp4 (tanpa path)`);
      continue;
    }
    if (!existsSync(join(publicRoot, 'klip', berkas))) {
      problems.push(`${label}: klip ${berkas} tidak ada di web/public/klip/`);
    }
  }
  return problems;
}

describe('klip adegan demo nyata', () => {
  test('setiap entri tip di katalog punya adegan yang dapat dimuat', async () => {
    const tips = GUIDE_CATALOG.filter((entry) => entry.kind === 'tip');
    expect(tips.length).toBeGreaterThan(0);
    for (const tip of tips) {
      const scenes = await loadDemoScenes(tip.id);
      expect(scenes?.length, `${tip.id} tanpa adegan`).toBeGreaterThan(0);
    }
  });

  test('setiap klip yang dideklarasikan adegan tip ada berkasnya di web/public/klip', async () => {
    const problems: string[] = [];
    for (const tip of GUIDE_CATALOG.filter((entry) => entry.kind === 'tip')) {
      problems.push(...klipProblems(tip.id, (await loadDemoScenes(tip.id)) ?? [], PUBLIC_ROOT));
    }
    expect(problems).toEqual([]);
  });
});

describe('pemeriksa klip menangkap pelanggaran (contoh salah)', () => {
  const klip = (berkas?: string): DemoScene[] => [{ kind: 'klip', caption: 'x', berkas }];

  test('berkas ada = lolos; salah ketik/terhapus = tertangkap; tanpa berkas = lolos', () => {
    const root = mkdtempSync(join(tmpdir(), 'klip-'));
    try {
      mkdirSync(join(root, 'klip'));
      writeFileSync(join(root, 'klip', 'tip-a-1.webm'), 'x');
      expect(klipProblems('t', klip('tip-a-1.webm'), root)).toEqual([]);
      expect(klipProblems('t', klip('tip-a-l.webm'), root)).toHaveLength(1);
      expect(klipProblems('t', klip(undefined), root)).toEqual([]);
      expect(klipProblems('t', klip(''), root)).toEqual([]);
    } finally {
      removeTempDirSync(root);
    }
  });

  test('konvensi tunggal: berkas berisi path atau URL ditolak', () => {
    const root = mkdtempSync(join(tmpdir(), 'klip-'));
    try {
      mkdirSync(join(root, 'klip'));
      writeFileSync(join(root, 'klip', 'ada.webm'), 'x');
      expect(klipProblems('t', klip('/klip/ada.webm'), root)).toHaveLength(1);
      expect(klipProblems('t', klip('klip/ada.webm'), root)).toHaveLength(1);
      expect(klipProblems('t', klip('../ada.webm'), root)).toHaveLength(1);
    } finally {
      removeTempDirSync(root);
    }
  });

  test('URL yang dibangun pemutar menunjuk berkas di public/klip', () => {
    expect(klipUrl('tip-a-1.webm')).toBe('/klip/tip-a-1.webm');
    const root = mkdtempSync(join(tmpdir(), 'klip-'));
    try {
      mkdirSync(join(root, 'klip'));
      writeFileSync(join(root, 'klip', 'tip-a-1.webm'), 'x');
      // Vite menyajikan `public/` di akar: URL `/klip/x` = `<public>/klip/x`.
      expect(existsSync(join(root, klipUrl('tip-a-1.webm')))).toBe(true);
    } finally {
      removeTempDirSync(root);
    }
  });
});
