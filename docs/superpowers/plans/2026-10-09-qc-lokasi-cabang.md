# Lokasi/Cabang & Penugasan Akses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambah konsep Lokasi, penugasan user ke lokasi (role global, penugasan membawa role), izin per lokasi yang ditegakkan di server, serta pemilih lokasi aktif multi-select di header.

**Architecture:** Role tetap global. User punya daftar penugasan `{locationId | null, roleIds}`; `null` = "Semua lokasi". Fungsi murni `resolveAccess` (di `shared/`) menghitung izin global (hanya dari "Semua lokasi", dipakai modul `access`) dan izin per lokasi aktif. Router GAS mendapat `scope: 'location'` yang memvalidasi tiap lokasi yang diminta. Frontend menyimpan lokasi aktif di `localStorage` dan hanya memakainya untuk tampilan; server tidak mempercayainya.

**Tech Stack:** Bun 1.4 (workspaces `shared`, `gas`, `web`), TypeScript strict, GAS V8 (transpile per file), React + TanStack Router/Query/Form, shadcn, zod, Vitest, `bun:test`, Biome.

**Spec:** `docs/prd/2026-10-08-qc-lokasi-cabang.md` (bergantung pada `docs/prd/2026-10-08-qc-fondasi-akses.md`)

## Global Constraints

- Semua balasan, teks UI, pesan galat, dan komentar berbahasa Indonesia; identifier tetap Inggris/aslinya.
- Aturan GAS (`CLAUDE.md`, ditegakkan `scripts/build-gas.ts`): fungsi top-level di `gas/src` WAJIB berakhiran `_` kecuali `doGet`/`api`/`setup`; nama top-level unik di seluruh `gas/src` + `shared/`; dilarang `export default`, re-export, import alias/namespace/dynamic, `class`, `enum`; tanpa `Object.hasOwn`; karakter khusus lewat `String.fromCharCode`; akses API GAS hanya lewat `platform_()`; tulis sheet di dalam `platform_().withLock(...)`.
- Fungsi murni di `shared/` boleh tanpa akhiran `_` dan memakai import relatif (PRD fondasi NFR-2).
- Kode lokasi: huruf besar, angka, tanda hubung, **maksimal 10** karakter. Nama lokasi maks. 100.
- Lokasi tidak pernah dihapus, hanya dinonaktifkan.
- `bun run check` hijau sebelum push. Biome: `bunx biome check --write --linter-enabled=false <path>` untuk merapikan format tanpa menjalankan aturan lint yang mengubah kode.
- Commit diakhiri `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Jangan mengedit `gas/dist/` manual.
- Jalankan bun lewat `export PATH="$PATH:$HOME/.bun/bin"` (Git Bash) bila `bun` tidak ditemukan. Hindari perintah majemuk berisi `case ... ;;` di Bash tool (penulis ulang shell merusaknya); pakai berkas skrip.
- Typecheck `web` sengaja boleh merah dari akhir Task 3 sampai akhir Task 5 (kontrak `UserDto`/`MeDto` berubah di server lebih dulu); wajib hijau di akhir Task 5.

## Review Focus

Risiko yang spec tersirat tetapi tidak dijaga oleh tes tugas biasa; tiap baris punya tes di tugas pemiliknya:

1. **Deploy sebelum `setup`:** user lama masih punya `role_ids` dan belum punya `assignments`. Mereka tetap harus punya akses yang sama (fallback baca di repo). → Task 3.
2. **JSON penugasan rusak:** entri tanpa `locationId` (undefined) tidak boleh dianggap "Semua lokasi" (itu menaikkan hak diam-diam); hanya `null` eksplisit. → Task 1.
3. **Lokasi nonaktif:** penugasan lokal tidak berlaku, dan "Semua lokasi" tidak memberi izin di lokasi nonaktif. → Task 1 dan Task 3.
4. **Permintaan campuran lokasi diizinkan dan tidak:** seluruh permintaan `FORBIDDEN`, handler tidak dipanggil, dan lokasi tak dikenal tidak membedakan pesan dari lokasi terlarang (tidak membocorkan keberadaan). → Task 4.
5. **Admin mengedit penugasannya sendiri hingga kehilangan Kelola global:** `CONFLICT`; super admin dikecualikan. → Task 3.
6. **`localStorage` berisi lokasi basi:** pilihan disaring ke lokasi yang masih diizinkan; bila hasilnya kosong, kembali ke semua yang diizinkan. → Task 7.
7. **Kolom Lokasi pada tabel (FR-C5):** tabel modul berlokasi belum ada pada sub-project ini; kewajiban kolom Lokasi bila lebih dari satu lokasi terpilih dicatat di `docs/adding-a-module.md` (Task 8) dan ditegakkan di PRD modul pertama yang berlokasi.

---

## Setup (sekali, sebelum Task 1)

- [ ] **Step 1: Buat branch kerja dari branch PRD**

```bash
git switch docs/prd-lokasi
git switch -c feat/lokasi-cabang
```

Branch `docs/prd-lokasi` memuat dua commit PRD di atas `origin/dev`. Rencana ini ikut di-commit pada branch kerja.

- [ ] **Step 2: Commit rencana**

```bash
git add docs/superpowers/plans/2026-10-09-qc-lokasi-cabang.md
git commit -m "docs(plan): rencana implementasi lokasi/cabang" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Fungsi murni penugasan dan izin per lokasi (`shared/`)

**Files:**
- Create: `shared/assignments.ts`
- Test: `shared/assignments.test.ts`

**Interfaces:**
- Consumes: `PermissionMap`, `PartialPermissionMap`, `Level`, `ModuleKey`, `mergePermissions` dari `./permissions`.
- Produces (semua diekspor dari `shared/assignments.ts`):
  - `LOCATION_MODULES` (`['item','handover','stock']`), `type LocatedModule`, `type LocationPermissionMap = Record<LocatedModule, Level>`
  - `ALL_LOCATIONS_KEY = '*'`, `assignmentKey(locationId: string | null): string`
  - `interface Assignment { locationId: string | null; roleIds: string[] }`
  - `sanitizeAssignments(raw: unknown): Assignment[]`
  - `interface ResolvedAccess { global: PermissionMap; byLocation: Record<string, LocationPermissionMap> }`
  - `resolveAccess(assignments: readonly Assignment[], rolePermissions: ReadonlyMap<string, PartialPermissionMap>, activeLocationIds: readonly string[]): ResolvedAccess`
  - `fullLocationPermissions(): LocationPermissionMap`, `isLocatedModule(module: ModuleKey): module is LocatedModule`

- [ ] **Step 1: Tulis tes yang gagal** — `shared/assignments.test.ts`

```ts
import { describe, expect, test } from 'bun:test';
import {
  ALL_LOCATIONS_KEY,
  assignmentKey,
  fullLocationPermissions,
  isLocatedModule,
  resolveAccess,
  sanitizeAssignments,
} from './assignments';
import type { PartialPermissionMap } from './permissions';
import { emptyPermissions } from './permissions';

const roles = new Map<string, PartialPermissionMap>([
  ['view', { item: 'view' }],
  ['manage', { item: 'manage', stock: 'view' }],
  ['access', { access: 'manage' }],
  ['handover', { handover: 'edit' }],
]);

describe('sanitizeAssignments', () => {
  test('bukan array menghasilkan daftar kosong', () => {
    for (const raw of [null, undefined, 'x', 42, {}]) expect(sanitizeAssignments(raw)).toEqual([]);
  });

  test('hanya null eksplisit yang berarti Semua lokasi; locationId hilang atau kosong dibuang', () => {
    expect(
      sanitizeAssignments([
        { locationId: null, roleIds: ['a'] },
        { roleIds: ['b'] },
        { locationId: '', roleIds: ['c'] },
        { locationId: 7, roleIds: ['d'] },
        'bukan-objek',
      ]),
    ).toEqual([{ locationId: null, roleIds: ['a'] }]);
  });

  test('merapikan id, membuang bukan-teks, dan menggabungkan lokasi kembar', () => {
    expect(
      sanitizeAssignments([
        { locationId: ' A ', roleIds: [' r1 ', 3, '', 'r1'] },
        { locationId: 'A', roleIds: ['r2'] },
        { locationId: 'B', roleIds: 'rusak' },
      ]),
    ).toEqual([
      { locationId: 'A', roleIds: ['r1', 'r2'] },
      { locationId: 'B', roleIds: [] },
    ]);
  });
});

describe('assignmentKey', () => {
  test('null menjadi tanda bintang', () => {
    expect(assignmentKey(null)).toBe(ALL_LOCATIONS_KEY);
    expect(assignmentKey('loc-a')).toBe('loc-a');
  });
});

describe('resolveAccess', () => {
  test('tanpa penugasan: izin global kosong dan tidak ada lokasi', () => {
    expect(resolveAccess([], roles, ['A'])).toEqual({ global: emptyPermissions(), byLocation: {} });
  });

  test('Semua lokasi digabung dengan penugasan lokal, level tertinggi menang (FR-P6)', () => {
    const result = resolveAccess(
      [
        { locationId: null, roleIds: ['view'] },
        { locationId: 'A', roleIds: ['manage'] },
      ],
      roles,
      ['A', 'B'],
    );
    expect(result.byLocation.A).toEqual({ item: 'manage', handover: 'none', stock: 'view' });
    expect(result.byLocation.B).toEqual({ item: 'view', handover: 'none', stock: 'none' });
    expect(result.global.item).toBe('view');
  });

  test('role ber-access pada penugasan lokal diabaikan (FR-P7)', () => {
    const result = resolveAccess([{ locationId: 'A', roleIds: ['access'] }], roles, ['A']);
    expect(result.global.access).toBe('none');
    expect(result.byLocation).toEqual({});
  });

  test('role ber-access pada Semua lokasi menjadi izin global', () => {
    const result = resolveAccess([{ locationId: null, roleIds: ['access'] }], roles, ['A']);
    expect(result.global.access).toBe('manage');
    expect(result.byLocation).toEqual({});
  });

  test('lokasi nonaktif (tidak ada di daftar aktif) tidak mendapat izin apa pun (FR-P8)', () => {
    const result = resolveAccess(
      [
        { locationId: null, roleIds: ['view'] },
        { locationId: 'MATI', roleIds: ['manage'] },
      ],
      roles,
      ['A'],
    );
    expect(Object.keys(result.byLocation)).toEqual(['A']);
  });

  test('role yang tidak dikenal diabaikan', () => {
    const result = resolveAccess([{ locationId: null, roleIds: ['hilang', 'view'] }], roles, ['A']);
    expect(result.global.item).toBe('view');
    expect(result.byLocation.A?.item).toBe('view');
  });

  test('lokasi tempat semua level none tidak dimasukkan', () => {
    const result = resolveAccess([{ locationId: 'A', roleIds: ['view'] }], roles, ['A', 'B']);
    expect(Object.keys(result.byLocation)).toEqual(['A']);
  });

  test('beberapa role pada satu penugasan memberi level tertinggi per modul', () => {
    const result = resolveAccess([{ locationId: 'A', roleIds: ['view', 'handover'] }], roles, ['A']);
    expect(result.byLocation.A).toEqual({ item: 'view', handover: 'edit', stock: 'none' });
  });
});

describe('modul berlokasi', () => {
  test('access global, sisanya berlokasi', () => {
    expect(isLocatedModule('access')).toBe(false);
    expect(isLocatedModule('item')).toBe(true);
    expect(isLocatedModule('handover')).toBe(true);
    expect(isLocatedModule('stock')).toBe(true);
  });

  test('fullLocationPermissions memberi manage di semua modul berlokasi', () => {
    expect(fullLocationPermissions()).toEqual({ item: 'manage', handover: 'manage', stock: 'manage' });
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd shared test assignments`
Expected: FAIL — `Cannot find module './assignments'`.

- [ ] **Step 3: Implementasi** — `shared/assignments.ts`

```ts
import type { Level, ModuleKey, PartialPermissionMap, PermissionMap } from './permissions';
import { mergePermissions } from './permissions';

/** Modul yang izinnya dihitung per lokasi. `access` bersifat global (PRD FR-P7). */
export const LOCATION_MODULES = ['item', 'handover', 'stock'] as const;
export type LocatedModule = (typeof LOCATION_MODULES)[number];
export type LocationPermissionMap = Record<LocatedModule, Level>;

/** Kunci peta/snapshot untuk penugasan "Semua lokasi". */
export const ALL_LOCATIONS_KEY = '*';

export interface Assignment {
  /** `null` = "Semua lokasi" (hanya null eksplisit; nilai hilang bukan Semua lokasi). */
  locationId: string | null;
  roleIds: string[];
}

export interface ResolvedAccess {
  /** Izin dari penugasan "Semua lokasi" saja; satu-satunya sumber untuk modul `access`. */
  global: PermissionMap;
  /** Izin efektif per lokasi aktif; lokasi tanpa izin apa pun tidak dimasukkan. */
  byLocation: Record<string, LocationPermissionMap>;
}

export function assignmentKey(locationId: string | null): string {
  return locationId ?? ALL_LOCATIONS_KEY;
}

export function isLocatedModule(module: ModuleKey): module is LocatedModule {
  return (LOCATION_MODULES as readonly string[]).includes(module);
}

export function fullLocationPermissions(): LocationPermissionMap {
  return { item: 'manage', handover: 'manage', stock: 'manage' };
}

function cleanAssignmentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (id !== '' && !result.includes(id)) result.push(id);
  }
  return result;
}

/** Tolerant terhadap JSON hasil edit manual: entri rusak dibuang, lokasi kembar digabung. */
export function sanitizeAssignments(raw: unknown): Assignment[] {
  if (!Array.isArray(raw)) return [];
  const result: Assignment[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const { locationId, roleIds } = item as { locationId?: unknown; roleIds?: unknown };
    let location: string | null;
    if (locationId === null) location = null;
    else if (typeof locationId === 'string' && locationId.trim() !== '') location = locationId.trim();
    else continue;
    const ids = cleanAssignmentIds(roleIds);
    const existing = result.find((entry) => entry.locationId === location);
    if (existing) {
      for (const id of ids) if (!existing.roleIds.includes(id)) existing.roleIds.push(id);
    } else {
      result.push({ locationId: location, roleIds: ids });
    }
  }
  return result;
}

function rolePermissionSources(
  roleIds: readonly string[],
  rolePermissions: ReadonlyMap<string, PartialPermissionMap>,
): PartialPermissionMap[] {
  const sources: PartialPermissionMap[] = [];
  for (const id of roleIds) {
    const permissions = rolePermissions.get(id);
    if (permissions) sources.push(permissions);
  }
  return sources;
}

/**
 * Izin efektif seorang user: global (hanya "Semua lokasi") dan per lokasi aktif
 * (gabungan "Semua lokasi" + penugasan lokasi itu; level tertinggi per modul).
 */
export function resolveAccess(
  assignments: readonly Assignment[],
  rolePermissions: ReadonlyMap<string, PartialPermissionMap>,
  activeLocationIds: readonly string[],
): ResolvedAccess {
  const everywhere = assignments.find((entry) => entry.locationId === null);
  const globalSources = rolePermissionSources(everywhere?.roleIds ?? [], rolePermissions);
  const byLocation: Record<string, LocationPermissionMap> = {};
  for (const locationId of activeLocationIds) {
    const local = assignments.find((entry) => entry.locationId === locationId);
    const merged = mergePermissions([
      ...globalSources,
      ...rolePermissionSources(local?.roleIds ?? [], rolePermissions),
    ]);
    const entry: LocationPermissionMap = {
      item: merged.item,
      handover: merged.handover,
      stock: merged.stock,
    };
    if (LOCATION_MODULES.some((module) => entry[module] !== 'none')) byLocation[locationId] = entry;
  }
  return { global: mergePermissions(globalSources), byLocation };
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `bun run --cwd shared test`
Expected: semua lulus (tes lama `permissions.test.ts` + 12 tes baru).

- [ ] **Step 5: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false shared
git add shared/assignments.ts shared/assignments.test.ts
git commit -m "feat(shared): fungsi murni penugasan dan izin per lokasi" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Lokasi di backend (sheet, layanan, validasi, rute, audit)

**Files:**
- Modify: `shared/rpc.ts`, `gas/src/modules/access/repo.ts`, `gas/src/modules/access/service.ts` (hanya `export` pada `nowIso_`), `gas/src/modules/access/validate.ts`, `gas/src/modules/access/routes.ts`, `gas/src/setup.ts`, `gas/src/setup.test.ts`, `gas/src/routes.test.ts`, `gas/test-support/access-fixtures.ts`
- Create: `gas/src/modules/access/location-service.ts`
- Test: `gas/src/modules/access/location.test.ts`

**Interfaces:**
- Consumes: `TableSchema`, `RowData`, `readTable_`, `insertRow_`, `updateRow_` (`core/db`); `appendAudit_`, `UserContext`, `invalidateAccessCache_`; `nowIso_` (diekspor dari `service.ts`).
- Produces:
  - `shared/rpc.ts`: `LocationStatus`, `LocationDto {id, code, name, status, createdAt, updatedAt, updatedBy}`, `SaveLocationInput {id?, code, name}`, `SetLocationStatusInput {id, status}`; kontrak `'access.locations.list' | 'access.locations.save' | 'access.locations.setStatus'`.
  - `repo.ts`: `LOCATIONS_TABLE`, `LocationRecord`, `NewLocationRecord`, `listLocations_()`, `insertLocation_(l)`, `updateLocation_(l)`.
  - `location-service.ts`: `listLocationDtos_()`, `saveLocation_(input, actor)`, `setLocationStatus_(input, actor)`.
  - `validate.ts`: `validateSaveLocation_`, `validateSetLocationStatus_`.
  - fixture `location(overrides)` di `access-fixtures.ts`.

- [ ] **Step 1: Tambah tipe RPC** — `shared/rpc.ts`

Tambahkan sebelum `export interface RpcContract {`:

```ts
export type LocationStatus = 'active' | 'inactive';

export interface LocationDto {
  id: string;
  /** Kode unik, huruf besar/angka/tanda hubung, maks. 10; tidak dapat diubah setelah dibuat. */
  code: string;
  name: string;
  status: LocationStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SaveLocationInput {
  id?: string;
  code: string;
  name: string;
}

export interface SetLocationStatusInput {
  id: string;
  status: LocationStatus;
}
```

Di dalam `RpcContract` tambahkan:

```ts
  'access.locations.list': { input: null; output: LocationDto[] };
  'access.locations.save': { input: SaveLocationInput; output: LocationDto };
  'access.locations.setStatus': { input: SetLocationStatusInput; output: LocationDto };
```

- [ ] **Step 2: Fixture** — tambah di `gas/test-support/access-fixtures.ts`

Ubah baris import pertama menjadi:

```ts
import type { NewLocationRecord, NewRoleRecord, NewUserRecord } from '@gas/modules/access/repo';
```

Tambahkan di akhir berkas:

```ts
export function location(
  overrides: Partial<NewLocationRecord> & Pick<NewLocationRecord, 'id' | 'code'>,
): NewLocationRecord {
  return {
    name: overrides.code,
    status: 'active',
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    updatedBy: 'seed',
    ...overrides,
  };
}
```

- [ ] **Step 3: Tulis tes yang gagal** — `gas/src/modules/access/location.test.ts`

```ts
import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { location } from '@gas-test/access-fixtures';
import { captureAppError } from '@gas-test/errors';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import type { UserContext } from './context';
import { loadUserContext_ } from './context';
import { listLocationDtos_, saveLocation_, setLocationStatus_ } from './location-service';
import { insertLocation_, listAuditRecords_ } from './repo';
import { validateSaveLocation_, validateSetLocationStatus_ } from './validate';

let admin: UserContext;

beforeEach(() => {
  setPlatform_(
    createMemoryPlatform({
      properties: { ADMIN_EMAIL: 'admin@gmail.com' },
      now: () => Date.parse('2026-10-09T00:00:00.000Z'),
    }),
  );
  insertLocation_(location({ id: 'l-bdg', code: 'BDG', name: 'Bandung' }));
  insertLocation_(location({ id: 'l-jkt', code: 'JKT', name: 'Jakarta' }));
  const ctx = loadUserContext_('admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
});

function lastAudit() {
  const record = listAuditRecords_().at(-1);
  if (!record) throw new Error('audit kosong');
  return record;
}

test('listLocationDtos_ terurut menurut kode', () => {
  expect(listLocationDtos_().map((l) => l.code)).toEqual(['BDG', 'JKT']);
});

test('membuat lokasi: aktif, tercatat pelakunya, audit before kosong', () => {
  const created = saveLocation_({ code: 'SBY', name: 'Surabaya' }, admin);
  expect(created).toMatchObject({
    code: 'SBY',
    name: 'Surabaya',
    status: 'active',
    updatedBy: 'admin@gmail.com',
    createdAt: '2026-10-09T00:00:00.000Z',
  });
  expect(listLocationDtos_().map((l) => l.code)).toEqual(['BDG', 'JKT', 'SBY']);
  expect(lastAudit()).toMatchObject({
    action: 'location.create',
    target: 'SBY',
    before: null,
    after: { code: 'SBY', name: 'Surabaya', status: 'active' },
  });
});

test('kode dan nama harus unik (nama tanpa membedakan huruf besar)', () => {
  expect(captureAppError(() => saveLocation_({ code: 'JKT', name: 'Lain' }, admin))).toMatchObject({
    code: 'CONFLICT',
    fields: { code: 'Kode lokasi sudah dipakai' },
  });
  expect(captureAppError(() => saveLocation_({ code: 'XXX', name: 'jakarta' }, admin))).toMatchObject({
    code: 'CONFLICT',
    fields: { name: 'Nama lokasi sudah dipakai' },
  });
});

test('mengubah nama menyimpan snapshot sebelum dan sesudah; kode tidak dapat diubah', () => {
  const updated = saveLocation_({ id: 'l-jkt', code: 'JKT', name: 'Jakarta Pusat' }, admin);
  expect(updated.name).toBe('Jakarta Pusat');
  expect(lastAudit()).toMatchObject({
    action: 'location.update',
    before: { code: 'JKT', name: 'Jakarta', status: 'active' },
    after: { code: 'JKT', name: 'Jakarta Pusat', status: 'active' },
  });
  expect(
    captureAppError(() => saveLocation_({ id: 'l-jkt', code: 'JK2', name: 'Jakarta' }, admin)),
  ).toMatchObject({ code: 'VALIDATION', fields: { code: 'Kode tidak dapat diubah' } });
  expect(
    captureAppError(() => saveLocation_({ id: 'tidak-ada', code: 'ZZZ', name: 'Z' }, admin)).code,
  ).toBe('NOT_FOUND');
});

test('nonaktifkan dan aktifkan lokasi tercatat; status sama tidak mencatat apa pun', () => {
  expect(setLocationStatus_({ id: 'l-bdg', status: 'inactive' }, admin).status).toBe('inactive');
  expect(lastAudit()).toMatchObject({
    action: 'location.deactivate',
    target: 'BDG',
    before: { status: 'active' },
    after: { status: 'inactive' },
  });
  const count = listAuditRecords_().length;
  setLocationStatus_({ id: 'l-bdg', status: 'inactive' }, admin);
  expect(listAuditRecords_()).toHaveLength(count);
  expect(setLocationStatus_({ id: 'l-bdg', status: 'active' }, admin).status).toBe('active');
  expect(lastAudit().action).toBe('location.activate');
  expect(
    captureAppError(() => setLocationStatus_({ id: 'tidak-ada', status: 'active' }, admin)).code,
  ).toBe('NOT_FOUND');
});

test('validateSaveLocation_ menormalkan kode ke huruf besar dan menolak yang tidak sah', () => {
  expect(validateSaveLocation_({ code: ' jkt-01 ', name: ' Jakarta ' })).toEqual({
    code: 'JKT-01',
    name: 'Jakarta',
  });
  expect(validateSaveLocation_({ id: 'x', code: 'A', name: 'B' })).toEqual({ id: 'x', code: 'A', name: 'B' });
  expect(captureAppError(() => validateSaveLocation_({ code: '', name: '' })).fields).toEqual({
    code: 'Wajib diisi',
    name: 'Wajib diisi',
  });
  expect(captureAppError(() => validateSaveLocation_({ code: 'AB CD', name: 'X' })).fields?.code).toBe(
    'Hanya huruf, angka, dan tanda hubung',
  );
  expect(captureAppError(() => validateSaveLocation_({ code: 'ABCDEFGHIJK', name: 'X' })).fields?.code).toBe(
    'Maksimal 10 karakter',
  );
});

test('validateSetLocationStatus_ mewajibkan id dan status sah', () => {
  expect(validateSetLocationStatus_({ id: 'l1', status: 'inactive' })).toEqual({
    id: 'l1',
    status: 'inactive',
  });
  expect(captureAppError(() => validateSetLocationStatus_({ id: '', status: 'x' })).fields).toEqual({
    id: 'Wajib diisi',
    status: 'Nilai tidak valid',
  });
});
```

- [ ] **Step 4: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test location`
Expected: FAIL — modul `./location-service` / ekspor `insertLocation_` belum ada.

- [ ] **Step 5: Repo** — `gas/src/modules/access/repo.ts`

Tambahkan `LocationStatus` pada import `@shared/rpc`:

```ts
import type { LocationStatus, UserStatus } from '@shared/rpc';
```

Tambahkan setelah `AUDIT_TABLE`:

```ts
export const LOCATIONS_TABLE: TableSchema = {
  sheetName: 'locations',
  columns: ['id', 'code', 'name', 'status', 'created_at', 'updated_at', 'updated_by'],
};
```

Tambahkan setelah `NewRoleRecord`:

```ts
export interface LocationRecord {
  rowNumber: number;
  id: string;
  code: string;
  name: string;
  status: LocationStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewLocationRecord = Omit<LocationRecord, 'rowNumber'>;
```

Tambahkan sebelum `export function appendAudit_`:

```ts
function toLocationRecord_(rowNumber: number, data: RowData): LocationRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    code: (data.code ?? '').trim().toUpperCase(),
    name: (data.name ?? '').trim(),
    status: (data.status ?? '').trim() === 'active' ? 'active' : 'inactive',
    createdAt: data.created_at ?? '',
    updatedAt: data.updated_at ?? '',
    updatedBy: data.updated_by ?? '',
  };
}

function fromLocationRecord_(location: NewLocationRecord): RowData {
  return {
    id: location.id,
    code: location.code,
    name: location.name,
    status: location.status,
    created_at: location.createdAt,
    updated_at: location.updatedAt,
    updated_by: location.updatedBy,
  };
}

export function listLocations_(): LocationRecord[] {
  return readTable_(LOCATIONS_TABLE)
    .rows.map(({ rowNumber, data }) => toLocationRecord_(rowNumber, data))
    .filter((location) => location.id !== '' && location.code !== '');
}

export function insertLocation_(location: NewLocationRecord): void {
  insertRow_(LOCATIONS_TABLE, fromLocationRecord_(location));
}

export function updateLocation_(location: LocationRecord): void {
  updateRow_(LOCATIONS_TABLE, location.rowNumber, fromLocationRecord_(location));
}
```

- [ ] **Step 6: Ekspor `nowIso_`** — `gas/src/modules/access/service.ts`

Ubah `function nowIso_(): string {` menjadi `export function nowIso_(): string {`.

- [ ] **Step 7: Layanan lokasi** — `gas/src/modules/access/location-service.ts`

```ts
import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import type { LocationDto, SaveLocationInput, SetLocationStatusInput } from '@shared/rpc';
import type { UserContext } from './context';
import { invalidateAccessCache_ } from './context';
import type { LocationRecord, NewLocationRecord } from './repo';
import { appendAudit_, insertLocation_, listLocations_, updateLocation_ } from './repo';
import { nowIso_ } from './service';

function toLocationDto_(location: NewLocationRecord): LocationDto {
  return {
    id: location.id,
    code: location.code,
    name: location.name,
    status: location.status,
    createdAt: location.createdAt,
    updatedAt: location.updatedAt,
    updatedBy: location.updatedBy,
  };
}

function locationSnapshot_(location: NewLocationRecord): Record<string, unknown> {
  return { code: location.code, name: location.name, status: location.status };
}

export function listLocationDtos_(): LocationDto[] {
  return listLocations_()
    .map(toLocationDto_)
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function saveLocation_(input: SaveLocationInput, actor: UserContext): LocationDto {
  return platform_().withLock(() => {
    const locations = listLocations_();
    const others = locations.filter((location) => location.id !== input.id);
    if (others.some((location) => location.code === input.code)) {
      throw appError_('CONFLICT', 'Kode lokasi sudah dipakai', { code: 'Kode lokasi sudah dipakai' });
    }
    const nameKey = input.name.toLowerCase();
    if (others.some((location) => location.name.toLowerCase() === nameKey)) {
      throw appError_('CONFLICT', 'Nama lokasi sudah dipakai', { name: 'Nama lokasi sudah dipakai' });
    }
    const now = nowIso_();

    if (input.id) {
      const existing = locations.find((location) => location.id === input.id);
      if (!existing) throw appError_('NOT_FOUND', 'Lokasi tidak ditemukan');
      if (existing.code !== input.code) {
        throw appError_('VALIDATION', 'Kode tidak dapat diubah', { code: 'Kode tidak dapat diubah' });
      }
      const updated: LocationRecord = {
        ...existing,
        name: input.name,
        updatedAt: now,
        updatedBy: actor.email,
      };
      updateLocation_(updated);
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'location.update',
        target: updated.code,
        before: locationSnapshot_(existing),
        after: locationSnapshot_(updated),
      });
      invalidateAccessCache_();
      return toLocationDto_(updated);
    }

    const created: NewLocationRecord = {
      id: platform_().uuid(),
      code: input.code,
      name: input.name,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      updatedBy: actor.email,
    };
    insertLocation_(created);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'location.create',
      target: created.code,
      before: null,
      after: locationSnapshot_(created),
    });
    invalidateAccessCache_();
    return toLocationDto_(created);
  });
}

export function setLocationStatus_(input: SetLocationStatusInput, actor: UserContext): LocationDto {
  return platform_().withLock(() => {
    const existing = listLocations_().find((location) => location.id === input.id);
    if (!existing) throw appError_('NOT_FOUND', 'Lokasi tidak ditemukan');
    if (existing.status === input.status) return toLocationDto_(existing);
    const now = nowIso_();
    const updated: LocationRecord = {
      ...existing,
      status: input.status,
      updatedAt: now,
      updatedBy: actor.email,
    };
    updateLocation_(updated);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'location.activate' : 'location.deactivate',
      target: existing.code,
      before: locationSnapshot_(existing),
      after: locationSnapshot_(updated),
    });
    invalidateAccessCache_();
    return toLocationDto_(updated);
  });
}
```

- [ ] **Step 8: Validator** — `gas/src/modules/access/validate.ts`

Tambahkan `SaveLocationInput` dan `SetLocationStatusInput` ke import dari `@shared/rpc`, lalu tambahkan sebelum `validateDeleteRole_`:

```ts
const LOCATION_CODE_PATTERN = /^[A-Z0-9-]+$/;

export function validateSaveLocation_(raw: unknown): SaveLocationInput {
  const reader = readObject_(raw);
  const id = reader.optionalId('id');
  const code = reader.str('code', { required: true, max: 10 }).toUpperCase();
  const name = reader.str('name', { required: true, max: 100 });
  if (code !== '' && code.length <= 10 && !LOCATION_CODE_PATTERN.test(code)) {
    reader.fail('code', 'Hanya huruf, angka, dan tanda hubung');
  }
  reader.done();
  return id ? { id, code, name } : { code, name };
}

export function validateSetLocationStatus_(raw: unknown): SetLocationStatusInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true });
  const status = reader.oneOf('status', USER_STATUS_VALUES);
  reader.done();
  return { id, status };
}
```

- [ ] **Step 9: Rute** — `gas/src/modules/access/routes.ts`

Tambah import `listLocationDtos_`, `saveLocation_`, `setLocationStatus_` dari `./location-service`, dan `validateSaveLocation_`, `validateSetLocationStatus_` dari `./validate`. Tambahkan ke union `AccessMethod`: `| 'access.locations.list' | 'access.locations.save' | 'access.locations.setStatus'`. Tambahkan ke objek kembalian (setelah `'access.audit.list'`):

```ts
    'access.locations.list': {
      permission: { module: 'access', level: 'view' },
      validate: expectNull_,
      handler: () => listLocationDtos_(),
    },
    'access.locations.save': {
      permission: { module: 'access', level: 'manage' },
      validate: validateSaveLocation_,
      handler: (input, ctx) => saveLocation_(input, ctx.user),
    },
    'access.locations.setStatus': {
      permission: { module: 'access', level: 'manage' },
      validate: validateSetLocationStatus_,
      handler: (input, ctx) => setLocationStatus_(input, ctx.user),
    },
```

- [ ] **Step 10: Setup dan tes tabel rute** 

`gas/src/setup.ts`: tambahkan `LOCATIONS_TABLE` ke import dari `@gas/modules/access/repo` dan ubah daftar menjadi `[USERS_TABLE, ROLES_TABLE, AUDIT_TABLE, LOCATIONS_TABLE]`.

`gas/src/setup.test.ts`: ubah ekspektasi `[...platform.db.sheets.keys()]` menjadi `['users', 'roles', 'audit_log', 'locations']`.

`gas/src/routes.test.ts`: tambahkan `'access.locations.list'`, `'access.locations.save'`, `'access.locations.setStatus'` ke daftar kunci terurut (sisipkan sesuai urutan abjad: setelah `'access.audit.list'`), tambahkan `'access.locations.list'` ke loop level `view`, dan `'access.locations.save'`, `'access.locations.setStatus'` ke loop level `manage`.

- [ ] **Step 11: Jalankan semua tes dan typecheck gas**

Run: `bun run --cwd gas test && bun run --cwd gas typecheck`
Expected: semua lulus, typecheck bersih.

- [ ] **Step 12: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas shared
git add shared gas
git commit -m "feat(access): lokasi — sheet, layanan, validasi, rute, dan audit" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Penugasan user, konteks izin, `auth.me`, dan migrasi (backend)

**Files:**
- Modify: `shared/rpc.ts`, `gas/src/modules/access/repo.ts`, `gas/src/modules/access/context.ts`, `gas/src/modules/access/service.ts`, `gas/src/modules/access/validate.ts`, `gas/src/modules/auth/routes.ts`, `gas/src/setup.ts`, `gas/test-support/access-fixtures.ts`
- Test (ubah): `gas/src/modules/access/context.test.ts`, `service.test.ts`, `validate.test.ts`, `gas/src/setup.test.ts`
- Test (baru): `gas/src/modules/access/assignments.test.ts`, `gas/src/modules/auth/routes.test.ts`

**Interfaces:**
- Consumes (Task 1): `Assignment`, `LocationPermissionMap`, `assignmentKey`, `fullLocationPermissions`, `resolveAccess`, `sanitizeAssignments`. (Task 2): `listLocations_`, fixture `location`.
- Produces:
  - `shared/rpc.ts`: `UserDto.assignments: Assignment[]` (menggantikan `roleIds`), `SaveUserInput.assignments: Assignment[]`, `LocationAccessDto {id, code, name, permissions: LocationPermissionMap}`, `MeDto.locations: LocationAccessDto[]`.
  - `repo.ts`: `UserRecord.assignments: Assignment[]` (menggantikan `roleIds`), `migrateUserAssignments_(): number`, kolom `assignments` pada `USERS_TABLE`.
  - `context.ts`: `UserContext.locations: Record<string, LocationPermissionMap>`; `UserContext.permissions` = izin global.
  - `validate.ts`: `validateSaveUser_` menerima `assignments`.
  - fixture `user()` menerima `roleIds` sebagai pintasan penugasan "Semua lokasi" (`assignments` eksplisit menang).

- [ ] **Step 1: Tipe RPC** — `shared/rpc.ts`

Tambahkan import di atas:

```ts
import type { Assignment, LocationPermissionMap } from './assignments';
```

Pada `UserDto` ganti `roleIds: string[];` dengan `assignments: Assignment[];`. Pada `SaveUserInput` ganti `roleIds: string[];` dengan `assignments: Assignment[];`. Tambahkan sebelum `MeDto` dan ubah `MeDto`:

```ts
export interface LocationAccessDto {
  id: string;
  code: string;
  name: string;
  /** Izin efektif user di lokasi ini (gabungan "Semua lokasi" dan penugasan lokasi). */
  permissions: LocationPermissionMap;
}

export interface MeDto {
  email: string;
  name: string;
  isSuperAdmin: boolean;
  /** Izin GLOBAL: hanya dari penugasan "Semua lokasi" (satu-satunya sumber modul `access`). */
  permissions: PermissionMap;
  /** Lokasi aktif yang boleh diakses, terurut menurut kode. */
  locations: LocationAccessDto[];
}
```

- [ ] **Step 2: Fixture** — `gas/test-support/access-fixtures.ts`

Ganti fungsi `user` dengan:

```ts
type UserFixture = Partial<NewUserRecord> &
  Pick<NewUserRecord, 'id' | 'email'> & {
    /** Pintasan: penugasan "Semua lokasi" dengan role ini. `assignments` eksplisit menang. */
    roleIds?: string[];
  };

export function user(overrides: UserFixture): NewUserRecord {
  const { roleIds, ...rest } = overrides;
  return {
    name: rest.email,
    status: 'active',
    assignments: roleIds && roleIds.length > 0 ? [{ locationId: null, roleIds }] : [],
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    updatedBy: 'seed',
    ...rest,
  };
}
```

- [ ] **Step 3: Tulis tes repo, migrasi, dan konteks yang gagal** — `gas/src/modules/access/assignments.test.ts`

```ts
import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { location, role, user } from '@gas-test/access-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { fullLocationPermissions } from '@shared/assignments';
import { fullPermissions } from '@shared/permissions';
import { invalidateAccessCache_, loadUserContext_ } from './context';
import {
  insertLocation_,
  insertRole_,
  insertUser_,
  listLocations_,
  listUsers_,
  migrateUserAssignments_,
  updateLocation_,
} from './repo';

let platform: MemoryPlatform;

beforeEach(() => {
  platform = createMemoryPlatform({ properties: { ADMIN_EMAIL: 'admin@gmail.com' } });
  setPlatform_(platform);
  insertRole_(role({ id: 'r-view', name: 'Viewer', permissions: { item: 'view' } }));
  insertRole_(role({ id: 'r-manage', name: 'Manager', permissions: { item: 'manage', stock: 'view' } }));
  insertRole_(role({ id: 'r-access', name: 'Admin', permissions: { access: 'manage' } }));
  insertLocation_(location({ id: 'l-a', code: 'A' }));
  insertLocation_(location({ id: 'l-b', code: 'B' }));
  insertLocation_(location({ id: 'l-mati', code: 'MATI', status: 'inactive' }));
});

test('hak berbeda di tiap lokasi untuk satu user (FR-P6)', () => {
  insertUser_(
    user({
      id: 'u1',
      email: 'budi@gmail.com',
      assignments: [
        { locationId: null, roleIds: ['r-view'] },
        { locationId: 'l-a', roleIds: ['r-manage'] },
      ],
    }),
  );
  const ctx = loadUserContext_('budi@gmail.com');
  expect(ctx?.locations['l-a']).toEqual({ item: 'manage', handover: 'none', stock: 'view' });
  expect(ctx?.locations['l-b']).toEqual({ item: 'view', handover: 'none', stock: 'none' });
  expect(ctx?.permissions.item).toBe('view');
});

test('Pengaturan Akses hanya dari Semua lokasi (FR-P7)', () => {
  insertUser_(
    user({ id: 'u1', email: 'lokal@gmail.com', assignments: [{ locationId: 'l-a', roleIds: ['r-access'] }] }),
  );
  insertUser_(
    user({ id: 'u2', email: 'pusat@gmail.com', assignments: [{ locationId: null, roleIds: ['r-access'] }] }),
  );
  expect(loadUserContext_('lokal@gmail.com')?.permissions.access).toBe('none');
  expect(loadUserContext_('pusat@gmail.com')?.permissions.access).toBe('manage');
});

test('lokasi nonaktif tidak memberi izin walau ada penugasannya (FR-P8)', () => {
  insertUser_(
    user({
      id: 'u1',
      email: 'budi@gmail.com',
      assignments: [
        { locationId: null, roleIds: ['r-view'] },
        { locationId: 'l-mati', roleIds: ['r-manage'] },
      ],
    }),
  );
  expect(Object.keys(loadUserContext_('budi@gmail.com')?.locations ?? {}).sort()).toEqual(['l-a', 'l-b']);
});

test('menonaktifkan lokasi memengaruhi konteks hanya setelah cache dibatalkan', () => {
  insertUser_(
    user({ id: 'u1', email: 'budi@gmail.com', assignments: [{ locationId: 'l-a', roleIds: ['r-view'] }] }),
  );
  expect(Object.keys(loadUserContext_('budi@gmail.com')?.locations ?? {})).toEqual(['l-a']);
  const target = listLocations_().find((l) => l.id === 'l-a');
  if (!target) throw new Error('lokasi hilang');
  updateLocation_({ ...target, status: 'inactive' });
  expect(Object.keys(loadUserContext_('budi@gmail.com')?.locations ?? {})).toEqual(['l-a']);
  invalidateAccessCache_();
  expect(loadUserContext_('budi@gmail.com')?.locations).toEqual({});
});

test('super admin mendapat manage di semua lokasi aktif, termasuk yang baru', () => {
  const ctx = loadUserContext_('admin@gmail.com');
  expect(ctx?.permissions).toEqual(fullPermissions());
  expect(Object.keys(ctx?.locations ?? {}).sort()).toEqual(['l-a', 'l-b']);
  expect(ctx?.locations['l-a']).toEqual(fullLocationPermissions());
});

test('user tanpa penugasan dapat login tanpa izin apa pun (FR-P10)', () => {
  insertUser_(user({ id: 'u1', email: 'kosong@gmail.com' }));
  const ctx = loadUserContext_('kosong@gmail.com');
  expect(ctx).not.toBeNull();
  expect(ctx?.locations).toEqual({});
  expect(ctx?.permissions.access).toBe('none');
});

test('data lama yang hanya punya role_ids tetap berlaku sebagai Semua lokasi sebelum migrasi (deploy sebelum setup)', () => {
  listUsers_(); // membuat sheet users beserta header sebelum baris mentah diisi
  platform.db
    .sheet('users')
    .rows.push(['u9', 'lama@gmail.com', 'Lama', 'active', '["r-manage"]', '', '', '']);
  const ctx = loadUserContext_('lama@gmail.com');
  expect(ctx?.permissions.item).toBe('manage');
  expect(ctx?.locations['l-a']?.item).toBe('manage');
  expect(listUsers_().find((u) => u.id === 'u9')?.assignments).toEqual([
    { locationId: null, roleIds: ['r-manage'] },
  ]);
});

test('migrasi memindahkan role_ids ke assignments, mengosongkan role_ids, dan aman diulang', () => {
  listUsers_();
  platform.db
    .sheet('users')
    .rows.push(['u9', 'lama@gmail.com', 'Lama', 'active', '["r-manage"]', '', '', '']);
  platform.db.sheet('users').rows.push(['u8', 'kosong@gmail.com', 'Kosong', 'active', '[]', '', '', '']);
  expect(migrateUserAssignments_()).toBe(1);
  const header = platform.db.sheet('users').rows[0] ?? [];
  const row = platform.db.sheet('users').rows[1] ?? [];
  expect(row[header.indexOf('role_ids')]).toBe('');
  expect(row[header.indexOf('assignments')]).toBe('[{"locationId":null,"roleIds":["r-manage"]}]');
  expect(migrateUserAssignments_()).toBe(0);
  expect(listUsers_().find((u) => u.id === 'u9')?.assignments).toEqual([
    { locationId: null, roleIds: ['r-manage'] },
  ]);
});

test('JSON assignments rusak diabaikan tanpa error dan locationId hilang tidak menjadi Semua lokasi', () => {
  listUsers_();
  platform.db
    .sheet('users')
    .rows.push(['u1', 'rusak@gmail.com', 'Rusak', 'active', '', '', '', '', 'bukan-json']);
  platform.db
    .sheet('users')
    .rows.push(['u2', 'tanpa@gmail.com', 'Tanpa', 'active', '', '', '', '', '[{"roleIds":["r-manage"]}]']);
  expect(loadUserContext_('rusak@gmail.com')?.locations).toEqual({});
  expect(loadUserContext_('tanpa@gmail.com')?.locations).toEqual({});
  expect(loadUserContext_('tanpa@gmail.com')?.permissions.item).toBe('none');
});

```

- [ ] **Step 4: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test assignments`
Expected: FAIL — `migrateUserAssignments_` belum ada / `assignments` belum dikenal repo.

- [ ] **Step 5: Repo** — `gas/src/modules/access/repo.ts`

Tambah import:

```ts
import type { Assignment } from '@shared/assignments';
import { sanitizeAssignments } from '@shared/assignments';
```

Ubah `USERS_TABLE.columns` menjadi:

```ts
  columns: [
    'id',
    'email',
    'name',
    'status',
    'role_ids',
    'created_at',
    'updated_at',
    'updated_by',
    'assignments',
  ],
```

Pada `UserRecord` ganti `roleIds: string[];` dengan `assignments: Assignment[];`. Ganti `toUserRecord_` dan `fromUserRecord_`:

```ts
/** Penugasan dari kolom `assignments`; data lama (hanya `role_ids`) dibaca sebagai penugasan "Semua lokasi". */
function readAssignments_(data: RowData): Assignment[] {
  const text = (data.assignments ?? '').trim();
  if (text !== '') return sanitizeAssignments(parseJson_(text));
  const legacy = parseStringArray_(data.role_ids ?? '');
  return legacy.length > 0 ? [{ locationId: null, roleIds: legacy }] : [];
}

function toUserRecord_(rowNumber: number, data: RowData): UserRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    email: normalizeEmail_(data.email ?? ''),
    name: (data.name ?? '').trim(),
    status: (data.status ?? '').trim() === 'active' ? 'active' : 'inactive',
    assignments: readAssignments_(data),
    createdAt: data.created_at ?? '',
    updatedAt: data.updated_at ?? '',
    updatedBy: data.updated_by ?? '',
  };
}

function fromUserRecord_(user: NewUserRecord): RowData {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    role_ids: '',
    assignments: JSON.stringify(user.assignments),
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    updated_by: user.updatedBy,
  };
}
```

Tambahkan di akhir berkas:

```ts
/** Menyimpan migrasi: `role_ids` lama menjadi satu penugasan "Semua lokasi". Aman diulang. */
export function migrateUserAssignments_(): number {
  let migrated = 0;
  for (const { rowNumber, data } of readTable_(USERS_TABLE).rows) {
    if ((data.assignments ?? '').trim() !== '') continue;
    const roleIds = parseStringArray_(data.role_ids ?? '');
    if (roleIds.length === 0) continue;
    updateRow_(USERS_TABLE, rowNumber, {
      assignments: JSON.stringify([{ locationId: null, roleIds }]),
      role_ids: '',
    });
    migrated++;
  }
  return migrated;
}
```

- [ ] **Step 6: Konteks** — ganti isi `gas/src/modules/access/context.ts` bagian tipe dan `computeUserContext_`

Ubah import dan tipe:

```ts
import { adminEmail_ } from '@gas/core/config';
import { normalizeEmail_ } from '@gas/core/email';
import { platform_ } from '@gas/core/platform';
import type { LocationPermissionMap } from '@shared/assignments';
import { fullLocationPermissions, resolveAccess } from '@shared/assignments';
import type { PermissionMap } from '@shared/permissions';
import { fullPermissions } from '@shared/permissions';
import { findUserByEmail_, listLocations_, listRoles_ } from './repo';

export interface UserContext {
  email: string;
  name: string;
  userId: string | null;
  isSuperAdmin: boolean;
  /** Izin global: hanya dari penugasan "Semua lokasi" (sumber tunggal modul `access`). */
  permissions: PermissionMap;
  /** Izin efektif per lokasi aktif; lokasi tanpa izin apa pun tidak ada. */
  locations: Record<string, LocationPermissionMap>;
}
```

Ganti `computeUserContext_`:

```ts
export function computeUserContext_(email: string): UserContext | null {
  const record = findUserByEmail_(email);
  const admin = adminEmail_();
  const activeLocationIds = listLocations_()
    .filter((location) => location.status === 'active')
    .map((location) => location.id);
  if (admin !== '' && email === admin) {
    const locations: Record<string, LocationPermissionMap> = {};
    for (const id of activeLocationIds) locations[id] = fullLocationPermissions();
    return {
      email,
      name: record?.name || email,
      userId: record?.id ?? null,
      isSuperAdmin: true,
      permissions: fullPermissions(),
      locations,
    };
  }
  if (!record || record.status !== 'active') return null;
  const rolePermissions = new Map(listRoles_().map((role) => [role.id, role.permissions] as const));
  const access = resolveAccess(record.assignments, rolePermissions, activeLocationIds);
  return {
    email,
    name: record.name || email,
    userId: record.id,
    isSuperAdmin: false,
    permissions: access.global,
    locations: access.byLocation,
  };
}
```

(`import { fullPermissions, mergePermissions } from '@shared/permissions'` lama diganti baris di atas.)

- [ ] **Step 7: Jalankan tes baru**

Run: `bun run --cwd gas test assignments`
Expected: lulus. (Tes lain di `gas` mungkin gagal sampai Step 8–10; abaikan dulu.)

- [ ] **Step 8: Tulis tes layanan dan validasi yang gagal**

`gas/src/modules/access/validate.test.ts` — ganti tiga tes `validateSaveUser_` dengan:

```ts
test('validateSaveUser_ menormalisasi email, merapikan nama, dan membuang role duplikat per penugasan', () => {
  expect(
    validateSaveUser_({
      email: ' Budi@Gmail.COM ',
      name: '  Budi ',
      status: 'active',
      assignments: [{ locationId: null, roleIds: ['a', 'a', 'b'] }],
    }),
  ).toEqual({
    email: 'budi@gmail.com',
    name: 'Budi',
    status: 'active',
    assignments: [{ locationId: null, roleIds: ['a', 'b'] }],
  });
});

test('validateSaveUser_ mengumpulkan semua error field', () => {
  const error = captureAppError(() =>
    validateSaveUser_({ email: '', name: '', status: 'x', assignments: 'a' }),
  );
  expect(error.code).toBe('VALIDATION');
  expect(error.fields).toEqual({
    email: 'Wajib diisi',
    name: 'Wajib diisi',
    status: 'Nilai tidak valid',
    assignments: 'Harus berupa daftar penugasan',
  });
});

test('validateSaveUser_ menolak penugasan ganda untuk satu lokasi dan entri rusak', () => {
  const base = { email: 'b@gmail.com', name: 'B', status: 'active' };
  expect(
    captureAppError(() =>
      validateSaveUser_({
        ...base,
        assignments: [
          { locationId: 'l1', roleIds: [] },
          { locationId: 'l1', roleIds: [] },
        ],
      }),
    ).fields?.assignments,
  ).toBe('Satu lokasi hanya boleh muncul sekali');
  expect(
    captureAppError(() =>
      validateSaveUser_({
        ...base,
        assignments: [
          { locationId: null, roleIds: [] },
          { locationId: null, roleIds: [] },
        ],
      }),
    ).fields?.assignments,
  ).toBe('Satu lokasi hanya boleh muncul sekali');
  for (const entry of [
    { roleIds: [] },
    { locationId: '', roleIds: [] },
    { locationId: 3, roleIds: [] },
    { locationId: null, roleIds: 'x' },
    { locationId: null, roleIds: [1] },
    'teks',
  ]) {
    expect(
      captureAppError(() => validateSaveUser_({ ...base, assignments: [entry] })).fields?.assignments,
    ).toBeDefined();
  }
});

test('validateSaveUser_ menolak format email salah dan input bukan objek', () => {
  expect(
    captureAppError(() =>
      validateSaveUser_({ email: 'budi', name: 'B', status: 'active', assignments: [] }),
    ).fields,
  ).toEqual({ email: 'Format email tidak valid' });
  expect(captureAppError(() => validateSaveUser_('teks')).fields?._).toBe(
    'Input harus berupa objek',
  );
});
```

`gas/src/modules/access/service.test.ts` — pembaruan mekanis:
1. Tambah di atas `beforeEach`: `const everywhere = (...roleIds: string[]) => [{ locationId: null, roleIds }];` dan impor `location` dari `@gas-test/access-fixtures` dan `insertLocation_` dari `./repo`.
2. Di `beforeEach` tambahkan `insertLocation_(location({ id: 'l-a', code: 'A', name: 'Cabang A' })); insertLocation_(location({ id: 'l-mati', code: 'MATI', name: 'Mati', status: 'inactive' }));`.
3. Ganti tiap `roleIds: [...]` pada argumen `saveUser_` dengan `assignments: everywhere(...)` (mis. `roleIds: ['r-qc']` → `assignments: everywhere('r-qc')`, `roleIds: []` → `assignments: []`). Fixture `user({ ..., roleIds })` pada `beforeEach` dibiarkan.
4. Tes "menolak role yang tidak dikenal": `error.fields?.roleIds` → `error.fields?.assignments`.
5. Tes audit user: snapshot `roleIds: [...]` diganti peta penugasan, mis. `after: { email: 'ani@gmail.com', name: 'Ani', status: 'active', assignments: { '*': ['r-qc'] } }`; untuk `user.update`/`user.deactivate`, `before` berisi `assignments: { '*': ['r-qc', 'r-access'] }` dan `after` mengikuti perubahan.

Tambahkan tes baru di akhir `service.test.ts`:

```ts
test('menyimpan penugasan per lokasi dan menghitung userCount role dari semua penugasan', () => {
  saveUser_(
    {
      email: 'ani@gmail.com',
      name: 'Ani',
      status: 'active',
      assignments: [
        { locationId: null, roleIds: ['r-qc'] },
        { locationId: 'l-a', roleIds: ['r-access'] },
      ],
    },
    admin,
  );
  const ani = listUserDtos_().find((u) => u.email === 'ani@gmail.com');
  expect(ani?.assignments).toEqual([
    { locationId: null, roleIds: ['r-qc'] },
    { locationId: 'l-a', roleIds: ['r-access'] },
  ]);
  expect(listRoleDtos_().find((r) => r.id === 'r-access')?.userCount).toBe(2);
  expect(lastAudit()).toMatchObject({
    action: 'user.create',
    after: { assignments: { '*': ['r-qc'], 'l-a': ['r-access'] } },
  });
});

test('menolak lokasi yang tidak dikenal atau tidak aktif pada penugasan baru', () => {
  for (const locationId of ['tidak-ada', 'l-mati']) {
    const error = captureAppError(() =>
      saveUser_(
        {
          email: 'ani@gmail.com',
          name: 'Ani',
          status: 'active',
          assignments: [{ locationId, roleIds: ['r-qc'] }],
        },
        admin,
      ),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fields: { assignments: 'Lokasi tidak dikenal atau tidak aktif' },
    });
  }
});

test('penugasan lama pada lokasi yang kini nonaktif tetap boleh dipertahankan saat edit', () => {
  insertUser_(
    user({
      id: 'u-lama',
      email: 'lama@gmail.com',
      assignments: [{ locationId: 'l-mati', roleIds: ['r-qc'] }],
    }),
  );
  const saved = saveUser_(
    {
      id: 'u-lama',
      email: 'lama@gmail.com',
      name: 'Lama Baru',
      status: 'active',
      assignments: [{ locationId: 'l-mati', roleIds: ['r-qc'] }],
    },
    admin,
  );
  expect(saved.name).toBe('Lama Baru');
});

test('admin non-super tidak dapat menghilangkan akses Kelola global miliknya sendiri (FR-AS5)', () => {
  insertUser_(
    user({
      id: 'u-pusat',
      email: 'pusat@gmail.com',
      assignments: [{ locationId: null, roleIds: ['r-access'] }],
    }),
  );
  const pusat = contextOf('pusat@gmail.com');
  const error = captureAppError(() =>
    saveUser_(
      {
        id: 'u-pusat',
        email: 'pusat@gmail.com',
        name: 'Pusat',
        status: 'active',
        assignments: [{ locationId: 'l-a', roleIds: ['r-access'] }],
      },
      pusat,
    ),
  );
  expect(error.code).toBe('CONFLICT');
  expect(
    saveUser_(
      {
        id: 'u-pusat',
        email: 'pusat@gmail.com',
        name: 'Pusat',
        status: 'active',
        assignments: [{ locationId: null, roleIds: ['r-access', 'r-qc'] }],
      },
      pusat,
    ).assignments[0]?.roleIds,
  ).toEqual(['r-access', 'r-qc']);
  // Super admin boleh mengubah penugasan siapa pun, termasuk miliknya.
  expect(
    saveUser_(
      {
        id: 'u-pusat',
        email: 'pusat@gmail.com',
        name: 'Pusat',
        status: 'active',
        assignments: [],
      },
      admin,
    ).assignments,
  ).toEqual([]);
});
```

`lastAudit()` di `service.test.ts` sudah ada (tes audit sebelumnya); pastikan ia mengembalikan `before`/`after` terurai seperti sekarang.

- [ ] **Step 9: Implementasi validator** — `gas/src/modules/access/validate.ts`

Tambah import `Assignment`, `assignmentKey` dari `@shared/assignments`; ganti `validateSaveUser_` dan tambahkan pembaca penugasan:

```ts
/** Nama berbeda dari `readAssignments_` di repo.ts: semua berkas GAS berbagi satu scope global. */
function readAssignmentList_(value: unknown, reader: ObjectReader): Assignment[] {
  if (!Array.isArray(value)) {
    reader.fail('assignments', 'Harus berupa daftar penugasan');
    return [];
  }
  const seen = new Set<string>();
  const result: Assignment[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      reader.fail('assignments', 'Penugasan tidak valid');
      continue;
    }
    const { locationId, roleIds } = item as { locationId?: unknown; roleIds?: unknown };
    if (locationId !== null && (typeof locationId !== 'string' || locationId.trim() === '')) {
      reader.fail('assignments', 'Lokasi penugasan tidak valid');
      continue;
    }
    if (!Array.isArray(roleIds) || !roleIds.every((id) => typeof id === 'string')) {
      reader.fail('assignments', 'Role penugasan tidak valid');
      continue;
    }
    const location = locationId === null ? null : (locationId as string).trim();
    const key = assignmentKey(location);
    if (seen.has(key)) {
      reader.fail('assignments', 'Satu lokasi hanya boleh muncul sekali');
      continue;
    }
    seen.add(key);
    const ids = (roleIds as string[]).map((id) => id.trim()).filter((id) => id !== '');
    result.push({ locationId: location, roleIds: [...new Set(ids)] });
  }
  return result;
}

export function validateSaveUser_(raw: unknown): SaveUserInput {
  const reader = readObject_(raw);
  const id = reader.optionalId('id');
  const email = reader.email('email');
  const name = reader.str('name', { required: true, max: 100 });
  const status = reader.oneOf('status', USER_STATUS_VALUES);
  const assignments = readAssignmentList_(reader.raw('assignments'), reader);
  reader.done();
  return id
    ? { id, email, name, status, assignments }
    : { email, name, status, assignments };
}
```

- [ ] **Step 10: Implementasi layanan** — `gas/src/modules/access/service.ts`

Impor tambahan: `import type { Assignment } from '@shared/assignments'; import { assignmentKey, resolveAccess } from '@shared/assignments'; import { hasLevel, sanitizePermissions } from '@shared/permissions';` dan tambahkan `listLocations_` ke import repo (juga tipe `LocationRecord`).

Ganti `toUserDto_`, `toRoleDto_`, dan `userSnapshot_`:

```ts
function toUserDto_(user: NewUserRecord): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    assignments: user.assignments.map((entry) => ({
      locationId: entry.locationId,
      roleIds: [...entry.roleIds],
    })),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    updatedBy: user.updatedBy,
  };
}

function usesRole_(user: NewUserRecord, roleId: string): boolean {
  return user.assignments.some((entry) => entry.roleIds.includes(roleId));
}

function toRoleDto_(role: NewRoleRecord, users: readonly NewUserRecord[]): RoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: { ...role.permissions },
    userCount: users.filter((user) => usesRole_(user, role.id)).length,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
    updatedBy: role.updatedBy,
  };
}

/** Peta lokasi → role (kunci `*` = Semua lokasi); bentuk yang mudah dibandingkan per lokasi pada diff audit. */
function assignmentsSnapshot_(assignments: readonly Assignment[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const entry of assignments) map[assignmentKey(entry.locationId)] = [...entry.roleIds];
  return map;
}

function userSnapshot_(user: NewUserRecord): Record<string, unknown> {
  return {
    email: user.email,
    name: user.name,
    status: user.status,
    assignments: assignmentsSnapshot_(user.assignments),
  };
}
```

Tambahkan dua pemeriksa sebelum `saveUser_`:

```ts
function assertAssignmentsValid_(
  assignments: readonly Assignment[],
  roles: readonly RoleRecord[],
  locations: readonly LocationRecord[],
  existing: UserRecord | undefined,
): void {
  const knownRoles = new Set(roles.map((role) => role.id));
  if (assignments.some((entry) => entry.roleIds.some((id) => !knownRoles.has(id)))) {
    throw appError_('VALIDATION', 'Ada role yang tidak dikenal', {
      assignments: 'Ada role yang tidak dikenal',
    });
  }
  const previous = new Set((existing?.assignments ?? []).map((entry) => entry.locationId));
  for (const entry of assignments) {
    if (entry.locationId === null) continue;
    const location = locations.find((item) => item.id === entry.locationId);
    const usable = location && (location.status === 'active' || previous.has(entry.locationId));
    if (!usable) {
      throw appError_('VALIDATION', 'Lokasi tidak dikenal atau tidak aktif', {
        assignments: 'Lokasi tidak dikenal atau tidak aktif',
      });
    }
  }
}

/** Admin non-super tidak boleh menyimpan perubahan yang menghilangkan Kelola global miliknya sendiri. */
function assertKeepsOwnAccess_(
  assignments: readonly Assignment[],
  roles: readonly RoleRecord[],
  existing: UserRecord | undefined,
  actor: UserContext,
): void {
  if (actor.isSuperAdmin || !existing || existing.id !== actor.userId) return;
  if (!hasLevel(actor.permissions.access, 'manage')) return;
  const rolePermissions = new Map(roles.map((role) => [role.id, role.permissions] as const));
  if (!hasLevel(resolveAccess(assignments, rolePermissions, []).global.access, 'manage')) {
    throw appError_(
      'CONFLICT',
      'Anda tidak dapat menghilangkan akses Kelola Pengaturan Akses milik sendiri',
    );
  }
}
```

Ganti awal `saveUser_` sampai sebelum pembuatan `updated`/`created`:

```ts
export function saveUser_(input: SaveUserInput, actor: UserContext): UserDto {
  return platform_().withLock(() => {
    const email = normalizeEmail_(input.email);
    const users = listUsers_();
    const roles = listRoles_();
    const existing = input.id ? users.find((user) => user.id === input.id) : undefined;
    assertAssignmentsValid_(input.assignments, roles, listLocations_(), existing);
    if (users.some((user) => user.email === email && user.id !== input.id)) {
      throw appError_('CONFLICT', 'Email sudah terdaftar', { email: 'Email sudah terdaftar' });
    }
    const now = nowIso_();

    if (input.id) {
      if (!existing) throw appError_('NOT_FOUND', 'User tidak ditemukan');
      if (existing.email !== email) {
        throw appError_('VALIDATION', 'Email tidak dapat diubah', {
          email: 'Email tidak dapat diubah',
        });
      }
      if (existing.email === actor.email && input.status === 'inactive') {
        throw appError_('CONFLICT', 'Anda tidak bisa menonaktifkan akun sendiri');
      }
      assertKeepsOwnAccess_(input.assignments, roles, existing, actor);
      const updated: UserRecord = {
        ...existing,
        name: input.name,
        status: input.status,
        assignments: input.assignments.map((entry) => ({ ...entry, roleIds: [...entry.roleIds] })),
        updatedAt: now,
        updatedBy: actor.email,
      };
      // (updateUser_, appendAudit_ user.update, invalidateAccessCache_, return — tetap seperti sekarang)
```

Pada cabang pembuatan (`created`) ganti `roleIds: [...input.roleIds],` dengan `assignments: input.assignments.map((entry) => ({ ...entry, roleIds: [...entry.roleIds] })),`. Pada `removeRole_` ganti `listUsers_().filter((user) => user.roleIds.includes(role.id)).length` dengan `listUsers_().filter((user) => usesRole_(user, role.id)).length`. Hapus pemakaian `knownRoles` lama di `saveUser_` (kini di `assertAssignmentsValid_`).

- [ ] **Step 11: `auth.me`, setup, dan tesnya**

`gas/src/modules/auth/routes.ts`:

```ts
import type { RouteTable } from '@gas/core/router';
import { expectNull_ } from '@gas/core/validate';
import { listLocations_ } from '@gas/modules/access/repo';

export function authRoutes_(): Pick<RouteTable, 'auth.me'> {
  return {
    'auth.me': {
      validate: expectNull_,
      handler: (_input, ctx) => ({
        email: ctx.user.email,
        name: ctx.user.name,
        isSuperAdmin: ctx.user.isSuperAdmin,
        permissions: ctx.user.permissions,
        locations: listLocations_()
          .filter((location) => ctx.user.locations[location.id] !== undefined)
          .map((location) => ({
            id: location.id,
            code: location.code,
            name: location.name,
            permissions: ctx.user.locations[location.id] as LocationPermissionMap,
          }))
          .sort((a, b) => a.code.localeCompare(b.code)),
      }),
    },
  };
}
```

Tambahkan `import type { LocationPermissionMap } from '@shared/assignments';` di bagian atas. Buat `gas/src/modules/auth/routes.test.ts`:

```ts
import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { loadUserContext_ } from '@gas/modules/access/context';
import { insertLocation_, insertRole_, insertUser_ } from '@gas/modules/access/repo';
import { location, role, user } from '@gas-test/access-fixtures';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { authRoutes_ } from './routes';

beforeEach(() => {
  setPlatform_(createMemoryPlatform({ properties: { ADMIN_EMAIL: 'admin@gmail.com' } }));
  insertRole_(role({ id: 'r1', name: 'Manager', permissions: { item: 'manage' } }));
  insertLocation_(location({ id: 'l-b', code: 'BDG', name: 'Bandung' }));
  insertLocation_(location({ id: 'l-j', code: 'JKT', name: 'Jakarta' }));
  insertLocation_(location({ id: 'l-m', code: 'MATI', name: 'Mati', status: 'inactive' }));
  insertUser_(
    user({
      id: 'u1',
      email: 'budi@gmail.com',
      assignments: [
        { locationId: 'l-j', roleIds: ['r1'] },
        { locationId: 'l-m', roleIds: ['r1'] },
      ],
    }),
  );
});

function me(email: string) {
  const ctx = loadUserContext_(email);
  if (!ctx) throw new Error('konteks hilang');
  return authRoutes_()['auth.me'].handler(null, { requestId: 'r', user: ctx, locationIds: [] });
}

test('auth.me memuat izin global dan lokasi aktif yang boleh diakses, terurut menurut kode', () => {
  expect(me('budi@gmail.com')).toMatchObject({
    email: 'budi@gmail.com',
    isSuperAdmin: false,
    locations: [
      { id: 'l-j', code: 'JKT', name: 'Jakarta', permissions: { item: 'manage', handover: 'none', stock: 'none' } },
    ],
  });
});

test('super admin melihat semua lokasi aktif dengan manage', () => {
  const result = me('admin@gmail.com');
  expect(result.locations.map((l) => l.code)).toEqual(['BDG', 'JKT']);
  expect(result.locations[0]?.permissions).toEqual({ item: 'manage', handover: 'manage', stock: 'manage' });
});
```

Tes ini memakai `RequestContext.locationIds`, jadi tambahkan lebih dulu di `gas/src/core/router.ts` (hanya tipenya; validasi lokasi menyusul di Task 4): pada `interface RequestContext` tambahkan `locationIds: string[];` dengan komentar `/** Lokasi tervalidasi untuk rute berlokasi; kosong untuk rute global. */`, dan pada pemanggilan handler ubah `{ requestId, user }` menjadi `{ requestId, user, locationIds: [] }`.

`gas/src/setup.ts`: tambahkan `migrateUserAssignments_` ke import repo dan, setelah pemanggilan `migrateAuditDetail_`, tambahkan:

```ts
  const assigned = migrateUserAssignments_();
  if (assigned > 0) lines.push(`users: ${assigned} user lama dimigrasi ke penugasan "Semua lokasi".`);
```

`gas/src/setup.test.ts` — tambahkan tes:

```ts
test('setup memigrasi role_ids lama menjadi penugasan Semua lokasi dan aman diulang', () => {
  const platform = legacyAuditPlatform();
  platform.db.insertSheet('users').rows.push(
    ['id', 'email', 'name', 'status', 'role_ids', 'created_at', 'updated_at', 'updated_by'],
    ['u1', 'a@gmail.com', 'A', 'active', '["r1"]', '', '', ''],
  );
  expect(runSetup_()).toContain('1 user lama dimigrasi');
  const rows = platform.db.sheet('users').rows;
  const header = rows[0] ?? [];
  expect(rows[1]?.[header.indexOf('assignments')]).toBe('[{"locationId":null,"roleIds":["r1"]}]');
  expect(rows[1]?.[header.indexOf('role_ids')]).toBe('');
  expect(runSetup_()).not.toContain('dimigrasi ke penugasan');
});
```

- [ ] **Step 12: Jalankan seluruh tes gas**

Run: `bun run --cwd gas test && bun run --cwd gas typecheck`
Expected: semua lulus, typecheck bersih (setelah `locationIds` ditambahkan ke `RequestContext`, lihat catatan Step 11).

- [ ] **Step 13: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas shared
git add shared gas
git commit -m "feat(access): penugasan user ke lokasi, konteks izin per lokasi, dan migrasi" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Router: `scope: 'location'`

**Files:**
- Modify: `gas/src/core/router.ts`
- Test: `gas/src/core/router.test.ts`

**Interfaces:**
- Consumes: `UserContext.locations` (Task 3), `hasLevel`, `LocatedModule` (Task 1).
- Produces: `RoutePermission` (union `scope?: 'global'` | `scope: 'location'` dengan `module: LocatedModule`); `RequestContext.locationIds: string[]` (lokasi tervalidasi untuk rute `scope: 'location'`, kosong untuk rute global); aturan input: rute berlokasi menerima `locationIds: string[]` (baca) atau `locationId: string` (tulis).

- [ ] **Step 1: Tulis tes yang gagal** — tambahkan ke `gas/src/core/router.test.ts`

Tambahkan impor `insertLocation_` dari `@gas/modules/access/repo` dan `location` dari `@gas-test/access-fixtures`. Tambahkan dua rute uji ke objek `routes` (sebelum `} as unknown as RouteTable;`):

```ts
  'item.list': {
    permission: { module: 'item', level: 'view', scope: 'location' },
    validate: (raw: unknown) => raw,
    handler: (_input: unknown, ctx: RequestContext) => {
      calls.push('items');
      return ctx.locationIds;
    },
  },
  'item.save': {
    permission: { module: 'item', level: 'edit', scope: 'location' },
    validate: (raw: unknown) => raw,
    handler: (_input: unknown, ctx: RequestContext) => {
      calls.push('save');
      return ctx.locationIds;
    },
  },
```

Tambahkan ke `beforeEach` (setelah user `plain`):

```ts
  insertLocation_(location({ id: 'l-a', code: 'A' }));
  insertLocation_(location({ id: 'l-b', code: 'B' }));
  insertLocation_(location({ id: 'l-mati', code: 'MATI', status: 'inactive' }));
  insertRole_(role({ id: 'r-item-view', name: 'Lihat Item', permissions: { item: 'view' } }));
  insertRole_(role({ id: 'r-item-manage', name: 'Kelola Item', permissions: { item: 'manage' } }));
  insertUser_(
    user({
      id: 'u3',
      email: 'staf@gmail.com',
      assignments: [
        { locationId: 'l-a', roleIds: ['r-item-view'] },
        { locationId: 'l-b', roleIds: ['r-item-manage'] },
        { locationId: 'l-mati', roleIds: ['r-item-manage'] },
      ],
    }),
  );
```

Tambahkan tes:

```ts
const call = (method: string, payload: unknown, email = 'staf@gmail.com') =>
  handleRpc_(method, JSON.stringify(payload), signSessionToken_(email), routes);

test('rute berlokasi: baca di beberapa lokasi yang diizinkan, id ganda dirapikan', () => {
  expect(call('item.list', { locationIds: ['l-a', 'l-b', 'l-a'] })).toEqual({
    ok: true,
    data: ['l-a', 'l-b'],
  });
});

test('rute berlokasi: tulis butuh level di lokasi tujuan, bukan di lokasi lain', () => {
  expect(call('item.save', { locationId: 'l-b' })).toEqual({ ok: true, data: ['l-b'] });
  expect(errorOf(call('item.save', { locationId: 'l-a' })).code).toBe('FORBIDDEN');
});

test('satu lokasi terlarang di antara yang diizinkan menolak seluruh permintaan dan handler tidak jalan', () => {
  expect(errorOf(call('item.save', { locationIds: ['l-b', 'l-a'] })).code).toBe('FORBIDDEN');
  expect(calls).toEqual([]);
});

test('lokasi tak dikenal, nonaktif, dan terlarang menghasilkan FORBIDDEN dengan pesan yang sama', () => {
  const messages = ['tidak-ada', 'l-mati'].map((id) => errorOf(call('item.list', { locationIds: [id] })).message);
  expect(new Set(messages).size).toBe(1);
  expect(errorOf(call('item.list', { locationIds: ['l-a'] }, 'plain@gmail.com')).message).toBe(messages[0]);
  expect(calls).toEqual([]);
});

test('rute berlokasi tanpa lokasi atau bentuk salah menghasilkan VALIDATION', () => {
  for (const payload of [null, {}, { locationIds: [] }, { locationIds: [1] }, { locationId: '' }, { locationIds: 'l-a' }]) {
    expect(errorOf(call('item.list', payload)).code).toBe('VALIDATION');
  }
  expect(calls).toEqual([]);
});

test('super admin boleh di semua lokasi aktif tetapi tidak di lokasi nonaktif', () => {
  expect(call('item.list', { locationIds: ['l-a', 'l-b'] }, 'admin@gmail.com').ok).toBe(true);
  expect(errorOf(call('item.list', { locationIds: ['l-mati'] }, 'admin@gmail.com')).code).toBe('FORBIDDEN');
});

test('rute global tetap memakai izin global dan menerima locationIds kosong', () => {
  const token = signSessionToken_('viewer@gmail.com');
  expect(handleRpc_('access.users.list', 'null', token, routes)).toEqual({ ok: true, data: [] });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test router`
Expected: FAIL (rute berlokasi belum diperiksa; `ctx.locationIds` undefined).

- [ ] **Step 3: Implementasi** — `gas/src/core/router.ts`

Ubah impor dan tipe:

```ts
import type { UserContext } from '@gas/modules/access/context';
import { loadUserContext_ } from '@gas/modules/access/context';
import type { LocatedModule } from '@shared/assignments';
import type { Level, ModuleKey } from '@shared/permissions';
import { hasLevel } from '@shared/permissions';
...
export interface RequestContext {
  requestId: string;
  user: UserContext;
  /** Lokasi tervalidasi untuk rute `scope: 'location'`; kosong untuk rute global. */
  locationIds: string[];
}

export type RoutePermission =
  | { module: ModuleKey; level: Level; scope?: 'global' }
  | { module: LocatedModule; level: Level; scope: 'location' };

export interface RouteDef<M extends RpcMethod = RpcMethod> {
  /** Tanpa `permission` = cukup login. */
  permission?: RoutePermission;
  validate: (raw: unknown) => RpcInput<M>;
  handler: (input: RpcInput<M>, ctx: RequestContext) => RpcOutput<M>;
}
```

Ganti blok pemeriksaan izin dan pemanggilan handler di `handleRpc_`:

```ts
    const permission = route.permission;
    if (
      permission &&
      permission.scope !== 'location' &&
      !hasLevel(user.permissions[permission.module], permission.level)
    ) {
      throw appError_('FORBIDDEN', 'Anda tidak memiliki akses untuk aksi ini');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(
        typeof payloadJson === 'string' && payloadJson !== '' ? payloadJson : 'null',
      );
    } catch {
      throw appError_('VALIDATION', 'Payload bukan JSON yang valid');
    }

    const input = route.validate(raw);
    const locationIds =
      permission && permission.scope === 'location'
        ? authorizedLocationIds_(input, user, permission)
        : [];
    const data = route.handler(input, { requestId, user, locationIds });
    return { ok: true, data };
```

Tambahkan fungsi:

```ts
/** Lokasi dari input rute berlokasi: `locationIds` (baca) atau `locationId` (tulis). */
function requestedLocationIds_(input: unknown): string[] {
  const source = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const raw = Array.isArray(source.locationIds)
    ? source.locationIds
    : typeof source.locationId === 'string'
      ? [source.locationId]
      : [];
  const ids = raw.every((id) => typeof id === 'string') ? (raw as string[]).map((id) => id.trim()) : [];
  if (ids.length === 0 || ids.some((id) => id === '')) {
    throw appError_('VALIDATION', 'Lokasi wajib diisi', { locationId: 'Lokasi wajib diisi' });
  }
  return [...new Set(ids)];
}

/** Semua lokasi yang diminta harus aktif dan berlevel cukup; satu gagal menolak seluruh permintaan. */
function authorizedLocationIds_(
  input: unknown,
  user: UserContext,
  permission: Extract<RoutePermission, { scope: 'location' }>,
): string[] {
  const ids = requestedLocationIds_(input);
  for (const id of ids) {
    const access = user.locations[id];
    if (!access || !hasLevel(access[permission.module], permission.level)) {
      throw appError_('FORBIDDEN', 'Anda tidak memiliki akses ke lokasi ini');
    }
  }
  return ids;
}
```

Pada tes lama yang memanggil `handler` langsung dengan `ctx` buatan, tambahkan `locationIds: []` bila perlu (mis. di `gas/src/modules/auth/routes.test.ts` Task 3).

- [ ] **Step 4: Jalankan semua tes dan typecheck gas**

Run: `bun run --cwd gas test && bun run --cwd gas typecheck`
Expected: semua lulus (termasuk `routes.test.ts`, `auth/routes.test.ts`), typecheck bersih.

- [ ] **Step 5: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas
git add gas
git commit -m "feat(gas): rute berlokasi dengan validasi tiap lokasi di router" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Web mengikuti kontrak baru (izin, penugasan di form User, mock)

**Files:**
- Modify: `web/src/modules/auth/permissions.ts`, `permissions.test.ts`, `web/src/app/navigation.ts`, `navigation.test.ts`, `web/src/routes/_app/index.tsx`, `web/src/modules/access/schemas.ts`, `schemas.test.ts`, `queries.ts`, `components/user-form.tsx`, `components/user-form.test.tsx`, `components/users-table.tsx`, `lib/filter-users.test.ts`, `web/src/routes/_app/access/users.tsx`, `web/src/lib/rpc/mock-backend.ts`, `mock-backend.test.ts`
- Create: `web/src/modules/access/components/users-table.test.tsx`

**Interfaces:**
- Consumes: `Assignment`, `ALL_LOCATIONS_KEY`, `assignmentKey`, `isLocatedModule`, `LocatedModule` (Task 1); `LocationDto`, `LocationAccessDto`, `UserDto.assignments`, `MeDto.locations` (Task 2–3).
- Produces:
  - `permissions.ts`: `can` (global, tak berubah), `canAt(me, module: LocatedModule, level, locationId)`, `locationsWith(me, module: LocatedModule, level, among?)`, `canAnywhere(me, module: ModuleKey, level, among?)`; `requirePermission` memakai `canAnywhere`.
  - `navigation.ts`: `NavItem.permission.scope?: 'location'`; `visibleNavGroups(groups, me, activeLocationIds?)`.
  - `queries.ts`: `accessKeys.locations`, `locationsQueryOptions()`, `useSaveLocation()`, `useSetLocationStatus()`.
  - `schemas.ts`: `userFormSchema.assignments`, `toUserFormDefaults(user?, knownRoleIds?)` memetakan `locationId null → '*'`.
  - `UserForm` prop baru `locations: readonly LocationDto[]`; `UsersTable` prop baru `locationNames`.

- [ ] **Step 1: Tulis tes yang gagal untuk izin dan navigasi**

`web/src/modules/auth/permissions.test.ts` (ganti seluruhnya):

```ts
import type { MeDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { can, canAnywhere, canAt, locationsWith } from './permissions';

const me: MeDto = {
  email: 'a@gmail.com',
  name: 'A',
  isSuperAdmin: false,
  permissions: { access: 'view', item: 'view', handover: 'none', stock: 'none' },
  locations: [
    { id: 'l-a', code: 'A', name: 'A', permissions: { item: 'manage', handover: 'none', stock: 'view' } },
    { id: 'l-b', code: 'B', name: 'B', permissions: { item: 'view', handover: 'none', stock: 'none' } },
  ],
};

test('can memeriksa izin global per modul', () => {
  expect(can(me, 'access', 'view')).toBe(true);
  expect(can(me, 'access', 'manage')).toBe(false);
  expect(can(me, 'handover', 'view')).toBe(false);
  expect(can(undefined, 'item', 'view')).toBe(false);
});

test('canAt memeriksa izin di satu lokasi; lokasi tak dikenal ditolak', () => {
  expect(canAt(me, 'item', 'manage', 'l-a')).toBe(true);
  expect(canAt(me, 'item', 'manage', 'l-b')).toBe(false);
  expect(canAt(me, 'item', 'view', 'l-x')).toBe(false);
  expect(canAt(undefined, 'item', 'view', 'l-a')).toBe(false);
});

test('locationsWith menyaring lokasi menurut level dan batasan pilihan', () => {
  expect(locationsWith(me, 'item', 'manage').map((l) => l.id)).toEqual(['l-a']);
  expect(locationsWith(me, 'item', 'view').map((l) => l.id)).toEqual(['l-a', 'l-b']);
  expect(locationsWith(me, 'item', 'view', ['l-b']).map((l) => l.id)).toEqual(['l-b']);
  expect(locationsWith(undefined, 'item', 'view')).toEqual([]);
});

test('canAnywhere: modul global memakai izin global, modul berlokasi memakai lokasi', () => {
  expect(canAnywhere(me, 'access', 'view')).toBe(true);
  expect(canAnywhere(me, 'stock', 'view')).toBe(true);
  expect(canAnywhere(me, 'stock', 'view', ['l-b'])).toBe(false);
  expect(canAnywhere(me, 'handover', 'view')).toBe(false);
  expect(canAnywhere(undefined, 'item', 'view')).toBe(false);
});
```

`web/src/app/navigation.test.ts` — tambahkan `locations: []` pada objek `me`, dan tambahkan tes:

```ts
test('item berlingkup lokasi mengikuti lokasi aktif yang dipilih', () => {
  const located: NavGroup[] = [
    {
      label: 'Modul',
      items: [
        { label: 'Item', to: '/', icon: House, permission: { module: 'item', level: 'view', scope: 'location' } },
      ],
    },
  ];
  const me: MeDto = {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    permissions: { access: 'none', item: 'none', handover: 'none', stock: 'none' },
    locations: [
      { id: 'l-a', code: 'A', name: 'A', permissions: { item: 'view', handover: 'none', stock: 'none' } },
      { id: 'l-b', code: 'B', name: 'B', permissions: { item: 'none', handover: 'none', stock: 'view' } },
    ],
  };
  expect(visibleNavGroups(located, me, ['l-a']).map((g) => g.label)).toEqual(['Modul']);
  expect(visibleNavGroups(located, me, ['l-b'])).toEqual([]);
  expect(visibleNavGroups(located, me).map((g) => g.label)).toEqual(['Modul']);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd web test permissions navigation`
Expected: FAIL — `canAt`/`canAnywhere`/`locationsWith` belum ada.

- [ ] **Step 3: Implementasi izin dan navigasi**

`web/src/modules/auth/permissions.ts` (ganti seluruhnya):

```ts
import type { LocatedModule } from '@shared/assignments';
import { isLocatedModule } from '@shared/assignments';
import type { Level, ModuleKey } from '@shared/permissions';
import { hasLevel } from '@shared/permissions';
import type { LocationAccessDto, MeDto } from '@shared/rpc';
import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { meQueryOptions } from './queries';

/**
 * Izin GLOBAL (penugasan "Semua lokasi"); benar untuk modul `access`.
 * Untuk modul berlokasi pakai `canAt`, `locationsWith`, atau `canAnywhere`.
 * Hanya untuk UX — penegakan sebenarnya ada di router GAS.
 */
export function can(me: MeDto | null | undefined, module: ModuleKey, level: Level): boolean {
  return me ? hasLevel(me.permissions[module], level) : false;
}

export function canAt(
  me: MeDto | null | undefined,
  module: LocatedModule,
  level: Level,
  locationId: string,
): boolean {
  const location = me?.locations.find((item) => item.id === locationId);
  return location ? hasLevel(location.permissions[module], level) : false;
}

/** Lokasi (opsional dibatasi ke `among`) tempat user punya minimal `level` pada modul berlokasi. */
export function locationsWith(
  me: MeDto | null | undefined,
  module: LocatedModule,
  level: Level,
  among?: readonly string[],
): LocationAccessDto[] {
  if (!me) return [];
  return me.locations.filter(
    (item) => (!among || among.includes(item.id)) && hasLevel(item.permissions[module], level),
  );
}

export function canAnywhere(
  me: MeDto | null | undefined,
  module: ModuleKey,
  level: Level,
  among?: readonly string[],
): boolean {
  if (!me) return false;
  return isLocatedModule(module)
    ? locationsWith(me, module, level, among).length > 0
    : can(me, module, level);
}

export async function requirePermission(
  queryClient: QueryClient,
  module: ModuleKey,
  level: Level,
): Promise<void> {
  const me = await queryClient.ensureQueryData(meQueryOptions());
  if (!canAnywhere(me, module, level)) throw redirect({ to: '/forbidden' });
}
```

`web/src/app/navigation.ts`: ubah impor `can` menjadi `canAnywhere`; ubah `NavItem.permission` dan `visibleNavGroups`:

```ts
export interface NavItem {
  label: string;
  to: LinkProps['to'];
  icon: LucideIcon;
  /** `scope: 'location'` = tampil bila izin cukup di minimal satu lokasi aktif terpilih. */
  permission?: { module: ModuleKey; level: Level; scope?: 'location' };
}
...
export function visibleNavGroups(
  groups: readonly NavGroup[],
  me: MeDto,
  activeLocationIds?: readonly string[],
): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          !item.permission ||
          canAnywhere(
            me,
            item.permission.module,
            item.permission.level,
            item.permission.scope === 'location' ? activeLocationIds : undefined,
          ),
      ),
    }))
    .filter((group) => group.items.length > 0);
}
```

`web/src/routes/_app/index.tsx`: ganti impor `can` dengan `canAnywhere` dan baris modul menjadi `MODULES.filter((module) => canAnywhere(me, module, 'view'))`.

- [ ] **Step 4: Jalankan tes izin dan navigasi**

Run: `bun run --cwd web test permissions navigation`
Expected: lulus.

- [ ] **Step 5: Tulis tes skema dan form yang gagal**

`web/src/modules/access/schemas.test.ts` (ganti seluruhnya):

```ts
import type { UserDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { toUserFormDefaults, userFormSchema } from './schemas';

const user: UserDto = {
  id: '1',
  email: 'a@gmail.com',
  name: 'A',
  status: 'active',
  assignments: [
    { locationId: null, roleIds: ['ada', 'basi'] },
    { locationId: 'l-a', roleIds: ['basi'] },
    { locationId: 'l-b', roleIds: ['ada'] },
  ],
  createdAt: '',
  updatedAt: '',
  updatedBy: '',
};

test('toUserFormDefaults membuang role basi dan penugasan yang menjadi kosong; Semua lokasi menjadi tanda bintang', () => {
  expect(toUserFormDefaults(user, ['ada', 'lain']).assignments).toEqual([
    { locationId: '*', roleIds: ['ada'] },
    { locationId: 'l-b', roleIds: ['ada'] },
  ]);
});

test('tanpa daftar role yang diketahui, penugasan disalin apa adanya', () => {
  expect(toUserFormDefaults(user).assignments).toEqual([
    { locationId: '*', roleIds: ['ada', 'basi'] },
    { locationId: 'l-a', roleIds: ['basi'] },
    { locationId: 'l-b', roleIds: ['ada'] },
  ]);
});

const base = { email: 'a@gmail.com', name: 'A', status: 'active' as const };

test('skema mengubah tanda bintang menjadi null dan menerima penugasan sah', () => {
  expect(
    userFormSchema.parse({
      ...base,
      assignments: [
        { locationId: '*', roleIds: ['r1'] },
        { locationId: 'l-a', roleIds: ['r2'] },
      ],
    }).assignments,
  ).toEqual([
    { locationId: null, roleIds: ['r1'] },
    { locationId: 'l-a', roleIds: ['r2'] },
  ]);
});

test('skema menolak lokasi kosong, lokasi ganda, dan penugasan tanpa role dengan pesan bernomor', () => {
  const messages = (assignments: unknown[]) => {
    const result = userFormSchema.safeParse({ ...base, assignments });
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  };
  expect(messages([{ locationId: '', roleIds: ['r'] }])).toEqual(['Penugasan 1: pilih lokasi']);
  expect(
    messages([
      { locationId: 'l-a', roleIds: ['r'] },
      { locationId: 'l-a', roleIds: ['r'] },
    ]),
  ).toEqual(['Penugasan 2: lokasi sudah dipakai di penugasan lain']);
  expect(messages([{ locationId: '*', roleIds: [] }])).toEqual([
    'Penugasan 1: pilih minimal satu role atau hapus penugasannya',
  ]);
  expect(
    messages([
      { locationId: '*', roleIds: ['r'] },
      { locationId: '*', roleIds: ['r'] },
    ]),
  ).toEqual(['Penugasan 2: lokasi sudah dipakai di penugasan lain']);
});
```

`web/src/modules/access/components/user-form.test.tsx` — ubah:
1. Impor `LocationDto` dan tambahkan data `locations: LocationDto[] = [{ id: 'l-a', code: 'JKT', name: 'Jakarta', status: 'active', createdAt: '', updatedAt: '', updatedBy: '' }, { id: 'l-mati', code: 'OLD', name: 'Lama', status: 'inactive', createdAt: '', updatedAt: '', updatedBy: '' }]`.
2. `renderForm` meneruskan `locations={locations}`.
3. Tes "menampilkan error…": ekspektasi tetap `findAllByText('Wajib diisi')` 2.
4. Ganti tes "mengirim nilai yang sudah dinormalisasi" dengan:

```ts
test('mengirim nilai yang sudah dinormalisasi, termasuk penugasan', async () => {
  const { onSubmit } = renderForm();
  await userEvent.type(screen.getByLabelText('Email'), ' Budi@Gmail.COM ');
  await userEvent.type(screen.getByLabelText('Nama'), '  Budi ');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }));
  await userEvent.selectOptions(screen.getByLabelText('Lokasi penugasan 1'), 'Semua lokasi');
  const row = screen.getByRole('group', { name: 'Penugasan 1' });
  await userEvent.click(within(row).getByRole('checkbox', { name: 'QC Staff' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({
      email: 'budi@gmail.com',
      name: 'Budi',
      status: 'active',
      assignments: [{ locationId: null, roleIds: ['role-qc'] }],
    }),
  );
});

test('lokasi yang sudah dipakai tidak ditawarkan lagi pada penugasan lain; lokasi nonaktif tidak ditawarkan', async () => {
  renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }));
  await userEvent.selectOptions(screen.getByLabelText('Lokasi penugasan 1'), 'Semua lokasi');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }));
  const options = within(screen.getByLabelText('Lokasi penugasan 2'))
    .getAllByRole('option')
    .map((option) => option.textContent);
  expect(options).not.toContain('Semua lokasi');
  expect(options).toContain('Jakarta (JKT)');
  expect(options.join(' ')).not.toContain('Lama');
});

test('penugasan dapat dihapus dan pesan error penugasan tampil', async () => {
  const { onSubmit } = renderForm();
  await userEvent.type(screen.getByLabelText('Email'), 'b@gmail.com');
  await userEvent.type(screen.getByLabelText('Nama'), 'B');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Penugasan 1: pilih lokasi')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus penugasan 1' }));
  expect(screen.queryByRole('group', { name: 'Penugasan 1' })).not.toBeInTheDocument();
});
```

Tambahkan `within` ke impor `@testing-library/react`.

`web/src/modules/access/components/users-table.test.tsx` (baru):

```tsx
import type { UserDto } from '@shared/rpc';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { UsersTable } from './users-table';

const user: UserDto = {
  id: '1',
  email: 'a@gmail.com',
  name: 'A',
  status: 'active',
  assignments: [
    { locationId: null, roleIds: ['r1'] },
    { locationId: 'l-a', roleIds: ['r2', 'hilang'] },
    { locationId: 'l-x', roleIds: ['r1'] },
  ],
  createdAt: '',
  updatedAt: '',
  updatedBy: '',
};

test('merangkum penugasan per lokasi dengan nama role, dan menandai yang tidak dikenal', () => {
  render(
    <UsersTable
      users={[user]}
      roleNames={new Map([['r1', 'Manajer'], ['r2', 'Pemantau']])}
      locationNames={new Map([['l-a', 'Jakarta']])}
      canManage={false}
      currentEmail="x@gmail.com"
      pendingStatusId={null}
      onEdit={() => undefined}
      onToggleStatus={() => undefined}
    />,
  );
  expect(screen.getByText('Semua lokasi: Manajer')).toBeInTheDocument();
  expect(screen.getByText('Jakarta: Pemantau, (role dihapus)')).toBeInTheDocument();
  expect(screen.getByText('(lokasi tidak dikenal): Manajer')).toBeInTheDocument();
});

test('user tanpa penugasan menampilkan tanda strip', () => {
  render(
    <UsersTable
      users={[{ ...user, assignments: [] }]}
      roleNames={new Map()}
      locationNames={new Map()}
      canManage={false}
      currentEmail="x@gmail.com"
      pendingStatusId={null}
      onEdit={() => undefined}
      onToggleStatus={() => undefined}
    />,
  );
  expect(screen.getByText('—')).toBeInTheDocument();
});
```

- [ ] **Step 6: Jalankan, pastikan gagal**

Run: `bun run --cwd web test schemas user-form users-table`
Expected: FAIL.

- [ ] **Step 7: Implementasi skema, query, form, tabel**

`web/src/modules/access/schemas.ts`: tambah impor `ALL_LOCATIONS_KEY, assignmentKey` dari `@shared/assignments`; ganti baris `roleIds: z.array(z.string()),` pada `userFormSchema` dan `toUserFormDefaults`:

```ts
const assignmentRowSchema = z.object({
  /** '' = belum dipilih, '*' = Semua lokasi (menjadi null saat dikirim). */
  locationId: z.string().transform((value) => (value === ALL_LOCATIONS_KEY ? null : value)),
  roleIds: z.array(z.string()),
});

export const userFormSchema = z.object({
  email: ...,            // (tidak berubah)
  name: ...,             // (tidak berubah)
  status: z.enum(['active', 'inactive']),
  assignments: z.array(assignmentRowSchema).superRefine((rows, ctx) => {
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      const label = `Penugasan ${index + 1}`;
      if (row.locationId === '') {
        ctx.addIssue({ code: 'custom', message: `${label}: pilih lokasi` });
      } else if (seen.has(assignmentKey(row.locationId))) {
        ctx.addIssue({ code: 'custom', message: `${label}: lokasi sudah dipakai di penugasan lain` });
      } else {
        seen.add(assignmentKey(row.locationId));
      }
      if (row.roleIds.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: `${label}: pilih minimal satu role atau hapus penugasannya`,
        });
      }
    });
  }),
});
```

```ts
/** `knownRoleIds`: role yang masih ada — role basi dibuang, dan penugasan yang jadi kosong ikut dibuang. */
export function toUserFormDefaults(user?: UserDto, knownRoleIds?: readonly string[]): UserFormInput {
  return user
    ? {
        email: user.email,
        name: user.name,
        status: user.status,
        assignments: user.assignments
          .map((entry) => ({
            locationId: assignmentKey(entry.locationId),
            roleIds: entry.roleIds.filter((id) => !knownRoleIds || knownRoleIds.includes(id)),
          }))
          .filter((entry) => entry.roleIds.length > 0),
      }
    : { email: '', name: '', status: 'active', assignments: [] };
}
```

Tambah skema lokasi (dipakai Task 6) sekarang agar impor `LocationDto` sekali:

```ts
export const locationFormSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Wajib diisi')
    .max(10, 'Maksimal 10 karakter')
    .regex(/^[A-Z0-9-]+$/, 'Hanya huruf, angka, dan tanda hubung'),
  name: z.string().trim().min(1, 'Wajib diisi').max(100, 'Maksimal 100 karakter'),
});
export type LocationFormInput = z.input<typeof locationFormSchema>;
export type LocationFormOutput = z.output<typeof locationFormSchema>;

export function toLocationFormDefaults(location?: LocationDto): LocationFormInput {
  return { code: location?.code ?? '', name: location?.name ?? '' };
}
```

dan ubah impor menjadi `import type { LocationDto, RoleDto, UserDto } from '@shared/rpc';`.

`web/src/modules/access/queries.ts`: tambahkan `locations: ['access', 'locations'] as const,` ke `accessKeys`; impor `SaveLocationInput`, `SetLocationStatusInput`; tambahkan:

```ts
export function locationsQueryOptions() {
  return queryOptions({
    queryKey: accessKeys.locations,
    queryFn: () => rpc('access.locations.list', null),
  });
}

export const useSaveLocation = () =>
  useAccessMutation((input: SaveLocationInput) => rpc('access.locations.save', input));
export const useSetLocationStatus = () =>
  useAccessMutation((input: SetLocationStatusInput) => rpc('access.locations.setStatus', input));
```

`web/src/modules/access/components/user-form.tsx`: tambah impor `ALL_LOCATIONS_KEY` dari `@shared/assignments`, tipe `LocationDto`; prop `locations: readonly LocationDto[]`; ganti blok `<form.Field name="roleIds">…</form.Field>` dengan:

```tsx
      <form.Field name="assignments">
        {(field) => {
          const rows = field.state.value;
          const used = new Set(rows.map((row) => row.locationId));
          const update = (index: number, patch: Partial<(typeof rows)[number]>) =>
            field.handleChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
          const optionsFor = (current: string) => [
            ...(used.has(ALL_LOCATIONS_KEY) && current !== ALL_LOCATIONS_KEY
              ? []
              : [{ value: ALL_LOCATIONS_KEY, label: 'Semua lokasi' }]),
            ...locations
              .filter(
                (location) =>
                  (location.status === 'active' || location.id === current) &&
                  (!used.has(location.id) || location.id === current),
              )
              .map((location) => ({
                value: location.id,
                label:
                  location.status === 'active'
                    ? `${location.name} (${location.code})`
                    : `${location.name} (${location.code}) — nonaktif`,
              })),
          ];
          return (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Penugasan</legend>
              <p className="text-xs text-muted-foreground">
                Hak di tiap lokasi ditentukan oleh role penugasannya. Pengaturan Akses hanya berlaku
                dari penugasan Semua lokasi.
              </p>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada penugasan.</p>
              ) : null}
              {rows.map((row, index) => (
                <fieldset
                  // biome-ignore lint/suspicious/noArrayIndexKey: baris penugasan tidak punya id stabil
                  key={index}
                  aria-label={`Penugasan ${index + 1}`}
                  className="space-y-2 rounded-lg border p-3"
                >
                  <div className="flex items-center gap-2">
                    <NativeSelect
                      aria-label={`Lokasi penugasan ${index + 1}`}
                      value={row.locationId}
                      onChange={(event) => update(index, { locationId: event.target.value })}
                    >
                      {row.locationId === '' ? (
                        <option value="" disabled>
                          Pilih lokasi…
                        </option>
                      ) : null}
                      {optionsFor(row.locationId).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Hapus penugasan ${index + 1}`}
                      onClick={() => field.handleChange(rows.filter((_, i) => i !== index))}
                    >
                      Hapus
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {roles.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Belum ada role.</p>
                    ) : null}
                    {roles.map((role) => (
                      <div key={role.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`assign-${index}-${role.id}`}
                          checked={row.roleIds.includes(role.id)}
                          onCheckedChange={(next) =>
                            update(index, {
                              roleIds:
                                next === true
                                  ? [...row.roleIds, role.id]
                                  : row.roleIds.filter((id) => id !== role.id),
                            })
                          }
                        />
                        <Label htmlFor={`assign-${index}-${role.id}`} className="font-normal">
                          {role.name}
                        </Label>
                      </div>
                    ))}
                  </div>
                </fieldset>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => field.handleChange([...rows, { locationId: '', roleIds: [] }])}
              >
                Tambah penugasan
              </Button>
              <FieldError errors={field.state.meta.errors} />
            </fieldset>
          );
        }}
      </form.Field>
```

`web/src/modules/access/components/users-table.tsx`: tambah impor `assignmentKey`; prop `locationNames: ReadonlyMap<string, string>`; ganti `<TableHead>Role</TableHead>` menjadi `<TableHead>Penugasan</TableHead>` dan isi sel role dengan:

```tsx
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {user.assignments.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : null}
                    {user.assignments.map((entry) => (
                      <Badge key={assignmentKey(entry.locationId)} variant="outline">
                        {`${
                          entry.locationId === null
                            ? 'Semua lokasi'
                            : (locationNames.get(entry.locationId) ?? '(lokasi tidak dikenal)')
                        }: ${entry.roleIds.map((id) => roleNames.get(id) ?? '(role dihapus)').join(', ')}`}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
```

`web/src/routes/_app/access/users.tsx`: tambah `locationsQueryOptions` pada impor `queries`; di `loader` tambahkan `context.queryClient.ensureQueryData(locationsQueryOptions())` ke `Promise.all`; di komponen tambahkan `const { data: locations } = useSuspenseQuery(locationsQueryOptions());` dan `const locationNames = new Map(locations.map((location) => [location.id, location.name]));`; teruskan `locationNames={locationNames}` ke `UsersTable` dan `locations={locations}` ke `UserForm`.

`web/src/modules/access/lib/filter-users.test.ts`: ganti `roleIds: []` pada `base` dengan `assignments: []`.

- [ ] **Step 8: Mock backend** — `web/src/lib/rpc/mock-backend.ts`

Impor `location` dari `@gas-test/access-fixtures` dan `insertLocation_` dari `@gas/modules/access/repo`. Ganti blok pembuatan user/lokasi dan `MOCK_USERS`:

```ts
export const MOCK_USERS: MockUser[] = [
  { email: MOCK_ADMIN_EMAIL, label: 'Super Admin' },
  {
    email: 'qc.staff@qc.local',
    label: 'QC Staff (Jakarta: item ubah, serah terima ubah, stok lihat; Bandung: serah terima lihat, stok lihat)',
  },
  { email: 'wh.staff@qc.local', label: 'WH Staff (Bandung saja: serah terima lihat, stok lihat)' },
  { email: 'access.viewer@qc.local', label: 'Pemantau Akses (Semua lokasi: akses lihat)' },
  { email: 'nonaktif@qc.local', label: 'User nonaktif' },
  { email: 'asing@gmail.com', label: 'Email tidak terdaftar' },
];
```

Setelah pembuatan role, ganti pembuatan user dengan:

```ts
  insertLocation_(location({ id: 'loc-jkt', code: 'JKT', name: 'Jakarta' }));
  insertLocation_(location({ id: 'loc-bdg', code: 'BDG', name: 'Bandung' }));
  insertUser_(
    user({
      id: 'user-qc',
      email: 'qc.staff@qc.local',
      name: 'Siti QC',
      assignments: [
        { locationId: 'loc-jkt', roleIds: ['role-qc'] },
        { locationId: 'loc-bdg', roleIds: ['role-wh'] },
      ],
    }),
  );
  insertUser_(
    user({
      id: 'user-wh',
      email: 'wh.staff@qc.local',
      name: 'Andi Gudang',
      assignments: [{ locationId: 'loc-bdg', roleIds: ['role-wh'] }],
    }),
  );
  insertUser_(
    user({
      id: 'user-viewer',
      email: 'access.viewer@qc.local',
      name: 'Rina Audit',
      roleIds: ['role-access-viewer'],
    }),
  );
  insertUser_(
    user({
      id: 'user-off',
      email: 'nonaktif@qc.local',
      name: 'Dedi Nonaktif',
      status: 'inactive',
      roleIds: ['role-qc'],
    }),
  );
```

Pada `seedMockAudit`, ganti snapshot `roleIds` dengan `assignments`: `after: { ...qcUser, assignments: { '*': ['role-qc'] } }`, `before: { ...qcUser, assignments: { '*': ['role-qc'] } }`, `after: { ...qcUser, name: 'Siti Rahma', assignments: { 'loc-jkt': ['role-qc'], 'loc-bdg': ['role-wh'] } }`, dan tambahkan entri lokasi:

```ts
  appendAudit_({
    ts: '2026-10-07T07:30:00.000Z',
    actor,
    action: 'location.create',
    target: 'JKT',
    before: null,
    after: { code: 'JKT', name: 'Jakarta', status: 'active' },
  });
```

`web/src/lib/rpc/mock-backend.test.ts`: ganti `roleIds: []` dengan `assignments: []` pada tes FORBIDDEN dan tambahkan:

```ts
test('auth.me memuat izin per lokasi sesuai penugasan (hak berbeda di tiap lokasi)', async () => {
  const result = await call('auth.me', null, tokenOf('qc.staff@qc.local'));
  expect(result.data.permissions).toMatchObject({ item: 'none', access: 'none' });
  const byCode = Object.fromEntries(
    result.data.locations.map((l: { code: string; permissions: unknown }) => [l.code, l.permissions]),
  );
  expect(byCode.JKT).toEqual({ item: 'edit', handover: 'edit', stock: 'view' });
  expect(byCode.BDG).toEqual({ item: 'none', handover: 'view', stock: 'view' });
});

test('super admin melihat semua lokasi aktif dengan manage', async () => {
  const result = await call('auth.me', null, tokenOf(MOCK_ADMIN_EMAIL));
  expect(result.data.locations.map((l: { code: string }) => l.code)).toEqual(['BDG', 'JKT']);
});
```

- [ ] **Step 9: Jalankan seluruh tes web dan typecheck**

Run: `bun run --cwd web test && bun run --cwd web typecheck`
Expected: semua lulus, typecheck bersih. (Bila `routeTree.gen.ts` perlu diperbarui, jalankan `bun run --cwd web build` sekali.)

- [ ] **Step 10: Cek penuh dan commit**

```bash
bunx biome check --write --linter-enabled=false web
bun run check
git add shared gas web
git commit -m "feat(web): izin per lokasi dan penugasan di form User" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Halaman Lokasi

**Files:**
- Create: `web/src/modules/access/components/location-form.tsx`, `location-form.test.tsx`, `locations-table.tsx`, `web/src/routes/_app/access/locations.tsx`
- Modify: `web/src/app/navigation.ts`, `web/src/modules/access/schemas.test.ts` (tes skema lokasi), `web/src/lib/rpc/mock-backend.test.ts`

**Interfaces:**
- Consumes (Task 5): `locationFormSchema`, `toLocationFormDefaults`, `locationsQueryOptions`, `useSaveLocation`, `useSetLocationStatus`, `can`, `requirePermission`.
- Produces: rute `/access/locations`; item menu "Lokasi".

- [ ] **Step 1: Tulis tes yang gagal**

`web/src/modules/access/components/location-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { toLocationFormDefaults } from '../schemas';
import { LocationForm } from './location-form';

function renderForm(props: Partial<Parameters<typeof LocationForm>[0]> = {}) {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <LocationForm
      mode="create"
      defaultValues={toLocationFormDefaults()}
      onSubmit={onSubmit}
      onCancel={() => undefined}
      {...props}
    />,
  );
  return { onSubmit };
}

test('kode dan nama wajib diisi', async () => {
  const { onSubmit } = renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findAllByText('Wajib diisi')).toHaveLength(2);
  expect(onSubmit).not.toHaveBeenCalled();
});

test('kode dikirim dalam huruf besar dan tanpa spasi tepi', async () => {
  const { onSubmit } = renderForm();
  await userEvent.type(screen.getByLabelText('Kode'), ' jkt-01 ');
  await userEvent.type(screen.getByLabelText('Nama'), '  Jakarta ');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ code: 'JKT-01', name: 'Jakarta' }));
});

test('menolak kode lebih dari 10 karakter atau berisi karakter lain', async () => {
  renderForm();
  await userEvent.type(screen.getByLabelText('Nama'), 'X');
  await userEvent.type(screen.getByLabelText('Kode'), 'ABCDEFGHIJK');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Maksimal 10 karakter')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Kode'));
  await userEvent.type(screen.getByLabelText('Kode'), 'AB CD');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Hanya huruf, angka, dan tanda hubung')).toBeInTheDocument();
});

test('kode terkunci saat edit dan pesan error server ditampilkan', () => {
  renderForm({ mode: 'edit', submitError: 'Nama lokasi sudah dipakai' });
  expect(screen.getByLabelText('Kode')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Nama lokasi sudah dipakai');
});
```

Tambahkan di `mock-backend.test.ts`:

```ts
test('lokasi: daftar untuk akses lihat, simpan dan nonaktifkan butuh akses kelola', async () => {
  const viewer = tokenOf('access.viewer@qc.local');
  expect((await call('access.locations.list', null, viewer)).data.map((l: { code: string }) => l.code)).toEqual([
    'BDG',
    'JKT',
  ]);
  expect(await call('access.locations.save', { code: 'SBY', name: 'Surabaya' }, viewer)).toMatchObject({
    ok: false,
    error: { code: 'FORBIDDEN' },
  });
  const admin = tokenOf(MOCK_ADMIN_EMAIL);
  const created = await call('access.locations.save', { code: 'sby', name: 'Surabaya' }, admin);
  expect(created).toMatchObject({ ok: true, data: { code: 'SBY', status: 'active' } });
  const off = await call('access.locations.setStatus', { id: created.data.id, status: 'inactive' }, admin);
  expect(off.data.status).toBe('inactive');
  const me = await call('auth.me', null, admin);
  expect(me.data.locations.map((l: { code: string }) => l.code)).not.toContain('SBY');
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd web test location-form mock-backend`
Expected: FAIL — `./location-form` belum ada.

- [ ] **Step 3: Komponen form** — `web/src/modules/access/components/location-form.tsx`

```tsx
import { useForm } from '@tanstack/react-form';
import { FieldError } from '@/components/field-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LocationFormInput, LocationFormOutput } from '../schemas';
import { locationFormSchema } from '../schemas';

export interface LocationFormProps {
  mode: 'create' | 'edit';
  defaultValues: LocationFormInput;
  submitError?: string | null;
  onSubmit: (values: LocationFormOutput) => Promise<unknown>;
  onCancel: () => void;
}

export function LocationForm({
  mode,
  defaultValues,
  submitError,
  onSubmit,
  onCancel,
}: LocationFormProps) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: locationFormSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(locationFormSchema.parse(value));
    },
  });

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="code">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="location-code">Kode</Label>
            <Input
              id="location-code"
              value={field.state.value}
              disabled={mode === 'edit'}
              placeholder="mis. JKT-01"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Huruf, angka, dan tanda hubung, maksimal 10 karakter. Tidak dapat diubah setelah dibuat.
            </p>
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="name">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="location-name">Nama</Label>
            <Input
              id="location-name"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      {submitError ? (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Batal
        </Button>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Menyimpan…' : 'Simpan'}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Tabel** — `web/src/modules/access/components/locations-table.tsx`

```tsx
import type { LocationDto } from '@shared/rpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface LocationsTableProps {
  locations: readonly LocationDto[];
  canManage: boolean;
  pendingStatusId: string | null;
  onEdit: (location: LocationDto) => void;
  onToggleStatus: (location: LocationDto) => void;
}

export function LocationsTable({
  locations,
  canManage,
  pendingStatusId,
  onEdit,
  onToggleStatus,
}: LocationsTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kode</TableHead>
            <TableHead>Nama</TableHead>
            <TableHead>Status</TableHead>
            {canManage ? <TableHead className="text-right">Aksi</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {locations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canManage ? 4 : 3} className="text-center text-muted-foreground">
                Belum ada lokasi.
              </TableCell>
            </TableRow>
          ) : null}
          {locations.map((location) => (
            <TableRow key={location.id}>
              <TableCell className="font-medium">{location.code}</TableCell>
              <TableCell>{location.name}</TableCell>
              <TableCell>
                <Badge variant={location.status === 'active' ? 'default' : 'secondary'}>
                  {location.status === 'active' ? 'Aktif' : 'Nonaktif'}
                </Badge>
              </TableCell>
              {canManage ? (
                <TableCell className="space-x-2 text-right">
                  <Button size="sm" variant="outline" onClick={() => onEdit(location)}>
                    Ubah
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pendingStatusId === location.id}
                    onClick={() => onToggleStatus(location)}
                  >
                    {location.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 5: Rute** — `web/src/routes/_app/access/locations.tsx`

```tsx
import type { LocationDto } from '@shared/rpc';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { describeError } from '@/lib/rpc/describe-error';
import { LocationForm } from '@/modules/access/components/location-form';
import { LocationsTable } from '@/modules/access/components/locations-table';
import {
  locationsQueryOptions,
  useSaveLocation,
  useSetLocationStatus,
} from '@/modules/access/queries';
import type { LocationFormOutput } from '@/modules/access/schemas';
import { toLocationFormDefaults } from '@/modules/access/schemas';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

export const Route = createFileRoute('/_app/access/locations')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(locationsQueryOptions()),
  component: LocationsPage,
});

function LocationsPage() {
  const me = useMe();
  const canManage = can(me, 'access', 'manage');
  const { data: locations } = useSuspenseQuery(locationsQueryOptions());
  const saveLocation = useSaveLocation();
  const setStatus = useSetLocationStatus();
  const [editing, setEditing] = useState<LocationDto | 'new' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function closeDialog() {
    setEditing(null);
    setSubmitError(null);
  }

  async function handleSubmit(values: LocationFormOutput) {
    setSubmitError(null);
    try {
      await saveLocation.mutateAsync(
        editing && editing !== 'new' ? { ...values, id: editing.id } : values,
      );
      toast.success('Lokasi disimpan');
      closeDialog();
    } catch (error) {
      setSubmitError(describeError(error));
    }
  }

  function toggleStatus(location: LocationDto) {
    const status = location.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: location.id, status },
      {
        onSuccess: () =>
          toast.success(status === 'active' ? 'Lokasi diaktifkan' : 'Lokasi dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Lokasi</h1>
        {canManage ? <Button onClick={() => setEditing('new')}>Tambah lokasi</Button> : null}
      </div>
      <LocationsTable
        locations={locations}
        canManage={canManage}
        pendingStatusId={setStatus.isPending ? (setStatus.variables?.id ?? null) : null}
        onEdit={(location) => setEditing(location)}
        onToggleStatus={toggleStatus}
      />
      <Dialog open={editing !== null} onOpenChange={(open) => (open ? undefined : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Tambah lokasi' : 'Ubah lokasi'}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <LocationForm
              key={editing === 'new' ? 'new' : editing.id}
              mode={editing === 'new' ? 'create' : 'edit'}
              defaultValues={toLocationFormDefaults(editing === 'new' ? undefined : editing)}
              submitError={submitError}
              onSubmit={handleSubmit}
              onCancel={closeDialog}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

`web/src/app/navigation.ts`: tambahkan impor `MapPin` dan item di grup "Pengaturan Akses" (setelah Roles, sebelum Log Audit):

```ts
      {
        label: 'Lokasi',
        to: '/access/locations',
        icon: MapPin,
        permission: { module: 'access', level: 'view' },
      },
```

- [ ] **Step 6: Jalankan tes, regenerasi route tree, typecheck**

Run: `bun run --cwd web test && bun run --cwd web build && bun run --cwd web typecheck`
Expected: lulus (build memperbarui `routeTree.gen.ts`).

- [ ] **Step 7: Verifikasi visual di browser (mock dev)**

Dev server Vite berjalan di port 3000 (jalankan `bun run dev` bila belum). Login sebagai Super Admin → menu Pengaturan Akses → **Lokasi**: tabel menampilkan BDG dan JKT; tambah lokasi `sby` → tersimpan sebagai `SBY`; nonaktifkan lalu aktifkan; login sebagai Pemantau Akses → tidak ada tombol Tambah/Ubah.

- [ ] **Step 8: Cek penuh dan commit**

```bash
bunx biome check --write --linter-enabled=false web
bun run check
git add web
git commit -m "feat(web): halaman Lokasi (daftar, tambah, ubah, aktif/nonaktif)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pemilih lokasi aktif (header) dan field Lokasi

**Files:**
- Create: `web/src/modules/location/active-locations.ts`, `active-locations.test.ts`, `active-locations-context.tsx`, `location-picker.tsx`, `location-picker.test.tsx`, `location-field.tsx`, `location-field.test.tsx`
- Modify: `web/src/app/shell/app-shell.tsx`, `web/src/app/shell/app-sidebar.tsx`

**Interfaces:**
- Consumes (Task 5): `locationsWith`, `MeDto.locations`, `LocationAccessDto`, `useMe`.
- Produces:
  - `active-locations.ts`: `ACTIVE_LOCATIONS_STORAGE_KEY = 'qc.locations'`, `parseStoredLocationIds(raw)`, `normalizeSelection(stored, available)`, `toggleSelection(current, id, available)`.
  - `active-locations-context.tsx`: `ActiveLocationsProvider`, `useActiveLocations(): { available: LocationAccessDto[]; selectedIds: string[]; toggle(id): void }`.
  - `LocationPicker`, `LocationField({ id, module, level, value, onChange })`.

- [ ] **Step 1: Tulis tes fungsi murni yang gagal** — `web/src/modules/location/active-locations.test.ts`

```ts
import { expect, test } from 'vitest';
import { normalizeSelection, parseStoredLocationIds, toggleSelection } from './active-locations';

test('parseStoredLocationIds menerima array teks dan menolak sisanya', () => {
  expect(parseStoredLocationIds('["a","b"]')).toEqual(['a', 'b']);
  expect(parseStoredLocationIds('["a",3,null]')).toEqual(['a']);
  for (const raw of [null, '', 'bukan-json', '{"a":1}', '42']) {
    expect(parseStoredLocationIds(raw)).toBeNull();
  }
});

test('normalizeSelection menyaring lokasi basi dan kembali ke semua bila hasilnya kosong', () => {
  expect(normalizeSelection(['b', 'basi'], ['a', 'b', 'c'])).toEqual(['b']);
  expect(normalizeSelection(['basi'], ['a', 'b'])).toEqual(['a', 'b']);
  expect(normalizeSelection(null, ['a', 'b'])).toEqual(['a', 'b']);
  expect(normalizeSelection([], ['a'])).toEqual(['a']);
  expect(normalizeSelection(['a', 'a'], ['a', 'b'])).toEqual(['a']);
  expect(normalizeSelection(['a'], [])).toEqual([]);
});

test('toggleSelection menambah menurut urutan daftar dan tidak pernah mengosongkan pilihan', () => {
  expect(toggleSelection(['a'], 'c', ['a', 'b', 'c'])).toEqual(['a', 'c']);
  expect(toggleSelection(['c'], 'a', ['a', 'b', 'c'])).toEqual(['a', 'c']);
  expect(toggleSelection(['a', 'c'], 'a', ['a', 'b', 'c'])).toEqual(['c']);
  expect(toggleSelection(['a'], 'a', ['a', 'b'])).toEqual(['a']);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd web test active-locations`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Implementasi** — `web/src/modules/location/active-locations.ts`

```ts
export const ACTIVE_LOCATIONS_STORAGE_KEY = 'qc.locations';

export function parseStoredLocationIds(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : null;
  } catch {
    return null;
  }
}

/** Saring ke lokasi yang masih tersedia; tanpa pilihan yang sah kembali ke semua lokasi yang tersedia. */
export function normalizeSelection(
  stored: readonly string[] | null,
  available: readonly string[],
): string[] {
  const kept = [...new Set((stored ?? []).filter((id) => available.includes(id)))];
  return kept.length > 0 ? kept : [...available];
}

/** Pilihan tidak boleh kosong; urutan mengikuti `available`. */
export function toggleSelection(
  current: readonly string[],
  id: string,
  available: readonly string[],
): string[] {
  if (current.includes(id)) {
    return current.length === 1 ? [...current] : current.filter((item) => item !== id);
  }
  return available.filter((item) => item === id || current.includes(item));
}
```

- [ ] **Step 4: Tulis tes konteks, picker, dan field yang gagal**

`web/src/modules/location/location-picker.test.tsx`:

```tsx
import type { MeDto } from '@shared/rpc';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ACTIVE_LOCATIONS_STORAGE_KEY } from './active-locations';
import { ActiveLocationsProvider } from './active-locations-context';
import { LocationPicker } from './location-picker';

const none = { item: 'none', handover: 'none', stock: 'none' } as const;
let me: MeDto;

vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

function mount() {
  return render(
    <ActiveLocationsProvider>
      <LocationPicker />
    </ActiveLocationsProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  me = {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    permissions: { access: 'none', item: 'none', handover: 'none', stock: 'none' },
    locations: [
      { id: 'l-a', code: 'JKT', name: 'Jakarta', permissions: { ...none, item: 'view' } },
      { id: 'l-b', code: 'BDG', name: 'Bandung', permissions: { ...none, item: 'view' } },
    ],
  };
});
afterEach(() => localStorage.clear());

test('disembunyikan bila user hanya punya satu lokasi', () => {
  me = { ...me, locations: me.locations.slice(0, 1) };
  mount();
  expect(screen.queryByRole('button', { name: 'Pilih lokasi aktif' })).not.toBeInTheDocument();
});

test('default semua lokasi; mengubah pilihan tersimpan dan tidak bisa dikosongkan', async () => {
  mount();
  const trigger = screen.getByRole('button', { name: 'Pilih lokasi aktif' });
  expect(trigger).toHaveTextContent('Semua lokasi');
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Bandung/ }));
  expect(screen.getByRole('button', { name: 'Pilih lokasi aktif' })).toHaveTextContent('Jakarta');
  expect(localStorage.getItem(ACTIVE_LOCATIONS_STORAGE_KEY)).toBe('["l-a"]');
  await userEvent.click(screen.getByRole('button', { name: 'Pilih lokasi aktif' }));
  await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Jakarta/ }));
  expect(localStorage.getItem(ACTIVE_LOCATIONS_STORAGE_KEY)).toBe('["l-a"]');
});

test('pilihan tersimpan yang basi disaring saat dimuat', () => {
  localStorage.setItem(ACTIVE_LOCATIONS_STORAGE_KEY, '["l-b","hilang"]');
  mount();
  expect(screen.getByRole('button', { name: 'Pilih lokasi aktif' })).toHaveTextContent('Bandung');
});

test('bila semua pilihan tersimpan basi, kembali ke semua lokasi yang tersedia', () => {
  localStorage.setItem(ACTIVE_LOCATIONS_STORAGE_KEY, '["hilang"]');
  mount();
  expect(screen.getByRole('button', { name: 'Pilih lokasi aktif' })).toHaveTextContent('Semua lokasi');
});
```

`web/src/modules/location/location-field.test.tsx`:

```tsx
import type { MeDto } from '@shared/rpc';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ActiveLocationsProvider } from './active-locations-context';
import { LocationField } from './location-field';

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

beforeEach(() => {
  localStorage.clear();
  me = {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    permissions: { access: 'none', item: 'none', handover: 'none', stock: 'none' },
    locations: [
      { id: 'l-a', code: 'JKT', name: 'Jakarta', permissions: { item: 'manage', handover: 'none', stock: 'none' } },
      { id: 'l-b', code: 'BDG', name: 'Bandung', permissions: { item: 'view', handover: 'none', stock: 'none' } },
    ],
  };
});

test('hanya menawarkan lokasi aktif yang boleh ditulis user', async () => {
  const onChange = vi.fn();
  render(
    <ActiveLocationsProvider>
      <LocationField id="loc" module="item" level="edit" value="" onChange={onChange} />
    </ActiveLocationsProvider>,
  );
  const select = screen.getByLabelText('Lokasi');
  const options = within(select).getAllByRole('option').map((o) => o.textContent);
  expect(options).toContain('Jakarta (JKT)');
  expect(options).not.toContain('Bandung (BDG)');
  await userEvent.selectOptions(select, 'Jakarta (JKT)');
  expect(onChange).toHaveBeenCalledWith('l-a');
});

test('tanpa lokasi yang boleh ditulis, field dinonaktifkan dengan keterangan', () => {
  me = {
    ...me,
    locations: me.locations.map((l) => ({ ...l, permissions: { ...l.permissions, item: 'view' } })),
  };
  render(
    <ActiveLocationsProvider>
      <LocationField id="loc" module="item" level="edit" value="" onChange={() => undefined} />
    </ActiveLocationsProvider>,
  );
  expect(screen.getByLabelText('Lokasi')).toBeDisabled();
  expect(screen.getByText('Tidak ada lokasi aktif yang boleh Anda ubah.')).toBeInTheDocument();
});
```

- [ ] **Step 5: Implementasi konteks, picker, dan field**

`web/src/modules/location/active-locations-context.tsx`:

```tsx
import type { LocationAccessDto } from '@shared/rpc';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { useMe } from '@/modules/auth/use-me';
import {
  ACTIVE_LOCATIONS_STORAGE_KEY,
  normalizeSelection,
  parseStoredLocationIds,
  toggleSelection,
} from './active-locations';

interface ActiveLocationsValue {
  /** Lokasi aktif yang boleh diakses user. */
  available: LocationAccessDto[];
  /** Lokasi terpilih (selalu bagian dari `available`, tidak pernah kosong bila ada lokasi). */
  selectedIds: string[];
  toggle: (id: string) => void;
}

const ActiveLocationsContext = createContext<ActiveLocationsValue | null>(null);

function readStored(): string[] | null {
  try {
    return parseStoredLocationIds(localStorage.getItem(ACTIVE_LOCATIONS_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStored(ids: readonly string[]): void {
  try {
    localStorage.setItem(ACTIVE_LOCATIONS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Penyimpanan bisa diblokir (mode privat); pilihan tetap berlaku selama sesi halaman.
  }
}

export function ActiveLocationsProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const available = me.locations;
  const availableIds = useMemo(() => available.map((location) => location.id), [available]);
  const [stored, setStored] = useState<string[] | null>(readStored);
  const selectedIds = useMemo(() => normalizeSelection(stored, availableIds), [stored, availableIds]);

  const toggle = useCallback(
    (id: string) => {
      const next = toggleSelection(selectedIds, id, availableIds);
      setStored(next);
      writeStored(next);
    },
    [selectedIds, availableIds],
  );

  const value = useMemo(() => ({ available, selectedIds, toggle }), [available, selectedIds, toggle]);
  return <ActiveLocationsContext.Provider value={value}>{children}</ActiveLocationsContext.Provider>;
}

export function useActiveLocations(): ActiveLocationsValue {
  const value = useContext(ActiveLocationsContext);
  if (!value) throw new Error('useActiveLocations harus dipakai di dalam ActiveLocationsProvider');
  return value;
}
```

`web/src/modules/location/location-picker.tsx`:

```tsx
import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useActiveLocations } from './active-locations-context';

/** Pemilih multi-select lokasi aktif; disembunyikan bila user hanya punya satu lokasi. */
export function LocationPicker() {
  const { available, selectedIds, toggle } = useActiveLocations();
  if (available.length <= 1) return null;
  const label =
    selectedIds.length === available.length
      ? 'Semua lokasi'
      : selectedIds.length === 1
        ? (available.find((location) => location.id === selectedIds[0])?.name ?? '1 lokasi')
        : `${selectedIds.length} lokasi`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Pilih lokasi aktif">
          <MapPin aria-hidden="true" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Lokasi aktif</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {available.map((location) => (
          <DropdownMenuCheckboxItem
            key={location.id}
            checked={selectedIds.includes(location.id)}
            onCheckedChange={() => toggle(location.id)}
            onSelect={(event) => event.preventDefault()}
          >
            {location.name} <span className="text-muted-foreground">({location.code})</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

Bila `dropdown-menu.tsx` belum mengekspor `DropdownMenuCheckboxItem`/`DropdownMenuLabel`/`DropdownMenuSeparator`, jalankan dari `web/`: `bunx --bun shadcn@latest add dropdown-menu` (timpa) dan periksa diff sebelum commit.

`web/src/modules/location/location-field.tsx`:

```tsx
import type { LocatedModule } from '@shared/assignments';
import type { Level } from '@shared/permissions';
import { NativeSelect } from '@/components/native-select';
import { Label } from '@/components/ui/label';
import { locationsWith } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from './active-locations-context';

export interface LocationFieldProps {
  id: string;
  module: LocatedModule;
  /** Level minimum untuk menulis, mis. `edit`. */
  level: Level;
  value: string;
  onChange: (locationId: string) => void;
}

/** Field Lokasi untuk form tulis modul berlokasi: hanya lokasi aktif terpilih yang boleh ditulis user. */
export function LocationField({ id, module, level, value, onChange }: LocationFieldProps) {
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const options = locationsWith(me, module, level, selectedIds);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Lokasi</Label>
      <NativeSelect
        id={id}
        value={value}
        disabled={options.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled>
          Pilih lokasi…
        </option>
        {options.map((location) => (
          <option key={location.id} value={location.id}>
            {`${location.name} (${location.code})`}
          </option>
        ))}
      </NativeSelect>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Tidak ada lokasi aktif yang boleh Anda ubah.
        </p>
      ) : null}
    </div>
  );
}
```

`web/src/app/shell/app-shell.tsx`: impor `ActiveLocationsProvider` dan `LocationPicker`; bungkus `SidebarProvider` dengan `<ActiveLocationsProvider>` (di dalam `TooltipProvider`) dan tambahkan `<LocationPicker />` sebelum `<ThemeToggle />` di header.

`web/src/app/shell/app-sidebar.tsx`: `const { selectedIds } = useActiveLocations();` dan `visibleNavGroups(NAV_GROUPS, me, selectedIds)`.

- [ ] **Step 6: Jalankan tes**

Run: `bun run --cwd web test location && bun run --cwd web typecheck`
Expected: lulus.

- [ ] **Step 7: Verifikasi visual di browser (mock dev)**

Login sebagai **QC Staff**: header menampilkan "Semua lokasi" (2 lokasi); buka menu → centang/lepas Jakarta dan Bandung; label berubah; refresh halaman → pilihan bertahan; login sebagai **WH Staff** (satu lokasi): pemilih tidak tampil. Reset viewport ke desktop setelah menguji di ukuran ponsel (375×812), pemilih tetap terjangkau.

- [ ] **Step 8: Cek penuh dan commit**

```bash
bunx biome check --write --linter-enabled=false web
bun run check
git add web
git commit -m "feat(web): pemilih lokasi aktif multi-select dan field Lokasi" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Diff audit untuk penugasan dan lokasi, dokumentasi, dan penutup

**Files:**
- Modify: `web/src/modules/access/lib/audit-diff.ts`, `audit-diff.test.ts`, `audit-actions.ts`, `components/audit-diff-view.tsx`, `audit-diff-view.test.tsx`, `web/src/routes/_app/access/audit.tsx`, `docs/adding-a-module.md`, `docs/e2e-checklist.md`, `CLAUDE.md`, `docs/prd/2026-10-08-qc-lokasi-cabang.md`

**Interfaces:**
- Consumes: snapshot audit user `assignments: { [locationKey]: roleIds[] }` (Task 3), snapshot lokasi `{code, name, status}` (Task 2), `locationsQueryOptions` (Task 5).
- Produces: `diffList(before, after): ChildDiff[]` (diekspor dari `audit-diff.ts`); prop `AuditDiffView.locationNames?: ReadonlyMap<string, string>`; label aksi `location.*`.

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan ke `web/src/modules/access/lib/audit-diff.test.ts`:

```ts
import { diffList } from './audit-diff';

test('diffList membandingkan dua daftar sebagai himpunan', () => {
  expect(diffList(['a', 'b'], ['b', 'c']).map((c) => [c.label, c.kind])).toEqual([
    ['b', 'unchanged'],
    ['c', 'added'],
    ['a', 'removed'],
  ]);
  expect(diffList(undefined, ['a']).map((c) => [c.label, c.kind])).toEqual([['a', 'added']]);
  expect(diffList(['a'], undefined).map((c) => [c.label, c.kind])).toEqual([['a', 'removed']]);
});

test('penugasan: peta lokasi→role dibandingkan per lokasi', () => {
  const [field] = diffSnapshots(
    { assignments: { '*': ['r1'], 'l-a': ['r1'] } },
    { assignments: { '*': ['r1', 'r2'], 'l-b': ['r1'] } },
  );
  expect(field?.kind).toBe('changed');
  expect(field?.children?.map((c) => [c.label, c.kind])).toEqual([
    ['*', 'changed'],
    ['l-b', 'added'],
    ['l-a', 'removed'],
  ]);
});
```

Tambahkan ke `audit-diff-view.test.tsx`:

```tsx
test('penugasan ditampilkan per lokasi dengan nama lokasi dan role yang ditambah atau dihapus', () => {
  render(
    <AuditDiffView
      before={{ assignments: { '*': ['r1'], 'l-a': ['r1'] } }}
      after={{ assignments: { '*': ['r1', 'r2'], 'l-b': ['r1'] } }}
      roleNames={new Map([['r1', 'Manajer'], ['r2', 'Pemantau']])}
      locationNames={new Map([['l-a', 'Jakarta'], ['l-b', 'Bandung']])}
    />,
  );
  const field = row('assignments');
  expect(within(field).getByText('Penugasan')).toBeInTheDocument();
  const items = [...field.querySelectorAll(':scope > ul > li[data-kind]')].map((item) => [
    item.querySelector('[data-slot="label"]')?.textContent,
    item.getAttribute('data-kind'),
  ]);
  expect(items).toEqual([
    ['Semua lokasi', 'changed'],
    ['Bandung', 'added'],
    ['Jakarta', 'removed'],
  ]);
  const everywhere = field.querySelector('li[data-kind="changed"]') as HTMLElement;
  const roles = [...everywhere.querySelectorAll('li[data-kind]')].map((item) => [
    item.textContent,
    item.getAttribute('data-kind'),
  ]);
  expect(roles).toEqual([
    ['Manajer', 'unchanged'],
    ['Pemantau', 'added'],
  ]);
});

test('field lokasi memakai label yang mudah dibaca', () => {
  render(
    <AuditDiffView
      before={null}
      after={{ code: 'JKT', name: 'Jakarta', status: 'active' }}
    />,
  );
  expect(within(row('code')).getByText('Kode')).toBeInTheDocument();
  expect(within(row('status')).getByText('Aktif')).toBeInTheDocument();
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd web test audit`
Expected: FAIL — `diffList` belum diekspor, field `assignments` belum dikenali.

- [ ] **Step 3: Implementasi**

`web/src/modules/access/lib/audit-diff.ts`: ganti nama fungsi `arrayChildren` menjadi ekspor `diffList` (definisi sama), dan perbarui pemakaian di `childrenOf`:

```ts
export function diffList(before: unknown, after: unknown): ChildDiff[] {
  // (isi persis seperti arrayChildren sebelumnya)
}
...
function childrenOf(before: unknown, after: unknown): ChildDiff[] | undefined {
  if (Array.isArray(before) || Array.isArray(after)) return diffList(before, after);
  if (isPlainObject(before) || isPlainObject(after)) return objectChildren(before, after);
  return undefined;
}
```

`web/src/modules/access/lib/audit-actions.ts`: tambahkan ke `AUDIT_ACTION_LABELS`:

```ts
  'location.create': 'Lokasi dibuat',
  'location.update': 'Lokasi diubah',
  'location.activate': 'Lokasi diaktifkan',
  'location.deactivate': 'Lokasi dinonaktifkan',
```

`web/src/modules/access/components/audit-diff-view.tsx`:
- Tambah impor `ALL_LOCATIONS_KEY` dari `@shared/assignments` dan `diffList` dari `../lib/audit-diff`.
- `FIELD_LABELS`: tambahkan `code: 'Kode'` dan `assignments: 'Penugasan'`.
- Tambah prop `locationNames?: ReadonlyMap<string, string>` pada `AuditDiffViewProps` (default `new Map()`) dan teruskan ke `FieldRow` dan `ChildItem`.
- Di `ChildItem`, tambahkan cabang sebelum pembentukan `label` untuk field `assignments`:

```tsx
  if (fieldKey === 'assignments') {
    const location =
      child.label === ALL_LOCATIONS_KEY
        ? 'Semua lokasi'
        : (locationNames.get(child.label) ?? child.label);
    const style = child.kind === 'unchanged' ? null : KIND_STYLES[child.kind];
    const Icon = style?.icon;
    return (
      <li
        data-kind={child.kind}
        className={cn('space-y-1 rounded-md border px-2 py-1 text-sm', style ? style.box : 'border-transparent bg-muted/50')}
      >
        <div className="flex items-center gap-1.5">
          {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
          {style ? <span className="sr-only">{style.label}: </span> : null}
          <span data-slot="label" className={child.kind === 'removed' ? 'line-through' : undefined}>
            {location}
          </span>
        </div>
        <ul className="flex flex-wrap gap-1">
          {diffList(child.before, child.after).map((roleDiff) => (
            <li
              key={roleDiff.label}
              data-kind={roleDiff.kind}
              className={cn(
                'rounded border px-1.5 py-0.5 text-xs',
                roleDiff.kind === 'unchanged' ? 'border-transparent bg-muted' : KIND_STYLES[roleDiff.kind].box,
                roleDiff.kind === 'removed' ? 'line-through' : '',
              )}
            >
              {roleNames.get(roleDiff.label) ?? roleDiff.label}
            </li>
          ))}
        </ul>
      </li>
    );
  }
```

`web/src/routes/_app/access/audit.tsx`: tambahkan `locationsQueryOptions` pada import `queries`, pada `loader` tambahkan `context.queryClient.ensureQueryData(locationsQueryOptions())`, di komponen `const { data: locations } = useSuspenseQuery(locationsQueryOptions());`, `const locationNames = new Map(locations.map((l) => [l.id, l.name]));` dan teruskan `locationNames={locationNames}` ke `AuditDiffView`.

- [ ] **Step 4: Jalankan tes web**

Run: `bun run --cwd web test && bun run --cwd web typecheck`
Expected: lulus.

- [ ] **Step 5: Dokumentasi**

`docs/adding-a-module.md` — tambahkan bagian baru di akhir:

````markdown
## Modul berlokasi (izin per lokasi)

Modul `item`, `handover`, dan `stock` bersifat berlokasi (`LOCATION_MODULES` di `shared/assignments.ts`); `access` global. Untuk modul berlokasi:

1. **Rute GAS** wajib menandai `scope: 'location'`:

   ```ts
   'item.list': {
     permission: { module: 'item', level: 'view', scope: 'location' },
     validate: validateListItems_,   // input memuat `locationIds: string[]`
     handler: (input, ctx) => listItems_(ctx.locationIds),
   },
   'item.save': {
     permission: { module: 'item', level: 'edit', scope: 'location' },
     validate: validateSaveItem_,    // input memuat `locationId: string`
     handler: (input, ctx) => saveItem_(input, ctx.locationIds[0]),
   },
   ```

   Router memeriksa tiap lokasi (ada, aktif, level cukup); satu gagal menolak seluruh permintaan dengan `FORBIDDEN`. **Gunakan `ctx.locationIds`, bukan input mentah.** Lupa `scope: 'location'` membuat izin diperiksa secara global.
2. **Data**: setiap baris punya kolom `location_id`; baca difilter ke `ctx.locationIds`, ubah/hapus memeriksa lokasi baris yang ada (izin ditegakkan lagi di lokasi baris itu).
3. **Frontend**: baca dengan `useActiveLocations().selectedIds`; form tulis memakai `LocationField` (`web/src/modules/location/location-field.tsx`); menu memakai `permission: { module, level, scope: 'location' }` pada `NAV_GROUPS`; guard route memakai `requirePermission` (memeriksa minimal satu lokasi).
4. **Tabel**: tampilkan kolom **Lokasi** bila `selectedIds.length > 1` (PRD FR-C5); dengan satu lokasi terpilih kolom itu tidak perlu.
5. **Tes**: tambahkan kasus lokasi terlarang, tak dikenal, dan nonaktif untuk method baru.
````

`docs/e2e-checklist.md` — tambahkan baris (lanjut nomor 16 dst.):

```markdown
| 16 | Buat dua lokasi (mis. JKT dan BDG) di Pengaturan Akses → Lokasi | Tersimpan, tercatat di `audit_log` (`location.create`) | FR-L1–L4 |
| 17 | Edit user B: tambah penugasan JKT = role Manajer dan BDG = role Pemantau | Tersimpan; tabel Users merangkum penugasan per lokasi | FR-AS1, FR-AS4 |
| 18 | Login sebagai B | Pemilih lokasi tampil di header ("Semua lokasi"); memilih satu lokasi mengubah label dan bertahan setelah refresh | FR-C1, FR-C2 |
| 19 | Nonaktifkan lokasi BDG, muat ulang B | BDG hilang dari pemilih | FR-L3, FR-P8 |
| 20 | Pasang role ber-Pengaturan Akses pada penugasan lokasi tertentu (bukan Semua lokasi) | Menu Pengaturan Akses tidak tampil untuk user itu | FR-P7 |
| 21 | Di console frame aplikasi, panggil `api` method berlokasi dengan `locationIds` berisi lokasi yang tidak diizinkan | `"code":"FORBIDDEN"`, tidak ada data | FR-E2 |
| 22 | Admin non-super mengedit penugasannya sendiri hingga kehilangan Kelola global | Ditolak dengan pesan jelas | FR-AS5 |
| 23 | Buka Log Audit, detail `user.update` yang mengubah penugasan | Diff menampilkan lokasi dan role yang ditambah, diubah, dihapus | FR-AU2, FR-AU3 |
| 24 | Setelah deploy: jalankan `setup` | Laporan menyebut user lama dimigrasi; hak user lama tidak berubah | NFR-L2 |
```

`CLAUDE.md` — di bagian "Menambah method RPC" tambahkan butir: "Modul berlokasi: tandai `scope: 'location'` pada izin rute dan pakai `ctx.locationIds` (lihat `docs/adding-a-module.md`)." dan di "Struktur" tambahkan `web/src/modules/location/` (lokasi aktif, pemilih, field).

`docs/prd/2026-10-08-qc-lokasi-cabang.md` — ubah status menjadi `Dirilis` dan centang Definition of Done yang terpenuhi setelah verifikasi akhir.

- [ ] **Step 6: Verifikasi akhir (otomatis)**

```bash
bun run check
bun run build
```

Expected: `check` hijau (shared, gas, web, scripts), `build` lolos `verify-dist` (penanda boot tepat satu kali; tidak ada import/export di `gas/dist`).

- [ ] **Step 7: Verifikasi akhir (manual di browser, mock dev)**

Login sebagai Super Admin: buat lokasi, edit user dengan penugasan berbeda per lokasi, buka Log Audit dan lihat diff penugasan berwarna. Login sebagai QC Staff: pemilih lokasi, menu mengikuti pilihan. Uji ukuran ponsel (375×812) untuk pemilih dan bagian Penugasan; reset ke desktop setelah selesai.

- [ ] **Step 8: Commit**

```bash
bunx biome check --write --linter-enabled=false web docs
git add web docs CLAUDE.md
git commit -m "feat(audit): diff penugasan dan lokasi, dokumentasi modul berlokasi" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Penutup (setelah Task 8)

- Ikuti `superpowers:executing-plans`: review akhir seluruh branch oleh reviewer terpisah (model paling mampu) dengan paket `review-package`, perbaiki temuan Critical/Important dalam satu putaran dengan TDD, catat Minor.
- Push branch `feat/lokasi-cabang`, buka PR ke `dev` (merge memicu deploy dev), uji di `/dev`, lalu PR `dev` → `main` (deploy `/exec`). **Jalankan fungsi `setup` sekali** setelah deploy agar `role_ids` lama dimigrasi dan sheet `locations` dibuat (sebelum itu aplikasi tetap bekerja berkat fallback baca di repo).
