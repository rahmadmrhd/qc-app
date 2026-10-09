# Fase B — Data Item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Katalog item bersama semua lokasi (merk, tipe, country lock, nama lain, stiker, kelengkapan, galeri gambar, detail Markdown) lengkap dengan halaman daftar, form tambah/ubah, halaman detail, nonaktifkan/aktifkan, dan audit yang terbaca.

**Architecture:** Modul backend baru `gas/src/modules/item/` (sheet `items`, RPC `items.*`) di atas fondasi Fase A (`files`, `attachFiles_`, izin `item` global). Frontend `web/src/modules/item/` memakai `MarkdownEditor`, `useUploadImage`, dan `useFileUrl`. Fungsi murni (normalisasi kunci, hash, rujukan berkas di Markdown) ada di `shared/items.ts` agar dapat dipakai ulang oleh auto-suggest (Fase C) dan sinkronisasi (Fase B2).

**Tech Stack:** Bun 1.4 (workspaces `shared`, `gas`, `web`), TypeScript strict, GAS V8 (transpile per file), React 19 + TanStack Router/Query/Form, shadcn, zod, Vitest, `bun:test`, Biome.

**Spec:** `docs/prd/2026-10-09-qc-item-serah-terima.md` — bagian 4.3 (FI1–FI7), 4.7 (FAU1–FAU2), 6.2, 8, DoD "Fase B". Kontrak sinkronisasi `docs/api/desktop-sync.md` ditulis terhadap bentuk data yang dibangun di sini (kolom `external_id` dan `sync_rev` ada tetapi dikelola di Fase B2).

## Global Constraints

- Semua balasan, teks UI, pesan galat, dan komentar berbahasa Indonesia; identifier tetap Inggris/aslinya.
- Aturan GAS (`CLAUDE.md`, ditegakkan `scripts/build-gas.ts`): fungsi top-level di `gas/src` WAJIB berakhiran `_` kecuali `doGet`/`api`/`setup`; nama top-level unik di seluruh `gas/src` + `shared/` (jangan memakai ulang `parseJson_`, `toRoleRecord_`, dst. milik modul `access`); dilarang `export default`, re-export, import alias/namespace/dynamic, `class`, `enum`; tanpa `Object.hasOwn`; akses API GAS hanya lewat `platform_()`; tulis sheet di dalam `platform_().withLock(...)`; **tanpa `withLock` bersarang**; karakter khusus lewat `String.fromCharCode` (alat penyunting dapat "memakan" backslash — hindari regex berbackslash, pakai pemindaian string).
- Fungsi murni di `shared/` boleh tanpa akhiran `_`.
- Batas (PRD FI7): merk ≤ 60, tipe ≤ 100, alias ≤ 10 @ 100, stiker ≤ 30 (nama 1–100, catatan ≤ 300), kelengkapan ≤ 30 (nama 1–100, jumlah bilangan bulat 1–999), lampiran ≤ 10, detail Markdown ≤ 20.000 karakter, total JSON per kolom ≤ 40.000 karakter.
- Izin: `items.list`/`items.get` = `item: view`; `items.save` = `item: edit`; `items.setStatus` = `item: manage` (semua global).
- Item **tidak pernah dihapus**, hanya dinonaktifkan. Merk+tipe unik (dinormalisasi); nama lain tidak boleh sama dengan merk+tipe atau nama lain item lain.
- Semua gambar yang dirujuk item (galeri, contoh stiker, dan `qcfile:` di Markdown) ditautkan lewat `attachFiles_` di dalam lock yang sama dengan penyimpanan item.
- `bun run check` hijau sebelum push. Format tanpa lint: `bunx biome check --write --linter-enabled=false <path>`.
- Commit diakhiri `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Jangan mengedit `gas/dist/` manual.
- Bun: `export PATH="$PATH:$HOME/.bun/bin"` di Git Bash.
- Typecheck `web` boleh merah di akhir Task 4 (rute `/item/new`, `/item/$itemId`, `/item/$itemId/edit` belum ada); wajib hijau di akhir Task 5 Step 8 setelah `bun run --cwd web build` meregenerasi `routeTree.gen.ts`. Typecheck `gas` boleh merah di akhir Task 1–2 (kontrak `items.*` belum punya rute); wajib hijau di akhir Task 3.
- Pada tes Vitest, `beforeEach(() => { mock.mockReset(); })` **harus berkurung kurawal** (jangan `beforeEach(() => mock.mockReset())`; nilai kembalian dipanggil sebagai cleanup).

## Review Focus

1. **Deteksi duplikat:** "ES-24 250W" vs "es 24 250w" adalah kunci yang sama; nama lain yang sama dengan merk+tipe item lain, dengan nama lain item lain, atau dengan merk+tipe item sendiri harus ditolak dengan pesan di field. → Task 3.
2. **Kepemilikan berkas atomik:** gambar yang dirujuk lewat galeri, contoh stiker, dan Markdown ditautkan dalam satu batch; satu rujukan tak dikenal atau milik entitas lain membatalkan seluruh simpan tanpa mengubah pemilik berkas mana pun dan tanpa membuat item. → Task 3.
3. **Batas dan bentuk input:** jumlah kelengkapan pecahan/negatif/NaN/string, stiker tanpa nama, alias berisi tanda baca saja, JSON melebihi 40.000 karakter, Markdown 20.001 karakter, CRLF di Markdown. → Task 2.
4. **Kolom sinkron tidak tertimpa:** menyimpan item dari form tidak boleh mengubah `external_id` dan `sync_rev` yang sudah ada. → Task 3.
5. **Izin bertingkat:** `edit` dapat menyimpan tetapi tidak menonaktifkan; `view` tidak dapat menyimpan; daftar tidak membawa detail Markdown. → Task 3 (server) dan Task 4–5 (tombol disembunyikan).
6. **Audit ringkas dan terbaca:** snapshot tidak memuat teks Markdown penuh (hanya panjang dan hash) sehingga selalu di bawah batas sel; perubahan stiker/kelengkapan tampil per entri. → Task 3 dan Task 6.
7. **Pencarian toleran:** "es24", "ES-24 250W", dan nama lain menemukan item yang sama; item nonaktif tetap muncul di daftar dengan filter status. → Task 4.

---

## Struktur Berkas

| Berkas | Tanggung jawab |
|---|---|
| `shared/items.ts` (baru) | Batas, `normalizeKey`, `itemKey`, `normalizeNewlines`, `hashText`, `extractFileRefs` |
| `shared/rpc.ts` | DTO item dan kontrak `items.list/get/save/setStatus` |
| `gas/src/modules/item/{repo,validate,service,routes}.ts` (baru) | Sheet `items`, validasi, simpan/baca/nonaktif, audit, rute |
| `gas/test-support/item-fixtures.ts` (baru) | Fixture `item()` |
| `gas/src/setup.ts` | Sheet `items` dibuat saat `setup` |
| `web/src/modules/item/` (baru) | `schemas.ts`, `queries.ts`, `lib/filter-items.ts`, `components/*`, tes |
| `web/src/routes/_app/item/` (baru) | `index.tsx` (daftar), `new.tsx`, `$itemId/index.tsx` (detail), `$itemId/edit.tsx` |
| `web/src/app/navigation.ts`, `module-links.ts` | Menu "Data Item" |
| `web/src/modules/access/lib/audit-actions.ts`, `components/audit-diff-view.tsx` | Label aksi dan diff item |
| `web/src/lib/rpc/mock-backend.ts` | Data contoh item untuk `bun run dev` |
| `docs/…`, `CLAUDE.md` | Dokumentasi, E2E |

---

### Task 1: Fungsi murni dan tipe RPC item (`shared/`)

**Files:**
- Create: `shared/items.ts`, `shared/items.test.ts`
- Modify: `shared/rpc.ts`

**Interfaces:**
- Consumes: `FILE_SCHEME` dari `./files`.
- Produces:
  - `shared/items.ts`: `ITEM_LIMITS`, `normalizeKey(text)`, `itemKey(brand, model)`, `normalizeNewlines(text)`, `hashText(text)`, `extractFileRefs(markdown): string[]`.
  - `shared/rpc.ts`: `ItemStatus`, `ItemStickerDto {name, note, fileId}`, `ItemAccessoryDto {name, qty}`, `ItemSummaryDto`, `ItemDto`, `SaveItemInput`, `GetItemInput`, `SetItemStatusInput`; kontrak `'items.list' | 'items.get' | 'items.save' | 'items.setStatus'`.

- [ ] **Step 1: Tulis tes yang gagal** — `shared/items.test.ts`

```ts
import { describe, expect, test } from 'bun:test';
import {
  extractFileRefs,
  hashText,
  ITEM_LIMITS,
  itemKey,
  normalizeKey,
  normalizeNewlines,
} from './items';

describe('normalizeKey', () => {
  test('huruf kecil, tanda baca menjadi spasi, spasi dirapikan', () => {
    expect(normalizeKey('ES-24 250W')).toBe('es 24 250w');
    expect(normalizeKey('  Ubiquiti   AF/5XHD ')).toBe('ubiquiti af 5xhd');
    expect(normalizeKey('B DB AC')).toBe('b db ac');
  });

  test('varian penulisan yang sama menghasilkan kunci yang sama', () => {
    const variants = ['ES 24 250W', 'es-24 250w', 'ES_24  250W', '(ES) 24, 250W.'];
    expect(new Set(variants.map(normalizeKey)).size).toBe(1);
  });

  test('hanya tanda baca atau kosong menghasilkan teks kosong', () => {
    expect(normalizeKey('')).toBe('');
    expect(normalizeKey(' -- / .. ')).toBe('');
  });

  test('angka dan huruf bukan-ASCII dipertahankan', () => {
    expect(normalizeKey('Tipe 7Å')).toBe('tipe 7å');
  });
});

describe('itemKey', () => {
  test('menggabungkan merk dan tipe', () => {
    expect(itemKey('Ubiquiti', 'ES-24 250W')).toBe('ubiquiti es 24 250w');
    expect(itemKey('UBIQUITI', 'es-24 250w')).toBe('ubiquiti es 24 250w');
  });

  test('batas pemisah merk dan tipe tidak kabur: "ab" + "c d" berbeda dari "a" + "bc d"', () => {
    expect(itemKey('ab', 'c d')).not.toBe(itemKey('a', 'bc d'));
  });
});

describe('normalizeNewlines', () => {
  test('CRLF dan CR sendirian menjadi LF', () => {
    const cr = String.fromCharCode(13);
    const lf = String.fromCharCode(10);
    expect(normalizeNewlines(`a${cr}${lf}b${cr}c`)).toBe(`a${lf}b${lf}c`);
    expect(normalizeNewlines('tanpa baris baru')).toBe('tanpa baris baru');
  });
});

describe('hashText', () => {
  test('deterministik, berbeda untuk teks berbeda, dan 8 digit heksa', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
    expect(hashText('')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('extractFileRefs', () => {
  test('mengambil id dari rujukan gambar qcfile, unik dan berurutan', () => {
    const md = 'A ![x](qcfile:aaa-1) dan ![y](qcfile:bbb_2) lalu ![z](qcfile:aaa-1)';
    expect(extractFileRefs(md)).toEqual(['aaa-1', 'bbb_2']);
  });

  test('mengabaikan rujukan yang tidak sah atau bukan gambar qcfile', () => {
    const md = [
      '![a](https://x.test/a.png)',
      '![b](qcfile:)',
      '![c](qcfile:a/b)',
      '[tautan](qcfile:ccc)',
      '![d](qcfile:ddd',
      '![e](QCFILE:eee)',
    ].join(' ');
    expect(extractFileRefs(md)).toEqual(['ccc']);
  });

  test('teks tanpa rujukan menghasilkan daftar kosong', () => {
    expect(extractFileRefs('')).toEqual([]);
    expect(extractFileRefs('teks biasa')).toEqual([]);
  });
});

test('ITEM_LIMITS memuat batas PRD FI7', () => {
  expect(ITEM_LIMITS).toMatchObject({
    brand: 60,
    model: 100,
    alias: 100,
    aliases: 10,
    stickerName: 100,
    stickerNote: 300,
    stickers: 30,
    accessoryName: 100,
    accessoryQty: 999,
    accessories: 30,
    attachments: 10,
    jsonCell: 40_000,
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd shared test items`
Expected: FAIL — `./items` belum ada.

- [ ] **Step 3: Implementasi** — `shared/items.ts`

```ts
import { FILE_SCHEME } from './files';

/** Batas field item (PRD FI7). */
export const ITEM_LIMITS = {
  brand: 60,
  model: 100,
  alias: 100,
  aliases: 10,
  stickerName: 100,
  stickerNote: 300,
  stickers: 30,
  accessoryName: 100,
  accessoryQty: 999,
  accessories: 30,
  attachments: 10,
  /** Batas panjang JSON per kolom sheet (sel Sheets maks. 50.000 karakter). */
  jsonCell: 40_000,
} as const;

/**
 * Kunci pencocokan: huruf kecil, semua karakter selain huruf dan angka menjadi satu spasi, tepi dirapikan.
 * Dipakai untuk keunikan (merk+tipe, nama lain), pencarian, dan auto-suggest.
 */
export function normalizeKey(text: string): string {
  let result = '';
  let pendingSpace = false;
  for (const ch of text.toLowerCase()) {
    const isDigit = ch >= '0' && ch <= '9';
    const isLetter = ch.toUpperCase() !== ch.toLowerCase();
    if (isDigit || isLetter) {
      if (pendingSpace && result !== '') result += ' ';
      result += ch;
      pendingSpace = false;
    } else {
      pendingSpace = true;
    }
  }
  return result;
}

export function itemKey(brand: string, model: string): string {
  return `${normalizeKey(brand)} ${normalizeKey(model)}`.trim();
}

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

/** CRLF dan CR sendirian menjadi LF agar perbandingan dan penyimpanan konsisten. */
export function normalizeNewlines(text: string): string {
  return text.split(CR + LF).join(LF).split(CR).join(LF);
}

/** Hash FNV-1a 32-bit (8 digit heksa); hanya untuk deteksi perubahan di audit, bukan kriptografi. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function isFileIdChar(ch: string): boolean {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    (ch >= '0' && ch <= '9') ||
    ch === '_' ||
    ch === '-'
  );
}

/** Id berkas dari semua rujukan `](qcfile:<id>)` di Markdown; unik, urutan kemunculan. */
export function extractFileRefs(markdown: string): string[] {
  const marker = `](${FILE_SCHEME}`;
  const found: string[] = [];
  let from = 0;
  while (from < markdown.length) {
    const at = markdown.indexOf(marker, from);
    if (at < 0) break;
    let end = at + marker.length;
    while (end < markdown.length && isFileIdChar(markdown.charAt(end))) end++;
    const id = markdown.slice(at + marker.length, end);
    if (id !== '' && markdown.charAt(end) === ')' && !found.includes(id)) found.push(id);
    from = Math.max(end, at + 1);
  }
  return found;
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `bun run --cwd shared test`
Expected: semua lulus.

- [ ] **Step 5: Tipe RPC** — `shared/rpc.ts`

Tambahkan sebelum `export interface RpcContract {`:

```ts
export type ItemStatus = 'active' | 'inactive';

export interface ItemStickerDto {
  name: string;
  /** Posisi/ketentuan penempelan. */
  note: string;
  /** Id berkas contoh (sheet `files`), atau `null`. */
  fileId: string | null;
}

export interface ItemAccessoryDto {
  name: string;
  /** Jumlah per unit. */
  qty: number;
}

export interface ItemSummaryDto {
  id: string;
  /** Id MySQL (diisi sinkronisasi); kosong bila belum terpetakan. */
  externalId: string;
  brand: string;
  model: string;
  isCountryLock: boolean;
  status: ItemStatus;
  aliases: string[];
  imageCount: number;
  updatedAt: string;
}

export interface ItemDto extends ItemSummaryDto {
  stickers: ItemStickerDto[];
  accessories: ItemAccessoryDto[];
  /** Id berkas galeri (sheet `files`), urut. */
  attachments: string[];
  /** Detail Markdown. */
  detail: string;
  createdAt: string;
  updatedBy: string;
}

export interface SaveItemInput {
  id?: string;
  brand: string;
  model: string;
  isCountryLock: boolean;
  aliases: string[];
  stickers: ItemStickerDto[];
  accessories: ItemAccessoryDto[];
  attachments: string[];
  detail: string;
}

export interface GetItemInput {
  id: string;
}

export interface SetItemStatusInput {
  id: string;
  status: ItemStatus;
}
```

dan di dalam `RpcContract` (setelah `files.get`):

```ts
  'items.list': { input: null; output: ItemSummaryDto[] };
  'items.get': { input: GetItemInput; output: ItemDto };
  'items.save': { input: SaveItemInput; output: ItemDto };
  'items.setStatus': { input: SetItemStatusInput; output: ItemDto };
```

- [ ] **Step 6: Typecheck dan commit**

Run: `bun run --cwd shared test && bun run --cwd gas typecheck`
Expected: shared lulus; typecheck gas **gagal** karena `getRoutes_` belum memuat `items.*` (`RouteTable` mewajibkan semua method). Itu diharapkan dan diperbaiki di Task 3; lanjutkan.

```bash
bunx biome check --write --linter-enabled=false shared
git add shared
git commit -m "feat(shared): fungsi murni item dan tipe RPC items" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Repo, fixture, dan validator item (GAS)

**Files:**
- Create: `gas/src/modules/item/repo.ts`, `gas/src/modules/item/validate.ts`, `gas/src/modules/item/validate.test.ts`, `gas/test-support/item-fixtures.ts`
- Modify: `gas/src/setup.ts`, `gas/src/setup.test.ts`

**Interfaces:**
- Consumes (Task 1): `ITEM_LIMITS`, `itemKey`, `normalizeKey`, `normalizeNewlines`; `MARKDOWN_MAX_LENGTH` dari `@shared/files`; DTO dari `@shared/rpc`.
- Produces:
  - `repo.ts`: `ITEMS_TABLE`, `ItemRecord`, `NewItemRecord`, `listItems_()`, `insertItem_(item)`, `updateItem_(item)`.
  - `validate.ts`: `validateSaveItem_`, `validateGetItem_`, `validateSetItemStatus_`.
  - fixture `item(overrides)` di `gas/test-support/item-fixtures.ts`.

- [ ] **Step 1: Tulis tes validator yang gagal** — `gas/src/modules/item/validate.test.ts`

```ts
import { expect, test } from 'bun:test';
import { captureAppError } from '@gas-test/errors';
import { validateGetItem_, validateSaveItem_, validateSetItemStatus_ } from './validate';

const base = {
  brand: ' Ubiquiti ',
  model: ' ES 24 250W ',
  isCountryLock: false,
  aliases: [],
  stickers: [],
  accessories: [],
  attachments: [],
  detail: '',
};

const fieldsOf = (override: Record<string, unknown>) =>
  captureAppError(() => validateSaveItem_({ ...base, ...override })).fields;

test('menormalisasi dan mengembalikan input yang sah', () => {
  expect(
    validateSaveItem_({
      ...base,
      id: 'i1',
      isCountryLock: true,
      aliases: [' ES24 ', 'Es24', '', 'AirFiber'],
      stickers: [{ name: ' Label SNI ', note: ' Belakang ', fileId: ' f1 ' }, { name: 'Garansi' }],
      accessories: [{ name: ' Kabel ', qty: 2 }],
      attachments: [' a ', 'a', 'b'],
      detail: 'baris1\r\nbaris2',
    }),
  ).toEqual({
    id: 'i1',
    brand: 'Ubiquiti',
    model: 'ES 24 250W',
    isCountryLock: true,
    aliases: ['ES24', 'AirFiber'],
    stickers: [
      { name: 'Label SNI', note: 'Belakang', fileId: 'f1' },
      { name: 'Garansi', note: '', fileId: null },
    ],
    accessories: [{ name: 'Kabel', qty: 2 }],
    attachments: ['a', 'b'],
    detail: 'baris1\nbaris2',
  });
});

test('tanpa id menghasilkan objek tanpa properti id', () => {
  expect('id' in validateSaveItem_(base)).toBe(false);
});

test('merk dan tipe wajib serta dibatasi panjangnya', () => {
  expect(fieldsOf({ brand: '', model: '' })).toMatchObject({ brand: 'Wajib diisi', model: 'Wajib diisi' });
  expect(fieldsOf({ brand: 'x'.repeat(61) })?.brand).toBe('Maksimal 60 karakter');
  expect(fieldsOf({ model: 'x'.repeat(101) })?.model).toBe('Maksimal 100 karakter');
});

test('isCountryLock harus boolean sungguhan', () => {
  for (const bad of ['true', 1, null, undefined]) {
    expect(fieldsOf({ isCountryLock: bad })?.isCountryLock).toBe('Harus true atau false');
  }
});

test('nama lain: daftar teks, kosong dibuang, kembar (ternormalisasi) dibuang, batas jumlah dan panjang', () => {
  expect(fieldsOf({ aliases: 'x' })?.aliases).toBe('Harus berupa daftar teks');
  expect(fieldsOf({ aliases: [1] })?.aliases).toBe('Harus berupa daftar teks');
  expect(fieldsOf({ aliases: ['--'] })?.aliases).toBe('Nama lain harus memuat huruf atau angka');
  expect(fieldsOf({ aliases: ['x'.repeat(101)] })?.aliases).toBe('Maksimal 100 karakter per nama lain');
  const eleven = Array.from({ length: 11 }, (_, i) => `alias ${i}`);
  expect(fieldsOf({ aliases: eleven })?.aliases).toBe('Maksimal 10 nama lain');
});

test('stiker: nama wajib, catatan dan berkas dibatasi, pesan menyebut nomor stiker', () => {
  expect(fieldsOf({ stickers: 'x' })?.stickers).toBe('Harus berupa daftar stiker');
  expect(fieldsOf({ stickers: ['x'] })?.stickers).toBe('Stiker 1: tidak valid');
  expect(fieldsOf({ stickers: [{ name: '' }] })?.stickers).toBe('Stiker 1: nama wajib diisi');
  expect(fieldsOf({ stickers: [{ name: 'ok' }, { name: 'x'.repeat(101) }] })?.stickers).toBe(
    'Stiker 2: nama maksimal 100 karakter',
  );
  expect(fieldsOf({ stickers: [{ name: 'a', note: 'x'.repeat(301) }] })?.stickers).toBe(
    'Stiker 1: catatan maksimal 300 karakter',
  );
  expect(fieldsOf({ stickers: [{ name: 'a', note: 5 }] })?.stickers).toBe('Stiker 1: catatan harus berupa teks');
  expect(fieldsOf({ stickers: [{ name: 'a', fileId: 5 }] })?.stickers).toBe('Stiker 1: berkas tidak valid');
  const many = Array.from({ length: 31 }, (_, i) => ({ name: `s${i}` }));
  expect(fieldsOf({ stickers: many })?.stickers).toBe('Maksimal 30 stiker');
});

test('kelengkapan: nama wajib dan jumlah bilangan bulat 1–999', () => {
  expect(fieldsOf({ accessories: 'x' })?.accessories).toBe('Harus berupa daftar kelengkapan');
  expect(fieldsOf({ accessories: [{ name: '', qty: 1 }] })?.accessories).toBe(
    'Kelengkapan 1: nama wajib diisi',
  );
  for (const bad of [0, -1, 1000, 1.5, Number.NaN, '2', null, undefined]) {
    expect(fieldsOf({ accessories: [{ name: 'Kabel', qty: bad }] })?.accessories).toBe(
      'Kelengkapan 1: jumlah harus bilangan bulat 1–999',
    );
  }
  const many = Array.from({ length: 31 }, (_, i) => ({ name: `k${i}`, qty: 1 }));
  expect(fieldsOf({ accessories: many })?.accessories).toBe('Maksimal 30 kelengkapan');
});

test('lampiran: daftar teks, kembar dibuang, maksimal 10', () => {
  expect(fieldsOf({ attachments: 'x' })?.attachments).toBe('Harus berupa daftar berkas');
  expect(fieldsOf({ attachments: [''] })?.attachments).toBe('Harus berupa daftar berkas');
  const eleven = Array.from({ length: 11 }, (_, i) => `f${i}`);
  expect(fieldsOf({ attachments: eleven })?.attachments).toBe('Maksimal 10 gambar');
});

test('detail Markdown: teks, maksimal 20.000 karakter setelah normalisasi baris baru', () => {
  expect(fieldsOf({ detail: 5 })?.detail).toBe('Harus berupa teks');
  expect(fieldsOf({ detail: 'x'.repeat(20_001) })?.detail).toBe('Maksimal 20000 karakter');
  expect(validateSaveItem_({ ...base, detail: 'x'.repeat(20_000) }).detail).toHaveLength(20_000);
  const crlf = '\r\n'.repeat(10_000);
  expect(validateSaveItem_({ ...base, detail: crlf }).detail).toHaveLength(10_000);
  expect(validateSaveItem_({ ...base, detail: undefined }).detail).toBe('');
});

test('input bukan objek ditolak', () => {
  expect(captureAppError(() => validateSaveItem_('x')).fields?._).toBe('Input harus berupa objek');
});

test('validateGetItem_ dan validateSetItemStatus_', () => {
  expect(validateGetItem_({ id: 'i1' })).toEqual({ id: 'i1' });
  expect(captureAppError(() => validateGetItem_({ id: '' })).fields).toEqual({ id: 'Wajib diisi' });
  expect(validateSetItemStatus_({ id: 'i1', status: 'inactive' })).toEqual({ id: 'i1', status: 'inactive' });
  expect(captureAppError(() => validateSetItemStatus_({ id: '', status: 'x' })).fields).toEqual({
    id: 'Wajib diisi',
    status: 'Nilai tidak valid',
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test item/validate`
Expected: FAIL — `./validate` belum ada.

- [ ] **Step 3: Repo** — `gas/src/modules/item/repo.ts`

```ts
import type { RowData, TableSchema } from '@gas/core/db';
import { insertRow_, readTable_, updateRow_ } from '@gas/core/db';
import type { ItemAccessoryDto, ItemStatus, ItemStickerDto } from '@shared/rpc';

export const ITEMS_TABLE: TableSchema = {
  sheetName: 'items',
  columns: [
    'id',
    'external_id',
    'brand',
    'model',
    'key',
    'is_country_lock',
    'aliases',
    'stickers',
    'accessories',
    'attachments',
    'detail_md',
    'status',
    'sync_rev',
    'created_at',
    'updated_at',
    'updated_by',
  ],
};

export interface ItemRecord {
  rowNumber: number;
  id: string;
  externalId: string;
  brand: string;
  model: string;
  key: string;
  isCountryLock: boolean;
  aliases: string[];
  stickers: ItemStickerDto[];
  accessories: ItemAccessoryDto[];
  attachments: string[];
  detail: string;
  status: ItemStatus;
  syncRev: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewItemRecord = Omit<ItemRecord, 'rowNumber'>;

function parseItemJson_(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readItemStrings_(text: string): string[] {
  const value = parseItemJson_(text);
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function readItemStickers_(text: string): ItemStickerDto[] {
  const value = parseItemJson_(text);
  if (!Array.isArray(value)) return [];
  const result: ItemStickerDto[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { name, note, fileId } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim() === '') continue;
    result.push({
      name: name.trim(),
      note: typeof note === 'string' ? note.trim() : '',
      fileId: typeof fileId === 'string' && fileId.trim() !== '' ? fileId.trim() : null,
    });
  }
  return result;
}

function readItemAccessories_(text: string): ItemAccessoryDto[] {
  const value = parseItemJson_(text);
  if (!Array.isArray(value)) return [];
  const result: ItemAccessoryDto[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { name, qty } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim() === '') continue;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1) continue;
    result.push({ name: name.trim(), qty });
  }
  return result;
}

function toItemRecord_(rowNumber: number, data: RowData): ItemRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    externalId: (data.external_id ?? '').trim(),
    brand: (data.brand ?? '').trim(),
    model: (data.model ?? '').trim(),
    key: (data.key ?? '').trim(),
    isCountryLock: (data.is_country_lock ?? '').trim() === 'true',
    aliases: readItemStrings_(data.aliases ?? ''),
    stickers: readItemStickers_(data.stickers ?? ''),
    accessories: readItemAccessories_(data.accessories ?? ''),
    attachments: readItemStrings_(data.attachments ?? ''),
    detail: data.detail_md ?? '',
    status: (data.status ?? '').trim() === 'inactive' ? 'inactive' : 'active',
    syncRev: Number(data.sync_rev) || 0,
    createdAt: data.created_at ?? '',
    updatedAt: data.updated_at ?? '',
    updatedBy: data.updated_by ?? '',
  };
}

function fromItemRecord_(item: NewItemRecord): RowData {
  return {
    id: item.id,
    external_id: item.externalId,
    brand: item.brand,
    model: item.model,
    key: item.key,
    is_country_lock: item.isCountryLock ? 'true' : 'false',
    aliases: JSON.stringify(item.aliases),
    stickers: JSON.stringify(item.stickers),
    accessories: JSON.stringify(item.accessories),
    attachments: JSON.stringify(item.attachments),
    detail_md: item.detail,
    status: item.status,
    sync_rev: String(item.syncRev),
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    updated_by: item.updatedBy,
  };
}

export function listItems_(): ItemRecord[] {
  return readTable_(ITEMS_TABLE)
    .rows.map(({ rowNumber, data }) => toItemRecord_(rowNumber, data))
    .filter((item) => item.id !== '' && item.key !== '');
}

export function insertItem_(item: NewItemRecord): void {
  insertRow_(ITEMS_TABLE, fromItemRecord_(item));
}

export function updateItem_(item: ItemRecord): void {
  updateRow_(ITEMS_TABLE, item.rowNumber, fromItemRecord_(item));
}
```

- [ ] **Step 4: Validator** — `gas/src/modules/item/validate.ts`

```ts
import type { ObjectReader } from '@gas/core/validate';
import { readObject_ } from '@gas/core/validate';
import { MARKDOWN_MAX_LENGTH } from '@shared/files';
import { ITEM_LIMITS, normalizeKey, normalizeNewlines } from '@shared/items';
import type {
  GetItemInput,
  ItemAccessoryDto,
  ItemStickerDto,
  SaveItemInput,
  SetItemStatusInput,
} from '@shared/rpc';

const ITEM_STATUS_VALUES = ['active', 'inactive'] as const;

function isItemRecord_(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readItemAliases_(value: unknown, reader: ObjectReader): string[] {
  if (!Array.isArray(value)) {
    reader.fail('aliases', 'Harus berupa daftar teks');
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      reader.fail('aliases', 'Harus berupa daftar teks');
      return [];
    }
    const alias = entry.trim();
    if (alias === '') continue;
    if (alias.length > ITEM_LIMITS.alias) {
      reader.fail('aliases', `Maksimal ${ITEM_LIMITS.alias} karakter per nama lain`);
      continue;
    }
    const key = normalizeKey(alias);
    if (key === '') {
      reader.fail('aliases', 'Nama lain harus memuat huruf atau angka');
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(alias);
  }
  if (result.length > ITEM_LIMITS.aliases) {
    reader.fail('aliases', `Maksimal ${ITEM_LIMITS.aliases} nama lain`);
  }
  return result;
}

function readItemStickers_(value: unknown, reader: ObjectReader): ItemStickerDto[] {
  if (!Array.isArray(value)) {
    reader.fail('stickers', 'Harus berupa daftar stiker');
    return [];
  }
  if (value.length > ITEM_LIMITS.stickers) {
    reader.fail('stickers', `Maksimal ${ITEM_LIMITS.stickers} stiker`);
    return [];
  }
  const result: ItemStickerDto[] = [];
  value.forEach((entry, index) => {
    const label = `Stiker ${index + 1}`;
    if (!isItemRecord_(entry)) {
      reader.fail('stickers', `${label}: tidak valid`);
      return;
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (name === '') {
      reader.fail('stickers', `${label}: nama wajib diisi`);
      return;
    }
    if (name.length > ITEM_LIMITS.stickerName) {
      reader.fail('stickers', `${label}: nama maksimal ${ITEM_LIMITS.stickerName} karakter`);
      return;
    }
    if (entry.note !== undefined && typeof entry.note !== 'string') {
      reader.fail('stickers', `${label}: catatan harus berupa teks`);
      return;
    }
    const note = typeof entry.note === 'string' ? entry.note.trim() : '';
    if (note.length > ITEM_LIMITS.stickerNote) {
      reader.fail('stickers', `${label}: catatan maksimal ${ITEM_LIMITS.stickerNote} karakter`);
      return;
    }
    const rawFile = entry.fileId;
    if (rawFile !== undefined && rawFile !== null && typeof rawFile !== 'string') {
      reader.fail('stickers', `${label}: berkas tidak valid`);
      return;
    }
    const fileId = typeof rawFile === 'string' && rawFile.trim() !== '' ? rawFile.trim() : null;
    if (fileId !== null && fileId.length > 100) {
      reader.fail('stickers', `${label}: berkas tidak valid`);
      return;
    }
    result.push({ name, note, fileId });
  });
  return result;
}

function readItemAccessories_(value: unknown, reader: ObjectReader): ItemAccessoryDto[] {
  if (!Array.isArray(value)) {
    reader.fail('accessories', 'Harus berupa daftar kelengkapan');
    return [];
  }
  if (value.length > ITEM_LIMITS.accessories) {
    reader.fail('accessories', `Maksimal ${ITEM_LIMITS.accessories} kelengkapan`);
    return [];
  }
  const result: ItemAccessoryDto[] = [];
  value.forEach((entry, index) => {
    const label = `Kelengkapan ${index + 1}`;
    if (!isItemRecord_(entry)) {
      reader.fail('accessories', `${label}: tidak valid`);
      return;
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (name === '') {
      reader.fail('accessories', `${label}: nama wajib diisi`);
      return;
    }
    if (name.length > ITEM_LIMITS.accessoryName) {
      reader.fail('accessories', `${label}: nama maksimal ${ITEM_LIMITS.accessoryName} karakter`);
      return;
    }
    const qty = entry.qty;
    if (
      typeof qty !== 'number' ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > ITEM_LIMITS.accessoryQty
    ) {
      reader.fail('accessories', `${label}: jumlah harus bilangan bulat 1–${ITEM_LIMITS.accessoryQty}`);
      return;
    }
    result.push({ name, qty });
  });
  return result;
}

function readItemAttachments_(value: unknown, reader: ObjectReader): string[] {
  if (!Array.isArray(value)) {
    reader.fail('attachments', 'Harus berupa daftar berkas');
    return [];
  }
  const result: string[] = [];
  for (const entry of value) {
    const id = typeof entry === 'string' ? entry.trim() : '';
    if (id === '' || id.length > 100) {
      reader.fail('attachments', 'Harus berupa daftar berkas');
      return [];
    }
    if (!result.includes(id)) result.push(id);
  }
  if (result.length > ITEM_LIMITS.attachments) {
    reader.fail('attachments', `Maksimal ${ITEM_LIMITS.attachments} gambar`);
  }
  return result;
}

function readItemDetail_(value: unknown, reader: ObjectReader): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    reader.fail('detail', 'Harus berupa teks');
    return '';
  }
  const detail = normalizeNewlines(value);
  if (detail.length > MARKDOWN_MAX_LENGTH) {
    reader.fail('detail', `Maksimal ${MARKDOWN_MAX_LENGTH} karakter`);
  }
  return detail;
}

export function validateSaveItem_(raw: unknown): SaveItemInput {
  const reader = readObject_(raw);
  const id = reader.optionalId('id');
  const brand = reader.str('brand', { required: true, max: ITEM_LIMITS.brand });
  const model = reader.str('model', { required: true, max: ITEM_LIMITS.model });
  const lock = reader.raw('isCountryLock');
  if (typeof lock !== 'boolean') reader.fail('isCountryLock', 'Harus true atau false');
  const aliases = readItemAliases_(reader.raw('aliases'), reader);
  const stickers = readItemStickers_(reader.raw('stickers'), reader);
  const accessories = readItemAccessories_(reader.raw('accessories'), reader);
  const attachments = readItemAttachments_(reader.raw('attachments'), reader);
  const detail = readItemDetail_(reader.raw('detail'), reader);
  reader.done();
  const input = {
    brand,
    model,
    isCountryLock: lock === true,
    aliases,
    stickers,
    accessories,
    attachments,
    detail,
  };
  return id ? { id, ...input } : input;
}

export function validateGetItem_(raw: unknown): GetItemInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}

export function validateSetItemStatus_(raw: unknown): SetItemStatusInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const status = reader.oneOf('status', ITEM_STATUS_VALUES);
  reader.done();
  return { id, status };
}
```

- [ ] **Step 5: Fixture** — `gas/test-support/item-fixtures.ts`

```ts
import type { NewItemRecord } from '@gas/modules/item/repo';
import { itemKey } from '@shared/items';

const SEED_TIME = '2026-01-01T00:00:00.000Z';

export function item(
  overrides: Partial<NewItemRecord> & Pick<NewItemRecord, 'id' | 'brand' | 'model'>,
): NewItemRecord {
  return {
    externalId: '',
    key: itemKey(overrides.brand, overrides.model),
    isCountryLock: false,
    aliases: [],
    stickers: [],
    accessories: [],
    attachments: [],
    detail: '',
    status: 'active',
    syncRev: 0,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    updatedBy: 'seed',
    ...overrides,
  };
}
```

- [ ] **Step 6: `setup` membuat sheet `items`** — `gas/src/setup.ts` dan `gas/src/setup.test.ts`

`setup.ts`: tambahkan impor `import { ITEMS_TABLE } from '@gas/modules/item/repo';` dan ubah daftar tabel menjadi `[USERS_TABLE, ROLES_TABLE, AUDIT_TABLE, LOCATIONS_TABLE, FILES_TABLE, ITEMS_TABLE]`.

`setup.test.ts`: ubah ekspektasi urutan sheet menjadi `['users', 'roles', 'audit_log', 'locations', 'files', 'items']` dan judul tesnya menjadi "membuat sheet users, roles, audit_log, locations, files, items beserta header".

- [ ] **Step 7: Jalankan tes**

Run: `bun run --cwd gas test item/validate setup`
Expected: validator dan setup lulus. (`typecheck` gas masih gagal sampai Task 3 mendaftarkan rute; itu diharapkan.)

- [ ] **Step 8: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas
git add gas
git commit -m "feat(item): repo, validator, fixture, dan sheet items" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Layanan, rute, dan audit item (GAS)

**Files:**
- Create: `gas/src/modules/item/service.ts`, `gas/src/modules/item/routes.ts`, `gas/src/modules/item/item.test.ts`
- Modify: `gas/src/routes.ts`, `gas/src/routes.test.ts`

**Interfaces:**
- Consumes: Task 1 (`itemKey`, `normalizeKey`, `extractFileRefs`, `hashText`), Task 2 (`listItems_`, `insertItem_`, `updateItem_`, `ItemRecord`, `NewItemRecord`, validator), Fase A (`attachFiles_`, `uploadFile_`, `validateUploadFile_`), `nowIso_` dan `appendAudit_` dari modul `access`.
- Produces:
  - `service.ts`: `listItemSummaries_(): ItemSummaryDto[]`, `getItemDto_(input): ItemDto`, `saveItem_(input, actor): ItemDto`, `setItemStatus_(input, actor): ItemDto`.
  - Rute: `items.list`/`items.get` = `item: view`, `items.save` = `item: edit`, `items.setStatus` = `item: manage`.
  - Aksi audit: `item.create`, `item.update`, `item.activate`, `item.deactivate`; target = `"<merk> <tipe>"`.
  - Snapshot audit: `{ brand, model, isCountryLock, status, aliases: string[], stickers: string[], accessories: string[], attachments: string[], detailLength: number, detailHash: string }` (stiker `"<nama>[ — <catatan>][ · bergambar]"`, kelengkapan `"<nama> ×<jumlah>"`).

- [ ] **Step 1: Tulis tes yang gagal** — `gas/src/modules/item/item.test.ts`

```ts
import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { handleRpc_ } from '@gas/core/router';
import { signSessionToken_ } from '@gas/core/session';
import type { UserContext } from '@gas/modules/access/context';
import { loadUserContext_ } from '@gas/modules/access/context';
import { insertRole_, insertUser_, listAuditRecords_ } from '@gas/modules/access/repo';
import { listFiles_ } from '@gas/modules/files/repo';
import { uploadFile_ } from '@gas/modules/files/service';
import { validateUploadFile_ } from '@gas/modules/files/validate';
import { getRoutes_ } from '@gas/routes';
import { role, user } from '@gas-test/access-fixtures';
import { captureAppError } from '@gas-test/errors';
import { item } from '@gas-test/item-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { hashText } from '@shared/items';
import type { SaveItemInput } from '@shared/rpc';
import { listItems_, insertItem_ } from './repo';
import { getItemDto_, listItemSummaries_, saveItem_, setItemStatus_ } from './service';

const PNG = 'iVBORw0KGgoAAAANSUhEUg==';

let platform: MemoryPlatform;
let admin: UserContext;

const baseInput: SaveItemInput = {
  brand: 'Ubiquiti',
  model: 'ES 24 250W',
  isCountryLock: false,
  aliases: [],
  stickers: [],
  accessories: [],
  attachments: [],
  detail: '',
};

const newFile = () =>
  uploadFile_(validateUploadFile_({ mime: 'image/png', base64: PNG, width: 1, height: 1 }), admin).id;

function lastAudit() {
  const record = listAuditRecords_().at(-1);
  if (!record) throw new Error('audit kosong');
  return record;
}

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

test('membuat item: aktif, kolom sinkron kosong, audit create tanpa teks Markdown penuh', () => {
  const detail = '## Spesifikasi\n'.repeat(200);
  const saved = saveItem_(
    {
      ...baseInput,
      detail,
      aliases: ['ES24'],
      stickers: [
        { name: 'Label SNI', note: 'Belakang', fileId: null },
        { name: 'Garansi', note: '', fileId: null },
      ],
      accessories: [{ name: 'Kabel daya', qty: 2 }],
    },
    admin,
  );
  expect(saved).toMatchObject({
    brand: 'Ubiquiti',
    model: 'ES 24 250W',
    status: 'active',
    externalId: '',
    isCountryLock: false,
    imageCount: 0,
    updatedBy: 'admin@gmail.com',
    createdAt: '2026-10-09T00:00:00.000Z',
  });
  expect(saved.detail).toBe(detail);
  expect(lastAudit()).toMatchObject({
    action: 'item.create',
    target: 'Ubiquiti ES 24 250W',
    before: null,
    after: {
      brand: 'Ubiquiti',
      model: 'ES 24 250W',
      isCountryLock: false,
      status: 'active',
      aliases: ['ES24'],
      stickers: ['Label SNI — Belakang', 'Garansi'],
      accessories: ['Kabel daya ×2'],
      attachments: [],
      detailLength: detail.length,
      detailHash: hashText(detail),
    },
  });
  expect(JSON.stringify(lastAudit().after)).not.toContain('Spesifikasi');
});

test('daftar ringkas terurut merk lalu tipe, memuat nonaktif, tanpa detail Markdown', () => {
  insertItem_(item({ id: 'i2', brand: 'Ubiquiti', model: 'B', detail: 'RAHASIA', attachments: ['f1', 'f2'] }));
  insertItem_(item({ id: 'i1', brand: 'Mikrotik', model: 'Z', status: 'inactive' }));
  insertItem_(item({ id: 'i3', brand: 'Ubiquiti', model: 'A', isCountryLock: true }));
  const list = listItemSummaries_();
  expect(list.map((i) => `${i.brand} ${i.model}`)).toEqual(['Mikrotik Z', 'Ubiquiti A', 'Ubiquiti B']);
  expect(list.find((i) => i.id === 'i2')?.imageCount).toBe(2);
  expect(list.find((i) => i.id === 'i1')?.status).toBe('inactive');
  expect(JSON.stringify(list)).not.toContain('RAHASIA');
  expect('detail' in (list[0] ?? {})).toBe(false);
});

test('getItemDto_ memuat detail lengkap; id tak dikenal NOT_FOUND', () => {
  insertItem_(item({ id: 'i1', brand: 'A', model: 'B', detail: '# isi', accessories: [{ name: 'x', qty: 1 }] }));
  expect(getItemDto_({ id: 'i1' })).toMatchObject({ detail: '# isi', accessories: [{ name: 'x', qty: 1 }] });
  expect(captureAppError(() => getItemDto_({ id: 'tidak-ada' })).code).toBe('NOT_FOUND');
});

test('merk+tipe unik walau beda huruf besar, tanda baca, dan spasi; pesan di field tipe', () => {
  saveItem_(baseInput, admin);
  for (const variant of ['es-24 250w', 'ES_24  250W', '(ES) 24, 250W']) {
    const error = captureAppError(() => saveItem_({ ...baseInput, brand: 'UBIQUITI', model: variant }, admin));
    expect(error).toMatchObject({ code: 'CONFLICT', fields: { model: 'Merk dan tipe sudah dipakai item lain' } });
  }
  expect(listItems_()).toHaveLength(1);
});

test('mengubah item sendiri dengan merk+tipe yang sama tidak dianggap duplikat', () => {
  const first = saveItem_(baseInput, admin);
  const again = saveItem_({ ...baseInput, id: first.id, isCountryLock: true }, admin);
  expect(again.id).toBe(first.id);
  expect(again.isCountryLock).toBe(true);
  expect(listItems_()).toHaveLength(1);
});

test('nama lain: tidak boleh sama dengan merk+tipe sendiri, merk+tipe item lain, atau nama lain item lain', () => {
  saveItem_({ ...baseInput, aliases: ['AirSwitch', 'Ubiquiti ES24'] }, admin);
  const other = { ...baseInput, brand: 'Mikrotik', model: 'CRS' };
  expect(
    captureAppError(() => saveItem_({ ...other, aliases: ['mikrotik-crs'] }, admin)),
  ).toMatchObject({
    code: 'VALIDATION',
    fields: { aliases: 'Nama lain tidak boleh sama dengan merk dan tipe item ini' },
  });
  expect(
    captureAppError(() => saveItem_({ ...other, aliases: ['ubiquiti es 24 250w'] }, admin)).fields?.aliases,
  ).toContain('sudah dipakai item Ubiquiti ES 24 250W');
  expect(
    captureAppError(() => saveItem_({ ...other, aliases: ['air-switch', 'airswitch'] }, admin)).code,
  ).toBe('CONFLICT');
  expect(
    captureAppError(() => saveItem_({ ...other, aliases: ['AIRSWITCH'] }, admin)).fields?.aliases,
  ).toContain('"AIRSWITCH" sudah dipakai item Ubiquiti ES 24 250W');
  // merk+tipe baru yang sama dengan nama lain item lain juga ditolak
  expect(
    captureAppError(() => saveItem_({ ...baseInput, brand: 'Ubiquiti', model: 'ES24' }, admin)),
  ).toMatchObject({
    code: 'CONFLICT',
    fields: { model: 'Sama dengan nama lain item Ubiquiti ES 24 250W' },
  });
  expect(listItems_()).toHaveLength(1);
});

test('gambar galeri, contoh stiker, dan Markdown ditautkan ke item dalam satu batch', () => {
  const [gallery, sticker, inText] = [newFile(), newFile(), newFile()];
  const saved = saveItem_(
    {
      ...baseInput,
      attachments: [gallery],
      stickers: [{ name: 'Label', note: '', fileId: sticker }],
      detail: `Teks ![x](qcfile:${inText}) dan ![lagi](qcfile:${gallery})`,
    },
    admin,
  );
  const owned = listFiles_().map((f) => [f.id, f.ownerType, f.ownerId]);
  expect(owned.sort()).toEqual(
    [gallery, sticker, inText].map((id) => [id, 'item', saved.id]).sort(),
  );
  expect(saved.imageCount).toBe(1);
});

test('rujukan berkas yang gagal membatalkan seluruh simpan: tidak ada item dan tidak ada pemilik berubah', () => {
  const [free, taken] = [newFile(), newFile()];
  saveItem_({ ...baseInput, brand: 'Lain', model: 'Item', attachments: [taken] }, admin);
  const before = JSON.stringify(listFiles_());

  // berkas tak dikenal di belakang berkas bebas
  expect(
    captureAppError(() => saveItem_({ ...baseInput, attachments: [free, 'hilang'] }, admin)).code,
  ).toBe('VALIDATION');
  // berkas milik item lain di dalam Markdown
  expect(
    captureAppError(() =>
      saveItem_({ ...baseInput, attachments: [free], detail: `![x](qcfile:${taken})` }, admin),
    ).code,
  ).toBe('CONFLICT');

  expect(JSON.stringify(listFiles_())).toBe(before);
  expect(listItems_().map((i) => i.brand)).toEqual(['Lain']);
});

test('mengubah item mempertahankan id MySQL, revisi sinkron, dan waktu dibuat', () => {
  insertItem_(
    item({ id: 'i1', brand: 'Ubiquiti', model: 'ES 24 250W', externalId: '12', syncRev: 7, createdAt: '2026-01-01T00:00:00.000Z' }),
  );
  const saved = saveItem_({ ...baseInput, id: 'i1', isCountryLock: true }, admin);
  expect(saved).toMatchObject({ externalId: '12', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' });
  expect(listItems_()[0]).toMatchObject({ externalId: '12', syncRev: 7, status: 'active' });
});

test('mengubah item mencatat snapshot sebelum dan sesudah; id tak dikenal NOT_FOUND', () => {
  const first = saveItem_({ ...baseInput, accessories: [{ name: 'Kabel', qty: 1 }] }, admin);
  saveItem_(
    { ...baseInput, id: first.id, accessories: [{ name: 'Kabel', qty: 2 }, { name: 'Adaptor', qty: 1 }], detail: 'baru' },
    admin,
  );
  expect(lastAudit()).toMatchObject({
    action: 'item.update',
    before: { accessories: ['Kabel ×1'], detailLength: 0 },
    after: { accessories: ['Kabel ×2', 'Adaptor ×1'], detailLength: 4, detailHash: hashText('baru') },
  });
  expect(captureAppError(() => saveItem_({ ...baseInput, id: 'tidak-ada' }, admin)).code).toBe('NOT_FOUND');
});

test('nonaktifkan dan aktifkan dicatat; status sama tidak mencatat apa pun', () => {
  const saved = saveItem_(baseInput, admin);
  expect(setItemStatus_({ id: saved.id, status: 'inactive' }, admin).status).toBe('inactive');
  expect(lastAudit()).toMatchObject({
    action: 'item.deactivate',
    target: 'Ubiquiti ES 24 250W',
    before: { status: 'active' },
    after: { status: 'inactive' },
  });
  const count = listAuditRecords_().length;
  setItemStatus_({ id: saved.id, status: 'inactive' }, admin);
  expect(listAuditRecords_()).toHaveLength(count);
  expect(setItemStatus_({ id: saved.id, status: 'active' }, admin).status).toBe('active');
  expect(lastAudit().action).toBe('item.activate');
  expect(captureAppError(() => setItemStatus_({ id: 'x', status: 'active' }, admin)).code).toBe('NOT_FOUND');
});

test('item nonaktif dapat diubah dan tetap nonaktif', () => {
  const saved = saveItem_(baseInput, admin);
  setItemStatus_({ id: saved.id, status: 'inactive' }, admin);
  const edited = saveItem_({ ...baseInput, id: saved.id, isCountryLock: true }, admin);
  expect(edited.status).toBe('inactive');
});

test('rute: view membaca, edit menyimpan, hanya manage menonaktifkan; daftar tanpa detail', () => {
  insertRole_(role({ id: 'r-view', name: 'Lihat', permissions: { item: 'view' } }));
  insertRole_(role({ id: 'r-edit', name: 'Ubah', permissions: { item: 'edit' } }));
  insertRole_(role({ id: 'r-manage', name: 'Kelola', permissions: { item: 'manage' } }));
  insertUser_(user({ id: 'u-v', email: 'lihat@gmail.com', roleIds: ['r-view'] }));
  insertUser_(user({ id: 'u-e', email: 'ubah@gmail.com', roleIds: ['r-edit'] }));
  insertUser_(user({ id: 'u-m', email: 'kelola@gmail.com', roleIds: ['r-manage'] }));
  insertUser_(user({ id: 'u-n', email: 'tanpa@gmail.com' }));
  const call = (method: string, payload: unknown, email: string) =>
    handleRpc_(method, JSON.stringify(payload), signSessionToken_(email), getRoutes_());
  const code = (result: ReturnType<typeof call>) => (result.ok ? 'OK' : result.error.code);

  const saved = call('items.save', baseInput, 'ubah@gmail.com');
  expect(code(saved)).toBe('OK');
  const id = saved.ok ? (saved.data as { id: string }).id : '';

  expect(code(call('items.save', baseInput, 'lihat@gmail.com'))).toBe('FORBIDDEN');
  expect(code(call('items.save', baseInput, 'tanpa@gmail.com'))).toBe('FORBIDDEN');
  expect(code(call('items.list', null, 'lihat@gmail.com'))).toBe('OK');
  expect(code(call('items.get', { id }, 'lihat@gmail.com'))).toBe('OK');
  expect(code(call('items.list', null, 'tanpa@gmail.com'))).toBe('FORBIDDEN');
  expect(code(call('items.setStatus', { id, status: 'inactive' }, 'ubah@gmail.com'))).toBe('FORBIDDEN');
  expect(code(call('items.setStatus', { id, status: 'inactive' }, 'kelola@gmail.com'))).toBe('OK');

  const list = call('items.list', null, 'lihat@gmail.com');
  expect(list.ok && JSON.stringify(list.data).includes('"detail"')).toBe(false);
});
```

Perbarui `gas/src/routes.test.ts`: tambahkan `'items.get'`, `'items.list'`, `'items.save'`, `'items.setStatus'` ke daftar kunci terurut (setelah `'files.upload'`), dan tambahkan:

```ts
  expect(routes['items.list'].permission).toEqual({ module: 'item', level: 'view' });
  expect(routes['items.get'].permission).toEqual({ module: 'item', level: 'view' });
  expect(routes['items.save'].permission).toEqual({ module: 'item', level: 'edit' });
  expect(routes['items.setStatus'].permission).toEqual({ module: 'item', level: 'manage' });
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test item`
Expected: FAIL — `./service` belum ada.

- [ ] **Step 3: Layanan** — `gas/src/modules/item/service.ts`

```ts
import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import type { UserContext } from '@gas/modules/access/context';
import { appendAudit_ } from '@gas/modules/access/repo';
import { nowIso_ } from '@gas/modules/access/service';
import { attachFiles_ } from '@gas/modules/files/service';
import { extractFileRefs, hashText, itemKey, normalizeKey } from '@shared/items';
import type {
  GetItemInput,
  ItemDto,
  ItemSummaryDto,
  SaveItemInput,
  SetItemStatusInput,
} from '@shared/rpc';
import type { ItemRecord, NewItemRecord } from './repo';
import { insertItem_, listItems_, updateItem_ } from './repo';

function toItemSummaryDto_(item: NewItemRecord): ItemSummaryDto {
  return {
    id: item.id,
    externalId: item.externalId,
    brand: item.brand,
    model: item.model,
    isCountryLock: item.isCountryLock,
    status: item.status,
    aliases: [...item.aliases],
    imageCount: item.attachments.length,
    updatedAt: item.updatedAt,
  };
}

function toItemDto_(item: NewItemRecord): ItemDto {
  return {
    ...toItemSummaryDto_(item),
    stickers: item.stickers.map((sticker) => ({ ...sticker })),
    accessories: item.accessories.map((accessory) => ({ ...accessory })),
    attachments: [...item.attachments],
    detail: item.detail,
    createdAt: item.createdAt,
    updatedBy: item.updatedBy,
  };
}

/** Snapshot audit ringkas: teks Markdown tidak disimpan, hanya panjang dan hash (sel audit maks. 50.000 karakter). */
function itemSnapshot_(item: NewItemRecord): Record<string, unknown> {
  return {
    brand: item.brand,
    model: item.model,
    isCountryLock: item.isCountryLock,
    status: item.status,
    aliases: [...item.aliases],
    stickers: item.stickers.map(
      (sticker) =>
        `${sticker.name}${sticker.note ? ` — ${sticker.note}` : ''}${sticker.fileId ? ' · bergambar' : ''}`,
    ),
    accessories: item.accessories.map((accessory) => `${accessory.name} ×${accessory.qty}`),
    attachments: [...item.attachments],
    detailLength: item.detail.length,
    detailHash: hashText(item.detail),
  };
}

function itemLabel_(item: { brand: string; model: string }): string {
  return `${item.brand} ${item.model}`;
}

export function listItemSummaries_(): ItemSummaryDto[] {
  return listItems_()
    .map(toItemSummaryDto_)
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
}

export function getItemDto_(input: GetItemInput): ItemDto {
  const found = listItems_().find((item) => item.id === input.id);
  if (!found) throw appError_('NOT_FOUND', 'Item tidak ditemukan');
  return toItemDto_(found);
}

/** Merk+tipe dan nama lain harus unik terhadap item lain (kunci ternormalisasi). */
function assertItemNamesFree_(
  input: SaveItemInput,
  key: string,
  others: readonly ItemRecord[],
): void {
  if (others.some((other) => other.key === key)) {
    throw appError_('CONFLICT', 'Merk dan tipe sudah dipakai item lain', {
      model: 'Merk dan tipe sudah dipakai item lain',
    });
  }
  const holder = others.find((other) => other.aliases.some((alias) => normalizeKey(alias) === key));
  if (holder) {
    throw appError_('CONFLICT', 'Merk dan tipe sama dengan nama lain item lain', {
      model: `Sama dengan nama lain item ${itemLabel_(holder)}`,
    });
  }
  for (const alias of input.aliases) {
    const aliasKey = normalizeKey(alias);
    if (aliasKey === key) {
      throw appError_('VALIDATION', 'Nama lain sama dengan merk dan tipe', {
        aliases: 'Nama lain tidak boleh sama dengan merk dan tipe item ini',
      });
    }
    const owner = others.find(
      (other) => other.key === aliasKey || other.aliases.some((x) => normalizeKey(x) === aliasKey),
    );
    if (owner) {
      const message = `Nama lain "${alias}" sudah dipakai item ${itemLabel_(owner)}`;
      throw appError_('CONFLICT', message, { aliases: message });
    }
  }
}

/** Semua berkas yang dirujuk item: galeri, contoh stiker, dan gambar di dalam Markdown. */
function referencedFileIds_(input: SaveItemInput): string[] {
  const ids: string[] = [...input.attachments];
  for (const sticker of input.stickers) {
    if (sticker.fileId !== null) ids.push(sticker.fileId);
  }
  ids.push(...extractFileRefs(input.detail));
  return [...new Set(ids)];
}

export function saveItem_(input: SaveItemInput, actor: UserContext): ItemDto {
  return platform_().withLock(() => {
    const items = listItems_();
    const existing = input.id ? items.find((item) => item.id === input.id) : undefined;
    if (input.id && !existing) throw appError_('NOT_FOUND', 'Item tidak ditemukan');
    const key = itemKey(input.brand, input.model);
    assertItemNamesFree_(
      input,
      key,
      items.filter((item) => item.id !== input.id),
    );
    const id = existing?.id ?? platform_().uuid();
    // Atomik: bila ada rujukan berkas yang tak sah, tidak ada pemilik yang berubah dan item tidak disimpan.
    attachFiles_(referencedFileIds_(input), 'item', id);
    const now = nowIso_();
    const fields = {
      brand: input.brand,
      model: input.model,
      key,
      isCountryLock: input.isCountryLock,
      aliases: [...input.aliases],
      stickers: input.stickers.map((sticker) => ({ ...sticker })),
      accessories: input.accessories.map((accessory) => ({ ...accessory })),
      attachments: [...input.attachments],
      detail: input.detail,
      updatedAt: now,
      updatedBy: actor.email,
    };

    if (existing) {
      const updated: ItemRecord = { ...existing, ...fields };
      updateItem_(updated);
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'item.update',
        target: itemLabel_(updated),
        before: itemSnapshot_(existing),
        after: itemSnapshot_(updated),
      });
      return toItemDto_(updated);
    }

    const created: NewItemRecord = {
      id,
      externalId: '',
      status: 'active',
      syncRev: 0,
      createdAt: now,
      ...fields,
    };
    insertItem_(created);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'item.create',
      target: itemLabel_(created),
      before: null,
      after: itemSnapshot_(created),
    });
    return toItemDto_(created);
  });
}

export function setItemStatus_(input: SetItemStatusInput, actor: UserContext): ItemDto {
  return platform_().withLock(() => {
    const existing = listItems_().find((item) => item.id === input.id);
    if (!existing) throw appError_('NOT_FOUND', 'Item tidak ditemukan');
    if (existing.status === input.status) return toItemDto_(existing);
    const now = nowIso_();
    const updated: ItemRecord = {
      ...existing,
      status: input.status,
      updatedAt: now,
      updatedBy: actor.email,
    };
    updateItem_(updated);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'item.activate' : 'item.deactivate',
      target: itemLabel_(existing),
      before: itemSnapshot_(existing),
      after: itemSnapshot_(updated),
    });
    return toItemDto_(updated);
  });
}
```

- [ ] **Step 4: Rute** — `gas/src/modules/item/routes.ts`

```ts
import type { RouteTable } from '@gas/core/router';
import { expectNull_ } from '@gas/core/validate';
import { getItemDto_, listItemSummaries_, saveItem_, setItemStatus_ } from './service';
import { validateGetItem_, validateSaveItem_, validateSetItemStatus_ } from './validate';

type ItemMethod = 'items.list' | 'items.get' | 'items.save' | 'items.setStatus';

export function itemRoutes_(): Pick<RouteTable, ItemMethod> {
  return {
    'items.list': {
      permission: { module: 'item', level: 'view' },
      validate: expectNull_,
      handler: () => listItemSummaries_(),
    },
    'items.get': {
      permission: { module: 'item', level: 'view' },
      validate: validateGetItem_,
      handler: (input) => getItemDto_(input),
    },
    'items.save': {
      permission: { module: 'item', level: 'edit' },
      validate: validateSaveItem_,
      handler: (input, ctx) => saveItem_(input, ctx.user),
    },
    'items.setStatus': {
      permission: { module: 'item', level: 'manage' },
      validate: validateSetItemStatus_,
      handler: (input, ctx) => setItemStatus_(input, ctx.user),
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
import { itemRoutes_ } from '@gas/modules/item/routes';

/** Dibangun lazy di dalam fungsi karena urutan load file GAS tidak dijamin. */
export function getRoutes_(): RouteTable {
  return { ...authRoutes_(), ...accessRoutes_(), ...filesRoutes_(), ...itemRoutes_() };
}
```

- [ ] **Step 5: Jalankan semua tes gas, typecheck, dan build GAS**

Run: `bun run --cwd shared test && bun run --cwd gas test && bun run --cwd gas typecheck && bun scripts/build-gas.ts`
Expected: semua lulus; typecheck bersih (kontrak `RpcContract` kini terpenuhi); build GAS lolos aturan nama global (`listItems_`, `insertItem_`, `updateItem_`, `itemSnapshot_`, `itemLabel_`, `toItemRecord_`, `parseItemJson_`, … unik).

- [ ] **Step 6: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas shared
git add gas shared
git commit -m "feat(item): simpan, baca, nonaktifkan item dengan keunikan, tautan berkas atomik, dan audit" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Fondasi web item — skema form, query, pencarian, menu, data demo, dan halaman daftar

**Files:**
- Create: `web/src/modules/item/schemas.ts`, `schemas.test.ts`, `queries.ts`, `lib/filter-items.ts`, `lib/filter-items.test.ts`, `components/items-table.tsx`, `components/items-table.test.tsx`; `web/src/routes/_app/item/index.tsx`
- Modify: `web/src/app/navigation.ts`, `web/src/app/module-links.ts`, `web/src/lib/rpc/mock-backend.ts`, `web/src/lib/rpc/mock-backend.test.ts`

**Interfaces:**
- Consumes: `ItemSummaryDto`, `ItemDto`, `SaveItemInput` (Task 1); `rpc` dan kontrak `items.*` (Task 3); `normalizeKey`, `ITEM_LIMITS`; `MARKDOWN_MAX_LENGTH`; `can`, `requirePermission`; `useUrlSyncedText` (modul `access`); `accessKeys` (modul `access`).
- Produces:
  - `schemas.ts`: `ITEM_FIELD_KEYS`, `type ItemFieldErrors`, `itemFormSchema`, `type ItemFormInput`/`ItemFormOutput`, `parseAliasLines(text)`, `toItemFormDefaults(item?)`, `toSaveItemInput(values, id?)`.
  - `queries.ts`: `itemKeys`, `itemsQueryOptions()`, `itemQueryOptions(id)`, `useSaveItem()`, `useSetItemStatus()`.
  - `filter-items.ts`: `filterItems(items, { q, status })`.
  - `ItemsTable` (`items`, `canEdit`, `canManage`, `pendingStatusId`, `onOpen`, `onEdit`, `onToggleStatus`).
  - Rute `/item` (daftar); menu "Data Item"; modul `item` ditautkan di beranda.

- [ ] **Step 1: Tulis tes skema yang gagal** — `web/src/modules/item/schemas.test.ts`

```ts
import type { ItemDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { itemFormSchema, parseAliasLines, toItemFormDefaults, toSaveItemInput } from './schemas';

const valid = {
  brand: 'Ubiquiti',
  model: 'ES 24 250W',
  isCountryLock: false,
  aliasesText: '',
  stickers: [],
  accessories: [],
  attachments: [],
  detail: '',
};

const messages = (override: Record<string, unknown>) => {
  const result = itemFormSchema.safeParse({ ...valid, ...override });
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

test('parseAliasLines: satu per baris, dirapikan, kosong dan kembar (ternormalisasi) dibuang', () => {
  expect(parseAliasLines(' ES24 \n\n  es24 \nAirFiber\nair-fiber')).toEqual(['ES24', 'AirFiber', 'air-fiber']);
  expect(parseAliasLines('')).toEqual([]);
});

test('input sah lolos', () => {
  expect(messages({})).toEqual([]);
});

test('merk dan tipe wajib dan dibatasi', () => {
  expect(messages({ brand: '  ', model: '' })).toEqual(['Wajib diisi', 'Wajib diisi']);
  expect(messages({ brand: 'x'.repeat(61) })).toEqual(['Maksimal 60 karakter']);
  expect(messages({ model: 'x'.repeat(101) })).toEqual(['Maksimal 100 karakter']);
});

test('nama lain: panjang, harus memuat huruf/angka, maksimal 10', () => {
  expect(messages({ aliasesText: 'x'.repeat(101) })).toEqual(['Maksimal 100 karakter per nama lain']);
  expect(messages({ aliasesText: '--' })).toEqual(['Nama lain harus memuat huruf atau angka']);
  const eleven = Array.from({ length: 11 }, (_, i) => `alias ${i}`).join('\n');
  expect(messages({ aliasesText: eleven })).toEqual(['Maksimal 10 nama lain']);
});

test('stiker: pesan bernomor per baris', () => {
  expect(messages({ stickers: [{ name: ' ', note: '', fileId: null }] })).toEqual(['Stiker 1: nama wajib diisi']);
  expect(
    messages({
      stickers: [
        { name: 'ok', note: '', fileId: null },
        { name: 'b', note: 'x'.repeat(301), fileId: null },
      ],
    }),
  ).toEqual(['Stiker 2: catatan maksimal 300 karakter']);
});

test('kelengkapan: nama wajib, jumlah bilangan bulat 1–999', () => {
  expect(messages({ accessories: [{ name: '', qty: 1 }] })).toEqual(['Kelengkapan 1: nama wajib diisi']);
  for (const qty of [0, -1, 1000, 1.5]) {
    expect(messages({ accessories: [{ name: 'Kabel', qty }] })).toEqual([
      'Kelengkapan 1: jumlah harus bilangan bulat 1–999',
    ]);
  }
});

test('lampiran maksimal 10 dan detail maksimal 20000 karakter', () => {
  const eleven = Array.from({ length: 11 }, (_, i) => `f${i}`);
  expect(messages({ attachments: eleven })).toEqual(['Maksimal 10 gambar']);
  expect(messages({ detail: 'x'.repeat(20_001) })).toEqual(['Maksimal 20000 karakter']);
});

test('toSaveItemInput merapikan teks dan mengubah nama lain menjadi daftar; id hanya bila ada', () => {
  const input = toSaveItemInput(
    {
      ...valid,
      brand: ' Ubiquiti ',
      model: ' ES 24 ',
      aliasesText: ' ES24 \n AirFiber ',
      stickers: [{ name: ' Label ', note: ' Belakang ', fileId: 'f1' }],
      accessories: [{ name: ' Kabel ', qty: 2 }],
      attachments: ['a'],
      detail: 'isi',
    },
    'i1',
  );
  expect(input).toEqual({
    id: 'i1',
    brand: 'Ubiquiti',
    model: 'ES 24',
    isCountryLock: false,
    aliases: ['ES24', 'AirFiber'],
    stickers: [{ name: 'Label', note: 'Belakang', fileId: 'f1' }],
    accessories: [{ name: 'Kabel', qty: 2 }],
    attachments: ['a'],
    detail: 'isi',
  });
  expect('id' in toSaveItemInput(valid)).toBe(false);
});

test('toItemFormDefaults: kosong tanpa item; dari item menggabungkan nama lain per baris', () => {
  expect(toItemFormDefaults()).toEqual({
    brand: '',
    model: '',
    isCountryLock: false,
    aliasesText: '',
    stickers: [],
    accessories: [],
    attachments: [],
    detail: '',
  });
  const item: ItemDto = {
    id: 'i1',
    externalId: '12',
    brand: 'Ubiquiti',
    model: 'ES 24',
    isCountryLock: true,
    status: 'active',
    aliases: ['ES24', 'AirFiber'],
    imageCount: 1,
    updatedAt: '',
    stickers: [{ name: 'Label', note: '', fileId: null }],
    accessories: [{ name: 'Kabel', qty: 1 }],
    attachments: ['a'],
    detail: '# isi',
    createdAt: '',
    updatedBy: '',
  };
  expect(toItemFormDefaults(item)).toMatchObject({
    brand: 'Ubiquiti',
    isCountryLock: true,
    aliasesText: 'ES24\nAirFiber',
    stickers: [{ name: 'Label', note: '', fileId: null }],
    attachments: ['a'],
    detail: '# isi',
  });
});
```

- [ ] **Step 2: Tulis tes pencarian dan tabel yang gagal**

`web/src/modules/item/lib/filter-items.test.ts`:

```ts
import type { ItemSummaryDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { filterItems } from './filter-items';

const make = (id: string, brand: string, model: string, over: Partial<ItemSummaryDto> = {}): ItemSummaryDto => ({
  id,
  externalId: '',
  brand,
  model,
  isCountryLock: false,
  status: 'active',
  aliases: [],
  imageCount: 0,
  updatedAt: '',
  ...over,
});

const items = [
  make('1', 'Ubiquiti', 'ES 24 250W', { aliases: ['AirSwitch'] }),
  make('2', 'Ubiquiti', 'AF 5XHD', { status: 'inactive' }),
  make('3', 'Mikrotik', 'hAP ac2'),
];

const ids = (q: string, status: 'all' | 'active' | 'inactive' = 'all') =>
  filterItems(items, { q, status }).map((i) => i.id);

test('kosong mengembalikan semua; filter status', () => {
  expect(ids('')).toEqual(['1', '2', '3']);
  expect(ids('', 'active')).toEqual(['1', '3']);
  expect(ids('', 'inactive')).toEqual(['2']);
});

test('pencarian toleran: huruf besar, tanda baca, urutan kata, dan tanpa spasi', () => {
  expect(ids('es-24 250w')).toEqual(['1']);
  expect(ids('ES24')).toEqual(['1']);
  expect(ids('250w ubiquiti')).toEqual(['1']);
  expect(ids('ubiquiti')).toEqual(['1', '2']);
  expect(ids('hap-ac2')).toEqual(['3']);
});

test('nama lain ikut dicari', () => {
  expect(ids('air switch')).toEqual(['1']);
  expect(ids('airswitch')).toEqual(['1']);
});

test('tidak ada yang cocok menghasilkan daftar kosong; status digabung dengan kata kunci', () => {
  expect(ids('tidak ada')).toEqual([]);
  expect(ids('ubiquiti', 'inactive')).toEqual(['2']);
});
```

`web/src/modules/item/components/items-table.test.tsx`:

```tsx
import type { ItemSummaryDto } from '@shared/rpc';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ItemsTable } from './items-table';

const items: ItemSummaryDto[] = [
  {
    id: 'i1',
    externalId: '12',
    brand: 'Ubiquiti',
    model: 'AF 5XHD',
    isCountryLock: true,
    status: 'active',
    aliases: ['AirFiber 5XHD'],
    imageCount: 2,
    updatedAt: '',
  },
  {
    id: 'i2',
    externalId: '',
    brand: 'Mikrotik',
    model: 'hAP ac2',
    isCountryLock: false,
    status: 'inactive',
    aliases: [],
    imageCount: 0,
    updatedAt: '',
  },
];

function renderTable(props: Partial<Parameters<typeof ItemsTable>[0]> = {}) {
  const handlers = { onOpen: vi.fn(), onEdit: vi.fn(), onToggleStatus: vi.fn() };
  render(
    <ItemsTable items={items} canEdit canManage pendingStatusId={null} {...handlers} {...props} />,
  );
  return handlers;
}

test('menampilkan merk, tipe, nama lain, country lock, jumlah gambar, dan status', () => {
  renderTable();
  expect(screen.getByText('AF 5XHD')).toBeInTheDocument();
  expect(screen.getByText('AirFiber 5XHD')).toBeInTheDocument();
  expect(screen.getByText('Country lock')).toBeInTheDocument();
  expect(screen.getByText('Aktif')).toBeInTheDocument();
  expect(screen.getByText('Nonaktif')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
});

test('tombol aksi mengikuti izin: view hanya Lihat; edit menambah Ubah; manage menambah Nonaktifkan/Aktifkan', () => {
  const { unmount } = render(
    <ItemsTable items={items} canEdit={false} canManage={false} pendingStatusId={null} onOpen={() => undefined} onEdit={() => undefined} onToggleStatus={() => undefined} />,
  );
  expect(screen.getAllByRole('button', { name: /^Lihat/ })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /^Ubah/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Nonaktifkan|Aktifkan/ })).not.toBeInTheDocument();
  unmount();
  renderTable({ canEdit: true, canManage: false });
  expect(screen.getAllByRole('button', { name: /^Ubah/ })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /Nonaktifkan|Aktifkan/ })).not.toBeInTheDocument();
});

test('memanggil handler untuk item yang dipilih', async () => {
  const { onOpen, onEdit, onToggleStatus } = renderTable();
  await userEvent.click(screen.getByRole('button', { name: 'Lihat Ubiquiti AF 5XHD' }));
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Mikrotik hAP ac2' }));
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan Ubiquiti AF 5XHD' }));
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan Mikrotik hAP ac2' }));
  expect(onOpen).toHaveBeenCalledWith(items[0]);
  expect(onEdit).toHaveBeenCalledWith(items[1]);
  expect(onToggleStatus).toHaveBeenNthCalledWith(1, items[0]);
  expect(onToggleStatus).toHaveBeenNthCalledWith(2, items[1]);
});

test('daftar kosong menampilkan pesan', () => {
  renderTable({ items: [] });
  expect(screen.getByText('Tidak ada item yang cocok.')).toBeInTheDocument();
});
```

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `bun run --cwd web test modules/item`
Expected: FAIL — modul belum ada.

- [ ] **Step 4: Skema form** — `web/src/modules/item/schemas.ts`

```ts
import { MARKDOWN_MAX_LENGTH } from '@shared/files';
import { ITEM_LIMITS, normalizeKey } from '@shared/items';
import type { ItemDto, SaveItemInput } from '@shared/rpc';
import { z } from 'zod';

/** Field yang dapat memuat pesan galat dari server (konflik, validasi). */
export const ITEM_FIELD_KEYS = [
  'brand',
  'model',
  'aliases',
  'stickers',
  'accessories',
  'attachments',
  'detail',
] as const;
export type ItemFieldErrors = Partial<Record<(typeof ITEM_FIELD_KEYS)[number], string>>;

/** Nama lain dari teks area: satu per baris; kosong dan kembar (ternormalisasi) dibuang. */
export function parseAliasLines(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of text.split('\n')) {
    const alias = line.trim();
    const key = normalizeKey(alias);
    if (alias === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(alias);
  }
  return result;
}

const stickerRowSchema = z.object({
  name: z.string(),
  note: z.string(),
  fileId: z.string().nullable(),
});

const accessoryRowSchema = z.object({
  name: z.string(),
  qty: z.number(),
});

export const itemFormSchema = z.object({
  brand: z.string().trim().min(1, 'Wajib diisi').max(ITEM_LIMITS.brand, `Maksimal ${ITEM_LIMITS.brand} karakter`),
  model: z.string().trim().min(1, 'Wajib diisi').max(ITEM_LIMITS.model, `Maksimal ${ITEM_LIMITS.model} karakter`),
  isCountryLock: z.boolean(),
  aliasesText: z.string().superRefine((text, ctx) => {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    if (lines.some((line) => line.length > ITEM_LIMITS.alias)) {
      ctx.addIssue({ code: 'custom', message: `Maksimal ${ITEM_LIMITS.alias} karakter per nama lain` });
    } else if (lines.some((line) => normalizeKey(line) === '')) {
      ctx.addIssue({ code: 'custom', message: 'Nama lain harus memuat huruf atau angka' });
    } else if (parseAliasLines(text).length > ITEM_LIMITS.aliases) {
      ctx.addIssue({ code: 'custom', message: `Maksimal ${ITEM_LIMITS.aliases} nama lain` });
    }
  }),
  stickers: z.array(stickerRowSchema).superRefine((rows, ctx) => {
    if (rows.length > ITEM_LIMITS.stickers) {
      ctx.addIssue({ code: 'custom', message: `Maksimal ${ITEM_LIMITS.stickers} stiker` });
    }
    rows.forEach((row, index) => {
      const label = `Stiker ${index + 1}`;
      const name = row.name.trim();
      if (name === '') {
        ctx.addIssue({ code: 'custom', message: `${label}: nama wajib diisi` });
      } else if (name.length > ITEM_LIMITS.stickerName) {
        ctx.addIssue({ code: 'custom', message: `${label}: nama maksimal ${ITEM_LIMITS.stickerName} karakter` });
      }
      if (row.note.trim().length > ITEM_LIMITS.stickerNote) {
        ctx.addIssue({ code: 'custom', message: `${label}: catatan maksimal ${ITEM_LIMITS.stickerNote} karakter` });
      }
    });
  }),
  accessories: z.array(accessoryRowSchema).superRefine((rows, ctx) => {
    if (rows.length > ITEM_LIMITS.accessories) {
      ctx.addIssue({ code: 'custom', message: `Maksimal ${ITEM_LIMITS.accessories} kelengkapan` });
    }
    rows.forEach((row, index) => {
      const label = `Kelengkapan ${index + 1}`;
      const name = row.name.trim();
      if (name === '') {
        ctx.addIssue({ code: 'custom', message: `${label}: nama wajib diisi` });
      } else if (name.length > ITEM_LIMITS.accessoryName) {
        ctx.addIssue({ code: 'custom', message: `${label}: nama maksimal ${ITEM_LIMITS.accessoryName} karakter` });
      }
      if (!Number.isInteger(row.qty) || row.qty < 1 || row.qty > ITEM_LIMITS.accessoryQty) {
        ctx.addIssue({
          code: 'custom',
          message: `${label}: jumlah harus bilangan bulat 1–${ITEM_LIMITS.accessoryQty}`,
        });
      }
    });
  }),
  attachments: z.array(z.string()).max(ITEM_LIMITS.attachments, `Maksimal ${ITEM_LIMITS.attachments} gambar`),
  detail: z.string().max(MARKDOWN_MAX_LENGTH, `Maksimal ${MARKDOWN_MAX_LENGTH} karakter`),
});
export type ItemFormInput = z.input<typeof itemFormSchema>;
export type ItemFormOutput = z.output<typeof itemFormSchema>;

export function toItemFormDefaults(item?: ItemDto): ItemFormInput {
  return {
    brand: item?.brand ?? '',
    model: item?.model ?? '',
    isCountryLock: item?.isCountryLock ?? false,
    aliasesText: item ? item.aliases.join('\n') : '',
    stickers: item ? item.stickers.map((sticker) => ({ ...sticker })) : [],
    accessories: item ? item.accessories.map((accessory) => ({ ...accessory })) : [],
    attachments: item ? [...item.attachments] : [],
    detail: item?.detail ?? '',
  };
}

export function toSaveItemInput(values: ItemFormOutput, id?: string): SaveItemInput {
  const input: SaveItemInput = {
    brand: values.brand.trim(),
    model: values.model.trim(),
    isCountryLock: values.isCountryLock,
    aliases: parseAliasLines(values.aliasesText),
    stickers: values.stickers.map((sticker) => ({
      name: sticker.name.trim(),
      note: sticker.note.trim(),
      fileId: sticker.fileId,
    })),
    accessories: values.accessories.map((accessory) => ({
      name: accessory.name.trim(),
      qty: accessory.qty,
    })),
    attachments: [...values.attachments],
    detail: values.detail,
  };
  return id ? { id, ...input } : input;
}
```

- [ ] **Step 5: Query, pencarian, dan tabel**

`web/src/modules/item/queries.ts`:

```ts
import type { SaveItemInput, SetItemStatusInput } from '@shared/rpc';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/lib/rpc';
import { accessKeys } from '@/modules/access/queries';

export const itemKeys = {
  all: ['items'] as const,
  list: ['items', 'list'] as const,
  one: (id: string) => ['items', 'one', id] as const,
};

export function itemsQueryOptions() {
  return queryOptions({
    queryKey: itemKeys.list,
    queryFn: () => rpc('items.list', null),
  });
}

export function itemQueryOptions(id: string) {
  return queryOptions({
    queryKey: itemKeys.one(id),
    queryFn: () => rpc('items.get', { id }),
  });
}

/** Perubahan item memuat ulang daftar dan detail, dan memperbarui Log Audit. */
function useItemMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: itemKeys.all }),
        queryClient.invalidateQueries({ queryKey: accessKeys.audit }),
      ]);
    },
  });
}

export const useSaveItem = () =>
  useItemMutation((input: SaveItemInput) => rpc('items.save', input));
export const useSetItemStatus = () =>
  useItemMutation((input: SetItemStatusInput) => rpc('items.setStatus', input));
```

`web/src/modules/item/lib/filter-items.ts`:

```ts
import { normalizeKey } from '@shared/items';
import type { ItemSummaryDto } from '@shared/rpc';

export interface ItemFilter {
  q: string;
  status: 'all' | 'active' | 'inactive';
}

/**
 * Cocok bila semua kata kunci muncul di merk/tipe/nama lain (urutan bebas), atau seluruh kata kunci
 * tanpa spasi muncul di teks tanpa spasi ("es24" menemukan "ES 24"). Tidak peka huruf dan tanda baca.
 */
export function filterItems<T extends ItemSummaryDto>(items: readonly T[], filter: ItemFilter): T[] {
  const needle = normalizeKey(filter.q);
  const tokens = needle === '' ? [] : needle.split(' ');
  const compactNeedle = tokens.join('');
  return items.filter((item) => {
    if (filter.status !== 'all' && item.status !== filter.status) return false;
    if (tokens.length === 0) return true;
    const haystack = normalizeKey([item.brand, item.model, ...item.aliases].join(' '));
    const compact = haystack.split(' ').join('');
    return tokens.every((token) => haystack.includes(token)) || compact.includes(compactNeedle);
  });
}
```

`web/src/modules/item/components/items-table.tsx`:

```tsx
import type { ItemSummaryDto } from '@shared/rpc';
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

export interface ItemsTableProps {
  items: readonly ItemSummaryDto[];
  canEdit: boolean;
  canManage: boolean;
  pendingStatusId: string | null;
  onOpen: (item: ItemSummaryDto) => void;
  onEdit: (item: ItemSummaryDto) => void;
  onToggleStatus: (item: ItemSummaryDto) => void;
}

export function ItemsTable({
  items,
  canEdit,
  canManage,
  pendingStatusId,
  onOpen,
  onEdit,
  onToggleStatus,
}: ItemsTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Merk</TableHead>
            <TableHead>Tipe</TableHead>
            <TableHead>Country lock</TableHead>
            <TableHead className="text-right">Gambar</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                Tidak ada item yang cocok.
              </TableCell>
            </TableRow>
          ) : null}
          {items.map((item) => {
            const label = `${item.brand} ${item.model}`;
            return (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.brand}</TableCell>
                <TableCell>
                  <div>{item.model}</div>
                  {item.aliases.length > 0 ? (
                    <div className="text-xs text-muted-foreground">{item.aliases.join(', ')}</div>
                  ) : null}
                </TableCell>
                <TableCell>
                  {item.isCountryLock ? <Badge variant="outline">Country lock</Badge> : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{item.imageCount}</TableCell>
                <TableCell>
                  <Badge variant={item.status === 'active' ? 'default' : 'secondary'}>
                    {item.status === 'active' ? 'Aktif' : 'Nonaktif'}
                  </Badge>
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Lihat ${label}`}
                    onClick={() => onOpen(item)}
                  >
                    Lihat
                  </Button>
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Ubah ${label}`}
                      onClick={() => onEdit(item)}
                    >
                      Ubah
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`${item.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} ${label}`}
                      disabled={pendingStatusId === item.id}
                      onClick={() => onToggleStatus(item)}
                    >
                      {item.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 6: Jalankan tes**

Run: `bun run --cwd web test modules/item`
Expected: lulus (skema, pencarian, tabel). Bila `tabular-nums` atau komponen `Badge` varian berbeda dari yang ada, ikuti varian yang dipakai `users-table.tsx`.

- [ ] **Step 7: Halaman daftar, menu, dan tautan beranda**

`web/src/routes/_app/item/index.tsx`:

```tsx
import type { ItemSummaryDto } from '@shared/rpc';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { describeError } from '@/lib/rpc/describe-error';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { ItemsTable } from '@/modules/item/components/items-table';
import { filterItems } from '@/modules/item/lib/filter-items';
import { itemsQueryOptions, useSetItemStatus } from '@/modules/item/queries';

const itemsSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
  status: z.enum(['all', 'active', 'inactive']).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/item/')({
  validateSearch: (search: Record<string, unknown>) => itemsSearchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(itemsQueryOptions()),
  component: ItemsPage,
});

function ItemsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  const canEdit = can(me, 'item', 'edit');
  const canManage = can(me, 'item', 'manage');
  const { data: items } = useSuspenseQuery(itemsQueryOptions());
  const setStatus = useSetItemStatus();
  const [text, setText] = useUrlSyncedText(search.q ?? '', (value) =>
    void navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  );
  const visible = filterItems(items, { q: search.q ?? '', status: search.status ?? 'all' });

  function toggleStatus(item: ItemSummaryDto) {
    const status = item.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: item.id, status },
      {
        onSuccess: () => toast.success(status === 'active' ? 'Item diaktifkan' : 'Item dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Data Item</h1>
        {canEdit ? (
          <Button onClick={() => void navigate({ to: '/item/new' })}>Tambah item</Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Cari merk, tipe, atau nama lain"
          aria-label="Cari item"
          value={text}
          onChange={(event) => setText(event.target.value)}
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
      <ItemsTable
        items={visible}
        canEdit={canEdit}
        canManage={canManage}
        pendingStatusId={setStatus.isPending ? (setStatus.variables?.id ?? null) : null}
        onOpen={(item) => void navigate({ to: '/item/$itemId', params: { itemId: item.id } })}
        onEdit={(item) => void navigate({ to: '/item/$itemId/edit', params: { itemId: item.id } })}
        onToggleStatus={toggleStatus}
      />
    </div>
  );
}
```

`web/src/app/navigation.ts`: tambahkan impor `Package` dari `lucide-react` dan, di `NAV_GROUPS` antara grup `Umum` dan `Pengaturan Akses`:

```ts
  {
    label: 'Data',
    items: [
      {
        label: 'Data Item',
        to: '/item',
        icon: Package,
        permission: { module: 'item', level: 'view' },
      },
    ],
  },
```

`web/src/app/module-links.ts`: tambahkan `item: '/item',` di bawah `access: '/access/users',`.

> Rute `/item/new`, `/item/$itemId`, dan `/item/$itemId/edit` dibuat di Task 5 dan 6. Sampai itu selesai `tsc` akan mengeluh pada tautan rute-rute tersebut; itu diharapkan dan diperbaiki oleh `bun run --cwd web build` (regenerasi `routeTree.gen.ts`) setelah rutenya ada. Untuk Task 4 cukup buat berkas rute `index.tsx` dan jalankan Step 9 setelah Task 5; Step 8 memverifikasi tes saja.

- [ ] **Step 8: Data demo di mock dev** — `web/src/lib/rpc/mock-backend.ts`

Tambahkan impor:

```ts
import { insertFile_ } from '@gas/modules/files/repo';
import { insertItem_ } from '@gas/modules/item/repo';
import { item } from '@gas-test/item-fixtures';
```

Ubah pembuatan platform agar disimpan di variabel (`const platform = createMemoryPlatform({ properties: { ... } }); setPlatform_(platform);` — isi `properties` tetap sama), lalu sebelum `seedMockAudit();` tambahkan:

```ts
  seedMockItems(platform);
```

dan tambahkan fungsi berikut (di atas `seedMockAudit`), dengan tipe `ReturnType<typeof createMemoryPlatform>` untuk parameter:

```ts
/** Satu piksel merah; cukup untuk memperlihatkan galeri dan gambar di dalam Markdown pada `bun run dev`. */
const DEMO_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function seedMockItems(platform: ReturnType<typeof createMemoryPlatform>): void {
  const folder = platform.driveCreateFolder('QC App Files');
  platform.setProperty('DRIVE_FOLDER_ID', folder);
  const driveId = platform.driveCreateFile(folder, 'demo.png', 'image/png', DEMO_PNG);
  insertFile_({
    id: 'file-demo',
    driveId,
    mime: 'image/png',
    size: 68,
    width: 1,
    height: 1,
    ownerType: 'item',
    ownerId: 'item-af5xhd',
    createdAt: '2026-10-07T07:00:00.000Z',
    createdBy: MOCK_ADMIN_EMAIL,
  });
  insertItem_(
    item({
      id: 'item-af5xhd',
      brand: 'Ubiquiti',
      model: 'AF 5XHD',
      isCountryLock: true,
      aliases: ['AirFiber 5XHD', 'AF-5XHD'],
      stickers: [
        { name: 'Label SNI', note: 'Bagian belakang, sudut kanan bawah', fileId: 'file-demo' },
        { name: 'Label garansi', note: '', fileId: null },
      ],
      accessories: [
        { name: 'Adaptor PoE', qty: 1 },
        { name: 'Bracket', qty: 1 },
      ],
      attachments: ['file-demo'],
      detail:
        '## Spesifikasi\n- Frekuensi: 5 GHz\n- Throughput: hingga 1 Gbps\n\n![Contoh penempelan](qcfile:file-demo)\n\nPerhatikan **country lock** sebelum pengiriman.',
    }),
  );
  insertItem_(
    item({
      id: 'item-es24',
      brand: 'Ubiquiti',
      model: 'ES 24 250W',
      aliases: ['ES24 250W'],
      accessories: [{ name: 'Kabel daya', qty: 1 }],
      detail: 'Switch 24 port PoE.',
    }),
  );
  insertItem_(item({ id: 'item-hap', brand: 'Mikrotik', model: 'hAP ac2', status: 'inactive' }));
}
```

`web/src/lib/rpc/mock-backend.test.ts` — tambahkan:

```ts
test('item demo: daftar untuk pemegang item view, simpan butuh item edit, detail memuat Markdown dan gambar', async () => {
  const staff = tokenOf('qc.staff@qc.local'); // role-qc: item view
  const list = await call('items.list', null, staff);
  expect(list.data.map((i: { model: string }) => i.model)).toEqual(['hAP ac2', 'AF 5XHD', 'ES 24 250W']);
  expect(await call('items.save', { brand: 'X', model: 'Y', isCountryLock: false, aliases: [], stickers: [], accessories: [], attachments: [], detail: '' }, staff)).toMatchObject({
    ok: false,
    error: { code: 'FORBIDDEN' },
  });
  const detail = await call('items.get', { id: 'item-af5xhd' }, staff);
  expect(detail.data.detail).toContain('country lock');
  expect(detail.data.attachments).toEqual(['file-demo']);
  const file = await call('files.get', { id: 'file-demo' }, staff);
  expect(file.data.mime).toBe('image/png');
});

test('user tanpa izin item tidak dapat melihat daftar item', async () => {
  const result = await call('items.list', null, tokenOf('access.viewer@qc.local'));
  expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
});
```

- [ ] **Step 9: Jalankan tes web** (typecheck menunggu rute Task 5–6)

Run: `bun run --cwd web test`
Expected: semua tes lulus (termasuk `mock-backend.test.ts`: jumlah entri audit tidak berubah karena data demo item tidak lewat `saveItem_`).

- [ ] **Step 10: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false web
git add web
git commit -m "feat(web): fondasi Data Item — skema form, pencarian toleran, tabel, halaman daftar, data demo" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Form item — nama lain, stiker, kelengkapan, galeri, detail Markdown; halaman tambah dan ubah

**Files:**
- Create: `web/src/modules/files/upload-error.ts`, `web/src/modules/item/components/image-thumb.tsx`, `image-picker.tsx`, `image-gallery-field.tsx`, `image-gallery-field.test.tsx`, `sticker-list-field.tsx`, `sticker-list-field.test.tsx`, `accessory-list-field.tsx`, `accessory-list-field.test.tsx`, `item-form.tsx`, `item-form.test.tsx`; `web/src/routes/_app/item/new.tsx`, `web/src/routes/_app/item/$itemId/edit.tsx`
- Modify: `web/src/modules/markdown/markdown-editor.tsx` (memakai `uploadErrorMessage` bersama)

**Interfaces:**
- Consumes: Task 4 (`itemFormSchema`, `toItemFormDefaults`, `toSaveItemInput`, `ITEM_FIELD_KEYS`, `useSaveItem`, `itemQueryOptions`), Fase A (`useUploadImage`, `isAcceptedImage`, `useFileUrl`, `MarkdownEditor`), `pickFieldErrors` (modul `access`), `ITEM_LIMITS`.
- Produces:
  - `uploadErrorMessage(error): string` (`files/upload-error.ts`).
  - `ImageThumb({ id, alt, className })`, `ImagePicker({ value, onChange, label, disabled? })`, `ImageGalleryField({ value, onChange, max?, disabled? })`, `StickerListField({ value, onChange })`, `AccessoryListField({ value, onChange })`.
  - `ItemForm({ mode, defaultValues, submitError?, fieldErrors?, onSubmit, onCancel })`.
  - Rute `/item/new` dan `/item/$itemId/edit`.

- [ ] **Step 1: Pindahkan pesan galat unggah ke modul bersama**

`web/src/modules/files/upload-error.ts`:

```ts
import { describeError } from '@/lib/rpc/describe-error';
import { RpcError } from '@/lib/rpc/rpc-error';

/** Pesan galat unggah gambar yang ramah pengguna (galat server, galat kompresi, atau tak terduga). */
export function uploadErrorMessage(error: unknown): string {
  if (error instanceof RpcError) return describeError(error);
  if (error instanceof Error) return error.message;
  return 'Gagal mengunggah gambar';
}
```

Di `web/src/modules/markdown/markdown-editor.tsx`: hapus fungsi lokal `uploadErrorMessage` beserta impor `describeError` dan `RpcError` yang tidak lagi terpakai, lalu tambahkan `import { uploadErrorMessage } from '@/modules/files/upload-error';`. Jalankan `bun run --cwd web test markdown-editor` (harus tetap lulus).

- [ ] **Step 2: Tulis tes komponen yang gagal**

`web/src/modules/item/components/image-gallery-field.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/files/use-upload-image', () => ({ useUploadImage: () => uploadMock }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: (id: string) => ({ url: `data:image/png;base64,${id}`, isLoading: false, isError: false }),
}));

import { ImageGalleryField } from './image-gallery-field';

function Harness({ initial = [] as string[], max }: { initial?: string[]; max?: number }) {
  const [value, setValue] = useState(initial);
  return <ImageGalleryField value={value} onChange={setValue} max={max} />;
}

const input = () => screen.getByLabelText('Pilih gambar galeri') as HTMLInputElement;
const png = (name: string) => new File(['x'], name, { type: 'image/png' });
const shown = () => [...document.querySelectorAll('img')].map((img) => img.getAttribute('alt'));

beforeEach(() => {
  uploadMock.mockReset();
});

test('menambah gambar mengunggah lalu menampilkannya; penghitung mengikuti', async () => {
  uploadMock.mockResolvedValueOnce('a').mockResolvedValueOnce('b');
  render(<Harness />);
  fireEvent.change(input(), { target: { files: [png('1.png'), png('2.png')] } });
  await waitFor(() => expect(shown()).toEqual(['Gambar 1', 'Gambar 2']));
  expect(screen.getByText('2/10')).toBeInTheDocument();
});

test('menghapus dan menggeser gambar', async () => {
  render(<Harness initial={['a', 'b', 'c']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Geser gambar 1 ke kanan' }));
  expect(document.querySelectorAll('img')[0]?.getAttribute('src')).toBe('data:image/png;base64,b');
  fireEvent.click(screen.getByRole('button', { name: 'Hapus gambar 3' }));
  expect(shown()).toEqual(['Gambar 1', 'Gambar 2']);
  expect(screen.getByRole('button', { name: 'Geser gambar 1 ke kiri' })).toBeDisabled();
});

test('melebihi batas ditolak dengan pesan dan tidak mengunggah', async () => {
  render(<Harness initial={['a', 'b']} max={2} />);
  fireEvent.change(input(), { target: { files: [png('3.png')] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Maksimal 2 gambar');
  expect(uploadMock).not.toHaveBeenCalled();
});

test('berkas bukan gambar dan kegagalan unggah ditampilkan sebagai pesan', async () => {
  render(<Harness />);
  fireEvent.change(input(), { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Hanya gambar JPEG, PNG, atau WebP');
  uploadMock.mockRejectedValueOnce(new Error('Gambar masih terlalu besar setelah dikompres (maks. 1 MB)'));
  fireEvent.change(input(), { target: { files: [png('besar.png')] } });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('terlalu besar'));
  expect(document.querySelectorAll('img')).toHaveLength(0);
});
```

`web/src/modules/item/components/sticker-list-field.test.tsx`:

```tsx
import type { ItemStickerDto } from '@shared/rpc';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/files/use-upload-image', () => ({ useUploadImage: () => uploadMock }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: (id: string) => ({ url: `data:image/png;base64,${id}`, isLoading: false, isError: false }),
}));

import { StickerListField } from './sticker-list-field';

function Harness({ initial = [] as ItemStickerDto[], spy }: { initial?: ItemStickerDto[]; spy?: (v: ItemStickerDto[]) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <StickerListField
      value={value}
      onChange={(next) => {
        setValue(next);
        spy?.(next);
      }}
    />
  );
}

beforeEach(() => {
  uploadMock.mockReset();
});

test('menambah, mengisi, dan menghapus stiker', async () => {
  const spy = vi.fn();
  render(<Harness spy={spy} />);
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  await userEvent.type(screen.getByLabelText('Nama stiker 1'), 'Label SNI');
  await userEvent.type(screen.getByLabelText('Catatan stiker 1'), 'Belakang');
  expect(spy).toHaveBeenLastCalledWith([{ name: 'Label SNI', note: 'Belakang', fileId: null }]);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus stiker 1' }));
  expect(screen.queryByLabelText('Nama stiker 1')).not.toBeInTheDocument();
});

test('gambar contoh stiker: memilih mengunggah dan menampilkannya; dapat dihapus', async () => {
  uploadMock.mockResolvedValue('img1');
  const spy = vi.fn();
  render(<Harness initial={[{ name: 'Label', note: '', fileId: null }]} spy={spy} />);
  fireEvent.change(screen.getByLabelText('Gambar contoh stiker 1'), {
    target: { files: [new File(['x'], 'c.png', { type: 'image/png' })] },
  });
  await waitFor(() => expect(spy).toHaveBeenLastCalledWith([{ name: 'Label', note: '', fileId: 'img1' }]));
  expect(document.querySelector('img')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus gambar contoh stiker 1' }));
  expect(spy).toHaveBeenLastCalledWith([{ name: 'Label', note: '', fileId: null }]);
});

test('tombol tambah dinonaktifkan pada batas 30 stiker', () => {
  const thirty = Array.from({ length: 30 }, (_, i) => ({ name: `s${i}`, note: '', fileId: null }));
  render(<Harness initial={thirty} />);
  expect(screen.getByRole('button', { name: 'Tambah stiker' })).toBeDisabled();
});
```

`web/src/modules/item/components/accessory-list-field.test.tsx`:

```tsx
import type { ItemAccessoryDto } from '@shared/rpc';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { AccessoryListField } from './accessory-list-field';

function Harness({ initial = [] as ItemAccessoryDto[], spy }: { initial?: ItemAccessoryDto[]; spy?: (v: ItemAccessoryDto[]) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <AccessoryListField
      value={value}
      onChange={(next) => {
        setValue(next);
        spy?.(next);
      }}
    />
  );
}

test('menambah baris dengan jumlah awal 1, mengisi nama dan jumlah, lalu menghapus', async () => {
  const spy = vi.fn();
  render(<Harness spy={spy} />);
  await userEvent.click(screen.getByRole('button', { name: 'Tambah kelengkapan' }));
  expect(spy).toHaveBeenLastCalledWith([{ name: '', qty: 1 }]);
  await userEvent.type(screen.getByLabelText('Nama kelengkapan 1'), 'Kabel');
  await userEvent.clear(screen.getByLabelText('Jumlah kelengkapan 1'));
  await userEvent.type(screen.getByLabelText('Jumlah kelengkapan 1'), '3');
  expect(spy).toHaveBeenLastCalledWith([{ name: 'Kabel', qty: 3 }]);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus kelengkapan 1' }));
  expect(screen.queryByLabelText('Nama kelengkapan 1')).not.toBeInTheDocument();
});

test('jumlah dibulatkan ke bilangan bulat dan input kosong menjadi 0 (ditolak skema)', async () => {
  const spy = vi.fn();
  render(<Harness initial={[{ name: 'Kabel', qty: 2 }]} spy={spy} />);
  const qty = screen.getByLabelText('Jumlah kelengkapan 1');
  await userEvent.clear(qty);
  expect(spy).toHaveBeenLastCalledWith([{ name: 'Kabel', qty: 0 }]);
  fireEvent.change(qty, { target: { value: '2.7' } });
  expect(spy).toHaveBeenLastCalledWith([{ name: 'Kabel', qty: 2 }]);
});
```

`web/src/modules/item/components/item-form.test.tsx`:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/files/use-upload-image', () => ({ useUploadImage: () => uploadMock }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: 'data:image/png;base64,AAA', isLoading: false, isError: false }),
}));

import { toItemFormDefaults } from '../schemas';
import { ItemForm } from './item-form';

function renderForm(props: Partial<Parameters<typeof ItemForm>[0]> = {}) {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <ItemForm
      mode="create"
      defaultValues={toItemFormDefaults()}
      onSubmit={onSubmit}
      onCancel={() => undefined}
      {...props}
    />,
  );
  return { onSubmit };
}

beforeEach(() => {
  uploadMock.mockReset();
});

test('merk dan tipe wajib; tidak mengirim bila kosong', async () => {
  const { onSubmit } = renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findAllByText('Wajib diisi')).toHaveLength(2);
  expect(onSubmit).not.toHaveBeenCalled();
});

test('mengirim nilai lengkap: country lock, nama lain per baris, stiker, kelengkapan, detail', async () => {
  const { onSubmit } = renderForm();
  await userEvent.type(screen.getByLabelText('Merk'), 'Ubiquiti');
  await userEvent.type(screen.getByLabelText('Tipe'), 'ES 24 250W');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Country lock (wajib)' }));
  await userEvent.type(screen.getByLabelText('Nama lain'), 'ES24{enter}AirSwitch');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  await userEvent.type(screen.getByLabelText('Nama stiker 1'), 'Label SNI');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah kelengkapan' }));
  await userEvent.type(screen.getByLabelText('Nama kelengkapan 1'), 'Kabel daya');
  await userEvent.type(screen.getByRole('textbox', { name: 'Detail dan spesifikasi' }), '## Spesifikasi');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({
      brand: 'Ubiquiti',
      model: 'ES 24 250W',
      isCountryLock: true,
      aliasesText: 'ES24\nAirSwitch',
      stickers: [{ name: 'Label SNI', note: '', fileId: null }],
      accessories: [{ name: 'Kabel daya', qty: 1 }],
      attachments: [],
      detail: '## Spesifikasi',
    }),
  );
});

test('pesan galat stiker dan kelengkapan bernomor tampil di bagiannya', async () => {
  renderForm();
  await userEvent.type(screen.getByLabelText('Merk'), 'A');
  await userEvent.type(screen.getByLabelText('Tipe'), 'B');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  await userEvent.click(screen.getByRole('button', { name: 'Tambah kelengkapan' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Stiker 1: nama wajib diisi')).toBeInTheDocument();
  expect(screen.getByText('Kelengkapan 1: nama wajib diisi')).toBeInTheDocument();
});

test('galat per field dari server tampil di bawah field terkait dan galat umum sebagai alert', () => {
  renderForm({
    fieldErrors: { model: 'Merk dan tipe sudah dipakai item lain', aliases: 'Nama lain "ES24" sudah dipakai item X' },
    submitError: 'Terjadi kesalahan',
  });
  expect(screen.getByText('Merk dan tipe sudah dipakai item lain')).toBeInTheDocument();
  expect(screen.getByText('Nama lain "ES24" sudah dipakai item X')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Terjadi kesalahan');
});

test('mode ubah memuat nilai awal', () => {
  renderForm({
    mode: 'edit',
    defaultValues: {
      ...toItemFormDefaults(),
      brand: 'Ubiquiti',
      model: 'AF 5XHD',
      isCountryLock: true,
      aliasesText: 'AirFiber',
      attachments: ['a', 'b'],
      detail: '# isi',
    },
  });
  expect(screen.getByLabelText('Merk')).toHaveValue('Ubiquiti');
  expect(screen.getByRole('checkbox', { name: 'Country lock (wajib)' })).toBeChecked();
  expect(screen.getByLabelText('Nama lain')).toHaveValue('AirFiber');
  expect(screen.getByText('2/10')).toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: 'Gambar lampiran' })).getAllByRole('img')).toHaveLength(2);
});
```

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `bun run --cwd web test modules/item/components`
Expected: FAIL — komponen belum ada.

- [ ] **Step 4: Komponen gambar** 

`web/src/modules/item/components/image-thumb.tsx`:

```tsx
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFileUrl } from '@/modules/files/queries';

export interface ImageThumbProps {
  id: string;
  alt: string;
  className?: string;
}

/** Gambar dari berkas aplikasi (diambil lewat RPC, privat) dengan status memuat dan gagal. */
export function ImageThumb({ id, alt, className }: ImageThumbProps) {
  const { url, isLoading, isError } = useFileUrl(id);
  if (isLoading) {
    return (
      <div
        role="img"
        aria-label="Memuat gambar"
        className={cn('animate-pulse rounded-md bg-muted', className)}
      />
    );
  }
  if (isError || !url) {
    return (
      <div
        role="img"
        aria-label="Gambar tidak tersedia"
        className={cn(
          'flex items-center justify-center rounded-md border bg-muted text-muted-foreground',
          className,
        )}
      >
        <ImageOff aria-hidden="true" className="size-5" />
      </div>
    );
  }
  return <img src={url} alt={alt} className={cn('rounded-md border object-cover', className)} />;
}
```

`web/src/modules/item/components/image-picker.tsx`:

```tsx
import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { isAcceptedImage } from '@/modules/files/image';
import { uploadErrorMessage } from '@/modules/files/upload-error';
import { useUploadImage } from '@/modules/files/use-upload-image';
import { ImageThumb } from './image-thumb';

export interface ImagePickerProps {
  /** Id berkas terpilih, atau `null`. */
  value: string | null;
  onChange: (id: string | null) => void;
  /** Dipakai untuk nama aksesibel, mis. "stiker 1". */
  label: string;
  disabled?: boolean;
}

/** Satu gambar opsional (mis. contoh stiker): pilih berkas → kecilkan → unggah. */
export function ImagePicker({ value, onChange, label, disabled = false }: ImagePickerProps) {
  const uploadImage = useUploadImage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!isAcceptedImage(file)) {
      setError('Hanya gambar JPEG, PNG, atau WebP');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      onChange(await uploadImage(file));
    } catch (failure) {
      setError(uploadErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {value ? <ImageThumb id={value} alt={`Contoh ${label}`} className="size-12" /> : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus aria-hidden="true" />
        {busy ? 'Mengunggah…' : value ? 'Ganti gambar' : 'Pilih gambar'}
      </Button>
      {value ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Hapus gambar contoh ${label}`}
          disabled={disabled || busy}
          onClick={() => onChange(null)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={`Gambar contoh ${label}`}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void pick(file);
        }}
      />
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
```

`web/src/modules/item/components/image-gallery-field.tsx`:

```tsx
import { ITEM_LIMITS } from '@shared/items';
import { ChevronLeft, ChevronRight, ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { isAcceptedImage } from '@/modules/files/image';
import { uploadErrorMessage } from '@/modules/files/upload-error';
import { useUploadImage } from '@/modules/files/use-upload-image';
import { ImageThumb } from './image-thumb';

export interface ImageGalleryFieldProps {
  value: readonly string[];
  onChange: (ids: string[]) => void;
  max?: number;
  disabled?: boolean;
}

/** Galeri gambar lampiran: tambah (kecilkan + unggah), geser urutan, hapus. */
export function ImageGalleryField({
  value,
  onChange,
  max = ITEM_LIMITS.attachments,
  disabled = false,
}: ImageGalleryFieldProps) {
  const uploadImage = useUploadImage();
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function addFiles(files: File[]) {
    const images = files.filter(isAcceptedImage);
    if (images.length === 0) {
      setError('Hanya gambar JPEG, PNG, atau WebP');
      return;
    }
    setError(null);
    // Akumulasi lokal: render ulang induk belum tentu sudah terjadi di antara dua unggahan berturut-turut.
    let current: readonly string[] = valueRef.current;
    for (const file of images) {
      if (current.length >= max) {
        setError(`Maksimal ${max} gambar`);
        return;
      }
      setUploading((count) => count + 1);
      try {
        const id = await uploadImage(file);
        current = [...current, id];
        onChange([...current]);
      } catch (failure) {
        setError(uploadErrorMessage(failure));
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }

  function move(index: number, delta: -1 | 1) {
    const next = [...value];
    const target = index + delta;
    const moved = next[index];
    const other = next[target];
    if (moved === undefined || other === undefined) return;
    next[index] = other;
    next[target] = moved;
    onChange(next);
  }

  return (
    <div role="group" aria-label="Gambar lampiran" className="space-y-2">
      {value.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {value.map((id, index) => (
            <li key={id} className="space-y-1">
              <ImageThumb id={id} alt={`Gambar ${index + 1}`} className="aspect-square w-full" />
              <div className="flex items-center justify-between gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Geser gambar ${index + 1} ke kiri`}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Hapus gambar ${index + 1}`}
                  disabled={disabled}
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Geser gambar ${index + 1} ke kanan`}
                  disabled={disabled || index === value.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Belum ada gambar.</p>
      )}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || value.length >= max}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus aria-hidden="true" />
          Tambah gambar
        </Button>
        <span className="text-xs text-muted-foreground">
          {value.length}/{max}
        </span>
        <span aria-live="polite" className="text-xs text-muted-foreground">
          {uploading > 0 ? 'Mengunggah gambar…' : ''}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        aria-label="Pilih gambar galeri"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length > 0) void addFiles(files);
        }}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Daftar stiker dan kelengkapan**

`web/src/modules/item/components/sticker-list-field.tsx`:

```tsx
import { ITEM_LIMITS } from '@shared/items';
import type { ItemStickerDto } from '@shared/rpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ImagePicker } from './image-picker';

export interface StickerListFieldProps {
  value: readonly ItemStickerDto[];
  onChange: (rows: ItemStickerDto[]) => void;
}

/** Stiker yang perlu ditempel: nama, catatan posisi/ketentuan, dan gambar contoh opsional. */
export function StickerListField({ value, onChange }: StickerListFieldProps) {
  const update = (index: number, patch: Partial<ItemStickerDto>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada stiker.</p>
      ) : null}
      {value.map((row, index) => (
        <fieldset
          // biome-ignore lint/suspicious/noArrayIndexKey: baris stiker tidak punya id stabil
          key={index}
          aria-label={`Stiker ${index + 1}`}
          className="space-y-2 rounded-lg border p-3"
        >
          <div className="flex items-center gap-2">
            <Input
              aria-label={`Nama stiker ${index + 1}`}
              placeholder="Nama stiker"
              value={row.name}
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Hapus stiker ${index + 1}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              Hapus
            </Button>
          </div>
          <Input
            aria-label={`Catatan stiker ${index + 1}`}
            placeholder="Posisi atau ketentuan penempelan"
            value={row.note}
            onChange={(event) => update(index, { note: event.target.value })}
          />
          <ImagePicker
            label={`stiker ${index + 1}`}
            value={row.fileId}
            onChange={(fileId) => update(index, { fileId })}
          />
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={value.length >= ITEM_LIMITS.stickers}
        onClick={() => onChange([...value, { name: '', note: '', fileId: null }])}
      >
        Tambah stiker
      </Button>
    </div>
  );
}
```

`web/src/modules/item/components/accessory-list-field.tsx`:

```tsx
import { ITEM_LIMITS } from '@shared/items';
import type { ItemAccessoryDto } from '@shared/rpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface AccessoryListFieldProps {
  value: readonly ItemAccessoryDto[];
  onChange: (rows: ItemAccessoryDto[]) => void;
}

/** Jumlah dari teks input: bilangan bulat tak negatif; kosong atau tidak valid menjadi 0 (ditolak skema). */
function toQty(text: string): number {
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

/** Kelengkapan aksesoris: nama dan jumlah per unit. */
export function AccessoryListField({ value, onChange }: AccessoryListFieldProps) {
  const update = (index: number, patch: Partial<ItemAccessoryDto>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada kelengkapan.</p>
      ) : null}
      {value.map((row, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: baris kelengkapan tidak punya id stabil
          key={index}
          className="flex items-center gap-2"
        >
          <Input
            aria-label={`Nama kelengkapan ${index + 1}`}
            placeholder="Nama kelengkapan"
            value={row.name}
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <Input
            type="number"
            min={1}
            max={ITEM_LIMITS.accessoryQty}
            className="w-24"
            aria-label={`Jumlah kelengkapan ${index + 1}`}
            value={row.qty === 0 ? '' : row.qty}
            onChange={(event) => update(index, { qty: toQty(event.target.value) })}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Hapus kelengkapan ${index + 1}`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            Hapus
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={value.length >= ITEM_LIMITS.accessories}
        onClick={() => onChange([...value, { name: '', qty: 1 }])}
      >
        Tambah kelengkapan
      </Button>
    </div>
  );
}
```

- [ ] **Step 6: Form item** — `web/src/modules/item/components/item-form.tsx`

```tsx
import { useForm } from '@tanstack/react-form';
import type { ReactNode } from 'react';
import { FieldError } from '@/components/field-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownEditor } from '@/modules/markdown/markdown-editor';
import type { ItemFieldErrors, ItemFormInput, ItemFormOutput } from '../schemas';
import { itemFormSchema } from '../schemas';
import { AccessoryListField } from './accessory-list-field';
import { ImageGalleryField } from './image-gallery-field';
import { StickerListField } from './sticker-list-field';

export interface ItemFormProps {
  mode: 'create' | 'edit';
  defaultValues: ItemFormInput;
  submitError?: string | null;
  /** Galat per field dari server (mis. merk+tipe sudah dipakai). */
  fieldErrors?: ItemFieldErrors;
  onSubmit: (values: ItemFormOutput) => Promise<unknown>;
  onCancel: () => void;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function ItemForm({
  mode,
  defaultValues,
  submitError,
  fieldErrors,
  onSubmit,
  onCancel,
}: ItemFormProps) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: itemFormSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(itemFormSchema.parse(value));
    },
  });

  return (
    <form
      noValidate
      className="space-y-4"
      data-mode={mode}
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <Section title="Informasi dasar">
        <form.Field name="brand">
          {(field) => (
            <div className="space-y-1.5">
              <Label htmlFor="item-brand">Merk</Label>
              <Input
                id="item-brand"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.brand]} />
            </div>
          )}
        </form.Field>
        <form.Field name="model">
          {(field) => (
            <div className="space-y-1.5">
              <Label htmlFor="item-model">Tipe</Label>
              <Input
                id="item-model"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.model]} />
            </div>
          )}
        </form.Field>
        <form.Field name="isCountryLock">
          {(field) => (
            <div className="flex items-center gap-2">
              <Checkbox
                id="item-country-lock"
                checked={field.state.value}
                onCheckedChange={(next) => field.handleChange(next === true)}
              />
              <Label htmlFor="item-country-lock" className="font-normal">
                Country lock (wajib)
              </Label>
            </div>
          )}
        </form.Field>
        <form.Field name="aliasesText">
          {(field) => (
            <div className="space-y-1.5">
              <Label htmlFor="item-aliases">Nama lain</Label>
              <Textarea
                id="item-aliases"
                rows={3}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Satu per baris. Dipakai untuk pencarian dan saran saat mengetik tipe.
              </p>
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.aliases]} />
            </div>
          )}
        </form.Field>
      </Section>

      <Section title="Gambar lampiran" hint="Maksimal 10 gambar; urutan pertama menjadi gambar utama.">
        <form.Field name="attachments">
          {(field) => (
            <div className="space-y-1.5">
              <ImageGalleryField value={field.state.value} onChange={field.handleChange} />
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.attachments]} />
            </div>
          )}
        </form.Field>
      </Section>

      <Section title="Stiker yang perlu ditempel" hint="QC memakai daftar ini sebagai acuan.">
        <form.Field name="stickers">
          {(field) => (
            <div className="space-y-1.5">
              <StickerListField value={field.state.value} onChange={field.handleChange} />
              <FieldError stacked errors={[...field.state.meta.errors, fieldErrors?.stickers]} />
            </div>
          )}
        </form.Field>
      </Section>

      <Section title="Kelengkapan aksesoris" hint="Jumlah per unit.">
        <form.Field name="accessories">
          {(field) => (
            <div className="space-y-1.5">
              <AccessoryListField value={field.state.value} onChange={field.handleChange} />
              <FieldError stacked errors={[...field.state.meta.errors, fieldErrors?.accessories]} />
            </div>
          )}
        </form.Field>
      </Section>

      <Section title="Detail dan spesifikasi">
        <form.Field name="detail">
          {(field) => (
            <div className="space-y-1.5">
              <span id="item-detail-label" className="sr-only">
                Detail dan spesifikasi
              </span>
              <MarkdownEditor
                id="item-detail"
                labelledBy="item-detail-label"
                value={field.state.value}
                onChange={field.handleChange}
              />
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.detail]} />
            </div>
          )}
        </form.Field>
      </Section>

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

Catatan: `aria-labelledby` pada `Textarea` menunjuk elemen `sr-only` bernama "Detail dan spesifikasi", sehingga `getByRole('textbox', { name: 'Detail dan spesifikasi' })` pada tes menemukannya. Heading `Section` dengan judul yang sama tidak berbentrok karena bukan `textbox`.

- [ ] **Step 7: Halaman tambah dan ubah**

`web/src/routes/_app/item/new.tsx`:

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/rpc/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { requirePermission } from '@/modules/auth/permissions';
import { ItemForm } from '@/modules/item/components/item-form';
import { useSaveItem } from '@/modules/item/queries';
import type { ItemFieldErrors, ItemFormOutput } from '@/modules/item/schemas';
import { ITEM_FIELD_KEYS, toItemFormDefaults, toSaveItemInput } from '@/modules/item/schemas';

export const Route = createFileRoute('/_app/item/new')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'edit'),
  component: NewItemPage,
});

function NewItemPage() {
  const navigate = useNavigate();
  const saveItem = useSaveItem();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ItemFieldErrors>({});

  async function handleSubmit(values: ItemFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      const saved = await saveItem.mutateAsync(toSaveItemInput(values));
      toast.success('Item disimpan');
      await navigate({ to: '/item/$itemId', params: { itemId: saved.id } });
    } catch (error) {
      const picked = pickFieldErrors(error, ITEM_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Tambah item</h1>
      <ItemForm
        mode="create"
        defaultValues={toItemFormDefaults()}
        submitError={submitError}
        fieldErrors={fieldErrors}
        onSubmit={handleSubmit}
        onCancel={() => void navigate({ to: '/item' })}
      />
    </div>
  );
}
```

`web/src/routes/_app/item/$itemId/edit.tsx`:

```tsx
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/rpc/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { requirePermission } from '@/modules/auth/permissions';
import { ItemForm } from '@/modules/item/components/item-form';
import { itemQueryOptions, useSaveItem } from '@/modules/item/queries';
import type { ItemFieldErrors, ItemFormOutput } from '@/modules/item/schemas';
import { ITEM_FIELD_KEYS, toItemFormDefaults, toSaveItemInput } from '@/modules/item/schemas';

export const Route = createFileRoute('/_app/item/$itemId/edit')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'edit'),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(itemQueryOptions(params.itemId)),
  component: EditItemPage,
});

function EditItemPage() {
  const { itemId } = Route.useParams();
  const navigate = useNavigate();
  const { data: item } = useSuspenseQuery(itemQueryOptions(itemId));
  const saveItem = useSaveItem();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ItemFieldErrors>({});

  async function handleSubmit(values: ItemFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await saveItem.mutateAsync(toSaveItemInput(values, item.id));
      toast.success('Item disimpan');
      await navigate({ to: '/item/$itemId', params: { itemId: item.id } });
    } catch (error) {
      const picked = pickFieldErrors(error, ITEM_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">
        Ubah item: {item.brand} {item.model}
      </h1>
      <ItemForm
        key={item.updatedAt}
        mode="edit"
        defaultValues={toItemFormDefaults(item)}
        submitError={submitError}
        fieldErrors={fieldErrors}
        onSubmit={handleSubmit}
        onCancel={() => void navigate({ to: '/item/$itemId', params: { itemId: item.id } })}
      />
    </div>
  );
}
```

Rute detail (`$itemId/index.tsx`) dibuat di Task 6; sampai itu ada, `navigate({ to: '/item/$itemId' })` belum bertipe benar. Buat rute detail minimal lebih dulu agar typecheck hijau: berkas `web/src/routes/_app/item/$itemId/index.tsx` berisi

```tsx
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/item/$itemId/')({
  component: () => null,
});
```

(Task 6 mengganti isinya.)

- [ ] **Step 8: Jalankan tes, regenerasi route tree, typecheck**

Run: `bun run --cwd web test && bun run --cwd web build && bun run --cwd web typecheck`
Expected: semua tes lulus; build memperbarui `web/src/routeTree.gen.ts` dengan rute `/item`, `/item/new`, `/item/$itemId/`, `/item/$itemId/edit`; typecheck bersih. Bila TanStack Router menulis ulang argumen `createFileRoute(...)` pada berkas rute, biarkan hasilnya.

- [ ] **Step 9: Verifikasi manual di mock dev**

Run `bun run dev`, login sebagai Super Admin → menu **Data Item**: tiga item demo tampil; cari "es24" → ES 24 250W; **Tambah item**: isi merk/tipe, centang country lock, tambah dua nama lain, satu stiker dan satu kelengkapan, ketik Markdown lalu tab **Pratinjau**, Simpan → pindah ke halaman detail (kosong sementara) tanpa galat; coba merk+tipe yang sama dengan item demo → pesan "Merk dan tipe sudah dipakai item lain" di bawah field Tipe. (Kompresi gambar via canvas hanya terlihat di peramban nyata; diverifikasi di E2E 27.)

- [ ] **Step 10: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false web
git add web
git commit -m "feat(web): form item lengkap (nama lain, stiker, kelengkapan, galeri, detail Markdown) dan halaman tambah/ubah" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Halaman detail item dan tampilan audit item

**Files:**
- Create: `web/src/modules/item/components/item-detail-view.tsx`, `item-detail-view.test.tsx`; `web/src/modules/access/lib/audit-actions.test.ts`
- Modify: `web/src/routes/_app/item/$itemId/index.tsx` (mengganti placeholder Task 5), `web/src/modules/access/lib/audit-actions.ts`, `web/src/modules/access/components/audit-diff-view.tsx`, `web/src/modules/access/components/audit-diff-view.test.tsx`

**Interfaces:**
- Consumes: `ItemDto` (Task 1), `ImageThumb` (Task 5), `MarkdownView` (Fase A), `itemQueryOptions`, `useSetItemStatus` (Task 4), snapshot audit item (Task 3).
- Produces: `ItemDetailView({ item, canEdit, canManage, statusPending, onBack, onEdit, onToggleStatus })`; label aksi `item.*`; `AuditDiffView` mengenali field item.

- [ ] **Step 1: Tulis tes yang gagal**

`web/src/modules/item/components/item-detail-view.test.tsx`:

```tsx
import type { ItemDto } from '@shared/rpc';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: (id: string) => ({ url: `data:image/png;base64,${id}`, isLoading: false, isError: false }),
}));

import { ItemDetailView } from './item-detail-view';

const item: ItemDto = {
  id: 'i1',
  externalId: '12',
  brand: 'Ubiquiti',
  model: 'AF 5XHD',
  isCountryLock: true,
  status: 'active',
  aliases: ['AirFiber 5XHD', 'AF-5XHD'],
  imageCount: 2,
  updatedAt: '2026-10-09T00:00:00.000Z',
  stickers: [
    { name: 'Label SNI', note: 'Belakang, kanan bawah', fileId: 'st1' },
    { name: 'Label garansi', note: '', fileId: null },
  ],
  accessories: [
    { name: 'Adaptor PoE', qty: 1 },
    { name: 'Bracket', qty: 2 },
  ],
  attachments: ['g1', 'g2'],
  detail: '## Spesifikasi\n- Frekuensi: 5 GHz\n\n![Contoh](qcfile:st1)',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedBy: 'admin@qc.local',
};

function renderView(over: Partial<Parameters<typeof ItemDetailView>[0]> = {}) {
  const handlers = { onBack: vi.fn(), onEdit: vi.fn(), onToggleStatus: vi.fn() };
  render(
    <ItemDetailView item={item} canEdit canManage statusPending={false} {...handlers} {...over} />,
  );
  return handlers;
}

test('menampilkan identitas, nama lain, galeri, stiker, kelengkapan, dan detail Markdown', () => {
  renderView();
  expect(screen.getByRole('heading', { level: 1, name: 'Ubiquiti AF 5XHD' })).toBeInTheDocument();
  expect(screen.getByText('Country lock')).toBeInTheDocument();
  expect(screen.getByText('ID MySQL: 12')).toBeInTheDocument();
  expect(screen.getByText('AirFiber 5XHD, AF-5XHD')).toBeInTheDocument();
  expect(screen.getByAltText('Gambar 1')).toBeInTheDocument();
  expect(screen.getByAltText('Gambar 2')).toBeInTheDocument();
  expect(screen.getByText('Label SNI')).toBeInTheDocument();
  expect(screen.getByText('Belakang, kanan bawah')).toBeInTheDocument();
  expect(screen.getByAltText('Contoh Label SNI')).toBeInTheDocument();
  expect(screen.getByText('Adaptor PoE ×1')).toBeInTheDocument();
  expect(screen.getByText('Bracket ×2')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Spesifikasi' })).toBeInTheDocument();
  expect(screen.getByText('Frekuensi: 5 GHz')).toBeInTheDocument();
});

test('bagian kosong menampilkan petunjuk, dan item nonaktif ditandai', () => {
  renderView({
    item: {
      ...item,
      externalId: '',
      aliases: [],
      attachments: [],
      stickers: [],
      accessories: [],
      detail: '',
      status: 'inactive',
      isCountryLock: false,
    },
  });
  expect(screen.getByText('Nonaktif')).toBeInTheDocument();
  expect(screen.queryByText('Country lock')).not.toBeInTheDocument();
  expect(screen.queryByText(/ID MySQL/)).not.toBeInTheDocument();
  expect(screen.getByText('Belum ada gambar.')).toBeInTheDocument();
  expect(screen.getByText('Belum ada stiker.')).toBeInTheDocument();
  expect(screen.getByText('Belum ada kelengkapan.')).toBeInTheDocument();
  expect(screen.getByText('Belum ada detail.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Aktifkan' })).toBeInTheDocument();
});

test('tombol aksi mengikuti izin dan memanggil handler', async () => {
  const { onBack, onEdit, onToggleStatus } = renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar' }));
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan' }));
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(onToggleStatus).toHaveBeenCalledTimes(1);
});

test('hanya view: tidak ada Ubah dan Nonaktifkan; edit saja: ada Ubah tanpa Nonaktifkan', () => {
  const { unmount } = render(
    <ItemDetailView item={item} canEdit={false} canManage={false} statusPending={false} onBack={() => undefined} onEdit={() => undefined} onToggleStatus={() => undefined} />,
  );
  expect(screen.queryByRole('button', { name: 'Ubah' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nonaktifkan' })).not.toBeInTheDocument();
  unmount();
  renderView({ canManage: false });
  expect(screen.getByRole('button', { name: 'Ubah' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nonaktifkan' })).not.toBeInTheDocument();
});

test('tombol status dinonaktifkan selama permintaan berjalan', () => {
  renderView({ statusPending: true });
  expect(screen.getByRole('button', { name: 'Nonaktifkan' })).toBeDisabled();
});
```

`web/src/modules/access/lib/audit-actions.test.ts`:

```ts
import { expect, test } from 'vitest';
import { auditActionLabel } from './audit-actions';

test('label aksi item dalam bahasa Indonesia', () => {
  expect(auditActionLabel('item.create')).toBe('Item dibuat');
  expect(auditActionLabel('item.update')).toBe('Item diubah');
  expect(auditActionLabel('item.activate')).toBe('Item diaktifkan');
  expect(auditActionLabel('item.deactivate')).toBe('Item dinonaktifkan');
});
```

Tambahkan ke `web/src/modules/access/components/audit-diff-view.test.tsx`:

```tsx
const itemBefore = {
  brand: 'Ubiquiti',
  model: 'ES 24',
  isCountryLock: false,
  status: 'active',
  aliases: ['ES24'],
  stickers: ['Label — Belakang'],
  accessories: ['Kabel ×1'],
  attachments: ['f1'],
  detailLength: 10,
  detailHash: 'aaaaaaaa',
};
const itemAfter = {
  ...itemBefore,
  isCountryLock: true,
  aliases: ['ES24', 'AirSwitch'],
  stickers: ['Label — Belakang', 'Garansi'],
  accessories: ['Kabel ×2'],
  attachments: ['f1', 'f2'],
  detailLength: 25,
  detailHash: 'bbbbbbbb',
};

test('snapshot item: label Indonesia, boolean Ya/Tidak, daftar per entri, dan hash detail tidak ditampilkan', () => {
  render(<AuditDiffView before={itemBefore} after={itemAfter} />);
  expect(within(row('isCountryLock')).getByText('Country lock')).toBeInTheDocument();
  expect(within(row('isCountryLock')).getByText('Tidak')).toBeInTheDocument();
  expect(within(row('isCountryLock')).getByText('Ya')).toBeInTheDocument();
  expect(within(row('aliases')).getByText('Nama lain')).toBeInTheDocument();
  expect(within(row('aliases')).getByText('AirSwitch').closest('li')).toHaveAttribute('data-kind', 'added');
  expect(within(row('stickers')).getByText('Garansi').closest('li')).toHaveAttribute('data-kind', 'added');
  expect(within(row('accessories')).getByText('Kabel ×2').closest('li')).toHaveAttribute('data-kind', 'added');
  expect(within(row('accessories')).getByText('Kabel ×1').closest('li')).toHaveAttribute('data-kind', 'removed');
  expect(within(row('attachments')).getByText('Gambar …f2')).toBeInTheDocument();
  expect(within(row('detailLength')).getByText('Panjang detail (karakter)')).toBeInTheDocument();
  expect(within(row('detailHash')).getByText('Isi detail')).toBeInTheDocument();
  expect(within(row('detailHash')).getByText('Isi Markdown diubah')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('aaaaaaaa');
  expect(document.body.textContent).not.toContain('bbbbbbbb');
});

test('hash detail disembunyikan bila tidak berubah atau pada create', () => {
  const { unmount } = render(<AuditDiffView before={itemBefore} after={{ ...itemBefore, model: 'ES 24 Lite' }} />);
  expect(document.querySelector('[data-field="detailHash"]')).toBeNull();
  unmount();
  render(<AuditDiffView before={null} after={itemBefore} />);
  expect(document.querySelector('[data-field="detailHash"]')).toBeNull();
  expect(within(row('brand')).getByText('Merk')).toBeInTheDocument();
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd web test item-detail-view audit-actions audit-diff-view`
Expected: FAIL — `./item-detail-view` belum ada; label dan field item belum dikenali.

- [ ] **Step 3: Tampilan detail** — `web/src/modules/item/components/item-detail-view.tsx`

```tsx
import type { ItemDto } from '@shared/rpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/modules/markdown/markdown-view';
import { ImageThumb } from './image-thumb';

export interface ItemDetailViewProps {
  item: ItemDto;
  canEdit: boolean;
  canManage: boolean;
  statusPending: boolean;
  onBack: () => void;
  onEdit: () => void;
  onToggleStatus: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Halaman baca-saja item; QC memakainya sebagai acuan kerja (stiker, kelengkapan, spesifikasi). */
export function ItemDetailView({
  item,
  canEdit,
  canManage,
  statusPending,
  onBack,
  onEdit,
  onToggleStatus,
}: ItemDetailViewProps) {
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">
            {item.brand} {item.model}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {item.isCountryLock ? <Badge variant="outline">Country lock</Badge> : null}
            {item.status === 'inactive' ? <Badge variant="secondary">Nonaktif</Badge> : null}
            {item.externalId ? (
              <span className="text-xs text-muted-foreground">ID MySQL: {item.externalId}</span>
            ) : null}
          </div>
          {item.aliases.length > 0 ? (
            <p className="text-sm text-muted-foreground">{item.aliases.join(', ')}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onBack}>
            Kembali ke daftar
          </Button>
          {canEdit ? <Button onClick={onEdit}>Ubah</Button> : null}
          {canManage ? (
            <Button variant="ghost" disabled={statusPending} onClick={onToggleStatus}>
              {item.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
            </Button>
          ) : null}
        </div>
      </div>

      <Section title="Gambar lampiran">
        {item.attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada gambar.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {item.attachments.map((id, index) => (
              <li key={id}>
                <ImageThumb id={id} alt={`Gambar ${index + 1}`} className="aspect-square w-full" />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Stiker yang perlu ditempel">
        {item.stickers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada stiker.</p>
        ) : (
          <ul className="space-y-3">
            {item.stickers.map((sticker, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: nama stiker boleh sama; urutan tetap
              <li key={index} className="flex items-start gap-3">
                {sticker.fileId ? (
                  <ImageThumb
                    id={sticker.fileId}
                    alt={`Contoh ${sticker.name}`}
                    className="size-16 shrink-0"
                  />
                ) : null}
                <div>
                  <div className="font-medium">{sticker.name}</div>
                  {sticker.note ? (
                    <div className="text-sm text-muted-foreground">{sticker.note}</div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Kelengkapan aksesoris">
        {item.accessories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada kelengkapan.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {item.accessories.map((accessory, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: nama kelengkapan boleh sama; urutan tetap
              <li key={index}>{`${accessory.name} ×${accessory.qty}`}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Detail dan spesifikasi">
        {item.detail.trim() === '' ? (
          <p className="text-sm text-muted-foreground">Belum ada detail.</p>
        ) : (
          <MarkdownView source={item.detail} />
        )}
      </Section>
    </div>
  );
}
```

Ganti `React.ReactNode` pada `Section` dengan `ReactNode` dan tambahkan `import type { ReactNode } from 'react';` (aturan yang sama dengan Task 5).

- [ ] **Step 4: Halaman detail** — `web/src/routes/_app/item/$itemId/index.tsx` (ganti isi placeholder)

```tsx
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { describeError } from '@/lib/rpc/describe-error';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { ItemDetailView } from '@/modules/item/components/item-detail-view';
import { itemQueryOptions, useSetItemStatus } from '@/modules/item/queries';

export const Route = createFileRoute('/_app/item/$itemId/')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view'),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(itemQueryOptions(params.itemId)),
  component: ItemDetailPage,
});

function ItemDetailPage() {
  const { itemId } = Route.useParams();
  const navigate = useNavigate();
  const me = useMe();
  const { data: item } = useSuspenseQuery(itemQueryOptions(itemId));
  const setStatus = useSetItemStatus();

  function toggleStatus() {
    const status = item.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: item.id, status },
      {
        onSuccess: () => toast.success(status === 'active' ? 'Item diaktifkan' : 'Item dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  return (
    <ItemDetailView
      item={item}
      canEdit={can(me, 'item', 'edit')}
      canManage={can(me, 'item', 'manage')}
      statusPending={setStatus.isPending}
      onBack={() => void navigate({ to: '/item' })}
      onEdit={() => void navigate({ to: '/item/$itemId/edit', params: { itemId: item.id } })}
      onToggleStatus={toggleStatus}
    />
  );
}
```

- [ ] **Step 5: Label aksi dan diff audit**

`web/src/modules/access/lib/audit-actions.ts`: tambahkan ke `AUDIT_ACTION_LABELS`:

```ts
  'item.create': 'Item dibuat',
  'item.update': 'Item diubah',
  'item.activate': 'Item diaktifkan',
  'item.deactivate': 'Item dinonaktifkan',
```

`web/src/modules/access/components/audit-diff-view.tsx`, empat perubahan:

1. `FIELD_LABELS` — tambahkan:

```ts
  brand: 'Merk',
  model: 'Tipe',
  isCountryLock: 'Country lock',
  aliases: 'Nama lain',
  stickers: 'Stiker',
  accessories: 'Kelengkapan',
  attachments: 'Gambar lampiran',
  detailLength: 'Panjang detail (karakter)',
  detailHash: 'Isi detail',
```

2. `formatScalar` — tepat sebelum `return String(value);` tambahkan `if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';`.

3. `ChildItem` — ganti perhitungan `label` menjadi:

```ts
  const label = isPermission
    ? (MODULE_LABELS[child.label as keyof typeof MODULE_LABELS] ?? child.label)
    : fieldKey === 'attachments'
      ? `Gambar …${child.label.slice(-6)}`
      : (roleNames.get(child.label) ?? child.label);
```

4. `FieldRow` — pada paragraf nilai skalar (`<p className="break-words text-sm">`), jadikan kondisi pertama: bila `field.key === 'detailHash'` tampilkan `<Ins>Isi Markdown diubah</Ins>`; kondisi `changed`/`removed`/`added` yang ada tetap sebagai cabang berikutnya:

```tsx
        <p className="break-words text-sm">
          {field.key === 'detailHash' ? (
            <Ins>Isi Markdown diubah</Ins>
          ) : field.kind === 'changed' ? (
            <>
              <Del>{formatScalar(field.key, field.before)}</Del> →{' '}
              <Ins>{formatScalar(field.key, field.after)}</Ins>
            </>
          ) : field.kind === 'removed' ? (
            <Del>{formatScalar(field.key, field.before)}</Del>
          ) : (
            <Ins>{formatScalar(field.key, field.after)}</Ins>
          )}
        </p>
```

5. `AuditDiffView` — ganti `const fields = diffSnapshots(before, after);` dengan:

```ts
  // Hash isi detail hanya berguna sebagai penanda "berubah"; selain itu disembunyikan.
  const fields = diffSnapshots(before, after).filter(
    (field) => field.key !== 'detailHash' || field.kind === 'changed',
  );
```

- [ ] **Step 6: Jalankan tes, regenerasi route tree, typecheck**

Run: `bun run --cwd web test && bun run --cwd web build && bun run --cwd web typecheck`
Expected: semua lulus; typecheck bersih.

- [ ] **Step 7: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false web
git add web
git commit -m "feat(web): halaman detail item dan diff audit item" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Dokumentasi, E2E, dan verifikasi akhir Fase B

**Files:**
- Modify: `docs/e2e-checklist.md`, `CLAUDE.md`, `docs/prd/2026-10-09-qc-item-serah-terima.md`

**Interfaces:**
- Consumes: semua tugas sebelumnya.
- Produces: dokumentasi selaras dengan kode.

- [ ] **Step 1: `docs/e2e-checklist.md`** — tambahkan (lanjutan nomor terakhir, yaitu 28):

```markdown
| 29 | Buat item lengkap di Data Item: merk, tipe, country lock, dua nama lain, dua stiker (satu bergambar contoh), dua kelengkapan, tiga gambar galeri, detail Markdown dengan gambar disisipkan lewat tombol, tempel, dan seret | Tersimpan; halaman detail menampilkan semuanya; semua gambar tampil dan hanya terbuka bila login | FI2, FI5, FA5 |
| 30 | Unggah foto asli > 4 MB (mis. dari kamera) | Terunggah tanpa galat; ukuran tersimpan ≤ 1 MB dan sisi terpanjang ≤ 1600 px | FA2 |
| 31 | Buat item dengan tipe "es-24 250w" bila "ES 24 250W" (merk sama) sudah ada | Ditolak, pesan di bawah field Tipe | FI3 |
| 32 | Beri nama lain yang sama dengan nama lain item lain | Ditolak, pesan di bawah field Nama lain | FI3 |
| 33 | Login sebagai user `item: view`, buka Data Item | Daftar dan detail terlihat; tidak ada tombol Tambah, Ubah, Nonaktifkan | FI1, FI4 |
| 34 | Login sebagai user `item: edit`, ubah sebuah item | Berhasil; tidak ada tombol Nonaktifkan | FI4 |
| 35 | Login sebagai user `item: manage`, nonaktifkan lalu aktifkan item | Status berubah; item nonaktif tetap muncul dengan filter "Nonaktif" | FI4 |
| 36 | Buka Log Audit, detail `item.update` yang mengubah kelengkapan dan detail | Kelengkapan tampil per entri berwarna; "Isi Markdown diubah" tanpa hash; tidak ada isi Markdown penuh | FAU1, FAU2 |
| 37 | Cari "es24" di daftar item | Menemukan "ES 24 250W" | FI1 |
| 38 | Sisipkan `<script>alert(1)</script>` dan `[x](javascript:alert(1))` ke detail lalu simpan dan buka detail | Tampil sebagai teks/tautan mati; tidak ada dialog; tidak ada gambar eksternal termuat | FA6 |
```

- [ ] **Step 2: `CLAUDE.md`**

Di bagian "Struktur", setelah baris `web/src/modules/files/`, tambahkan:

```markdown
- `web/src/modules/item/` — Data Item (daftar, form, detail); detail Markdown dan gambar memakai `modules/markdown` dan `modules/files`. Backend: `gas/src/modules/item/`; fungsi murni (kunci pencarian, hash, rujukan berkas) di `shared/items.ts`.
```

- [ ] **Step 3: PRD** — `docs/prd/2026-10-09-qc-item-serah-terima.md`

Di bagian 9 "Definition of Done › Fase B", centang dua butir (CRUD item dan halaman daftar/detail/audit) setelah Step 4–5 lulus. Butir Fase A "Upload, ambil, dan tampil gambar" tetap belum dicentang sampai E2E 27–30 lulus di deployment.

- [ ] **Step 4: Verifikasi akhir otomatis**

Run: `bun run check` lalu `bun run build`
Expected: `check` hijau (scripts, shared, gas, web); `build` lolos `verify-dist` (penanda boot satu kali, scope Drive ada, **`index.html` ≤ 1,5 MB**). Catat ukuran `gas/dist/index.html`; bila melampaui batas, hentikan dan laporkan sebelum lanjut (editor Markdown kini ikut terbundel karena dipakai halaman item).

- [ ] **Step 5: Verifikasi manual di mock dev**

Run `bun run dev`, login sebagai Super Admin:
1. **Data Item** → tiga item demo; cari "es24"; filter "Nonaktif" menampilkan hAP ac2.
2. Buka **Ubiquiti AF 5XHD**: galeri, stiker (contoh bergambar), kelengkapan, dan Markdown (judul, daftar, gambar `qcfile:`) tampil; **Ubah** → ganti kelengkapan dan detail → Simpan → detail terbarui.
3. **Tambah item** dengan merk+tipe yang sama dengan item demo → pesan di bawah field Tipe; nama lain bentrok → pesan di bawah Nama lain.
4. Nonaktifkan lalu aktifkan sebuah item; buka **Log Audit**: aksi `item.*` dengan diff terbaca dan tanpa hash.
5. Login sebagai **QC Staff** (`item: view`): daftar dan detail terlihat, tanpa tombol Tambah/Ubah/Nonaktifkan; membuka `#/item/new` langsung → halaman 403.
6. Ukuran ponsel (375×812) pada form dan detail: tidak ada gulir horizontal halaman; reset ke desktop setelah selesai.

- [ ] **Step 6: Commit**

```bash
bunx biome check --write --linter-enabled=false web docs
git add docs CLAUDE.md
git commit -m "docs: E2E dan panduan Data Item (Fase B)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Penutup (setelah Task 7)

- Ikuti `superpowers:executing-plans`: review akhir seluruh branch oleh reviewer terpisah (model paling mampu) dengan paket `review-package`, perbaiki temuan Critical/Important dalam satu putaran dengan TDD, catat Minor.
- Push branch, buka PR ke `dev`, uji di `/dev` mengikuti E2E 27–38 (unggah gambar ke Drive nyata, kompresi di peramban nyata, dan XSS di sandbox HtmlService). Butir ini menyelesaikan DoD Fase A "Upload, ambil, dan tampil gambar".
- Fase B2 (sinkronisasi) membangun di atas kolom `external_id` dan `sync_rev` serta kontrak `docs/api/desktop-sync.md`; ia juga memperbaiki perilaku `setup` terhadap `DRIVE_FOLDER_ID` yang tidak dapat diakses (FS13).
