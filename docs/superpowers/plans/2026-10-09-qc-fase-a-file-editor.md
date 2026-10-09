# Fase A — Fondasi File Drive, Editor Markdown, dan Model Izin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyiapkan fondasi yang dibutuhkan Data Item dan Serah Terima: penyimpanan gambar privat di Google Drive, editor Markdown aman dengan sisip gambar, modul izin `qc`, `item` sebagai modul global bersama, dan izin rute "salah satu dari" (`anyOf`).

**Architecture:** Model izin diperluas di `shared/` (fungsi murni `resolveAccess`), router GAS mendapat `RoutePermissionSpec`, `Platform` mendapat operasi Drive dan `setProperty`, modul baru `gas/src/modules/files/` (sheet `files`, RPC `files.upload`/`files.get`), lalu frontend mendapat `modules/files` (kompres + upload + tampil) dan `modules/markdown` (render aman + editor). Dokumen merujuk gambar dengan `qcfile:<id>`, bukan URL Drive.

**Tech Stack:** Bun 1.4 (workspaces `shared`, `gas`, `web`), TypeScript strict, GAS V8 (transpile per file), React 19 + TanStack, shadcn, zod, `react-markdown` + `remark-gfm` (baru), Vitest, `bun:test`, Biome.

**Spec:** `docs/prd/2026-10-09-qc-item-serah-terima.md` — bagian 4.1 (FP1–FP5), 4.2 (FA1–FA7), 6.1–6.4, 8, dan DoD "Fase A".

## Global Constraints

- Semua balasan, teks UI, pesan galat, dan komentar berbahasa Indonesia; identifier tetap Inggris/aslinya.
- Aturan GAS (`CLAUDE.md`, ditegakkan `scripts/build-gas.ts`): fungsi top-level di `gas/src` WAJIB berakhiran `_` kecuali `doGet`/`api`/`setup`; nama top-level unik di seluruh `gas/src` + `shared/`; dilarang `export default`, re-export, import alias/namespace/dynamic, `class`, `enum`; tanpa `Object.hasOwn`; akses API GAS hanya lewat `platform_()`; tulis sheet di dalam `platform_().withLock(...)`. Jangan memanggil `withLock` bersarang (lock script GAS tidak dijamin reentrant).
- Fungsi murni di `shared/` boleh tanpa akhiran `_` (PRD fondasi NFR-2).
- Gambar: hanya `image/jpeg`, `image/png`, `image/webp`; sisi terpanjang maks. **1600 px** setelah dikecilkan klien; hasil kompresi maks. **1 MB** (`1_048_576` byte); server menolak lebih dari itu.
- Markdown: maks. **20.000 karakter**; **tanpa HTML mentah**; tautan hanya `http`, `https`, `mailto`; gambar hanya skema `qcfile:`.
- Drive: folder privat milik pemilik script, tidak dibagikan publik; izin scope `https://www.googleapis.com/auth/drive` ditambahkan ke `appsscript.json`.
- Ukuran `gas/dist/index.html` tidak melebihi **1,5 MB** (PRD NFR4).
- `bun run check` hijau sebelum push. Format tanpa lint: `bunx biome check --write --linter-enabled=false <path>`.
- Commit diakhiri `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Jangan mengedit `gas/dist/` manual.
- Bun: `export PATH="$PATH:$HOME/.bun/bin"` di Git Bash. Hindari perintah majemuk berisi `case ... ;;` di Bash tool.
- Typecheck dan tes `web`/`gas` boleh merah **di tengah Task 1** karena modul izin berubah di `shared/` lebih dulu; wajib hijau di akhir Task 1.

## Review Focus

Risiko yang spec tersirat tetapi tidak dijaga tes tugas biasa; tiap baris punya tes di tugas pemiliknya:

1. **XSS lewat Markdown:** `<script>`/HTML mentah, tautan `javascript:`/`data:`/`//host`, dan gambar `https://` eksternal tidak boleh dieksekusi atau dimuat. → Task 7.
2. **Akses Drive sembarang:** `files.get` hanya boleh membaca Drive id yang tercatat di sheet `files`; id tak dikenal `NOT_FOUND`, dan klien tidak pernah mengirim Drive id. → Task 4.
3. **Upload nakal:** MIME salah, tanda tangan berkas tidak cocok MIME, base64 rusak, terlalu besar, lebar/tinggi nol atau raksasa ditolak sebelum menyentuh Drive. → Task 4.
4. **Eskalasi izin lewat model baru:** `item` global dari penugasan **lokasi nonaktif** tidak boleh berlaku, dan `access` tetap **hanya** dari "Semua lokasi" (tidak boleh ikut aturan `item`). → Task 1.
5. **`anyOf` campuran:** satu lokasi yang tidak memenuhi alternatif mana pun menolak seluruh permintaan; alternatif global dan lokasi tidak boleh dicampur dalam satu rute. → Task 2.
6. **Folder Drive ganda:** `setup` diulang atau dua upload bersamaan tidak boleh membuat dua folder. → Task 4 dan Task 5.
7. **Editor:** menempel berkas bukan gambar diabaikan dengan pesan jelas; gambar terlalu besar setelah kompresi memberi pesan, bukan diam; upload selesai setelah teks berubah menyisipkan di posisi kursor terbaru. → Task 8.

---

## Struktur Berkas

| Berkas | Tanggung jawab |
|---|---|
| `shared/permissions.ts` | Modul `qc`, label, level, petunjuk level |
| `shared/assignments.ts` | `LOCATION_MODULES` = handover, qc, stock; `item` dihitung dari semua penugasan aktif |
| `shared/files.ts` (baru) | Konstanta dan fungsi murni gambar/Markdown (MIME, batas, tanda tangan berkas, `qcfile:`) |
| `shared/rpc.ts` | Tipe `FileDto`, `UploadFileInput`, `GetFileInput`, `FileContentDto`; `files.upload`, `files.get` |
| `gas/src/core/router.ts` | `RoutePermissionSpec` dengan `anyOf` |
| `gas/src/core/platform.ts`, `gas-platform.ts`, `gas/test-support/memory-platform.ts` | `setProperty`, operasi Drive |
| `gas/appsscript.json` | Scope Drive |
| `gas/src/modules/files/{repo,validate,service,routes}.ts` (baru) | Sheet `files`, upload/baca gambar, `attachFiles_` |
| `gas/src/setup.ts` | Sheet `files`, folder Drive |
| `web/src/modules/files/` (baru) | `image.ts` (kecilkan + kompres), `queries.ts`, `use-upload-image.ts` |
| `web/src/modules/markdown/` (baru) | `edit-ops.ts`, `markdown-view.tsx`, `markdown-editor.tsx` |
| `scripts/verify-dist.ts` | Cek scope Drive dan ukuran bundel |
| `docs/…`, `CLAUDE.md` | Dokumentasi |

---

### Task 1: Model izin — modul `qc`, `item` global bersama, level handover

**Files:**
- Modify: `shared/permissions.ts`, `shared/assignments.ts`, `shared/permissions.test.ts`, `shared/assignments.test.ts`
- Modify (tes dan data demo yang ikut berubah): `gas/src/modules/access/assignments.test.ts`, `gas/src/modules/access/context.test.ts`, `gas/src/modules/auth/routes.test.ts`, `gas/src/core/router.test.ts`, `web/src/modules/auth/permissions.test.ts`, `web/src/app/navigation.test.ts`, `web/src/modules/location/location-field.test.tsx`, `web/src/modules/location/location-picker.test.tsx`, `web/src/modules/access/components/role-form.test.tsx`, `web/src/lib/rpc/mock-backend.ts`, `web/src/lib/rpc/mock-backend.test.ts`

**Interfaces:**
- Consumes: `mergePermissions`, `PermissionMap`, `Level` (`shared/permissions.ts`).
- Produces:
  - `MODULES = ['access','item','handover','qc','stock']`; `MODULE_LABELS.qc = 'Pengerjaan QC'`; `MODULE_LEVELS.qc = ['none','edit']`.
  - `LOCATION_MODULES = ['handover','qc','stock']`; `LocatedModule`, `LocationPermissionMap` mengikutinya; `SHARED_MODULES = ['item']`.
  - `resolveAccess` (tanda tangan tetap): `global.item` = level tertinggi dari semua penugasan berlaku (penugasan "Semua lokasi" **atau** lokasi yang ada di `activeLocationIds`); modul global lain (`access`, dan nilai `global` untuk modul berlokasi) tetap hanya dari "Semua lokasi".

- [ ] **Step 1: Tulis tes yang gagal untuk model izin** — ganti seluruh `shared/assignments.test.ts`

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
  ['view', { handover: 'view' }],
  ['manage', { handover: 'manage', stock: 'view' }],
  ['access', { access: 'manage' }],
  ['qc', { qc: 'edit' }],
  ['catalog', { item: 'view' }],
  ['catalog-edit', { item: 'edit' }],
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
    expect(result.byLocation.A).toEqual({ handover: 'manage', qc: 'none', stock: 'view' });
    expect(result.byLocation.B).toEqual({ handover: 'view', qc: 'none', stock: 'none' });
    expect(result.global.handover).toBe('view');
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
    expect(result.global.handover).toBe('view');
    expect(result.byLocation.A?.handover).toBe('view');
  });

  test('lokasi tempat semua level none tidak dimasukkan', () => {
    const result = resolveAccess([{ locationId: 'A', roleIds: ['view'] }], roles, ['A', 'B']);
    expect(Object.keys(result.byLocation)).toEqual(['A']);
  });

  test('beberapa role pada satu penugasan memberi level tertinggi per modul', () => {
    const result = resolveAccess([{ locationId: 'A', roleIds: ['view', 'qc'] }], roles, ['A']);
    expect(result.byLocation.A).toEqual({ handover: 'view', qc: 'edit', stock: 'none' });
  });
});

describe('item sebagai modul global bersama (FP2)', () => {
  test('level item = tertinggi dari semua penugasan, termasuk penugasan lokasi tertentu', () => {
    const result = resolveAccess(
      [
        { locationId: 'A', roleIds: ['catalog'] },
        { locationId: 'B', roleIds: ['catalog-edit'] },
      ],
      roles,
      ['A', 'B'],
    );
    expect(result.global.item).toBe('edit');
    expect(result.byLocation).toEqual({});
  });

  test('penugasan di lokasi nonaktif tidak menyumbang level item', () => {
    const result = resolveAccess([{ locationId: 'MATI', roleIds: ['catalog-edit'] }], roles, ['A']);
    expect(result.global.item).toBe('none');
  });

  test('role item pada Semua lokasi tetap berlaku', () => {
    const result = resolveAccess([{ locationId: null, roleIds: ['catalog'] }], roles, []);
    expect(result.global.item).toBe('view');
  });

  test('access tetap hanya dari Semua lokasi walau item dari semua penugasan', () => {
    const result = resolveAccess(
      [
        { locationId: 'A', roleIds: ['access', 'catalog'] },
        { locationId: null, roleIds: ['view'] },
      ],
      roles,
      ['A'],
    );
    expect(result.global.access).toBe('none');
    expect(result.global.item).toBe('view');
  });
});

describe('modul berlokasi', () => {
  test('access dan item global, sisanya berlokasi', () => {
    expect(isLocatedModule('access')).toBe(false);
    expect(isLocatedModule('item')).toBe(false);
    expect(isLocatedModule('handover')).toBe(true);
    expect(isLocatedModule('qc')).toBe(true);
    expect(isLocatedModule('stock')).toBe(true);
  });

  test('fullLocationPermissions memberi manage di semua modul berlokasi', () => {
    expect(fullLocationPermissions()).toEqual({ handover: 'manage', qc: 'manage', stock: 'manage' });
  });
});
```

- [ ] **Step 2: Perbarui tes `shared/permissions.test.ts`**

Ganti ekspektasi dan tambah tes berikut (cari teks lama persis):

- Di `mergePermissions` › "mengambil level tertinggi…": `toEqual({ access: 'none', item: 'manage', handover: 'edit', stock: 'none' })` → `toEqual({ access: 'none', item: 'manage', handover: 'edit', qc: 'none', stock: 'none' })`.
- Di "mengabaikan modul/level tak dikenal…": `toEqual({ access: 'none', item: 'none', handover: 'none', stock: 'view' })` → `toEqual({ access: 'none', item: 'none', handover: 'none', qc: 'none', stock: 'view' })`.
- Di `fullPermissions`: tambahkan `qc: 'manage',` di antara `handover: 'manage',` dan `stock: 'manage',`.
- Di "tiap modul hanya menawarkan level yang bermakna": tambah `expect(levelsFor('qc')).toEqual(['none', 'edit']);`.
- Di "sanitizePermissions menurunkan level…": tambah `expect(sanitizePermissions({ qc: 'manage' })).toEqual({ qc: 'edit' });`.
- Di "levelHint…": ganti `expect(levelHint('item', 'view')).toBe(LEVEL_HINTS.view);` dengan:

```ts
    expect(levelHint('item', 'none')).toBe(LEVEL_HINTS.none);
    expect(levelHint('qc', 'edit')).toContain('progres');
    expect(levelHint('handover', 'manage')).toContain('membatalkan');
    expect(levelHint('item', 'manage')).toContain('customer');
```

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `bun run --cwd shared test`
Expected: FAIL (modul `qc` belum ada, `isLocatedModule('item')` masih `true`).

- [ ] **Step 4: Implementasi `shared/permissions.ts`**

Ubah baris-baris berikut:

```ts
export const MODULES = ['access', 'item', 'handover', 'qc', 'stock'] as const;
```

```ts
export const MODULE_LABELS: Record<ModuleKey, string> = {
  access: 'Pengaturan Akses',
  item: 'Data Item',
  handover: 'Serah Terima QC–WH',
  qc: 'Pengerjaan QC',
  stock: 'Monitoring Stok',
};
```

```ts
export const MODULE_LEVELS: Record<ModuleKey, readonly Level[]> = {
  access: ['none', 'view', 'manage'],
  item: ['none', 'view', 'edit', 'manage'],
  handover: ['none', 'view', 'edit', 'manage'],
  qc: ['none', 'edit'],
  stock: ['none', 'view'],
};
```

Ganti `MODULE_LEVEL_HINTS`:

```ts
export const MODULE_LEVEL_HINTS: Partial<Record<ModuleKey, Partial<Record<Level, string>>>> = {
  access: {
    view: 'Melihat daftar user, role, dan log audit.',
    manage: 'Melihat, serta menambah, mengubah, dan menonaktifkan user dan role.',
  },
  item: {
    view: 'Melihat katalog item dan daftar customer.',
    edit: 'Melihat serta menambah dan mengubah item.',
    manage: 'Semua akses Ubah, ditambah menonaktifkan item dan mengelola customer.',
  },
  handover: {
    view: 'Melihat task serah terima di lokasi penugasan.',
    edit: 'Melihat serta membuat dan mengubah isi task serah terima.',
    manage: 'Semua akses Ubah, ditambah membatalkan task.',
  },
  qc: {
    edit: 'Melihat task di lokasi penugasan dan memperbarui progres pengerjaan (qty selesai, tandai selesai).',
  },
  stock: { view: 'Melihat monitoring stok yang belum QC.' },
};
```

- [ ] **Step 5: Implementasi `shared/assignments.ts`**

Ganti definisi modul berlokasi (bagian atas berkas, di bawah impor):

```ts
/** Modul yang izinnya dihitung per lokasi. `access` dan `item` bersifat global (PRD FR-P7, FP2). */
export const LOCATION_MODULES = ['handover', 'qc', 'stock'] as const;
export type LocatedModule = (typeof LOCATION_MODULES)[number];
export type LocationPermissionMap = Record<LocatedModule, Level>;

/** Modul global yang levelnya dihitung dari SEMUA penugasan berlaku, bukan hanya "Semua lokasi". */
export const SHARED_MODULES = ['item'] as const;
```

Ganti `resolveAccess`:

```ts
/**
 * Izin efektif seorang user: global dan per lokasi aktif.
 * - Per lokasi: gabungan "Semua lokasi" + penugasan lokasi itu (level tertinggi per modul).
 * - Global: hanya dari "Semua lokasi" (satu-satunya sumber `access`); kecuali `SHARED_MODULES`
 *   (`item`) yang diambil dari semua penugasan berlaku ("Semua lokasi" atau lokasi aktif).
 */
export function resolveAccess(
  assignments: readonly Assignment[],
  rolePermissions: ReadonlyMap<string, PartialPermissionMap>,
  activeLocationIds: readonly string[],
): ResolvedAccess {
  const everywhere = assignments.find((entry) => entry.locationId === null);
  const globalSources = rolePermissionSources(everywhere?.roleIds ?? [], rolePermissions);
  const global = mergePermissions(globalSources);

  const active = new Set(activeLocationIds);
  const applicable = assignments.filter(
    (entry) => entry.locationId === null || active.has(entry.locationId),
  );
  const shared = mergePermissions(
    applicable.flatMap((entry) => rolePermissionSources(entry.roleIds, rolePermissions)),
  );
  for (const module of SHARED_MODULES) global[module] = shared[module];

  const byLocation: Record<string, LocationPermissionMap> = {};
  for (const locationId of activeLocationIds) {
    const local = assignments.find((entry) => entry.locationId === locationId);
    const merged = mergePermissions([
      ...globalSources,
      ...rolePermissionSources(local?.roleIds ?? [], rolePermissions),
    ]);
    const entry = {} as LocationPermissionMap;
    for (const module of LOCATION_MODULES) entry[module] = merged[module];
    if (LOCATION_MODULES.some((module) => entry[module] !== 'none')) byLocation[locationId] = entry;
  }
  return { global, byLocation };
}
```

`fullLocationPermissions` menjadi:

```ts
export function fullLocationPermissions(): LocationPermissionMap {
  return { handover: 'manage', qc: 'manage', stock: 'manage' };
}
```

- [ ] **Step 6: Jalankan tes shared**

Run: `bun run --cwd shared test`
Expected: lulus (semua tes `permissions` dan `assignments`).

- [ ] **Step 7: Perbarui tes dan data demo yang ikut berubah (gas)**

Aturan umum: pada konteks **per lokasi**, modul `item` diganti `handover` (item kini global); setiap objek `PermissionMap`/`LocationPermissionMap` penuh menambah `qc`.

`gas/src/modules/access/assignments.test.ts`:
- `role({ id: 'r-view', …, permissions: { item: 'view' } })` → `permissions: { handover: 'view' }`.
- `role({ id: 'r-manage', …, permissions: { item: 'manage', stock: 'view' } })` → `permissions: { handover: 'manage', stock: 'view' }`.
- Ekspektasi `{ item: 'manage', handover: 'none', stock: 'view' }` → `{ handover: 'manage', qc: 'none', stock: 'view' }`; `{ item: 'view', handover: 'none', stock: 'none' }` → `{ handover: 'view', qc: 'none', stock: 'none' }`.
- `ctx?.permissions.item` → `ctx?.permissions.handover` (tiga tempat: tes "hak berbeda", tes "role_ids lama", tes "JSON assignments rusak"); `ctx?.locations['l-a']?.item` → `ctx?.locations['l-a']?.handover`.
- Tambah tes:

```ts
test('item global dari penugasan lokasi tertentu (FP2), tetapi tidak dari lokasi nonaktif', () => {
  insertRole_(role({ id: 'r-item', name: 'Katalog', permissions: { item: 'edit' } }));
  insertUser_(
    user({
      id: 'u-item',
      email: 'item@gmail.com',
      assignments: [
        { locationId: 'l-a', roleIds: ['r-item'] },
        { locationId: 'l-mati', roleIds: ['r-item'] },
      ],
    }),
  );
  insertUser_(
    user({
      id: 'u-mati',
      email: 'mati@gmail.com',
      assignments: [{ locationId: 'l-mati', roleIds: ['r-item'] }],
    }),
  );
  expect(loadUserContext_('item@gmail.com')?.permissions.item).toBe('edit');
  expect(loadUserContext_('mati@gmail.com')?.permissions.item).toBe('none');
});
```

`gas/src/modules/access/context.test.ts`: tambahkan `qc: 'none'` pada setiap objek `toEqual` yang menuliskan seluruh `PermissionMap`. Pembacaan `permissions.item` dari penugasan "Semua lokasi" tidak berubah.

`gas/src/modules/auth/routes.test.ts`: role `r1` → `permissions: { handover: 'manage' }`; ekspektasi JKT → `permissions: { handover: 'manage', qc: 'none', stock: 'none' }`; ekspektasi super admin → `{ handover: 'manage', qc: 'manage', stock: 'manage' }`.

`gas/src/core/router.test.ts`:
- Dua rute uji berlokasi: `module: 'item'` → `module: 'handover'` (di `'item.list'` dan `'item.save'`; kunci rute dibiarkan).
- Role `r-item-view` → `permissions: { handover: 'view' }`, `r-item-manage` → `permissions: { handover: 'manage' }`.
- Tes tipe lama diganti:

```ts
test('tipe: modul berlokasi wajib menandai scope location (tidak diam-diam memakai izin global)', () => {
  // @ts-expect-error modul berlokasi tanpa scope: 'location' harus ditolak compiler
  const salah: RoutePermission = { module: 'handover', level: 'view' };
  const benar: RoutePermission = { module: 'handover', level: 'view', scope: 'location' };
  const global: RoutePermission = { module: 'item', level: 'view' };
  expect([salah, benar, global]).toHaveLength(3);
});
```

- [ ] **Step 8: Perbarui tes dan data demo yang ikut berubah (web)**

`web/src/modules/auth/permissions.test.ts` — ganti seluruhnya:

```ts
import type { MeDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { can, canAnywhere, canAt, locationsWith } from './permissions';

const me: MeDto = {
  email: 'a@gmail.com',
  name: 'A',
  isSuperAdmin: false,
  permissions: { access: 'view', item: 'view', handover: 'none', qc: 'none', stock: 'none' },
  locations: [
    { id: 'l-a', code: 'A', name: 'A', permissions: { handover: 'manage', qc: 'none', stock: 'view' } },
    { id: 'l-b', code: 'B', name: 'B', permissions: { handover: 'view', qc: 'none', stock: 'none' } },
  ],
};

test('can memeriksa izin global per modul', () => {
  expect(can(me, 'access', 'view')).toBe(true);
  expect(can(me, 'access', 'manage')).toBe(false);
  expect(can(me, 'item', 'view')).toBe(true);
  expect(can(me, 'handover', 'view')).toBe(false);
  expect(can(undefined, 'item', 'view')).toBe(false);
});

test('canAt memeriksa izin di satu lokasi; lokasi tak dikenal ditolak', () => {
  expect(canAt(me, 'handover', 'manage', 'l-a')).toBe(true);
  expect(canAt(me, 'handover', 'manage', 'l-b')).toBe(false);
  expect(canAt(me, 'handover', 'view', 'l-x')).toBe(false);
  expect(canAt(undefined, 'handover', 'view', 'l-a')).toBe(false);
});

test('locationsWith menyaring lokasi menurut level dan batasan pilihan', () => {
  expect(locationsWith(me, 'handover', 'manage').map((l) => l.id)).toEqual(['l-a']);
  expect(locationsWith(me, 'handover', 'view').map((l) => l.id)).toEqual(['l-a', 'l-b']);
  expect(locationsWith(me, 'handover', 'view', ['l-b']).map((l) => l.id)).toEqual(['l-b']);
  expect(locationsWith(undefined, 'handover', 'view')).toEqual([]);
});

test('canAnywhere: modul global memakai izin global, modul berlokasi memakai lokasi', () => {
  expect(canAnywhere(me, 'access', 'view')).toBe(true);
  expect(canAnywhere(me, 'item', 'view')).toBe(true);
  expect(canAnywhere(me, 'stock', 'view')).toBe(true);
  expect(canAnywhere(me, 'stock', 'view', ['l-b'])).toBe(false);
  expect(canAnywhere(me, 'qc', 'edit')).toBe(false);
  expect(canAnywhere(undefined, 'handover', 'view')).toBe(false);
});
```

`web/src/app/navigation.test.ts`: pada dua objek `me`, tambah `qc: 'none'` di `permissions`; pada tes "item berlingkup lokasi…" ganti `permission: { module: 'item', level: 'view', scope: 'location' }` → `{ module: 'handover', level: 'view', scope: 'location' }`, dan lokasi menjadi `l-a: { handover: 'view', qc: 'none', stock: 'none' }`, `l-b: { handover: 'none', qc: 'none', stock: 'view' }`.

`web/src/modules/location/location-field.test.tsx`: semua `module="item"` → `module="handover"`; `permissions: { item: 'manage', handover: 'none', stock: 'none' }` → `{ handover: 'manage', qc: 'none', stock: 'none' }`; `{ item: 'view', handover: 'none', stock: 'none' }` → `{ handover: 'view', qc: 'none', stock: 'none' }`; `permissions: { ...l.permissions, item: 'view' }` → `{ ...l.permissions, handover: 'view' }`; `permissions` global `me` tambah `qc: 'none'`.

`web/src/modules/location/location-picker.test.tsx`: `const none = { item: 'none', handover: 'none', stock: 'none' } as const;` → `{ handover: 'none', qc: 'none', stock: 'none' } as const;`; `permissions: { ...none, item: 'view' }` → `{ ...none, handover: 'view' }` (dua tempat); `permissions` global `me` tambah `qc: 'none'`.

`web/src/modules/access/components/role-form.test.tsx`: setiap objek `PermissionMap` penuh menambah `qc: 'none'` (mis. `{ access: 'none', item: 'manage', handover: 'none', qc: 'none', stock: 'none' }`).

`web/src/lib/rpc/mock-backend.ts`: ganti peran demo dan label:

```ts
  {
    email: 'qc.staff@qc.local',
    label: 'QC Staff (Jakarta: kerjakan task QC; Bandung: serah terima kelola)',
  },
  { email: 'wh.staff@qc.local', label: 'WH Staff (Bandung saja: serah terima kelola)' },
```

dan role:

```ts
  insertRole_(
    role({
      id: 'role-qc',
      name: 'QC Staff',
      description: 'Petugas QC',
      permissions: { item: 'view', handover: 'view', qc: 'edit', stock: 'view' },
    }),
  );
  insertRole_(
    role({
      id: 'role-wh',
      name: 'WH Staff',
      description: 'Petugas gudang',
      permissions: { item: 'view', handover: 'manage', stock: 'view' },
    }),
  );
```

`web/src/lib/rpc/mock-backend.test.ts`: tes "auth.me memuat izin per lokasi…" menjadi:

```ts
test('auth.me memuat izin per lokasi sesuai penugasan (hak berbeda di tiap lokasi)', async () => {
  const result = await call('auth.me', null, tokenOf('qc.staff@qc.local'));
  expect(result.data.permissions).toMatchObject({ access: 'none', item: 'view' });
  const byCode = Object.fromEntries(
    result.data.locations.map((l: { code: string; permissions: unknown }) => [l.code, l.permissions]),
  );
  expect(byCode.JKT).toEqual({ handover: 'view', qc: 'edit', stock: 'view' });
  expect(byCode.BDG).toEqual({ handover: 'manage', qc: 'none', stock: 'view' });
});
```

Lalu jalankan dan perbaiki sisa kegagalan mekanis menurut dua aturan di atas:

Run: `bun run check`
Expected: hijau. Bila `tsc` menandai `Record<ModuleKey, …>` atau literal `PermissionMap` lain yang belum memuat `qc` (mis. kartu modul di beranda, data uji lain), tambahkan entri `qc` sesuai konteksnya (label "Pengerjaan QC", `qc: 'none'` pada literal tes).

- [ ] **Step 9: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false shared gas web
git add shared gas web
git commit -m "feat(izin): modul qc, item global bersama, dan petunjuk level handover" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Router — izin rute "salah satu dari" (`anyOf`)

**Files:**
- Modify: `gas/src/core/router.ts`, `gas/src/core/router.test.ts`

**Interfaces:**
- Consumes: `UserContext.permissions`, `UserContext.locations` (Task 1), `hasLevel`.
- Produces: `GlobalPermission`, `LocationPermission`, `RoutePermission = GlobalPermission | LocationPermission`, `RoutePermissionSpec` (= `RoutePermission` atau `{ anyOf: [...] }` dengan semua alternatif sama lingkupnya); `RouteDef.permission?: RoutePermissionSpec`.

- [ ] **Step 1: Tulis tes yang gagal** — tambahkan ke `gas/src/core/router.test.ts`

Tambahkan impor tipe `RoutePermissionSpec` pada impor `./router` (`import type { RequestContext, RoutePermission, RoutePermissionSpec, RouteTable } from './router';`). Tambahkan dua rute uji ke objek `routes` (sebelum `} as unknown as RouteTable;`):

```ts
  'task.list': {
    permission: {
      anyOf: [
        { module: 'handover', level: 'view', scope: 'location' },
        { module: 'qc', level: 'edit', scope: 'location' },
      ],
    },
    validate: (raw: unknown) => raw,
    handler: (_input: unknown, ctx: RequestContext) => {
      calls.push('tasks');
      return ctx.locationIds;
    },
  },
  'report.list': {
    permission: {
      anyOf: [
        { module: 'access', level: 'view' },
        { module: 'item', level: 'manage' },
      ],
    },
    validate: expectNull_,
    handler: () => {
      calls.push('report');
      return [];
    },
  },
```

Tambahkan ke `beforeEach` (setelah user `staf`):

```ts
  insertRole_(role({ id: 'r-ho-view', name: 'Lihat Serah Terima', permissions: { handover: 'view' } }));
  insertRole_(role({ id: 'r-qc-edit', name: 'Pengerjaan QC', permissions: { qc: 'edit' } }));
  insertRole_(role({ id: 'r-item-mgr', name: 'Admin Item', permissions: { item: 'manage' } }));
  insertUser_(
    user({ id: 'u4', email: 'qc@gmail.com', assignments: [{ locationId: 'l-a', roleIds: ['r-qc-edit'] }] }),
  );
  insertUser_(
    user({
      id: 'u5',
      email: 'campur@gmail.com',
      assignments: [
        { locationId: 'l-a', roleIds: ['r-ho-view'] },
        { locationId: 'l-b', roleIds: ['r-qc-edit'] },
      ],
    }),
  );
  insertUser_(
    user({ id: 'u6', email: 'itemmgr@gmail.com', assignments: [{ locationId: 'l-a', roleIds: ['r-item-mgr'] }] }),
  );
```

Tambahkan tes:

```ts
test('anyOf lokasi: tiap lokasi cukup memenuhi salah satu alternatif', () => {
  // campur@: handover view di l-a, qc edit di l-b → keduanya lolos walau alternatifnya berbeda
  expect(call('task.list', { locationIds: ['l-a', 'l-b'] }, 'campur@gmail.com')).toEqual({
    ok: true,
    data: ['l-a', 'l-b'],
  });
  // qc@: hanya l-a
  expect(call('task.list', { locationId: 'l-a' }, 'qc@gmail.com').ok).toBe(true);
});

test('anyOf lokasi: satu lokasi yang tidak memenuhi alternatif mana pun menolak seluruh permintaan', () => {
  expect(errorOf(call('task.list', { locationIds: ['l-a', 'l-b'] }, 'qc@gmail.com')).code).toBe('FORBIDDEN');
  expect(errorOf(call('task.list', { locationIds: ['l-a', 'l-mati'] }, 'campur@gmail.com')).code).toBe(
    'FORBIDDEN',
  );
  expect(calls).toEqual([]);
});

test('anyOf lokasi tetap mewajibkan lokasi pada input', () => {
  expect(errorOf(call('task.list', {}, 'qc@gmail.com')).code).toBe('VALIDATION');
});

test('anyOf global: cukup salah satu izin global terpenuhi', () => {
  const run = (email: string) =>
    handleRpc_('report.list', 'null', signSessionToken_(email), routes);
  expect(run('viewer@gmail.com').ok).toBe(true); // access view
  expect(run('itemmgr@gmail.com').ok).toBe(true); // item manage dari penugasan lokal (FP2)
  expect(errorOf(run('plain@gmail.com')).code).toBe('FORBIDDEN');
});

test('tipe: anyOf tidak boleh mencampur izin global dan lokasi', () => {
  const sah: RoutePermissionSpec = {
    anyOf: [
      { module: 'handover', level: 'view', scope: 'location' },
      { module: 'qc', level: 'edit', scope: 'location' },
    ],
  };
  const campur: RoutePermissionSpec = {
    // @ts-expect-error alternatif global dan lokasi tidak boleh dicampur
    anyOf: [
      { module: 'access', level: 'view' },
      { module: 'qc', level: 'edit', scope: 'location' },
    ],
  };
  expect([sah, campur]).toHaveLength(2);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test router && bun run --cwd gas typecheck`
Expected: FAIL — tes `anyOf` gagal (router belum memahami `anyOf`), dan typecheck gagal karena `RoutePermissionSpec` belum diekspor.

- [ ] **Step 3: Implementasi** — `gas/src/core/router.ts`

Ganti definisi `RoutePermission` dan `RouteDef.permission`:

```ts
export type GlobalPermission = {
  module: Exclude<ModuleKey, LocatedModule>;
  level: Level;
  scope?: 'global';
};
export type LocationPermission = { module: LocatedModule; level: Level; scope: 'location' };
export type RoutePermission = GlobalPermission | LocationPermission;

/** `anyOf`: cukup satu alternatif terpenuhi; semua alternatif harus sama lingkupnya (global atau lokasi). */
export type RoutePermissionSpec =
  | RoutePermission
  | { anyOf: readonly [GlobalPermission, ...GlobalPermission[]] }
  | { anyOf: readonly [LocationPermission, ...LocationPermission[]] };

export interface RouteDef<M extends RpcMethod = RpcMethod> {
  /** Tanpa `permission` = cukup login. */
  permission?: RoutePermissionSpec;
  validate: (raw: unknown) => RpcInput<M>;
  handler: (input: RpcInput<M>, ctx: RequestContext) => RpcOutput<M>;
}
```

Ganti blok pemeriksaan izin di `handleRpc_` (dari `const permission = route.permission;` sampai penutup `if`) dengan:

```ts
    const alternatives = alternativesOf_(route.permission);
    const globalAlternatives = alternatives.filter((item) => !isLocationPermission_(item));
    const locationAlternatives = alternatives.filter(isLocationPermission_);
    if (
      globalAlternatives.length > 0 &&
      !globalAlternatives.some((item) => hasLevel(user.permissions[item.module], item.level))
    ) {
      throw appError_('FORBIDDEN', 'Anda tidak memiliki akses untuk aksi ini');
    }
```

dan ganti penghitungan `locationIds`:

```ts
    const input = route.validate(raw);
    const locationIds =
      locationAlternatives.length > 0
        ? authorizedLocationIds_(input, user, locationAlternatives)
        : [];
    const data = route.handler(input, { requestId, user, locationIds });
```

Tambahkan fungsi pembantu (di atas `requestedLocationIds_`):

```ts
function alternativesOf_(spec: RoutePermissionSpec | undefined): readonly RoutePermission[] {
  if (!spec) return [];
  return 'anyOf' in spec ? spec.anyOf : [spec];
}

function isLocationPermission_(permission: RoutePermission): permission is LocationPermission {
  return permission.scope === 'location';
}
```

Ganti `authorizedLocationIds_`:

```ts
/** Tiap lokasi yang diminta harus aktif dan memenuhi minimal satu alternatif; satu gagal menolak seluruh permintaan. */
function authorizedLocationIds_(
  input: unknown,
  user: UserContext,
  alternatives: readonly LocationPermission[],
): string[] {
  const ids = requestedLocationIds_(input);
  for (const id of ids) {
    const access = user.locations[id];
    if (!access || !alternatives.some((item) => hasLevel(access[item.module], item.level))) {
      throw appError_('FORBIDDEN', 'Anda tidak memiliki akses ke lokasi ini');
    }
  }
  return ids;
}
```

- [ ] **Step 4: Jalankan semua tes gas dan typecheck**

Run: `bun run --cwd gas test && bun run --cwd gas typecheck && bun scripts/build-gas.ts`
Expected: semua lulus, typecheck bersih, build GAS lolos aturan nama global. Bila `tsc` melaporkan `Unused '@ts-expect-error' directive` atau galat tipe di baris lain pada tes tipe `anyOf`, pindahkan direktif ke baris yang ditandai `tsc` (galatnya berada di dalam literal `anyOf`, bergantung versi TypeScript); tujuan tes tetap: pencampuran global dan lokasi harus ditolak compiler.

- [ ] **Step 5: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas
git add gas
git commit -m "feat(gas): izin rute anyOf (salah satu dari) untuk rute global dan berlokasi" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Platform — `setProperty` dan operasi Drive (GAS asli, memory, scope manifest)

**Files:**
- Modify: `gas/src/core/platform.ts`, `gas/src/core/gas-platform.ts`, `gas/test-support/memory-platform.ts`, `gas/appsscript.json`, `scripts/verify-dist.ts`
- Test: `gas/test-support/memory-platform.test.ts` (baru)

**Interfaces:**
- Consumes: —
- Produces (`Platform`):
  - `setProperty(key: string, value: string): void`
  - `driveCreateFolder(name: string): string` — folder baru di akar Drive, mengembalikan id.
  - `driveCreateFile(folderId: string, name: string, mime: string, base64: string): string` — mengembalikan id berkas Drive.
  - `driveReadFile(fileId: string): { mime: string; base64: string } | null`
  - `MemoryPlatform.folders: Map<string, string>` (id → nama) dan `MemoryPlatform.drive: Map<string, MemoryDriveFile>`.

- [ ] **Step 1: Tulis tes yang gagal** — `gas/test-support/memory-platform.test.ts`

```ts
import { expect, test } from 'bun:test';
import { createMemoryPlatform } from './memory-platform';

test('setProperty menyimpan dan getProperty membacanya', () => {
  const platform = createMemoryPlatform();
  expect(platform.getProperty('X')).toBeNull();
  platform.setProperty('X', 'nilai');
  expect(platform.getProperty('X')).toBe('nilai');
});

test('Drive palsu: buat folder, simpan berkas, baca kembali', () => {
  const platform = createMemoryPlatform();
  const folder = platform.driveCreateFolder('QC App Files');
  expect(platform.folders.get(folder)).toBe('QC App Files');
  const file = platform.driveCreateFile(folder, 'a.png', 'image/png', 'QUJD');
  expect(platform.driveReadFile(file)).toEqual({ mime: 'image/png', base64: 'QUJD' });
  expect(platform.driveReadFile('tidak-ada')).toBeNull();
});

test('Drive palsu menolak folder yang tidak ada', () => {
  const platform = createMemoryPlatform();
  expect(() => platform.driveCreateFile('hilang', 'a.png', 'image/png', 'QUJD')).toThrow();
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test memory-platform`
Expected: FAIL — `setProperty`/`driveCreateFolder` belum ada.

- [ ] **Step 3: Antarmuka `Platform`** — `gas/src/core/platform.ts`

Tambahkan di dalam `interface Platform` (setelah `getProperty`):

```ts
  /** Menyimpan Script Property (dipakai `setup` untuk id folder Drive). */
  setProperty(key: string, value: string): void;
```

dan setelah `spreadsheet()`:

```ts
  /** Membuat folder Drive (privat) di akar Drive pemilik script; mengembalikan id folder. */
  driveCreateFolder(name: string): string;
  /** Menyimpan berkas (isi base64) ke folder; mengembalikan id berkas Drive. */
  driveCreateFile(folderId: string, name: string, mime: string, base64: string): string;
  /** Membaca berkas Drive sebagai base64; `null` bila tidak ditemukan atau tidak terbaca. */
  driveReadFile(fileId: string): { mime: string; base64: string } | null;
```

- [ ] **Step 4: Memory platform** — `gas/test-support/memory-platform.ts`

Tambahkan di atas `MemoryPlatformOptions`:

```ts
export interface MemoryDriveFile {
  folderId: string;
  name: string;
  mime: string;
  base64: string;
}
```

Pada `interface MemoryPlatform` tambahkan `readonly folders: Map<string, string>;` dan `readonly drive: Map<string, MemoryDriveFile>;`. Di `createMemoryPlatform`, setelah `const httpCalls…`:

```ts
  const folders = new Map<string, string>();
  const drive = new Map<string, MemoryDriveFile>();
```

lalu di objek yang dikembalikan tambahkan `folders,` `drive,` di samping `db, properties, …`, dan:

```ts
    setProperty: (key, value) => {
      properties.set(key, value);
    },
    driveCreateFolder: (name) => {
      const id = `folder-${folders.size + 1}`;
      folders.set(id, name);
      return id;
    },
    driveCreateFile: (folderId, name, mime, base64) => {
      if (!folders.has(folderId)) throw new Error(`Folder Drive ${folderId} tidak ada`);
      const id = `file-${drive.size + 1}`;
      drive.set(id, { folderId, name, mime, base64 });
      return id;
    },
    driveReadFile: (fileId) => {
      const file = drive.get(fileId);
      return file ? { mime: file.mime, base64: file.base64 } : null;
    },
```

- [ ] **Step 5: Platform GAS asli** — `gas/src/core/gas-platform.ts`

Di objek yang dikembalikan `createGasPlatform_`, tambahkan setelah `getProperty`:

```ts
    setProperty: (key, value) => {
      properties.setProperty(key, value);
    },
```

dan setelah `spreadsheet: …`:

```ts
    driveCreateFolder: (name) => DriveApp.createFolder(name).getId(),
    driveCreateFile: (folderId, name, mime, base64) => {
      const blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, name);
      return DriveApp.getFolderById(folderId).createFile(blob).getId();
    },
    driveReadFile: (fileId) => {
      try {
        const blob = DriveApp.getFileById(fileId).getBlob();
        return { mime: blob.getContentType() ?? '', base64: Utilities.base64Encode(blob.getBytes()) };
      } catch {
        return null;
      }
    },
```

- [ ] **Step 6: Scope Drive di manifest** — `gas/appsscript.json`

Tambahkan satu baris scope (urutan alfabet tidak penting):

```json
    "https://www.googleapis.com/auth/drive",
```

sehingga `oauthScopes` memuat `spreadsheets`, `drive`, `script.external_request`, `userinfo.email`.

- [ ] **Step 7: `verify-dist` memeriksa scope dan ukuran** — `scripts/verify-dist.ts`

Tambahkan sebelum blok `if (problems.length > 0)`:

```ts
const MAX_INDEX_BYTES = 1_500_000;
const indexFile = Bun.file(path.join(GAS_DIST_DIR, 'index.html'));
if (await indexFile.exists()) {
  if (indexFile.size > MAX_INDEX_BYTES) {
    problems.push(`index.html ${indexFile.size} byte melebihi batas ${MAX_INDEX_BYTES}`);
  }
}

const manifestFile = Bun.file(path.join(GAS_DIST_DIR, 'appsscript.json'));
if (await manifestFile.exists()) {
  const manifest = JSON.parse(await manifestFile.text()) as { oauthScopes?: string[] };
  if (!manifest.oauthScopes?.includes('https://www.googleapis.com/auth/drive')) {
    problems.push('appsscript.json tidak memuat scope Drive (https://www.googleapis.com/auth/drive)');
  }
}
```

- [ ] **Step 8: Jalankan semua tes, typecheck, dan build**

Run: `bun run --cwd gas test && bun run --cwd gas typecheck && bun run build`
Expected: tes lulus; typecheck bersih; `verify-dist OK` (build menyalin manifest ke `gas/dist`).

- [ ] **Step 9: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas scripts
git add gas scripts
git commit -m "feat(platform): setProperty dan operasi Drive; scope Drive dicek verify-dist" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Modul `files` — konstanta bersama, sheet, upload, baca, dan `attachFiles_`

**Files:**
- Create: `shared/files.ts`, `shared/files.test.ts`, `gas/src/modules/files/repo.ts`, `gas/src/modules/files/validate.ts`, `gas/src/modules/files/service.ts`, `gas/src/modules/files/routes.ts`, `gas/src/modules/files/files.test.ts`
- Modify: `shared/rpc.ts`, `gas/src/routes.ts`, `gas/src/routes.test.ts`

**Interfaces:**
- Consumes (Task 3): `Platform.driveCreateFolder/driveCreateFile/driveReadFile/setProperty/getProperty`; `nowIso_` dari `gas/src/modules/access/service.ts`; `UserContext`.
- Produces:
  - `shared/files.ts`: `IMAGE_MIME_TYPES`, `ImageMime`, `isImageMime`, `MAX_IMAGE_SIDE = 1600`, `MAX_IMAGE_BYTES = 1_048_576`, `MAX_IMAGE_DIMENSION = 4000`, `MARKDOWN_MAX_LENGTH = 20_000`, `FILE_SCHEME = 'qcfile:'`, `type FileOwnerType = 'item'`, `isBase64Text(text)`, `base64ByteLength(base64)`, `matchesImageSignature(mime, base64)`, `fileRef(id)`, `parseFileRef(url)`.
  - `shared/rpc.ts`: `FileDto {id, mime, size, width, height}`, `UploadFileInput {mime, base64, width, height}`, `GetFileInput {id}`, `FileContentDto {id, mime, base64}`; kontrak `'files.upload'`, `'files.get'`.
  - `service.ts`: `DRIVE_FOLDER_NAME`, `ensureDriveFolder_(): string`, `uploadFile_(input, actor): FileDto`, `readFile_(input): FileContentDto`, `attachFiles_(ids, ownerType, ownerId): void` (pemanggil memegang lock).
  - Izin rute: `files.upload` = `item: edit`, `files.get` = `item: view` (global). Catatan: PRD FA3 menyebut izin "pada entitas pemilik"; di Fase A belum ada entitas, jadi `item: view` berlaku untuk semua gambar. Fase C dapat melonggarkan baca untuk `handover`/`qc` bila perlu (task menampilkan detail item, yang butuh `item: view` lebih dulu).

- [ ] **Step 1: Tulis tes fungsi murni yang gagal** — `shared/files.test.ts`

```ts
import { describe, expect, test } from 'bun:test';
import {
  base64ByteLength,
  fileRef,
  isBase64Text,
  isImageMime,
  matchesImageSignature,
  parseFileRef,
} from './files';

describe('isImageMime', () => {
  test('hanya JPEG, PNG, dan WebP', () => {
    expect(isImageMime('image/jpeg')).toBe(true);
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('image/webp')).toBe(true);
    for (const value of ['image/gif', 'image/svg+xml', 'text/html', '', 42, null]) {
      expect(isImageMime(value)).toBe(false);
    }
  });
});

describe('isBase64Text', () => {
  test('menerima base64 baku dan menolak yang rusak', () => {
    expect(isBase64Text('QUJD')).toBe(true);
    expect(isBase64Text('QUI=')).toBe(true);
    expect(isBase64Text('QQ==')).toBe(true);
    for (const value of ['', 'QUJ', 'QU JD', 'QUJD\n', 'QUJD!', 'Q===', 'data:image/png;base64,QUJD']) {
      expect(isBase64Text(value)).toBe(false);
    }
  });
});

describe('base64ByteLength', () => {
  test('menghitung ukuran byte hasil decode', () => {
    expect(base64ByteLength('QUJD')).toBe(3);
    expect(base64ByteLength('QUI=')).toBe(2);
    expect(base64ByteLength('QQ==')).toBe(1);
    expect(base64ByteLength('QUJDREVG')).toBe(6);
  });
});

describe('matchesImageSignature', () => {
  test('awalan base64 harus cocok dengan MIME yang diklaim', () => {
    expect(matchesImageSignature('image/png', 'iVBORw0KGgoAAAANSUhEUg==')).toBe(true);
    expect(matchesImageSignature('image/jpeg', '/9j/4AAQSkZJRg==')).toBe(true);
    expect(matchesImageSignature('image/webp', 'UklGRhwAAABXRUJQ')).toBe(true);
    expect(matchesImageSignature('image/png', '/9j/4AAQSkZJRg==')).toBe(false);
    expect(matchesImageSignature('image/jpeg', 'PHNjcmlwdD4=')).toBe(false);
  });
});

describe('referensi berkas', () => {
  test('fileRef dan parseFileRef saling berbalik; yang lain ditolak', () => {
    expect(fileRef('abc-123')).toBe('qcfile:abc-123');
    expect(parseFileRef('qcfile:abc-123')).toBe('abc-123');
    for (const value of ['qcfile:', 'https://x.test/a.png', 'QCFILE:abc', 'qcfile:a b', 'qcfile:a/b', '']) {
      expect(parseFileRef(value)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd shared test files`
Expected: FAIL — `./files` belum ada.

- [ ] **Step 3: Implementasi** — `shared/files.ts`

```ts
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIME_TYPES)[number];

/** Sisi terpanjang gambar setelah dikecilkan klien. */
export const MAX_IMAGE_SIDE = 1600;
/** Ukuran maksimum berkas hasil kompresi (byte). */
export const MAX_IMAGE_BYTES = 1_048_576;
/** Batas wajar lebar/tinggi yang diterima server. */
export const MAX_IMAGE_DIMENSION = 4000;
export const MARKDOWN_MAX_LENGTH = 20_000;

/** Skema rujukan gambar di dalam Markdown: `![alt](qcfile:<id>)`. */
export const FILE_SCHEME = 'qcfile:';

/** Jenis entitas pemilik berkas. */
export type FileOwnerType = 'item';

export function isImageMime(value: unknown): value is ImageMime {
  return typeof value === 'string' && (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function isBase64Text(text: string): boolean {
  return text.length > 0 && text.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(text);
}

export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

const SIGNATURE_PREFIX: Record<ImageMime, string> = {
  'image/jpeg': '/9j/',
  'image/png': 'iVBORw0KGgo',
  'image/webp': 'UklGR',
};

/** Tanda tangan berkas (magic bytes dalam base64) harus cocok dengan MIME yang diklaim. */
export function matchesImageSignature(mime: ImageMime, base64: string): boolean {
  return base64.startsWith(SIGNATURE_PREFIX[mime]);
}

export function fileRef(id: string): string {
  return `${FILE_SCHEME}${id}`;
}

/** Id berkas dari `qcfile:<id>`; `null` bila bukan rujukan berkas yang sah. */
export function parseFileRef(url: string): string | null {
  if (!url.startsWith(FILE_SCHEME)) return null;
  const id = url.slice(FILE_SCHEME.length);
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `bun run --cwd shared test`
Expected: semua lulus.

- [ ] **Step 5: Tipe RPC** — `shared/rpc.ts`

Tambahkan sebelum `export interface RpcContract {`:

```ts
export interface FileDto {
  id: string;
  mime: string;
  size: number;
  width: number;
  height: number;
}

export interface UploadFileInput {
  mime: string;
  /** Isi gambar dalam base64 baku (tanpa awalan `data:`). */
  base64: string;
  width: number;
  height: number;
}

export interface GetFileInput {
  id: string;
}

export interface FileContentDto {
  id: string;
  mime: string;
  base64: string;
}
```

dan di dalam `RpcContract`:

```ts
  'files.upload': { input: UploadFileInput; output: FileDto };
  'files.get': { input: GetFileInput; output: FileContentDto };
```

- [ ] **Step 6: Tulis tes backend yang gagal** — `gas/src/modules/files/files.test.ts`

```ts
import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { handleRpc_ } from '@gas/core/router';
import { signSessionToken_ } from '@gas/core/session';
import type { UserContext } from '@gas/modules/access/context';
import { loadUserContext_ } from '@gas/modules/access/context';
import { insertRole_, insertUser_ } from '@gas/modules/access/repo';
import { getRoutes_ } from '@gas/routes';
import { role, user } from '@gas-test/access-fixtures';
import { captureAppError } from '@gas-test/errors';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { MAX_IMAGE_BYTES } from '@shared/files';
import { listFiles_ } from './repo';
import { attachFiles_, DRIVE_FOLDER_NAME, ensureDriveFolder_, readFile_, uploadFile_ } from './service';
import { validateGetFile_, validateUploadFile_ } from './validate';

const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
const JPEG = '/9j/4AAQSkZJRg==';

let platform: MemoryPlatform;
let admin: UserContext;

const upload = (overrides: Record<string, unknown> = {}) => ({
  mime: 'image/png',
  base64: PNG,
  width: 1,
  height: 1,
  ...overrides,
});

beforeEach(() => {
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
    now: () => Date.parse('2026-10-09T00:00:00.000Z'),
  });
  setPlatform_(platform);
  const ctx = loadUserContext_('admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
});

test('upload menyimpan ke Drive dan mencatat metadata tanpa pemilik', () => {
  const saved = uploadFile_(validateUploadFile_(upload()), admin);
  expect(saved).toMatchObject({ mime: 'image/png', width: 1, height: 1 });
  expect(saved.size).toBe(Buffer.from(PNG, 'base64').length);
  expect(listFiles_()).toHaveLength(1);
  expect(listFiles_()[0]).toMatchObject({
    id: saved.id,
    ownerType: '',
    ownerId: '',
    createdBy: 'admin@gmail.com',
    createdAt: '2026-10-09T00:00:00.000Z',
  });
  expect(platform.drive.size).toBe(1);
});

test('folder Drive dibuat sekali dan dipakai ulang (setup diulang, upload berturut-turut)', () => {
  const first = ensureDriveFolder_();
  const second = ensureDriveFolder_();
  uploadFile_(validateUploadFile_(upload()), admin);
  uploadFile_(validateUploadFile_(upload({ mime: 'image/jpeg', base64: JPEG })), admin);
  expect(second).toBe(first);
  expect(platform.folders.size).toBe(1);
  expect(platform.folders.get(first)).toBe(DRIVE_FOLDER_NAME);
  expect(platform.getProperty('DRIVE_FOLDER_ID')).toBe(first);
});

test('upload pertama tanpa setup membuat folder sendiri', () => {
  expect(platform.getProperty('DRIVE_FOLDER_ID')).toBeNull();
  uploadFile_(validateUploadFile_(upload()), admin);
  expect(platform.getProperty('DRIVE_FOLDER_ID')).not.toBeNull();
});

test('readFile_ mengembalikan isi dari catatan sheet, dan id tak dikenal NOT_FOUND', () => {
  const saved = uploadFile_(validateUploadFile_(upload()), admin);
  expect(readFile_({ id: saved.id })).toEqual({ id: saved.id, mime: 'image/png', base64: PNG });
  expect(captureAppError(() => readFile_({ id: 'tidak-ada' })).code).toBe('NOT_FOUND');
});

test('readFile_ tidak pernah membaca Drive id yang tidak tercatat di sheet files', () => {
  const folder = ensureDriveFolder_();
  const stray = platform.driveCreateFile(folder, 'rahasia.png', 'image/png', PNG);
  expect(captureAppError(() => readFile_({ id: stray })).code).toBe('NOT_FOUND');
});

test('readFile_ NOT_FOUND bila berkas Drive hilang', () => {
  const saved = uploadFile_(validateUploadFile_(upload()), admin);
  platform.drive.clear();
  expect(captureAppError(() => readFile_({ id: saved.id })).code).toBe('NOT_FOUND');
});

test('validasi upload menolak MIME, base64, tanda tangan, ukuran, dan dimensi yang salah', () => {
  const fieldsOf = (input: unknown) => captureAppError(() => validateUploadFile_(input)).fields;
  expect(fieldsOf(upload({ mime: 'image/gif' }))?.mime).toBe('Hanya JPEG, PNG, atau WebP');
  expect(fieldsOf(upload({ mime: 'text/html' }))?.mime).toBeDefined();
  expect(fieldsOf(upload({ base64: 'bukan base64!' }))?.base64).toBe('Isi gambar tidak valid');
  expect(fieldsOf(upload({ base64: `data:image/png;base64,${PNG}` }))?.base64).toBe('Isi gambar tidak valid');
  expect(fieldsOf(upload({ mime: 'image/jpeg' }))?.base64).toBe('Isi berkas tidak sesuai jenis gambar');
  const huge = `iVBORw0KGgo${'A'.repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8)}`;
  expect(fieldsOf(upload({ base64: huge.slice(0, huge.length - (huge.length % 4)) }))?.base64).toBe(
    'Ukuran gambar maksimal 1 MB',
  );
  for (const bad of [0, -1, 4001, 1.5, '1', null]) {
    expect(fieldsOf(upload({ width: bad }))?.width).toBeDefined();
    expect(fieldsOf(upload({ height: bad }))?.height).toBeDefined();
  }
  expect(fieldsOf('teks')?._).toBe('Input harus berupa objek');
  expect(listFiles_()).toHaveLength(0);
  expect(platform.drive.size).toBe(0);
});

test('validateGetFile_ mewajibkan id', () => {
  expect(validateGetFile_({ id: 'f1' })).toEqual({ id: 'f1' });
  expect(captureAppError(() => validateGetFile_({ id: '' })).fields).toEqual({ id: 'Wajib diisi' });
});

test('attachFiles_ menetapkan pemilik sekali; pemilik lain CONFLICT; id tak dikenal VALIDATION', () => {
  const a = uploadFile_(validateUploadFile_(upload()), admin);
  const b = uploadFile_(validateUploadFile_(upload()), admin);
  attachFiles_([a.id, b.id], 'item', 'item-1');
  expect(listFiles_().map((f) => [f.ownerType, f.ownerId])).toEqual([
    ['item', 'item-1'],
    ['item', 'item-1'],
  ]);
  attachFiles_([a.id], 'item', 'item-1'); // pemilik sama: aman diulang
  expect(captureAppError(() => attachFiles_([a.id], 'item', 'item-2')).code).toBe('CONFLICT');
  expect(captureAppError(() => attachFiles_(['hilang'], 'item', 'item-1')).code).toBe('VALIDATION');
  attachFiles_([], 'item', 'item-1');
});

test('rute: upload butuh item edit, baca butuh item view, dan lintas peran ditolak', () => {
  insertRole_(role({ id: 'r-view', name: 'Lihat', permissions: { item: 'view' } }));
  insertRole_(role({ id: 'r-edit', name: 'Ubah', permissions: { item: 'edit' } }));
  insertUser_(user({ id: 'u-v', email: 'lihat@gmail.com', roleIds: ['r-view'] }));
  insertUser_(user({ id: 'u-e', email: 'ubah@gmail.com', roleIds: ['r-edit'] }));
  insertUser_(user({ id: 'u-n', email: 'tanpa@gmail.com' }));
  const call = (method: string, payload: unknown, email: string) =>
    handleRpc_(method, JSON.stringify(payload), signSessionToken_(email), getRoutes_());

  const saved = call('files.upload', upload(), 'ubah@gmail.com');
  expect(saved.ok).toBe(true);
  const id = saved.ok ? (saved.data as { id: string }).id : '';
  expect(call('files.upload', upload(), 'lihat@gmail.com')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  expect(call('files.upload', upload(), 'tanpa@gmail.com')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  expect(call('files.get', { id }, 'lihat@gmail.com')).toMatchObject({ ok: true, data: { mime: 'image/png', base64: PNG } });
  expect(call('files.get', { id }, 'tanpa@gmail.com')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
});
```

Perbarui `gas/src/routes.test.ts`: tambahkan `'files.get'` dan `'files.upload'` ke daftar kunci terurut (sesudah `'auth.me'` urut abjad: `'access.…'`, `'auth.me'`, `'files.get'`, `'files.upload'`); tambahkan `'files.get'` ke loop level… karena rute ini berizin `item`, tambahkan asersi terpisah:

```ts
  expect(routes['files.get'].permission).toEqual({ module: 'item', level: 'view' });
  expect(routes['files.upload'].permission).toEqual({ module: 'item', level: 'edit' });
```

- [ ] **Step 7: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test files routes`
Expected: FAIL — modul `./repo`/`./service` belum ada.

- [ ] **Step 8: Repo** — `gas/src/modules/files/repo.ts`

```ts
import type { RowData, TableSchema } from '@gas/core/db';
import { insertRow_, readTable_, updateRow_ } from '@gas/core/db';

export const FILES_TABLE: TableSchema = {
  sheetName: 'files',
  columns: [
    'id',
    'drive_id',
    'mime',
    'size',
    'width',
    'height',
    'owner_type',
    'owner_id',
    'created_at',
    'created_by',
  ],
};

export interface FileRecord {
  rowNumber: number;
  id: string;
  driveId: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  ownerType: string;
  ownerId: string;
  createdAt: string;
  createdBy: string;
}
export type NewFileRecord = Omit<FileRecord, 'rowNumber'>;

function toFileRecord_(rowNumber: number, data: RowData): FileRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    driveId: (data.drive_id ?? '').trim(),
    mime: (data.mime ?? '').trim(),
    size: Number(data.size) || 0,
    width: Number(data.width) || 0,
    height: Number(data.height) || 0,
    ownerType: (data.owner_type ?? '').trim(),
    ownerId: (data.owner_id ?? '').trim(),
    createdAt: data.created_at ?? '',
    createdBy: data.created_by ?? '',
  };
}

function fromFileRecord_(file: NewFileRecord): RowData {
  return {
    id: file.id,
    drive_id: file.driveId,
    mime: file.mime,
    size: String(file.size),
    width: String(file.width),
    height: String(file.height),
    owner_type: file.ownerType,
    owner_id: file.ownerId,
    created_at: file.createdAt,
    created_by: file.createdBy,
  };
}

export function listFiles_(): FileRecord[] {
  return readTable_(FILES_TABLE)
    .rows.map(({ rowNumber, data }) => toFileRecord_(rowNumber, data))
    .filter((file) => file.id !== '' && file.driveId !== '');
}

export function insertFile_(file: NewFileRecord): void {
  insertRow_(FILES_TABLE, fromFileRecord_(file));
}

export function updateFile_(file: FileRecord): void {
  updateRow_(FILES_TABLE, file.rowNumber, fromFileRecord_(file));
}
```

- [ ] **Step 9: Validator** — `gas/src/modules/files/validate.ts`

```ts
import { readObject_ } from '@gas/core/validate';
import {
  base64ByteLength,
  isBase64Text,
  isImageMime,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  matchesImageSignature,
} from '@shared/files';
import type { GetFileInput, UploadFileInput } from '@shared/rpc';

function isDimension_(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_IMAGE_DIMENSION
  );
}

export function validateUploadFile_(raw: unknown): UploadFileInput {
  const reader = readObject_(raw);
  const mime = reader.raw('mime');
  const base64 = reader.raw('base64');
  const width = reader.raw('width');
  const height = reader.raw('height');
  if (!isImageMime(mime)) reader.fail('mime', 'Hanya JPEG, PNG, atau WebP');
  if (typeof base64 !== 'string' || !isBase64Text(base64)) {
    reader.fail('base64', 'Isi gambar tidak valid');
  } else if (base64ByteLength(base64) > MAX_IMAGE_BYTES) {
    reader.fail('base64', 'Ukuran gambar maksimal 1 MB');
  } else if (isImageMime(mime) && !matchesImageSignature(mime, base64)) {
    reader.fail('base64', 'Isi berkas tidak sesuai jenis gambar');
  }
  if (!isDimension_(width)) reader.fail('width', 'Lebar tidak valid');
  if (!isDimension_(height)) reader.fail('height', 'Tinggi tidak valid');
  reader.done();
  return {
    mime: mime as string,
    base64: base64 as string,
    width: width as number,
    height: height as number,
  };
}

export function validateGetFile_(raw: unknown): GetFileInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}
```

- [ ] **Step 10: Layanan** — `gas/src/modules/files/service.ts`

```ts
import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import type { UserContext } from '@gas/modules/access/context';
import { nowIso_ } from '@gas/modules/access/service';
import type { FileOwnerType } from '@shared/files';
import { base64ByteLength } from '@shared/files';
import type { FileContentDto, FileDto, GetFileInput, UploadFileInput } from '@shared/rpc';
import type { NewFileRecord } from './repo';
import { insertFile_, listFiles_, updateFile_ } from './repo';

const DRIVE_FOLDER_PROPERTY = 'DRIVE_FOLDER_ID';
export const DRIVE_FOLDER_NAME = 'QC App Files';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Tanpa lock: pemanggil wajib sudah memegang lock (hindari withLock bersarang). */
function driveFolderId_(): string {
  const platform = platform_();
  const existing = platform.getProperty(DRIVE_FOLDER_PROPERTY)?.trim();
  if (existing) return existing;
  const id = platform.driveCreateFolder(DRIVE_FOLDER_NAME);
  platform.setProperty(DRIVE_FOLDER_PROPERTY, id);
  return id;
}

/** Dipakai `setup`; idempoten dan aman terhadap pemanggilan bersamaan. */
export function ensureDriveFolder_(): string {
  return platform_().withLock(() => driveFolderId_());
}

function toFileDto_(file: NewFileRecord): FileDto {
  return { id: file.id, mime: file.mime, size: file.size, width: file.width, height: file.height };
}

export function uploadFile_(input: UploadFileInput, actor: UserContext): FileDto {
  return platform_().withLock(() => {
    const platform = platform_();
    const id = platform.uuid();
    const name = `${id}.${EXTENSIONS[input.mime] ?? 'bin'}`;
    const driveId = platform.driveCreateFile(driveFolderId_(), name, input.mime, input.base64);
    const record: NewFileRecord = {
      id,
      driveId,
      mime: input.mime,
      size: base64ByteLength(input.base64),
      width: input.width,
      height: input.height,
      ownerType: '',
      ownerId: '',
      createdAt: nowIso_(),
      createdBy: actor.email,
    };
    insertFile_(record);
    return toFileDto_(record);
  });
}

/** Hanya berkas yang tercatat di sheet `files` yang dapat dibaca; Drive id tidak pernah datang dari klien. */
export function readFile_(input: GetFileInput): FileContentDto {
  const record = listFiles_().find((file) => file.id === input.id);
  if (!record) throw appError_('NOT_FOUND', 'Berkas tidak ditemukan');
  const content = platform_().driveReadFile(record.driveId);
  if (!content) throw appError_('NOT_FOUND', 'Isi berkas tidak ditemukan di Drive');
  return { id: record.id, mime: record.mime, base64: content.base64 };
}

/**
 * Menetapkan pemilik berkas (dipakai simpan item pada Fase B). Pemanggil wajib memegang lock.
 * Berkas yang sudah dimiliki entitas lain ditolak; pemilik yang sama aman diulang.
 */
export function attachFiles_(
  ids: readonly string[],
  ownerType: FileOwnerType,
  ownerId: string,
): void {
  if (ids.length === 0) return;
  const files = listFiles_();
  for (const id of ids) {
    const file = files.find((item) => item.id === id);
    if (!file) throw appError_('VALIDATION', 'Ada berkas yang tidak dikenal');
    if (file.ownerType === '') {
      updateFile_({ ...file, ownerType, ownerId });
    } else if (file.ownerType !== ownerType || file.ownerId !== ownerId) {
      throw appError_('CONFLICT', 'Berkas sudah dipakai di tempat lain');
    }
  }
}
```

- [ ] **Step 11: Rute** — `gas/src/modules/files/routes.ts`

```ts
import type { RouteTable } from '@gas/core/router';
import { readFile_, uploadFile_ } from './service';
import { validateGetFile_, validateUploadFile_ } from './validate';

export function filesRoutes_(): Pick<RouteTable, 'files.upload' | 'files.get'> {
  return {
    'files.upload': {
      permission: { module: 'item', level: 'edit' },
      validate: validateUploadFile_,
      handler: (input, ctx) => uploadFile_(input, ctx.user),
    },
    'files.get': {
      permission: { module: 'item', level: 'view' },
      validate: validateGetFile_,
      handler: (input) => readFile_(input),
    },
  };
}
```

`gas/src/routes.ts`:

```ts
import type { RouteTable } from '@gas/core/router';
import { accessRoutes_ } from '@gas/modules/access/routes';
import { authRoutes_ } from '@gas/modules/auth/routes';
import { filesRoutes_ } from '@gas/modules/files/routes';

/** Dibangun lazy di dalam fungsi karena urutan load file GAS tidak dijamin. */
export function getRoutes_(): RouteTable {
  return { ...authRoutes_(), ...accessRoutes_(), ...filesRoutes_() };
}
```

- [ ] **Step 12: Jalankan semua tes, typecheck, build GAS**

Run: `bun run --cwd shared test && bun run --cwd gas test && bun run --cwd gas typecheck && bun scripts/build-gas.ts`
Expected: lulus; typecheck bersih; build GAS lolos (tidak ada nama global ganda; `isDimension_`, `driveFolderId_`, `toFileRecord_` unik dan berakhiran `_`).

- [ ] **Step 13: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false shared gas
git add shared gas
git commit -m "feat(files): upload dan baca gambar privat di Drive dengan sheet files" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `setup` membuat sheet `files` dan folder Drive; dokumentasi Google

**Files:**
- Modify: `gas/src/setup.ts`, `gas/src/setup.test.ts`, `docs/setup-google.md`

**Interfaces:**
- Consumes (Task 4): `FILES_TABLE`, `ensureDriveFolder_`, `DRIVE_FOLDER_NAME`.
- Produces: laporan `setup` memuat `Folder Drive "QC App Files" siap (<id>).`

- [ ] **Step 1: Tulis tes yang gagal** — `gas/src/setup.test.ts`

Ubah ekspektasi urutan sheet pada tes "membuat sheet users, roles, audit_log…" menjadi `['users', 'roles', 'audit_log', 'locations', 'files']`, ubah judul tes menjadi "membuat sheet users, roles, audit_log, locations, files beserta header", dan tambahkan tes:

```ts
test('setup membuat folder Drive sekali dan melaporkannya; diulang tidak menggandakan folder', () => {
  const platform = createMemoryPlatform({
    properties: {
      SPREADSHEET_ID: 'x',
      OAUTH_CLIENT_ID: 'a',
      OAUTH_CLIENT_SECRET: 'b',
      OAUTH_REDIRECT_URI: 'c',
      SESSION_SECRET: 'd',
      ADMIN_EMAIL: 'e@gmail.com',
    },
  });
  setPlatform_(platform);
  const first = runSetup_();
  const second = runSetup_();
  expect(first).toContain('Folder Drive "QC App Files" siap');
  expect(platform.folders.size).toBe(1);
  expect(second).toContain(platform.getProperty('DRIVE_FOLDER_ID') ?? 'x');
});
```


- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test setup`
Expected: FAIL.

- [ ] **Step 3: Implementasi** — `gas/src/setup.ts`

Tambahkan impor:

```ts
import { FILES_TABLE } from '@gas/modules/files/repo';
import { DRIVE_FOLDER_NAME, ensureDriveFolder_ } from '@gas/modules/files/service';
```

Ubah daftar tabel menjadi `[USERS_TABLE, ROLES_TABLE, AUDIT_TABLE, LOCATIONS_TABLE, FILES_TABLE]`, dan setelah baris migrasi `users:` (sebelum `return lines.join('\n')` akhir) tambahkan:

```ts
  const folderId = ensureDriveFolder_();
  lines.push(`Folder Drive "${DRIVE_FOLDER_NAME}" siap (${folderId}).`);
```

- [ ] **Step 4: Dokumentasi** — `docs/setup-google.md`

Tambahkan bagian baru setelah "## 7. Script Properties (tahap 2)":

```markdown
## 7b. Izin Drive (mulai Fase A Data Item)
Aplikasi menyimpan gambar item di folder Drive privat bernama **QC App Files** (milik akun pemilik script, tidak dibagikan). Manifest `appsscript.json` kini memuat scope `https://www.googleapis.com/auth/drive`. Setelah `bun run push`, jalankan fungsi `setup` dari editor dengan akun pemilik: Google meminta persetujuan izin Drive **sekali**. `setup` lalu membuat folder dan menyimpan id-nya di Script Property `DRIVE_FOLDER_ID` (jangan diubah manual; menghapusnya membuat folder baru dan gambar lama tidak terbaca).
```

Tambahkan baris di tabel Troubleshooting:

```markdown
| Unggah gambar gagal "Terjadi kesalahan" setelah update | Izin Drive belum disetujui: jalankan `setup` sekali dari editor (bagian 7b). Lihat **Executions** untuk galat `DriveApp`. |
```

- [ ] **Step 5: Jalankan semua tes gas dan build**

Run: `bun run --cwd gas test && bun run --cwd gas typecheck && bun scripts/build-gas.ts`
Expected: lulus dan bersih.

- [ ] **Step 6: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas docs
git add gas docs
git commit -m "feat(setup): sheet files dan folder Drive otomatis; dokumentasi izin Drive" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Frontend file — kecilkan gambar, query ambil/unggah, hook upload

**Files:**
- Create: `web/src/modules/files/image.ts`, `web/src/modules/files/image.test.ts`, `web/src/modules/files/queries.ts`, `web/src/modules/files/queries.test.tsx`, `web/src/modules/files/use-upload-image.ts`

**Interfaces:**
- Consumes (Task 4): `rpc('files.upload' | 'files.get')`, `UploadFileInput`, `FileContentDto`; `MAX_IMAGE_SIDE`, `MAX_IMAGE_BYTES`, `isImageMime`, `base64ByteLength`, `ImageMime` dari `@shared/files`.
- Produces:
  - `image.ts`: `fitWithin(width, height, max?)`, `isAcceptedImage(file)`, `prepareImage(file): Promise<UploadFileInput>`.
  - `queries.ts`: `fileQueryOptions(id)`, `useFileUrl(id): { url: string | null; isLoading: boolean; isError: boolean }`, `useUploadFile()`.
  - `use-upload-image.ts`: `useUploadImage(): (file: File) => Promise<string>` (mengembalikan id berkas).

- [ ] **Step 1: Tulis tes yang gagal** — `web/src/modules/files/image.test.ts`

```ts
import { expect, test } from 'vitest';
import { fitWithin, isAcceptedImage } from './image';

test('fitWithin mempertahankan rasio dan tidak pernah membesarkan gambar', () => {
  expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  expect(fitWithin(3200, 1600)).toEqual({ width: 1600, height: 800 });
  expect(fitWithin(1600, 4800)).toEqual({ width: 533, height: 1600 });
  expect(fitWithin(5000, 1)).toEqual({ width: 1600, height: 1 });
  expect(fitWithin(1601, 1601)).toEqual({ width: 1600, height: 1600 });
  expect(fitWithin(3000, 2000, 1000)).toEqual({ width: 1000, height: 667 });
});

test('isAcceptedImage hanya menerima JPEG, PNG, dan WebP', () => {
  expect(isAcceptedImage({ type: 'image/png' })).toBe(true);
  expect(isAcceptedImage({ type: 'image/jpeg' })).toBe(true);
  expect(isAcceptedImage({ type: 'image/webp' })).toBe(true);
  expect(isAcceptedImage({ type: 'image/gif' })).toBe(false);
  expect(isAcceptedImage({ type: 'application/pdf' })).toBe(false);
  expect(isAcceptedImage({ type: '' })).toBe(false);
});
```

`web/src/modules/files/queries.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rpc', () => ({ rpc: rpcMock }));

import { useFileUrl } from './queries';

/** Satu QueryClient per tes (bukan per render) agar hasil cache tidak direset. */
function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => rpcMock.mockReset());

test('useFileUrl memuat gambar lewat RPC dan membentuk data URL', async () => {
  rpcMock.mockResolvedValue({ id: 'f1', mime: 'image/png', base64: 'QUJD' });
  const { result } = renderHook(() => useFileUrl('f1'), { wrapper: makeWrapper() });
  expect(result.current.isLoading).toBe(true);
  await waitFor(() => expect(result.current.url).toBe('data:image/png;base64,QUJD'));
  expect(rpcMock).toHaveBeenCalledWith('files.get', { id: 'f1' });
});

test('useFileUrl menandai galat tanpa URL', async () => {
  rpcMock.mockRejectedValue(new Error('gagal'));
  const { result } = renderHook(() => useFileUrl('f2'), { wrapper: makeWrapper() });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.url).toBeNull();
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd web test files`
Expected: FAIL — `./image` dan `./queries` belum ada.

- [ ] **Step 3: Implementasi** — `web/src/modules/files/image.ts`

```ts
import type { ImageMime } from '@shared/files';
import { base64ByteLength, isImageMime, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE } from '@shared/files';
import type { UploadFileInput } from '@shared/rpc';

/** Skala turun agar sisi terpanjang <= `max`; tidak pernah membesarkan; sisi minimal 1 px. */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_IMAGE_SIDE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest <= max ? 1 : max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function isAcceptedImage(file: { type: string }): boolean {
  return isImageMime(file.type);
}

const QUALITIES = [0.85, 0.7, 0.5];

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Gagal membaca gambar'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}

/**
 * Kecilkan (maks. `MAX_IMAGE_SIDE`) dan kompres gambar di klien sebelum diunggah. Dicoba WebP dahulu
 * (JPEG bila peramban tidak mendukung), kualitas diturunkan bertahap sampai <= `MAX_IMAGE_BYTES`.
 * Bergantung pada canvas peramban, jadi diverifikasi manual di peramban (bukan di jsdom).
 */
export async function prepareImage(file: File): Promise<UploadFileInput> {
  if (!isAcceptedImage(file)) throw new Error('Format gambar harus JPEG, PNG, atau WebP');
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Peramban tidak mendukung pengolahan gambar');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  for (const quality of QUALITIES) {
    const webp = await canvasToBlob(canvas, 'image/webp', quality);
    const blob = webp && webp.type === 'image/webp' ? webp : await canvasToBlob(canvas, 'image/jpeg', quality);
    if (!blob || !isImageMime(blob.type)) continue;
    const base64 = await blobToBase64(blob);
    if (base64ByteLength(base64) <= MAX_IMAGE_BYTES) {
      return { mime: blob.type as ImageMime, base64, width, height };
    }
  }
  throw new Error('Gambar masih terlalu besar setelah dikompres (maks. 1 MB)');
}
```

- [ ] **Step 4: Implementasi** — `web/src/modules/files/queries.ts`

```ts
import type { UploadFileInput } from '@shared/rpc';
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/rpc';

export const fileKeys = {
  one: (id: string) => ['files', id] as const,
};

/** Isi berkas tidak pernah berubah untuk id yang sama, jadi di-cache lama. */
export function fileQueryOptions(id: string) {
  return queryOptions({
    queryKey: fileKeys.one(id),
    queryFn: () => rpc('files.get', { id }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60 * 1000,
  });
}

export function useFileUrl(id: string): { url: string | null; isLoading: boolean; isError: boolean } {
  const query = useQuery(fileQueryOptions(id));
  return {
    url: query.data ? `data:${query.data.mime};base64,${query.data.base64}` : null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

export const useUploadFile = () =>
  useMutation({ mutationFn: (input: UploadFileInput) => rpc('files.upload', input) });
```

`web/src/modules/files/use-upload-image.ts`:

```ts
import { prepareImage } from './image';
import { useUploadFile } from './queries';

/** Mengembalikan fungsi yang mengecilkan, mengunggah, lalu memberi id berkas. */
export function useUploadImage(): (file: File) => Promise<string> {
  const upload = useUploadFile();
  return async (file) => {
    const prepared = await prepareImage(file);
    const saved = await upload.mutateAsync(prepared);
    return saved.id;
  };
}
```

- [ ] **Step 5: Jalankan, pastikan lulus**

Run: `bun run --cwd web test files && bun run --cwd web typecheck`
Expected: lulus, typecheck bersih.

- [ ] **Step 6: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false web
git add web
git commit -m "feat(web): kecilkan, unggah, dan tampilkan gambar lewat RPC" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Render Markdown yang aman

**Files:**
- Create: `web/src/modules/markdown/markdown-view.tsx`, `web/src/modules/markdown/markdown-view.test.tsx`
- Modify: `web/package.json`, `bun.lock` (dependensi)

**Interfaces:**
- Consumes (Task 6): `useFileUrl(id)`; (Task 4): `parseFileRef`.
- Produces: `MarkdownView({ source: string; className?: string })`.

- [ ] **Step 1: Pasang dependensi**

Run: `bun add --cwd web react-markdown remark-gfm`
Expected: terpasang; `web/package.json` memuat kedua paket.

- [ ] **Step 2: Tulis tes yang gagal** — `web/src/modules/markdown/markdown-view.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: (id: string) =>
    id === 'ok'
      ? { url: 'data:image/png;base64,AAA', isLoading: false, isError: false }
      : id === 'muat'
        ? { url: null, isLoading: true, isError: false }
        : { url: null, isLoading: false, isError: true },
}));

import { MarkdownView } from './markdown-view';

test('merender Markdown umum dan tabel GFM', () => {
  render(
    <MarkdownView
      source={'# Judul\n\n**tebal** dan _miring_\n\n- satu\n- dua\n\n| a | b |\n|---|---|\n| 1 | 2 |'}
    />,
  );
  expect(screen.getByRole('heading', { name: 'Judul' })).toBeInTheDocument();
  expect(screen.getByText('tebal').tagName).toBe('STRONG');
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByRole('table')).toBeInTheDocument();
});

test('HTML mentah tidak dieksekusi: tampil sebagai teks', () => {
  const { container } = render(
    <MarkdownView source={'<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>'} />,
  );
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain('<script>alert(1)</script>');
});

test('tautan berbahaya dibuang; tautan aman dibuka di tab baru tanpa referrer', () => {
  const { container } = render(
    <MarkdownView
      source={
        '[a](javascript:alert(1)) [b](data:text/html;base64,AAAA) [c](//evil.test) [d](vbscript:x) ' +
        '[ok](https://contoh.test/x) [mail](mailto:a@b.test)'
      }
    />,
  );
  const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  expect(hrefs).toEqual(['https://contoh.test/x', 'mailto:a@b.test']);
  const safe = container.querySelector('a[href="https://contoh.test/x"]');
  expect(safe).toHaveAttribute('target', '_blank');
  expect(safe).toHaveAttribute('rel', 'noopener noreferrer');
  expect(container.textContent).toContain('a');
});

test('gambar eksternal tidak pernah dimuat; hanya qcfile: yang dirender', () => {
  const { container } = render(
    <MarkdownView
      source={'![jahat](https://evil.test/x.png) ![data](data:image/png;base64,AAA) ![foto](qcfile:ok)'}
    />,
  );
  const images = [...container.querySelectorAll('img')];
  expect(images).toHaveLength(1);
  expect(images[0]).toHaveAttribute('src', 'data:image/png;base64,AAA');
  expect(images[0]).toHaveAttribute('alt', 'foto');
});

test('status gambar qcfile: saat memuat dan saat gagal', () => {
  render(<MarkdownView source={'![a](qcfile:muat) ![b](qcfile:rusak)'} />);
  expect(screen.getByRole('img', { name: 'Memuat gambar' })).toBeInTheDocument();
  expect(screen.getByText('[gambar tidak tersedia]')).toBeInTheDocument();
});

test('rujukan qcfile: yang tidak sah tidak dirender sebagai gambar', () => {
  const { container } = render(<MarkdownView source={'![x](qcfile:a/b) ![y](qcfile:) ![z](QCFILE:ok)'} />);
  expect(container.querySelector('img')).toBeNull();
});
```

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `bun run --cwd web test markdown-view`
Expected: FAIL — `./markdown-view` belum ada.

- [ ] **Step 4: Implementasi** — `web/src/modules/markdown/markdown-view.tsx`

```tsx
import { parseFileRef } from '@shared/files';
import type { Components } from 'react-markdown';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { useFileUrl } from '@/modules/files/queries';

const SAFE_LINK = /^(https?:|mailto:)/i;

/** Hanya tautan http(s)/mailto dan gambar `qcfile:` yang lolos; atribut URL lain dibuang. */
function urlTransform(url: string, key: string): string | null {
  if (key === 'src') return parseFileRef(url) ? url : null;
  if (key === 'href') return SAFE_LINK.test(url) ? url : null;
  return null;
}

function MarkdownImage({ id, alt }: { id: string; alt: string }) {
  const { url, isLoading, isError } = useFileUrl(id);
  if (isLoading) {
    return (
      <span
        role="img"
        aria-label="Memuat gambar"
        className="inline-block h-24 w-40 animate-pulse rounded-md bg-muted"
      />
    );
  }
  if (isError || !url) {
    return <span className="text-xs text-muted-foreground">[gambar tidak tersedia]</span>;
  }
  return <img src={url} alt={alt} className="my-2 max-h-96 max-w-full rounded-md border" />;
}

const components: Components = {
  a: ({ href, children }) =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) => {
    const id = typeof src === 'string' ? parseFileRef(src) : null;
    return id ? <MarkdownImage id={id} alt={alt ?? ''} /> : null;
  },
};

export interface MarkdownViewProps {
  source: string;
  className?: string;
}

/** Render Markdown tanpa HTML mentah (tidak memakai rehype-raw); aman terhadap XSS (PRD FA6). */
export function MarkdownView({ source, className }: MarkdownViewProps) {
  return (
    <div
      className={cn(
        'space-y-3 break-words text-sm leading-relaxed',
        '[&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold',
        '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs',
        '[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3',
        '[&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1',
        '[&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
        className,
      )}
    >
      <Markdown remarkPlugins={[remarkGfm]} urlTransform={urlTransform} components={components}>
        {source}
      </Markdown>
    </div>
  );
}
```

- [ ] **Step 5: Jalankan, pastikan lulus**

Run: `bun run --cwd web test markdown-view && bun run --cwd web typecheck`
Expected: lulus. Bila `react-markdown` mengubah tanda tangan `urlTransform`/`Components` pada versi terpasang, sesuaikan tipenya (perilaku yang diuji tidak berubah); jangan menambah `rehype-raw`.

- [ ] **Step 6: Periksa ukuran bundel**

Run: `bun run build`
Expected: `verify-dist OK`. Catat ukuran `gas/dist/index.html` (batas 1,5 MB); bila melampaui, hentikan dan laporkan sebelum lanjut.

- [ ] **Step 7: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false web
git add web bun.lock
git commit -m "feat(web): render Markdown aman (tanpa HTML mentah, gambar hanya qcfile)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Editor Markdown dengan sisip gambar

**Files:**
- Create: `web/src/modules/markdown/edit-ops.ts`, `web/src/modules/markdown/edit-ops.test.ts`, `web/src/modules/markdown/markdown-editor.tsx`, `web/src/modules/markdown/markdown-editor.test.tsx`

**Interfaces:**
- Consumes: `MarkdownView` (Task 7); `useUploadImage`, `isAcceptedImage` (Task 6); `fileRef`, `MARKDOWN_MAX_LENGTH` (Task 4); `describeError`, `RpcError`.
- Produces:
  - `edit-ops.ts`: `TextSelection {start,end}`, `EditResult {text, selection}`, `wrapSelection(text, sel, before, after?, placeholder?)`, `prefixLines(text, sel, prefix: (index) => string)`, `insertAtCursor(text, sel, insertion)`.
  - `MarkdownEditor({ id, value, onChange, maxLength?, disabled? })` — komponen terkontrol.

- [ ] **Step 1: Tulis tes operasi teks yang gagal** — `web/src/modules/markdown/edit-ops.test.ts`

```ts
import { expect, test } from 'vitest';
import { insertAtCursor, prefixLines, wrapSelection } from './edit-ops';

test('wrapSelection membungkus pilihan dan mempertahankan pilihan pada isinya', () => {
  expect(wrapSelection('halo dunia', { start: 5, end: 10 }, '**')).toEqual({
    text: 'halo **dunia**',
    selection: { start: 7, end: 12 },
  });
});

test('wrapSelection tanpa pilihan menyisipkan teks contoh yang terpilih', () => {
  expect(wrapSelection('', { start: 0, end: 0 }, '**')).toEqual({
    text: '**teks**',
    selection: { start: 2, end: 6 },
  });
  expect(wrapSelection('a b', { start: 2, end: 2 }, '[', '](https://)', 'tautan')).toEqual({
    text: 'a [tautan](https://)b',
    selection: { start: 3, end: 9 },
  });
});

test('prefixLines memberi awalan pada semua baris yang tersentuh pilihan', () => {
  expect(prefixLines('a\nb\nc', { start: 0, end: 3 }, () => '- ')).toEqual({
    text: '- a\n- b\nc',
    selection: { start: 0, end: 8 },
  });
  expect(prefixLines('a\nb\nc', { start: 2, end: 2 }, () => '- ').text).toBe('a\n- b\nc');
  expect(prefixLines('a\nb\nc', { start: 0, end: 5 }, (i) => `${i + 1}. `).text).toBe(
    '1. a\n2. b\n3. c',
  );
});

test('prefixLines: pilihan yang berakhir tepat setelah baris baru tidak menyentuh baris berikutnya', () => {
  expect(prefixLines('a\nb\n', { start: 0, end: 2 }, () => '> ').text).toBe('> a\nb\n');
});

test('prefixLines: kursor di awal teks yang diawali baris baru', () => {
  expect(prefixLines('\nx', { start: 0, end: 0 }, () => '- ').text).toBe('- \nx');
});

test('insertAtCursor mengganti pilihan dan meletakkan kursor sesudah sisipan', () => {
  expect(insertAtCursor('abcd', { start: 1, end: 3 }, 'XY')).toEqual({
    text: 'aXYd',
    selection: { start: 3, end: 3 },
  });
  expect(insertAtCursor('ab', { start: 2, end: 2 }, '!').text).toBe('ab!');
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd web test edit-ops`
Expected: FAIL — `./edit-ops` belum ada.

- [ ] **Step 3: Implementasi** — `web/src/modules/markdown/edit-ops.ts`

```ts
export interface TextSelection {
  start: number;
  end: number;
}

export interface EditResult {
  text: string;
  selection: TextSelection;
}

/** Bungkus pilihan dengan `before`/`after`; tanpa pilihan, sisipkan `placeholder` dan pilih isinya. */
export function wrapSelection(
  text: string,
  selection: TextSelection,
  before: string,
  after: string = before,
  placeholder = 'teks',
): EditResult {
  const selected = text.slice(selection.start, selection.end) || placeholder;
  const next =
    text.slice(0, selection.start) + before + selected + after + text.slice(selection.end);
  const start = selection.start + before.length;
  return { text: next, selection: { start, end: start + selected.length } };
}

/** Beri awalan pada setiap baris yang tersentuh pilihan (judul, daftar, kutipan). */
export function prefixLines(
  text: string,
  selection: TextSelection,
  prefix: (index: number) => string,
): EditResult {
  const lineStart = selection.start === 0 ? 0 : text.lastIndexOf('\n', selection.start - 1) + 1;
  const searchFrom =
    selection.end > selection.start && text[selection.end - 1] === '\n'
      ? selection.end - 1
      : selection.end;
  const newline = text.indexOf('\n', searchFrom);
  const lineEnd = newline === -1 ? text.length : newline;
  const replaced = text
    .slice(lineStart, lineEnd)
    .split('\n')
    .map((line, index) => prefix(index) + line)
    .join('\n');
  return {
    text: text.slice(0, lineStart) + replaced + text.slice(lineEnd),
    selection: { start: lineStart, end: lineStart + replaced.length },
  };
}

export function insertAtCursor(
  text: string,
  selection: TextSelection,
  insertion: string,
): EditResult {
  const caret = selection.start + insertion.length;
  return {
    text: text.slice(0, selection.start) + insertion + text.slice(selection.end),
    selection: { start: caret, end: caret },
  };
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `bun run --cwd web test edit-ops`
Expected: lulus.

- [ ] **Step 5: Tulis tes komponen yang gagal** — `web/src/modules/markdown/markdown-editor.test.tsx`

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/files/use-upload-image', () => ({ useUploadImage: () => uploadMock }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: 'data:image/png;base64,AAA', isLoading: false, isError: false }),
}));

import { MarkdownEditor } from './markdown-editor';

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <MarkdownEditor id="md" value={value} onChange={setValue} />;
}

const textarea = () => screen.getByLabelText('Isi Markdown') as HTMLTextAreaElement;
const fileInput = () => screen.getByLabelText('Pilih gambar') as HTMLInputElement;
const png = (name = 'foto.png') => new File(['x'], name, { type: 'image/png' });

beforeEach(() => uploadMock.mockReset());

test('mengetik memperbarui isi dan penghitung karakter', async () => {
  render(<Harness />);
  await userEvent.type(textarea(), 'halo');
  expect(textarea().value).toBe('halo');
  expect(screen.getByText('4/20000')).toBeInTheDocument();
});

test('tombol Tebal membungkus pilihan', async () => {
  render(<Harness initial="halo dunia" />);
  textarea().setSelectionRange(5, 10);
  await userEvent.click(screen.getByRole('button', { name: 'Tebal' }));
  expect(textarea().value).toBe('halo **dunia**');
});

test('tombol Daftar memberi awalan pada setiap baris terpilih', async () => {
  render(<Harness initial={'a\nb'} />);
  textarea().setSelectionRange(0, 3);
  await userEvent.click(screen.getByRole('button', { name: 'Daftar' }));
  expect(textarea().value).toBe('- a\n- b');
});

test('tab Pratinjau menampilkan hasil render; kosong menampilkan petunjuk', async () => {
  const { unmount } = render(<Harness initial="**tebal** dan teks" />);
  await userEvent.click(screen.getByRole('tab', { name: 'Pratinjau' }));
  expect(screen.getByText('tebal').tagName).toBe('STRONG');
  expect(screen.queryByLabelText('Isi Markdown')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Tulis' }));
  expect(textarea().value).toBe('**tebal** dan teks');
  unmount();
  render(<Harness />);
  await userEvent.click(screen.getByRole('tab', { name: 'Pratinjau' }));
  expect(screen.getByText('Belum ada isi.')).toBeInTheDocument();
});

test('memilih gambar mengunggah lalu menyisipkan rujukan qcfile di kursor', async () => {
  uploadMock.mockResolvedValue('f1');
  render(<Harness initial="awal " />);
  const file = png('foto kucing.png');
  await userEvent.upload(fileInput(), file);
  await waitFor(() => expect(textarea().value).toContain('![foto kucing](qcfile:f1)'));
  expect(uploadMock).toHaveBeenCalledWith(file);
});

test('sisipan memakai posisi kursor terbaru saat unggahan selesai', async () => {
  let resolve!: (id: string) => void;
  uploadMock.mockReturnValue(new Promise<string>((r) => { resolve = r; }));
  render(<Harness initial="ab" />);
  fireEvent.change(fileInput(), { target: { files: [png()] } });
  expect(await screen.findByText('Mengunggah gambar…')).toBeInTheDocument();
  await userEvent.type(textarea(), 'X');
  resolve('f2');
  await waitFor(() => expect(textarea().value).toBe('abX![foto](qcfile:f2)\n'));
  await waitFor(() => expect(screen.queryByText('Mengunggah gambar…')).not.toBeInTheDocument());
});

test('menempel gambar mengunggahnya; menempel teks biasa tidak dicegat', async () => {
  uploadMock.mockResolvedValue('f3');
  render(<Harness />);
  const blocked = fireEvent.paste(textarea(), { clipboardData: { files: [png('tempel.png')] } });
  expect(blocked).toBe(false);
  await waitFor(() => expect(textarea().value).toContain('![tempel](qcfile:f3)'));
  uploadMock.mockClear();
  const passed = fireEvent.paste(textarea(), { clipboardData: { files: [] } });
  expect(passed).toBe(true);
  expect(uploadMock).not.toHaveBeenCalled();
});

test('menyeret gambar ke editor mengunggahnya', async () => {
  uploadMock.mockResolvedValue('f4');
  render(<Harness />);
  fireEvent.drop(textarea(), { dataTransfer: { files: [png('seret.png')] } });
  await waitFor(() => expect(textarea().value).toContain('![seret](qcfile:f4)'));
});

test('berkas bukan gambar ditolak dengan pesan dan tidak diunggah', async () => {
  render(<Harness initial="isi" />);
  fireEvent.change(fileInput(), {
    target: { files: [new File(['x'], 'catatan.txt', { type: 'text/plain' })] },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Hanya gambar JPEG, PNG, atau WebP yang dapat disisipkan',
  );
  expect(uploadMock).not.toHaveBeenCalled();
  expect(textarea().value).toBe('isi');
});

test('gagal mengunggah menampilkan pesan dan tidak mengubah isi', async () => {
  uploadMock.mockRejectedValue(new Error('Gambar masih terlalu besar setelah dikompres (maks. 1 MB)'));
  render(<Harness initial="isi" />);
  fireEvent.change(fileInput(), { target: { files: [png()] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Gambar masih terlalu besar');
  expect(textarea().value).toBe('isi');
});

test('melebihi batas karakter ditandai', () => {
  render(<Harness initial={'x'.repeat(20001)} />);
  expect(screen.getByText('20001/20000')).toHaveClass('text-destructive');
  expect(textarea()).toHaveAttribute('aria-invalid', 'true');
});
```

- [ ] **Step 6: Jalankan, pastikan gagal**

Run: `bun run --cwd web test markdown-editor`
Expected: FAIL — `./markdown-editor` belum ada.

- [ ] **Step 7: Implementasi** — `web/src/modules/markdown/markdown-editor.tsx`

```tsx
import { fileRef, MARKDOWN_MAX_LENGTH } from '@shared/files';
import type { LucideIcon } from 'lucide-react';
import { Bold, Code, Heading2, ImagePlus, Italic, Link2, List, ListOrdered, Quote } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { describeError } from '@/lib/rpc/describe-error';
import { RpcError } from '@/lib/rpc/rpc-error';
import { isAcceptedImage } from '@/modules/files/image';
import { useUploadImage } from '@/modules/files/use-upload-image';
import type { EditResult, TextSelection } from './edit-ops';
import { insertAtCursor, prefixLines, wrapSelection } from './edit-ops';
import { MarkdownView } from './markdown-view';

interface Tool {
  label: string;
  icon: LucideIcon;
  run: (text: string, selection: TextSelection) => EditResult;
}

const TOOLS: Tool[] = [
  { label: 'Judul', icon: Heading2, run: (t, s) => prefixLines(t, s, () => '## ') },
  { label: 'Tebal', icon: Bold, run: (t, s) => wrapSelection(t, s, '**') },
  { label: 'Miring', icon: Italic, run: (t, s) => wrapSelection(t, s, '_') },
  { label: 'Daftar', icon: List, run: (t, s) => prefixLines(t, s, () => '- ') },
  {
    label: 'Daftar bernomor',
    icon: ListOrdered,
    run: (t, s) => prefixLines(t, s, (index) => `${index + 1}. `),
  },
  { label: 'Kutipan', icon: Quote, run: (t, s) => prefixLines(t, s, () => '> ') },
  { label: 'Kode', icon: Code, run: (t, s) => wrapSelection(t, s, '`') },
  { label: 'Tautan', icon: Link2, run: (t, s) => wrapSelection(t, s, '[', '](https://)', 'teks') },
];

const ACCEPT = 'image/jpeg,image/png,image/webp';

export interface MarkdownEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  disabled?: boolean;
}

type Tab = 'write' | 'preview';

function uploadErrorMessage(error: unknown): string {
  if (error instanceof RpcError) return describeError(error);
  if (error instanceof Error) return error.message;
  return 'Gagal mengunggah gambar';
}

export function MarkdownEditor({
  id,
  value,
  onChange,
  maxLength = MARKDOWN_MAX_LENGTH,
  disabled = false,
}: MarkdownEditorProps) {
  const [tab, setTab] = useState<Tab>('write');
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSelection = useRef<TextSelection | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const uploadImage = useUploadImage();

  // Pulihkan fokus dan pilihan setelah teks berubah lewat toolbar atau sisip gambar.
  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    const element = textareaRef.current;
    pendingSelection.current = null;
    if (selection && element) {
      element.focus();
      element.setSelectionRange(selection.start, selection.end);
    }
  });

  function currentSelection(): TextSelection {
    const element = textareaRef.current;
    const end = valueRef.current.length;
    return { start: element?.selectionStart ?? end, end: element?.selectionEnd ?? end };
  }

  function apply(result: EditResult) {
    pendingSelection.current = result.selection;
    onChange(result.text);
  }

  async function insertImages(files: File[]) {
    const images = files.filter(isAcceptedImage);
    if (images.length === 0) {
      setUploadError('Hanya gambar JPEG, PNG, atau WebP yang dapat disisipkan');
      return;
    }
    setUploadError(null);
    for (const file of images) {
      setUploading((count) => count + 1);
      try {
        const fileId = await uploadImage(file);
        const alt = file.name.replace(/\.[^.]+$/, '').replace(/[[\]()]/g, '') || 'gambar';
        apply(insertAtCursor(valueRef.current, currentSelection(), `![${alt}](${fileRef(fileId)})\n`));
      } catch (error) {
        setUploadError(uploadErrorMessage(error));
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }

  const tooLong = value.length > maxLength;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <div role="tablist" aria-label="Mode editor" className="mr-2 flex gap-1">
          {(['write', 'preview'] as const).map((item) => (
            <Button
              key={item}
              type="button"
              role="tab"
              size="sm"
              variant={tab === item ? 'secondary' : 'ghost'}
              aria-selected={tab === item}
              onClick={() => setTab(item)}
            >
              {item === 'write' ? 'Tulis' : 'Pratinjau'}
            </Button>
          ))}
        </div>
        {tab === 'write' ? (
          <>
            {TOOLS.map(({ label, icon: Icon, run }) => (
              <Button
                key={label}
                type="button"
                size="sm"
                variant="ghost"
                aria-label={label}
                title={label}
                disabled={disabled}
                onClick={() => apply(run(valueRef.current, currentSelection()))}
              >
                <Icon aria-hidden="true" />
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Gambar"
              title="Sisipkan gambar"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus aria-hidden="true" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              multiple
              aria-label="Pilih gambar"
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = '';
                if (files.length > 0) void insertImages(files);
              }}
            />
          </>
        ) : null}
      </div>

      {tab === 'write' ? (
        <Textarea
          id={id}
          ref={textareaRef}
          aria-label="Isi Markdown"
          aria-invalid={tooLong}
          className="min-h-64 font-mono text-sm"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onPaste={(event) => {
            const files = [...(event.clipboardData?.files ?? [])];
            if (files.length === 0) return;
            event.preventDefault();
            void insertImages(files);
          }}
          onDragOver={(event) => {
            if ([...(event.dataTransfer?.types ?? [])].includes('Files')) event.preventDefault();
          }}
          onDrop={(event) => {
            const files = [...(event.dataTransfer?.files ?? [])];
            if (files.length === 0) return;
            event.preventDefault();
            void insertImages(files);
          }}
        />
      ) : (
        <div className="min-h-64 rounded-md border p-3">
          {value.trim() === '' ? (
            <p className="text-sm text-muted-foreground">Belum ada isi.</p>
          ) : (
            <MarkdownView source={value} />
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-xs">
        <span aria-live="polite" className="text-muted-foreground">
          {uploading > 0 ? 'Mengunggah gambar…' : ''}
        </span>
        <span className={cn(tooLong ? 'text-destructive' : 'text-muted-foreground')}>
          {value.length}/{maxLength}
        </span>
      </div>
      {uploadError ? (
        <p role="alert" className="text-sm text-destructive">
          {uploadError}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 8: Jalankan semua tes web dan typecheck**

Run: `bun run --cwd web test && bun run --cwd web typecheck`
Expected: lulus. Catatan: bila `userEvent.upload` menolak berkas karena `accept`, itu sengaja untuk tes berkas bukan gambar; tes tersebut memakai `fireEvent.change` agar melewati penyaringan peramban.

- [ ] **Step 9: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false web
git add web
git commit -m "feat(web): editor Markdown dengan toolbar dan sisip gambar (tombol, tempel, seret)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Dokumentasi, E2E, dan verifikasi akhir Fase A

**Files:**
- Modify: `docs/adding-a-module.md`, `docs/e2e-checklist.md`, `CLAUDE.md`, `docs/prd/2026-10-09-qc-item-serah-terima.md`

**Interfaces:**
- Consumes: semua tugas sebelumnya.
- Produces: dokumentasi yang selaras dengan kode.

- [ ] **Step 1: `docs/adding-a-module.md`**

Pada bagian "Modul berlokasi (izin per lokasi)":
- Ganti kalimat pembuka `Modul \`item\`, \`handover\`, dan \`stock\` bersifat berlokasi (\`LOCATION_MODULES\` di \`shared/assignments.ts\`); \`access\` global. Untuk modul berlokasi:` dengan:

```markdown
Modul `handover`, `qc`, dan `stock` bersifat berlokasi (`LOCATION_MODULES` di `shared/assignments.ts`). `access` global dan hanya dari penugasan "Semua lokasi"; `item` global bersama (levelnya tertinggi dari **semua** penugasan berlaku, `SHARED_MODULES`). Untuk modul berlokasi:
```

- Pada contoh kode rute, ganti `'item.list'`→`'handover.list'`, `'item.save'`→`'handover.save'`, `module: 'item'`→`module: 'handover'`, `validateListItems_`→`validateListHandovers_`, `listItems_`→`listHandovers_`, `validateSaveItem_`→`validateSaveHandover_`, `saveItem_`→`saveHandover_`.
- Tambahkan butir setelah butir 5 ("Tes"):

```markdown
6. **Izin alternatif**: bila method boleh diakses oleh salah satu dari beberapa izin (mis. WH atau QC), pakai `permission: { anyOf: [ ... ] }`. Semua alternatif harus sama lingkupnya (semua global atau semua `scope: 'location'`); tiap lokasi yang diminta cukup memenuhi satu alternatif, dan satu lokasi yang gagal menolak seluruh permintaan.
```

Tambahkan bagian baru di akhir berkas:

````markdown
## Gambar dan Markdown

- **Unggah**: frontend memakai `useUploadImage()` (`web/src/modules/files/use-upload-image.ts`): gambar dikecilkan (maks. 1600 px, ≤ 1 MB, JPEG/PNG/WebP), diunggah lewat RPC `files.upload`, dan mengembalikan id berkas. Berkas lahir **tanpa pemilik**.
- **Memiliki berkas**: saat entitas (mis. item) disimpan, panggil `attachFiles_(ids, 'item', itemId)` (`gas/src/modules/files/service.ts`) **di dalam lock yang sama** dengan penyimpanan entitas. Berkas yang sudah dimiliki entitas lain ditolak `CONFLICT`. Jenis pemilik baru ditambahkan ke `FileOwnerType` di `shared/files.ts`.
- **Tampil**: `useFileUrl(id)` (cache lama, data URL). Server hanya membaca berkas yang tercatat di sheet `files`; klien tidak pernah mengirim Drive id.
- **Markdown**: tampilkan dengan `MarkdownView` dan edit dengan `MarkdownEditor` (`web/src/modules/markdown/`). Gambar ditulis `![alt](qcfile:<id>)`. HTML mentah tidak dirender dan hanya tautan `http`/`https`/`mailto` yang aktif. Validasi panjang (`MARKDOWN_MAX_LENGTH` = 20.000) tetap dilakukan di skema form dan di validator server.
- **Drive** hanya diakses lewat `platform_()` (`driveCreateFolder`, `driveCreateFile`, `driveReadFile`); jangan memanggil `DriveApp` langsung.
````

- [ ] **Step 2: `docs/e2e-checklist.md`**

Tambahkan baris (lanjutan nomor terakhir, yaitu 24):

```markdown
| 25 | Setelah push Fase A, jalankan `setup` dari editor Apps Script | Google meminta izin Drive sekali; laporan memuat `Folder Drive "QC App Files" siap (...)`; folder muncul di Drive pemilik dan sheet `files` terbuat | FA1 |
| 26 | Jalankan `setup` sekali lagi | Tidak ada folder kedua; id folder sama | FA1 |
```

(Unggah dan tampil gambar diuji end-to-end di halaman Data Item pada Fase B.)

- [ ] **Step 3: `CLAUDE.md`**

Di bagian "Struktur", tambahkan setelah baris `web/src/modules/location/`:

```markdown
- `web/src/modules/files/` — kecilkan/unggah/tampil gambar (RPC `files.*`); `web/src/modules/markdown/` — render Markdown aman dan editor dengan sisip gambar. Drive hanya lewat `platform_()`.
```

Pada butir 5 di "Menambah method RPC", tambahkan kalimat: `Izin "salah satu dari": pakai \`anyOf\` (lihat \`docs/adding-a-module.md\`).`

- [ ] **Step 4: PRD** — `docs/prd/2026-10-09-qc-item-serah-terima.md`

Di bagian 9 "Definition of Done › Fase A", centang tiga butir yang sudah terbukti oleh tes: upload/ambil/tampil dengan pemeriksaan izin dan batas ukuran; editor Markdown dan render aman; modul `qc` di form Role dan `item` global. Butir pertama ("`setup` membuat folder Drive dan sheet `files`; izin Drive tercantum di `appsscript.json`") **dibiarkan belum dicentang** sampai E2E 25–26 lulus di deployment.

- [ ] **Step 5: Verifikasi akhir otomatis**

Run: `bun run check` lalu `bun run build`
Expected: `check` hijau (scripts, shared, gas, web); `build` lolos `verify-dist` (penanda boot satu kali, tanpa import/export di `gas/dist`, scope Drive ada, `index.html` ≤ 1,5 MB). Catat ukuran `gas/dist/index.html` di pesan commit.

- [ ] **Step 6: Verifikasi manual di mock dev**

Run: `bun run dev`, buka `http://localhost:3000`, login sebagai Super Admin → **Pengaturan Akses → Roles → Tambah role**. Periksa:
- Modul **Pengerjaan QC** tampil dengan level Tidak ada/Ubah beserta petunjuk levelnya; **Data Item** dan **Serah Terima** menampilkan petunjuk levelnya.
- Login sebagai QC Staff: header memiliki pemilih lokasi; menu tidak berubah.
(Editor Markdown belum punya halaman sampai Fase B; perilakunya diverifikasi oleh tes komponen. Kompresi gambar via canvas diverifikasi manual di halaman Item pada Fase B.)

- [ ] **Step 7: Commit**

```bash
bunx biome check --write --linter-enabled=false docs
git add docs CLAUDE.md
git commit -m "docs: fondasi file, editor Markdown, izin anyOf, dan E2E Fase A" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Penutup (setelah Task 9)

- Ikuti `superpowers:executing-plans` (atau subagent-driven): review akhir seluruh branch oleh reviewer terpisah (model paling mampu) dengan paket `review-package`, perbaiki temuan Critical/Important dalam satu putaran dengan TDD, catat Minor.
- Push branch, buka PR ke `dev` (merge memicu deploy dev), lalu uji di `/dev`: **jalankan `setup` dan setujui izin Drive** (E2E 25–26). PR `dev` → `main` hanya setelah Fase B siap diuji bersama atau atas keputusan Anda.
- Fase B (Data Item) dan Fase C (Serah Terima) memakai `MarkdownEditor`, `useUploadImage`, `attachFiles_`, izin `qc`, dan `anyOf` dari fase ini.
