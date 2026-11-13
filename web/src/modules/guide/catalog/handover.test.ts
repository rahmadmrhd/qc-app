import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LocationAccessDto, MeDto } from '@shared/contract';
import { GUIDE_IDS, GUIDE_VERSIONS } from '@shared/guides';
import { describe, expect, test } from 'vitest';
import { getDemoScenes, loadDemoScenes } from '../lib/demo-types';
import { offeredGuides } from '../lib/offer';
import { HANDOVER_DASAR, HANDOVER_TIP_WA } from './handover';
import { GUIDE_CATALOG } from './index';

function me(locations: LocationAccessDto[]): MeDto {
  return {
    email: 'a@qc.local',
    name: 'A',
    isSuperAdmin: false,
    permissions: {} as MeDto['permissions'],
    locations,
    businessUnits: [],
    sharedAccount: false,
  };
}

function location(permissions: Record<string, string>): LocationAccessDto {
  return { id: 'L1', code: 'L1', name: 'L1', permissions } as unknown as LocationAccessDto;
}

const whViewer = me([location({ handover: 'view' })]);
const whEditor = me([location({ handover: 'edit' })]);
const qcUser = me([location({ qc: 'edit' })]);
const both = me([location({ handover: 'edit', qc: 'edit' })]);
const nobody = me([location({ item: 'view' })]);

function offerFor(user: MeDto) {
  return offeredGuides({
    me: user,
    catalog: GUIDE_CATALOG,
    done: new Map(),
    derived: new Map(),
    activeLocationIds: ['L1'],
  }).find((offer) => offer.entry.id === 'handover-dasar');
}

describe('muat malas adegan demo', () => {
  // Harus berjalan SEBELUM tes lain di berkas ini yang memuat adegan (registri adalah keadaan modul).
  test('memuat katalog tidak memuat atau mengeksekusi adegan demo', () => {
    expect(getDemoScenes(HANDOVER_TIP_WA.id)).toBeUndefined();
  });

  test('katalog hanya mengimpor adegan secara dinamis (tanpa import statis whatsapp-demo)', () => {
    const source = readFileSync(join(__dirname, 'handover.ts'), 'utf8');
    expect(source).not.toMatch(/^import[^;]*whatsapp-demo/m);
    expect(source).toMatch(/import\('@\/modules\/handover\/guide\/whatsapp-demo'\)/);
  });

  test('loadDemoScenes memuat sekali lalu menyimpan hasilnya', async () => {
    const first = await loadDemoScenes(HANDOVER_TIP_WA.id);
    expect(first?.length).toBeGreaterThan(0);
    expect(getDemoScenes(HANDOVER_TIP_WA.id)).toBe(first);
    expect(await loadDemoScenes(HANDOVER_TIP_WA.id)).toBe(first);
  });
});

describe('panduan Serah Terima', () => {
  test('id terdaftar di GUIDE_IDS dengan versi yang sama, dan ada di katalog', () => {
    for (const entry of [HANDOVER_DASAR, HANDOVER_TIP_WA]) {
      expect(GUIDE_IDS as readonly string[]).toContain(entry.id);
      expect((GUIDE_VERSIONS as Record<string, number>)[entry.id]).toBe(entry.version);
      expect(GUIDE_CATALOG).toContain(entry);
    }
    expect(HANDOVER_TIP_WA.id).toBe('tip-handover-tempel-wa');
    expect(HANDOVER_TIP_WA.kind).toBe('tip');
  });

  test('pengguna handover: view saja tidak menerima langkah sisi QC dan WH-tulis', () => {
    const viewer = offerFor(whViewer);
    const qc = offerFor(qcUser);
    const editor = offerFor(whEditor);
    const all = offerFor(both);
    expect(viewer).toBeDefined();
    expect(qc).toBeDefined();
    expect(editor).toBeDefined();
    expect(all).toBeDefined();
    // view saja: hanya langkah umum (papan + checklist).
    expect(viewer?.stepCount).toBe(2);
    expect(viewer?.stepCount).toBeLessThan(qc?.stepCount ?? 0);
    expect(qc?.stepCount).toBe(3);
    expect(editor?.stepCount).toBe(5);
    expect(all?.stepCount).toBe(HANDOVER_DASAR.steps.length);
  });

  test('pengguna tanpa izin Serah Terima/QC tidak ditawari', () => {
    expect(offerFor(nobody)).toBeUndefined();
  });

  test('langkah panel tempel menyematkan demo tip yang terdaftar di registri', async () => {
    const pasteStep = HANDOVER_DASAR.steps.find((step) => step.target === 'handover-paste-panel');
    expect(pasteStep?.tip).toBe(HANDOVER_TIP_WA.id);
    expect((await loadDemoScenes(HANDOVER_TIP_WA.id))?.length).toBeGreaterThan(0);
  });

  test('izin panduan sama dengan item sidebar: WH view atau QC edit, keduanya per lokasi', () => {
    expect(HANDOVER_DASAR.izin).toEqual([
      { module: 'handover', level: 'view', scope: 'location' },
      { module: 'qc', level: 'edit', scope: 'location' },
    ]);
    expect(HANDOVER_DASAR.halaman).toBe('/handover');
  });
});
