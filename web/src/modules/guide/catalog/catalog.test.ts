import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GUIDE_COVERS, GUIDE_IDS, GUIDE_VERSIONS, type GuideId } from '@shared/guides';
import { describe, expect, test } from 'vitest';
import type { GuideEntry } from '../lib/types';
import { GUIDE_CATALOG } from './index';

// Vitest berjalan dengan akar `web/` (vite.config.ts).
const SRC_ROOT = join(process.cwd(), 'src');
const PUBLIC_ROOT = join(process.cwd(), 'public');

// ---------------------------------------------------------------------------------------------
// Pemeriksa murni: dijalankan atas katalog nyata DAN atas contoh sengaja salah (agar terbukti
// menangkap pelanggaran walau katalog nyata masih kosong).
// ---------------------------------------------------------------------------------------------

function duplicateIds(catalog: readonly GuideEntry[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const entry of catalog) {
    if (seen.has(entry.id)) dupes.add(entry.id);
    seen.add(entry.id);
  }
  return [...dupes];
}

/** Entri `disimpan` harus terdaftar di `shared/guides.ts` dengan versi yang sama. */
function registryProblems(catalog: readonly GuideEntry[]): string[] {
  const problems: string[] = [];
  const ids = GUIDE_IDS as readonly string[];
  const versions = GUIDE_VERSIONS as Record<string, number>;
  for (const entry of catalog) {
    if (entry.status !== 'disimpan') continue;
    if (!ids.includes(entry.id)) {
      problems.push(`${entry.id}: tidak ada di GUIDE_IDS`);
      continue;
    }
    if (versions[entry.id] !== entry.version) {
      problems.push(`${entry.id}: versi ${entry.version} != GUIDE_VERSIONS ${versions[entry.id]}`);
    }
  }
  return problems;
}

/** `covers` katalog = `GUIDE_COVERS` bersama (satu sumber kebenaran) dan merujuk id yang ada. */
function coversProblems(
  catalog: readonly GuideEntry[],
  covers: Partial<Record<string, readonly string[]>> = GUIDE_COVERS,
): string[] {
  const problems: string[] = [];
  const ids = GUIDE_IDS as readonly string[];
  for (const entry of catalog) {
    if (entry.status !== 'disimpan') continue;
    const shared = [...(covers[entry.id] ?? [])].sort();
    const own = [...(entry.covers ?? [])].sort();
    if (JSON.stringify(shared) !== JSON.stringify(own)) {
      problems.push(
        `${entry.id}: covers ${JSON.stringify(own)} != shared ${JSON.stringify(shared)}`,
      );
    }
    for (const id of own) {
      if (!ids.includes(id)) problems.push(`${entry.id}: covers merujuk id tak dikenal ${id}`);
    }
  }
  return problems;
}

/** Id rute yang dikenal router (kunci `FileRoutesByTo` di `routeTree.gen.ts`). */
function knownRoutes(): string[] {
  const source = readFileSync(join(SRC_ROOT, 'routeTree.gen.ts'), 'utf8');
  const start = source.indexOf('export interface FileRoutesByTo {');
  const end = source.indexOf('\n}', start);
  const block = source.slice(start, end);
  return [...block.matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1] ?? '');
}

/** Rute statis cocok persis; rute dinamis (`$id`) cocok dengan segmen apa pun pada posisinya. */
function routeKnown(route: string, known: readonly string[]): boolean {
  const parts = route.split('/');
  return known.some((candidate) => {
    const want = candidate.split('/');
    return (
      want.length === parts.length &&
      want.every((segment, index) => segment.startsWith('$') || segment === parts[index])
    );
  });
}

function routeProblems(catalog: readonly GuideEntry[], known: readonly string[]): string[] {
  const problems: string[] = [];
  for (const entry of catalog) {
    for (const step of entry.steps) {
      if (step.route !== undefined && !routeKnown(step.route, known)) {
        problems.push(`${entry.id}: rute tak dikenal ${step.route}`);
      }
    }
  }
  return problems;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue;
      files.push(...sourceFiles(full));
    } else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\.[tj]sx?$/.test(name)) {
      files.push(full);
    }
  }
  return files;
}

/** Nilai `data-tour` literal dalam satu teks sumber: `data-tour="x"` atau `data-tour={'x'}`. */
function extractDataTour(text: string): string[] {
  const pattern = /data-tour=(?:"([^"]+)"|\{\s*['"`]([^'"`$]+)['"`]\s*\})/g;
  return [...text.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? '');
}

/** Semua nilai `data-tour` yang dipasang di sumber web (bukan berkas tes). */
function dataTourTargets(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC_ROOT)) {
    for (const target of extractDataTour(readFileSync(file, 'utf8'))) found.add(target);
  }
  return found;
}

function targetProblems(catalog: readonly GuideEntry[], targets: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const entry of catalog) {
    for (const step of entry.steps) {
      if (!targets.has(step.target)) {
        problems.push(`${entry.id}: data-tour="${step.target}" tidak ada di web/src`);
      }
    }
  }
  return problems;
}

/** Berkas yang dideklarasikan adegan `klip` di mana pun dalam entri (adegan tip dibangun task lain). */
function klipFiles(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) klipFiles(item, found);
  } else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const marker = record.kind ?? record.jenis ?? record.type;
    if (marker === 'klip' && typeof record.berkas === 'string' && record.berkas !== '') {
      found.push(record.berkas);
    }
    for (const child of Object.values(record)) klipFiles(child, found);
  }
  return found;
}

function klipProblems(catalog: readonly GuideEntry[], publicRoot: string): string[] {
  const problems: string[] = [];
  for (const entry of catalog) {
    for (const berkas of klipFiles(entry)) {
      if (!existsSync(join(publicRoot, 'klip', berkas))) {
        problems.push(`${entry.id}: klip ${berkas} tidak ada di web/public/klip/`);
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------

function entry(overrides: Partial<GuideEntry> = {}): GuideEntry {
  return {
    id: 'dasar-layout',
    kind: 'dasar',
    status: 'disimpan',
    version: 1,
    title: 'T',
    steps: [{ target: 'x', text: 't', advance: 'next' }],
    ...overrides,
  };
}

describe('katalog nyata', () => {
  test('id unik', () => {
    expect(duplicateIds(GUIDE_CATALOG)).toEqual([]);
  });

  test('entri disimpan terdaftar di shared/guides.ts dengan versi yang sama', () => {
    expect(registryProblems(GUIDE_CATALOG)).toEqual([]);
  });

  test('covers sama dengan GUIDE_COVERS dan merujuk id yang ada', () => {
    expect(coversProblems(GUIDE_CATALOG)).toEqual([]);
  });

  test('setiap step.route dikenal router', () => {
    expect(routeProblems(GUIDE_CATALOG, knownRoutes())).toEqual([]);
  });

  test('setiap step.target ada sebagai data-tour di web/src', () => {
    expect(targetProblems(GUIDE_CATALOG, dataTourTargets())).toEqual([]);
  });

  test('setiap klip yang dideklarasikan ada berkasnya di web/public/klip', () => {
    expect(klipProblems(GUIDE_CATALOG, PUBLIC_ROOT)).toEqual([]);
  });

  test('versi katalog bilangan bulat positif', () => {
    for (const item of GUIDE_CATALOG) {
      expect(Number.isInteger(item.version) && item.version >= 1).toBe(true);
    }
  });
});

describe('pemeriksa menangkap pelanggaran (contoh salah)', () => {
  test('id ganda', () => {
    expect(duplicateIds([entry(), entry()])).toEqual(['dasar-layout']);
  });

  test('id tak terdaftar dan versi menyimpang', () => {
    expect(registryProblems([entry({ id: 'tak-ada' })])).toHaveLength(1);
    expect(registryProblems([entry({ version: 9 })])).toHaveLength(1);
    expect(registryProblems([entry()])).toEqual([]);
  });

  test('entri diturunkan tidak harus terdaftar', () => {
    expect(registryProblems([entry({ id: 'pasang-pwa', status: 'diturunkan' })])).toEqual([]);
  });

  test('covers menyimpang dari sumber bersama atau merujuk id tak dikenal', () => {
    const shared: Partial<Record<GuideId, readonly string[]>> = {
      'handover-dasar': ['tip-handover-tempel-wa'],
    };
    const dasar = entry({ id: 'handover-dasar' });
    expect(coversProblems([dasar], shared)).toHaveLength(1);
    expect(coversProblems([{ ...dasar, covers: ['tip-handover-tempel-wa'] }], shared)).toEqual([]);
    expect(
      coversProblems([{ ...dasar, covers: ['hantu'] }], { 'handover-dasar': ['hantu'] }),
    ).toEqual(['handover-dasar: covers merujuk id tak dikenal hantu']);
  });

  test('rute: statis, dinamis, dan tak dikenal', () => {
    const known = ['/handover', '/handover/new', '/handover/$handoverId'];
    const withRoute = (route: string) =>
      entry({ steps: [{ target: 'x', text: 't', advance: 'next', route }] });
    expect(routeProblems([withRoute('/handover/new')], known)).toEqual([]);
    expect(routeProblems([withRoute('/handover/abc')], known)).toEqual([]);
    expect(routeProblems([withRoute('/nowhere')], known)).toHaveLength(1);
  });

  test('routeTree.gen.ts menghasilkan rute nyata', () => {
    const known = knownRoutes();
    expect(known).toContain('/handover/new');
    expect(known.length).toBeGreaterThan(5);
  });

  test('target data-tour: ada dan hilang', () => {
    const catalog = [entry({ steps: [{ target: 'ada', text: 't', advance: 'next' }] })];
    expect(targetProblems(catalog, new Set(['ada']))).toEqual([]);
    expect(targetProblems(catalog, new Set())).toHaveLength(1);
  });

  test('pemindai data-tour membaca bentuk string dan ekspresi literal', () => {
    expect(
      extractDataTour('<a data-tour="satu" /><b data-tour={\'dua\'} /><c data-tour={x} />'),
    ).toEqual(['satu', 'dua']);
  });

  test('klip: berkas ada, tidak ada, dan tanpa berkas lolos', () => {
    const base = entry();
    const withScenes = (scenes: unknown) => ({ ...base, scenes }) as unknown as GuideEntry;
    const temp = mkdtempSync(join(tmpdir(), 'klip-'));
    mkdirSync(join(temp, 'klip'));
    writeFileSync(join(temp, 'klip', 'ada.webm'), 'x');
    expect(klipProblems([withScenes([{ kind: 'klip', berkas: 'ada.webm' }])], temp)).toEqual([]);
    rmSync(temp, { recursive: true, force: true });
    expect(
      klipProblems([withScenes([{ kind: 'klip', berkas: 'tidak-ada-123.webm' }])], PUBLIC_ROOT),
    ).toHaveLength(1);
    expect(klipProblems([withScenes([{ kind: 'klip' }])], PUBLIC_ROOT)).toEqual([]);
    expect(klipProblems([withScenes([{ kind: 'klip', berkas: '' }])], PUBLIC_ROOT)).toEqual([]);
    expect(klipProblems([withScenes([{ kind: 'kode', berkas: 'x.webm' }])], PUBLIC_ROOT)).toEqual(
      [],
    );
  });
});
