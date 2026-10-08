# QC App — Fondasi & Sistem Akses: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun fondasi QC App (monorepo Bun berisi GAS backend + React frontend single-file) beserta login Google, whitelist, role multi-level per modul, dan UI pengelolaan akses.

**Architecture:** Kode GAS ditulis dalam TypeScript ber-`import`/`export` biasa, lalu di-transpile **per file** oleh skrip Bun yang menghapus `import`/`export` (GAS berbagi satu global scope). Seluruh panggilan klien masuk lewat satu fungsi `api(method, payloadJson, token)` yang memverifikasi token sesi HMAC, memuat konteks user dari sheet, lalu mengecek level modul. Semua API GAS diakses lewat antarmuka `Platform` sehingga logika server dapat diuji dengan `bun test`, dan transport **mock** di FE menjalankan router GAS yang sama di browser memakai memory platform.

**Tech Stack:** Bun (latest), TypeScript strict, Google Apps Script V8, clasp 3.x, React, Vite, TanStack Router (hash history) / Query / Form, zod, shadcn/ui, Tailwind CSS v4, vite-plugin-singlefile, Vitest + Testing Library, Biome.

**Spec:** `docs/prd/2026-10-08-qc-fondasi-akses.md`

**Asumsi atas pertanyaan terbuka PRD §12:** spreadsheet database dirujuk lewat Script Property `SPREADSHEET_ID` (bisa spreadsheet baru atau lama); `ADMIN_EMAIL` diisi saat setup (tidak memengaruhi kode); sesi 7 hari; nama aplikasi "QC App".

## Global Constraints

- Runtime & paket: **Bun versi terbaru**; semua skrip dijalankan lewat `bun run`.
- TypeScript: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules` (dari `tsconfig.base.json`). Import tipe wajib `import type`.
- Manifest GAS: `runtimeVersion: "V8"`, `timeZone: "Asia/Jakarta"`, `webapp.executeAs: "USER_DEPLOYING"`, `webapp.access: "ANYONE_ANONYMOUS"`.
- Kode di `gas/src` dan `shared/`: **tanpa dependency npm runtime**, tanpa `export default`, tanpa re-export, tanpa import alias (`as`), tanpa namespace import, tanpa dynamic import, tanpa `enum`/`namespace`, tanpa class.
- Semua fungsi top-level di `gas/src` **wajib berakhiran `_`**, kecuali `doGet`, `api`, `setup`. Nama top-level harus unik di seluruh `gas/src` + `shared/`.
- Tidak ada kode top-level yang membaca global file lain saat load; konstanta top-level hanya literal.
- `shared/` murni: tanpa API GAS, tanpa DOM; import internal `shared/` memakai path relatif (`./permissions`).
- Hanya `gas/dist/` yang di-push clasp; `gas/dist/` tidak pernah diedit manual dan di-gitignore.
- Build FE menghasilkan **satu file** `gas/dist/index.html` yang memuat `<!--BOOT-->` **tepat satu kali**.
- Tidak memakai library state global (Zustand/Redux/TanStack Store) di sub-project ini.
- Modul: `access`, `item`, `handover`, `stock`. Level: `none` < `view` < `edit` < `manage`.
- Kode error RPC: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `INTERNAL`.
- Sesi: 7 hari (`SESSION_TTL_MS`). Cache konteks user: 300 detik. State login OAuth: 21600 detik (6 jam — **menggantikan 10 menit di PRD §6.5**, lihat Task 9).
- Secret hanya di Script Properties: `SPREADSHEET_ID`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `SESSION_SECRET`, `ADMIN_EMAIL`.
- Semua teks UI dan pesan error dalam Bahasa Indonesia.
- Setiap commit diakhiri baris `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Refresh setelah login** — URL atas masih berisi `?code&state` yang sudah terpakai; user harus tetap masuk memakai token tersimpan, bukan melihat "Login gagal". → test di Task 11 (`boot.test.ts`).
2. **Teks berawalan `=`, `+`, `-`, `@`** (nama user/role/deskripsi) harus tersimpan sebagai teks literal, tidak dievaluasi sebagai formula — termasuk saat baris di-update pada kolom lain. → test di Task 5 (`db.test.ts`) dan Task 8 (`service.test.ts`).
3. **Email beda kapitalisasi/spasi** (`" Budi@Gmail.COM "`) dinormalisasi: tidak bisa membuat duplikat, cocok dengan whitelist dan `ADMIN_EMAIL`. → test di Task 6 (`context.test.ts`) dan Task 8.
4. **Sheet diedit manual** — kolom ditukar urutannya, kolom tambahan, baris kosong, JSON `role_ids`/`permissions` rusak, level tak dikenal — tidak boleh membuat crash. → test di Task 5 dan Task 6.
5. **User dinonaktifkan atau token dimanipulasi saat sesi aktif** → server menjawab `UNAUTHENTICATED`, FE menghapus token dan kembali ke `/login`. → test di Task 7 (`router.test.ts`) dan Task 11 (`query-client.test.ts`).

## Peta File

```
qc/
├─ package.json, tsconfig.base.json, tsconfig.json, biome.json, .mcp.json, CLAUDE.md, README.md
├─ scripts/
│  ├─ paths.ts                 # konstanta path repo
│  ├─ build-gas-lib.ts         # transformForGas, findDuplicateGlobals (+ .test.ts)
│  ├─ build-gas.ts             # CLI: gas/src + shared → gas/dist
│  ├─ verify-dist.ts           # validasi hasil build gabungan
│  ├─ push.ts, deploy.ts       # pembungkus clasp
├─ shared/
│  ├─ permissions.ts (+ .test.ts)
│  └─ rpc.ts
├─ gas/
│  ├─ appsscript.json, .clasp.json, deployment.json, tsconfig.json, package.json
│  ├─ test-support/            # memory-platform.ts, access-fixtures.ts, errors.ts (tidak di-build)
│  └─ src/
│     ├─ main.ts               # doGet, api, setup
│     ├─ routes.ts             # getRoutes_
│     ├─ setup.ts              # runSetup_
│     ├─ core/                 # platform, gas-platform, errors, email, config, session, db, validate, router
│     └─ modules/
│        ├─ access/            # repo, context, validate, service, routes
│        └─ auth/              # oauth, boot, routes
└─ web/
   ├─ index.html, vite.config.ts, tsconfig.json, package.json, components.json
   └─ src/
      ├─ main.tsx, styles.css, routeTree.gen.ts, types/gas-client.d.ts, test/setup.ts
      ├─ app/                  # boot, query-client, router, gas-location, navigation, module-links, shell/*
      ├─ lib/rpc/              # transport, rpc-error, client, gas-transport, mock-backend, describe-error, index
      ├─ components/           # ui/* (shadcn), field-error.tsx, native-select.tsx
      ├─ modules/auth/         # session, queries, permissions, use-me, use-logout, components/*
      ├─ modules/access/       # queries, schemas, lib/filter-users, components/*
      └─ routes/               # __root, login, _app, _app/index, _app/forbidden, _app/access/{users,roles}
```

---

### Task 1: Prasyarat & workspace Bun

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `tsconfig.json`, `biome.json`
- Create: `shared/package.json`, `shared/tsconfig.json`
- Create: `gas/package.json`, `gas/tsconfig.json`

**Interfaces:**
- Produces: alias path `@shared/*` → `shared/*`, `@gas/*` → `gas/src/*`, `@gas-test/*` → `gas/test-support/*` (dipakai semua task berikutnya); skrip root `format`, `lint`.

- [ ] **Step 1: Install Bun (minta izin user dulu — ini mengunduh & menjalankan installer dari bun.sh)**

Tanyakan ke user: "Boleh saya install Bun lewat installer resmi `https://bun.sh/install.ps1`?" Setelah disetujui:

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

Buka shell baru lalu verifikasi:

```bash
bun --version
clasp --version
git --version
```

Expected: tiga versi tercetak (`clasp` ≥ 3.0).

- [ ] **Step 2: Tulis `package.json` root**

```json
{
  "name": "qc",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "gas"],
  "scripts": {
    "build:gas": "bun run scripts/build-gas.ts",
    "typecheck": "tsc -p tsconfig.json && bun run --cwd shared typecheck && bun run --cwd gas typecheck",
    "lint": "biome check .",
    "format": "biome check --write .",
    "test": "bun test ./scripts && bun run --cwd shared test && bun run --cwd gas test",
    "check": "bun run typecheck && bun run lint && bun run test"
  }
}
```

- [ ] **Step 3: Tulis `tsconfig.base.json` dan `tsconfig.json` root**

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`tsconfig.json` (untuk `scripts/`):

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": { "types": ["bun"] },
  "include": ["scripts"]
}
```

- [ ] **Step 4: Tulis workspace `shared` dan `gas`**

`shared/package.json`:

```json
{
  "name": "@qc/shared",
  "private": true,
  "type": "module",
  "scripts": { "test": "bun test", "typecheck": "tsc -p tsconfig.json" }
}
```

`shared/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["bun"] },
  "include": ["*.ts"]
}
```

`gas/package.json`:

```json
{
  "name": "@qc/gas",
  "private": true,
  "type": "module",
  "scripts": { "test": "bun test", "typecheck": "tsc -p tsconfig.json" }
}
```

`gas/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "types": ["google-apps-script", "bun"],
    "paths": {
      "@shared/*": ["../shared/*"],
      "@gas/*": ["./src/*"],
      "@gas-test/*": ["./test-support/*"]
    }
  },
  "include": ["src", "test-support", "../shared/*.ts"]
}
```

- [ ] **Step 5: Tulis `biome.json`**

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "includes": [
      "**",
      "!**/dist/**",
      "!**/routeTree.gen.ts",
      "!web/src/components/ui/**",
      "!web/src/hooks/**"
    ]
  },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "always" } },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "assist": { "actions": { "source": { "organizeImports": "on" } } }
}
```

- [ ] **Step 6: Install dev dependencies**

```bash
bun add -d typescript @types/bun @biomejs/biome
cd gas && bun add -d @types/google-apps-script && cd ..
```

Expected: `bun.lock` dibuat, tanpa error. Lalu:

```bash
bunx tsc --version
bunx biome --version
```

Jika `biome check` menolak `biome.json` karena versi skema berbeda, jalankan `bunx biome migrate --write` lalu ulangi.

- [ ] **Step 7: Commit**

```bash
bun run format
git add package.json bun.lock tsconfig.base.json tsconfig.json biome.json shared/package.json shared/tsconfig.json gas/package.json gas/tsconfig.json
git commit -m "chore: setup bun workspace, typescript, dan biome" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Kontrak bersama `shared/`

**Files:**
- Create: `shared/permissions.ts`, `shared/rpc.ts`
- Test: `shared/permissions.test.ts`

**Interfaces:**
- Produces (`shared/permissions.ts`): `MODULES`, `type ModuleKey`, `MODULE_LABELS`, `LEVELS`, `type Level`, `LEVEL_LABELS`, `type PermissionMap = Record<ModuleKey, Level>`, `type PartialPermissionMap`, `isModuleKey(v): v is ModuleKey`, `isLevel(v): v is Level`, `levelRank(level): number`, `hasLevel(actual, required): boolean`, `emptyPermissions(): PermissionMap`, `fullPermissions(): PermissionMap`, `sanitizePermissions(raw: unknown): PartialPermissionMap`, `mergePermissions(sources: readonly unknown[]): PermissionMap`.
- Produces (`shared/rpc.ts`): `ERROR_CODES`, `type ErrorCode`, `RpcErrorBody`, `RpcResult<T>`, `UserStatus`, `MeDto`, `UserDto`, `RoleDto`, `SaveUserInput`, `SetUserStatusInput`, `SaveRoleInput`, `DeleteRoleInput`, `RpcContract`, `RpcMethod`, `RpcInput<M>`, `RpcOutput<M>`, `AuthErrorCode`, `BootData`.

- [ ] **Step 1: Tulis test yang gagal — `shared/permissions.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import {
  emptyPermissions,
  fullPermissions,
  hasLevel,
  mergePermissions,
  sanitizePermissions,
} from './permissions';

describe('hasLevel', () => {
  test('level lebih tinggi memenuhi level yang lebih rendah', () => {
    expect(hasLevel('manage', 'view')).toBe(true);
    expect(hasLevel('edit', 'edit')).toBe(true);
    expect(hasLevel('view', 'edit')).toBe(false);
    expect(hasLevel('none', 'view')).toBe(false);
  });
});

describe('mergePermissions', () => {
  test('mengambil level tertinggi per modul dari banyak role', () => {
    const merged = mergePermissions([{ item: 'view', handover: 'edit' }, { item: 'manage' }]);
    expect(merged).toEqual({ access: 'none', item: 'manage', handover: 'edit', stock: 'none' });
  });

  test('tanpa role menghasilkan none di semua modul', () => {
    expect(mergePermissions([])).toEqual(emptyPermissions());
  });

  test('mengabaikan modul/level tak dikenal dan input rusak', () => {
    const merged = mergePermissions([
      { item: 'superuser', unknown: 'manage' },
      null,
      'rusak',
      ['x'],
      { stock: 'view' },
    ]);
    expect(merged).toEqual({ access: 'none', item: 'none', handover: 'none', stock: 'view' });
  });
});

describe('fullPermissions', () => {
  test('manage di semua modul', () => {
    expect(fullPermissions()).toEqual({
      access: 'manage',
      item: 'manage',
      handover: 'manage',
      stock: 'manage',
    });
  });
});

describe('sanitizePermissions', () => {
  test('membuang level none serta entri tidak valid', () => {
    expect(sanitizePermissions({ access: 'none', item: 'edit', stock: 42 })).toEqual({ item: 'edit' });
    expect(sanitizePermissions(null)).toEqual({});
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `bun run --cwd shared test`
Expected: FAIL — `Cannot find module './permissions'`.

- [ ] **Step 3: Implementasi `shared/permissions.ts`**

```ts
export const MODULES = ['access', 'item', 'handover', 'stock'] as const;
export type ModuleKey = (typeof MODULES)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  access: 'Pengaturan Akses',
  item: 'Data Item',
  handover: 'Serah Terima QC–WH',
  stock: 'Monitoring Stok',
};

export const LEVELS = ['none', 'view', 'edit', 'manage'] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, string> = {
  none: 'Tidak ada',
  view: 'Lihat',
  edit: 'Ubah',
  manage: 'Kelola',
};

export type PermissionMap = Record<ModuleKey, Level>;
export type PartialPermissionMap = Partial<Record<ModuleKey, Level>>;

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && (MODULES as readonly string[]).includes(value);
}

export function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

export function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}

export function hasLevel(actual: Level, required: Level): boolean {
  return levelRank(actual) >= levelRank(required);
}

function permissionsWith(level: Level): PermissionMap {
  const result = {} as PermissionMap;
  for (const module of MODULES) result[module] = level;
  return result;
}

export function emptyPermissions(): PermissionMap {
  return permissionsWith('none');
}

export function fullPermissions(): PermissionMap {
  return permissionsWith('manage');
}

/** Ambil hanya pasangan modul→level yang valid dan bukan `none`. */
export function sanitizePermissions(raw: unknown): PartialPermissionMap {
  const result: PartialPermissionMap = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw)) {
    if (isModuleKey(key) && isLevel(value) && value !== 'none') result[key] = value;
  }
  return result;
}

/** Level efektif = level tertinggi per modul dari semua sumber (role). */
export function mergePermissions(sources: readonly unknown[]): PermissionMap {
  const result = emptyPermissions();
  for (const source of sources) {
    const clean = sanitizePermissions(source);
    for (const module of MODULES) {
      const level = clean[module];
      if (level && levelRank(level) > levelRank(result[module])) result[module] = level;
    }
  }
  return result;
}
```

- [ ] **Step 4: Implementasi `shared/rpc.ts`**

```ts
import type { PartialPermissionMap, PermissionMap } from './permissions';

export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'CONFLICT',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface RpcErrorBody {
  code: ErrorCode;
  message: string;
  requestId: string;
  fields?: Record<string, string>;
}

export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: RpcErrorBody };

export type UserStatus = 'active' | 'inactive';

export interface MeDto {
  email: string;
  name: string;
  isSuperAdmin: boolean;
  permissions: PermissionMap;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  roleIds: string[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface RoleDto {
  id: string;
  name: string;
  description: string;
  permissions: PartialPermissionMap;
  userCount: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SaveUserInput {
  id?: string;
  email: string;
  name: string;
  status: UserStatus;
  roleIds: string[];
}

export interface SetUserStatusInput {
  id: string;
  status: UserStatus;
}

export interface SaveRoleInput {
  id?: string;
  name: string;
  description: string;
  permissions: PartialPermissionMap;
}

export interface DeleteRoleInput {
  id: string;
}

export interface RpcContract {
  'auth.me': { input: null; output: MeDto };
  'access.users.list': { input: null; output: UserDto[] };
  'access.users.save': { input: SaveUserInput; output: UserDto };
  'access.users.setStatus': { input: SetUserStatusInput; output: UserDto };
  'access.roles.list': { input: null; output: RoleDto[] };
  'access.roles.save': { input: SaveRoleInput; output: RoleDto };
  'access.roles.delete': { input: DeleteRoleInput; output: { id: string } };
}

export type RpcMethod = keyof RpcContract;
export type RpcInput<M extends RpcMethod> = RpcContract[M]['input'];
export type RpcOutput<M extends RpcMethod> = RpcContract[M]['output'];

export type AuthErrorCode = 'NOT_WHITELISTED' | 'LOGIN_FAILED';

/** Data yang disisipkan GAS ke `window.__BOOT__` saat merender index.html. */
export interface BootData {
  loginUrl?: string;
  sessionToken?: string;
  authError?: AuthErrorCode;
  email?: string;
}
```

- [ ] **Step 5: Jalankan test & typecheck**

Run: `bun run --cwd shared test` → Expected: PASS (6 test).
Run: `bun run --cwd shared typecheck` → Expected: tanpa error.

- [ ] **Step 6: Commit**

```bash
bun run format
git add shared
git commit -m "feat(shared): kontrak RPC dan model permission" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Skrip build GAS (transpile per file)

**Files:**
- Create: `scripts/paths.ts`, `scripts/build-gas-lib.ts`, `scripts/build-gas.ts`
- Test: `scripts/build-gas.test.ts`

**Interfaces:**
- Produces: `transformForGas(source: string, file: string, options: { enforcePrivateNames: boolean }): { code: string; globals: string[] }` (melempar `GasBuildError`); `findDuplicateGlobals(files: ReadonlyArray<{ file: string; globals: readonly string[] }>): string[]`; `PUBLIC_GAS_FUNCTIONS = {'doGet','api','setup'}`; konstanta `ROOT_DIR`, `GAS_DIR`, `GAS_DIST_DIR`, `SHARED_DIR`. CLI `bun run build:gas` dijalankan pertama kali di Task 9.

- [ ] **Step 1: Tulis test yang gagal — `scripts/build-gas.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { findDuplicateGlobals, transformForGas } from './build-gas-lib';

const GAS = { enforcePrivateNames: true };
const SHARED = { enforcePrivateNames: false };

describe('transformForGas', () => {
  test('menghapus import/export sehingga deklarasi menjadi global', () => {
    const source = [
      "import { hasLevel } from '@shared/permissions';",
      "import type { Level } from '@shared/permissions';",
      '',
      'export function check_(level: Level): boolean {',
      "  return hasLevel(level, 'view');",
      '}',
      'export const LIMIT = 3;',
    ].join('\n');
    const result = transformForGas(source, 'gas/src/a.ts', GAS);
    expect(result.code).not.toMatch(/^\s*(import|export)\b/m);
    expect(result.code).toContain('function check_(level)');
    expect(result.code).toContain('hasLevel(level, "view")');
    expect(result.globals).toEqual(['check_', 'LIMIT']);
  });

  test('import multi-baris ikut terhapus', () => {
    const source = "import {\n  a_,\n  b_,\n} from './x';\nexport function c_() {\n  return a_() + b_();\n}\n";
    const result = transformForGas(source, 'gas/src/c.ts', GAS);
    expect(result.code).not.toContain('import');
    expect(result.globals).toEqual(['c_']);
  });

  test('menolak export default', () => {
    expect(() => transformForGas('export default function x_() {}', 'f.ts', GAS)).toThrow(/export default/);
  });

  test('menolak import alias, namespace, default import, dan dynamic import', () => {
    expect(() => transformForGas("import { a_ as b_ } from './x';\nb_();", 'f.ts', GAS)).toThrow(/alias/);
    expect(() => transformForGas("import * as x from './x';\nx.a();", 'f.ts', GAS)).toThrow(/namespace/);
    expect(() => transformForGas("import x from './x';\nx();", 'f.ts', GAS)).toThrow(/default import/);
    expect(() => transformForGas("export function a_() { return import('./x'); }", 'f.ts', GAS)).toThrow(
      /dynamic import/,
    );
  });

  test('menolak re-export dari modul lain', () => {
    expect(() => transformForGas("export { a_ } from './x';", 'f.ts', GAS)).toThrow(/re-export/);
  });

  test('fungsi global di gas/src wajib berakhiran _', () => {
    expect(() => transformForGas('export function listUsers() { return 1; }', 'f.ts', GAS)).toThrow(
      /listUsers/,
    );
    expect(() => transformForGas('export const handler = () => 1;', 'f.ts', GAS)).toThrow(/handler/);
  });

  test('doGet, api, dan setup boleh publik', () => {
    const source = 'export function doGet() { return 1; }\nexport function api() { return 2; }\nexport function setup() { return 3; }';
    expect(transformForGas(source, 'gas/src/main.ts', GAS).globals).toEqual(['doGet', 'api', 'setup']);
  });

  test('aturan nama privat tidak berlaku untuk shared/', () => {
    const result = transformForGas('export function hasLevel(a: string) { return a; }', 'shared/p.ts', SHARED);
    expect(result.globals).toEqual(['hasLevel']);
  });
});

describe('findDuplicateGlobals', () => {
  test('mendeteksi nama yang sama di dua file', () => {
    const problems = findDuplicateGlobals([
      { file: 'a.ts', globals: ['x_', 'y_'] },
      { file: 'b.ts', globals: ['y_'] },
    ]);
    expect(problems).toEqual(['"y_" dideklarasikan di a.ts, b.ts']);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `bun test ./scripts`
Expected: FAIL — `Cannot find module './build-gas-lib'`.

- [ ] **Step 3: Implementasi `scripts/paths.ts`**

```ts
import path from 'node:path';

export const ROOT_DIR = path.resolve(import.meta.dir, '..');
export const GAS_DIR = path.join(ROOT_DIR, 'gas');
export const GAS_DIST_DIR = path.join(GAS_DIR, 'dist');
export const SHARED_DIR = path.join(ROOT_DIR, 'shared');
```

- [ ] **Step 4: Implementasi `scripts/build-gas-lib.ts`**

```ts
export const PUBLIC_GAS_FUNCTIONS: ReadonlySet<string> = new Set(['doGet', 'api', 'setup']);

export class GasBuildError extends Error {
  constructor(file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = 'GasBuildError';
  }
}

export interface TransformOptions {
  /** true untuk gas/src: fungsi global wajib berakhiran `_` kecuali PUBLIC_GAS_FUNCTIONS. */
  enforcePrivateNames: boolean;
}

export interface TransformResult {
  code: string;
  globals: string[];
}

const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'browser' });

const IMPORT_STATEMENT = /^[ \t]*import\s+(?:[\s\S]*?\s+from\s+)?['"][^'"]+['"][ \t]*;?[ \t]*$/gm;
const LOCAL_EXPORT_LIST = /^[ \t]*export\s*\{([^}]*)\}[ \t]*;?[ \t]*$/gm;
const EXPORT_KEYWORD = /^([ \t]*)export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/gm;
const TOP_LEVEL_FUNCTION = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
const TOP_LEVEL_BINDING = /^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
const FUNCTION_VALUE =
  /^(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/;

function assertSupportedSyntax(js: string, file: string): void {
  if (/^[ \t]*export\s+default\b/m.test(js)) {
    throw new GasBuildError(file, '`export default` tidak didukung di GAS');
  }
  if (/^[ \t]*export\s*(?:\*|\{[^}]*\})\s*from\b/m.test(js)) {
    throw new GasBuildError(file, 're-export dari modul lain tidak didukung di GAS');
  }
  if (/\bimport\s*\(/.test(js)) {
    throw new GasBuildError(file, 'dynamic import tidak didukung di GAS');
  }
  for (const statement of js.match(IMPORT_STATEMENT) ?? []) {
    const text = statement.trim();
    if (/\*\s*as\b/.test(text)) throw new GasBuildError(file, `namespace import tidak didukung: ${text}`);
    if (/\{[^}]*\bas\b[^}]*\}/.test(text)) throw new GasBuildError(file, `import alias tidak didukung: ${text}`);
    if (/^import\s+[A-Za-z_$][\w$]*\s*(?:,|from)/.test(text)) {
      throw new GasBuildError(file, `default import tidak didukung: ${text}`);
    }
  }
  for (const match of js.matchAll(LOCAL_EXPORT_LIST)) {
    if (/\bas\b/.test(match[1] ?? '')) {
      throw new GasBuildError(file, `export alias tidak didukung: ${match[0].trim()}`);
    }
  }
}

export function transformForGas(source: string, file: string, options: TransformOptions): TransformResult {
  const js = transpiler.transformSync(source);
  assertSupportedSyntax(js, file);

  const code = `${js
    .replace(IMPORT_STATEMENT, '')
    .replace(LOCAL_EXPORT_LIST, '')
    .replace(EXPORT_KEYWORD, '$1')
    .trim()}\n`;

  const globals: string[] = [];
  for (const line of code.split('\n')) {
    const fn = TOP_LEVEL_FUNCTION.exec(line);
    const binding = fn ? null : TOP_LEVEL_BINDING.exec(line);
    const name = fn?.[1] ?? binding?.[1];
    if (!name) continue;
    globals.push(name);
    if (!options.enforcePrivateNames || name.endsWith('_') || PUBLIC_GAS_FUNCTIONS.has(name)) continue;
    const isCallable = Boolean(fn) || FUNCTION_VALUE.test(line) || line.startsWith('class ');
    if (isCallable) {
      throw new GasBuildError(
        file,
        `fungsi global "${name}" wajib berakhiran "_" agar tidak bisa dipanggil lewat google.script.run`,
      );
    }
  }
  return { code, globals };
}

export function findDuplicateGlobals(
  files: ReadonlyArray<{ file: string; globals: readonly string[] }>,
): string[] {
  const owners = new Map<string, string[]>();
  for (const { file, globals } of files) {
    for (const name of globals) owners.set(name, [...(owners.get(name) ?? []), file]);
  }
  return [...owners]
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => `"${name}" dideklarasikan di ${list.join(', ')}`);
}
```

- [ ] **Step 5: Jalankan test**

Run: `bun test ./scripts`
Expected: PASS (9 test). Jika test pertama gagal karena format output `Bun.Transpiler` berbeda (mis. kutip tunggal/ganda), sesuaikan **assertion string**-nya saja, bukan logika transform. Jika Bun mengeluarkan daftar `export { a, b };` di akhir file, `LOCAL_EXPORT_LIST` sudah menanganinya.

- [ ] **Step 6: Implementasi CLI `scripts/build-gas.ts`**

```ts
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { findDuplicateGlobals, transformForGas } from './build-gas-lib';
import { GAS_DIR, GAS_DIST_DIR, ROOT_DIR, SHARED_DIR } from './paths';

interface SourceFile {
  absolute: string;
  output: string;
  enforcePrivateNames: boolean;
}

async function collect(dir: string, outPrefix: string, enforcePrivateNames: boolean): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for await (const relative of new Bun.Glob('**/*.ts').scan({ cwd: dir })) {
    const normalized = relative.replaceAll('\\', '/');
    if (normalized.includes('node_modules/')) continue;
    if (normalized.endsWith('.test.ts') || normalized.endsWith('.d.ts')) continue;
    files.push({
      absolute: path.join(dir, relative),
      output: path.join(GAS_DIST_DIR, outPrefix, normalized.replace(/\.ts$/, '.js')),
      enforcePrivateNames,
    });
  }
  return files.sort((a, b) => a.output.localeCompare(b.output));
}

const sources = [
  ...(await collect(path.join(GAS_DIR, 'src'), '', true)),
  ...(await collect(SHARED_DIR, 'shared', false)),
];

const results = [];
for (const source of sources) {
  const file = path.relative(ROOT_DIR, source.absolute).replaceAll('\\', '/');
  const text = await Bun.file(source.absolute).text();
  results.push({ ...source, file, ...transformForGas(text, file, { enforcePrivateNames: source.enforcePrivateNames }) });
}

const duplicates = findDuplicateGlobals(results);
if (duplicates.length > 0) {
  console.error(`build:gas gagal — nama global bentrok:\n- ${duplicates.join('\n- ')}`);
  process.exit(1);
}

await rm(GAS_DIST_DIR, { recursive: true, force: true });
await mkdir(GAS_DIST_DIR, { recursive: true });
for (const result of results) await Bun.write(result.output, result.code);
await Bun.write(path.join(GAS_DIST_DIR, 'appsscript.json'), Bun.file(path.join(GAS_DIR, 'appsscript.json')));

console.log(`build:gas selesai — ${results.length} file → ${path.relative(ROOT_DIR, GAS_DIST_DIR)}`);
```

Catatan: `build:gas` menghapus seluruh `gas/dist` lalu menulis ulang; `build:web` (Task 10) menulis `index.html` setelahnya tanpa mengosongkan folder.

- [ ] **Step 7: Typecheck & commit**

Run: `bunx tsc -p tsconfig.json` → Expected: tanpa error.

```bash
bun run format
git add scripts
git commit -m "feat(build): transpiler GAS per file dengan validasi nama global" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Core GAS — platform, error, config, sesi

**Files:**
- Create: `gas/src/core/platform.ts`, `gas/src/core/errors.ts`, `gas/src/core/email.ts`, `gas/src/core/config.ts`, `gas/src/core/session.ts`
- Create: `gas/test-support/memory-platform.ts`, `gas/test-support/errors.ts`
- Test: `gas/src/core/session.test.ts`

**Interfaces:**
- Produces (`platform.ts`): `RangeLike`, `SheetLike { getLastRow(); getLastColumn(); getRange(row, column, numRows, numColumns): RangeLike; appendRow(values); deleteRow(row) }`, `SpreadsheetLike { getSheetByName(name): SheetLike | null; insertSheet(name): SheetLike }`, `HttpResponseLike { status; body }`, `Platform` (lihat kode), `setPlatform_(p: Platform | null)`, `platform_(): Platform`.
- Produces (`errors.ts`): `interface AppError extends Error { code: ErrorCode; fields?: Record<string,string> }`, `appError_(code, message, fields?) : AppError`, `isAppError_(value): value is AppError`.
- Produces (`email.ts`): `normalizeEmail_(email): string`, `isValidEmail_(email): boolean`.
- Produces (`config.ts`): `type ConfigKey`, `REQUIRED_CONFIG_KEYS`, `requireConfig_(key): string`, `missingConfigKeys_(): ConfigKey[]`, `adminEmail_(): string` (sudah dinormalisasi; `''` bila kosong).
- Produces (`session.ts`): `SESSION_TTL_MS`, `SessionPayload { email; iat; exp }`, `signSessionToken_(email): string`, `verifySessionToken_(token: unknown): SessionPayload | null`.
- Produces (test-support): `createMemoryPlatform(options?): MemoryPlatform` dengan properti `db: MemorySpreadsheet`, `properties: Map`, `cache: Map`, `errors: string[]`, `httpCalls`; `MemorySheet` (meniru Sheets: apostrof depan → teks literal, string `=` tanpa apostrof → `'#FORMULA'`); `captureAppError(fn): AppError`.

- [ ] **Step 1: Tulis `gas/src/core/platform.ts`**

```ts
export interface RangeLike {
  getValues(): unknown[][];
  setValues(values: unknown[][]): unknown;
}

export interface SheetLike {
  getLastRow(): number;
  getLastColumn(): number;
  getRange(row: number, column: number, numRows: number, numColumns: number): RangeLike;
  appendRow(values: unknown[]): unknown;
  deleteRow(row: number): unknown;
}

export interface SpreadsheetLike {
  getSheetByName(name: string): SheetLike | null;
  insertSheet(name: string): SheetLike;
}

export interface HttpResponseLike {
  status: number;
  body: string;
}

/** Semua akses ke API GAS lewat antarmuka ini agar logika server bisa diuji tanpa GAS. */
export interface Platform {
  getProperty(key: string): string | null;
  cacheGet(key: string): string | null;
  cachePut(key: string, value: string, ttlSeconds: number): void;
  cacheRemove(key: string): void;
  hmacSha256Base64Url(data: string, secret: string): string;
  base64UrlEncode(text: string): string;
  base64UrlDecode(encoded: string): string;
  uuid(): string;
  now(): number;
  httpPostForm(url: string, form: Record<string, string>): HttpResponseLike;
  withLock<T>(fn: () => T): T;
  spreadsheet(): SpreadsheetLike;
  logError(message: string): void;
}

let currentPlatform_: Platform | null = null;

export function setPlatform_(platform: Platform | null): void {
  currentPlatform_ = platform;
}

export function platform_(): Platform {
  if (!currentPlatform_) throw new Error('Platform belum diinisialisasi');
  return currentPlatform_;
}
```

- [ ] **Step 2: Tulis `errors.ts`, `email.ts`, `config.ts`**

`gas/src/core/errors.ts`:

```ts
import type { ErrorCode } from '@shared/rpc';

export interface AppError extends Error {
  code: ErrorCode;
  fields?: Record<string, string>;
}

export function appError_(code: ErrorCode, message: string, fields?: Record<string, string>): AppError {
  const error = new Error(message) as AppError;
  error.name = 'AppError';
  error.code = code;
  if (fields) error.fields = fields;
  return error;
}

export function isAppError_(value: unknown): value is AppError {
  return (
    value instanceof Error &&
    value.name === 'AppError' &&
    typeof (value as Partial<AppError>).code === 'string'
  );
}
```

`gas/src/core/email.ts`:

```ts
const VALID_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail_(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail_(email: string): boolean {
  return VALID_EMAIL_PATTERN.test(email);
}
```

`gas/src/core/config.ts`:

```ts
import { normalizeEmail_ } from './email';
import { platform_ } from './platform';

export type ConfigKey =
  | 'SPREADSHEET_ID'
  | 'OAUTH_CLIENT_ID'
  | 'OAUTH_CLIENT_SECRET'
  | 'OAUTH_REDIRECT_URI'
  | 'SESSION_SECRET'
  | 'ADMIN_EMAIL';

export const REQUIRED_CONFIG_KEYS: readonly ConfigKey[] = [
  'SPREADSHEET_ID',
  'OAUTH_CLIENT_ID',
  'OAUTH_CLIENT_SECRET',
  'OAUTH_REDIRECT_URI',
  'SESSION_SECRET',
  'ADMIN_EMAIL',
];

export function requireConfig_(key: ConfigKey): string {
  const value = platform_().getProperty(key)?.trim();
  if (!value) throw new Error(`Script Property ${key} belum diset`);
  return value;
}

export function missingConfigKeys_(): ConfigKey[] {
  return REQUIRED_CONFIG_KEYS.filter((key) => !platform_().getProperty(key)?.trim());
}

export function adminEmail_(): string {
  return normalizeEmail_(platform_().getProperty('ADMIN_EMAIL') ?? '');
}
```

- [ ] **Step 3: Tulis memory platform — `gas/test-support/memory-platform.ts`**

```ts
import type {
  HttpResponseLike,
  Platform,
  RangeLike,
  SheetLike,
  SpreadsheetLike,
} from '@gas/core/platform';

/** Meniru Google Sheets: apostrof depan = teks literal; string "=" tanpa apostrof dievaluasi jadi formula. */
function storeCell(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value.startsWith("'")) return value.slice(1);
  if (value.startsWith('=')) return '#FORMULA';
  return value;
}

export class MemorySheet implements SheetLike {
  rows: unknown[][];

  constructor(rows: unknown[][] = []) {
    this.rows = rows;
  }

  getLastRow(): number {
    return this.rows.length;
  }

  getLastColumn(): number {
    return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
  }

  getRange(row: number, column: number, numRows: number, numColumns: number): RangeLike {
    return {
      getValues: () => {
        const out: unknown[][] = [];
        for (let r = 0; r < numRows; r++) {
          const source = this.rows[row - 1 + r] ?? [];
          const line: unknown[] = [];
          for (let c = 0; c < numColumns; c++) line.push(source[column - 1 + c] ?? '');
          out.push(line);
        }
        return out;
      },
      setValues: (values: unknown[][]) => {
        values.forEach((line, r) => {
          const index = row - 1 + r;
          while (this.rows.length <= index) this.rows.push([]);
          const target = this.rows[index] ?? [];
          line.forEach((value, c) => {
            target[column - 1 + c] = storeCell(value);
          });
          this.rows[index] = target;
        });
      },
    };
  }

  appendRow(values: unknown[]): void {
    this.rows.push(values.map(storeCell));
  }

  deleteRow(row: number): void {
    this.rows.splice(row - 1, 1);
  }
}

export class MemorySpreadsheet implements SpreadsheetLike {
  readonly sheets = new Map<string, MemorySheet>();

  getSheetByName(name: string): MemorySheet | null {
    return this.sheets.get(name) ?? null;
  }

  insertSheet(name: string): MemorySheet {
    const sheet = new MemorySheet();
    this.sheets.set(name, sheet);
    return sheet;
  }

  /** Helper test: ambil sheet yang wajib sudah ada. */
  sheet(name: string): MemorySheet {
    const found = this.sheets.get(name);
    if (!found) throw new Error(`Sheet ${name} belum ada`);
    return found;
  }
}

export interface MemoryPlatformOptions {
  properties?: Record<string, string>;
  now?: () => number;
  http?: (url: string, form: Record<string, string>) => HttpResponseLike;
}

export interface MemoryPlatform extends Platform {
  readonly db: MemorySpreadsheet;
  readonly properties: Map<string, string>;
  readonly cache: Map<string, string>;
  readonly errors: string[];
  readonly httpCalls: Array<{ url: string; form: Record<string, string> }>;
}

/** Hash non-kriptografis — HANYA untuk test & mode dev. */
function fnv1a(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function toBase64Url(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function createMemoryPlatform(options: MemoryPlatformOptions = {}): MemoryPlatform {
  const properties = new Map(Object.entries(options.properties ?? {}));
  const cache = new Map<string, string>();
  const db = new MemorySpreadsheet();
  const errors: string[] = [];
  const httpCalls: Array<{ url: string; form: Record<string, string> }> = [];
  return {
    db,
    properties,
    cache,
    errors,
    httpCalls,
    getProperty: (key) => properties.get(key) ?? null,
    cacheGet: (key) => cache.get(key) ?? null,
    cachePut: (key, value) => {
      cache.set(key, value);
    },
    cacheRemove: (key) => {
      cache.delete(key);
    },
    hmacSha256Base64Url: (data, secret) =>
      fnv1a(`${secret}|${data}`, 0x811c9dc5) + fnv1a(`${data}|${secret}`, 0x01000193),
    base64UrlEncode: toBase64Url,
    base64UrlDecode: fromBase64Url,
    uuid: randomId,
    now: options.now ?? (() => Date.now()),
    httpPostForm: (url, form) => {
      httpCalls.push({ url, form });
      if (!options.http) throw new Error('HTTP tidak dikonfigurasi di memory platform');
      return options.http(url, form);
    },
    withLock<T>(fn: () => T): T {
      return fn();
    },
    spreadsheet: () => db,
    logError: (message) => {
      errors.push(message);
    },
  };
}
```

`gas/test-support/errors.ts`:

```ts
import type { AppError } from '@gas/core/errors';
import { isAppError_ } from '@gas/core/errors';

export function captureAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (isAppError_(error)) return error;
    throw error;
  }
  throw new Error('Fungsi tidak melempar AppError');
}
```

- [ ] **Step 4: Tulis test yang gagal — `gas/src/core/session.test.ts`**

```ts
import { beforeEach, expect, test } from 'bun:test';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { platform_, setPlatform_ } from './platform';
import { SESSION_TTL_MS, signSessionToken_, verifySessionToken_ } from './session';

let now = 1_700_000_000_000;

beforeEach(() => {
  now = 1_700_000_000_000;
  setPlatform_(createMemoryPlatform({ properties: { SESSION_SECRET: 'rahasia-uji' }, now: () => now }));
});

test('token baru valid dan berisi email', () => {
  const token = signSessionToken_('budi@gmail.com');
  expect(verifySessionToken_(token)?.email).toBe('budi@gmail.com');
});

test('token kedaluwarsa ditolak', () => {
  const token = signSessionToken_('budi@gmail.com');
  now += SESSION_TTL_MS + 1;
  expect(verifySessionToken_(token)).toBeNull();
});

test('payload yang dipalsukan ditolak', () => {
  const [, signature] = signSessionToken_('budi@gmail.com').split('.');
  const forgedBody = platform_().base64UrlEncode(
    JSON.stringify({ email: 'admin@gmail.com', iat: now, exp: now + SESSION_TTL_MS }),
  );
  expect(verifySessionToken_(`${forgedBody}.${signature}`)).toBeNull();
});

test('token bertanda tangan secret lain ditolak', () => {
  const token = signSessionToken_('budi@gmail.com');
  setPlatform_(createMemoryPlatform({ properties: { SESSION_SECRET: 'secret-baru' }, now: () => now }));
  expect(verifySessionToken_(token)).toBeNull();
});

test('input yang bukan token ditolak', () => {
  for (const value of [null, undefined, '', 'abc', 'a.b.c', 123, '.x', 'x.']) {
    expect(verifySessionToken_(value)).toBeNull();
  }
});

test('SESSION_SECRET kosong menyebabkan error saat membuat token', () => {
  setPlatform_(createMemoryPlatform());
  expect(() => signSessionToken_('budi@gmail.com')).toThrow(/SESSION_SECRET/);
});
```

- [ ] **Step 5: Jalankan test, pastikan gagal**

Run: `bun run --cwd gas test`
Expected: FAIL — `Cannot find module './session'`.

- [ ] **Step 6: Implementasi `gas/src/core/session.ts`**

```ts
import { requireConfig_ } from './config';
import { platform_ } from './platform';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  email: string;
  iat: number;
  exp: number;
}

export function signSessionToken_(email: string): string {
  const platform = platform_();
  const now = platform.now();
  const payload: SessionPayload = { email, iat: now, exp: now + SESSION_TTL_MS };
  const body = platform.base64UrlEncode(JSON.stringify(payload));
  return `${body}.${platform.hmacSha256Base64Url(body, requireConfig_('SESSION_SECRET'))}`;
}

export function verifySessionToken_(token: unknown): SessionPayload | null {
  if (typeof token !== 'string') return null;
  const [body, signature, ...rest] = token.split('.');
  if (!body || !signature || rest.length > 0) return null;
  const platform = platform_();
  const expected = platform.hmacSha256Base64Url(body, requireConfig_('SESSION_SECRET'));
  if (!safeEqual_(signature, expected)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(platform.base64UrlDecode(body));
  } catch {
    return null;
  }
  if (!isSessionPayload_(payload) || payload.exp <= platform.now()) return null;
  return payload;
}

function isSessionPayload_(value: unknown): value is SessionPayload {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.email === 'string' &&
    record.email !== '' &&
    typeof record.iat === 'number' &&
    typeof record.exp === 'number'
  );
}

/** Perbandingan waktu-konstan agar tanda tangan tidak bisa ditebak lewat timing. */
function safeEqual_(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
```

- [ ] **Step 7: Jalankan test & typecheck**

Run: `bun run --cwd gas test` → Expected: PASS (6 test).
Run: `bun run --cwd gas typecheck` → Expected: tanpa error.

- [ ] **Step 8: Commit**

```bash
bun run format
git add gas/src/core gas/test-support
git commit -m "feat(gas): platform abstraction, config, dan token sesi HMAC" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Repository tabel berbasis header (`core/db`)

**Files:**
- Create: `gas/src/core/db.ts`
- Test: `gas/src/core/db.test.ts`

**Interfaces:**
- Consumes: `platform_()`, `SheetLike` (Task 4); `createMemoryPlatform`, `MemorySheet` (Task 4).
- Produces: `TableSchema { sheetName; columns }`, `RowData = Record<string,string>`, `StoredRow { rowNumber; data }`, `cellToString_(v): string`, `toCell_(v: string): string`, `openTable_(schema): { sheet: SheetLike; header: string[] }`, `readTable_(schema): { header: string[]; rows: StoredRow[] }`, `insertRow_(schema, data)`, `updateRow_(schema, rowNumber, data)` (hanya kolom yang ada di `data` yang diubah), `deleteRow_(schema, rowNumber)`.
- Aturan: pemanggil yang menulis berdasarkan `rowNumber` wajib membaca dan menulis di dalam `platform_().withLock(...)` yang sama.

- [ ] **Step 1: Tulis test yang gagal — `gas/src/core/db.test.ts`**

```ts
import { beforeEach, expect, test } from 'bun:test';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { deleteRow_, insertRow_, readTable_, updateRow_ } from './db';
import type { TableSchema } from './db';
import { setPlatform_ } from './platform';

const TABLE: TableSchema = { sheetName: 'things', columns: ['id', 'name', 'note'] };
let platform: MemoryPlatform;

beforeEach(() => {
  platform = createMemoryPlatform();
  setPlatform_(platform);
});

test('membuat sheet beserta header bila belum ada', () => {
  expect(readTable_(TABLE).rows).toEqual([]);
  expect(platform.db.sheet('things').rows).toEqual([['id', 'name', 'note']]);
});

test('menambah kolom yang hilang tanpa mengganggu kolom lama dan kolom manual', () => {
  platform.db.insertSheet('things').rows = [
    ['name', 'manual', 'id'],
    ['Budi', 'x', '1'],
  ];
  const table = readTable_(TABLE);
  expect(table.header).toEqual(['name', 'manual', 'id', 'note']);
  expect(table.rows).toEqual([{ rowNumber: 2, data: { name: 'Budi', manual: 'x', id: '1', note: '' } }]);
});

test('membaca berdasarkan nama header, melewati baris kosong, dan mengubah sel menjadi string', () => {
  platform.db.insertSheet('things').rows = [
    ['note', 'id', 'name'],
    ['', '', ''],
    ['catatan', 7, 'Ani'],
    [new Date('2026-01-02T03:04:05.000Z'), 'b', 'Budi'],
  ];
  expect(readTable_(TABLE).rows).toEqual([
    { rowNumber: 3, data: { note: 'catatan', id: '7', name: 'Ani' } },
    { rowNumber: 4, data: { note: '2026-01-02T03:04:05.000Z', id: 'b', name: 'Budi' } },
  ]);
});

test('insertRow_ menyimpan teks berawalan = + - @ sebagai teks literal', () => {
  insertRow_(TABLE, { id: '1', name: '=SUM(A1:A2)', note: '@budi' });
  insertRow_(TABLE, { id: '2', name: '+62812', note: '-5' });
  expect(readTable_(TABLE).rows.map((row) => row.data)).toEqual([
    { id: '1', name: '=SUM(A1:A2)', note: '@budi' },
    { id: '2', name: '+62812', note: '-5' },
  ]);
});

test('updateRow_ hanya mengubah kolom yang diberikan dan tetap menjaga teks berbahaya di kolom lain', () => {
  insertRow_(TABLE, { id: '1', name: '=1+1', note: 'lama' });
  updateRow_(TABLE, 2, { note: 'baru' });
  expect(readTable_(TABLE).rows[0]?.data).toEqual({ id: '1', name: '=1+1', note: 'baru' });
});

test('deleteRow_ menghapus baris', () => {
  insertRow_(TABLE, { id: '1', name: 'A', note: '' });
  insertRow_(TABLE, { id: '2', name: 'B', note: '' });
  deleteRow_(TABLE, 2);
  expect(readTable_(TABLE).rows.map((row) => row.data.id)).toEqual(['2']);
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `bun run --cwd gas test db`
Expected: FAIL — `Cannot find module './db'`.

- [ ] **Step 3: Implementasi `gas/src/core/db.ts`**

```ts
import type { SheetLike } from './platform';
import { platform_ } from './platform';

export interface TableSchema {
  readonly sheetName: string;
  readonly columns: readonly string[];
}

export type RowData = Record<string, string>;

export interface StoredRow {
  rowNumber: number;
  data: RowData;
}

export function cellToString_(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Cegah formula injection: teks diawali = + - @ diberi apostrof agar Sheets menyimpannya sebagai teks. */
export function toCell_(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function readHeader_(sheet: SheetLike): string[] {
  const width = sheet.getLastColumn();
  if (width === 0) return [];
  const first = sheet.getRange(1, 1, 1, width).getValues()[0] ?? [];
  return first.map((value) => cellToString_(value).trim());
}

/** Buka (atau buat) sheet dan pastikan semua kolom skema ada di header. */
export function openTable_(schema: TableSchema): { sheet: SheetLike; header: string[] } {
  const spreadsheet = platform_().spreadsheet();
  const sheet = spreadsheet.getSheetByName(schema.sheetName) ?? spreadsheet.insertSheet(schema.sheetName);
  const header = sheet.getLastRow() === 0 ? [] : readHeader_(sheet);
  const missing = schema.columns.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
    header.push(...missing);
  }
  return { sheet, header };
}

export function readTable_(schema: TableSchema): { header: string[]; rows: StoredRow[] } {
  const { sheet, header } = openTable_(schema);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { header, rows: [] };
  const values = sheet.getRange(2, 1, lastRow - 1, header.length).getValues();
  const rows: StoredRow[] = [];
  values.forEach((line, index) => {
    if (line.every((value) => cellToString_(value).trim() === '')) return;
    const data: RowData = {};
    header.forEach((name, column) => {
      if (name) data[name] = cellToString_(line[column]);
    });
    rows.push({ rowNumber: index + 2, data });
  });
  return { header, rows };
}

export function insertRow_(schema: TableSchema, data: RowData): void {
  const { sheet, header } = openTable_(schema);
  sheet.appendRow(header.map((name) => toCell_(data[name] ?? '')));
}

export function updateRow_(schema: TableSchema, rowNumber: number, data: RowData): void {
  const { sheet, header } = openTable_(schema);
  const range = sheet.getRange(rowNumber, 1, 1, header.length);
  const current = range.getValues()[0] ?? [];
  const next = header.map((name, column) => {
    if (name && Object.prototype.hasOwnProperty.call(data, name)) return toCell_(data[name] ?? '');
    const existing = current[column];
    return typeof existing === 'string' ? toCell_(existing) : (existing ?? '');
  });
  range.setValues([next]);
}

export function deleteRow_(schema: TableSchema, rowNumber: number): void {
  openTable_(schema).sheet.deleteRow(rowNumber);
}
```

- [ ] **Step 4: Jalankan test**

Run: `bun run --cwd gas test db` → Expected: PASS (6 test).

- [ ] **Step 5: Commit**

```bash
bun run format
git add gas/src/core/db.ts gas/src/core/db.test.ts
git commit -m "feat(gas): repository sheet berbasis header dengan proteksi formula" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Repository akses & konteks user

**Files:**
- Create: `gas/src/modules/access/repo.ts`, `gas/src/modules/access/context.ts`
- Create: `gas/test-support/access-fixtures.ts`
- Test: `gas/src/modules/access/context.test.ts`

**Interfaces:**
- Consumes: `readTable_`, `insertRow_`, `updateRow_`, `deleteRow_`, `TableSchema`, `RowData` (Task 5); `normalizeEmail_`, `adminEmail_`, `platform_` (Task 4); `sanitizePermissions`, `mergePermissions`, `fullPermissions`, `PartialPermissionMap`, `PermissionMap` (Task 2).
- Produces (`repo.ts`): `USERS_TABLE`, `ROLES_TABLE`, `AUDIT_TABLE`; `UserRecord`, `NewUserRecord = Omit<UserRecord,'rowNumber'>`, `RoleRecord`, `NewRoleRecord`, `AuditEntry`; `listUsers_()`, `findUserByEmail_(email)`, `insertUser_(user: NewUserRecord)`, `updateUser_(user: UserRecord)`, `listRoles_()`, `insertRole_(role: NewRoleRecord)`, `updateRole_(role: RoleRecord)`, `deleteRole_(role: RoleRecord)`, `appendAudit_(entry: AuditEntry)`.
- Produces (`context.ts`): `UserContext { email; name; userId: string | null; isSuperAdmin; permissions: PermissionMap }`, `USER_CONTEXT_TTL_SECONDS = 300`, `loadUserContext_(email): UserContext | null` (ter-cache), `computeUserContext_(email)`, `invalidateAccessCache_()`.
- Produces (test-support): `role(overrides)`, `user(overrides)` yang mengembalikan `NewRoleRecord`/`NewUserRecord` dengan default.

- [ ] **Step 1: Implementasi `gas/src/modules/access/repo.ts`**

```ts
import type { PartialPermissionMap } from '@shared/permissions';
import { sanitizePermissions } from '@shared/permissions';
import type { UserStatus } from '@shared/rpc';
import type { RowData, TableSchema } from '@gas/core/db';
import { deleteRow_, insertRow_, readTable_, updateRow_ } from '@gas/core/db';
import { normalizeEmail_ } from '@gas/core/email';

export const USERS_TABLE: TableSchema = {
  sheetName: 'users',
  columns: ['id', 'email', 'name', 'status', 'role_ids', 'created_at', 'updated_at', 'updated_by'],
};

export const ROLES_TABLE: TableSchema = {
  sheetName: 'roles',
  columns: ['id', 'name', 'description', 'permissions', 'created_at', 'updated_at', 'updated_by'],
};

export const AUDIT_TABLE: TableSchema = {
  sheetName: 'audit_log',
  columns: ['ts', 'actor', 'action', 'target', 'detail'],
};

export interface UserRecord {
  rowNumber: number;
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  roleIds: string[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewUserRecord = Omit<UserRecord, 'rowNumber'>;

export interface RoleRecord {
  rowNumber: number;
  id: string;
  name: string;
  description: string;
  permissions: PartialPermissionMap;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewRoleRecord = Omit<RoleRecord, 'rowNumber'>;

export interface AuditEntry {
  ts: string;
  actor: string;
  action: string;
  target: string;
  detail: unknown;
}

function parseJson_(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseStringArray_(text: string): string[] {
  const value = parseJson_(text);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toUserRecord_(rowNumber: number, data: RowData): UserRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    email: normalizeEmail_(data.email ?? ''),
    name: (data.name ?? '').trim(),
    status: (data.status ?? '').trim() === 'active' ? 'active' : 'inactive',
    roleIds: parseStringArray_(data.role_ids ?? ''),
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
    role_ids: JSON.stringify(user.roleIds),
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    updated_by: user.updatedBy,
  };
}

function toRoleRecord_(rowNumber: number, data: RowData): RoleRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    name: (data.name ?? '').trim(),
    description: data.description ?? '',
    permissions: sanitizePermissions(parseJson_(data.permissions ?? '')),
    createdAt: data.created_at ?? '',
    updatedAt: data.updated_at ?? '',
    updatedBy: data.updated_by ?? '',
  };
}

function fromRoleRecord_(role: NewRoleRecord): RowData {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: JSON.stringify(role.permissions),
    created_at: role.createdAt,
    updated_at: role.updatedAt,
    updated_by: role.updatedBy,
  };
}

export function listUsers_(): UserRecord[] {
  return readTable_(USERS_TABLE)
    .rows.map(({ rowNumber, data }) => toUserRecord_(rowNumber, data))
    .filter((user) => user.id !== '' && user.email !== '');
}

export function findUserByEmail_(email: string): UserRecord | null {
  const target = normalizeEmail_(email);
  return listUsers_().find((user) => user.email === target) ?? null;
}

export function insertUser_(user: NewUserRecord): void {
  insertRow_(USERS_TABLE, fromUserRecord_(user));
}

export function updateUser_(user: UserRecord): void {
  updateRow_(USERS_TABLE, user.rowNumber, fromUserRecord_(user));
}

export function listRoles_(): RoleRecord[] {
  return readTable_(ROLES_TABLE)
    .rows.map(({ rowNumber, data }) => toRoleRecord_(rowNumber, data))
    .filter((role) => role.id !== '');
}

export function insertRole_(role: NewRoleRecord): void {
  insertRow_(ROLES_TABLE, fromRoleRecord_(role));
}

export function updateRole_(role: RoleRecord): void {
  updateRow_(ROLES_TABLE, role.rowNumber, fromRoleRecord_(role));
}

export function deleteRole_(role: RoleRecord): void {
  deleteRow_(ROLES_TABLE, role.rowNumber);
}

export function appendAudit_(entry: AuditEntry): void {
  insertRow_(AUDIT_TABLE, {
    ts: entry.ts,
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    detail: JSON.stringify(entry.detail ?? null),
  });
}
```

- [ ] **Step 2: Tulis fixture — `gas/test-support/access-fixtures.ts`**

```ts
import type { NewRoleRecord, NewUserRecord } from '@gas/modules/access/repo';

const SEED_TIME = '2026-01-01T00:00:00.000Z';

export function role(overrides: Partial<NewRoleRecord> & Pick<NewRoleRecord, 'id' | 'name'>): NewRoleRecord {
  return {
    description: '',
    permissions: {},
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    updatedBy: 'seed',
    ...overrides,
  };
}

export function user(overrides: Partial<NewUserRecord> & Pick<NewUserRecord, 'id' | 'email'>): NewUserRecord {
  return {
    name: overrides.email,
    status: 'active',
    roleIds: [],
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    updatedBy: 'seed',
    ...overrides,
  };
}
```

- [ ] **Step 3: Tulis test yang gagal — `gas/src/modules/access/context.test.ts`**

```ts
import { beforeEach, expect, test } from 'bun:test';
import { fullPermissions } from '@shared/permissions';
import { role, user } from '@gas-test/access-fixtures';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { setPlatform_ } from '@gas/core/platform';
import { invalidateAccessCache_, loadUserContext_ } from './context';
import { insertRole_, insertUser_, listUsers_, updateUser_ } from './repo';

let platform: MemoryPlatform;

beforeEach(() => {
  platform = createMemoryPlatform({ properties: { ADMIN_EMAIL: ' Admin@Gmail.com ' } });
  setPlatform_(platform);
  insertRole_(role({ id: 'r-view', name: 'Viewer', permissions: { item: 'view', handover: 'edit' } }));
  insertRole_(role({ id: 'r-manage', name: 'Manager', permissions: { item: 'manage' } }));
  insertUser_(user({ id: 'u1', email: 'budi@gmail.com', name: 'Budi', roleIds: ['r-view', 'r-manage'] }));
  insertUser_(user({ id: 'u2', email: 'nonaktif@gmail.com', status: 'inactive', roleIds: ['r-manage'] }));
});

test('ADMIN_EMAIL menjadi super admin dengan manage di semua modul, tidak peka huruf besar/spasi', () => {
  const ctx = loadUserContext_('ADMIN@gmail.com');
  expect(ctx).toMatchObject({ email: 'admin@gmail.com', isSuperAdmin: true, userId: null });
  expect(ctx?.permissions).toEqual(fullPermissions());
});

test('super admin tetap bisa masuk walau sheet users belum ada', () => {
  setPlatform_(createMemoryPlatform({ properties: { ADMIN_EMAIL: 'admin@gmail.com' } }));
  expect(loadUserContext_('admin@gmail.com')?.isSuperAdmin).toBe(true);
});

test('user aktif mendapat level tertinggi dari semua role-nya', () => {
  const ctx = loadUserContext_(' Budi@Gmail.com ');
  expect(ctx?.name).toBe('Budi');
  expect(ctx?.permissions).toEqual({ access: 'none', item: 'manage', handover: 'edit', stock: 'none' });
});

test('user nonaktif dan email tak terdaftar ditolak', () => {
  expect(loadUserContext_('nonaktif@gmail.com')).toBeNull();
  expect(loadUserContext_('asing@gmail.com')).toBeNull();
  expect(loadUserContext_('')).toBeNull();
});

test('JSON role_ids/permissions yang rusak dan level asing diabaikan tanpa error', () => {
  platform.db.sheet('roles').rows.push(['r-rusak', 'Rusak', '', '{"item":"superuser","stock":"view"}', '', '', '']);
  platform.db.sheet('roles').rows.push(['r-json', 'Json Rusak', '', '{"item":', '', '', '']);
  platform.db.sheet('users').rows.push(['u3', 'rusak@gmail.com', 'Rusak', 'active', 'bukan-json', '', '', '']);
  platform.db.sheet('users').rows.push(['u4', 'campur@gmail.com', 'Campur', 'active', '["r-rusak","r-json"]', '', '', '']);
  expect(loadUserContext_('rusak@gmail.com')?.permissions).toEqual({
    access: 'none',
    item: 'none',
    handover: 'none',
    stock: 'none',
  });
  expect(loadUserContext_('campur@gmail.com')?.permissions.stock).toBe('view');
  expect(loadUserContext_('campur@gmail.com')?.permissions.item).toBe('none');
});

test('hasil di-cache dan diperbarui setelah invalidateAccessCache_', () => {
  expect(loadUserContext_('budi@gmail.com')).not.toBeNull();
  const budi = listUsers_().find((record) => record.id === 'u1');
  if (!budi) throw new Error('fixture hilang');
  updateUser_({ ...budi, status: 'inactive' });
  expect(loadUserContext_('budi@gmail.com')).not.toBeNull();
  invalidateAccessCache_();
  expect(loadUserContext_('budi@gmail.com')).toBeNull();
});
```

- [ ] **Step 4: Jalankan test, pastikan gagal**

Run: `bun run --cwd gas test context`
Expected: FAIL — `Cannot find module './context'`.

- [ ] **Step 5: Implementasi `gas/src/modules/access/context.ts`**

```ts
import type { PermissionMap } from '@shared/permissions';
import { fullPermissions, mergePermissions } from '@shared/permissions';
import { adminEmail_ } from '@gas/core/config';
import { normalizeEmail_ } from '@gas/core/email';
import { platform_ } from '@gas/core/platform';
import { findUserByEmail_, listRoles_ } from './repo';

export interface UserContext {
  email: string;
  name: string;
  userId: string | null;
  isSuperAdmin: boolean;
  permissions: PermissionMap;
}

export const USER_CONTEXT_TTL_SECONDS = 300;
const ACCESS_VERSION_KEY = 'access:version';
const ACCESS_VERSION_TTL_SECONDS = 21600;

/** Versi cache akses; mengganti versi membuat semua konteks lama tidak terpakai lagi. */
function accessVersion_(): string {
  const platform = platform_();
  const current = platform.cacheGet(ACCESS_VERSION_KEY);
  if (current) return current;
  const next = platform.uuid();
  platform.cachePut(ACCESS_VERSION_KEY, next, ACCESS_VERSION_TTL_SECONDS);
  return next;
}

export function invalidateAccessCache_(): void {
  const platform = platform_();
  platform.cachePut(ACCESS_VERSION_KEY, platform.uuid(), ACCESS_VERSION_TTL_SECONDS);
}

export function computeUserContext_(email: string): UserContext | null {
  const record = findUserByEmail_(email);
  const admin = adminEmail_();
  if (admin !== '' && email === admin) {
    return {
      email,
      name: record?.name || email,
      userId: record?.id ?? null,
      isSuperAdmin: true,
      permissions: fullPermissions(),
    };
  }
  if (!record || record.status !== 'active') return null;
  const roleIds = new Set(record.roleIds);
  const roles = listRoles_().filter((role) => roleIds.has(role.id));
  return {
    email,
    name: record.name || email,
    userId: record.id,
    isSuperAdmin: false,
    permissions: mergePermissions(roles.map((role) => role.permissions)),
  };
}

export function loadUserContext_(rawEmail: string): UserContext | null {
  const email = normalizeEmail_(rawEmail);
  if (email === '') return null;
  const platform = platform_();
  const key = `uctx:${accessVersion_()}:${email}`;
  const cached = platform.cacheGet(key);
  if (cached !== null) return cached === 'null' ? null : (JSON.parse(cached) as UserContext);
  const context = computeUserContext_(email);
  platform.cachePut(key, context ? JSON.stringify(context) : 'null', USER_CONTEXT_TTL_SECONDS);
  return context;
}
```

- [ ] **Step 6: Jalankan test & typecheck**

Run: `bun run --cwd gas test` → Expected: semua PASS.
Run: `bun run --cwd gas typecheck` → Expected: tanpa error.

- [ ] **Step 7: Commit**

```bash
bun run format
git add gas/src/modules/access gas/test-support/access-fixtures.ts
git commit -m "feat(gas): repository user/role dan konteks akses ter-cache" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Validasi input & router RPC

**Files:**
- Create: `gas/src/core/validate.ts`, `gas/src/core/router.ts`, `gas/src/modules/auth/routes.ts`
- Test: `gas/src/core/router.test.ts`

**Interfaces:**
- Consumes: `appError_`, `isAppError_` (Task 4), `verifySessionToken_` (Task 4), `loadUserContext_`, `UserContext` (Task 6), `hasLevel` (Task 2), tipe `RpcMethod/RpcInput/RpcOutput/RpcResult/RpcErrorBody` (Task 2).
- Produces (`validate.ts`): `ObjectReader { str(key, opts?: { required?: boolean; max?: number }): string; email(key): string; oneOf<T extends string>(key, allowed: readonly T[]): T; stringArray(key): string[]; optionalId(key): string | undefined; raw(key): unknown; fail(key, message): void; done(): void }`, `readObject_(input: unknown): ObjectReader`, `expectNull_(input: unknown): null`.
- Produces (`router.ts`): `RequestContext { requestId: string; user: UserContext }`, `RouteDef<M> { permission?: { module: ModuleKey; level: Level }; validate(raw: unknown): RpcInput<M>; handler(input: RpcInput<M>, ctx: RequestContext): RpcOutput<M> }`, `RouteTable = { [M in RpcMethod]: RouteDef<M> }`, `handleRpc_(method: unknown, payloadJson: unknown, token: unknown, routes: RouteTable): RpcResult<unknown>`.
- Produces (`auth/routes.ts`): `authRoutes_(): Pick<RouteTable, 'auth.me'>`.

- [ ] **Step 1: Implementasi `gas/src/core/validate.ts`**

```ts
import { isValidEmail_, normalizeEmail_ } from './email';
import { appError_ } from './errors';

export interface ObjectReader {
  str(key: string, options?: { required?: boolean; max?: number }): string;
  email(key: string): string;
  oneOf<T extends string>(key: string, allowed: readonly T[]): T;
  stringArray(key: string): string[];
  optionalId(key: string): string | undefined;
  raw(key: string): unknown;
  fail(key: string, message: string): void;
  /** Lempar VALIDATION berisi semua error field yang terkumpul. */
  done(): void;
}

export function readObject_(input: unknown): ObjectReader {
  const isObject = Boolean(input) && typeof input === 'object' && !Array.isArray(input);
  const source: Record<string, unknown> = isObject ? (input as Record<string, unknown>) : {};
  const fields: Record<string, string> = {};
  if (!isObject) fields._ = 'Input harus berupa objek';

  const reader: ObjectReader = {
    str(key, options = {}) {
      const value = source[key];
      if (value !== undefined && value !== null && typeof value !== 'string') {
        fields[key] = 'Harus berupa teks';
        return '';
      }
      const text = typeof value === 'string' ? value.trim() : '';
      if (options.required && text === '') fields[key] = 'Wajib diisi';
      else if (options.max !== undefined && text.length > options.max) {
        fields[key] = `Maksimal ${options.max} karakter`;
      }
      return text;
    },
    email(key) {
      const text = normalizeEmail_(reader.str(key, { required: true, max: 254 }));
      if (text !== '' && !fields[key] && !isValidEmail_(text)) fields[key] = 'Format email tidak valid';
      return text;
    },
    oneOf<T extends string>(key: string, allowed: readonly T[]): T {
      const value = source[key];
      const match = allowed.find((item) => item === value);
      if (match !== undefined) return match;
      fields[key] = 'Nilai tidak valid';
      return allowed[0] as T;
    },
    stringArray(key) {
      const value = source[key];
      if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
        fields[key] = 'Harus berupa daftar teks';
        return [];
      }
      return [...new Set(value as string[])];
    },
    optionalId(key) {
      const value = source[key];
      if (value === undefined || value === null || value === '') return undefined;
      if (typeof value !== 'string') {
        fields[key] = 'ID tidak valid';
        return undefined;
      }
      return value;
    },
    raw(key) {
      return source[key];
    },
    fail(key, message) {
      fields[key] = message;
    },
    done() {
      if (Object.keys(fields).length > 0) throw appError_('VALIDATION', 'Input tidak valid', { ...fields });
    },
  };
  return reader;
}

export function expectNull_(input: unknown): null {
  if (input !== null && input !== undefined) throw appError_('VALIDATION', 'Method ini tidak menerima input');
  return null;
}
```

- [ ] **Step 2: Tulis test yang gagal — `gas/src/core/router.test.ts`**

```ts
import { beforeEach, expect, test } from 'bun:test';
import type { RpcResult } from '@shared/rpc';
import { role, user } from '@gas-test/access-fixtures';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { invalidateAccessCache_ } from '@gas/modules/access/context';
import { insertRole_, insertUser_, listUsers_, updateUser_ } from '@gas/modules/access/repo';
import { appError_ } from './errors';
import { setPlatform_ } from './platform';
import { handleRpc_ } from './router';
import type { RequestContext, RouteTable } from './router';
import { signSessionToken_ } from './session';
import { expectNull_ } from './validate';

let platform: MemoryPlatform;
let calls: string[];

const routes = {
  'auth.me': {
    validate: expectNull_,
    handler: (_input: unknown, ctx: RequestContext) => {
      calls.push('me');
      return { email: ctx.user.email };
    },
  },
  'access.users.list': {
    permission: { module: 'access', level: 'view' },
    validate: expectNull_,
    handler: () => {
      calls.push('list');
      return [];
    },
  },
  'access.users.save': {
    permission: { module: 'access', level: 'manage' },
    validate: (raw: unknown) => {
      if (raw === null) throw appError_('VALIDATION', 'Input tidak valid', { email: 'Wajib diisi' });
      return raw;
    },
    handler: () => {
      throw new Error('rahasia internal di stack');
    },
  },
} as unknown as RouteTable;

function errorOf(result: RpcResult<unknown>) {
  if (result.ok) throw new Error(`Diharapkan error, didapat ${JSON.stringify(result.data)}`);
  return result.error;
}

beforeEach(() => {
  calls = [];
  platform = createMemoryPlatform({ properties: { SESSION_SECRET: 's', ADMIN_EMAIL: 'admin@gmail.com' } });
  setPlatform_(platform);
  insertRole_(role({ id: 'r-view', name: 'Viewer', permissions: { access: 'view' } }));
  insertUser_(user({ id: 'u1', email: 'viewer@gmail.com', roleIds: ['r-view'] }));
  insertUser_(user({ id: 'u2', email: 'plain@gmail.com' }));
});

test('method tak dikenal, termasuk nama properti bawaan objek, menghasilkan NOT_FOUND', () => {
  const token = signSessionToken_('admin@gmail.com');
  for (const method of ['x.y', '__proto__', 'constructor', 'toString', 42]) {
    expect(errorOf(handleRpc_(method, 'null', token, routes)).code).toBe('NOT_FOUND');
  }
});

test('tanpa token atau token rusak menghasilkan UNAUTHENTICATED', () => {
  for (const token of [undefined, '', 'abc', 'a.b', 123]) {
    expect(errorOf(handleRpc_('auth.me', 'null', token, routes)).code).toBe('UNAUTHENTICATED');
  }
  expect(calls).toEqual([]);
});

test('token valid milik user yang lalu dinonaktifkan menghasilkan UNAUTHENTICATED', () => {
  const token = signSessionToken_('viewer@gmail.com');
  expect(handleRpc_('auth.me', 'null', token, routes).ok).toBe(true);
  const viewer = listUsers_().find((record) => record.id === 'u1');
  if (!viewer) throw new Error('fixture hilang');
  updateUser_({ ...viewer, status: 'inactive' });
  invalidateAccessCache_();
  expect(errorOf(handleRpc_('auth.me', 'null', token, routes)).code).toBe('UNAUTHENTICATED');
});

test('level kurang menghasilkan FORBIDDEN dan handler tidak dipanggil', () => {
  const token = signSessionToken_('plain@gmail.com');
  expect(errorOf(handleRpc_('access.users.list', 'null', token, routes)).code).toBe('FORBIDDEN');
  expect(calls).toEqual([]);
});

test('payload bukan JSON menghasilkan VALIDATION', () => {
  const token = signSessionToken_('admin@gmail.com');
  expect(errorOf(handleRpc_('auth.me', '{rusak', token, routes)).code).toBe('VALIDATION');
});

test('error validasi membawa daftar field', () => {
  const token = signSessionToken_('admin@gmail.com');
  const error = errorOf(handleRpc_('access.users.save', 'null', token, routes));
  expect(error).toMatchObject({ code: 'VALIDATION', fields: { email: 'Wajib diisi' } });
});

test('error tak terduga disamarkan menjadi INTERNAL dan dicatat bersama requestId', () => {
  const token = signSessionToken_('admin@gmail.com');
  const error = errorOf(handleRpc_('access.users.save', '{"a":1}', token, routes));
  expect(error.code).toBe('INTERNAL');
  expect(error.message).toBe('Terjadi kesalahan pada server');
  expect(error.message).not.toContain('rahasia');
  expect(error.requestId).toHaveLength(8);
  expect(platform.errors[0]).toContain(error.requestId);
  expect(platform.errors[0]).toContain('rahasia internal');
});

test('request sukses mengembalikan data dan meneruskan konteks user', () => {
  const token = signSessionToken_('viewer@gmail.com');
  expect(handleRpc_('access.users.list', 'null', token, routes)).toEqual({ ok: true, data: [] });
  expect(handleRpc_('auth.me', '', token, routes)).toEqual({ ok: true, data: { email: 'viewer@gmail.com' } });
  expect(calls).toEqual(['list', 'me']);
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `bun run --cwd gas test router`
Expected: FAIL — `Cannot find module './router'`.

- [ ] **Step 4: Implementasi `gas/src/core/router.ts`**

```ts
import type { Level, ModuleKey } from '@shared/permissions';
import { hasLevel } from '@shared/permissions';
import type { RpcErrorBody, RpcInput, RpcMethod, RpcOutput, RpcResult } from '@shared/rpc';
import type { UserContext } from '@gas/modules/access/context';
import { loadUserContext_ } from '@gas/modules/access/context';
import { appError_, isAppError_ } from './errors';
import { platform_ } from './platform';
import { verifySessionToken_ } from './session';

export interface RequestContext {
  requestId: string;
  user: UserContext;
}

export interface RouteDef<M extends RpcMethod = RpcMethod> {
  /** Tanpa `permission` = cukup login. */
  permission?: { module: ModuleKey; level: Level };
  validate: (raw: unknown) => RpcInput<M>;
  handler: (input: RpcInput<M>, ctx: RequestContext) => RpcOutput<M>;
}

export type RouteTable = { [M in RpcMethod]: RouteDef<M> };

export function handleRpc_(
  method: unknown,
  payloadJson: unknown,
  token: unknown,
  routes: RouteTable,
): RpcResult<unknown> {
  const requestId = platform_().uuid().replace(/-/g, '').slice(0, 8);
  try {
    if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(routes, method)) {
      throw appError_('NOT_FOUND', 'Method tidak dikenal');
    }
    const route = routes[method as RpcMethod] as unknown as RouteDef<RpcMethod>;

    const session = verifySessionToken_(token);
    if (!session) throw appError_('UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir');
    const user = loadUserContext_(session.email);
    if (!user) throw appError_('UNAUTHENTICATED', 'Akun tidak aktif atau tidak terdaftar');
    if (route.permission && !hasLevel(user.permissions[route.permission.module], route.permission.level)) {
      throw appError_('FORBIDDEN', 'Anda tidak memiliki akses untuk aksi ini');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(typeof payloadJson === 'string' && payloadJson !== '' ? payloadJson : 'null');
    } catch {
      throw appError_('VALIDATION', 'Payload bukan JSON yang valid');
    }

    const data = route.handler(route.validate(raw), { requestId, user });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toErrorBody_(error, requestId) };
  }
}

function toErrorBody_(error: unknown, requestId: string): RpcErrorBody {
  if (isAppError_(error)) {
    return {
      code: error.code,
      message: error.message,
      requestId,
      ...(error.fields ? { fields: error.fields } : {}),
    };
  }
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  platform_().logError(`[${requestId}] ${detail}`);
  return { code: 'INTERNAL', message: 'Terjadi kesalahan pada server', requestId };
}
```

- [ ] **Step 5: Implementasi `gas/src/modules/auth/routes.ts`**

```ts
import type { RouteTable } from '@gas/core/router';
import { expectNull_ } from '@gas/core/validate';

export function authRoutes_(): Pick<RouteTable, 'auth.me'> {
  return {
    'auth.me': {
      validate: expectNull_,
      handler: (_input, ctx) => ({
        email: ctx.user.email,
        name: ctx.user.name,
        isSuperAdmin: ctx.user.isSuperAdmin,
        permissions: ctx.user.permissions,
      }),
    },
  };
}
```

- [ ] **Step 6: Jalankan test & typecheck**

Run: `bun run --cwd gas test` → Expected: semua PASS.
Run: `bun run --cwd gas typecheck` → Expected: tanpa error.

- [ ] **Step 7: Commit**

```bash
bun run format
git add gas/src/core/validate.ts gas/src/core/router.ts gas/src/core/router.test.ts gas/src/modules/auth/routes.ts
git commit -m "feat(gas): router RPC dengan auth, cek level modul, dan error envelope" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Layanan & route modul akses

**Files:**
- Create: `gas/src/modules/access/validate.ts`, `gas/src/modules/access/service.ts`, `gas/src/modules/access/routes.ts`, `gas/src/routes.ts`
- Test: `gas/src/modules/access/validate.test.ts`, `gas/src/modules/access/service.test.ts`, `gas/src/routes.test.ts`

**Interfaces:**
- Consumes: `readObject_`, `expectNull_`, `RouteTable` (Task 7); repo & context (Task 6); `appError_`, `platform_`, `normalizeEmail_` (Task 4); `captureAppError`, fixtures (Task 4, 6).
- Produces (`validate.ts`): `validateSaveUser_(raw): SaveUserInput`, `validateSetUserStatus_(raw): SetUserStatusInput`, `validateSaveRole_(raw): SaveRoleInput`, `validateDeleteRole_(raw): DeleteRoleInput`.
- Produces (`service.ts`): `listUserDtos_(): UserDto[]`, `listRoleDtos_(): RoleDto[]`, `saveUser_(input, actor: UserContext): UserDto`, `setUserStatus_(input, actor): UserDto`, `saveRole_(input, actor): RoleDto`, `removeRole_(input, actor): { id: string }`.
- Produces: `accessRoutes_()`, `getRoutes_(): RouteTable` (dipakai `main.ts` di Task 9 dan mock backend di Task 11).

- [ ] **Step 1: Tulis test yang gagal — `gas/src/modules/access/validate.test.ts`**

```ts
import { expect, test } from 'bun:test';
import { captureAppError } from '@gas-test/errors';
import { validateDeleteRole_, validateSaveRole_, validateSaveUser_, validateSetUserStatus_ } from './validate';

test('validateSaveUser_ menormalisasi email, merapikan nama, dan membuang role duplikat', () => {
  expect(
    validateSaveUser_({ email: ' Budi@Gmail.COM ', name: '  Budi ', status: 'active', roleIds: ['a', 'a', 'b'] }),
  ).toEqual({ email: 'budi@gmail.com', name: 'Budi', status: 'active', roleIds: ['a', 'b'] });
});

test('validateSaveUser_ mengumpulkan semua error field', () => {
  const error = captureAppError(() => validateSaveUser_({ email: '', name: '', status: 'x', roleIds: 'a' }));
  expect(error.code).toBe('VALIDATION');
  expect(error.fields).toEqual({
    email: 'Wajib diisi',
    name: 'Wajib diisi',
    status: 'Nilai tidak valid',
    roleIds: 'Harus berupa daftar teks',
  });
});

test('validateSaveUser_ menolak format email salah dan input bukan objek', () => {
  expect(
    captureAppError(() => validateSaveUser_({ email: 'budi', name: 'B', status: 'active', roleIds: [] })).fields,
  ).toEqual({ email: 'Format email tidak valid' });
  expect(captureAppError(() => validateSaveUser_('teks')).fields?._).toBe('Input harus berupa objek');
});

test('validateSetUserStatus_ dan validateDeleteRole_ mewajibkan id', () => {
  expect(validateSetUserStatus_({ id: 'u1', status: 'inactive' })).toEqual({ id: 'u1', status: 'inactive' });
  expect(captureAppError(() => validateDeleteRole_({})).fields).toEqual({ id: 'Wajib diisi' });
});

test('validateSaveRole_ menolak modul atau level yang tidak dikenal', () => {
  expect(
    validateSaveRole_({ name: ' QC ', description: '', permissions: { item: 'edit', stock: 'none' } }),
  ).toEqual({ name: 'QC', description: '', permissions: { item: 'edit', stock: 'none' } });
  const error = captureAppError(() =>
    validateSaveRole_({ name: 'QC', description: '', permissions: { item: 'superuser' } }),
  );
  expect(error.fields?.permissions).toContain('item');
});
```

- [ ] **Step 2: Implementasi `gas/src/modules/access/validate.ts`**

```ts
import type { PartialPermissionMap } from '@shared/permissions';
import { isLevel, isModuleKey } from '@shared/permissions';
import type { DeleteRoleInput, SaveRoleInput, SaveUserInput, SetUserStatusInput } from '@shared/rpc';
import type { ObjectReader } from '@gas/core/validate';
import { readObject_ } from '@gas/core/validate';

const USER_STATUS_VALUES = ['active', 'inactive'] as const;

export function validateSaveUser_(raw: unknown): SaveUserInput {
  const reader = readObject_(raw);
  const id = reader.optionalId('id');
  const email = reader.email('email');
  const name = reader.str('name', { required: true, max: 100 });
  const status = reader.oneOf('status', USER_STATUS_VALUES);
  const roleIds = reader.stringArray('roleIds');
  reader.done();
  return id ? { id, email, name, status, roleIds } : { email, name, status, roleIds };
}

export function validateSetUserStatus_(raw: unknown): SetUserStatusInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true });
  const status = reader.oneOf('status', USER_STATUS_VALUES);
  reader.done();
  return { id, status };
}

function readPermissions_(value: unknown, reader: ObjectReader): PartialPermissionMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    reader.fail('permissions', 'Harus berupa objek');
    return {};
  }
  const result: PartialPermissionMap = {};
  for (const [key, level] of Object.entries(value)) {
    if (!isModuleKey(key) || !isLevel(level)) {
      reader.fail('permissions', `Level untuk "${key}" tidak valid`);
      continue;
    }
    result[key] = level;
  }
  return result;
}

export function validateSaveRole_(raw: unknown): SaveRoleInput {
  const reader = readObject_(raw);
  const id = reader.optionalId('id');
  const name = reader.str('name', { required: true, max: 60 });
  const description = reader.str('description', { max: 200 });
  const permissions = readPermissions_(reader.raw('permissions'), reader);
  reader.done();
  return id ? { id, name, description, permissions } : { name, description, permissions };
}

export function validateDeleteRole_(raw: unknown): DeleteRoleInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true });
  reader.done();
  return { id };
}
```

Run: `bun run --cwd gas test validate` → Expected: PASS (5 test).

- [ ] **Step 3: Tulis test yang gagal — `gas/src/modules/access/service.test.ts`**

```ts
import { beforeEach, expect, test } from 'bun:test';
import { role, user } from '@gas-test/access-fixtures';
import { captureAppError } from '@gas-test/errors';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { setPlatform_ } from '@gas/core/platform';
import type { UserContext } from './context';
import { loadUserContext_ } from './context';
import { insertRole_, insertUser_ } from './repo';
import { listRoleDtos_, listUserDtos_, removeRole_, saveRole_, saveUser_, setUserStatus_ } from './service';

let platform: MemoryPlatform;
let admin: UserContext;

function contextOf(email: string): UserContext {
  const ctx = loadUserContext_(email);
  if (!ctx) throw new Error(`konteks ${email} tidak ada`);
  return ctx;
}

beforeEach(() => {
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com' },
    now: () => Date.parse('2026-10-08T00:00:00.000Z'),
  });
  setPlatform_(platform);
  insertRole_(role({ id: 'r-qc', name: 'QC Staff', permissions: { item: 'edit' } }));
  insertRole_(role({ id: 'r-access', name: 'Admin Akses', permissions: { access: 'manage' } }));
  insertRole_(role({ id: 'r-kosong', name: 'Kosong' }));
  insertUser_(user({ id: 'u-budi', email: 'budi@gmail.com', name: 'Budi', roleIds: ['r-qc', 'r-access'] }));
  admin = contextOf('admin@gmail.com');
});

test('membuat user baru, mencatat audit, dan langsung berlaku untuk login', () => {
  expect(loadUserContext_('ani@gmail.com')).toBeNull();
  const created = saveUser_({ email: 'ani@gmail.com', name: 'Ani', status: 'active', roleIds: ['r-qc'] }, admin);
  expect(created).toMatchObject({ email: 'ani@gmail.com', updatedBy: 'admin@gmail.com', updatedAt: '2026-10-08T00:00:00.000Z' });
  expect(listUserDtos_().map((u) => u.email)).toEqual(['ani@gmail.com', 'budi@gmail.com']);
  expect(platform.db.sheet('audit_log').rows[1]?.[2]).toBe('user.create');
  expect(loadUserContext_('ani@gmail.com')?.permissions.item).toBe('edit');
});

test('menolak email yang sudah terdaftar walau beda huruf besar', () => {
  const error = captureAppError(() =>
    saveUser_({ email: ' BUDI@Gmail.com ', name: 'B', status: 'active', roleIds: [] }, admin),
  );
  expect(error).toMatchObject({ code: 'CONFLICT', fields: { email: 'Email sudah terdaftar' } });
});

test('menolak role yang tidak dikenal', () => {
  const error = captureAppError(() =>
    saveUser_({ email: 'ani@gmail.com', name: 'Ani', status: 'active', roleIds: ['r-hilang'] }, admin),
  );
  expect(error.code).toBe('VALIDATION');
  expect(error.fields?.roleIds).toBeDefined();
});

test('email tidak dapat diubah saat edit', () => {
  const error = captureAppError(() =>
    saveUser_({ id: 'u-budi', email: 'baru@gmail.com', name: 'Budi', status: 'active', roleIds: [] }, admin),
  );
  expect(error.code).toBe('VALIDATION');
});

test('admin tidak bisa menonaktifkan akun sendiri', () => {
  const budi = contextOf('budi@gmail.com');
  const viaSave = captureAppError(() =>
    saveUser_({ id: 'u-budi', email: 'budi@gmail.com', name: 'Budi', status: 'inactive', roleIds: ['r-access'] }, budi),
  );
  expect(viaSave.code).toBe('CONFLICT');
  expect(captureAppError(() => setUserStatus_({ id: 'u-budi', status: 'inactive' }, budi)).code).toBe('CONFLICT');
});

test('menonaktifkan user lain langsung mencabut aksesnya', () => {
  expect(loadUserContext_('budi@gmail.com')).not.toBeNull();
  expect(setUserStatus_({ id: 'u-budi', status: 'inactive' }, admin).status).toBe('inactive');
  expect(loadUserContext_('budi@gmail.com')).toBeNull();
});

test('nama berawalan = disimpan dan dibaca kembali sebagai teks literal', () => {
  saveUser_({ email: 'ani@gmail.com', name: '=HYPERLINK("http://x")', status: 'active', roleIds: [] }, admin);
  expect(listUserDtos_().find((u) => u.email === 'ani@gmail.com')?.name).toBe('=HYPERLINK("http://x")');
});

test('nama role unik tanpa membedakan huruf besar', () => {
  const error = captureAppError(() => saveRole_({ name: 'qc staff', description: '', permissions: {} }, admin));
  expect(error).toMatchObject({ code: 'CONFLICT', fields: { name: 'Nama role sudah dipakai' } });
});

test('perubahan permission role langsung memengaruhi user', () => {
  saveRole_({ id: 'r-qc', name: 'QC Staff', description: '', permissions: { item: 'manage', stock: 'none' } }, admin);
  expect(loadUserContext_('budi@gmail.com')?.permissions.item).toBe('manage');
});

test('role yang dipakai tidak bisa dihapus; role kosong terhapus dan tercatat di audit', () => {
  expect(captureAppError(() => removeRole_({ id: 'r-qc' }, admin)).code).toBe('CONFLICT');
  expect(removeRole_({ id: 'r-kosong' }, admin)).toEqual({ id: 'r-kosong' });
  expect(listRoleDtos_().map((r) => r.id)).not.toContain('r-kosong');
  expect(platform.db.sheet('audit_log').rows.at(-1)?.[2]).toBe('role.delete');
});

test('listRoleDtos_ menyertakan jumlah user per role, terurut nama', () => {
  expect(listRoleDtos_().map((r) => [r.name, r.userCount])).toEqual([
    ['Admin Akses', 1],
    ['Kosong', 0],
    ['QC Staff', 1],
  ]);
});
```

- [ ] **Step 4: Jalankan test, pastikan gagal**

Run: `bun run --cwd gas test service`
Expected: FAIL — `Cannot find module './service'`.

- [ ] **Step 5: Implementasi `gas/src/modules/access/service.ts`**

```ts
import { sanitizePermissions } from '@shared/permissions';
import type {
  DeleteRoleInput,
  RoleDto,
  SaveRoleInput,
  SaveUserInput,
  SetUserStatusInput,
  UserDto,
} from '@shared/rpc';
import { normalizeEmail_ } from '@gas/core/email';
import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import type { UserContext } from './context';
import { invalidateAccessCache_ } from './context';
import type { NewRoleRecord, NewUserRecord, RoleRecord, UserRecord } from './repo';
import {
  appendAudit_,
  deleteRole_,
  insertRole_,
  insertUser_,
  listRoles_,
  listUsers_,
  updateRole_,
  updateUser_,
} from './repo';

function toUserDto_(user: NewUserRecord): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    roleIds: [...user.roleIds],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    updatedBy: user.updatedBy,
  };
}

function toRoleDto_(role: NewRoleRecord, users: readonly NewUserRecord[]): RoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: { ...role.permissions },
    userCount: users.filter((user) => user.roleIds.includes(role.id)).length,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
    updatedBy: role.updatedBy,
  };
}

function nowIso_(): string {
  return new Date(platform_().now()).toISOString();
}

function userSnapshot_(user: NewUserRecord): Record<string, unknown> {
  return { name: user.name, status: user.status, roleIds: user.roleIds };
}

export function listUserDtos_(): UserDto[] {
  return listUsers_()
    .map(toUserDto_)
    .sort((a, b) => a.email.localeCompare(b.email));
}

export function listRoleDtos_(): RoleDto[] {
  const users = listUsers_();
  return listRoles_()
    .map((role) => toRoleDto_(role, users))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function saveUser_(input: SaveUserInput, actor: UserContext): UserDto {
  return platform_().withLock(() => {
    const email = normalizeEmail_(input.email);
    const users = listUsers_();
    const knownRoles = new Set(listRoles_().map((role) => role.id));
    if (input.roleIds.some((id) => !knownRoles.has(id))) {
      throw appError_('VALIDATION', 'Ada role yang tidak dikenal', { roleIds: 'Ada role yang tidak dikenal' });
    }
    if (users.some((user) => user.email === email && user.id !== input.id)) {
      throw appError_('CONFLICT', 'Email sudah terdaftar', { email: 'Email sudah terdaftar' });
    }
    const now = nowIso_();

    if (input.id) {
      const existing = users.find((user) => user.id === input.id);
      if (!existing) throw appError_('NOT_FOUND', 'User tidak ditemukan');
      if (existing.email !== email) {
        throw appError_('VALIDATION', 'Email tidak dapat diubah', { email: 'Email tidak dapat diubah' });
      }
      if (existing.email === actor.email && input.status === 'inactive') {
        throw appError_('CONFLICT', 'Anda tidak bisa menonaktifkan akun sendiri');
      }
      const updated: UserRecord = {
        ...existing,
        name: input.name,
        status: input.status,
        roleIds: [...input.roleIds],
        updatedAt: now,
        updatedBy: actor.email,
      };
      updateUser_(updated);
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'user.update',
        target: email,
        detail: { before: userSnapshot_(existing), after: userSnapshot_(updated) },
      });
      invalidateAccessCache_();
      return toUserDto_(updated);
    }

    const created: NewUserRecord = {
      id: platform_().uuid(),
      email,
      name: input.name,
      status: input.status,
      roleIds: [...input.roleIds],
      createdAt: now,
      updatedAt: now,
      updatedBy: actor.email,
    };
    insertUser_(created);
    appendAudit_({ ts: now, actor: actor.email, action: 'user.create', target: email, detail: userSnapshot_(created) });
    invalidateAccessCache_();
    return toUserDto_(created);
  });
}

export function setUserStatus_(input: SetUserStatusInput, actor: UserContext): UserDto {
  return platform_().withLock(() => {
    const existing = listUsers_().find((user) => user.id === input.id);
    if (!existing) throw appError_('NOT_FOUND', 'User tidak ditemukan');
    if (existing.email === actor.email && input.status === 'inactive') {
      throw appError_('CONFLICT', 'Anda tidak bisa menonaktifkan akun sendiri');
    }
    const now = nowIso_();
    const updated: UserRecord = { ...existing, status: input.status, updatedAt: now, updatedBy: actor.email };
    updateUser_(updated);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'user.activate' : 'user.deactivate',
      target: existing.email,
      detail: null,
    });
    invalidateAccessCache_();
    return toUserDto_(updated);
  });
}

export function saveRole_(input: SaveRoleInput, actor: UserContext): RoleDto {
  return platform_().withLock(() => {
    const roles = listRoles_();
    const nameKey = input.name.trim().toLowerCase();
    if (roles.some((role) => role.name.trim().toLowerCase() === nameKey && role.id !== input.id)) {
      throw appError_('CONFLICT', 'Nama role sudah dipakai', { name: 'Nama role sudah dipakai' });
    }
    const permissions = sanitizePermissions(input.permissions);
    const users = listUsers_();
    const now = nowIso_();

    if (input.id) {
      const existing = roles.find((role) => role.id === input.id);
      if (!existing) throw appError_('NOT_FOUND', 'Role tidak ditemukan');
      const updated: RoleRecord = {
        ...existing,
        name: input.name,
        description: input.description,
        permissions,
        updatedAt: now,
        updatedBy: actor.email,
      };
      updateRole_(updated);
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'role.update',
        target: updated.name,
        detail: { before: existing.permissions, after: permissions },
      });
      invalidateAccessCache_();
      return toRoleDto_(updated, users);
    }

    const created: NewRoleRecord = {
      id: platform_().uuid(),
      name: input.name,
      description: input.description,
      permissions,
      createdAt: now,
      updatedAt: now,
      updatedBy: actor.email,
    };
    insertRole_(created);
    appendAudit_({ ts: now, actor: actor.email, action: 'role.create', target: created.name, detail: permissions });
    invalidateAccessCache_();
    return toRoleDto_(created, users);
  });
}

export function removeRole_(input: DeleteRoleInput, actor: UserContext): { id: string } {
  return platform_().withLock(() => {
    const role = listRoles_().find((record) => record.id === input.id);
    if (!role) throw appError_('NOT_FOUND', 'Role tidak ditemukan');
    const usage = listUsers_().filter((user) => user.roleIds.includes(role.id)).length;
    if (usage > 0) throw appError_('CONFLICT', `Role masih dipakai oleh ${usage} user`);
    deleteRole_(role);
    appendAudit_({ ts: nowIso_(), actor: actor.email, action: 'role.delete', target: role.name, detail: role.permissions });
    invalidateAccessCache_();
    return { id: role.id };
  });
}
```

- [ ] **Step 6: Implementasi `gas/src/modules/access/routes.ts` dan `gas/src/routes.ts`**

`gas/src/modules/access/routes.ts`:

```ts
import type { RouteTable } from '@gas/core/router';
import { expectNull_ } from '@gas/core/validate';
import { listRoleDtos_, listUserDtos_, removeRole_, saveRole_, saveUser_, setUserStatus_ } from './service';
import { validateDeleteRole_, validateSaveRole_, validateSaveUser_, validateSetUserStatus_ } from './validate';

type AccessMethod =
  | 'access.users.list'
  | 'access.users.save'
  | 'access.users.setStatus'
  | 'access.roles.list'
  | 'access.roles.save'
  | 'access.roles.delete';

export function accessRoutes_(): Pick<RouteTable, AccessMethod> {
  return {
    'access.users.list': {
      permission: { module: 'access', level: 'view' },
      validate: expectNull_,
      handler: () => listUserDtos_(),
    },
    'access.users.save': {
      permission: { module: 'access', level: 'manage' },
      validate: validateSaveUser_,
      handler: (input, ctx) => saveUser_(input, ctx.user),
    },
    'access.users.setStatus': {
      permission: { module: 'access', level: 'manage' },
      validate: validateSetUserStatus_,
      handler: (input, ctx) => setUserStatus_(input, ctx.user),
    },
    'access.roles.list': {
      permission: { module: 'access', level: 'view' },
      validate: expectNull_,
      handler: () => listRoleDtos_(),
    },
    'access.roles.save': {
      permission: { module: 'access', level: 'manage' },
      validate: validateSaveRole_,
      handler: (input, ctx) => saveRole_(input, ctx.user),
    },
    'access.roles.delete': {
      permission: { module: 'access', level: 'manage' },
      validate: validateDeleteRole_,
      handler: (input, ctx) => removeRole_(input, ctx.user),
    },
  };
}
```

`gas/src/routes.ts`:

```ts
import type { RouteTable } from '@gas/core/router';
import { accessRoutes_ } from '@gas/modules/access/routes';
import { authRoutes_ } from '@gas/modules/auth/routes';

/** Dibangun lazy di dalam fungsi karena urutan load file GAS tidak dijamin. */
export function getRoutes_(): RouteTable {
  return { ...authRoutes_(), ...accessRoutes_() };
}
```

- [ ] **Step 7: Test pemetaan level — `gas/src/routes.test.ts`**

```ts
import { expect, test } from 'bun:test';
import { getRoutes_ } from './routes';

test('semua method terdaftar dengan level akses yang benar', () => {
  const routes = getRoutes_();
  expect(Object.keys(routes).sort()).toEqual([
    'access.roles.delete',
    'access.roles.list',
    'access.roles.save',
    'access.users.list',
    'access.users.save',
    'access.users.setStatus',
    'auth.me',
  ]);
  expect(routes['auth.me'].permission).toBeUndefined();
  for (const method of ['access.users.list', 'access.roles.list'] as const) {
    expect(routes[method].permission).toEqual({ module: 'access', level: 'view' });
  }
  for (const method of ['access.users.save', 'access.users.setStatus', 'access.roles.save', 'access.roles.delete'] as const) {
    expect(routes[method].permission).toEqual({ module: 'access', level: 'manage' });
  }
});
```

- [ ] **Step 8: Jalankan semua test & typecheck**

Run: `bun run --cwd gas test` → Expected: semua PASS.
Run: `bun run --cwd gas typecheck` → Expected: tanpa error.

- [ ] **Step 9: Commit**

```bash
bun run format
git add gas/src
git commit -m "feat(gas): layanan pengelolaan user & role dengan audit log" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Login OAuth, boot HTML, dan entry point GAS

**Files:**
- Create: `gas/src/modules/auth/oauth.ts`, `gas/src/modules/auth/boot.ts`, `gas/src/setup.ts`, `gas/src/core/gas-platform.ts`, `gas/src/main.ts`
- Create: `gas/appsscript.json`, `gas/.clasp.json`, `gas/deployment.json`
- Modify: `docs/prd/2026-10-08-qc-fondasi-akses.md` (§6.5 langkah 1: TTL state)
- Test: `gas/src/modules/auth/oauth.test.ts`, `gas/src/modules/auth/boot.test.ts`, `gas/src/setup.test.ts`

**Interfaces:**
- Consumes: `platform_`, `requireConfig_`, `missingConfigKeys_`, `normalizeEmail_`, `signSessionToken_` (Task 4); `openTable_` (Task 5); `loadUserContext_`, tabel akses (Task 6); `handleRpc_` (Task 7); `getRoutes_` (Task 8); `BootData` (Task 2).
- Produces (`oauth.ts`): `LOGIN_STATE_TTL_SECONDS = 21600`, `createLoginUrl_(): string`, `consumeLoginState_(state: unknown): boolean`, `type ExchangeResult = { ok: true; email: string } | { ok: false; reason: string }`, `exchangeCodeForEmail_(code: string): ExchangeResult`, `readIdTokenEmail_(idToken, clientId, nowMs): ExchangeResult`.
- Produces (`boot.ts`): `BOOT_PLACEHOLDER = '<!--BOOT-->'`, `buildBootData_(params: Record<string, string | undefined>): BootData`, `injectBoot_(html: string, boot: BootData): string`.
- Produces: `runSetup_(): string`; global publik `doGet(e)`, `api(method, payloadJson, token): string`, `setup(): string`.

- [ ] **Step 1: Tulis test yang gagal — `gas/src/modules/auth/oauth.test.ts`**

```ts
import { beforeEach, expect, test } from 'bun:test';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import type { HttpResponseLike } from '@gas/core/platform';
import { platform_, setPlatform_ } from '@gas/core/platform';
import { consumeLoginState_, createLoginUrl_, exchangeCodeForEmail_, readIdTokenEmail_ } from './oauth';

const NOW = Date.parse('2026-10-08T00:00:00.000Z');
const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const PROPS = {
  OAUTH_CLIENT_ID: CLIENT_ID,
  OAUTH_CLIENT_SECRET: 'secret',
  OAUTH_REDIRECT_URI: 'https://script.google.com/macros/s/DEPLOY/exec',
};
let platform: MemoryPlatform;
let httpResponse: HttpResponseLike;

function idToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => platform_().base64UrlEncode(JSON.stringify(value));
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`;
}

const validClaims = {
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  exp: NOW / 1000 + 600,
  email: 'Budi@Gmail.com',
  email_verified: true,
};

beforeEach(() => {
  httpResponse = { status: 500, body: '' };
  platform = createMemoryPlatform({ properties: PROPS, now: () => NOW, http: () => httpResponse });
  setPlatform_(platform);
});

test('createLoginUrl_ menyusun URL Google dan menyimpan state sekali pakai', () => {
  const url = new URL(createLoginUrl_());
  expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
  expect(url.searchParams.get('redirect_uri')).toBe(PROPS.OAUTH_REDIRECT_URI);
  expect(url.searchParams.get('response_type')).toBe('code');
  expect(url.searchParams.get('scope')).toBe('openid email');
  expect(url.searchParams.get('prompt')).toBe('select_account');
  const state = url.searchParams.get('state') ?? '';
  expect(consumeLoginState_(state)).toBe(true);
  expect(consumeLoginState_(state)).toBe(false);
});

test('consumeLoginState_ menolak state tak dikenal atau bukan string', () => {
  for (const value of ['tidak-ada', '', undefined, 42]) expect(consumeLoginState_(value)).toBe(false);
});

test('readIdTokenEmail_ menerima token valid dan menormalisasi email', () => {
  expect(readIdTokenEmail_(idToken(validClaims), CLIENT_ID, NOW)).toEqual({ ok: true, email: 'budi@gmail.com' });
  expect(readIdTokenEmail_(idToken({ ...validClaims, iss: 'accounts.google.com' }), CLIENT_ID, NOW).ok).toBe(true);
});

test('readIdTokenEmail_ menolak aud, iss, exp, email_verified yang salah, dan token rusak', () => {
  const cases = [
    idToken({ ...validClaims, aud: 'lain' }),
    idToken({ ...validClaims, iss: 'https://evil.example' }),
    idToken({ ...validClaims, exp: NOW / 1000 - 1 }),
    idToken({ ...validClaims, email_verified: false }),
    idToken({ ...validClaims, email: '' }),
    'bukan-jwt',
    'a.%%%.c',
  ];
  for (const token of cases) expect(readIdTokenEmail_(token, CLIENT_ID, NOW).ok).toBe(false);
});

test('exchangeCodeForEmail_ mengirim form yang benar dan membaca id_token', () => {
  httpResponse = { status: 200, body: JSON.stringify({ id_token: idToken(validClaims) }) };
  expect(exchangeCodeForEmail_('kode-123')).toEqual({ ok: true, email: 'budi@gmail.com' });
  expect(platform.httpCalls[0]).toEqual({
    url: 'https://oauth2.googleapis.com/token',
    form: {
      code: 'kode-123',
      client_id: CLIENT_ID,
      client_secret: 'secret',
      redirect_uri: PROPS.OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code',
    },
  });
});

test('exchangeCodeForEmail_ gagal bila endpoint menolak atau respons rusak', () => {
  httpResponse = { status: 400, body: '{"error":"invalid_grant"}' };
  expect(exchangeCodeForEmail_('x').ok).toBe(false);
  httpResponse = { status: 200, body: 'bukan json' };
  expect(exchangeCodeForEmail_('x').ok).toBe(false);
  httpResponse = { status: 200, body: '{}' };
  expect(exchangeCodeForEmail_('x').ok).toBe(false);
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `bun run --cwd gas test oauth` → Expected: FAIL — `Cannot find module './oauth'`.

- [ ] **Step 3: Implementasi `gas/src/modules/auth/oauth.ts`**

```ts
import { requireConfig_ } from '@gas/core/config';
import { normalizeEmail_ } from '@gas/core/email';
import { platform_ } from '@gas/core/platform';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
/** 6 jam (maksimum CacheService) agar link login di halaman yang lama terbuka tetap berlaku. */
export const LOGIN_STATE_TTL_SECONDS = 21600;

export type ExchangeResult = { ok: true; email: string } | { ok: false; reason: string };

function toQueryString_(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export function createLoginUrl_(): string {
  const platform = platform_();
  const state = platform.uuid();
  platform.cachePut(`oauth:state:${state}`, '1', LOGIN_STATE_TTL_SECONDS);
  return `${GOOGLE_AUTH_URL}?${toQueryString_({
    client_id: requireConfig_('OAUTH_CLIENT_ID'),
    redirect_uri: requireConfig_('OAUTH_REDIRECT_URI'),
    response_type: 'code',
    scope: 'openid email',
    state,
    prompt: 'select_account',
  })}`;
}

export function consumeLoginState_(state: unknown): boolean {
  if (typeof state !== 'string' || state === '') return false;
  const platform = platform_();
  const key = `oauth:state:${state}`;
  if (platform.cacheGet(key) === null) return false;
  platform.cacheRemove(key);
  return true;
}

export function readIdTokenEmail_(idToken: string, clientId: string, nowMs: number): ExchangeResult {
  const payloadPart = idToken.split('.')[1];
  if (!payloadPart) return { ok: false, reason: 'id_token tidak berformat JWT' };
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(platform_().base64UrlDecode(payloadPart)) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'payload id_token tidak bisa dibaca' };
  }
  if (!GOOGLE_ISSUERS.includes(String(claims.iss))) return { ok: false, reason: 'iss tidak valid' };
  if (claims.aud !== clientId) return { ok: false, reason: 'aud tidak cocok' };
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= nowMs) return { ok: false, reason: 'id_token kedaluwarsa' };
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    return { ok: false, reason: 'email belum terverifikasi' };
  }
  if (typeof claims.email !== 'string' || claims.email.trim() === '') return { ok: false, reason: 'email kosong' };
  return { ok: true, email: normalizeEmail_(claims.email) };
}

/** id_token diterima langsung dari endpoint token Google lewat TLS, sehingga tanda tangannya tidak perlu diverifikasi ulang. */
export function exchangeCodeForEmail_(code: string): ExchangeResult {
  const platform = platform_();
  const clientId = requireConfig_('OAUTH_CLIENT_ID');
  const response = platform.httpPostForm(GOOGLE_TOKEN_URL, {
    code,
    client_id: clientId,
    client_secret: requireConfig_('OAUTH_CLIENT_SECRET'),
    redirect_uri: requireConfig_('OAUTH_REDIRECT_URI'),
    grant_type: 'authorization_code',
  });
  if (response.status !== 200) return { ok: false, reason: `endpoint token menjawab ${response.status}` };
  let body: unknown;
  try {
    body = JSON.parse(response.body);
  } catch {
    return { ok: false, reason: 'respons token bukan JSON' };
  }
  const idToken = (body as { id_token?: unknown } | null)?.id_token;
  if (typeof idToken !== 'string') return { ok: false, reason: 'id_token tidak ada' };
  return readIdTokenEmail_(idToken, clientId, platform.now());
}
```

Run: `bun run --cwd gas test oauth` → Expected: PASS (6 test).

- [ ] **Step 4: Tulis test yang gagal — `gas/src/modules/auth/boot.test.ts`**

```ts
import { beforeEach, expect, test } from 'bun:test';
import { user } from '@gas-test/access-fixtures';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import type { HttpResponseLike } from '@gas/core/platform';
import { platform_, setPlatform_ } from '@gas/core/platform';
import { verifySessionToken_ } from '@gas/core/session';
import { insertUser_ } from '@gas/modules/access/repo';
import { BOOT_PLACEHOLDER, buildBootData_, injectBoot_ } from './boot';
import { createLoginUrl_ } from './oauth';

const NOW = Date.parse('2026-10-08T00:00:00.000Z');
let platform: MemoryPlatform;
let tokenEmail = 'budi@gmail.com';

function tokenResponse(): HttpResponseLike {
  const encode = (value: unknown) => platform_().base64UrlEncode(JSON.stringify(value));
  const claims = { iss: 'accounts.google.com', aud: 'cid', exp: NOW / 1000 + 600, email: tokenEmail, email_verified: true };
  return { status: 200, body: JSON.stringify({ id_token: `${encode({})}.${encode(claims)}.sig` }) };
}

function freshState(): string {
  return new URL(createLoginUrl_()).searchParams.get('state') ?? '';
}

beforeEach(() => {
  tokenEmail = 'budi@gmail.com';
  platform = createMemoryPlatform({
    properties: {
      OAUTH_CLIENT_ID: 'cid',
      OAUTH_CLIENT_SECRET: 'cs',
      OAUTH_REDIRECT_URI: 'https://script.google.com/macros/s/D/exec',
      SESSION_SECRET: 's',
      ADMIN_EMAIL: 'admin@gmail.com',
    },
    now: () => NOW,
    http: () => tokenResponse(),
  });
  setPlatform_(platform);
  insertUser_(user({ id: 'u1', email: 'budi@gmail.com' }));
});

test('tanpa parameter login hanya memberi loginUrl', () => {
  const boot = buildBootData_({});
  expect(Object.keys(boot)).toEqual(['loginUrl']);
  expect(boot.loginUrl).toStartWith('https://accounts.google.com/');
});

test('callback valid untuk email terdaftar menghasilkan sessionToken', () => {
  const boot = buildBootData_({ code: 'kode', state: freshState() });
  expect(verifySessionToken_(boot.sessionToken)?.email).toBe('budi@gmail.com');
  expect(boot.authError).toBeUndefined();
});

test('callback valid untuk email tidak terdaftar menghasilkan NOT_WHITELISTED', () => {
  tokenEmail = 'asing@gmail.com';
  const boot = buildBootData_({ code: 'kode', state: freshState() });
  expect(boot).toMatchObject({ authError: 'NOT_WHITELISTED', email: 'asing@gmail.com' });
  expect(boot.sessionToken).toBeUndefined();
  expect(boot.loginUrl).toBeDefined();
});

test('state tidak dikenal atau dipakai ulang menghasilkan LOGIN_FAILED tanpa memanggil Google', () => {
  const state = freshState();
  buildBootData_({ code: 'kode', state });
  platform.httpCalls.length = 0;
  for (const params of [{ code: 'kode', state }, { code: 'kode', state: 'palsu' }, { code: 'kode' }]) {
    const boot = buildBootData_(params);
    expect(boot.authError).toBe('LOGIN_FAILED');
    expect(boot.loginUrl).toBeDefined();
  }
  expect(platform.httpCalls).toHaveLength(0);
});

test('user membatalkan izin di Google (parameter error) menghasilkan LOGIN_FAILED', () => {
  expect(buildBootData_({ error: 'access_denied', state: freshState() }).authError).toBe('LOGIN_FAILED');
});

test('injectBoot_ menyisipkan script dan meng-escape karakter berbahaya', () => {
  const html = `<head>${BOOT_PLACEHOLDER}</head>`;
  const result = injectBoot_(html, { email: '</script><script>alert(1)</script>' });
  expect(result).toStartWith('<head><script>window.__BOOT__=');
  expect(result).not.toContain('</script><script>alert');
  expect(result).toContain('\\u003c/script>');
});

test('injectBoot_ gagal bila placeholder tidak ada atau ganda', () => {
  expect(() => injectBoot_('<head></head>', {})).toThrow(/BOOT/);
  expect(() => injectBoot_(`${BOOT_PLACEHOLDER}${BOOT_PLACEHOLDER}`, {})).toThrow(/BOOT/);
});
```

- [ ] **Step 5: Implementasi `gas/src/modules/auth/boot.ts`**

```ts
import type { BootData } from '@shared/rpc';
import { platform_ } from '@gas/core/platform';
import { signSessionToken_ } from '@gas/core/session';
import { loadUserContext_ } from '@gas/modules/access/context';
import { consumeLoginState_, createLoginUrl_, exchangeCodeForEmail_ } from './oauth';

export const BOOT_PLACEHOLDER = '<!--BOOT-->';

export function buildBootData_(params: Record<string, string | undefined>): BootData {
  const isCallback = Boolean(params.code || params.error);
  if (!isCallback) return { loginUrl: createLoginUrl_() };

  const stateOk = consumeLoginState_(params.state);
  if (!stateOk || params.error || !params.code) {
    return { authError: 'LOGIN_FAILED', loginUrl: createLoginUrl_() };
  }

  const result = exchangeCodeForEmail_(params.code);
  if (!result.ok) {
    platform_().logError(`Login gagal: ${result.reason}`);
    return { authError: 'LOGIN_FAILED', loginUrl: createLoginUrl_() };
  }
  if (!loadUserContext_(result.email)) {
    return { authError: 'NOT_WHITELISTED', email: result.email, loginUrl: createLoginUrl_() };
  }
  return { sessionToken: signSessionToken_(result.email) };
}

export function injectBoot_(html: string, boot: BootData): string {
  const parts = html.split(BOOT_PLACEHOLDER);
  if (parts.length !== 2) {
    throw new Error(`Placeholder ${BOOT_PLACEHOLDER} harus ada tepat satu kali di index.html`);
  }
  const json = JSON.stringify(boot)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `${parts[0]}<script>window.__BOOT__=${json};</script>${parts[1]}`;
}
```

Run: `bun run --cwd gas test boot` → Expected: PASS (7 test).

- [ ] **Step 6: Setup — test dan implementasi**

`gas/src/setup.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { setPlatform_ } from '@gas/core/platform';
import { runSetup_ } from './setup';

test('melaporkan Script Property yang belum diset dan tidak membuat sheet tanpa SPREADSHEET_ID', () => {
  const platform = createMemoryPlatform();
  setPlatform_(platform);
  const report = runSetup_();
  expect(report).toContain('SPREADSHEET_ID');
  expect(report).toContain('SESSION_SECRET');
  expect(platform.db.sheets.size).toBe(0);
});

test('membuat sheet users, roles, audit_log beserta header', () => {
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
  expect(runSetup_()).toContain('Script Properties lengkap.');
  expect([...platform.db.sheets.keys()]).toEqual(['users', 'roles', 'audit_log']);
  expect(platform.db.sheet('users').rows[0]?.[1]).toBe('email');
});
```

`gas/src/setup.ts`:

```ts
import { missingConfigKeys_ } from '@gas/core/config';
import { openTable_ } from '@gas/core/db';
import { AUDIT_TABLE, ROLES_TABLE, USERS_TABLE } from '@gas/modules/access/repo';

export function runSetup_(): string {
  const lines: string[] = [];
  const missing = missingConfigKeys_();
  lines.push(missing.length === 0 ? 'Script Properties lengkap.' : `Script Properties belum diset: ${missing.join(', ')}`);
  if (missing.includes('SPREADSHEET_ID')) {
    lines.push('Pembuatan sheet dilewati karena SPREADSHEET_ID belum diset.');
    return lines.join('\n');
  }
  for (const table of [USERS_TABLE, ROLES_TABLE, AUDIT_TABLE]) {
    openTable_(table);
    lines.push(`Sheet "${table.sheetName}" siap.`);
  }
  return lines.join('\n');
}
```

Run: `bun run --cwd gas test setup` → Expected: PASS (2 test).

- [ ] **Step 7: Adapter GAS asli — `gas/src/core/gas-platform.ts`** (tidak di-unit-test; diverifikasi di Task 16)

```ts
import type { Platform, SpreadsheetLike } from './platform';
import { setPlatform_ } from './platform';

function stripBase64Padding_(value: string): string {
  return value.replace(/=+$/, '');
}

function padBase64_(value: string): string {
  return value + '='.repeat((4 - (value.length % 4)) % 4);
}

function createGasPlatform_(): Platform {
  const properties = PropertiesService.getScriptProperties();
  const cache = CacheService.getScriptCache();
  let spreadsheet: SpreadsheetLike | null = null;
  return {
    getProperty: (key) => properties.getProperty(key),
    cacheGet: (key) => cache.get(key),
    cachePut: (key, value, ttlSeconds) => cache.put(key, value, ttlSeconds),
    cacheRemove: (key) => cache.remove(key),
    hmacSha256Base64Url: (data, secret) =>
      stripBase64Padding_(
        Utilities.base64EncodeWebSafe(
          Utilities.computeHmacSha256Signature(data, secret, Utilities.Charset.UTF_8),
        ),
      ),
    base64UrlEncode: (text) => stripBase64Padding_(Utilities.base64EncodeWebSafe(text, Utilities.Charset.UTF_8)),
    base64UrlDecode: (encoded) =>
      Utilities.newBlob(Utilities.base64DecodeWebSafe(padBase64_(encoded), Utilities.Charset.UTF_8)).getDataAsString(
        'UTF-8',
      ),
    uuid: () => Utilities.getUuid(),
    now: () => Date.now(),
    httpPostForm: (url, form) => {
      const response = UrlFetchApp.fetch(url, { method: 'post', payload: form, muteHttpExceptions: true });
      return { status: response.getResponseCode(), body: response.getContentText() };
    },
    withLock<T>(fn: () => T): T {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        return fn();
      } finally {
        lock.releaseLock();
      }
    },
    spreadsheet: () => {
      if (!spreadsheet) {
        const id = properties.getProperty('SPREADSHEET_ID')?.trim();
        if (!id) throw new Error('Script Property SPREADSHEET_ID belum diset');
        spreadsheet = SpreadsheetApp.openById(id) as unknown as SpreadsheetLike;
      }
      return spreadsheet;
    },
    logError: (message) => console.error(message),
  };
}

export function installGasPlatform_(): void {
  setPlatform_(createGasPlatform_());
}

export function loadIndexHtml_(): string {
  return HtmlService.createHtmlOutputFromFile('index').getContent();
}

export function renderHtmlPage_(html: string): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createHtmlOutput(html)
    .setTitle('QC App')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

export function renderErrorPage_(message: string): GoogleAppsScript.HTML.HtmlOutput {
  const escaped = message.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);
  return HtmlService.createHtmlOutput(
    `<main style="font-family:sans-serif;padding:2rem"><h1>QC App</h1><p>${escaped}</p></main>`,
  ).setTitle('QC App');
}

/** `setup` hanya boleh dijalankan pemilik script dari editor, bukan lewat google.script.run. */
export function assertScriptOwner_(): void {
  const active = Session.getActiveUser().getEmail();
  const owner = Session.getEffectiveUser().getEmail();
  if (!active || active !== owner) {
    throw new Error('setup hanya boleh dijalankan oleh pemilik script dari editor Apps Script.');
  }
}
```

- [ ] **Step 8: Entry point — `gas/src/main.ts`**

```ts
import {
  assertScriptOwner_,
  installGasPlatform_,
  loadIndexHtml_,
  renderErrorPage_,
  renderHtmlPage_,
} from '@gas/core/gas-platform';
import { platform_ } from '@gas/core/platform';
import { handleRpc_ } from '@gas/core/router';
import { buildBootData_, injectBoot_ } from '@gas/modules/auth/boot';
import { getRoutes_ } from '@gas/routes';
import { runSetup_ } from '@gas/setup';

export function doGet(e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {
  installGasPlatform_();
  try {
    return renderHtmlPage_(injectBoot_(loadIndexHtml_(), buildBootData_(e.parameter ?? {})));
  } catch (error) {
    platform_().logError(`doGet gagal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return renderErrorPage_('Aplikasi belum dapat dibuka. Hubungi admin.');
  }
}

export function api(method: unknown, payloadJson: unknown, token: unknown): string {
  installGasPlatform_();
  return JSON.stringify(handleRpc_(method, payloadJson, token, getRoutes_()));
}

export function setup(): string {
  installGasPlatform_();
  assertScriptOwner_();
  const report = runSetup_();
  console.log(report);
  return report;
}
```

- [ ] **Step 9: Manifest & konfigurasi clasp**

`gas/appsscript.json`:

```json
{
  "timeZone": "Asia/Jakarta",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/userinfo.email"
  ],
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

`gas/.clasp.json`:

```json
{
  "scriptId": "1JyiAAtAAytBWzuWp5rZgCVQrXCXb7lrEYtbcH1OPDvylQSUGVtArrX_U",
  "rootDir": "dist"
}
```

`gas/deployment.json` (diisi di Task 16):

```json
{
  "deploymentId": ""
}
```

- [ ] **Step 10: Perbarui PRD §6.5 langkah 1**

Ganti teks `buat \`state\` acak (CacheService, 10 menit)` menjadi `buat \`state\` acak (CacheService, 6 jam — agar link login di halaman yang lama terbuka tetap berlaku)`.

- [ ] **Step 11: Build GAS pertama & verifikasi**

Run: `bun run --cwd gas test` → Expected: semua PASS.
Run: `bun run --cwd gas typecheck` → Expected: tanpa error.
Run: `bun run build:gas` → Expected: `build:gas selesai — N file → gas/dist`.

Periksa hasil:

```bash
ls -R gas/dist
grep -rnE "^[[:space:]]*(import|export)\b" gas/dist || echo "bersih"
```

Expected: ada `main.js`, `routes.js`, `setup.js`, `core/*.js`, `modules/**/*.js`, `shared/*.js`, `appsscript.json`; output grep `bersih`. Buka `gas/dist/main.js` — harus berisi `function doGet(e)`, `function api(method, payloadJson, token)`, `function setup()`.

- [ ] **Step 12: Commit**

```bash
bun run format
git add gas docs/prd/2026-10-08-qc-fondasi-akses.md
git commit -m "feat(gas): login OAuth Google, boot HTML, setup, dan entry point web app" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Scaffold frontend & pipeline single-file

**Files:**
- Create (via TanStack CLI & shadcn): `web/` — `package.json`, `components.json`, `src/styles.css`, `src/lib/utils.ts`, `src/components/ui/*`, `src/hooks/*`
- Create/overwrite: `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/routes/__root.tsx`, `web/src/routes/index.tsx`, `web/src/types/gas-client.d.ts`, `web/src/test/setup.ts`
- Create: `scripts/verify-dist.ts`
- Modify: `package.json` (root — workspaces & skrip)

**Interfaces:**
- Consumes: `BootData` (Task 2); `gas/dist` dari `build:gas` (Task 9).
- Produces: alias `@/*` → `web/src/*` dan alias `@shared`, `@gas`, `@gas-test` di Vite & tsconfig; global `window.google?.script` & `window.__BOOT__` bertipe; skrip root `dev`, `build`, `build:web`; `bun run check` kini mencakup web.

- [ ] **Step 1: Pelajari opsi TanStack CLI**

```bash
bunx @tanstack/cli@latest create --help
```

Catat flag untuk: aplikasi **Router saja** (SPA, tanpa TanStack Start/SSR), routing **file-based**, TypeScript, Tailwind, package manager `bun`, toolchain, add-on (`shadcn`, `tanstack-query`, `form`), dan tanpa `git init`.

- [ ] **Step 2: Scaffold ke folder `web/`**

Dari root repo, jalankan dengan flag hasil Step 1. Bentuk yang diharapkan:

```bash
bunx @tanstack/cli@latest create web --router-only --package-manager bun --toolchain biome --add-ons shadcn,tanstack-query,form --no-git
```

Expected: folder `web/` berisi `package.json`, `vite.config.ts`, `src/main.tsx`, `src/routes/__root.tsx`. Bila add-on tertentu tidak tersedia, lanjutkan — dependency-nya dipasang manual di Step 4.

- [ ] **Step 3: Bersihkan hasil scaffold**

Sisakan hanya: `web/package.json`, `web/components.json` (bila ada), `web/src/styles.css`, `web/src/lib/utils.ts`, `web/src/components/ui/`, `web/src/hooks/`. Hapus file lain di `web/src/` (route/komponen demo, `integrations/`, `logo.svg`, `reportWebVitals.ts`, `App.css`, dsb.), `web/public/`, `web/biome.json`/`web/.eslintrc*`/`web/.prettierrc*` (lint memakai Biome root), `web/tsconfig.*.json` turunan, dan `web/bun.lock` (lockfile dikelola root). Bila CSS global bernama lain (mis. `index.css`), ganti namanya menjadi `src/styles.css` dan perbarui `tailwind.css` di `components.json`.

- [ ] **Step 4: Pasang dependency**

```bash
cd web
bun add react react-dom @tanstack/react-router @tanstack/react-query @tanstack/react-form zod sonner lucide-react
bun add -d vite @vitejs/plugin-react @tanstack/router-plugin tailwindcss @tailwindcss/vite vite-plugin-singlefile vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/react @types/react-dom
cd ..
```

Bila `components.json` belum ada (add-on shadcn tidak terpasang): `cd web && bunx --bun shadcn@latest init` (pilih style default, base color netral, CSS `src/styles.css`, alias `@/components`, `@/lib/utils`, `@/components/ui`, `@/hooks`).

- [ ] **Step 5: Tambah komponen shadcn**

```bash
cd web
bunx --bun shadcn@latest add button input label textarea card badge table dialog checkbox dropdown-menu separator sidebar sheet skeleton tooltip avatar alert sonner
cd ..
```

Expected: file-file di `web/src/components/ui/` dan `web/src/hooks/use-mobile.ts`.

- [ ] **Step 6: Tulis `web/vite.config.ts`**

```ts
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vitest/config';

const fromHere = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: false }), react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      '@shared': fromHere('../shared'),
      '@gas-test': fromHere('../gas/test-support'),
      '@gas': fromHere('../gas/src'),
      '@': fromHere('./src'),
    },
  },
  server: { port: 3000, fs: { allow: ['..'] } },
  build: {
    outDir: '../gas/dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 5_000,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

- [ ] **Step 7: Tulis `web/tsconfig.json` dan `web/package.json` scripts**

`web/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "paths": {
      "@/*": ["./src/*"],
      "@shared/*": ["../shared/*"],
      "@gas/*": ["../gas/src/*"],
      "@gas-test/*": ["../gas/test-support/*"]
    }
  },
  "include": ["src"]
}
```

(`vite.config.ts` sengaja tidak di-include agar tipe Node tidak bercampur dengan kode browser; Vite memuatnya sendiri.)

Ubah bagian `scripts` di `web/package.json` (dependency biarkan seperti hasil Step 4) dan pastikan `"name": "@qc/web"`, `"private": true`, `"type": "module"`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -p tsconfig.json"
  }
}
```

- [ ] **Step 8: Tulis `web/index.html`, tipe global, dan setup test**

`web/index.html`:

```html
<!doctype html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>QC App</title>
    <!--BOOT-->
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/types/gas-client.d.ts`:

```ts
interface GasRunner {
  withSuccessHandler(handler: (value: unknown) => void): GasRunner;
  withFailureHandler(handler: (error: Error) => void): GasRunner;
  api(method: string, payloadJson: string, token: string): void;
}

interface GasLocation {
  hash: string;
  parameter: Record<string, string>;
  parameters: Record<string, string[]>;
}

interface GasScript {
  run: GasRunner;
  history: {
    replace(state: unknown, params: Record<string, string>, hash: string): void;
    push(state: unknown, params: Record<string, string>, hash: string): void;
  };
  url: { getLocation(callback: (location: GasLocation) => void): void };
}

interface Window {
  google?: { script?: GasScript };
  __BOOT__?: import('@shared/rpc').BootData;
}
```

`web/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// Radix (Checkbox, dsb.) membutuhkan ResizeObserver yang tidak ada di jsdom.
class ResizeObserverStub {
  observe() {
    return undefined;
  }
  unobserve() {
    return undefined;
  }
  disconnect() {
    return undefined;
  }
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
```

- [ ] **Step 9: Route & entry minimal (diganti penuh di Task 12)**

`web/src/routes/__root.tsx`:

```tsx
import { Outlet, createRootRoute } from '@tanstack/react-router';

export const Route = createRootRoute({ component: () => <Outlet /> });
```

`web/src/routes/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: () => <main className="p-6 text-2xl font-semibold">QC App</main>,
});
```

`web/src/main.tsx`:

```tsx
import { RouterProvider, createHashHistory, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { routeTree } from './routeTree.gen';
import './styles.css';

const router = createRouter({ routeTree, history: createHashHistory() });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('app');
if (root) createRoot(root).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
```

- [ ] **Step 10: Skrip verifikasi hasil build — `scripts/verify-dist.ts`**

```ts
import path from 'node:path';
import { GAS_DIST_DIR } from './paths';

const problems: string[] = [];
const index = Bun.file(path.join(GAS_DIST_DIR, 'index.html'));

if (!(await index.exists())) {
  problems.push('gas/dist/index.html tidak ada');
} else {
  const html = await index.text();
  const bootCount = html.split('<!--BOOT-->').length - 1;
  if (bootCount !== 1) problems.push(`placeholder <!--BOOT--> muncul ${bootCount} kali (harus 1)`);
  if (/<script[^>]+\bsrc=/i.test(html)) problems.push('index.html masih memuat <script src> eksternal');
  if (/<link[^>]+rel=["']?stylesheet/i.test(html)) problems.push('index.html masih memuat stylesheet eksternal');
  if (html.includes('mock-secret')) problems.push('kode mock backend ikut ter-bundle ke build produksi');
}

for (const required of ['appsscript.json', 'main.js']) {
  if (!(await Bun.file(path.join(GAS_DIST_DIR, required)).exists())) problems.push(`gas/dist/${required} tidak ada`);
}

for await (const file of new Bun.Glob('**/*.js').scan({ cwd: GAS_DIST_DIR })) {
  const text = await Bun.file(path.join(GAS_DIST_DIR, file)).text();
  if (/^[ \t]*(?:import|export)\b/m.test(text)) problems.push(`${file} masih mengandung import/export`);
}

if (problems.length > 0) {
  console.error(`verify-dist gagal:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('verify-dist OK');
```

- [ ] **Step 11: Perbarui `package.json` root**

```json
{
  "name": "qc",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "gas", "web"],
  "scripts": {
    "dev": "bun run --cwd web dev",
    "build:gas": "bun run scripts/build-gas.ts",
    "build:web": "bun run --cwd web build",
    "build": "bun run build:gas && bun run build:web && bun run scripts/verify-dist.ts",
    "typecheck": "tsc -p tsconfig.json && bun run --cwd shared typecheck && bun run --cwd gas typecheck && bun run --cwd web typecheck",
    "lint": "biome check .",
    "format": "biome check --write .",
    "test": "bun test ./scripts && bun run --cwd shared test && bun run --cwd gas test && bun run --cwd web test",
    "check": "bun run typecheck && bun run lint && bun run test"
  }
}
```

Lalu `bun install` di root.

- [ ] **Step 12: Verifikasi build & dev**

Run: `bun run build`
Expected: `build:gas selesai …`, Vite build sukses, `verify-dist OK`. `web/src/routeTree.gen.ts` terbentuk.

Run: `bun run --cwd web typecheck` → Expected: tanpa error. Bila komponen shadcn gagal karena `noUncheckedIndexedAccess`/`verbatimModuleSyntax`, perbaiki baris yang dilaporkan (tambahkan `type` pada import tipe, atau guard `?? ''`); jangan melonggarkan tsconfig.

Run: `bun run dev` → buka `http://localhost:3000` → Expected: teks "QC App". Hentikan server.

- [ ] **Step 13: Commit**

```bash
bun run format
git add package.json bun.lock scripts/verify-dist.ts web
git commit -m "feat(web): scaffold React + TanStack + shadcn dengan build single-file ke gas/dist" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Klien RPC, sesi, boot, dan mock backend

**Files:**
- Create: `web/src/lib/rpc/transport.ts`, `rpc-error.ts`, `client.ts`, `gas-transport.ts`, `mock-backend.ts`, `describe-error.ts`, `index.ts`
- Create: `web/src/modules/auth/session.ts`, `web/src/app/boot.ts`, `web/src/app/query-client.ts`
- Test: `web/src/lib/rpc/client.test.ts`, `web/src/lib/rpc/describe-error.test.ts`, `web/src/lib/rpc/mock-backend.test.ts`, `web/src/modules/auth/session.test.ts`, `web/src/app/boot.test.ts`, `web/src/app/query-client.test.ts`

**Interfaces:**
- Consumes: kontrak `@shared/rpc` (Task 2); `handleRpc_` (Task 7), `getRoutes_` (Task 8), `signSessionToken_` (Task 4), `loadUserContext_`, `insertRole_`, `insertUser_` (Task 6), `createMemoryPlatform`, fixtures (Task 4/6).
- Produces:
  - `RpcTransport { call(method: string, payloadJson: string, token: string): Promise<string> }`
  - `class RpcError extends Error { code: ErrorCode; requestId: string; fields: Record<string,string> | undefined }`
  - `type RpcCall = <M extends RpcMethod>(method: M, input: RpcInput<M>) => Promise<RpcOutput<M>>`, `createRpcClient(transport, getToken: () => string | null): RpcCall`, `rpc: RpcCall` (instans default)
  - `describeError(error: unknown): string`
  - `mock-backend.ts`: `MOCK_ADMIN_EMAIL`, `MOCK_USERS: { email; label }[]`, `mockLogin(email): { token: string } | { authError: 'NOT_WHITELISTED'; email: string }`, `mockTransport: RpcTransport`
  - `session.ts`: `SessionState { token; loginUrl; authError: AuthErrorCode | null; authErrorEmail }`, `readStoredToken()`, `getSession()`, `getToken()`, `initSession(state)`, `setToken(token)`, `clearToken()`
  - `boot.ts`: `readBoot(): BootData`, `resolveInitialSession(boot, storedToken): SessionState`
  - `query-client.ts`: `shouldRetry(failureCount, error)`, `handleGlobalError(error, deps)`, `setUnauthenticatedHandler(fn)`, `queryClient`

- [ ] **Step 1: Tulis test yang gagal — `client.test.ts` & `describe-error.test.ts`**

`web/src/lib/rpc/client.test.ts`:

```ts
import { expect, test, vi } from 'vitest';
import { createRpcClient } from './client';
import { RpcError } from './rpc-error';

function transportReturning(raw: string) {
  return { call: vi.fn(async (_method: string, _payload: string, _token: string) => raw) };
}

test('mengirim method, payload JSON, dan token lalu mengembalikan data', async () => {
  const transport = transportReturning(JSON.stringify({ ok: true, data: [{ id: '1' }] }));
  const rpc = createRpcClient(transport, () => 'tok');
  await expect(rpc('access.users.list', null)).resolves.toEqual([{ id: '1' }]);
  expect(transport.call).toHaveBeenCalledWith('access.users.list', 'null', 'tok');
});

test('tanpa token mengirim string kosong', async () => {
  const transport = transportReturning(JSON.stringify({ ok: true, data: null }));
  await createRpcClient(transport, () => null)('auth.me', null);
  expect(transport.call).toHaveBeenCalledWith('auth.me', 'null', '');
});

test('error dari server menjadi RpcError dengan code, requestId, dan fields', async () => {
  const body = { ok: false, error: { code: 'VALIDATION', message: 'Input tidak valid', requestId: 'abcd1234', fields: { email: 'Wajib diisi' } } };
  const rpc = createRpcClient(transportReturning(JSON.stringify(body)), () => 't');
  const error = await rpc('auth.me', null).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RpcError);
  expect(error).toMatchObject({ code: 'VALIDATION', requestId: 'abcd1234', fields: { email: 'Wajib diisi' } });
});

test('kegagalan transport dan respons rusak menjadi RpcError INTERNAL', async () => {
  const failing = { call: vi.fn(async () => Promise.reject(new Error('offline'))) };
  await expect(createRpcClient(failing, () => 't')('auth.me', null)).rejects.toMatchObject({ code: 'INTERNAL' });
  await expect(createRpcClient(transportReturning('<html>'), () => 't')('auth.me', null)).rejects.toMatchObject({
    code: 'INTERNAL',
  });
  await expect(createRpcClient(transportReturning('{}'), () => 't')('auth.me', null)).rejects.toMatchObject({
    code: 'INTERNAL',
  });
});
```

`web/src/lib/rpc/describe-error.test.ts`:

```ts
import { expect, test } from 'vitest';
import { describeError } from './describe-error';
import { RpcError } from './rpc-error';

test('menggabungkan pesan dengan detail field', () => {
  expect(describeError(new RpcError('CONFLICT', 'Email sudah terdaftar', 'r1', { email: 'Email sudah terdaftar' }))).toBe(
    'Email sudah terdaftar: Email sudah terdaftar',
  );
});

test('error INTERNAL dari server menyertakan kode request', () => {
  expect(describeError(new RpcError('INTERNAL', 'Terjadi kesalahan pada server', 'abcd1234'))).toBe(
    'Terjadi kesalahan pada server (kode: abcd1234)',
  );
});

test('error selain RpcError diberi pesan umum', () => {
  expect(describeError(new Error('x'))).toBe('Terjadi kesalahan yang tidak terduga.');
});
```

Run: `bun run --cwd web test` → Expected: FAIL (modul belum ada).

- [ ] **Step 2: Implementasi transport, error, client, describe**

`web/src/lib/rpc/transport.ts`:

```ts
export interface RpcTransport {
  call(method: string, payloadJson: string, token: string): Promise<string>;
}
```

`web/src/lib/rpc/rpc-error.ts`:

```ts
import type { ErrorCode } from '@shared/rpc';

export class RpcError extends Error {
  readonly code: ErrorCode;
  readonly requestId: string;
  readonly fields: Record<string, string> | undefined;

  constructor(code: ErrorCode, message: string, requestId: string, fields?: Record<string, string>, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RpcError';
    this.code = code;
    this.requestId = requestId;
    this.fields = fields;
  }
}
```

`web/src/lib/rpc/client.ts`:

```ts
import type { RpcInput, RpcMethod, RpcOutput, RpcResult } from '@shared/rpc';
import { RpcError } from './rpc-error';
import type { RpcTransport } from './transport';

export type RpcCall = <M extends RpcMethod>(method: M, input: RpcInput<M>) => Promise<RpcOutput<M>>;

function isRpcResult(value: unknown): value is RpcResult<unknown> {
  return Boolean(value) && typeof value === 'object' && typeof (value as { ok?: unknown }).ok === 'boolean';
}

export function createRpcClient(transport: RpcTransport, getToken: () => string | null): RpcCall {
  async function call<M extends RpcMethod>(method: M, input: RpcInput<M>): Promise<RpcOutput<M>> {
    let raw: string;
    try {
      raw = await transport.call(method, JSON.stringify(input ?? null), getToken() ?? '');
    } catch (error) {
      throw new RpcError('INTERNAL', 'Tidak dapat menghubungi server. Periksa koneksi Anda.', '-', undefined, {
        cause: error,
      });
    }
    let result: unknown;
    try {
      result = JSON.parse(raw);
    } catch {
      throw new RpcError('INTERNAL', 'Respons server tidak valid', '-');
    }
    if (!isRpcResult(result)) throw new RpcError('INTERNAL', 'Respons server tidak valid', '-');
    if (!result.ok) {
      throw new RpcError(result.error.code, result.error.message, result.error.requestId, result.error.fields);
    }
    return result.data as RpcOutput<M>;
  }
  return call;
}
```

`web/src/lib/rpc/describe-error.ts`:

```ts
import { RpcError } from './rpc-error';

export function describeError(error: unknown): string {
  if (!(error instanceof RpcError)) return 'Terjadi kesalahan yang tidak terduga.';
  const details = error.fields ? Object.values(error.fields).filter(Boolean) : [];
  const base = details.length > 0 ? `${error.message}: ${details.join(', ')}` : error.message;
  return error.code === 'INTERNAL' && error.requestId !== '-' ? `${base} (kode: ${error.requestId})` : base;
}
```

`web/src/lib/rpc/gas-transport.ts`:

```ts
import type { RpcTransport } from './transport';

export const gasTransport: RpcTransport = {
  call(method, payloadJson, token) {
    return new Promise((resolve, reject) => {
      const run = window.google?.script?.run;
      if (!run) {
        reject(new Error('google.script.run tidak tersedia'));
        return;
      }
      run
        .withSuccessHandler((value) => resolve(String(value)))
        .withFailureHandler((error) => reject(error))
        .api(method, payloadJson, token);
    });
  },
};
```

Run: `bun run --cwd web test` → Expected: `client` dan `describe-error` PASS.

- [ ] **Step 3: Sesi & boot — test yang gagal**

`web/src/modules/auth/session.test.ts`:

```ts
import { afterEach, expect, test, vi } from 'vitest';
import { clearToken, getSession, getToken, initSession, readStoredToken, setToken } from './session';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  initSession({ token: null, loginUrl: null, authError: null, authErrorEmail: null });
});

test('setToken menyimpan ke state dan localStorage serta menghapus error login', () => {
  initSession({ token: null, loginUrl: 'u', authError: 'LOGIN_FAILED', authErrorEmail: null });
  setToken('abc');
  expect(getToken()).toBe('abc');
  expect(readStoredToken()).toBe('abc');
  expect(getSession()).toMatchObject({ loginUrl: 'u', authError: null });
});

test('clearToken menghapus token dari state dan localStorage', () => {
  setToken('abc');
  clearToken();
  expect(getToken()).toBeNull();
  expect(readStoredToken()).toBeNull();
});

test('storage yang tidak tersedia tidak membuat aplikasi crash', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(readStoredToken()).toBeNull();
  expect(() => setToken('abc')).not.toThrow();
  expect(getToken()).toBe('abc');
});
```

`web/src/app/boot.test.ts`:

```ts
import { expect, test } from 'vitest';
import { resolveInitialSession } from './boot';

test('sessionToken dari boot dipakai dan menggantikan token lama', () => {
  expect(resolveInitialSession({ sessionToken: 'baru' }, 'lama')).toEqual({
    token: 'baru',
    loginUrl: null,
    authError: null,
    authErrorEmail: null,
  });
});

test('refresh setelah login (state sudah terpakai → LOGIN_FAILED) tetap memakai token tersimpan', () => {
  expect(resolveInitialSession({ authError: 'LOGIN_FAILED', loginUrl: 'u' }, 'tersimpan')).toEqual({
    token: 'tersimpan',
    loginUrl: 'u',
    authError: null,
    authErrorEmail: null,
  });
});

test('NOT_WHITELISTED membuang token tersimpan dan menampilkan email', () => {
  expect(resolveInitialSession({ authError: 'NOT_WHITELISTED', email: 'a@gmail.com', loginUrl: 'u' }, 'lama')).toEqual({
    token: null,
    loginUrl: 'u',
    authError: 'NOT_WHITELISTED',
    authErrorEmail: 'a@gmail.com',
  });
});

test('tanpa token sama sekali, LOGIN_FAILED ditampilkan', () => {
  expect(resolveInitialSession({ authError: 'LOGIN_FAILED', loginUrl: 'u' }, null).authError).toBe('LOGIN_FAILED');
  expect(resolveInitialSession({ loginUrl: 'u' }, null)).toEqual({
    token: null,
    loginUrl: 'u',
    authError: null,
    authErrorEmail: null,
  });
});
```

Run: `bun run --cwd web test` → Expected: FAIL (modul belum ada).

- [ ] **Step 4: Implementasi `session.ts` dan `boot.ts`**

`web/src/modules/auth/session.ts`:

```ts
import type { AuthErrorCode } from '@shared/rpc';

const TOKEN_STORAGE_KEY = 'qc.session';

export interface SessionState {
  token: string | null;
  loginUrl: string | null;
  authError: AuthErrorCode | null;
  authErrorEmail: string | null;
}

let state: SessionState = { token: null, loginUrl: null, authError: null, authErrorEmail: null };

function persist(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Storage diblokir (mode privat / kebijakan browser) — sesi tetap berjalan di memori.
  }
}

export function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getSession(): SessionState {
  return state;
}

export function getToken(): string | null {
  return state.token;
}

export function initSession(next: SessionState): void {
  state = next;
  persist(next.token);
}

export function setToken(token: string): void {
  state = { ...state, token, authError: null, authErrorEmail: null };
  persist(token);
}

export function clearToken(): void {
  state = { ...state, token: null };
  persist(null);
}
```

`web/src/app/boot.ts`:

```ts
import type { BootData } from '@shared/rpc';
import type { SessionState } from '@/modules/auth/session';

export function readBoot(): BootData {
  return window.__BOOT__ ?? {};
}

export function resolveInitialSession(boot: BootData, storedToken: string | null): SessionState {
  const loginUrl = boot.loginUrl ?? null;
  if (boot.sessionToken) return { token: boot.sessionToken, loginUrl, authError: null, authErrorEmail: null };
  if (boot.authError === 'NOT_WHITELISTED') {
    return { token: null, loginUrl, authError: 'NOT_WHITELISTED', authErrorEmail: boot.email ?? null };
  }
  // LOGIN_FAILED karena refresh di URL callback lama: token tersimpan tetap sah.
  if (storedToken) return { token: storedToken, loginUrl, authError: null, authErrorEmail: null };
  return { token: null, loginUrl, authError: boot.authError ?? null, authErrorEmail: null };
}
```

- [ ] **Step 5: Query client — test & implementasi**

`web/src/app/query-client.test.ts`:

```ts
import { expect, test, vi } from 'vitest';
import { RpcError } from '@/lib/rpc/rpc-error';
import { handleGlobalError, shouldRetry } from './query-client';

test('hanya error INTERNAL yang di-retry, maksimal sekali', () => {
  expect(shouldRetry(0, new RpcError('INTERNAL', 'x', '-'))).toBe(true);
  expect(shouldRetry(1, new RpcError('INTERNAL', 'x', '-'))).toBe(false);
  expect(shouldRetry(0, new RpcError('FORBIDDEN', 'x', 'r'))).toBe(false);
  expect(shouldRetry(0, new Error('x'))).toBe(false);
});

test('UNAUTHENTICATED memicu logout global, FORBIDDEN menampilkan notifikasi', () => {
  const deps = { onUnauthenticated: vi.fn(), notify: vi.fn() };
  handleGlobalError(new RpcError('UNAUTHENTICATED', 'x', 'r'), deps);
  expect(deps.onUnauthenticated).toHaveBeenCalledOnce();
  handleGlobalError(new RpcError('FORBIDDEN', 'x', 'r'), deps);
  expect(deps.notify).toHaveBeenCalledWith('Anda tidak memiliki akses untuk aksi ini.');
  handleGlobalError(new RpcError('VALIDATION', 'x', 'r'), deps);
  handleGlobalError(new Error('lain'), deps);
  expect(deps.onUnauthenticated).toHaveBeenCalledOnce();
  expect(deps.notify).toHaveBeenCalledOnce();
});
```

`web/src/app/query-client.ts`:

```ts
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RpcError } from '@/lib/rpc/rpc-error';

export function shouldRetry(failureCount: number, error: unknown): boolean {
  return error instanceof RpcError && error.code === 'INTERNAL' && failureCount < 1;
}

export interface GlobalErrorDeps {
  onUnauthenticated: () => void;
  notify: (message: string) => void;
}

export function handleGlobalError(error: unknown, deps: GlobalErrorDeps): void {
  if (!(error instanceof RpcError)) return;
  if (error.code === 'UNAUTHENTICATED') deps.onUnauthenticated();
  else if (error.code === 'FORBIDDEN') deps.notify('Anda tidak memiliki akses untuk aksi ini.');
}

let unauthenticatedHandler: () => void = () => undefined;

/** Dipasang di main.tsx setelah router dibuat (menghindari import melingkar). */
export function setUnauthenticatedHandler(handler: () => void): void {
  unauthenticatedHandler = handler;
}

const globalDeps: GlobalErrorDeps = {
  onUnauthenticated: () => unauthenticatedHandler(),
  notify: (message) => toast.error(message),
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error) => handleGlobalError(error, globalDeps) }),
  mutationCache: new MutationCache({ onError: (error) => handleGlobalError(error, globalDeps) }),
  defaultOptions: {
    queries: { retry: shouldRetry, staleTime: 60_000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
```

- [ ] **Step 6: Mock backend — test yang gagal**

`web/src/lib/rpc/mock-backend.test.ts`:

```ts
import { expect, test } from 'vitest';
import { MOCK_ADMIN_EMAIL, mockLogin, mockTransport } from './mock-backend';

async function call(method: string, payload: unknown, token: string) {
  return JSON.parse(await mockTransport.call(method, JSON.stringify(payload), token));
}

function tokenOf(email: string): string {
  const result = mockLogin(email);
  if (!('token' in result)) throw new Error(`login ${email} ditolak`);
  return result.token;
}

test('super admin login dan memanggil auth.me lewat router GAS yang sama', async () => {
  const result = await call('auth.me', null, tokenOf(MOCK_ADMIN_EMAIL));
  expect(result).toMatchObject({ ok: true, data: { email: MOCK_ADMIN_EMAIL, isSuperAdmin: true } });
});

test('email tidak terdaftar ditolak saat login mock', () => {
  expect(mockLogin('asing@gmail.com')).toEqual({ authError: 'NOT_WHITELISTED', email: 'asing@gmail.com' });
  expect(mockLogin('nonaktif@qc.local')).toEqual({ authError: 'NOT_WHITELISTED', email: 'nonaktif@qc.local' });
});

test('user tanpa akses manage mendapat FORBIDDEN saat menyimpan user', async () => {
  const input = { email: 'x@qc.local', name: 'X', status: 'active', roleIds: [] };
  const result = await call('access.users.save', input, tokenOf('qc.staff@qc.local'));
  expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
});
```

- [ ] **Step 7: Implementasi `mock-backend.ts` dan `index.ts`**

`web/src/lib/rpc/mock-backend.ts`:

```ts
import { role, user } from '@gas-test/access-fixtures';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { setPlatform_ } from '@gas/core/platform';
import { handleRpc_ } from '@gas/core/router';
import { signSessionToken_ } from '@gas/core/session';
import { loadUserContext_ } from '@gas/modules/access/context';
import { insertRole_, insertUser_ } from '@gas/modules/access/repo';
import { getRoutes_ } from '@gas/routes';
import type { RpcTransport } from './transport';

/** Backend tiruan untuk `bun run dev`: menjalankan router & layanan GAS asli di browser dengan data in-memory. */
export const MOCK_ADMIN_EMAIL = 'admin@qc.local';
const MOCK_LATENCY_MS = import.meta.env.MODE === 'test' ? 0 : 250;

export interface MockUser {
  email: string;
  label: string;
}

export const MOCK_USERS: MockUser[] = [
  { email: MOCK_ADMIN_EMAIL, label: 'Super Admin' },
  { email: 'qc.staff@qc.local', label: 'QC Staff (item: ubah, serah terima: ubah, stok: lihat)' },
  { email: 'wh.staff@qc.local', label: 'WH Staff (serah terima: lihat, stok: lihat)' },
  { email: 'access.viewer@qc.local', label: 'Pemantau Akses (akses: lihat)' },
  { email: 'nonaktif@qc.local', label: 'User nonaktif' },
  { email: 'asing@gmail.com', label: 'Email tidak terdaftar' },
];

let ready = false;

function ensureMockBackend(): void {
  if (ready) return;
  ready = true;
  setPlatform_(
    createMemoryPlatform({
      properties: {
        SPREADSHEET_ID: 'mock',
        SESSION_SECRET: 'mock-secret',
        ADMIN_EMAIL: MOCK_ADMIN_EMAIL,
        OAUTH_CLIENT_ID: 'mock',
        OAUTH_CLIENT_SECRET: 'mock',
        OAUTH_REDIRECT_URI: 'http://localhost:3000',
      },
    }),
  );
  insertRole_(role({ id: 'role-qc', name: 'QC Staff', description: 'Petugas QC', permissions: { item: 'edit', handover: 'edit', stock: 'view' } }));
  insertRole_(role({ id: 'role-wh', name: 'WH Staff', description: 'Petugas gudang', permissions: { handover: 'view', stock: 'view' } }));
  insertRole_(role({ id: 'role-access-viewer', name: 'Pemantau Akses', permissions: { access: 'view' } }));
  insertUser_(user({ id: 'user-qc', email: 'qc.staff@qc.local', name: 'Siti QC', roleIds: ['role-qc'] }));
  insertUser_(user({ id: 'user-wh', email: 'wh.staff@qc.local', name: 'Andi Gudang', roleIds: ['role-wh'] }));
  insertUser_(user({ id: 'user-viewer', email: 'access.viewer@qc.local', name: 'Rina Audit', roleIds: ['role-access-viewer'] }));
  insertUser_(user({ id: 'user-off', email: 'nonaktif@qc.local', name: 'Dedi Nonaktif', status: 'inactive', roleIds: ['role-qc'] }));
}

export function mockLogin(email: string): { token: string } | { authError: 'NOT_WHITELISTED'; email: string } {
  ensureMockBackend();
  return loadUserContext_(email) ? { token: signSessionToken_(email) } : { authError: 'NOT_WHITELISTED', email };
}

export const mockTransport: RpcTransport = {
  async call(method, payloadJson, token) {
    ensureMockBackend();
    await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
    return JSON.stringify(handleRpc_(method, payloadJson, token, getRoutes_()));
  },
};
```

`web/src/lib/rpc/index.ts`:

```ts
import { getToken } from '@/modules/auth/session';
import { createRpcClient } from './client';
import { gasTransport } from './gas-transport';
import type { RpcTransport } from './transport';

/** Mock dimuat lazy hanya saat dev, sehingga tidak ikut ter-bundle ke build produksi (dicek verify-dist). */
function createDevTransport(): RpcTransport {
  return {
    async call(method, payloadJson, token) {
      const { mockTransport } = await import('./mock-backend');
      return mockTransport.call(method, payloadJson, token);
    },
  };
}

export const rpc = createRpcClient(import.meta.env.DEV ? createDevTransport() : gasTransport, getToken);
```

- [ ] **Step 8: Jalankan test, typecheck, build**

Run: `bun run --cwd web test` → Expected: semua PASS.
Run: `bun run --cwd web typecheck` → Expected: tanpa error.
Run: `bun run build` → Expected: `verify-dist OK` (memastikan `mock-secret` tidak ter-bundle).

- [ ] **Step 9: Commit**

```bash
bun run format
git add web/src
git commit -m "feat(web): klien RPC bertipe, sesi, boot, query client, dan mock backend" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Router, guard akses, sinkronisasi URL, shell, dan halaman login

**Files:**
- Create: `web/src/modules/auth/queries.ts`, `permissions.ts`, `use-me.ts`, `use-logout.ts`, `components/login-panel.tsx`, `components/dev-login-picker.tsx`
- Create: `web/src/app/gas-location.ts`, `router.ts`, `navigation.ts`, `module-links.ts`, `shell/app-shell.tsx`, `shell/app-sidebar.tsx`, `shell/user-menu.tsx`, `shell/status-message.tsx`, `shell/error-view.tsx`
- Create: `web/src/routes/login.tsx`, `web/src/routes/_app.tsx`, `web/src/routes/_app/index.tsx`, `web/src/routes/_app/forbidden.tsx`
- Modify (tulis ulang): `web/src/routes/__root.tsx`, `web/src/main.tsx`
- Delete: `web/src/routes/index.tsx`
- Test: `web/src/modules/auth/permissions.test.ts`, `web/src/app/gas-location.test.ts`, `web/src/app/navigation.test.ts`, `web/src/modules/auth/components/login-panel.test.tsx`

**Interfaces:**
- Consumes: `rpc`, `RpcError`, `describeError`, `MOCK_USERS`, `mockLogin` (Task 11); sesi & boot & `queryClient` (Task 11); `hasLevel`, `MODULES`, `MODULE_LABELS` (Task 2).
- Produces: `meQueryKey`, `meQueryOptions()`; `can(me, module, level): boolean`; `requirePermission(queryClient, module, level): Promise<void>` (redirect ke `/forbidden`); `useMe(): MeDto`; `useLogout(): () => void`; `restoreHashFromTop(win?)`, `syncTopUrl(hash, win?)`; `createAppRouter(queryClient)`; `NavItem`, `NavGroup`, `NAV_GROUPS`, `visibleNavGroups(groups, me)`; `MODULE_LINKS: Partial<Record<ModuleKey, LinkProps['to']>>`; `StatusMessage`; route `/login`, layout `/_app`, `/`, `/forbidden`.

- [ ] **Step 1: Tulis test yang gagal**

`web/src/modules/auth/permissions.test.ts`:

```ts
import { expect, test } from 'vitest';
import type { MeDto } from '@shared/rpc';
import { can } from './permissions';

const me: MeDto = {
  email: 'a@gmail.com',
  name: 'A',
  isSuperAdmin: false,
  permissions: { access: 'view', item: 'manage', handover: 'none', stock: 'edit' },
};

test('can memeriksa level minimum per modul', () => {
  expect(can(me, 'access', 'view')).toBe(true);
  expect(can(me, 'access', 'manage')).toBe(false);
  expect(can(me, 'item', 'edit')).toBe(true);
  expect(can(me, 'handover', 'view')).toBe(false);
  expect(can(undefined, 'item', 'view')).toBe(false);
});
```

`web/src/app/gas-location.test.ts`:

```ts
import { afterEach, expect, test, vi } from 'vitest';
import { TOP_LOCATION_TIMEOUT_MS, restoreHashFromTop, syncTopUrl } from './gas-location';

function fakeWindow(options: { topHash?: string; ownHash?: string; respond?: boolean }) {
  const replace = vi.fn();
  const win = {
    location: { hash: options.ownHash ?? '' },
    google: {
      script: {
        url: {
          getLocation: (callback: (location: { hash: string; parameter: object; parameters: object }) => void) => {
            if (options.respond !== false) callback({ hash: options.topHash ?? '', parameter: {}, parameters: {} });
          },
        },
        history: { replace, push: vi.fn() },
      },
    },
  };
  return { win: win as unknown as Window, replace };
}

afterEach(() => vi.useRealTimers());

test('hash dari URL atas dipulihkan ke iframe saat iframe belum punya hash', async () => {
  const { win } = fakeWindow({ topHash: '/access/users' });
  await restoreHashFromTop(win);
  expect(win.location.hash).toBe('/access/users');
});

test('hash iframe yang sudah ada tidak ditimpa', async () => {
  const { win } = fakeWindow({ topHash: '/access/users', ownHash: '#/forbidden' });
  await restoreHashFromTop(win);
  expect(win.location.hash).toBe('#/forbidden');
});

test('di luar GAS atau bila callback tidak pernah datang, tetap selesai', async () => {
  await expect(restoreHashFromTop({ location: { hash: '' } } as unknown as Window)).resolves.toBeUndefined();
  vi.useFakeTimers();
  const { win } = fakeWindow({ respond: false });
  const pending = restoreHashFromTop(win);
  vi.advanceTimersByTime(TOP_LOCATION_TIMEOUT_MS);
  await expect(pending).resolves.toBeUndefined();
});

test('syncTopUrl menyalin hash ke URL atas dan membersihkan query ?code&state', () => {
  const { win, replace } = fakeWindow({});
  syncTopUrl('#/access/roles', win);
  expect(replace).toHaveBeenCalledWith(null, {}, '/access/roles');
});
```

`web/src/app/navigation.test.ts`:

```ts
import { House, Users } from 'lucide-react';
import { expect, test } from 'vitest';
import type { MeDto } from '@shared/rpc';
import type { NavGroup } from './navigation';
import { visibleNavGroups } from './navigation';

const groups: NavGroup[] = [
  { label: 'Umum', items: [{ label: 'Beranda', to: '/', icon: House }] },
  {
    label: 'Akses',
    items: [{ label: 'Users', to: '/', icon: Users, permission: { module: 'access', level: 'view' } }],
  },
];

test('item tanpa izin disembunyikan dan grup kosong dibuang', () => {
  const me: MeDto = {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    permissions: { access: 'none', item: 'view', handover: 'none', stock: 'none' },
  };
  expect(visibleNavGroups(groups, me).map((group) => group.label)).toEqual(['Umum']);
  expect(
    visibleNavGroups(groups, { ...me, permissions: { ...me.permissions, access: 'view' } }).map((g) => g.label),
  ).toEqual(['Umum', 'Akses']);
});
```

`web/src/modules/auth/components/login-panel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { LoginPanel } from './login-panel';

test('menampilkan email yang belum terdaftar dan tombol login ke Google di jendela utama', () => {
  render(<LoginPanel loginUrl="https://accounts.google.com/x" authError="NOT_WHITELISTED" authErrorEmail="asing@gmail.com" />);
  expect(screen.getByText(/asing@gmail\.com belum terdaftar/)).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'Masuk dengan Google' });
  expect(link).toHaveAttribute('href', 'https://accounts.google.com/x');
  expect(link).toHaveAttribute('target', '_top');
});

test('menampilkan pesan login gagal', () => {
  render(<LoginPanel loginUrl="u" authError="LOGIN_FAILED" authErrorEmail={null} />);
  expect(screen.getByText('Login gagal')).toBeInTheDocument();
});

test('tanpa loginUrl tidak ada tombol login', () => {
  render(<LoginPanel loginUrl={null} authError={null} authErrorEmail={null} />);
  expect(screen.queryByRole('link')).toBeNull();
});
```

Run: `bun run --cwd web test` → Expected: FAIL (modul belum ada).

- [ ] **Step 2: Modul auth — `queries.ts`, `permissions.ts`, `use-me.ts`, `use-logout.ts`**

`web/src/modules/auth/queries.ts`:

```ts
import { queryOptions } from '@tanstack/react-query';
import { rpc } from '@/lib/rpc';

export const meQueryKey = ['auth', 'me'] as const;

export function meQueryOptions() {
  return queryOptions({ queryKey: meQueryKey, queryFn: () => rpc('auth.me', null), staleTime: 5 * 60 * 1000 });
}
```

`web/src/modules/auth/permissions.ts`:

```ts
import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import type { Level, ModuleKey } from '@shared/permissions';
import { hasLevel } from '@shared/permissions';
import type { MeDto } from '@shared/rpc';
import { meQueryOptions } from './queries';

/** Hanya untuk UX — penegakan sebenarnya ada di router GAS. */
export function can(me: MeDto | null | undefined, module: ModuleKey, level: Level): boolean {
  return me ? hasLevel(me.permissions[module], level) : false;
}

export async function requirePermission(queryClient: QueryClient, module: ModuleKey, level: Level): Promise<void> {
  const me = await queryClient.ensureQueryData(meQueryOptions());
  if (!can(me, module, level)) throw redirect({ to: '/forbidden' });
}
```

`web/src/modules/auth/use-me.ts`:

```ts
import { useSuspenseQuery } from '@tanstack/react-query';
import type { MeDto } from '@shared/rpc';
import { meQueryOptions } from './queries';

export function useMe(): MeDto {
  return useSuspenseQuery(meQueryOptions()).data;
}
```

`web/src/modules/auth/use-logout.ts`:

```ts
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { clearToken } from './session';

export function useLogout(): () => void {
  const router = useRouter();
  const queryClient = useQueryClient();
  return () => {
    clearToken();
    queryClient.clear();
    void router.navigate({ to: '/login' });
  };
}
```

- [ ] **Step 3: Komponen login**

`web/src/modules/auth/components/login-panel.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { AuthErrorCode } from '@shared/rpc';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export interface LoginPanelProps {
  loginUrl: string | null;
  authError: AuthErrorCode | null;
  authErrorEmail: string | null;
  children?: ReactNode;
}

export function LoginPanel({ loginUrl, authError, authErrorEmail, children }: LoginPanelProps) {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>QC App</CardTitle>
        <CardDescription>Masuk dengan akun Google yang sudah terdaftar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {authError === 'NOT_WHITELISTED' ? (
          <Alert variant="destructive">
            <AlertTitle>Email belum terdaftar</AlertTitle>
            <AlertDescription>
              {authErrorEmail ? `Email ${authErrorEmail} belum terdaftar.` : 'Email Anda belum terdaftar.'} Hubungi
              admin untuk mendapatkan akses.
            </AlertDescription>
          </Alert>
        ) : null}
        {authError === 'LOGIN_FAILED' ? (
          <Alert variant="destructive">
            <AlertTitle>Login gagal</AlertTitle>
            <AlertDescription>Silakan coba lagi.</AlertDescription>
          </Alert>
        ) : null}
        {loginUrl ? (
          <Button asChild className="w-full">
            <a href={loginUrl} target="_top" rel="noopener">
              Masuk dengan Google
            </a>
          </Button>
        ) : null}
        {children}
      </CardContent>
    </Card>
  );
}
```

`web/src/modules/auth/components/dev-login-picker.tsx` (hanya dimuat saat `import.meta.env.DEV`):

```tsx
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MOCK_USERS, mockLogin } from '@/lib/rpc/mock-backend';
import { setToken } from '@/modules/auth/session';

export default function DevLoginPicker() {
  const navigate = useNavigate();
  const [rejected, setRejected] = useState<string | null>(null);

  function loginAs(email: string) {
    const result = mockLogin(email);
    if ('token' in result) {
      setToken(result.token);
      void navigate({ to: '/' });
    } else {
      setRejected(result.email);
    }
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-xs font-medium text-muted-foreground">Mode dev — masuk sebagai:</p>
      {MOCK_USERS.map((mockUser) => (
        <Button
          key={mockUser.email}
          variant="outline"
          className="h-auto w-full justify-start py-2 text-left"
          onClick={() => loginAs(mockUser.email)}
        >
          <span className="flex flex-col">
            <span className="text-sm">{mockUser.label}</span>
            <span className="text-xs text-muted-foreground">{mockUser.email}</span>
          </span>
        </Button>
      ))}
      {rejected ? <p className="text-sm text-destructive">Email {rejected} belum terdaftar.</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: Sinkronisasi URL GAS — `web/src/app/gas-location.ts`**

```ts
export const TOP_LOCATION_TIMEOUT_MS = 1500;

/** Pulihkan route dari hash URL atas (bookmark/refresh) sebelum router dibuat. */
export function restoreHashFromTop(win: Window = window): Promise<void> {
  const url = win.google?.script?.url;
  if (!url) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, TOP_LOCATION_TIMEOUT_MS);
    url.getLocation((location) => {
      clearTimeout(timer);
      const hash = (location.hash ?? '').replace(/^#/, '');
      if (hash && !win.location.hash) win.location.hash = hash;
      resolve();
    });
  });
}

/** Salin hash route ke URL atas sekaligus membuang query ?code&state sisa login. */
export function syncTopUrl(hash: string, win: Window = window): void {
  win.google?.script?.history.replace(null, {}, hash.replace(/^#/, ''));
}
```

- [ ] **Step 5: Navigasi & link modul**

`web/src/app/navigation.ts`:

```ts
import type { LinkProps } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { House } from 'lucide-react';
import type { Level, ModuleKey } from '@shared/permissions';
import type { MeDto } from '@shared/rpc';
import { can } from '@/modules/auth/permissions';

export interface NavItem {
  label: string;
  to: LinkProps['to'];
  icon: LucideIcon;
  permission?: { module: ModuleKey; level: Level };
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [{ label: 'Umum', items: [{ label: 'Beranda', to: '/', icon: House }] }];

export function visibleNavGroups(groups: readonly NavGroup[], me: MeDto): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !item.permission || can(me, item.permission.module, item.permission.level),
      ),
    }))
    .filter((group) => group.items.length > 0);
}
```

`web/src/app/module-links.ts`:

```ts
import type { LinkProps } from '@tanstack/react-router';
import type { ModuleKey } from '@shared/permissions';

/** Modul yang sudah punya halaman. Modul tanpa entri ditandai "Segera hadir" di beranda. */
export const MODULE_LINKS: Partial<Record<ModuleKey, LinkProps['to']>> = {};
```

- [ ] **Step 6: Shell**

`web/src/app/shell/status-message.tsx`:

```tsx
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

export function StatusMessage({ code, title, description }: { code: string; title: string; description: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-4 text-center">
      <p className="text-5xl font-bold text-muted-foreground">{code}</p>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{description}</p>
      <Button asChild variant="outline">
        <Link to="/">Kembali ke beranda</Link>
      </Button>
    </div>
  );
}
```

`web/src/app/shell/error-view.tsx`:

```tsx
import type { ErrorComponentProps } from '@tanstack/react-router';
import { useRouter } from '@tanstack/react-router';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/rpc/describe-error';

export function ErrorView({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4">
      <Alert variant="destructive" className="max-w-md">
        <AlertTitle>Terjadi kesalahan</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{describeError(error)}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              reset();
              void router.invalidate();
            }}
          >
            Coba lagi
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
```

`web/src/app/shell/user-menu.tsx`:

```tsx
import { LogOut } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLogout } from '@/modules/auth/use-logout';
import { useMe } from '@/modules/auth/use-me';

export function UserMenu() {
  const me = useMe();
  const logout = useLogout();
  const initials = (me.name || me.email).slice(0, 2).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2">
          <Avatar className="size-7">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden text-sm sm:inline">{me.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span>{me.name}</span>
          <span className="text-xs font-normal text-muted-foreground">{me.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout}>
          <LogOut />
          Keluar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

`web/src/app/shell/app-sidebar.tsx`:

```tsx
import { Link, useMatchRoute } from '@tanstack/react-router';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { NAV_GROUPS, visibleNavGroups } from '@/app/navigation';
import { useMe } from '@/modules/auth/use-me';

export function AppSidebar() {
  const me = useMe();
  const matchRoute = useMatchRoute();
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="px-2 py-1 text-lg font-semibold">QC App</div>
      </SidebarHeader>
      <SidebarContent>
        {visibleNavGroups(NAV_GROUPS, me).map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      asChild
                      isActive={Boolean(matchRoute({ to: item.to, fuzzy: item.to !== '/' }))}
                    >
                      <Link to={item.to}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
```

`web/src/app/shell/app-shell.tsx`:

```tsx
import { Outlet } from '@tanstack/react-router';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';
import { UserMenu } from './user-menu';

export function AppShell() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <div className="ml-auto">
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 7: Route**

Hapus `web/src/routes/index.tsx` (digantikan `/_app/index.tsx`).

`web/src/routes/__root.tsx`:

```tsx
import type { QueryClient } from '@tanstack/react-query';
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { Toaster } from '@/components/ui/sonner';
import { ErrorView } from '@/app/shell/error-view';
import { StatusMessage } from '@/app/shell/status-message';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <>
      <Outlet />
      <Toaster richColors position="top-right" />
    </>
  ),
  errorComponent: ErrorView,
  notFoundComponent: () => (
    <StatusMessage code="404" title="Halaman tidak ditemukan" description="Alamat yang Anda buka tidak tersedia." />
  ),
});
```

`web/src/routes/login.tsx`:

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';
import { LoginPanel } from '@/modules/auth/components/login-panel';
import { getSession, getToken } from '@/modules/auth/session';

const DevLoginPicker = import.meta.env.DEV ? lazy(() => import('@/modules/auth/components/dev-login-picker')) : null;

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    if (getToken()) throw redirect({ to: '/' });
  },
  component: LoginPage,
});

function LoginPage() {
  const session = getSession();
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <LoginPanel loginUrl={session.loginUrl} authError={session.authError} authErrorEmail={session.authErrorEmail}>
        {DevLoginPicker ? (
          <Suspense fallback={null}>
            <DevLoginPicker />
          </Suspense>
        ) : null}
      </LoginPanel>
    </div>
  );
}
```

`web/src/routes/_app.tsx`:

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router';
import { AppShell } from '@/app/shell/app-shell';
import { RpcError } from '@/lib/rpc/rpc-error';
import { meQueryOptions } from '@/modules/auth/queries';
import { clearToken, getToken } from '@/modules/auth/session';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    if (!getToken()) throw redirect({ to: '/login' });
    try {
      await context.queryClient.ensureQueryData(meQueryOptions());
    } catch (error) {
      if (error instanceof RpcError && error.code === 'UNAUTHENTICATED') {
        clearToken();
        context.queryClient.clear();
        throw redirect({ to: '/login' });
      }
      throw error;
    }
  },
  component: AppShell,
});
```

`web/src/routes/_app/index.tsx`:

```tsx
import { Link, createFileRoute } from '@tanstack/react-router';
import type { ModuleKey } from '@shared/permissions';
import { MODULES, MODULE_LABELS } from '@shared/permissions';
import { MODULE_LINKS } from '@/app/module-links';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { can } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

export const Route = createFileRoute('/_app/')({ component: HomePage });

function ModuleCard({ module }: { module: ModuleKey }) {
  const to = MODULE_LINKS[module];
  const card = (
    <Card className={to ? 'transition-colors hover:bg-muted/50' : 'opacity-70'}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          {MODULE_LABELS[module]}
          {to ? null : <Badge variant="secondary">Segera hadir</Badge>}
        </CardTitle>
      </CardHeader>
    </Card>
  );
  return to ? <Link to={to}>{card}</Link> : card;
}

function HomePage() {
  const me = useMe();
  const modules = MODULES.filter((module) => can(me, module, 'view'));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Selamat datang, {me.name}</h1>
        <p className="text-muted-foreground">Pilih modul yang ingin dibuka.</p>
      </div>
      {modules.length === 0 ? (
        <Alert>
          <AlertDescription>Anda belum memiliki akses ke modul apa pun. Hubungi admin.</AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((module) => (
            <ModuleCard key={module} module={module} />
          ))}
        </div>
      )}
    </div>
  );
}
```

`web/src/routes/_app/forbidden.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { StatusMessage } from '@/app/shell/status-message';

export const Route = createFileRoute('/_app/forbidden')({
  component: () => (
    <StatusMessage code="403" title="Akses ditolak" description="Anda tidak memiliki akses ke halaman ini." />
  ),
});
```

- [ ] **Step 8: Router & entry**

`web/src/app/router.ts`:

```ts
import type { QueryClient } from '@tanstack/react-query';
import { createHashHistory, createRouter } from '@tanstack/react-router';
import { routeTree } from '@/routeTree.gen';

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    history: createHashHistory(),
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
```

`web/src/main.tsx` (tulis ulang):

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { readBoot, resolveInitialSession } from '@/app/boot';
import { restoreHashFromTop, syncTopUrl } from '@/app/gas-location';
import { queryClient, setUnauthenticatedHandler } from '@/app/query-client';
import { createAppRouter } from '@/app/router';
import { clearToken, initSession, readStoredToken } from '@/modules/auth/session';
import './styles.css';

async function start() {
  initSession(resolveInitialSession(readBoot(), readStoredToken()));
  await restoreHashFromTop();

  const router = createAppRouter(queryClient);
  setUnauthenticatedHandler(() => {
    clearToken();
    queryClient.clear();
    void router.navigate({ to: '/login' });
  });
  router.subscribe('onResolved', () => syncTopUrl(window.location.hash));
  syncTopUrl(window.location.hash);

  const root = document.getElementById('app');
  if (!root) throw new Error('Elemen #app tidak ditemukan');
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

void start();
```

- [ ] **Step 9: Verifikasi**

Run: `bun run --cwd web test` → Expected: semua PASS.
Run: `bun run build` (membuat ulang `routeTree.gen.ts`) lalu `bun run --cwd web typecheck` → Expected: tanpa error.

Run: `bun run dev`, buka `http://localhost:3000` → Expected:
- diarahkan ke `#/login`, tampil daftar user mock;
- pilih "Super Admin" → beranda "Selamat datang, admin@qc.local" dengan 4 kartu "Segera hadir"; menu user → "Keluar" kembali ke login;
- pilih "Email tidak terdaftar" → pesan "Email asing@gmail.com belum terdaftar.";
- pilih "WH Staff" → hanya kartu Serah Terima & Monitoring Stok;
- buka `#/tidak-ada` → halaman 404.

- [ ] **Step 10: Commit**

```bash
bun run format
git add web/src
git commit -m "feat(web): router hash dengan guard login, shell sidebar, halaman login, 403/404" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: UI pengelolaan akses (Users & Roles)

**Files:**
- Create: `web/src/components/field-error.tsx`, `web/src/components/native-select.tsx`
- Create: `web/src/modules/access/queries.ts`, `schemas.ts`, `lib/filter-users.ts`, `components/user-form.tsx`, `components/role-form.tsx`, `components/users-table.tsx`, `components/roles-table.tsx`, `components/permission-badges.tsx`
- Create: `web/src/routes/_app/access/users.tsx`, `web/src/routes/_app/access/roles.tsx`
- Modify: `web/src/app/navigation.ts` (grup "Pengaturan Akses"), `web/src/app/module-links.ts` (`access`)
- Test: `web/src/modules/access/lib/filter-users.test.ts`, `components/user-form.test.tsx`, `components/role-form.test.tsx`

**Interfaces:**
- Consumes: `rpc`, `describeError` (Task 11); `meQueryKey`, `can`, `requirePermission`, `useMe` (Task 12); `MODULES`, `LEVELS`, `MODULE_LABELS`, `LEVEL_LABELS`, `emptyPermissions` (Task 2); DTO & input dari `@shared/rpc`.
- Produces: `accessKeys`, `usersQueryOptions()`, `rolesQueryOptions()`, `useSaveUser()`, `useSetUserStatus()`, `useSaveRole()`, `useDeleteRole()`; `userFormSchema`, `roleFormSchema`, `UserFormInput/Output`, `RoleFormInput/Output`, `toUserFormDefaults(user?)`, `toRoleFormDefaults(role?)`; `filterUsers(users, { q, status })`; komponen `UserForm`, `RoleForm`, `UsersTable`, `RolesTable`, `PermissionBadges`, `FieldError`, `NativeSelect`.

- [ ] **Step 1: Tulis test yang gagal**

`web/src/modules/access/lib/filter-users.test.ts`:

```ts
import { expect, test } from 'vitest';
import type { UserDto } from '@shared/rpc';
import { filterUsers } from './filter-users';

const base = { roleIds: [], createdAt: '', updatedAt: '', updatedBy: '' };
const users: UserDto[] = [
  { ...base, id: '1', email: 'budi@gmail.com', name: 'Budi Santoso', status: 'active' },
  { ...base, id: '2', email: 'ani@gmail.com', name: 'Ani', status: 'inactive' },
];

test('mencari di email atau nama tanpa membedakan huruf besar, dan memfilter status', () => {
  expect(filterUsers(users, { q: 'SANTOSO', status: 'all' }).map((u) => u.id)).toEqual(['1']);
  expect(filterUsers(users, { q: 'ani@', status: 'all' }).map((u) => u.id)).toEqual(['2']);
  expect(filterUsers(users, { q: '', status: 'inactive' }).map((u) => u.id)).toEqual(['2']);
  expect(filterUsers(users, { q: '  ', status: 'all' })).toHaveLength(2);
});
```

`web/src/modules/access/components/user-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { RoleDto } from '@shared/rpc';
import { toUserFormDefaults } from '../schemas';
import { UserForm } from './user-form';

const roles: RoleDto[] = [
  { id: 'role-qc', name: 'QC Staff', description: '', permissions: {}, userCount: 0, createdAt: '', updatedAt: '', updatedBy: '' },
];

function renderForm(props: Partial<Parameters<typeof UserForm>[0]> = {}) {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <UserForm mode="create" defaultValues={toUserFormDefaults()} roles={roles} onSubmit={onSubmit} onCancel={() => undefined} {...props} />,
  );
  return { onSubmit };
}

test('menampilkan error dan tidak mengirim bila field wajib kosong', async () => {
  const { onSubmit } = renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findAllByText('Wajib diisi')).toHaveLength(2);
  expect(onSubmit).not.toHaveBeenCalled();
});

test('menolak format email yang salah', async () => {
  renderForm();
  await userEvent.type(screen.getByLabelText('Email'), 'budi');
  await userEvent.type(screen.getByLabelText('Nama'), 'Budi');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Format email tidak valid')).toBeInTheDocument();
});

test('mengirim nilai yang sudah dinormalisasi', async () => {
  const { onSubmit } = renderForm();
  await userEvent.type(screen.getByLabelText('Email'), ' Budi@Gmail.COM ');
  await userEvent.type(screen.getByLabelText('Nama'), '  Budi ');
  await userEvent.click(screen.getByRole('checkbox', { name: 'QC Staff' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({ email: 'budi@gmail.com', name: 'Budi', status: 'active', roleIds: ['role-qc'] }),
  );
});

test('email terkunci saat edit dan pesan error server ditampilkan', () => {
  renderForm({ mode: 'edit', submitError: 'Email sudah terdaftar' });
  expect(screen.getByLabelText('Email')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Email sudah terdaftar');
});
```

`web/src/modules/access/components/role-form.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { toRoleFormDefaults } from '../schemas';
import { RoleForm } from './role-form';

test('nama wajib diisi', async () => {
  const onSubmit = vi.fn(async () => undefined);
  render(<RoleForm defaultValues={toRoleFormDefaults()} onSubmit={onSubmit} onCancel={() => undefined} />);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Wajib diisi')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('matriks level per modul dikirim lengkap', async () => {
  const onSubmit = vi.fn(async () => undefined);
  render(<RoleForm defaultValues={toRoleFormDefaults()} onSubmit={onSubmit} onCancel={() => undefined} />);
  await userEvent.type(screen.getByLabelText('Nama role'), ' QC Staff ');
  const itemGroup = screen.getByRole('group', { name: 'Level Data Item' });
  await userEvent.click(within(itemGroup).getByRole('button', { name: 'Kelola' }));
  expect(within(itemGroup).getByRole('button', { name: 'Kelola' })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'QC Staff',
      description: '',
      permissions: { access: 'none', item: 'manage', handover: 'none', stock: 'none' },
    }),
  );
});
```

Run: `bun run --cwd web test` → Expected: FAIL (modul belum ada).

- [ ] **Step 2: Komponen form umum**

`web/src/components/field-error.tsx`:

```tsx
function toMessage(error: unknown): string | null {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return null;
}

export function FieldError({ errors }: { errors: ReadonlyArray<unknown> }) {
  const messages = [...new Set(errors.map(toMessage).filter((message): message is string => Boolean(message)))];
  if (messages.length === 0) return null;
  return <p className="text-sm text-destructive">{messages.join(', ')}</p>;
}
```

`web/src/components/native-select.tsx`:

```tsx
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 3: Skema, filter, queries**

`web/src/modules/access/schemas.ts`:

```ts
import { z } from 'zod';
import { LEVELS, MODULES, emptyPermissions } from '@shared/permissions';
import type { RoleDto, UserDto } from '@shared/rpc';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const userFormSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Wajib diisi')
    .refine((value) => value.length === 0 || EMAIL_PATTERN.test(value), 'Format email tidak valid'),
  name: z.string().trim().min(1, 'Wajib diisi').max(100, 'Maksimal 100 karakter'),
  status: z.enum(['active', 'inactive']),
  roleIds: z.array(z.string()),
});
export type UserFormInput = z.input<typeof userFormSchema>;
export type UserFormOutput = z.output<typeof userFormSchema>;

export const roleFormSchema = z.object({
  name: z.string().trim().min(1, 'Wajib diisi').max(60, 'Maksimal 60 karakter'),
  description: z.string().trim().max(200, 'Maksimal 200 karakter'),
  permissions: z.record(z.enum(MODULES), z.enum(LEVELS)),
});
export type RoleFormInput = z.input<typeof roleFormSchema>;
export type RoleFormOutput = z.output<typeof roleFormSchema>;

export function toUserFormDefaults(user?: UserDto): UserFormInput {
  return user
    ? { email: user.email, name: user.name, status: user.status, roleIds: [...user.roleIds] }
    : { email: '', name: '', status: 'active', roleIds: [] };
}

export function toRoleFormDefaults(role?: RoleDto): RoleFormInput {
  return {
    name: role?.name ?? '',
    description: role?.description ?? '',
    permissions: { ...emptyPermissions(), ...role?.permissions },
  };
}
```

`web/src/modules/access/lib/filter-users.ts`:

```ts
import type { UserDto, UserStatus } from '@shared/rpc';

export interface UserFilter {
  q: string;
  status: UserStatus | 'all';
}

export function filterUsers(users: readonly UserDto[], filter: UserFilter): UserDto[] {
  const query = filter.q.trim().toLowerCase();
  return users.filter((user) => {
    if (filter.status !== 'all' && user.status !== filter.status) return false;
    if (!query) return true;
    return user.email.includes(query) || user.name.toLowerCase().includes(query);
  });
}
```

`web/src/modules/access/queries.ts`:

```ts
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { DeleteRoleInput, SaveRoleInput, SaveUserInput, SetUserStatusInput } from '@shared/rpc';
import { rpc } from '@/lib/rpc';
import { meQueryKey } from '@/modules/auth/queries';

export const accessKeys = {
  all: ['access'] as const,
  users: ['access', 'users'] as const,
  roles: ['access', 'roles'] as const,
};

export function usersQueryOptions() {
  return queryOptions({ queryKey: accessKeys.users, queryFn: () => rpc('access.users.list', null) });
}

export function rolesQueryOptions() {
  return queryOptions({ queryKey: accessKeys.roles, queryFn: () => rpc('access.roles.list', null) });
}

/** Perubahan akses bisa mengubah hak user yang sedang login, jadi `auth.me` ikut di-refresh. */
function useAccessMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accessKeys.all }),
        queryClient.invalidateQueries({ queryKey: meQueryKey }),
      ]);
    },
  });
}

export const useSaveUser = () => useAccessMutation((input: SaveUserInput) => rpc('access.users.save', input));
export const useSetUserStatus = () =>
  useAccessMutation((input: SetUserStatusInput) => rpc('access.users.setStatus', input));
export const useSaveRole = () => useAccessMutation((input: SaveRoleInput) => rpc('access.roles.save', input));
export const useDeleteRole = () => useAccessMutation((input: DeleteRoleInput) => rpc('access.roles.delete', input));
```

- [ ] **Step 4: `UserForm` — `web/src/modules/access/components/user-form.tsx`**

```tsx
import { useForm } from '@tanstack/react-form';
import type { RoleDto } from '@shared/rpc';
import { FieldError } from '@/components/field-error';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { UserFormInput, UserFormOutput } from '../schemas';
import { userFormSchema } from '../schemas';

export interface UserFormProps {
  mode: 'create' | 'edit';
  defaultValues: UserFormInput;
  roles: readonly RoleDto[];
  submitError?: string | null;
  onSubmit: (values: UserFormOutput) => Promise<unknown>;
  onCancel: () => void;
}

export function UserForm({ mode, defaultValues, roles, submitError, onSubmit, onCancel }: UserFormProps) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: userFormSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(userFormSchema.parse(value));
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
      <form.Field name="email">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="user-email">Email</Label>
            <Input
              id="user-email"
              type="email"
              value={field.state.value}
              disabled={mode === 'edit'}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="name">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="user-name">Nama</Label>
            <Input
              id="user-name"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="status">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="user-status">Status</Label>
            <NativeSelect
              id="user-status"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as UserFormInput['status'])}
            >
              <option value="active">Aktif</option>
              <option value="inactive">Nonaktif</option>
            </NativeSelect>
          </div>
        )}
      </form.Field>
      <form.Field name="roleIds">
        {(field) => (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Role</legend>
            {roles.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada role.</p> : null}
            {roles.map((role) => {
              const checked = field.state.value.includes(role.id);
              return (
                <div key={role.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`role-${role.id}`}
                    checked={checked}
                    onCheckedChange={(next) =>
                      field.handleChange(
                        next === true
                          ? [...field.state.value, role.id]
                          : field.state.value.filter((id) => id !== role.id),
                      )
                    }
                  />
                  <Label htmlFor={`role-${role.id}`} className="font-normal">
                    {role.name}
                  </Label>
                </div>
              );
            })}
          </fieldset>
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

Catatan: saat `isSubmitting`, label tombol berubah menjadi "Menyimpan…"; test memakai `waitFor` untuk `onSubmit` sehingga tidak bergantung pada label ini.

- [ ] **Step 5: `RoleForm` — `web/src/modules/access/components/role-form.tsx`**

```tsx
import { useForm } from '@tanstack/react-form';
import { LEVELS, LEVEL_LABELS, MODULES, MODULE_LABELS } from '@shared/permissions';
import { FieldError } from '@/components/field-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { RoleFormInput, RoleFormOutput } from '../schemas';
import { roleFormSchema } from '../schemas';

export interface RoleFormProps {
  defaultValues: RoleFormInput;
  submitError?: string | null;
  onSubmit: (values: RoleFormOutput) => Promise<unknown>;
  onCancel: () => void;
}

export function RoleForm({ defaultValues, submitError, onSubmit, onCancel }: RoleFormProps) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: roleFormSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(roleFormSchema.parse(value));
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
      <form.Field name="name">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="role-name">Nama role</Label>
            <Input
              id="role-name"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="description">
        {(field) => (
          <div className="space-y-1.5">
            <Label htmlFor="role-description">Deskripsi</Label>
            <Textarea
              id="role-description"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="permissions">
        {(field) => (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Akses per modul</legend>
            {MODULES.map((module) => (
              <div
                key={module}
                className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="text-sm">{MODULE_LABELS[module]}</span>
                <div role="group" aria-label={`Level ${MODULE_LABELS[module]}`} className="flex flex-wrap gap-1">
                  {LEVELS.map((level) => {
                    const active = field.state.value[module] === level;
                    return (
                      <Button
                        key={level}
                        type="button"
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        aria-pressed={active}
                        onClick={() => field.handleChange({ ...field.state.value, [module]: level })}
                      >
                        {LEVEL_LABELS[level]}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ))}
          </fieldset>
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

Run: `bun run --cwd web test` → Expected: `filter-users`, `user-form`, `role-form` PASS.

- [ ] **Step 6: Tabel & badge**

`web/src/modules/access/components/permission-badges.tsx`:

```tsx
import type { PartialPermissionMap } from '@shared/permissions';
import { LEVEL_LABELS, MODULES, MODULE_LABELS } from '@shared/permissions';
import { Badge } from '@/components/ui/badge';

export function PermissionBadges({ permissions }: { permissions: PartialPermissionMap }) {
  const entries = MODULES.flatMap((module) => {
    const level = permissions[module];
    return level && level !== 'none' ? [{ module, level }] : [];
  });
  if (entries.length === 0) return <span className="text-sm text-muted-foreground">Tanpa akses</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(({ module, level }) => (
        <Badge key={module} variant="secondary">
          {MODULE_LABELS[module]}: {LEVEL_LABELS[level]}
        </Badge>
      ))}
    </div>
  );
}
```

`web/src/modules/access/components/users-table.tsx`:

```tsx
import type { UserDto } from '@shared/rpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface UsersTableProps {
  users: readonly UserDto[];
  roleNames: ReadonlyMap<string, string>;
  canManage: boolean;
  currentEmail: string;
  pendingStatusId: string | null;
  onEdit: (user: UserDto) => void;
  onToggleStatus: (user: UserDto) => void;
}

export function UsersTable({ users, roleNames, canManage, currentEmail, pendingStatusId, onEdit, onToggleStatus }: UsersTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Nama</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            {canManage ? <TableHead className="text-right">Aksi</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canManage ? 5 : 4} className="text-center text-muted-foreground">
                Tidak ada user yang cocok.
              </TableCell>
            </TableRow>
          ) : null}
          {users.map((user) => {
            const isSelf = user.email === currentEmail;
            return (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.email}</TableCell>
                <TableCell>{user.name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {user.roleIds.length === 0 ? <span className="text-muted-foreground">—</span> : null}
                    {user.roleIds.map((id) => (
                      <Badge key={id} variant="outline">
                        {roleNames.get(id) ?? '(role dihapus)'}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={user.status === 'active' ? 'default' : 'secondary'}>
                    {user.status === 'active' ? 'Aktif' : 'Nonaktif'}
                  </Badge>
                </TableCell>
                {canManage ? (
                  <TableCell className="space-x-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => onEdit(user)}>
                      Ubah
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pendingStatusId === user.id || (isSelf && user.status === 'active')}
                      onClick={() => onToggleStatus(user)}
                    >
                      {user.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
```

`web/src/modules/access/components/roles-table.tsx`:

```tsx
import type { RoleDto } from '@shared/rpc';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PermissionBadges } from './permission-badges';

export interface RolesTableProps {
  roles: readonly RoleDto[];
  canManage: boolean;
  onEdit: (role: RoleDto) => void;
  onDelete: (role: RoleDto) => void;
}

export function RolesTable({ roles, canManage, onEdit, onDelete }: RolesTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nama</TableHead>
            <TableHead>Akses</TableHead>
            <TableHead className="text-right">User</TableHead>
            {canManage ? <TableHead className="text-right">Aksi</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canManage ? 4 : 3} className="text-center text-muted-foreground">
                Belum ada role.
              </TableCell>
            </TableRow>
          ) : null}
          {roles.map((role) => (
            <TableRow key={role.id}>
              <TableCell>
                <div className="font-medium">{role.name}</div>
                {role.description ? <div className="text-sm text-muted-foreground">{role.description}</div> : null}
              </TableCell>
              <TableCell>
                <PermissionBadges permissions={role.permissions} />
              </TableCell>
              <TableCell className="text-right">{role.userCount}</TableCell>
              {canManage ? (
                <TableCell className="space-x-2 text-right">
                  <Button size="sm" variant="outline" onClick={() => onEdit(role)}>
                    Ubah
                  </Button>
                  <Button size="sm" variant="ghost" disabled={role.userCount > 0} onClick={() => onDelete(role)}>
                    Hapus
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

- [ ] **Step 7: Halaman Users — `web/src/routes/_app/access/users.tsx`**

```tsx
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import type { UserDto } from '@shared/rpc';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { describeError } from '@/lib/rpc/describe-error';
import { UserForm } from '@/modules/access/components/user-form';
import { UsersTable } from '@/modules/access/components/users-table';
import { filterUsers } from '@/modules/access/lib/filter-users';
import { rolesQueryOptions, useSaveUser, useSetUserStatus, usersQueryOptions } from '@/modules/access/queries';
import type { UserFormOutput } from '@/modules/access/schemas';
import { toUserFormDefaults } from '@/modules/access/schemas';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

const usersSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
  status: z.enum(['all', 'active', 'inactive']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/access/users')({
  validateSearch: (search: Record<string, unknown>) => usersSearchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(usersQueryOptions()),
      context.queryClient.ensureQueryData(rolesQueryOptions()),
    ]);
  },
  component: UsersPage,
});

function UsersPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  const canManage = can(me, 'access', 'manage');
  const { data: users } = useSuspenseQuery(usersQueryOptions());
  const { data: roles } = useSuspenseQuery(rolesQueryOptions());
  const saveUser = useSaveUser();
  const setStatus = useSetUserStatus();
  const [editing, setEditing] = useState<UserDto | 'new' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const roleNames = new Map(roles.map((role) => [role.id, role.name]));
  const visible = filterUsers(users, { q: search.q ?? '', status: search.status ?? 'all' });

  function closeDialog() {
    setEditing(null);
    setSubmitError(null);
  }

  async function handleSubmit(values: UserFormOutput) {
    setSubmitError(null);
    try {
      await saveUser.mutateAsync(editing && editing !== 'new' ? { ...values, id: editing.id } : values);
      toast.success('User disimpan');
      closeDialog();
    } catch (error) {
      setSubmitError(describeError(error));
    }
  }

  function toggleStatus(user: UserDto) {
    const status = user.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: user.id, status },
      {
        onSuccess: () => toast.success(status === 'active' ? 'User diaktifkan' : 'User dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Users</h1>
        {canManage ? <Button onClick={() => setEditing('new')}>Tambah user</Button> : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Cari email atau nama"
          value={search.q ?? ''}
          onChange={(event) =>
            void navigate({ search: (prev) => ({ ...prev, q: event.target.value || undefined }), replace: true })
          }
        />
        <NativeSelect
          aria-label="Filter status"
          className="sm:w-48"
          value={search.status ?? 'all'}
          onChange={(event) =>
            void navigate({
              search: (prev) => ({ ...prev, status: event.target.value as 'all' | 'active' | 'inactive' }),
              replace: true,
            })
          }
        >
          <option value="all">Semua status</option>
          <option value="active">Aktif</option>
          <option value="inactive">Nonaktif</option>
        </NativeSelect>
      </div>
      <UsersTable
        users={visible}
        roleNames={roleNames}
        canManage={canManage}
        currentEmail={me.email}
        pendingStatusId={setStatus.isPending ? (setStatus.variables?.id ?? null) : null}
        onEdit={(user) => setEditing(user)}
        onToggleStatus={toggleStatus}
      />
      <Dialog open={editing !== null} onOpenChange={(open) => (open ? undefined : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Tambah user' : 'Ubah user'}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <UserForm
              key={editing === 'new' ? 'new' : editing.id}
              mode={editing === 'new' ? 'create' : 'edit'}
              defaultValues={toUserFormDefaults(editing === 'new' ? undefined : editing)}
              roles={roles}
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

- [ ] **Step 8: Halaman Roles — `web/src/routes/_app/access/roles.tsx`**

```tsx
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import type { RoleDto } from '@shared/rpc';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { describeError } from '@/lib/rpc/describe-error';
import { RoleForm } from '@/modules/access/components/role-form';
import { RolesTable } from '@/modules/access/components/roles-table';
import { rolesQueryOptions, useDeleteRole, useSaveRole } from '@/modules/access/queries';
import type { RoleFormOutput } from '@/modules/access/schemas';
import { toRoleFormDefaults } from '@/modules/access/schemas';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';

export const Route = createFileRoute('/_app/access/roles')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(rolesQueryOptions()),
  component: RolesPage,
});

function RolesPage() {
  const me = useMe();
  const canManage = can(me, 'access', 'manage');
  const { data: roles } = useSuspenseQuery(rolesQueryOptions());
  const saveRole = useSaveRole();
  const deleteRole = useDeleteRole();
  const [editing, setEditing] = useState<RoleDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RoleDto | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function closeDialog() {
    setEditing(null);
    setSubmitError(null);
  }

  async function handleSubmit(values: RoleFormOutput) {
    setSubmitError(null);
    try {
      await saveRole.mutateAsync(editing && editing !== 'new' ? { ...values, id: editing.id } : values);
      toast.success('Role disimpan');
      closeDialog();
    } catch (error) {
      setSubmitError(describeError(error));
    }
  }

  function confirmDelete() {
    if (!deleting) return;
    deleteRole.mutate(
      { id: deleting.id },
      {
        onSuccess: () => {
          toast.success('Role dihapus');
          setDeleting(null);
        },
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Roles</h1>
        {canManage ? <Button onClick={() => setEditing('new')}>Tambah role</Button> : null}
      </div>
      <RolesTable roles={roles} canManage={canManage} onEdit={(role) => setEditing(role)} onDelete={setDeleting} />
      <Dialog open={editing !== null} onOpenChange={(open) => (open ? undefined : closeDialog())}>
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Tambah role' : 'Ubah role'}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <RoleForm
              key={editing === 'new' ? 'new' : editing.id}
              defaultValues={toRoleFormDefaults(editing === 'new' ? undefined : editing)}
              submitError={submitError}
              onSubmit={handleSubmit}
              onCancel={closeDialog}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={deleting !== null} onOpenChange={(open) => (open ? undefined : setDeleting(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus role?</DialogTitle>
            <DialogDescription>Role "{deleting?.name}" akan dihapus permanen.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Batal
            </Button>
            <Button variant="destructive" disabled={deleteRole.isPending} onClick={confirmDelete}>
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 9: Daftarkan menu & link modul**

`web/src/app/navigation.ts` — ganti import lucide dan `NAV_GROUPS`:

```ts
import { House, ShieldCheck, Users } from 'lucide-react';
```

```ts
export const NAV_GROUPS: NavGroup[] = [
  { label: 'Umum', items: [{ label: 'Beranda', to: '/', icon: House }] },
  {
    label: 'Pengaturan Akses',
    items: [
      { label: 'Users', to: '/access/users', icon: Users, permission: { module: 'access', level: 'view' } },
      { label: 'Roles', to: '/access/roles', icon: ShieldCheck, permission: { module: 'access', level: 'view' } },
    ],
  },
];
```

`web/src/app/module-links.ts`:

```ts
export const MODULE_LINKS: Partial<Record<ModuleKey, LinkProps['to']>> = { access: '/access/users' };
```

- [ ] **Step 10: Verifikasi**

Run: `bun run check` → Expected: typecheck, lint, dan seluruh test (scripts, shared, gas, web) hijau.
Run: `bun run build` → Expected: `verify-dist OK`.

Run: `bun run dev` → Expected:
- Super Admin: menu "Pengaturan Akses" tampil; tambah user `ani@qc.local` dengan role "QC Staff" → muncul di tabel; ubah nama; nonaktifkan → status "Nonaktif"; cari "ani" dan filter status bekerja dan tersimpan di URL (`#/access/users?q=ani`).
- Tambah role dengan nama "qc staff" → pesan "Nama role sudah dipakai"; hapus role "QC Staff" → tombol Hapus nonaktif (dipakai user); buat role baru tanpa user lalu hapus → berhasil.
- Pemantau Akses: bisa melihat Users/Roles tanpa tombol Tambah/Ubah.
- QC Staff: menu Pengaturan Akses tidak tampil; buka `#/access/users` → halaman 403.

- [ ] **Step 11: Commit**

```bash
bun run format
git add web/src
git commit -m "feat(web): halaman pengelolaan users dan roles" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Skrip push & deploy

**Files:**
- Create: `scripts/push.ts`, `scripts/deploy.ts`
- Modify: `package.json` (root — skrip `push`, `deploy`)

**Interfaces:**
- Consumes: `GAS_DIR` (Task 3); `gas/.clasp.json`, `gas/deployment.json` (Task 9).
- Produces: `bun run push` (check → build → `clasp push --force`), `bun run deploy` (push → update deployment tetap).

- [ ] **Step 1: Verifikasi perintah clasp yang tersedia**

```bash
clasp --help
clasp push --help
clasp deploy --help
```

Catat perintah untuk **memperbarui deployment yang sudah ada** berdasarkan ID. Pada clasp 3.x bentuknya salah satu dari:
- `clasp deploy --deploymentId <id> --description <teks>`, atau
- `clasp update-deployment <id> --description <teks>`.

Gunakan bentuk yang muncul di `--help` pada Step 3.

- [ ] **Step 2: Tulis `scripts/push.ts`**

```ts
import { $ } from 'bun';
import { GAS_DIR } from './paths';

await $`clasp push --force`.cwd(GAS_DIR);
console.log('clasp push selesai');
```

- [ ] **Step 3: Tulis `scripts/deploy.ts`**

```ts
import path from 'node:path';
import { $ } from 'bun';
import { GAS_DIR } from './paths';

const config = (await Bun.file(path.join(GAS_DIR, 'deployment.json')).json()) as { deploymentId?: string };
if (!config.deploymentId) {
  console.error('gas/deployment.json belum berisi deploymentId. Ikuti docs/setup-google.md langkah "Deployment pertama".');
  process.exit(1);
}

const description = `deploy ${new Date().toISOString()}`;
// Sesuaikan dengan hasil `clasp deploy --help` (Task 14 Step 1).
await $`clasp deploy --deploymentId ${config.deploymentId} --description ${description}`.cwd(GAS_DIR);
console.log(`Deployment ${config.deploymentId} diperbarui. URL: https://script.google.com/macros/s/${config.deploymentId}/exec`);
```

- [ ] **Step 4: Tambah skrip ke `package.json` root**

Tambahkan di `scripts`:

```json
"push": "bun run check && bun run build && bun run scripts/push.ts",
"deploy": "bun run push && bun run scripts/deploy.ts"
```

- [ ] **Step 5: Verifikasi tanpa push**

Run: `bunx tsc -p tsconfig.json` → Expected: tanpa error.
Run: `bun run scripts/deploy.ts` → Expected: keluar dengan pesan "gas/deployment.json belum berisi deploymentId…" (exit 1). **Jangan** menjalankan `bun run push` di task ini — push ke project Apps Script dilakukan di Task 16 setelah user setuju.

- [ ] **Step 6: Commit**

```bash
bun run format
git add scripts/push.ts scripts/deploy.ts package.json
git commit -m "chore: skrip push dan deploy ke Apps Script" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Tooling agen & dokumentasi

**Files:**
- Create: `.mcp.json`, `CLAUDE.md`, `README.md`, `docs/setup-google.md`, `docs/adding-a-module.md`, `docs/e2e-checklist.md`
- Create (via TanStack Intent): skill TanStack di lokasi yang dilaporkan tool (mis. `.claude/skills/`)

**Interfaces:**
- Produces: dokumentasi yang dirujuk Task 16 dan sub-project berikutnya.

- [ ] **Step 1: MCP server project**

Verifikasi ketersediaan:

```bash
clasp mcp --help
bunx --bun shadcn@latest mcp --help
```

Tulis `.mcp.json` (Windows memerlukan `cmd /c` untuk shim `.cmd`):

```json
{
  "mcpServers": {
    "clasp": { "command": "cmd", "args": ["/c", "clasp", "mcp"] },
    "shadcn": { "command": "cmd", "args": ["/c", "bunx", "--bun", "shadcn@latest", "mcp"] }
  }
}
```

Bila `clasp mcp` tidak tersedia di versi terpasang, hapus entri `clasp` dan catat di laporan task. Bila shadcn MCP membutuhkan `components.json` di working directory, ubah args menjadi `["/c", "cd", "web", "&&", "bunx", "--bun", "shadcn@latest", "mcp"]`.

- [ ] **Step 2: Skill TanStack via TanStack Intent**

```bash
cd web
bunx @tanstack/intent@latest --help
```

Jalankan sub-perintah instalasi/sinkronisasi skill yang ditampilkan help (untuk paket `@tanstack/react-router`, `@tanstack/react-query`, `@tanstack/react-form`) dengan target Claude Code. Expected: file skill tertulis (catat lokasinya, mis. `.claude/skills/tanstack-*`). Bila tool tidak tersedia, laporkan dan lanjutkan.

- [ ] **Step 3: Tulis `CLAUDE.md`**

````markdown
# QC App — panduan untuk agen

Aplikasi Quality Control: backend Google Apps Script (GAS) + Google Sheets, frontend React single-file yang disajikan GAS.
PRD: `docs/prd/`. Rencana: `docs/superpowers/plans/`.

## Perintah
- `bun run dev` — FE lokal dengan mock backend (router GAS asli berjalan in-memory di browser).
- `bun run check` — typecheck + Biome + semua test. Wajib hijau sebelum commit.
- `bun run build` — `gas/dist` (JS per file + `index.html` single-file) lalu verify-dist.
- `bun run push` / `bun run deploy` — push ke Apps Script / perbarui deployment tetap (`gas/deployment.json`).

## Struktur
- `shared/` — kontrak FE↔GAS (`rpc.ts`) dan model permission. Murni, tanpa API GAS/DOM, import internal relatif.
- `gas/src/` — backend. `main.ts` (doGet, api, setup), `routes.ts`, `core/`, `modules/<modul>/{repo,context,validate,service,routes}.ts`.
- `gas/test-support/` — memory platform & fixture (dipakai test dan mock FE; tidak di-build).
- `web/src/` — `modules/<modul>/` (queries, schemas, components), `routes/` (tipis), `app/` (shell, router, boot), `lib/rpc/`.

## Aturan kode GAS (ditegakkan `scripts/build-gas.ts`)
- File di-transpile per file dan `import`/`export` dihapus: semua file berbagi SATU global scope.
- Semua fungsi top-level di `gas/src` WAJIB berakhiran `_` (agar tidak bisa dipanggil via `google.script.run`), kecuali `doGet`, `api`, `setup`.
- Nama top-level unik di seluruh `gas/src` + `shared/`. Dilarang: `export default`, re-export, import alias/namespace/dynamic, class, enum.
- Tidak ada kode top-level yang memakai global file lain saat load — bungkus dalam fungsi (lihat `getRoutes_`).
- Akses API GAS hanya lewat `platform_()`; implementasi asli di `core/gas-platform.ts`.
- Tulis ke sheet di dalam `platform_().withLock(...)`; teks disimpan lewat `core/db` (aman dari formula injection).
- Jangan pernah mengedit `gas/dist/` manual.

## Menambah method RPC
1. Tambah entri di `RpcContract` (`shared/rpc.ts`).
2. Validator + handler di `gas/src/modules/<modul>/`, daftarkan di `<modul>/routes.ts` dengan `permission` yang tepat.
3. `getRoutes_` bertipe `RouteTable` — typecheck gagal bila method belum terdaftar.
4. FE: `queryOptions`/mutation di `web/src/modules/<modul>/queries.ts`.

Resep modul baru: `docs/adding-a-module.md`.
````

- [ ] **Step 4: Tulis `README.md`**

````markdown
# QC App

Aplikasi web internal Quality Control. Backend Google Apps Script + Google Sheets; frontend React + TanStack + shadcn/ui yang di-build menjadi satu file HTML dan disajikan oleh Apps Script.

## Prasyarat
- [Bun](https://bun.sh) versi terbaru
- [clasp](https://github.com/google/clasp) 3.x, sudah `clasp login` dengan akun pemilik script
- Git

## Mulai
```bash
bun install
bun run dev
```
Buka http://localhost:3000 dan pilih user mock di halaman login.

## Perintah
| Perintah | Fungsi |
|---|---|
| `bun run dev` | FE lokal + mock backend |
| `bun run check` | typecheck, lint, test |
| `bun run build` | build `gas/dist` |
| `bun run push` | check + build + `clasp push` |
| `bun run deploy` | push + perbarui deployment web app |

## Dokumentasi
- Setup Google Cloud, Script Properties, deploy pertama: `docs/setup-google.md`
- Menambah modul: `docs/adding-a-module.md`
- Checklist uji manual: `docs/e2e-checklist.md`
- PRD: `docs/prd/`
````

- [ ] **Step 5: Tulis `docs/setup-google.md`**

````markdown
# Setup Google (sekali per lingkungan)

Semua langkah memakai akun pemilik script (mis. `qcspectrum123@gmail.com`).

## 1. Spreadsheet database
Buat spreadsheet baru (atau pakai yang ada). Salin ID dari URL `https://docs.google.com/spreadsheets/d/<ID>/edit`.

## 2. Push kode pertama
```bash
bun run push
```

## 3. Script Properties (tahap 1)
Buka editor: `cd gas && clasp open-script` (atau buka script.google.com). **Project Settings → Script Properties**, tambahkan:

| Key | Isi |
|---|---|
| `SPREADSHEET_ID` | ID dari langkah 1 |
| `SESSION_SECRET` | string acak ≥ 32 karakter, mis. hasil `bun -e "console.log(crypto.randomUUID() + crypto.randomUUID())"` |
| `ADMIN_EMAIL` | email super admin |

## 4. Jalankan `setup`
Di editor pilih fungsi `setup` → **Run** → izinkan akses. Log menampilkan laporan; sheet `users`, `roles`, `audit_log` dibuat.

## 5. Deployment pertama
```bash
cd gas
clasp deploy --description "v1"
```
(Gunakan perintah pembuatan deployment sesuai `clasp deploy --help`.) Salin **deployment ID** ke `gas/deployment.json`, lalu commit file itu. URL aplikasi: `https://script.google.com/macros/s/<deploymentId>/exec`. Pastikan di **Deploy → Manage deployments** tertulis *Execute as: Me* dan *Who has access: Anyone*.

## 6. Google Cloud OAuth client
Di https://console.cloud.google.com (akun yang sama):
1. Buat project baru, mis. "QC App".
2. **Google Auth Platform → Branding/OAuth consent screen**: User type **External**, nama aplikasi "QC App", email dukungan.
3. **Data access / Scopes**: tambahkan `openid` dan `.../auth/userinfo.email` saja.
4. **Audience**: klik **Publish app** sehingga status **In production** (scope ini tidak memerlukan verifikasi Google).
5. **Clients → Create client → Web application**. *Authorized redirect URIs*: URL `/exec` dari langkah 5 (persis, tanpa garis miring di akhir).
6. Salin **Client ID** dan **Client secret**.

## 7. Script Properties (tahap 2)
| Key | Isi |
|---|---|
| `OAUTH_CLIENT_ID` | Client ID |
| `OAUTH_CLIENT_SECRET` | Client secret |
| `OAUTH_REDIRECT_URI` | URL `/exec` dari langkah 5 (sama persis dengan di Google Cloud) |

Jalankan `setup` sekali lagi — laporan harus "Script Properties lengkap."

## 8. Deploy & coba
```bash
bun run deploy
```
Buka URL `/exec`, klik **Masuk dengan Google** dengan akun `ADMIN_EMAIL`, lalu buat role dan user di menu **Pengaturan Akses**.

## Troubleshooting
| Gejala | Penyebab & solusi |
|---|---|
| Google menampilkan `redirect_uri_mismatch` | `OAUTH_REDIRECT_URI` dan redirect URI di Google Cloud harus identik dengan URL `/exec`. |
| "Aplikasi belum dapat dibuka. Hubungi admin." | Lihat **Executions** di editor; biasanya Script Property belum lengkap. |
| "Login gagal" | State login kedaluwarsa (> 6 jam) atau dipakai ulang — klik tombol login sekali lagi. |
| "Email … belum terdaftar" | Tambahkan email tersebut di menu Users (status Aktif). |
| URL berubah setelah deploy | Selalu pakai `bun run deploy` (memperbarui deployment ID yang sama), jangan membuat deployment baru. |
| Paksa semua user logout | Ganti `SESSION_SECRET`. |
````

- [ ] **Step 6: Tulis `docs/adding-a-module.md`**

````markdown
# Menambah modul baru

Contoh: modul `item` (Data Item). Modul sudah terdaftar di `MODULES` (`shared/permissions.ts`); untuk modul yang benar-benar baru, tambahkan key dan label di sana terlebih dahulu.

## 1. Kontrak — `shared/rpc.ts`
Tambahkan DTO, input, dan entri `RpcContract`, mis. `'item.list': { input: null; output: ItemDto[] }`.

## 2. Backend — `gas/src/modules/item/`
- `repo.ts` — `ITEMS_TABLE: TableSchema`, fungsi baca/tulis memakai `readTable_`/`insertRow_`/`updateRow_`.
- `validate.ts` — `validateXxx_(raw)` memakai `readObject_`.
- `service.ts` — logika bisnis; semua penulisan di dalam `platform_().withLock(...)`, catat `appendAudit_` bila perlu.
- `routes.ts` — `itemRoutes_(): Pick<RouteTable, ...>` dengan `permission: { module: 'item', level: 'view' | 'edit' | 'manage' }`.
- Daftarkan di `gas/src/routes.ts`: `{ ...authRoutes_(), ...accessRoutes_(), ...itemRoutes_() }`.
- Bila modul punya sheet, tambahkan tabelnya ke `runSetup_` (`gas/src/setup.ts`).
- Ingat: semua fungsi top-level berakhiran `_`, nama unik global.
- Test di samping file (`*.test.ts`) memakai `createMemoryPlatform` dan fixture.

## 3. Frontend — `web/src/modules/item/`
- `queries.ts` — `queryOptions` + mutation (invalidate key modul).
- `schemas.ts` — skema zod form.
- `components/` — form & tabel.
- Route di `web/src/routes/_app/item/*.tsx` dengan `beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view')`.
- Tambahkan menu di `NAV_GROUPS` (`web/src/app/navigation.ts`) dan link di `MODULE_LINKS` (`web/src/app/module-links.ts`).
- Data contoh untuk dev di `web/src/lib/rpc/mock-backend.ts`.

## 4. Selesai bila
`bun run check` hijau, `bun run build` lolos verify-dist, dan alur utama dicoba di `bun run dev` serta di deployment.
````

- [ ] **Step 7: Tulis `docs/e2e-checklist.md`**

````markdown
# Checklist E2E manual (di URL /exec)

Siapkan: akun A = `ADMIN_EMAIL`; akun B terdaftar dengan role ber-`access: view`; akun C tidak terdaftar.

| # | Langkah | Hasil yang diharapkan | PRD |
|---|---|---|---|
| 1 | Buka URL `/exec` di jendela privat | Halaman login dengan tombol "Masuk dengan Google" | FR-A1 |
| 2 | Login dengan akun A | Kembali ke aplikasi, beranda tampil, URL tanpa `?code=`/`&state=` | FR-A1, FR-A6 |
| 3 | Refresh halaman (F5) | Tetap login, tidak muncul "Login gagal" | FR-A3, FR-A6 |
| 4 | Buka Pengaturan Akses → Users, refresh | Tetap di halaman Users (hash di URL) | FR-A6 |
| 5 | Buat role "Pemantau" (access: Lihat) dan user B dengan role itu | Tersimpan, tercatat di sheet `audit_log` | FR-M2, FR-M5, FR-M7 |
| 6 | Login sebagai B di browser lain | Melihat Users/Roles tanpa tombol Tambah/Ubah | FR-P5 |
| 7 | Sebagai B, di console DevTools frame aplikasi jalankan `google.script.run.withSuccessHandler(console.log).api('access.users.save', JSON.stringify({email:'x@y.com',name:'X',status:'active',roleIds:[]}), localStorage.getItem('qc.session'))` | Respons `"code":"FORBIDDEN"` | FR-P4 |
| 8 | Sebagai A, nonaktifkan B; B klik menu apa pun | B kembali ke halaman login | FR-A5 |
| 9 | Login dengan akun C | Pesan "Email … belum terdaftar" beserta emailnya | FR-A2 |
| 10 | Sebagai A, coba nonaktifkan akun sendiri / hapus role yang dipakai | Ditolak dengan pesan jelas | FR-M3, FR-M6 |
| 11 | Logout | Kembali ke login; login ulang berhasil | FR-A4 |
| 12 | Buka `#/tidak-ada` | Halaman 404 | FR-S3 |
| 13 | Buka di ponsel | Sidebar menjadi menu geser, tabel bisa digulir | FR-S1, NFR-7 |
| 14 | Isi nama user `=1+1`, buka sheet `users` | Sel berisi teks `=1+1`, bukan `2` | NFR-1 |
````

- [ ] **Step 8: Verifikasi & commit**

Run: `bun run check` → Expected: hijau.

```bash
bun run format
git add .mcp.json CLAUDE.md README.md docs .claude/skills
git commit -m "docs: panduan agen, setup Google, resep modul, checklist E2E, dan konfigurasi MCP" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Abaikan `.claude/skills` di `git add` bila Step 2 tidak menghasilkan file.)

---

### Task 16: Push perdana, deployment, dan uji E2E (bersama user)

**Files:**
- Modify: `gas/deployment.json`

**Interfaces:**
- Consumes: seluruh task sebelumnya; `docs/setup-google.md`, `docs/e2e-checklist.md`.

- [ ] **Step 1: Minta persetujuan sebelum push**

`clasp push --force` **menimpa semua file** di project Apps Script `1JyiAAtA…X_U`. Tanyakan ke user: "Project Apps Script akan ditimpa dengan hasil build. Lanjut push?" Lanjutkan hanya setelah user menjawab ya. Bila user ingin menyimpan isi lama, jalankan dulu `cd gas && clasp pull` ke folder sementara di luar repo.

- [ ] **Step 2: Push**

Run: `bun run push`
Expected: `check` hijau, `verify-dist OK`, `clasp push` melaporkan file `main.js`, `index.html`, `appsscript.json`, dll. terunggah.

- [ ] **Step 3: Setup oleh user (langkah 3–4 `docs/setup-google.md`)**

Pandu user mengisi Script Properties tahap 1 dan menjalankan `setup` dari editor. Expected log: sheet `users`, `roles`, `audit_log` siap.

- [ ] **Step 4: Deployment pertama**

Dengan persetujuan user, buat deployment (perintah sesuai `clasp deploy --help`), lalu isi `gas/deployment.json`:

```json
{
  "deploymentId": "<deployment ID dari output clasp>"
}
```

- [ ] **Step 5: OAuth client oleh user (langkah 6–7)**

Pandu user membuat OAuth client di Google Cloud dan mengisi Script Properties tahap 2. Jalankan `setup` lagi → "Script Properties lengkap."

- [ ] **Step 6: Deploy & E2E**

Run: `bun run deploy` → Expected: "Deployment … diperbarui. URL: …/exec".

Jalankan seluruh `docs/e2e-checklist.md` bersama user. Catat hasil tiap baris. Untuk kegagalan, gunakan superpowers:systematic-debugging sebelum memperbaiki; setiap perbaikan kode wajib disertai test yang mereproduksinya.

- [ ] **Step 7: Commit**

```bash
git add gas/deployment.json
git commit -m "chore: catat deployment ID web app" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Cakupan PRD → Task

| PRD | Task |
|---|---|
| FR-A1 login Google | 9 (OAuth, boot), 12 (LoginPanel) |
| FR-A2 whitelist | 6 (context), 9 (NOT_WHITELISTED), 12 |
| FR-A3 sesi 7 hari | 4 (session), 11 (session storage) |
| FR-A4 logout | 12 (useLogout, UserMenu) |
| FR-A5 pencabutan cepat | 6 (cache + invalidate), 7 (router), 8 (service invalidate) |
| FR-A6 URL bersih & deep link | 11 (boot), 12 (gas-location) |
| FR-P1–P3 level, multi-role, super admin | 2, 6 |
| FR-P4 penegakan server | 7, 8 (routes.test) |
| FR-P5 UI menyesuaikan | 12 (can, guard, nav), 13 |
| FR-M1–M7 pengelolaan akses & audit | 8, 13 |
| FR-S1–S3 shell & halaman status | 12 |
| NFR-1/2/3 keamanan | 3 (nama privat), 7, 9, 5 (formula) |
| NFR-4 lock | 8 (withLock) |
| NFR-5/6/7 | 6 (cache), 16 (E2E ponsel) |
| NFR-8 TS strict & kontrak tunggal | 1, 2 |
| §6.3 pipeline | 3, 10, 14 |
| §9 tooling & dokumentasi | 15 |
| §11 Definition of Done | 12–16 |

