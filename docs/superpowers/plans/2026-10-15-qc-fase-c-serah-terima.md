# Fase C — Customer, Serah Terima WH→QC, dan Pengerjaan QC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gudang (WH) membuat task serah terima per lokasi berisi customer dan daftar `tipe × qty`; QC memperbarui qty selesai per tipe atau menandai selesai per tipe/task; semuanya dengan customer master (dibuat langsung saat mengetik), auto-suggest toleran typo, izin per lokasi, dan audit yang terbaca.

**Architecture:** Dua modul backend baru (`customer`, `handover`) di atas fondasi yang sudah ada: sheet `customers`, `handovers`, `handover_lines`; rute berlokasi (`scope: 'location'`, `anyOf` untuk WH atau QC); pola "buat inline di dalam lock" yang sama dengan merk (`resolveBrandByName_`). Logika pencocokan toleran dan penurunan status ada di `shared/` (murni) agar server dan klien memakai aturan yang sama. Frontend: halaman Customer (kelola), Serah Terima (daftar, form, detail dengan kontrol progres), memakai `LocationField`, lokasi aktif header, dan `modules/item` untuk acuan kerja QC.

**Tech Stack:** Bun 1.4 (workspaces `shared`, `gas`, `web`), TypeScript strict, GAS V8 (transpile per file), React 19 + TanStack Router/Query/Form, shadcn, zod, Vitest, `bun:test`, Biome.

**Spec:** `docs/prd/2026-10-09-qc-item-serah-terima.md` — bagian 4.4 (FC1–FC5), 4.5 (FH1–FH9), 4.6 (FQ1–FQ6), 4.7 (FAU1–FAU2), 6.2, 6.3, DoD "Fase C". Resep modul berlokasi: `docs/adding-a-module.md`.

## Global Constraints

- Semua balasan, teks UI, pesan galat, dan komentar berbahasa Indonesia; identifier tetap Inggris/aslinya.
- Aturan GAS (`CLAUDE.md`, ditegakkan `scripts/build-gas.ts`): fungsi top-level di `gas/src` WAJIB berakhiran `_` kecuali `doGet`/`doPost`/`api`/`setup`; nama top-level **unik** di seluruh `gas/src` + `shared/` (jangan memakai ulang `listItems_`, `toBrandDto_`, `brandSnapshot_`, dst.); dilarang `export default`, re-export, import alias/namespace/dynamic, `class`, `enum`, `Object.hasOwn`; API GAS hanya lewat `platform_()`; tulis sheet di dalam `platform_().withLock(...)` dan **tanpa `withLock` bersarang** (fungsi yang dipanggil di dalam lock tidak boleh mengunci); backslash "termakan" alat penyunting → hindari regex berbackslash, pakai pemindaian string atau `String.fromCharCode`.
- Fungsi murni di `shared/` boleh tanpa akhiran `_`.
- **Rute berlokasi** (`handovers.*`): `permission` wajib `scope: 'location'`; gunakan `ctx.locationIds`, **bukan** input mentah; tiap lokasi yang diminta harus aktif dan memenuhi minimal satu alternatif izin, satu gagal menolak seluruh permintaan (`FORBIDDEN`). Rute yang mengubah/membaca satu task menerima `locationId`/`locationIds` **dan** `id`; server memastikan lokasi baris task = lokasi yang diizinkan, bila tidak `NOT_FOUND` (izin ditegakkan lagi di lokasi baris, bukan hanya di lokasi yang diklaim klien).
- Izin: `customers.list` = `item: view`; `customers.rename`/`setStatus` = `item: manage` (global). `handovers.options`/`list`/`get` = salah satu dari `handover: view` **atau** `qc: edit` (lokasi). `handovers.save` = `handover: edit`; `handovers.cancel` = `handover: manage`; `handovers.setProgress`/`completeLine`/`completeAll` = `qc: edit` (lokasi).
- Batas: catatan ≤ 500, nama customer 1–100 (memuat huruf/angka), qty bilangan bulat 1–100.000, baris 1–100, tiap item sekali per task; qty selesai bilangan bulat 0 ≤ selesai ≤ target.
- Nomor task `ST-YYYYMMDD-NNN` (urut per hari, tanggal zona WIB, dibuat di dalam lock). Status tersimpan hanya `open`/`cancelled`; Baru/Dikerjakan/Selesai **diturunkan** dari baris.
- Task Selesai atau Dibatalkan tidak dapat diubah (QC maupun WH): `CONFLICT` dengan pesan jelas.
- Baris menyimpan salinan label "merk tipe" saat dibuat (FH9); customer disimpan sebagai id + salinan nama.
- Aksi audit: `customer.create/rename/activate/deactivate`, `handover.create/update/cancel`, `handover.progress`, `handover.complete`. Snapshot memuat daftar baris sebagai teks per entri (`"Merk Tipe × qty (selesai n)"`) agar diff audit per entri berfungsi.
- Auto-suggest berjalan **di klien** atas daftar yang dimuat (tanpa RPC per ketikan); daftar saran diambil lewat `handovers.options` (izin serah terima), bukan lewat rute halaman Item/Customer.
- `bun run check` hijau sebelum push. Format tanpa lint: `bunx biome check --write --linter-enabled=false <path>`.
- Commit diakhiri `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Jangan mengedit `gas/dist/` manual.
- Bun: `export PATH="$PATH:$HOME/.bun/bin"` di Git Bash. Pada tes Vitest, `beforeEach(() => { ... })` **berkurung kurawal**. Bila Biome mengeluh tentang `any` pada tes, letakkan `// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes` tepat di atasnya.
- Typecheck `gas` boleh merah di akhir Task 1 (kontrak `customers.*`/`handovers.*` belum punya rute) sampai Task 2–5 mendaftarkannya; typecheck `web` boleh merah di Task 6–8 sampai rute berkas dibuat dan `bun run --cwd web build` meregenerasi `routeTree.gen.ts`.
- Mesin pengembang dapat kehabisan memori sehingga tes jsdom (web) timeout: bila tes web gagal serentak karena timeout, tutup aplikasi lain dan ulangi dengan `bunx vitest run --maxWorkers=2` di folder `web`; jangan menganggapnya kegagalan kode.

## Review Focus

1. **Izin per lokasi:** lokasi tak dikenal/nonaktif/tanpa izin → `FORBIDDEN` untuk seluruh permintaan; task dari lokasi lain yang diminta lewat id → `NOT_FOUND` walau user punya izin di lokasi yang diklaim; WH (hanya `handover`) tidak bisa mengubah progres; QC (hanya `qc: edit`) bisa melihat dan mengubah progres tetapi tidak bisa menyimpan/membatalkan. → Task 3–5.
2. **Nomor task:** tidak ganda untuk beberapa task di hari yang sama, urutan reset di hari baru (zona WIB), tidak ganda setelah task dibatalkan. → Task 4.
3. **Customer inline:** ejaan berbeda huruf/tanda baca memakai customer yang ada (ejaan resmi menang); dua task dengan nama sama tidak membuat dua customer; customer nonaktif ditolak pada task baru dengan pesan di field; ganti nama tidak boleh bentrok. → Task 2, 4.
4. **Aturan ubah task (FH7):** qty target < qty selesai ditolak; baris ber-progres tidak dapat dihapus; task Selesai/Dibatalkan tidak dapat diubah; item nonaktif tidak boleh baris baru tetapi baris lama tetap; tiap item sekali. → Task 4.
5. **Batas progres (FQ1):** pecahan/negatif/NaN/string/di atas target ditolak; nilai sama tidak menulis audit; task Selesai/Dibatalkan menolak QC (FQ6); "selesai per task" hanya mengisi baris yang belum penuh. → Task 5.
6. **Status turunan:** Baru/Dikerjakan/Selesai konsisten antara server dan klien (fungsi murni yang sama); satu `handover.complete` per task tepat saat menjadi Selesai. → Task 1, 5.
7. **Saran toleran:** "galaxy samsung" menemukan "Samsung Galaxy"; typo ringan ("samsng"); "es24" menemukan "ES 24"; token pendek tidak menghasilkan saran sampah; tidak ada saran untuk ketikan kosong; item/customer nonaktif tidak disarankan. → Task 1, 7.
8. **Audit:** semua aksi FAU1 tercatat dengan snapshot yang terbaca; progres per baris memuat tipe, qty lama, dan qty baru. → Task 4–5, 8.
9. **Referensi item:** label baris tetap terbaca bila item diganti nama; tautan ke detail item hanya untuk user ber-`item: view`. → Task 3, 8.

---

## Struktur Berkas

| Berkas | Tanggung jawab |
|---|---|
| `shared/suggest.ts` (baru) | `editDistance`, `suggestMatches`, `similarNames` (murni) |
| `shared/handover.ts` (baru) | Batas, status turunan, ringkasan progres, nomor task |
| `shared/rpc.ts` | DTO dan kontrak `customers.*`, `handovers.*` |
| `gas/src/modules/customer/{repo,validate,service,routes}.ts` (baru) | Master customer, pembuatan inline, ganti nama, status |
| `gas/src/modules/handover/{repo,validate,service,routes}.ts` (baru) | Task, baris, nomor, baca, simpan, batalkan, progres |
| `gas/test-support/handover-fixtures.ts` (baru) | Fixture `customer()`, `handover()`, `handoverLine()` |
| `gas/src/setup.ts`, `gas/src/routes.ts` | Sheet baru dan pendaftaran rute |
| `web/src/modules/customer/` (baru) | Query, `CustomersManager`, rute `/customer` |
| `web/src/modules/handover/` (baru) | Query, skema, `CustomerCombobox`, `ItemLinesField`, form, tabel, detail |
| `web/src/routes/_app/customer.tsx`, `web/src/routes/_app/handover/*` (baru) | Rute |
| `web/src/app/navigation.ts`, `module-links.ts`, `modules/auth/permissions.ts` | Menu "Serah Terima" (izin salah satu dari), `requireAnyPermission` |
| `web/src/lib/rpc/mock-backend.ts` | Data demo customer dan task |
| `web/src/modules/access/lib/audit-actions.ts`, `components/audit-diff-view.tsx` | Label aksi dan field audit baru |
| `docs/…`, `CLAUDE.md` | E2E, DoD, panduan |

---

### Task 1: Fungsi murni (saran toleran, status task, nomor) dan kontrak RPC (`shared/`)

**Files:**
- Create: `shared/suggest.ts`, `shared/suggest.test.ts`, `shared/handover.ts`, `shared/handover.test.ts`
- Modify: `shared/rpc.ts`

**Interfaces:**
- Consumes: `normalizeKey` dari `./items`.
- Produces:
  - `shared/suggest.ts`: `editDistance(a, b, max): number`, `suggestMatches<T>(items, query, texts, limit?): T[]`, `similarNames(query, names, limit?): string[]`.
  - `shared/handover.ts`: `HANDOVER_LIMITS`, `type HandoverStatus`, `type HandoverStoredStatus`, `deriveHandoverStatus(stored, lines)`, `progressTotals(lines)`, `dateKeyOf(epochMs)`, `handoverNumber(dateKey, sequence)`, `nextHandoverSequence(numbers, dateKey)`.
  - `shared/rpc.ts`: `CustomerDto`, `RenameCustomerInput`, `SetCustomerStatusInput`, `HandoverOptionItemDto`, `HandoverOptionCustomerDto`, `HandoverOptionsDto`, `HandoverLineDto`, `HandoverSummaryDto`, `HandoverDto`, `ListHandoversInput`, `GetHandoverInput`, `SaveHandoverLineInput`, `SaveHandoverInput`, `HandoverRefInput`, `SetProgressInput`, `CompleteLineInput`; kontrak `customers.list|rename|setStatus` dan `handovers.options|list|get|save|cancel|setProgress|completeLine|completeAll`.

- [ ] **Step 1: Tulis tes yang gagal**

`shared/suggest.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { editDistance, similarNames, suggestMatches } from './suggest';

interface Row {
  brand: string;
  model: string;
  aliases: string[];
}
const rows: Row[] = [
  { brand: 'Samsung', model: 'Galaxy S24', aliases: ['S24 Ultra'] },
  { brand: 'Ubiquiti', model: 'ES 24 250W', aliases: ['ES24'] },
  { brand: 'Mikrotik', model: 'hAP ac2', aliases: [] },
  { brand: 'Ubiquiti', model: 'AF 5XHD', aliases: ['AirFiber 5XHD'] },
];
const texts = (row: Row) => [row.brand, row.model, ...row.aliases];
const find = (query: string, limit?: number) =>
  suggestMatches(rows, query, texts, limit).map((row) => `${row.brand} ${row.model}`);

test('editDistance: sama, satu sisip/hapus/ganti, dan berhenti di batas', () => {
  expect(editDistance('samsung', 'samsung', 2)).toBe(0);
  expect(editDistance('samsng', 'samsung', 2)).toBe(1);
  expect(editDistance('samsunk', 'samsung', 2)).toBe(1);
  expect(editDistance('abc', 'xyz', 1)).toBeGreaterThan(1);
  expect(editDistance('a', 'abcdef', 2)).toBeGreaterThan(2);
});

test('urutan kata bebas dan tidak peka huruf besar atau tanda baca', () => {
  expect(find('galaxy samsung')).toEqual(['Samsung Galaxy S24']);
  expect(find('SAMSUNG, galaxy!')).toEqual(['Samsung Galaxy S24']);
});

test('typo ringan ditoleransi; token pendek tidak menghasilkan saran sampah', () => {
  expect(find('samsng')).toEqual(['Samsung Galaxy S24']);
  expect(find('mikrotk hap')).toEqual(['Mikrotik hAP ac2']);
  expect(find('xq')).toEqual([]);
  expect(find('zzzzzz')).toEqual([]);
});

test('"es24" menemukan "ES 24" (kata tanpa spasi), alias ikut dicocokkan, awalan kata cocok', () => {
  expect(find('es24')).toEqual(['Ubiquiti ES 24 250W']);
  expect(find('airfiber')).toEqual(['Ubiquiti AF 5XHD']);
  expect(find('ubi')).toEqual(['Ubiquiti ES 24 250W', 'Ubiquiti AF 5XHD']);
});

test('ketikan kosong atau hanya tanda baca tidak menghasilkan saran; limit dihormati; cocok tepat lebih dulu', () => {
  expect(find('')).toEqual([]);
  expect(find('  -- ')).toEqual([]);
  expect(find('ubi', 1)).toHaveLength(1);
  const typo = suggestMatches(
    [{ n: 'Samsung' }, { n: 'Samsong Lama' }],
    'samsung',
    (row) => [row.n],
  ).map((row) => row.n);
  expect(typo[0]).toBe('Samsung');
});

test('similarNames: urutan kata berbeda atau typo = mirip; kunci sama persis dan nama jauh bukan', () => {
  const names = ['PT Maju Jaya', 'Budi Santoso', 'Totally Different'];
  expect(similarNames('Maju Jaya PT', names)).toEqual(['PT Maju Jaya']);
  expect(similarNames('PT Mju Jaya', names)).toEqual(['PT Maju Jaya']);
  expect(similarNames('PT. Maju Jaya', names)).toEqual([]); // kunci sama persis: bukan "mirip", itu orang yang sama
  expect(similarNames('Zzzz Qqqq', names)).toEqual([]);
  expect(similarNames('', names)).toEqual([]);
  expect(similarNames('Budi Santso', names, 1)).toEqual(['Budi Santoso']);
});
```

`shared/handover.test.ts`:

```ts
import { expect, test } from 'bun:test';
import {
  dateKeyOf,
  deriveHandoverStatus,
  HANDOVER_LIMITS,
  handoverNumber,
  nextHandoverSequence,
  progressTotals,
} from './handover';

test('status turunan: Baru, Dikerjakan, Selesai, Dibatalkan', () => {
  const line = (qty: number, doneQty: number) => ({ qty, doneQty });
  expect(deriveHandoverStatus('open', [line(5, 0), line(3, 0)])).toBe('new');
  expect(deriveHandoverStatus('open', [line(5, 1), line(3, 0)])).toBe('in_progress');
  expect(deriveHandoverStatus('open', [line(5, 5), line(3, 0)])).toBe('in_progress');
  expect(deriveHandoverStatus('open', [line(5, 5), line(3, 3)])).toBe('done');
  expect(deriveHandoverStatus('cancelled', [line(5, 5)])).toBe('cancelled');
  expect(deriveHandoverStatus('open', [])).toBe('new');
});

test('ringkasan progres menjumlah unit', () => {
  expect(progressTotals([{ qty: 5, doneQty: 2 }, { qty: 3, doneQty: 3 }])).toEqual({ done: 5, total: 8 });
  expect(progressTotals([])).toEqual({ done: 0, total: 0 });
});

test('dateKeyOf memakai zona WIB (UTC+7): lewat tengah malam WIB sudah hari berikutnya', () => {
  expect(dateKeyOf(Date.parse('2026-10-15T16:59:59.000Z'))).toBe('20261015');
  expect(dateKeyOf(Date.parse('2026-10-15T17:00:00.000Z'))).toBe('20261016');
  expect(dateKeyOf(Date.parse('2026-12-31T20:00:00.000Z'))).toBe('20270101');
});

test('nomor task ST-YYYYMMDD-NNN dan urutan berikutnya per hari', () => {
  expect(handoverNumber('20261015', 1)).toBe('ST-20261015-001');
  expect(handoverNumber('20261015', 42)).toBe('ST-20261015-042');
  expect(handoverNumber('20261015', 1234)).toBe('ST-20261015-1234');
  expect(nextHandoverSequence([], '20261015')).toBe(1);
  expect(nextHandoverSequence(['ST-20261015-001', 'ST-20261015-007', 'ST-20261014-099'], '20261015')).toBe(8);
  expect(nextHandoverSequence(['ST-20261014-099', 'rusak', 'ST-20261015-abc'], '20261015')).toBe(1);
});

test('batas task', () => {
  expect(HANDOVER_LIMITS).toMatchObject({ note: 500, customerName: 100, qtyMax: 100_000, lines: 100 });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd shared test suggest handover`
Expected: FAIL — `./suggest` dan `./handover` belum ada.

- [ ] **Step 3: Implementasi**

`shared/suggest.ts`:

```ts
import { normalizeKey } from './items';

/** Jarak Levenshtein; berhenti dini dan mengembalikan `max + 1` bila sudah pasti melebihi `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length] ?? max + 1;
}

const NO_MATCH = Number.POSITIVE_INFINITY;

/** Skor satu kata ketikan terhadap kata target: 0 tepat, 1 awalan, 2 typo ringan (kata >= 5 huruf); tidak cocok = tak hingga. */
function tokenScore(query: string, target: string): number {
  if (query === target) return 0;
  if (target.startsWith(query)) return 1;
  // Typo hanya ditoleransi untuk kata >= 5 huruf: kata pendek (mis. "es24" vs "s24") terlalu mudah salah cocok.
  if (query.length < 5) return NO_MATCH;
  const tolerance = query.length >= 7 ? 2 : 1;
  return editDistance(query, target, tolerance) <= tolerance ? 2 : NO_MATCH;
}

/**
 * Skor teks terhadap ketikan (lebih kecil lebih baik; `null` = tidak cocok). Semua kata ketikan harus cocok
 * dengan kata mana pun di teks (urutan bebas, typo ringan, awalan); bila tidak, ketikan tanpa spasi boleh
 * menjadi bagian dari teks tanpa spasi ("es24" ≈ "es 24").
 */
function textScore(queryTokens: readonly string[], text: string): number | null {
  const targetTokens = normalizeKey(text).split(' ').filter((token) => token !== '');
  let total = 0;
  let allMatched = true;
  for (const token of queryTokens) {
    let best = NO_MATCH;
    for (const target of targetTokens) best = Math.min(best, tokenScore(token, target));
    if (best === NO_MATCH) {
      allMatched = false;
      break;
    }
    total += best;
  }
  if (allMatched) return total;
  const compactQuery = queryTokens.join('');
  return compactQuery.length >= 3 && targetTokens.join('').includes(compactQuery) ? 3 : null;
}

/**
 * Saran dari daftar yang sudah dimuat (tanpa RPC per ketikan). `texts` memberi semua teks yang dicari
 * per baris (mis. merk, tipe, nama lain); semuanya digabung sehingga "galaxy samsung" menemukan
 * merk "Samsung" + tipe "Galaxy S24". Ketikan kosong tidak menghasilkan saran.
 */
export function suggestMatches<T>(
  items: readonly T[],
  query: string,
  texts: (item: T) => readonly string[],
  limit = 8,
): T[] {
  const queryTokens = normalizeKey(query).split(' ').filter((token) => token !== '');
  if (queryTokens.length === 0) return [];
  const scored: Array<{ item: T; score: number; index: number }> = [];
  items.forEach((item, index) => {
    const score = textScore(queryTokens, texts(item).join(' '));
    if (score !== null) scored.push({ item, score, index });
  });
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.slice(0, limit).map((entry) => entry.item);
}

function similarityThreshold(length: number): number {
  if (length <= 5) return 1;
  if (length <= 10) return 2;
  return 3;
}

/**
 * Nama yang MIRIP (bukan sama) dengan ketikan: kata sama dalam urutan berbeda, atau selisih ejaan kecil.
 * Nama dengan kunci ternormalisasi yang sama persis tidak dianggap mirip (itu orang yang sama).
 */
export function similarNames(query: string, names: readonly string[], limit = 3): string[] {
  const key = normalizeKey(query);
  if (key === '') return [];
  const sortedTokens = (text: string) => text.split(' ').sort().join(' ');
  const ranked: Array<{ name: string; distance: number }> = [];
  for (const name of names) {
    const other = normalizeKey(name);
    if (other === '' || other === key) continue;
    const reordered = sortedTokens(other) === sortedTokens(key);
    const threshold = similarityThreshold(Math.max(key.length, other.length));
    const distance = editDistance(key, other, threshold);
    if (reordered || distance <= threshold) {
      ranked.push({ name, distance: reordered ? 0 : distance });
    }
  }
  ranked.sort((a, b) => a.distance - b.distance);
  return ranked.slice(0, limit).map((entry) => entry.name);
}
```

`shared/handover.ts`:

```ts
/** Batas task serah terima (PRD FH2). */
export const HANDOVER_LIMITS = {
  note: 500,
  customerName: 100,
  qtyMax: 100_000,
  lines: 100,
} as const;

export type HandoverStoredStatus = 'open' | 'cancelled';
export type HandoverStatus = 'new' | 'in_progress' | 'done' | 'cancelled';

export interface ProgressLine {
  qty: number;
  doneQty: number;
}

/** Baru/Dikerjakan/Selesai diturunkan dari baris; Dibatalkan disimpan. Dipakai server dan klien. */
export function deriveHandoverStatus(
  stored: HandoverStoredStatus,
  lines: readonly ProgressLine[],
): HandoverStatus {
  if (stored === 'cancelled') return 'cancelled';
  if (lines.length > 0 && lines.every((line) => line.doneQty >= line.qty)) return 'done';
  if (lines.some((line) => line.doneQty > 0)) return 'in_progress';
  return 'new';
}

export function progressTotals(lines: readonly ProgressLine[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const line of lines) {
    done += Math.min(line.doneQty, line.qty);
    total += line.qty;
  }
  return { done, total };
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Tanggal `YYYYMMDD` menurut WIB (UTC+7), zona proyek (`appsscript.json`). */
export function dateKeyOf(epochMs: number): string {
  const date = new Date(epochMs + WIB_OFFSET_MS);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export function handoverNumber(dateKey: string, sequence: number): string {
  return `ST-${dateKey}-${String(sequence).padStart(3, '0')}`;
}

/** Urutan berikutnya untuk hari itu: maksimum urutan yang ada + 1 (nomor rusak diabaikan). */
export function nextHandoverSequence(numbers: readonly string[], dateKey: string): number {
  const prefix = `ST-${dateKey}-`;
  let max = 0;
  for (const number of numbers) {
    if (!number.startsWith(prefix)) continue;
    const tail = number.slice(prefix.length);
    if (tail === '' || [...tail].some((ch) => ch < '0' || ch > '9')) continue;
    max = Math.max(max, Number(tail));
  }
  return max + 1;
}
```

`shared/rpc.ts` — tambahkan sebelum `export interface RpcContract {` (setelah tipe item/merk):

```ts
export interface CustomerDto {
  id: string;
  name: string;
  status: ItemStatus;
  updatedAt: string;
}

export interface RenameCustomerInput {
  id: string;
  name: string;
}

export interface SetCustomerStatusInput {
  id: string;
  status: ItemStatus;
}

/** Item aktif untuk saran tipe di form task (tanpa detail berat). */
export interface HandoverOptionItemDto {
  id: string;
  brand: string;
  model: string;
  aliases: string[];
}

export interface HandoverOptionCustomerDto {
  id: string;
  name: string;
}

export interface HandoverOptionsDto {
  items: HandoverOptionItemDto[];
  customers: HandoverOptionCustomerDto[];
}

export interface HandoverLineDto {
  id: string;
  itemId: string;
  /** Salinan "merk tipe" saat baris dibuat (FH9). */
  itemLabel: string;
  qty: number;
  doneQty: number;
  doneAt: string;
  doneBy: string;
}

export interface HandoverSummaryDto {
  id: string;
  number: string;
  locationId: string;
  customerId: string;
  customerName: string;
  note: string;
  status: HandoverStatus;
  lineCount: number;
  doneUnits: number;
  totalUnits: number;
  createdAt: string;
  updatedAt: string;
}

export interface HandoverDto extends HandoverSummaryDto {
  lines: HandoverLineDto[];
  createdBy: string;
  updatedBy: string;
}

export interface ListHandoversInput {
  locationIds: string[];
}

export interface GetHandoverInput {
  id: string;
  locationIds: string[];
}

export interface SaveHandoverLineInput {
  itemId: string;
  qty: number;
}

export interface SaveHandoverInput {
  id?: string;
  locationId: string;
  /** Nama customer; yang belum ada dibuat saat task disimpan (FC2). */
  customerName: string;
  note: string;
  lines: SaveHandoverLineInput[];
}

export interface HandoverRefInput {
  id: string;
  locationId: string;
}

export interface SetProgressInput extends HandoverRefInput {
  lineId: string;
  doneQty: number;
}

export interface CompleteLineInput extends HandoverRefInput {
  lineId: string;
}
```

tambahkan impor tipe di bagian atas `rpc.ts`: `import type { HandoverStatus } from './handover';` dan di dalam `RpcContract`:

```ts
  'customers.list': { input: null; output: CustomerDto[] };
  'customers.rename': { input: RenameCustomerInput; output: CustomerDto };
  'customers.setStatus': { input: SetCustomerStatusInput; output: CustomerDto };
  'handovers.options': { input: ListHandoversInput; output: HandoverOptionsDto };
  'handovers.list': { input: ListHandoversInput; output: HandoverSummaryDto[] };
  'handovers.get': { input: GetHandoverInput; output: HandoverDto };
  'handovers.save': { input: SaveHandoverInput; output: HandoverDto };
  'handovers.cancel': { input: HandoverRefInput; output: HandoverDto };
  'handovers.setProgress': { input: SetProgressInput; output: HandoverDto };
  'handovers.completeLine': { input: CompleteLineInput; output: HandoverDto };
  'handovers.completeAll': { input: HandoverRefInput; output: HandoverDto };
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `bun run --cwd shared test`
Expected: semua lulus. Bila asersi `similarNames('Budi Santso', names, 1)` atau `find('ubi')` gagal karena urutan/ambang, periksa **perilaku** (bukan melonggarkan tes secara sembarangan): "ubi" harus mencocokkan awalan "ubiquiti" pada dua item dengan skor sama sehingga urutan = urutan asli.

- [ ] **Step 5: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false shared
git add shared
git commit -m "feat(shared): saran toleran, status/nomor task serah terima, dan kontrak RPC customer dan serah terima" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Modul customer (master, pembuatan inline, ganti nama, status)

**Files:**
- Create: `gas/src/modules/customer/repo.ts`, `validate.ts`, `service.ts`, `routes.ts`, `customer.test.ts`
- Modify: `gas/src/routes.ts`, `gas/src/routes.test.ts`, `gas/src/setup.ts`, `gas/src/setup.test.ts`

**Interfaces:**
- Consumes: `normalizeKey`, `HANDOVER_LIMITS`, `ActorRef`, `appendAudit_`, `nowIso_`, `readTable_`/`insertRow_`/`updateRow_`.
- Produces:
  - `repo.ts`: `CUSTOMERS_TABLE`, `CustomerRecord`, `NewCustomerRecord`, `listCustomers_()`, `insertCustomer_()`, `updateCustomer_()`.
  - `validate.ts`: `validateRenameCustomer_`, `validateSetCustomerStatus_`, `validateCustomerName_(raw, key)` (dipakai task).
  - `service.ts`: `listCustomerDtos_()`, `resolveCustomerByName_(name, actor, currentId?): NewCustomerRecord` (**pemanggil memegang lock**), `renameCustomer_`, `setCustomerStatus_`, `customerSnapshot_`.
  - Rute `customers.list` (`item: view`), `customers.rename` dan `customers.setStatus` (`item: manage`).

- [ ] **Step 1: Tulis tes yang gagal** — `gas/src/modules/customer/customer.test.ts`

```ts
import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import type { UserContext } from '@gas/modules/access/context';
import { loadUserContext_ } from '@gas/modules/access/context';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { getRoutes_ } from '@gas/routes';
import { captureAppError } from '@gas-test/errors';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { insertCustomer_, listCustomers_ } from './repo';
import {
  listCustomerDtos_,
  renameCustomer_,
  resolveCustomerByName_,
  setCustomerStatus_,
} from './service';
import { validateCustomerName_, validateRenameCustomer_, validateSetCustomerStatus_ } from './validate';

let admin: UserContext;

beforeEach(() => {
  setPlatform_(
    createMemoryPlatform({
      properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
      now: () => Date.parse('2026-10-15T00:00:00.000Z'),
    }),
  );
  const ctx = loadUserContext_('admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
});

const lastAudit = () => {
  const record = listAuditRecords_().at(-1);
  if (!record) throw new Error('audit kosong');
  return record;
};

const base = (name: string, over: Partial<Parameters<typeof insertCustomer_>[0]> = {}) => ({
  id: `c-${name.toLowerCase().split(' ').join('-')}`,
  name,
  key: name.toLowerCase().split(' ').join(' '),
  status: 'active' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: 'seed',
  ...over,
});

test('resolveCustomerByName_ membuat customer baru, mengaudit, dan memakai ulang ejaan resmi untuk varian', () => {
  const created = resolveCustomerByName_('PT Maju Jaya', admin);
  expect(created).toMatchObject({ name: 'PT Maju Jaya', status: 'active' });
  expect(lastAudit()).toMatchObject({ action: 'customer.create', target: 'PT Maju Jaya', before: null });
  const again = resolveCustomerByName_(' pt. MAJU  jaya ', admin);
  expect(again.id).toBe(created.id);
  expect(again.name).toBe('PT Maju Jaya');
  expect(listCustomers_()).toHaveLength(1);
});

test('customer nonaktif tidak dipakai untuk task baru (pesan di customerName), kecuali task itu sudah memakainya', () => {
  insertCustomer_(base('Lama', { id: 'c1', key: 'lama', status: 'inactive' }));
  const error = captureAppError(() => resolveCustomerByName_('lama', admin));
  expect(error.code).toBe('VALIDATION');
  expect(error.fields).toEqual({ customerName: 'Customer dinonaktifkan; aktifkan dulu di halaman Customer' });
  expect(resolveCustomerByName_('lama', admin, 'c1').id).toBe('c1');
});

test('daftar customer terurut nama; rename: unik, no-op tanpa audit, audit customer.rename', () => {
  insertCustomer_(base('Zeta', { id: 'cz', key: 'zeta' }));
  insertCustomer_(base('Alfa', { id: 'ca', key: 'alfa' }));
  expect(listCustomerDtos_().map((c) => c.name)).toEqual(['Alfa', 'Zeta']);
  expect(captureAppError(() => renameCustomer_({ id: 'ca', name: 'zeta' }, admin)).fields).toEqual({
    name: 'Nama customer sudah dipakai',
  });
  const before = listAuditRecords_().length;
  expect(renameCustomer_({ id: 'ca', name: 'Alfa' }, admin).name).toBe('Alfa');
  expect(listAuditRecords_()).toHaveLength(before);
  expect(renameCustomer_({ id: 'ca', name: 'ALFA' }, admin).name).toBe('ALFA'); // kapitalisasi milik sendiri boleh
  expect(lastAudit()).toMatchObject({ action: 'customer.rename', before: { name: 'Alfa' }, after: { name: 'ALFA' } });
  expect(captureAppError(() => renameCustomer_({ id: 'x', name: 'Z' }, admin)).code).toBe('NOT_FOUND');
});

test('nonaktifkan/aktifkan dicatat; status sama tanpa audit; id tak dikenal NOT_FOUND', () => {
  insertCustomer_(base('Alfa', { id: 'ca', key: 'alfa' }));
  setCustomerStatus_({ id: 'ca', status: 'inactive' }, admin);
  expect(lastAudit().action).toBe('customer.deactivate');
  const before = listAuditRecords_().length;
  setCustomerStatus_({ id: 'ca', status: 'inactive' }, admin);
  expect(listAuditRecords_()).toHaveLength(before);
  setCustomerStatus_({ id: 'ca', status: 'active' }, admin);
  expect(lastAudit().action).toBe('customer.activate');
  expect(captureAppError(() => setCustomerStatus_({ id: 'x', status: 'active' }, admin)).code).toBe('NOT_FOUND');
});

test('validator nama customer, rename, dan status', () => {
  expect(validateCustomerName_({ customerName: '  PT A ' }, 'customerName')).toBe('PT A');
  expect(captureAppError(() => validateCustomerName_({ customerName: '' }, 'customerName')).fields).toEqual({
    customerName: 'Wajib diisi',
  });
  expect(captureAppError(() => validateCustomerName_({ customerName: '--' }, 'customerName')).fields).toEqual({
    customerName: 'Nama customer harus memuat huruf atau angka',
  });
  expect(captureAppError(() => validateCustomerName_({ customerName: 'x'.repeat(101) }, 'customerName')).fields).toEqual({
    customerName: 'Maksimal 100 karakter',
  });
  expect(validateRenameCustomer_({ id: 'c1', name: ' B ' })).toEqual({ id: 'c1', name: 'B' });
  expect(captureAppError(() => validateRenameCustomer_({ id: '', name: '' })).fields).toEqual({
    id: 'Wajib diisi',
    name: 'Wajib diisi',
  });
  expect(validateSetCustomerStatus_({ id: 'c1', status: 'inactive' })).toEqual({ id: 'c1', status: 'inactive' });
});

test('izin rute customer: list = item view; rename dan setStatus = item manage', () => {
  const routes = getRoutes_();
  expect(routes['customers.list'].permission).toEqual({ module: 'item', level: 'view' });
  expect(routes['customers.rename'].permission).toEqual({ module: 'item', level: 'manage' });
  expect(routes['customers.setStatus'].permission).toEqual({ module: 'item', level: 'manage' });
});
```

Perbarui `gas/src/routes.test.ts`: tambahkan `'customers.list'`, `'customers.rename'`, `'customers.setStatus'` ke daftar kunci terurut (setelah `'brands.setStatus'`); dan `gas/src/setup.test.ts`: ekspektasi urutan sheet menjadi `[..., 'items', 'sync_state', 'customers']` serta judul tesnya memuat `customers` (urutan akhir akan bertambah `handovers`, `handover_lines` di Task 3).

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test customer`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Repo** — `gas/src/modules/customer/repo.ts`

```ts
import type { RowData, TableSchema } from '@gas/core/db';
import { insertRow_, readTable_, updateRow_ } from '@gas/core/db';
import type { ItemStatus } from '@shared/rpc';

export const CUSTOMERS_TABLE: TableSchema = {
  sheetName: 'customers',
  columns: ['id', 'name', 'key', 'status', 'created_at', 'updated_at', 'updated_by'],
};

export interface CustomerRecord {
  rowNumber: number;
  id: string;
  name: string;
  /** `normalizeKey(name)`; unik. */
  key: string;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewCustomerRecord = Omit<CustomerRecord, 'rowNumber'>;

function toCustomerRecord_(rowNumber: number, data: RowData): CustomerRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    name: (data.name ?? '').trim(),
    key: (data.key ?? '').trim(),
    status: (data.status ?? '').trim() === 'inactive' ? 'inactive' : 'active',
    createdAt: data.created_at ?? '',
    updatedAt: data.updated_at ?? '',
    updatedBy: data.updated_by ?? '',
  };
}

function fromCustomerRecord_(customer: NewCustomerRecord): RowData {
  return {
    id: customer.id,
    name: customer.name,
    key: customer.key,
    status: customer.status,
    created_at: customer.createdAt,
    updated_at: customer.updatedAt,
    updated_by: customer.updatedBy,
  };
}

export function listCustomers_(): CustomerRecord[] {
  return readTable_(CUSTOMERS_TABLE)
    .rows.map(({ rowNumber, data }) => toCustomerRecord_(rowNumber, data))
    .filter((customer) => customer.id !== '' && customer.key !== '');
}

export function insertCustomer_(customer: NewCustomerRecord): void {
  insertRow_(CUSTOMERS_TABLE, fromCustomerRecord_(customer));
}

export function updateCustomer_(customer: CustomerRecord): void {
  updateRow_(CUSTOMERS_TABLE, customer.rowNumber, fromCustomerRecord_(customer));
}
```

- [ ] **Step 4: Validator** — `gas/src/modules/customer/validate.ts`

```ts
import { readObject_ } from '@gas/core/validate';
import { normalizeKey } from '@shared/items';
import { HANDOVER_LIMITS } from '@shared/handover';
import type { RenameCustomerInput, SetCustomerStatusInput } from '@shared/rpc';

const CUSTOMER_STATUS_VALUES = ['active', 'inactive'] as const;

/** Nama customer dari field `key` pada objek mentah (dipakai form task dan ganti nama). */
export function validateCustomerName_(raw: unknown, key: string): string {
  const reader = readObject_(raw);
  const name = reader.str(key, { required: true, max: HANDOVER_LIMITS.customerName });
  if (name !== '' && normalizeKey(name) === '') {
    reader.fail(key, 'Nama customer harus memuat huruf atau angka');
  }
  reader.done();
  return name;
}

export function validateRenameCustomer_(raw: unknown): RenameCustomerInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const name = reader.str('name', { required: true, max: HANDOVER_LIMITS.customerName });
  if (name !== '' && normalizeKey(name) === '') {
    reader.fail('name', 'Nama customer harus memuat huruf atau angka');
  }
  reader.done();
  return { id, name };
}

export function validateSetCustomerStatus_(raw: unknown): SetCustomerStatusInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const status = reader.oneOf('status', CUSTOMER_STATUS_VALUES);
  reader.done();
  return { id, status };
}
```

- [ ] **Step 5: Layanan dan rute**

`gas/src/modules/customer/service.ts`:

```ts
import type { ActorRef } from '@gas/core/actor';
import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import { appendAudit_ } from '@gas/modules/access/repo';
import { nowIso_ } from '@gas/modules/access/service';
import { normalizeKey } from '@shared/items';
import type { CustomerDto, RenameCustomerInput, SetCustomerStatusInput } from '@shared/rpc';
import type { CustomerRecord, NewCustomerRecord } from './repo';
import { insertCustomer_, listCustomers_, updateCustomer_ } from './repo';

function toCustomerDto_(customer: NewCustomerRecord): CustomerDto {
  return {
    id: customer.id,
    name: customer.name,
    status: customer.status,
    updatedAt: customer.updatedAt,
  };
}

export function customerSnapshot_(customer: NewCustomerRecord): Record<string, unknown> {
  return { name: customer.name, status: customer.status };
}

export function listCustomerDtos_(): CustomerDto[] {
  return listCustomers_()
    .map(toCustomerDto_)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Mencari customer menurut nama (kunci ternormalisasi; ejaan resmi yang tersimpan menang); bila belum ada,
 * membuatnya dan mencatat audit — inilah "buat langsung saat mengetik" (FC2). Customer nonaktif ditolak
 * kecuali `currentId` (task yang sudah memakainya). PEMANGGIL WAJIB memegang lock (tidak mengunci sendiri).
 */
export function resolveCustomerByName_(
  name: string,
  actor: ActorRef,
  currentId?: string,
): NewCustomerRecord {
  const key = normalizeKey(name);
  const found = listCustomers_().find((customer) => customer.key === key);
  if (found) {
    if (found.status === 'inactive' && found.id !== currentId) {
      const message = 'Customer dinonaktifkan; aktifkan dulu di halaman Customer';
      throw appError_('VALIDATION', message, { customerName: message });
    }
    return found;
  }
  const now = nowIso_();
  const created: NewCustomerRecord = {
    id: platform_().uuid(),
    name,
    key,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
  };
  insertCustomer_(created);
  appendAudit_({
    ts: now,
    actor: actor.email,
    action: 'customer.create',
    target: created.name,
    before: null,
    after: customerSnapshot_(created),
  });
  return created;
}

export function renameCustomer_(input: RenameCustomerInput, actor: ActorRef): CustomerDto {
  return platform_().withLock(() => {
    const customers = listCustomers_();
    const existing = customers.find((customer) => customer.id === input.id);
    if (!existing) throw appError_('NOT_FOUND', 'Customer tidak ditemukan');
    const key = normalizeKey(input.name);
    if (customers.some((customer) => customer.id !== input.id && customer.key === key)) {
      throw appError_('CONFLICT', 'Nama customer sudah dipakai', {
        name: 'Nama customer sudah dipakai',
      });
    }
    if (existing.name === input.name) return toCustomerDto_(existing);
    const now = nowIso_();
    const updated: CustomerRecord = {
      ...existing,
      name: input.name,
      key,
      updatedAt: now,
      updatedBy: actor.email,
    };
    updateCustomer_(updated);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'customer.rename',
      target: updated.name,
      before: customerSnapshot_(existing),
      after: customerSnapshot_(updated),
    });
    return toCustomerDto_(updated);
  });
}

export function setCustomerStatus_(input: SetCustomerStatusInput, actor: ActorRef): CustomerDto {
  return platform_().withLock(() => {
    const existing = listCustomers_().find((customer) => customer.id === input.id);
    if (!existing) throw appError_('NOT_FOUND', 'Customer tidak ditemukan');
    if (existing.status === input.status) return toCustomerDto_(existing);
    const now = nowIso_();
    const updated: CustomerRecord = {
      ...existing,
      status: input.status,
      updatedAt: now,
      updatedBy: actor.email,
    };
    updateCustomer_(updated);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'customer.activate' : 'customer.deactivate',
      target: updated.name,
      before: customerSnapshot_(existing),
      after: customerSnapshot_(updated),
    });
    return toCustomerDto_(updated);
  });
}
```

`gas/src/modules/customer/routes.ts`:

```ts
import type { RouteTable } from '@gas/core/router';
import { expectNull_ } from '@gas/core/validate';
import { listCustomerDtos_, renameCustomer_, setCustomerStatus_ } from './service';
import { validateRenameCustomer_, validateSetCustomerStatus_ } from './validate';

type CustomerMethod = 'customers.list' | 'customers.rename' | 'customers.setStatus';

/** Customer dibuat inline lewat `handovers.save`; halaman Customer hanya melihat, ganti nama, dan status. */
export function customerRoutes_(): Pick<RouteTable, CustomerMethod> {
  return {
    'customers.list': {
      permission: { module: 'item', level: 'view' },
      validate: expectNull_,
      handler: () => listCustomerDtos_(),
    },
    'customers.rename': {
      permission: { module: 'item', level: 'manage' },
      validate: validateRenameCustomer_,
      handler: (input, ctx) => renameCustomer_(input, ctx.user),
    },
    'customers.setStatus': {
      permission: { module: 'item', level: 'manage' },
      validate: validateSetCustomerStatus_,
      handler: (input, ctx) => setCustomerStatus_(input, ctx.user),
    },
  };
}
```

`gas/src/routes.ts`: impor `customerRoutes_` dari `@gas/modules/customer/routes` dan tambahkan `...customerRoutes_()` ke objek yang dikembalikan `getRoutes_`. `gas/src/setup.ts`: impor `CUSTOMERS_TABLE` dan tambahkan ke daftar tabel (setelah `SYNC_STATE_TABLE`).

- [ ] **Step 6: Jalankan semua tes gas, typecheck, dan build**

Run: `bun run --cwd gas test && bun run --cwd gas typecheck && bun scripts/build-gas.ts`
Expected: tes customer lulus. Typecheck **gagal** karena `RouteTable` mewajibkan `handovers.*` (Task 1 menambahkannya ke kontrak); itu diharapkan sampai Task 3–5. Bila ingin typecheck hijau di sini, jangan menjalankannya sebelum Task 5 (build GAS dan tes tetap dapat dijalankan: `bun test` tidak melakukan typecheck).

- [ ] **Step 7: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas shared
git add gas shared
git commit -m "feat(customer): master customer dengan pembuatan inline, ganti nama, dan status" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Repo, fixture, dan sisi baca serah terima (opsi, daftar, detail) dengan izin per lokasi

**Files:**
- Create: `gas/src/modules/handover/repo.ts`, `validate.ts`, `service.ts`, `routes.ts`, `handover-read.test.ts`; `gas/test-support/handover-fixtures.ts`, `gas/test-support/handover-env.ts`
- Modify: `gas/src/routes.ts`, `gas/src/routes.test.ts`, `gas/src/setup.ts`, `gas/src/setup.test.ts`

**Interfaces:**
- Consumes: Task 1 (`deriveHandoverStatus`, `progressTotals`, DTO), Task 2 (`listCustomers_`), `listItems_`, `brandNameMap_` (item), `listLocations_`.
- Produces:
  - `repo.ts`: `HANDOVERS_TABLE`, `HANDOVER_LINES_TABLE`, `HandoverRecord`, `NewHandoverRecord`, `HandoverLineRecord`, `NewHandoverLineRecord`, `listHandovers_()`, `insertHandover_()`, `updateHandover_()`, `listHandoverLines_()`, `insertHandoverLine_()`, `updateHandoverLine_()`, `deleteHandoverLine_()`.
  - `service.ts`: `toHandoverDto_(handover, lines, customerNames)`, `listHandoverSummaries_(locationIds)`, `getHandoverDto_(input, locationIds)`, `handoverOptions_()`.
  - `validate.ts`: `validateListHandovers_`, `validateGetHandover_`.
  - `test-support/handover-env.ts`: `seedHandoverEnv()`, `rpc(email, method, payload)`, `ENV`.
  - Rute `handovers.options|list|get` = `anyOf [handover view, qc edit]`, `scope: 'location'`.

- [ ] **Step 1: Fixture dan lingkungan tes** (bukan tes; dipakai Task 3–5)

`gas/test-support/handover-fixtures.ts`:

```ts
import type { NewCustomerRecord } from '@gas/modules/customer/repo';
import type { NewHandoverLineRecord, NewHandoverRecord } from '@gas/modules/handover/repo';
import { normalizeKey } from '@shared/items';

const SEED_TIME = '2026-01-01T00:00:00.000Z';

export function customer(
  name: string,
  overrides: Partial<NewCustomerRecord> = {},
): NewCustomerRecord {
  const key = normalizeKey(name);
  return {
    id: `cust-${key.split(' ').join('-')}`,
    name,
    key,
    status: 'active',
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    updatedBy: 'seed',
    ...overrides,
  };
}

export function handover(
  overrides: Partial<NewHandoverRecord> & Pick<NewHandoverRecord, 'id' | 'number' | 'locationId'>,
): NewHandoverRecord {
  return {
    customerId: 'cust-pt-maju',
    customerName: 'PT Maju',
    note: '',
    status: 'open',
    createdAt: SEED_TIME,
    createdBy: 'seed',
    updatedAt: SEED_TIME,
    updatedBy: 'seed',
    ...overrides,
  };
}

export function handoverLine(
  overrides: Partial<NewHandoverLineRecord> &
    Pick<NewHandoverLineRecord, 'id' | 'handoverId' | 'itemId'>,
): NewHandoverLineRecord {
  return {
    itemLabel: 'Ubiquiti ES 24',
    qty: 1,
    doneQty: 0,
    doneAt: '',
    doneBy: '',
    ...overrides,
  };
}
```

`gas/test-support/handover-env.ts`:

```ts
import { handleRpc_ } from '@gas/core/router';
import { signSessionToken_ } from '@gas/core/session';
import { insertLocation_, insertRole_, insertUser_ } from '@gas/modules/access/repo';
import { insertBrand_ } from '@gas/modules/brand/repo';
import { insertItem_ } from '@gas/modules/item/repo';
import { getRoutes_ } from '@gas/routes';
import type { RpcResult } from '@shared/rpc';
import { location, role, user } from './access-fixtures';
import { brand, item } from './item-fixtures';

export const ENV = {
  locA: 'loc-a',
  locB: 'loc-b',
  /** Lokasi nonaktif. */
  locOff: 'loc-off',
  itemA: item({ id: 'item-a', brand: 'Ubiquiti', model: 'ES 24' }).id,
  itemB: item({ id: 'item-b', brand: 'Mikrotik', model: 'hAP ac2' }).id,
  itemOff: item({ id: 'item-off', brand: 'Ubiquiti', model: 'Lama' }).id,
};

/**
 * Memasang lokasi, peran, user, merk, dan item untuk tes serah terima. Panggil SETELAH `setPlatform_`.
 *  - wh@: handover manage di loc-a        - whedit@: handover edit di loc-a
 *  - qc@: qc edit di loc-a dan loc-b      - viewer@: handover view di loc-a
 *  - noaccess@: hanya item view di loc-a  - multi@: handover manage di loc-a dan loc-b
 */
export function seedHandoverEnv(): void {
  insertLocation_(location({ id: ENV.locA, code: 'A', name: 'Lokasi A' }));
  insertLocation_(location({ id: ENV.locB, code: 'B', name: 'Lokasi B' }));
  insertLocation_(location({ id: ENV.locOff, code: 'X', name: 'Lokasi Off', status: 'inactive' }));
  insertRole_(role({ id: 'role-wh', name: 'WH', permissions: { handover: 'manage' } }));
  insertRole_(role({ id: 'role-wh-edit', name: 'WH edit', permissions: { handover: 'edit' } }));
  insertRole_(role({ id: 'role-qc', name: 'QC', permissions: { qc: 'edit' } }));
  insertRole_(role({ id: 'role-view', name: 'Viewer', permissions: { handover: 'view' } }));
  insertRole_(role({ id: 'role-item', name: 'Item', permissions: { item: 'view' } }));
  const assign = (id: string, email: string, rows: Array<[string, string]>) =>
    insertUser_(
      user({
        id,
        email,
        assignments: rows.map(([locationId, roleId]) => ({ locationId, roleIds: [roleId] })),
      }),
    );
  assign('u-wh', 'wh@gmail.com', [[ENV.locA, 'role-wh']]);
  assign('u-whedit', 'whedit@gmail.com', [[ENV.locA, 'role-wh-edit']]);
  assign('u-qc', 'qc@gmail.com', [
    [ENV.locA, 'role-qc'],
    [ENV.locB, 'role-qc'],
  ]);
  assign('u-viewer', 'viewer@gmail.com', [[ENV.locA, 'role-view']]);
  assign('u-noaccess', 'noaccess@gmail.com', [[ENV.locA, 'role-item']]);
  assign('u-multi', 'multi@gmail.com', [
    [ENV.locA, 'role-wh'],
    [ENV.locB, 'role-wh'],
  ]);
  insertBrand_(brand('Ubiquiti'));
  insertBrand_(brand('Mikrotik'));
  insertItem_(item({ id: ENV.itemA, brand: 'Ubiquiti', model: 'ES 24' }));
  insertItem_(item({ id: ENV.itemB, brand: 'Mikrotik', model: 'hAP ac2', aliases: ['hap'] }));
  insertItem_(item({ id: ENV.itemOff, brand: 'Ubiquiti', model: 'Lama', status: 'inactive' }));
}

/** Memanggil RPC sebagai user (token sesi sah) lewat router sungguhan. */
export function rpc(email: string, method: string, payload: unknown): RpcResult<unknown> {
  return handleRpc_(method, JSON.stringify(payload), signSessionToken_(email), getRoutes_());
}
```

- [ ] **Step 2: Tulis tes baca yang gagal** — `gas/src/modules/handover/handover-read.test.ts`

```ts
import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { insertCustomer_ } from '@gas/modules/customer/repo';
import { getRoutes_ } from '@gas/routes';
import { customer, handover, handoverLine } from '@gas-test/handover-fixtures';
import { ENV, rpc, seedHandoverEnv } from '@gas-test/handover-env';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { insertHandover_, insertHandoverLine_ } from './repo';

beforeEach(() => {
  setPlatform_(
    createMemoryPlatform({
      properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
      now: () => Date.parse('2026-10-15T03:00:00.000Z'),
    }),
  );
  seedHandoverEnv();
  insertCustomer_(customer('PT Maju'));
  insertCustomer_(customer('Budi'));
  // loc-a: t1 (Baru), t2 (Dikerjakan), t3 (Selesai), t4 (Dibatalkan); loc-b: t5
  insertHandover_(handover({ id: 't1', number: 'ST-20261015-001', locationId: ENV.locA, createdAt: '2026-10-15T01:00:00.000Z' }));
  insertHandoverLine_(handoverLine({ id: 'l1', handoverId: 't1', itemId: ENV.itemA, qty: 5 }));
  insertHandover_(handover({ id: 't2', number: 'ST-20261015-002', locationId: ENV.locA, createdAt: '2026-10-15T02:00:00.000Z', customerId: 'cust-budi', customerName: 'Budi' }));
  insertHandoverLine_(handoverLine({ id: 'l2', handoverId: 't2', itemId: ENV.itemA, qty: 5, doneQty: 2 }));
  insertHandoverLine_(handoverLine({ id: 'l3', handoverId: 't2', itemId: ENV.itemB, itemLabel: 'Mikrotik hAP ac2', qty: 3 }));
  insertHandover_(handover({ id: 't3', number: 'ST-20261014-001', locationId: ENV.locA, createdAt: '2026-10-14T01:00:00.000Z' }));
  insertHandoverLine_(handoverLine({ id: 'l4', handoverId: 't3', itemId: ENV.itemA, qty: 2, doneQty: 2 }));
  insertHandover_(handover({ id: 't4', number: 'ST-20261013-001', locationId: ENV.locA, createdAt: '2026-10-13T01:00:00.000Z', status: 'cancelled' }));
  insertHandoverLine_(handoverLine({ id: 'l5', handoverId: 't4', itemId: ENV.itemA, qty: 2, doneQty: 1 }));
  insertHandover_(handover({ id: 't5', number: 'ST-20261015-003', locationId: ENV.locB, createdAt: '2026-10-15T02:30:00.000Z' }));
  insertHandoverLine_(handoverLine({ id: 'l6', handoverId: 't5', itemId: ENV.itemB, itemLabel: 'Mikrotik hAP ac2', qty: 1 }));
});

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = (email: string, method: string, payload: unknown) => rpc(email, method, payload) as Result;

test('daftar: lokasi terpilih saja, terbaru dulu, status turunan dan ringkasan progres', () => {
  const out = call('wh@gmail.com', 'handovers.list', { locationIds: [ENV.locA] });
  expect(out.ok).toBe(true);
  expect(out.data.map((t: { id: string }) => t.id)).toEqual(['t2', 't1', 't3', 't4']);
  const byId = Object.fromEntries(out.data.map((t: { id: string }) => [t.id, t]));
  expect(byId.t1).toMatchObject({ status: 'new', doneUnits: 0, totalUnits: 5, lineCount: 1, number: 'ST-20261015-001' });
  expect(byId.t2).toMatchObject({ status: 'in_progress', doneUnits: 2, totalUnits: 8, lineCount: 2, customerName: 'Budi' });
  expect(byId.t3).toMatchObject({ status: 'done', doneUnits: 2, totalUnits: 2 });
  expect(byId.t4).toMatchObject({ status: 'cancelled' });
});

test('beberapa lokasi sekaligus; satu lokasi terlarang menolak seluruh permintaan', () => {
  const both = call('multi@gmail.com', 'handovers.list', { locationIds: [ENV.locA, ENV.locB] });
  expect(both.data.map((t: { id: string }) => t.id).sort()).toEqual(['t1', 't2', 't3', 't4', 't5']);
  expect(call('wh@gmail.com', 'handovers.list', { locationIds: [ENV.locA, ENV.locB] }).error.code).toBe('FORBIDDEN');
});

test('lokasi tak dikenal, nonaktif, dan user tanpa izin serah terima/QC → FORBIDDEN', () => {
  expect(call('wh@gmail.com', 'handovers.list', { locationIds: ['loc-zzz'] }).error.code).toBe('FORBIDDEN');
  expect(call('multi@gmail.com', 'handovers.list', { locationIds: [ENV.locOff] }).error.code).toBe('FORBIDDEN');
  expect(call('noaccess@gmail.com', 'handovers.list', { locationIds: [ENV.locA] }).error.code).toBe('FORBIDDEN');
});

test('"salah satu dari": handover view, handover manage, atau qc edit cukup; lokasi kosong ditolak', () => {
  for (const email of ['viewer@gmail.com', 'wh@gmail.com', 'qc@gmail.com']) {
    expect(call(email, 'handovers.list', { locationIds: [ENV.locA] }).ok).toBe(true);
  }
  expect(call('wh@gmail.com', 'handovers.list', { locationIds: [] }).error.code).toBe('VALIDATION');
  expect(call('wh@gmail.com', 'handovers.list', {}).error.code).toBe('VALIDATION');
});

test('detail: baris lengkap; id milik lokasi lain atau tak dikenal → NOT_FOUND walau user punya izin di lokasi yang diminta', () => {
  const ok = call('wh@gmail.com', 'handovers.get', { id: 't2', locationIds: [ENV.locA] });
  expect(ok.data).toMatchObject({ id: 't2', status: 'in_progress', createdBy: 'seed' });
  expect(ok.data.lines.map((l: { id: string }) => l.id)).toEqual(['l2', 'l3']);
  expect(ok.data.lines[0]).toMatchObject({ itemId: ENV.itemA, itemLabel: 'Ubiquiti ES 24', qty: 5, doneQty: 2 });
  expect(call('qc@gmail.com', 'handovers.get', { id: 't5', locationIds: [ENV.locA] }).error.code).toBe('NOT_FOUND');
  expect(call('qc@gmail.com', 'handovers.get', { id: 't5', locationIds: [ENV.locB] }).ok).toBe(true);
  expect(call('wh@gmail.com', 'handovers.get', { id: 'tidak-ada', locationIds: [ENV.locA] }).error.code).toBe('NOT_FOUND');
});

test('nama customer di daftar mengikuti nama terkini; salinan dipakai bila customer hilang', () => {
  const out = call('wh@gmail.com', 'handovers.list', { locationIds: [ENV.locA] });
  const t1 = out.data.find((t: { id: string }) => t.id === 't1');
  expect(t1.customerName).toBe('PT Maju');
  insertHandover_(handover({ id: 't9', number: 'ST-20261015-009', locationId: ENV.locA, customerId: 'cust-hilang', customerName: 'Salinan Lama' }));
  insertHandoverLine_(handoverLine({ id: 'l9', handoverId: 't9', itemId: ENV.itemA }));
  const again = call('wh@gmail.com', 'handovers.list', { locationIds: [ENV.locA] });
  expect(again.data.find((t: { id: string }) => t.id === 't9').customerName).toBe('Salinan Lama');
});

test('opsi form: item dan customer AKTIF saja, terurut, tanpa detail berat; izin serah terima cukup tanpa izin item', () => {
  insertCustomer_(customer('Lama', { status: 'inactive' }));
  const out = call('whedit@gmail.com', 'handovers.options', { locationIds: [ENV.locA] });
  expect(out.ok).toBe(true);
  expect(out.data.items.map((i: { id: string }) => i.id)).toEqual([ENV.itemB, ENV.itemA]); // Mikrotik, Ubiquiti
  expect(out.data.items[0]).toEqual({ id: ENV.itemB, brand: 'Mikrotik', model: 'hAP ac2', aliases: ['hap'] });
  expect(out.data.customers.map((c: { name: string }) => c.name)).toEqual(['Budi', 'PT Maju']);
  expect(JSON.stringify(out.data)).not.toContain('detail');
  expect(call('noaccess@gmail.com', 'handovers.options', { locationIds: [ENV.locA] }).error.code).toBe('FORBIDDEN');
});

test('izin rute baca: anyOf handover view atau qc edit, berlokasi', () => {
  const anyOf = {
    anyOf: [
      { module: 'handover', level: 'view', scope: 'location' },
      { module: 'qc', level: 'edit', scope: 'location' },
    ],
  };
  const routes = getRoutes_();
  for (const method of ['handovers.options', 'handovers.list', 'handovers.get'] as const) {
    expect(routes[method].permission).toEqual(anyOf);
  }
});
```

Perbarui `gas/src/routes.test.ts`: tambahkan `'handovers.get'`, `'handovers.list'`, `'handovers.options'` ke daftar kunci terurut; `gas/src/setup.test.ts`: urutan sheet akhir `[..., 'items', 'sync_state', 'customers', 'handovers', 'handover_lines']`.

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test handover-read`
Expected: FAIL — modul `handover` belum ada.

- [ ] **Step 4: Repo** — `gas/src/modules/handover/repo.ts`

```ts
import type { RowData, TableSchema } from '@gas/core/db';
import { deleteRow_, insertRow_, readTable_, updateRow_ } from '@gas/core/db';
import type { HandoverStoredStatus } from '@shared/handover';

export const HANDOVERS_TABLE: TableSchema = {
  sheetName: 'handovers',
  columns: [
    'id',
    'number',
    'location_id',
    'customer_id',
    'customer_name',
    'note',
    'status',
    'created_at',
    'created_by',
    'updated_at',
    'updated_by',
  ],
};

export const HANDOVER_LINES_TABLE: TableSchema = {
  sheetName: 'handover_lines',
  columns: ['id', 'handover_id', 'item_id', 'item_label', 'qty', 'done_qty', 'done_at', 'done_by'],
};

export interface HandoverRecord {
  rowNumber: number;
  id: string;
  number: string;
  locationId: string;
  customerId: string;
  /** Salinan nama customer saat task disimpan. */
  customerName: string;
  note: string;
  status: HandoverStoredStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewHandoverRecord = Omit<HandoverRecord, 'rowNumber'>;

export interface HandoverLineRecord {
  rowNumber: number;
  id: string;
  handoverId: string;
  itemId: string;
  /** Salinan "merk tipe" saat baris dibuat (FH9). */
  itemLabel: string;
  qty: number;
  doneQty: number;
  doneAt: string;
  doneBy: string;
}
export type NewHandoverLineRecord = Omit<HandoverLineRecord, 'rowNumber'>;

function toHandoverRecord_(rowNumber: number, data: RowData): HandoverRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    number: (data.number ?? '').trim(),
    locationId: (data.location_id ?? '').trim(),
    customerId: (data.customer_id ?? '').trim(),
    customerName: data.customer_name ?? '',
    note: data.note ?? '',
    status: (data.status ?? '').trim() === 'cancelled' ? 'cancelled' : 'open',
    createdAt: data.created_at ?? '',
    createdBy: data.created_by ?? '',
    updatedAt: data.updated_at ?? '',
    updatedBy: data.updated_by ?? '',
  };
}

function fromHandoverRecord_(handover: NewHandoverRecord): RowData {
  return {
    id: handover.id,
    number: handover.number,
    location_id: handover.locationId,
    customer_id: handover.customerId,
    customer_name: handover.customerName,
    note: handover.note,
    status: handover.status,
    created_at: handover.createdAt,
    created_by: handover.createdBy,
    updated_at: handover.updatedAt,
    updated_by: handover.updatedBy,
  };
}

function toHandoverLineRecord_(rowNumber: number, data: RowData): HandoverLineRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    handoverId: (data.handover_id ?? '').trim(),
    itemId: (data.item_id ?? '').trim(),
    itemLabel: data.item_label ?? '',
    qty: Number(data.qty) || 0,
    doneQty: Number(data.done_qty) || 0,
    doneAt: data.done_at ?? '',
    doneBy: data.done_by ?? '',
  };
}

function fromHandoverLineRecord_(line: NewHandoverLineRecord): RowData {
  return {
    id: line.id,
    handover_id: line.handoverId,
    item_id: line.itemId,
    item_label: line.itemLabel,
    qty: String(line.qty),
    done_qty: String(line.doneQty),
    done_at: line.doneAt,
    done_by: line.doneBy,
  };
}

export function listHandovers_(): HandoverRecord[] {
  return readTable_(HANDOVERS_TABLE)
    .rows.map(({ rowNumber, data }) => toHandoverRecord_(rowNumber, data))
    .filter((handover) => handover.id !== '' && handover.number !== '');
}

export function insertHandover_(handover: NewHandoverRecord): void {
  insertRow_(HANDOVERS_TABLE, fromHandoverRecord_(handover));
}

export function updateHandover_(handover: HandoverRecord): void {
  updateRow_(HANDOVERS_TABLE, handover.rowNumber, fromHandoverRecord_(handover));
}

export function listHandoverLines_(): HandoverLineRecord[] {
  return readTable_(HANDOVER_LINES_TABLE)
    .rows.map(({ rowNumber, data }) => toHandoverLineRecord_(rowNumber, data))
    .filter((line) => line.id !== '' && line.handoverId !== '');
}

export function insertHandoverLine_(line: NewHandoverLineRecord): void {
  insertRow_(HANDOVER_LINES_TABLE, fromHandoverLineRecord_(line));
}

export function updateHandoverLine_(line: HandoverLineRecord): void {
  updateRow_(HANDOVER_LINES_TABLE, line.rowNumber, fromHandoverLineRecord_(line));
}

/**
 * Menghapus baris sheet: nomor baris di bawahnya bergeser, jadi hapus beberapa baris dari nomor TERBESAR ke
 * terkecil (urutkan menurun) dan jangan memakai `rowNumber` hasil baca sebelumnya setelah ada penghapusan.
 */
export function deleteHandoverLine_(line: HandoverLineRecord): void {
  deleteRow_(HANDOVER_LINES_TABLE, line.rowNumber);
}
```

- [ ] **Step 5: Validator, layanan baca, dan rute**

`gas/src/modules/handover/validate.ts`:

```ts
import { appError_ } from '@gas/core/errors';
import { readObject_ } from '@gas/core/validate';
import type { GetHandoverInput, ListHandoversInput } from '@shared/rpc';

const MAX_LOCATION_IDS = 50;

/** `locationIds` (≥ 1, ≤ 50, teks tak kosong) — router sudah memeriksa izinnya; di sini bentuknya. */
export function validateLocationIds_(raw: unknown): string[] {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const value = source.locationIds;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_LOCATION_IDS ||
    !value.every((id) => typeof id === 'string' && id.trim() !== '')
  ) {
    throw appError_('VALIDATION', 'Lokasi wajib diisi', { locationIds: 'Lokasi wajib diisi' });
  }
  return [...new Set((value as string[]).map((id) => id.trim()))];
}

export function validateListHandovers_(raw: unknown): ListHandoversInput {
  return { locationIds: validateLocationIds_(raw) };
}

export function validateGetHandover_(raw: unknown): GetHandoverInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id, locationIds: validateLocationIds_(raw) };
}
```

`gas/src/modules/handover/service.ts`:

```ts
import { appError_ } from '@gas/core/errors';
import { listLocations_ } from '@gas/modules/access/repo';
import { listCustomers_ } from '@gas/modules/customer/repo';
import { brandNameMap_ } from '@gas/modules/item/service';
import { listItems_ } from '@gas/modules/item/repo';
import { deriveHandoverStatus, progressTotals } from '@shared/handover';
import type {
  GetHandoverInput,
  HandoverDto,
  HandoverOptionsDto,
  HandoverSummaryDto,
} from '@shared/rpc';
import type { HandoverLineRecord, HandoverRecord } from './repo';
import { listHandoverLines_, listHandovers_ } from './repo';

/** Nama customer terkini menurut id (salinan pada task dipakai bila customer tidak ada). */
export function customerNameMap_(): Map<string, string> {
  return new Map(listCustomers_().map((customer) => [customer.id, customer.name]));
}

export function locationNameMap_(): Map<string, string> {
  return new Map(listLocations_().map((location) => [location.id, location.name]));
}

function toHandoverSummaryDto_(
  handover: HandoverRecord,
  lines: readonly HandoverLineRecord[],
  customerNames: ReadonlyMap<string, string>,
): HandoverSummaryDto {
  const totals = progressTotals(lines);
  return {
    id: handover.id,
    number: handover.number,
    locationId: handover.locationId,
    customerId: handover.customerId,
    customerName: customerNames.get(handover.customerId) ?? handover.customerName,
    note: handover.note,
    status: deriveHandoverStatus(handover.status, lines),
    lineCount: lines.length,
    doneUnits: totals.done,
    totalUnits: totals.total,
    createdAt: handover.createdAt,
    updatedAt: handover.updatedAt,
  };
}

export function toHandoverDto_(
  handover: HandoverRecord,
  lines: readonly HandoverLineRecord[],
  customerNames: ReadonlyMap<string, string>,
): HandoverDto {
  return {
    ...toHandoverSummaryDto_(handover, lines, customerNames),
    lines: lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      itemLabel: line.itemLabel,
      qty: line.qty,
      doneQty: line.doneQty,
      doneAt: line.doneAt,
      doneBy: line.doneBy,
    })),
    createdBy: handover.createdBy,
    updatedBy: handover.updatedBy,
  };
}

function linesByHandover_(): Map<string, HandoverLineRecord[]> {
  const grouped = new Map<string, HandoverLineRecord[]>();
  for (const line of listHandoverLines_()) {
    const list = grouped.get(line.handoverId) ?? [];
    list.push(line);
    grouped.set(line.handoverId, list);
  }
  return grouped;
}

/** Task di lokasi yang diizinkan (`locationIds` dari `ctx`), terbaru dulu. */
export function listHandoverSummaries_(locationIds: readonly string[]): HandoverSummaryDto[] {
  const grouped = linesByHandover_();
  const names = customerNameMap_();
  return listHandovers_()
    .filter((handover) => locationIds.includes(handover.locationId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number.localeCompare(a.number))
    .map((handover) => toHandoverSummaryDto_(handover, grouped.get(handover.id) ?? [], names));
}

/**
 * Detail satu task. Lokasi baris task HARUS salah satu `locationIds` yang diizinkan router; bila tidak
 * (task milik lokasi lain), `NOT_FOUND` — izin ditegakkan di lokasi baris, bukan lokasi yang diklaim klien.
 */
export function getHandoverDto_(
  input: GetHandoverInput,
  locationIds: readonly string[],
): HandoverDto {
  const handover = listHandovers_().find((row) => row.id === input.id);
  if (!handover || !locationIds.includes(handover.locationId)) {
    throw appError_('NOT_FOUND', 'Task tidak ditemukan');
  }
  const lines = listHandoverLines_().filter((line) => line.handoverId === handover.id);
  return toHandoverDto_(handover, lines, customerNameMap_());
}

/** Item dan customer aktif untuk saran di form task (diambil lewat izin serah terima, bukan izin item). */
export function handoverOptions_(): HandoverOptionsDto {
  const brands = brandNameMap_();
  return {
    items: listItems_()
      .filter((item) => item.status === 'active')
      .map((item) => ({
        id: item.id,
        brand: brands.get(item.brandId) ?? '',
        model: item.model,
        aliases: [...item.aliases],
      }))
      .sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model)),
    customers: listCustomers_()
      .filter((customer) => customer.status === 'active')
      .map((customer) => ({ id: customer.id, name: customer.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
```

`gas/src/modules/handover/routes.ts`:

```ts
import type { RouteTable } from '@gas/core/router';
import { getHandoverDto_, handoverOptions_, listHandoverSummaries_ } from './service';
import { validateGetHandover_, validateListHandovers_ } from './validate';

type HandoverReadMethod = 'handovers.options' | 'handovers.list' | 'handovers.get';

/** WH (handover view ke atas) atau QC (qc edit) boleh membaca; izin diperiksa per lokasi yang diminta. */
const READ_PERMISSION = {
  anyOf: [
    { module: 'handover', level: 'view', scope: 'location' },
    { module: 'qc', level: 'edit', scope: 'location' },
  ],
} as const;

export function handoverReadRoutes_(): Pick<RouteTable, HandoverReadMethod> {
  return {
    'handovers.options': {
      permission: READ_PERMISSION,
      validate: validateListHandovers_,
      handler: () => handoverOptions_(),
    },
    'handovers.list': {
      permission: READ_PERMISSION,
      validate: validateListHandovers_,
      handler: (_input, ctx) => listHandoverSummaries_(ctx.locationIds),
    },
    'handovers.get': {
      permission: READ_PERMISSION,
      validate: validateGetHandover_,
      handler: (input, ctx) => getHandoverDto_(input, ctx.locationIds),
    },
  };
}
```

`gas/src/routes.ts`: impor `handoverReadRoutes_` dan tambahkan `...handoverReadRoutes_()`. `gas/src/setup.ts`: tambahkan `HANDOVERS_TABLE`, `HANDOVER_LINES_TABLE` ke daftar tabel (setelah `CUSTOMERS_TABLE`).

> Task 5 menambahkan rute tulis dan mengganti pendaftaran di `routes.ts` menjadi satu `handoverRoutes_()`; sampai saat itu `getRoutes_` masih belum lengkap dan `typecheck` gas merah (diharapkan).

- [ ] **Step 6: Jalankan tes**

Run: `bun run --cwd gas test`
Expected: tes baca lulus. Bila tes izin gagal karena user fixture tidak punya penugasan yang dimaksud, periksa `seedHandoverEnv` (setiap `assign` memakai `locationId` sebenarnya).

- [ ] **Step 7: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas
git add gas
git commit -m "feat(handover): sheet task dan baris, rute baca (opsi, daftar, detail) dengan izin per lokasi" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Simpan task (buat/ubah) dan batalkan — nomor otomatis, customer inline, aturan ubah, audit

**Files:**
- Modify: `gas/src/modules/handover/validate.ts`, `service.ts`, `routes.ts`, `gas/src/routes.ts`
- Create: `gas/src/modules/handover/handover-write.test.ts`

**Interfaces:**
- Consumes: Task 1 (`dateKeyOf`, `handoverNumber`, `nextHandoverSequence`, `deriveHandoverStatus`, `HANDOVER_LIMITS`), Task 2 (`resolveCustomerByName_`, `validateCustomerName_`), Task 3, `brandNameMap_`, `appendAudit_`, `ActorRef`.
- Produces:
  - `validate.ts`: `validateSaveHandover_`, `validateHandoverRef_`.
  - `service.ts`: `handoverSnapshot_(handover, lines, names)`, `loadHandoverForWrite_(ref)` (**pemanggil memegang lock**), `saveHandover_(input, actor)`, `cancelHandover_(input, actor)`.
  - Rute `handovers.save` (`handover: edit`) dan `handovers.cancel` (`handover: manage`), keduanya `scope: 'location'` dengan `locationId`.

- [ ] **Step 1: Tulis tes yang gagal** — `gas/src/modules/handover/handover-write.test.ts`

```ts
import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { insertCustomer_, listCustomers_ } from '@gas/modules/customer/repo';
import { customer, handover, handoverLine } from '@gas-test/handover-fixtures';
import { ENV, rpc, seedHandoverEnv } from '@gas-test/handover-env';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { insertHandover_, insertHandoverLine_, listHandoverLines_, listHandovers_ } from './repo';

let clock = Date.parse('2026-10-15T03:00:00.000Z');

beforeEach(() => {
  clock = Date.parse('2026-10-15T03:00:00.000Z');
  setPlatform_(
    createMemoryPlatform({
      properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
      now: () => clock,
    }),
  );
  seedHandoverEnv();
});

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = (email: string, method: string, payload: unknown) => rpc(email, method, payload) as Result;
const save = (payload: Record<string, unknown>, email = 'wh@gmail.com') =>
  call(email, 'handovers.save', {
    locationId: ENV.locA,
    customerName: 'PT Maju',
    note: '',
    lines: [{ itemId: ENV.itemA, qty: 5 }],
    ...payload,
  });
const audits = () => listAuditRecords_().map((r) => r.action);

test('membuat task: nomor ST-YYYYMMDD-001, label baris disalin, status Baru, audit create setelah customer.create', () => {
  const out = save({ note: 'catatan', lines: [{ itemId: ENV.itemA, qty: 5 }, { itemId: ENV.itemB, qty: 2 }] });
  expect(out.ok).toBe(true);
  expect(out.data).toMatchObject({
    number: 'ST-20261015-001',
    locationId: ENV.locA,
    customerName: 'PT Maju',
    note: 'catatan',
    status: 'new',
    totalUnits: 7,
    doneUnits: 0,
    createdBy: 'wh@gmail.com',
  });
  expect(out.data.lines.map((l: { itemLabel: string; qty: number }) => `${l.itemLabel} × ${l.qty}`)).toEqual([
    'Ubiquiti ES 24 × 5',
    'Mikrotik hAP ac2 × 2',
  ]);
  expect(audits()).toEqual(['customer.create', 'handover.create']);
  const created = listAuditRecords_().at(-1);
  expect(created).toMatchObject({ actor: 'wh@gmail.com', target: 'ST-20261015-001', before: null });
  expect(created?.after).toMatchObject({
    number: 'ST-20261015-001',
    location: 'Lokasi A',
    customer: 'PT Maju',
    status: 'new',
    lines: ['Ubiquiti ES 24 × 5', 'Mikrotik hAP ac2 × 2'],
  });
});

test('nomor urut per hari WIB: 001, 002; hari baru mulai 001; dibatalkan tidak menggandakan nomor', () => {
  expect(save({}).data.number).toBe('ST-20261015-001');
  const second = save({ lines: [{ itemId: ENV.itemB, qty: 1 }] });
  expect(second.data.number).toBe('ST-20261015-002');
  expect(call('wh@gmail.com', 'handovers.cancel', { id: second.data.id, locationId: ENV.locA }).ok).toBe(true);
  expect(save({ lines: [{ itemId: ENV.itemA, qty: 1 }] }).data.number).toBe('ST-20261015-003');
  clock = Date.parse('2026-10-15T17:00:00.000Z'); // 00:00 WIB hari berikutnya
  expect(save({}).data.number).toBe('ST-20261016-001');
});

test('customer inline: varian ejaan memakai customer yang ada (ejaan resmi menang); tidak ada duplikat', () => {
  save({ customerName: 'PT Maju Jaya' });
  const out = save({ customerName: ' pt. maju  JAYA ' });
  expect(out.data.customerName).toBe('PT Maju Jaya');
  expect(listCustomers_()).toHaveLength(1);
  expect(audits().filter((a) => a === 'customer.create')).toHaveLength(1);
});

test('customer nonaktif ditolak pada task baru (pesan di customerName) tanpa membuat apa pun', () => {
  insertCustomer_(customer('Lama', { status: 'inactive' }));
  const out = save({ customerName: 'lama' });
  expect(out.error).toMatchObject({ code: 'VALIDATION', fields: { customerName: expect.stringContaining('dinonaktifkan') } });
  expect(listHandovers_()).toHaveLength(0);
});

test('validasi: customer, catatan, baris, qty, duplikat, item tak dikenal atau nonaktif; tidak ada customer yatim', () => {
  const fields = (over: Record<string, unknown>) => save(over).error.fields as Record<string, string>;
  expect(fields({ customerName: '' }).customerName).toBe('Wajib diisi');
  expect(fields({ customerName: '--' }).customerName).toBe('Nama customer harus memuat huruf atau angka');
  expect(fields({ note: 'x'.repeat(501) }).note).toBe('Maksimal 500 karakter');
  expect(fields({ lines: [] }).lines).toBe('Minimal satu baris');
  expect(fields({ lines: 'x' }).lines).toBe('Harus berupa daftar baris');
  for (const qty of [0, -1, 1.5, 100_001, '3', null, Number.NaN]) {
    expect(fields({ lines: [{ itemId: ENV.itemA, qty }] }).lines).toBe('Baris 1: qty harus bilangan bulat 1–100000');
  }
  expect(fields({ lines: [{ itemId: ENV.itemA, qty: 1 }, { itemId: ENV.itemA, qty: 2 }] }).lines).toBe(
    'Baris 2: tipe yang sama sudah ada di baris 1',
  );
  expect(fields({ lines: [{ itemId: 'tidak-ada', qty: 1 }] }).lines).toBe('Baris 1: tipe tidak ditemukan');
  expect(fields({ lines: [{ itemId: ENV.itemOff, qty: 1 }] }).lines).toContain('dinonaktifkan');
  expect(fields({ lines: Array.from({ length: 101 }, (_, i) => ({ itemId: `x${i}`, qty: 1 })) }).lines).toBe('Maksimal 100 baris');
  expect(listCustomers_()).toHaveLength(0);
  expect(listHandovers_()).toHaveLength(0);
});

test('izin per lokasi: WH loc-a tidak bisa menyimpan ke loc-b; QC (qc edit saja) dan viewer tidak bisa menyimpan; lokasi nonaktif/tak dikenal', () => {
  expect(save({ locationId: ENV.locB }).error.code).toBe('FORBIDDEN');
  expect(save({}, 'qc@gmail.com').error.code).toBe('FORBIDDEN');
  expect(save({}, 'viewer@gmail.com').error.code).toBe('FORBIDDEN');
  expect(save({ locationId: ENV.locOff }, 'multi@gmail.com').error.code).toBe('FORBIDDEN');
  expect(save({ locationId: 'loc-zzz' }).error.code).toBe('FORBIDDEN');
  expect(save({ locationId: ENV.locB }, 'multi@gmail.com').ok).toBe(true);
  expect(listHandovers_()).toHaveLength(1);
});

function seedTask(over: { status?: 'open' | 'cancelled'; locationId?: string; doneA?: number } = {}) {
  insertCustomer_(customer('PT Maju'));
  insertHandover_(handover({ id: 't1', number: 'ST-20261015-001', locationId: over.locationId ?? ENV.locA, status: over.status ?? 'open' }));
  insertHandoverLine_(handoverLine({ id: 'la', handoverId: 't1', itemId: ENV.itemA, qty: 5, doneQty: over.doneA ?? 0, doneAt: over.doneA ? '2026-10-15T01:00:00.000Z' : '', doneBy: over.doneA ? 'qc@gmail.com' : '' }));
  insertHandoverLine_(handoverLine({ id: 'lb', handoverId: 't1', itemId: ENV.itemB, itemLabel: 'Mikrotik hAP ac2', qty: 3 }));
}

test('ubah task: qty, catatan, baris baru, baris tanpa progres dihapus; audit update dengan before/after; tanpa perubahan = tanpa audit', () => {
  seedTask();
  const same = save({ id: 't1', lines: [{ itemId: ENV.itemA, qty: 5 }, { itemId: ENV.itemB, qty: 3 }] });
  expect(same.ok).toBe(true);
  expect(audits()).toEqual([]);
  const out = save({ id: 't1', note: 'revisi', lines: [{ itemId: ENV.itemA, qty: 9 }] });
  expect(out.ok).toBe(true);
  expect(out.data).toMatchObject({ note: 'revisi', totalUnits: 9, lineCount: 1, updatedBy: 'wh@gmail.com' });
  expect(listHandoverLines_().map((l) => l.id)).toEqual(['la']);
  expect(audits()).toEqual(['handover.update']);
  const entry = listAuditRecords_().at(-1);
  expect(entry?.before).toMatchObject({ lines: ['Ubiquiti ES 24 × 5', 'Mikrotik hAP ac2 × 3'], note: '' });
  expect(entry?.after).toMatchObject({ lines: ['Ubiquiti ES 24 × 9'], note: 'revisi' });
});

test('ubah task: qty di bawah qty selesai ditolak; baris ber-progres tidak dapat dihapus; pesan di field lines', () => {
  seedTask({ doneA: 3 });
  const below = save({ id: 't1', lines: [{ itemId: ENV.itemA, qty: 2 }, { itemId: ENV.itemB, qty: 3 }] });
  expect(below.error).toMatchObject({ code: 'VALIDATION', fields: { lines: expect.stringContaining('di bawah qty selesai (3)') } });
  const removed = save({ id: 't1', lines: [{ itemId: ENV.itemB, qty: 3 }] });
  expect(removed.error).toMatchObject({ code: 'VALIDATION', fields: { lines: expect.stringContaining('sudah ada progres') } });
  expect(listHandoverLines_()).toHaveLength(2);
  expect(save({ id: 't1', lines: [{ itemId: ENV.itemA, qty: 3 }, { itemId: ENV.itemB, qty: 3 }] }).ok).toBe(true); // tepat sama dengan selesai
});

test('item nonaktif boleh tetap di baris lama tetapi tidak sebagai baris baru', () => {
  seedTask();
  insertHandoverLine_(handoverLine({ id: 'loff', handoverId: 't1', itemId: ENV.itemOff, itemLabel: 'Ubiquiti Lama', qty: 1 }));
  const keep = save({ id: 't1', lines: [{ itemId: ENV.itemA, qty: 5 }, { itemId: ENV.itemB, qty: 3 }, { itemId: ENV.itemOff, qty: 2 }] });
  expect(keep.ok).toBe(true);
  expect(keep.data.lines.find((l: { itemId: string }) => l.itemId === ENV.itemOff).qty).toBe(2);
});

test('ubah task: task Dibatalkan tidak dapat diubah (CONFLICT)', () => {
  seedTask({ status: 'cancelled' });
  expect(save({ id: 't1' }).error).toMatchObject({ code: 'CONFLICT', message: 'Task sudah dibatalkan dan tidak dapat diubah' });
});

test('task Selesai tidak dapat diubah; task milik lokasi lain tidak ditemukan walau user punya izin di lokasi yang diklaim', () => {
  insertCustomer_(customer('PT Maju'));
  insertHandover_(handover({ id: 'done', number: 'ST-20261015-001', locationId: ENV.locA }));
  insertHandoverLine_(handoverLine({ id: 'ld', handoverId: 'done', itemId: ENV.itemA, qty: 2, doneQty: 2 }));
  expect(save({ id: 'done' }).error).toMatchObject({ code: 'CONFLICT' });
  insertHandover_(handover({ id: 'inb', number: 'ST-20261015-002', locationId: ENV.locB }));
  insertHandoverLine_(handoverLine({ id: 'lb2', handoverId: 'inb', itemId: ENV.itemA, qty: 2 }));
  // multi@ boleh menulis di A dan B; mengklaim A untuk task milik B → NOT_FOUND
  expect(save({ id: 'inb', locationId: ENV.locA }, 'multi@gmail.com').error.code).toBe('NOT_FOUND');
  expect(save({ id: 'tidak-ada' }).error.code).toBe('NOT_FOUND');
});

test('ubah customer task memakai customer inline; customer nonaktif yang sudah dipakai task itu tetap boleh', () => {
  insertCustomer_(customer('PT Maju', { status: 'inactive' }));
  insertHandover_(handover({ id: 't1', number: 'ST-20261015-001', locationId: ENV.locA }));
  insertHandoverLine_(handoverLine({ id: 'la', handoverId: 't1', itemId: ENV.itemA, qty: 5 }));
  expect(save({ id: 't1', note: 'x' }).ok).toBe(true); // tetap PT Maju (nonaktif) karena sudah dipakai
  const moved = save({ id: 't1', customerName: 'Customer Baru', note: 'x' });
  expect(moved.data.customerName).toBe('Customer Baru');
  expect(audits()).toContain('customer.create');
});

test('batalkan: WH manage; edit-saja ditolak; idempoten; task Selesai tidak dapat dibatalkan; audit handover.cancel', () => {
  seedTask({ doneA: 2 });
  const ref = { id: 't1', locationId: ENV.locA };
  expect(call('whedit@gmail.com', 'handovers.cancel', ref).error.code).toBe('FORBIDDEN');
  expect(call('qc@gmail.com', 'handovers.cancel', ref).error.code).toBe('FORBIDDEN');
  const out = call('wh@gmail.com', 'handovers.cancel', ref);
  expect(out.data.status).toBe('cancelled');
  expect(audits()).toEqual(['handover.cancel']);
  expect(listAuditRecords_().at(-1)).toMatchObject({ before: { status: 'in_progress' }, after: { status: 'cancelled' } });
  const again = call('wh@gmail.com', 'handovers.cancel', ref);
  expect(again.data.status).toBe('cancelled');
  expect(audits()).toEqual(['handover.cancel']); // idempoten: tidak mencatat lagi
  expect(call('wh@gmail.com', 'handovers.cancel', { id: 't1', locationId: ENV.locB }).error.code).toBe('FORBIDDEN');
});

test('batalkan: task Selesai CONFLICT; task lokasi lain NOT_FOUND', () => {
  insertCustomer_(customer('PT Maju'));
  insertHandover_(handover({ id: 'done', number: 'ST-20261015-001', locationId: ENV.locA }));
  insertHandoverLine_(handoverLine({ id: 'ld', handoverId: 'done', itemId: ENV.itemA, qty: 2, doneQty: 2 }));
  expect(call('wh@gmail.com', 'handovers.cancel', { id: 'done', locationId: ENV.locA }).error.code).toBe('CONFLICT');
  insertHandover_(handover({ id: 'inb', number: 'ST-20261015-002', locationId: ENV.locB }));
  expect(call('multi@gmail.com', 'handovers.cancel', { id: 'inb', locationId: ENV.locA }).error.code).toBe('NOT_FOUND');
});
```

Perbarui `gas/src/routes.test.ts`: tambahkan `'handovers.cancel'` dan `'handovers.save'`; dan asersi `routes['handovers.save'].permission` = `{ module: 'handover', level: 'edit', scope: 'location' }`, `routes['handovers.cancel'].permission` = `{ module: 'handover', level: 'manage', scope: 'location' }`.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test handover-write`
Expected: FAIL — `handovers.save` belum terdaftar.

- [ ] **Step 3: Validator** — tambahkan ke `gas/src/modules/handover/validate.ts` (impor tambahan di atas berkas)

```ts
import { HANDOVER_LIMITS } from '@shared/handover';
import type { HandoverRefInput, SaveHandoverInput, SaveHandoverLineInput } from '@shared/rpc';
import { validateCustomerName_ } from '@gas/modules/customer/validate';

function readHandoverLines_(value: unknown): { lines: SaveHandoverLineInput[]; error: string | null } {
  if (!Array.isArray(value)) return { lines: [], error: 'Harus berupa daftar baris' };
  if (value.length === 0) return { lines: [], error: 'Minimal satu baris' };
  if (value.length > HANDOVER_LIMITS.lines) {
    return { lines: [], error: `Maksimal ${HANDOVER_LIMITS.lines} baris` };
  }
  const lines: SaveHandoverLineInput[] = [];
  const firstRow = new Map<string, number>();
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    const source = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const itemId = typeof source.itemId === 'string' ? source.itemId.trim() : '';
    const qty = source.qty;
    if (itemId === '' || itemId.length > 100) return { lines: [], error: `Baris ${i + 1}: tipe wajib dipilih` };
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > HANDOVER_LIMITS.qtyMax) {
      return { lines: [], error: `Baris ${i + 1}: qty harus bilangan bulat 1–${HANDOVER_LIMITS.qtyMax}` };
    }
    const seen = firstRow.get(itemId);
    if (seen !== undefined) {
      return { lines: [], error: `Baris ${i + 1}: tipe yang sama sudah ada di baris ${seen}` };
    }
    firstRow.set(itemId, i + 1);
    lines.push({ itemId, qty });
  }
  return { lines, error: null };
}

export function validateSaveHandover_(raw: unknown): SaveHandoverInput {
  const reader = readObject_(raw);
  const id = reader.optionalId('id');
  const locationId = reader.str('locationId', { required: true, max: 100 });
  const note = reader.str('note', { max: HANDOVER_LIMITS.note });
  const source = reader.raw('customerName');
  let customerName = '';
  try {
    customerName = validateCustomerName_({ customerName: source }, 'customerName');
  } catch (error) {
    const fields = (error as { fields?: Record<string, string> }).fields;
    if (fields?.customerName) reader.fail('customerName', fields.customerName);
    else throw error;
  }
  const { lines, error } = readHandoverLines_(reader.raw('lines'));
  if (error) reader.fail('lines', error);
  reader.done();
  const input = { locationId, customerName, note, lines };
  return id ? { id, ...input } : input;
}

export function validateHandoverRef_(raw: unknown): HandoverRefInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const locationId = reader.str('locationId', { required: true, max: 100 });
  reader.done();
  return { id, locationId };
}
```

(Gabungkan impor di atas berkas; `appError_` sudah diimpor. `validateCustomerName_` melempar `AppError` dengan `fields`; dibungkus agar galat customer bergabung dengan galat field lain.)

- [ ] **Step 4: Layanan** — tambahkan ke `gas/src/modules/handover/service.ts` (impor tambahan di atas berkas)

```ts
import type { ActorRef } from '@gas/core/actor';
import { platform_ } from '@gas/core/platform';
import { appendAudit_ } from '@gas/modules/access/repo';
import { nowIso_ } from '@gas/modules/access/service';
import { resolveCustomerByName_ } from '@gas/modules/customer/service';
import {
  dateKeyOf,
  HANDOVER_LIMITS,
  handoverNumber,
  nextHandoverSequence,
} from '@shared/handover';
import type { HandoverRefInput, SaveHandoverInput } from '@shared/rpc';
import type { NewHandoverLineRecord } from './repo';
import {
  deleteHandoverLine_,
  insertHandover_,
  insertHandoverLine_,
  updateHandover_,
  updateHandoverLine_,
} from './repo';

interface SnapshotHandover {
  number: string;
  locationId: string;
  customerName: string;
  note: string;
  status: HandoverRecord['status'];
}

/** Snapshot audit: daftar baris sebagai teks per entri agar diff audit membandingkan per baris. */
export function handoverSnapshot_(
  handover: SnapshotHandover,
  lines: ReadonlyArray<{ itemLabel: string; qty: number; doneQty: number }>,
  locationNames: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    number: handover.number,
    location: locationNames.get(handover.locationId) ?? handover.locationId,
    customer: handover.customerName,
    note: handover.note,
    status: deriveHandoverStatus(handover.status, lines),
    lines: lines.map(
      (line) => `${line.itemLabel} × ${line.qty}${line.doneQty > 0 ? ` (selesai ${line.doneQty})` : ''}`,
    ),
  };
}

/**
 * Memuat task untuk ditulis. `NOT_FOUND` bila id tak ada ATAU lokasinya bukan `locationId` yang sudah diizinkan
 * router (izin ditegakkan lagi di lokasi baris). PEMANGGIL WAJIB memegang lock.
 */
export function loadHandoverForWrite_(ref: HandoverRefInput): {
  handover: HandoverRecord;
  lines: HandoverLineRecord[];
} {
  const handover = listHandovers_().find((row) => row.id === ref.id);
  if (!handover || handover.locationId !== ref.locationId) {
    throw appError_('NOT_FOUND', 'Task tidak ditemukan');
  }
  const lines = listHandoverLines_().filter((line) => line.handoverId === handover.id);
  return { handover, lines };
}

/** Task Selesai/Dibatalkan tidak dapat diubah (WH maupun QC). */
export function assertHandoverOpen_(
  handover: HandoverRecord,
  lines: readonly HandoverLineRecord[],
): void {
  const status = deriveHandoverStatus(handover.status, lines);
  if (status === 'cancelled') {
    throw appError_('CONFLICT', 'Task sudah dibatalkan dan tidak dapat diubah');
  }
  if (status === 'done') {
    throw appError_('CONFLICT', 'Task sudah selesai dan tidak dapat diubah');
  }
}

function lineError_(message: string): never {
  throw appError_('VALIDATION', message, { lines: message });
}

export function saveHandover_(input: SaveHandoverInput, actor: ActorRef): HandoverDto {
  return platform_().withLock(() => {
    const loaded = input.id ? loadHandoverForWrite_({ id: input.id, locationId: input.locationId }) : null;
    if (loaded) assertHandoverOpen_(loaded.handover, loaded.lines);
    const existingLines = loaded?.lines ?? [];
    const items = new Map(listItems_().map((item) => [item.id, item]));
    const brands = brandNameMap_();
    const label = (itemId: string): string => {
      const item = items.get(itemId);
      return item ? `${brands.get(item.brandId) ?? ''} ${item.model}`.trim() : itemId;
    };

    // Validasi baris SEBELUM menulis apa pun (termasuk membuat customer).
    const byItem = new Map(existingLines.map((line) => [line.itemId, line]));
    input.lines.forEach((line, index) => {
      const item = items.get(line.itemId);
      if (!item) lineError_(`Baris ${index + 1}: tipe tidak ditemukan`);
      const current = byItem.get(line.itemId);
      if (!current && item.status !== 'active') {
        lineError_(`Baris ${index + 1}: tipe ${label(line.itemId)} dinonaktifkan`);
      }
      if (current && line.qty < current.doneQty) {
        lineError_(
          `${current.itemLabel}: qty target tidak boleh di bawah qty selesai (${current.doneQty})`,
        );
      }
    });
    const wanted = new Set(input.lines.map((line) => line.itemId));
    for (const current of existingLines) {
      if (!wanted.has(current.itemId) && current.doneQty > 0) {
        lineError_(`${current.itemLabel} sudah ada progres dan tidak dapat dihapus`);
      }
    }

    const customer = resolveCustomerByName_(input.customerName, actor, loaded?.handover.customerId);
    const locationNames = locationNameMap_();
    const now = nowIso_();

    if (!loaded) {
      const handovers = listHandovers_();
      const sequence = nextHandoverSequence(
        handovers.map((row) => row.number),
        dateKeyOf(platform_().now()),
      );
      const created = {
        id: platform_().uuid(),
        number: handoverNumber(dateKeyOf(platform_().now()), sequence),
        locationId: input.locationId,
        customerId: customer.id,
        customerName: customer.name,
        note: input.note,
        status: 'open' as const,
        createdAt: now,
        createdBy: actor.email,
        updatedAt: now,
        updatedBy: actor.email,
      };
      insertHandover_(created);
      const lines: NewHandoverLineRecord[] = input.lines.map((line) => ({
        id: platform_().uuid(),
        handoverId: created.id,
        itemId: line.itemId,
        itemLabel: label(line.itemId),
        qty: line.qty,
        doneQty: 0,
        doneAt: '',
        doneBy: '',
      }));
      for (const line of lines) insertHandoverLine_(line);
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'handover.create',
        target: created.number,
        before: null,
        after: handoverSnapshot_(created, lines, locationNames),
      });
      return toHandoverDto_(
        { ...created, rowNumber: 0 },
        lines.map((line) => ({ ...line, rowNumber: 0 })),
        customerNameMap_(),
      );
    }

    const { handover, lines: oldLines } = loaded;
    const before = handoverSnapshot_(handover, oldLines, locationNames);
    // Hitung hasil akhir baris (tanpa menulis) untuk mendeteksi "tidak ada perubahan".
    const nextLines = input.lines.map((line) => {
      const current = byItem.get(line.itemId);
      return {
        itemId: line.itemId,
        itemLabel: current?.itemLabel ?? label(line.itemId),
        qty: line.qty,
        doneQty: current?.doneQty ?? 0,
      };
    });
    const nextHandover = { ...handover, customerId: customer.id, customerName: customer.name, note: input.note };
    const after = handoverSnapshot_(nextHandover, nextLines, locationNames);
    if (JSON.stringify(before) === JSON.stringify(after) && customer.id === handover.customerId) {
      return toHandoverDto_(handover, oldLines, customerNameMap_());
    }

    updateHandover_({ ...nextHandover, updatedAt: now, updatedBy: actor.email });
    for (const line of input.lines) {
      const current = byItem.get(line.itemId);
      if (current) {
        if (current.qty !== line.qty) updateHandoverLine_({ ...current, qty: line.qty });
      } else {
        insertHandoverLine_({
          id: platform_().uuid(),
          handoverId: handover.id,
          itemId: line.itemId,
          itemLabel: label(line.itemId),
          qty: line.qty,
          doneQty: 0,
          doneAt: '',
          doneBy: '',
        });
      }
    }
    // Hapus dari nomor baris TERBESAR ke terkecil (nomor di bawahnya bergeser setelah tiap hapus).
    for (const removed of oldLines
      .filter((line) => !wanted.has(line.itemId))
      .sort((a, b) => b.rowNumber - a.rowNumber)) {
      deleteHandoverLine_(removed);
    }
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'handover.update',
      target: handover.number,
      before,
      after,
    });
    const fresh = loadHandoverForWrite_({ id: handover.id, locationId: handover.locationId });
    return toHandoverDto_(fresh.handover, fresh.lines, customerNameMap_());
  });
}

export function cancelHandover_(input: HandoverRefInput, actor: ActorRef): HandoverDto {
  return platform_().withLock(() => {
    const { handover, lines } = loadHandoverForWrite_(input);
    const status = deriveHandoverStatus(handover.status, lines);
    if (status === 'cancelled') return toHandoverDto_(handover, lines, customerNameMap_());
    if (status === 'done') {
      throw appError_('CONFLICT', 'Task yang sudah selesai tidak dapat dibatalkan');
    }
    const now = nowIso_();
    const updated: HandoverRecord = { ...handover, status: 'cancelled', updatedAt: now, updatedBy: actor.email };
    updateHandover_(updated);
    const names = locationNameMap_();
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'handover.cancel',
      target: handover.number,
      before: handoverSnapshot_(handover, lines, names),
      after: handoverSnapshot_(updated, lines, names),
    });
    return toHandoverDto_(updated, lines, customerNameMap_());
  });
}
```

(Gabungkan impor di atas berkas; `HANDOVER_LIMITS` boleh dihapus dari impor bila tidak dipakai. Biome akan menandai impor yang tidak terpakai — hapus.)

- [ ] **Step 5: Rute** — `gas/src/modules/handover/routes.ts`: tambahkan impor `cancelHandover_`, `saveHandover_` dan `validateHandoverRef_`, `validateSaveHandover_`, lalu ganti isi file menjadi satu `handoverRoutes_()` yang mengembalikan semua rute berikut (rute baca dari Task 3 dipertahankan di dalamnya; hapus `handoverReadRoutes_`), dan ubah `gas/src/routes.ts` memanggil `...handoverRoutes_()`:

```ts
type HandoverMethod =
  | 'handovers.options'
  | 'handovers.list'
  | 'handovers.get'
  | 'handovers.save'
  | 'handovers.cancel';

export function handoverRoutes_(): Pick<RouteTable, HandoverMethod> {
  return {
    // ... tiga rute baca dari Task 3, tidak berubah ...
    'handovers.save': {
      permission: { module: 'handover', level: 'edit', scope: 'location' },
      validate: validateSaveHandover_,
      handler: (input, ctx) => saveHandover_(input, ctx.user),
    },
    'handovers.cancel': {
      permission: { module: 'handover', level: 'manage', scope: 'location' },
      validate: validateHandoverRef_,
      handler: (input, ctx) => cancelHandover_(input, ctx.user),
    },
  };
}
```

Task 5 menambah tiga rute progres ke union dan objek ini.

- [ ] **Step 6: Jalankan tes**

Run: `bun run --cwd gas test`
Expected: lulus (typecheck gas masih merah sampai Task 5). Periksa khusus: tes "nomor urut" — `ST-20261015-003` setelah task kedua dibatalkan menandakan nomor tidak dipakai ulang; tes "ubah task" — `after.lines` hanya baris yang tersisa.

- [ ] **Step 7: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas
git add gas
git commit -m "feat(handover): simpan dan batalkan task — nomor otomatis, customer inline, aturan ubah, dan audit" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Pengerjaan QC — qty selesai, selesai per tipe, selesai per task

**Files:**
- Modify: `gas/src/modules/handover/validate.ts`, `service.ts`, `routes.ts`
- Create: `gas/src/modules/handover/handover-progress.test.ts`

**Interfaces:**
- Consumes: `loadHandoverForWrite_`, `assertHandoverOpen_`, `handoverSnapshot_`, `toHandoverDto_` (Task 3–4), `deriveHandoverStatus`.
- Produces: `validateSetProgress_`, `validateCompleteLine_`, `setProgress_`, `completeLine_`, `completeAll_`; rute `handovers.setProgress|completeLine|completeAll` (`qc: edit`, lokasi).

- [ ] **Step 1: Tulis tes yang gagal** — `gas/src/modules/handover/handover-progress.test.ts`

```ts
import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { insertCustomer_ } from '@gas/modules/customer/repo';
import { customer, handover, handoverLine } from '@gas-test/handover-fixtures';
import { ENV, rpc, seedHandoverEnv } from '@gas-test/handover-env';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { insertHandover_, insertHandoverLine_, listHandoverLines_ } from './repo';

beforeEach(() => {
  setPlatform_(
    createMemoryPlatform({
      properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
      now: () => Date.parse('2026-10-15T03:00:00.000Z'),
    }),
  );
  seedHandoverEnv();
  insertCustomer_(customer('PT Maju'));
  insertHandover_(handover({ id: 't1', number: 'ST-20261015-001', locationId: ENV.locA }));
  insertHandoverLine_(handoverLine({ id: 'la', handoverId: 't1', itemId: ENV.itemA, qty: 5 }));
  insertHandoverLine_(handoverLine({ id: 'lb', handoverId: 't1', itemId: ENV.itemB, itemLabel: 'Mikrotik hAP ac2', qty: 3 }));
});

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = (email: string, method: string, payload: unknown) => rpc(email, method, payload) as Result;
const ref = { id: 't1', locationId: ENV.locA };
const progress = (lineId: string, doneQty: unknown, email = 'qc@gmail.com') =>
  call(email, 'handovers.setProgress', { ...ref, lineId, doneQty });
const audits = () => listAuditRecords_().map((r) => r.action);
const doneOf = (lineId: string) => listHandoverLines_().find((l) => l.id === lineId)?.doneQty;

test('QC memperbarui qty selesai: baris, pelaku, waktu, status Dikerjakan, dan audit handover.progress', () => {
  const out = progress('la', 2);
  expect(out.ok).toBe(true);
  expect(out.data).toMatchObject({ status: 'in_progress', doneUnits: 2, totalUnits: 8 });
  const line = out.data.lines.find((l: { id: string }) => l.id === 'la');
  expect(line).toMatchObject({ doneQty: 2, doneBy: 'qc@gmail.com', doneAt: '2026-10-15T03:00:00.000Z' });
  expect(audits()).toEqual(['handover.progress']);
  expect(listAuditRecords_().at(-1)).toMatchObject({
    actor: 'qc@gmail.com',
    target: 'ST-20261015-001 · Ubiquiti ES 24',
    before: { item: 'Ubiquiti ES 24', doneQty: 0, qty: 5 },
    after: { item: 'Ubiquiti ES 24', doneQty: 2, qty: 5 },
  });
});

test('batas qty selesai: bilangan bulat 0..target; pecahan, negatif, NaN, string, di atas target ditolak', () => {
  for (const bad of [-1, 1.5, Number.NaN, '2', null, 6, 100_001]) {
    expect(progress('la', bad).error.code).toBe('VALIDATION');
  }
  expect(progress('la', 6).error.fields.doneQty).toContain('0–5');
  expect(doneOf('la')).toBe(0);
  expect(progress('la', 5).ok).toBe(true);
  expect(progress('la', 0).ok).toBe(true); // dapat diturunkan kembali
  expect(progress('tidak-ada', 1).error.code).toBe('NOT_FOUND');
});

test('nilai yang sama tidak menulis dan tidak mengaudit', () => {
  expect(progress('la', 0).ok).toBe(true);
  expect(audits()).toEqual([]);
  progress('la', 2);
  progress('la', 2);
  expect(audits()).toEqual(['handover.progress']);
});

test('selesai per tipe mengisi qty = target; diulang tidak mengaudit lagi', () => {
  const out = call('qc@gmail.com', 'handovers.completeLine', { ...ref, lineId: 'lb' });
  expect(out.data.lines.find((l: { id: string }) => l.id === 'lb').doneQty).toBe(3);
  expect(out.data.status).toBe('in_progress');
  call('qc@gmail.com', 'handovers.completeLine', { ...ref, lineId: 'lb' });
  expect(audits()).toEqual(['handover.progress']);
});

test('task menjadi Selesai tepat saat baris terakhir penuh: satu handover.complete', () => {
  progress('la', 5);
  expect(audits()).toEqual(['handover.progress']);
  const last = progress('lb', 3);
  expect(last.data.status).toBe('done');
  expect(audits()).toEqual(['handover.progress', 'handover.progress', 'handover.complete']);
  expect(listAuditRecords_().at(-1)).toMatchObject({
    action: 'handover.complete',
    target: 'ST-20261015-001',
    before: { status: 'in_progress' },
    after: { status: 'done' },
  });
});

test('selesai per task: hanya baris yang belum penuh diisi; satu handover.complete; diulang → CONFLICT', () => {
  progress('la', 5);
  const out = call('qc@gmail.com', 'handovers.completeAll', ref);
  expect(out.data).toMatchObject({ status: 'done', doneUnits: 8, totalUnits: 8 });
  expect(audits()).toEqual(['handover.progress', 'handover.complete']);
  expect(doneOf('lb')).toBe(3);
  expect(call('qc@gmail.com', 'handovers.completeAll', ref).error.code).toBe('CONFLICT');
});

test('FQ6: task Selesai atau Dibatalkan tidak dapat diubah QC (CONFLICT dengan pesan jelas)', () => {
  call('qc@gmail.com', 'handovers.completeAll', ref);
  const done = progress('la', 1);
  expect(done.error).toMatchObject({ code: 'CONFLICT', message: 'Task sudah selesai dan tidak dapat diubah' });
  expect(call('wh@gmail.com', 'handovers.cancel', ref).error.code).toBe('CONFLICT');

  insertHandover_(handover({ id: 'x', number: 'ST-20261015-002', locationId: ENV.locA, status: 'cancelled' }));
  insertHandoverLine_(handoverLine({ id: 'lx', handoverId: 'x', itemId: ENV.itemA, qty: 2 }));
  const cancelled = call('qc@gmail.com', 'handovers.setProgress', { id: 'x', locationId: ENV.locA, lineId: 'lx', doneQty: 1 });
  expect(cancelled.error).toMatchObject({ code: 'CONFLICT', message: 'Task sudah dibatalkan dan tidak dapat diubah' });
});

test('izin: WH (handover saja) dan viewer tidak bisa mengubah progres; QC bisa; lokasi lain/nonaktif ditolak', () => {
  for (const email of ['wh@gmail.com', 'whedit@gmail.com', 'viewer@gmail.com', 'noaccess@gmail.com']) {
    expect(progress('la', 1, email).error.code).toBe('FORBIDDEN');
  }
  // qc@ punya qc edit di loc-b juga, tetapi task t1 milik loc-a → NOT_FOUND saat mengklaim loc-b
  const other = call('qc@gmail.com', 'handovers.setProgress', { id: 't1', locationId: ENV.locB, lineId: 'la', doneQty: 1 });
  expect(other.error.code).toBe('NOT_FOUND');
  expect(call('qc@gmail.com', 'handovers.setProgress', { id: 't1', locationId: ENV.locOff, lineId: 'la', doneQty: 1 }).error.code).toBe('FORBIDDEN');
  expect(call('qc@gmail.com', 'handovers.completeAll', { id: 't1', locationId: ENV.locB }).error.code).toBe('NOT_FOUND');
  expect(doneOf('la')).toBe(0);
});

test('baris milik task lain tidak dapat diubah lewat id task ini', () => {
  insertHandover_(handover({ id: 't2', number: 'ST-20261015-002', locationId: ENV.locA }));
  insertHandoverLine_(handoverLine({ id: 'lz', handoverId: 't2', itemId: ENV.itemA, qty: 4 }));
  expect(progress('lz', 1).error.code).toBe('NOT_FOUND');
  expect(doneOf('lz')).toBe(0);
});
```

Perbarui `gas/src/routes.test.ts`: tambahkan `'handovers.completeAll'`, `'handovers.completeLine'`, `'handovers.setProgress'` ke daftar kunci terurut dan asersi izin `{ module: 'qc', level: 'edit', scope: 'location' }` untuk ketiganya.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test handover-progress`
Expected: FAIL — rute belum terdaftar.

- [ ] **Step 3: Validator** — tambahkan ke `validate.ts`

```ts
import type { CompleteLineInput, SetProgressInput } from '@shared/rpc';

export function validateSetProgress_(raw: unknown): SetProgressInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const locationId = reader.str('locationId', { required: true, max: 100 });
  const lineId = reader.str('lineId', { required: true, max: 100 });
  const doneQty = reader.raw('doneQty');
  if (
    typeof doneQty !== 'number' ||
    !Number.isInteger(doneQty) ||
    doneQty < 0 ||
    doneQty > HANDOVER_LIMITS.qtyMax
  ) {
    reader.fail('doneQty', `Harus bilangan bulat 0–${HANDOVER_LIMITS.qtyMax}`);
  }
  reader.done();
  return { id, locationId, lineId, doneQty: doneQty as number };
}

export function validateCompleteLine_(raw: unknown): CompleteLineInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const locationId = reader.str('locationId', { required: true, max: 100 });
  const lineId = reader.str('lineId', { required: true, max: 100 });
  reader.done();
  return { id, locationId, lineId };
}
```

- [ ] **Step 4: Layanan** — tambahkan ke `service.ts`

```ts
import type { CompleteLineInput, SetProgressInput } from '@shared/rpc';

/** Menulis satu baris progres + audit `handover.progress`; mengembalikan true bila ada perubahan. Dalam lock. */
function writeProgress_(
  handover: HandoverRecord,
  line: HandoverLineRecord,
  doneQty: number,
  actor: ActorRef,
  now: string,
): boolean {
  if (line.doneQty === doneQty) return false;
  updateHandoverLine_({ ...line, doneQty, doneAt: now, doneBy: actor.email });
  appendAudit_({
    ts: now,
    actor: actor.email,
    action: 'handover.progress',
    target: `${handover.number} · ${line.itemLabel}`,
    before: { item: line.itemLabel, doneQty: line.doneQty, qty: line.qty },
    after: { item: line.itemLabel, doneQty, qty: line.qty },
  });
  return true;
}

/** Setelah perubahan progres: catat `handover.complete` sekali bila task baru saja menjadi Selesai; kembalikan DTO. */
function finishProgress_(
  ref: HandoverRefInput,
  beforeStatus: ReturnType<typeof deriveHandoverStatus>,
  beforeSnapshot: Record<string, unknown>,
  changed: boolean,
  actor: ActorRef,
  now: string,
): HandoverDto {
  const fresh = loadHandoverForWrite_(ref);
  if (changed) {
    const touched: HandoverRecord = { ...fresh.handover, updatedAt: now, updatedBy: actor.email };
    updateHandover_(touched);
    fresh.handover = touched;
    const afterStatus = deriveHandoverStatus(touched.status, fresh.lines);
    if (afterStatus === 'done' && beforeStatus !== 'done') {
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'handover.complete',
        target: touched.number,
        before: beforeSnapshot,
        after: handoverSnapshot_(touched, fresh.lines, locationNameMap_()),
      });
    }
  }
  return toHandoverDto_(fresh.handover, fresh.lines, customerNameMap_());
}

export function setProgress_(input: SetProgressInput, actor: ActorRef): HandoverDto {
  return platform_().withLock(() => {
    const { handover, lines } = loadHandoverForWrite_(input);
    assertHandoverOpen_(handover, lines);
    const line = lines.find((row) => row.id === input.lineId);
    if (!line) throw appError_('NOT_FOUND', 'Baris tidak ditemukan');
    if (input.doneQty > line.qty) {
      const message = `Harus bilangan bulat 0–${line.qty}`;
      throw appError_('VALIDATION', message, { doneQty: message });
    }
    const now = nowIso_();
    const beforeStatus = deriveHandoverStatus(handover.status, lines);
    const beforeSnapshot = handoverSnapshot_(handover, lines, locationNameMap_());
    const changed = writeProgress_(handover, line, input.doneQty, actor, now);
    return finishProgress_(input, beforeStatus, beforeSnapshot, changed, actor, now);
  });
}

export function completeLine_(input: CompleteLineInput, actor: ActorRef): HandoverDto {
  const { id, locationId, lineId } = input;
  return platform_().withLock(() => {
    const { handover, lines } = loadHandoverForWrite_({ id, locationId });
    assertHandoverOpen_(handover, lines);
    const line = lines.find((row) => row.id === lineId);
    if (!line) throw appError_('NOT_FOUND', 'Baris tidak ditemukan');
    const now = nowIso_();
    const beforeStatus = deriveHandoverStatus(handover.status, lines);
    const beforeSnapshot = handoverSnapshot_(handover, lines, locationNameMap_());
    const changed = writeProgress_(handover, line, line.qty, actor, now);
    return finishProgress_({ id, locationId }, beforeStatus, beforeSnapshot, changed, actor, now);
  });
}

/** Selesai per task: semua baris yang belum penuh diisi penuh; satu audit `handover.complete` (bukan per baris). */
export function completeAll_(input: HandoverRefInput, actor: ActorRef): HandoverDto {
  return platform_().withLock(() => {
    const { handover, lines } = loadHandoverForWrite_(input);
    assertHandoverOpen_(handover, lines);
    const now = nowIso_();
    const names = locationNameMap_();
    const before = handoverSnapshot_(handover, lines, names);
    for (const line of lines) {
      if (line.doneQty < line.qty) {
        updateHandoverLine_({ ...line, doneQty: line.qty, doneAt: now, doneBy: actor.email });
      }
    }
    const touched: HandoverRecord = { ...handover, updatedAt: now, updatedBy: actor.email };
    updateHandover_(touched);
    const fresh = loadHandoverForWrite_(input);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'handover.complete',
      target: handover.number,
      before,
      after: handoverSnapshot_(fresh.handover, fresh.lines, names),
    });
    return toHandoverDto_(fresh.handover, fresh.lines, customerNameMap_());
  });
}
```

- [ ] **Step 5: Rute** — tambahkan tiga rute ke `handoverRoutes_()` (dan ke union `HandoverMethod`), impor `completeAll_, completeLine_, setProgress_` dan `validateCompleteLine_, validateHandoverRef_, validateSetProgress_`:

```ts
    'handovers.setProgress': {
      permission: { module: 'qc', level: 'edit', scope: 'location' },
      validate: validateSetProgress_,
      handler: (input, ctx) => setProgress_(input, ctx.user),
    },
    'handovers.completeLine': {
      permission: { module: 'qc', level: 'edit', scope: 'location' },
      validate: validateCompleteLine_,
      handler: (input, ctx) => completeLine_(input, ctx.user),
    },
    'handovers.completeAll': {
      permission: { module: 'qc', level: 'edit', scope: 'location' },
      validate: validateHandoverRef_,
      handler: (input, ctx) => completeAll_(input, ctx.user),
    },
```

- [ ] **Step 6: Jalankan semua tes gas, typecheck, dan build**

Run: `bun run --cwd shared test && bun run --cwd gas test && bun run --cwd gas typecheck && bun scripts/build-gas.ts`
Expected: lulus; **typecheck bersih** (kontrak `RpcContract` kini terpenuhi); build GAS lolos aturan nama global (`HANDOVERS_TABLE`, `listHandovers_`, `customerNameMap_`, `locationNameMap_`, `handoverSnapshot_`, `writeProgress_`, … unik).

- [ ] **Step 7: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas shared
git add gas shared
git commit -m "feat(handover): pengerjaan QC — qty selesai, selesai per tipe dan per task, audit progres dan selesai" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Fondasi web — menu (izin "salah satu dari"), halaman Customer, label audit, dan data demo

**Files:**
- Create: `web/src/modules/customer/queries.ts`, `web/src/modules/customer/components/customers-manager.tsx`, `customers-manager.test.tsx`; `web/src/routes/_app/customer.tsx`; `web/src/modules/auth/require-any-permission.test.ts`
- Modify: `web/src/app/navigation.ts`, `web/src/app/navigation.test.ts`, `web/src/app/module-links.ts`, `web/src/modules/auth/permissions.ts`, `web/src/modules/access/lib/audit-actions.ts`, `web/src/modules/access/lib/audit-actions.test.ts`, `web/src/modules/access/components/audit-diff-view.tsx`, `audit-diff-view.test.tsx`, `web/src/lib/rpc/mock-backend.ts`, `mock-backend.test.ts`

**Interfaces:**
- Consumes: `CustomerDto`, kontrak `customers.*`/`handovers.*` (Task 1–5), `canAnywhere`, `meQueryOptions`, fixture `customer`/`handover`/`handoverLine` (`@gas-test/handover-fixtures`).
- Produces:
  - `navigation.ts`: `NavPermission`, `NavItem.permission` boleh berupa **daftar** (salah satu cukup); menu "Customer" (grup Data) dan "Serah Terima" (grup Operasional).
  - `permissions.ts`: `requireAnyPermission(queryClient, alternatives)`.
  - `customer/queries.ts`: `customerKeys`, `customersQueryOptions()`, `useRenameCustomer()`, `useSetCustomerStatus()`.
  - `CustomersManager({ customers, canManage, pendingStatusId, onRename, onToggleStatus })`; rute `/customer`.
  - Label audit `customer.*`, `handover.*`; label field audit `number`, `location`, `customer`, `note`, `lines`, `item`, `doneQty`, `qty`; label status task.
  - Data demo: customer dan task di mock dev.

- [ ] **Step 1: Tulis tes yang gagal**

`web/src/app/navigation.test.ts` — tambahkan (impor `NavGroup` sudah ada):

```ts
test('item dengan daftar izin tampil bila salah satu terpenuhi; tidak bila tak satu pun', () => {
  const groups: NavGroup[] = [
    {
      label: 'Operasional',
      items: [
        {
          label: 'Serah Terima',
          to: '/',
          icon: House,
          permission: [
            { module: 'handover', level: 'view', scope: 'location' },
            { module: 'qc', level: 'edit', scope: 'location' },
          ],
        },
      ],
    },
  ];
  const location = (permissions: Record<string, string>) => ({
    id: 'l1',
    code: 'A',
    name: 'A',
    permissions: { handover: 'none', qc: 'none', stock: 'none', ...permissions },
  });
  const me = (perms: Record<string, string>): MeDto =>
    ({
      email: 'a@gmail.com',
      name: 'A',
      isSuperAdmin: false,
      permissions: { access: 'none', item: 'none', handover: 'none', qc: 'none', stock: 'none' },
      locations: [location(perms)],
    }) as MeDto;
  expect(visibleNavGroups(groups, me({ handover: 'view' }), ['l1'])).toHaveLength(1);
  expect(visibleNavGroups(groups, me({ qc: 'edit' }), ['l1'])).toHaveLength(1);
  expect(visibleNavGroups(groups, me({}), ['l1'])).toHaveLength(0);
  expect(visibleNavGroups(groups, me({ qc: 'edit' }), [])).toHaveLength(0); // lokasi aktif kosong
});

test('menu Customer (grup Data, item view) dan Serah Terima (grup Operasional, salah satu dari handover view atau qc edit)', () => {
  const data = NAV_GROUPS.find((group) => group.label === 'Data');
  expect(data?.items.find((entry) => entry.to === '/customer')).toMatchObject({
    label: 'Customer',
    permission: { module: 'item', level: 'view' },
  });
  const ops = NAV_GROUPS.find((group) => group.label === 'Operasional');
  expect(ops?.items.find((entry) => entry.to === '/handover')).toMatchObject({
    label: 'Serah Terima',
    permission: [
      { module: 'handover', level: 'view', scope: 'location' },
      { module: 'qc', level: 'edit', scope: 'location' },
    ],
  });
});
```

`web/src/modules/auth/require-any-permission.test.ts`:

```ts
import type { MeDto } from '@shared/rpc';
import { QueryClient } from '@tanstack/react-query';
import { expect, test } from 'vitest';
import { meQueryOptions } from './queries';
import { requireAnyPermission } from './permissions';

function clientWith(permissions: Record<string, string>): QueryClient {
  const client = new QueryClient();
  const me = {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    permissions: { access: 'none', item: 'none', handover: 'none', qc: 'none', stock: 'none' },
    locations: [{ id: 'l1', code: 'A', name: 'A', permissions: { handover: 'none', qc: 'none', stock: 'none', ...permissions } }],
  } as MeDto;
  client.setQueryData(meQueryOptions().queryKey, me);
  return client;
}

const either = [
  { module: 'handover', level: 'view' },
  { module: 'qc', level: 'edit' },
] as const;

test('requireAnyPermission lolos bila salah satu alternatif terpenuhi di minimal satu lokasi', async () => {
  await expect(requireAnyPermission(clientWith({ handover: 'view' }), either)).resolves.toBeUndefined();
  await expect(requireAnyPermission(clientWith({ qc: 'edit' }), either)).resolves.toBeUndefined();
});

test('requireAnyPermission mengalihkan ke /forbidden bila tak satu pun terpenuhi', async () => {
  await expect(requireAnyPermission(clientWith({}), either)).rejects.toMatchObject({
    options: { to: '/forbidden' },
  });
});
```

`web/src/modules/access/lib/audit-actions.test.ts` — tambahkan:

```ts
test('label aksi customer dan serah terima', () => {
  expect(auditActionLabel('customer.create')).toBe('Customer dibuat');
  expect(auditActionLabel('customer.rename')).toBe('Customer diganti nama');
  expect(auditActionLabel('customer.activate')).toBe('Customer diaktifkan');
  expect(auditActionLabel('customer.deactivate')).toBe('Customer dinonaktifkan');
  expect(auditActionLabel('handover.create')).toBe('Task serah terima dibuat');
  expect(auditActionLabel('handover.update')).toBe('Task serah terima diubah');
  expect(auditActionLabel('handover.cancel')).toBe('Task serah terima dibatalkan');
  expect(auditActionLabel('handover.progress')).toBe('Progres QC diperbarui');
  expect(auditActionLabel('handover.complete')).toBe('Task serah terima selesai');
});
```

`web/src/modules/access/components/audit-diff-view.test.tsx` — tambahkan (impor `render, screen, within` dan helper `row()` sudah ada di berkas):

```ts
test('task serah terima: baris dibandingkan per entri, status memakai label Indonesia, qty progres terbaca', () => {
  render(
    <AuditDiffView
      before={{ number: 'ST-1', location: 'Lokasi A', customer: 'PT A', status: 'new', lines: ['Ubiquiti ES 24 × 5', 'Mikrotik hAP × 3'] }}
      after={{ number: 'ST-1', location: 'Lokasi A', customer: 'PT A', status: 'in_progress', lines: ['Ubiquiti ES 24 × 5 (selesai 2)', 'Mikrotik hAP × 3'] }}
    />,
  );
  expect(within(row('status')).getByText('Baru')).toBeInTheDocument();
  expect(within(row('status')).getByText('Dikerjakan')).toBeInTheDocument();
  expect(within(row('lines')).getByText('Ubiquiti ES 24 × 5 (selesai 2)')).toBeInTheDocument();
  expect(screen.getByText('Baris')).toBeInTheDocument();
  expect(screen.getByText('Customer')).toBeInTheDocument();
});

test('progres QC: tipe, qty selesai lama dan baru terbaca', () => {
  render(
    <AuditDiffView
      before={{ item: 'Ubiquiti ES 24', doneQty: 0, qty: 5 }}
      after={{ item: 'Ubiquiti ES 24', doneQty: 2, qty: 5 }}
    />,
  );
  expect(screen.getByText('Qty selesai')).toBeInTheDocument();
  expect(within(row('doneQty')).getByText('0')).toBeInTheDocument();
  expect(within(row('doneQty')).getByText('2')).toBeInTheDocument();
});
```

`web/src/modules/customer/components/customers-manager.test.tsx`:

```tsx
import type { CustomerDto } from '@shared/rpc';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { CustomersManager } from './customers-manager';

const customers: CustomerDto[] = [
  { id: 'c1', name: 'PT Maju', status: 'active', updatedAt: '' },
  { id: 'c2', name: 'Lama', status: 'inactive', updatedAt: '' },
];

function renderManager(props: Partial<Parameters<typeof CustomersManager>[0]> = {}) {
  const onRename = vi.fn().mockResolvedValue(null);
  const onToggleStatus = vi.fn();
  render(
    <CustomersManager
      customers={customers}
      canManage
      pendingStatusId={null}
      onRename={onRename}
      onToggleStatus={onToggleStatus}
      {...props}
    />,
  );
  return { onRename, onToggleStatus };
}

test('menampilkan customer dan status; tanpa izin manage tidak ada tombol ubah', () => {
  renderManager({ canManage: false });
  expect(screen.getByText('PT Maju')).toBeInTheDocument();
  expect(screen.getByText('Aktif')).toBeInTheDocument();
  expect(screen.getByText('Nonaktif')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Ubah|Nonaktifkan|Aktifkan/ })).toBeNull();
});

test('ganti nama: isian terisi nama lama, simpan mengirim id dan nama; galat server tampil di bawah isian', async () => {
  const { onRename } = renderManager();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah PT Maju' }));
  const input = screen.getByLabelText('Nama baru untuk PT Maju');
  expect(input).toHaveValue('PT Maju');
  await userEvent.clear(input);
  await userEvent.type(input, 'PT Maju Jaya');
  onRename.mockResolvedValueOnce('Nama customer sudah dipakai');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan nama PT Maju' }));
  expect(onRename).toHaveBeenCalledWith({ id: 'c1', name: 'PT Maju Jaya' });
  expect(await screen.findByRole('alert')).toHaveTextContent('Nama customer sudah dipakai');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan nama PT Maju' }));
  await waitFor(() => expect(screen.queryByLabelText('Nama baru untuk PT Maju')).toBeNull());
});

test('onRename yang melempar tidak membuat tombol macet; nonaktifkan/aktifkan memanggil callback', async () => {
  const { onToggleStatus, onRename } = renderManager();
  onRename.mockRejectedValueOnce(new Error('putus'));
  await userEvent.click(screen.getByRole('button', { name: 'Ubah PT Maju' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan nama PT Maju' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Gagal menyimpan customer');
  expect(screen.getByRole('button', { name: 'Simpan nama PT Maju' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Batal ubah PT Maju' }));
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan PT Maju' }));
  expect(onToggleStatus).toHaveBeenCalledWith(customers[0]);
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan Lama' }));
  expect(onToggleStatus).toHaveBeenCalledWith(customers[1]);
});
```

`web/src/lib/rpc/mock-backend.test.ts` — tambahkan:

```ts
test('serah terima demo: QC melihat task Jakarta dan mengubah progres; WH Bandung tidak melihat task Jakarta; customer diganti nama', async () => {
  const qc = tokenOf('qc.staff@qc.local');
  const list = await call('handovers.list', { locationIds: ['loc-jkt'] }, qc);
  expect(list.ok).toBe(true);
  expect(list.data.length).toBeGreaterThan(0);
  const task = list.data[0];
  const detail = await call('handovers.get', { id: task.id, locationIds: ['loc-jkt'] }, qc);
  const line = detail.data.lines[0];
  const updated = await call(
    'handovers.setProgress',
    { id: task.id, locationId: 'loc-jkt', lineId: line.id, doneQty: 1 },
    qc,
  );
  expect(updated.data.lines[0].doneQty).toBe(1);
  const wh = tokenOf('wh.staff@qc.local'); // Bandung saja
  expect(await call('handovers.list', { locationIds: ['loc-jkt'] }, wh)).toMatchObject({
    ok: false,
    error: { code: 'FORBIDDEN' },
  });
  const admin = tokenOf(MOCK_ADMIN_EMAIL);
  const customers = await call('customers.list', null, admin);
  expect(customers.data.length).toBeGreaterThan(0);
  const renamed = await call('customers.rename', { id: customers.data[0].id, name: 'Nama Baru Demo' }, admin);
  expect(renamed.data.name).toBe('Nama Baru Demo');
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd web test navigation require-any-permission audit-actions audit-diff-view customers-manager mock-backend`
Expected: FAIL pada semuanya (belum diimplementasikan).

- [ ] **Step 3: Menu dan izin**

`web/src/app/navigation.ts`:

1. Ganti tipe `NavItem.permission` dan tambahkan tipe `NavPermission`:

```ts
export interface NavPermission {
  module: ModuleKey;
  level: Level;
  /** `scope: 'location'` = tampil bila izin cukup di minimal satu lokasi aktif terpilih. */
  scope?: 'location';
}

export interface NavItem {
  label: string;
  to: LinkProps['to'];
  icon: LucideIcon;
  /** Rute di bawah `to` yang punya menu sendiri: item ini tidak ikut aktif di sana. */
  excludes?: LinkProps['to'][];
  /** Satu izin, atau **daftar** (salah satu cukup). */
  permission?: NavPermission | readonly NavPermission[];
}
```

2. Impor ikon `ClipboardList, Contact` dari `lucide-react`; di `NAV_GROUPS` tambahkan item Customer pada grup `Data` (setelah `Merk`):

```ts
      {
        label: 'Customer',
        to: '/customer',
        icon: Contact,
        permission: { module: 'item', level: 'view' },
      },
```

dan grup baru antara `Data` dan `Pengaturan Akses`:

```ts
  {
    label: 'Operasional',
    items: [
      {
        label: 'Serah Terima',
        to: '/handover',
        icon: ClipboardList,
        permission: [
          { module: 'handover', level: 'view', scope: 'location' },
          { module: 'qc', level: 'edit', scope: 'location' },
        ],
      },
    ],
  },
```

3. Ganti penyaring di `visibleNavGroups`:

```ts
      items: group.items.filter((item) => {
        if (!item.permission) return true;
        const alternatives: readonly NavPermission[] = Array.isArray(item.permission)
          ? item.permission
          : [item.permission as NavPermission];
        return alternatives.some((permission) =>
          canAnywhere(
            me,
            permission.module,
            permission.level,
            permission.scope === 'location' ? activeLocationIds : undefined,
          ),
        );
      }),
```

`web/src/app/module-links.ts`: tambahkan `handover: '/handover',` dan `qc: '/handover',` (Pengerjaan QC dikerjakan di halaman Serah Terima).

`web/src/modules/auth/permissions.ts`: tambahkan

```ts
/** Lolos bila SALAH SATU alternatif terpenuhi di minimal satu lokasi (modul berlokasi) atau global. */
export async function requireAnyPermission(
  queryClient: QueryClient,
  alternatives: ReadonlyArray<{ module: ModuleKey; level: Level }>,
): Promise<void> {
  const me = await queryClient.ensureQueryData(meQueryOptions());
  if (!alternatives.some((item) => canAnywhere(me, item.module, item.level))) {
    throw redirect({ to: '/forbidden' });
  }
}
```

- [ ] **Step 4: Customer — query, komponen, rute**

`web/src/modules/customer/queries.ts`:

```ts
import type { RenameCustomerInput, SetCustomerStatusInput } from '@shared/rpc';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/lib/rpc';
import { accessKeys } from '@/modules/access/queries';

export const customerKeys = {
  all: ['customers'] as const,
  list: ['customers', 'list'] as const,
};

export function customersQueryOptions() {
  return queryOptions({ queryKey: customerKeys.list, queryFn: () => rpc('customers.list', null) });
}

/** Nama customer tampil di daftar/detail task, jadi task ikut dimuat ulang (dan Log Audit). */
function useCustomerMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: customerKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['handovers'] }),
        queryClient.invalidateQueries({ queryKey: accessKeys.audit }),
      ]);
    },
  });
}

export const useRenameCustomer = () =>
  useCustomerMutation((input: RenameCustomerInput) => rpc('customers.rename', input));
export const useSetCustomerStatus = () =>
  useCustomerMutation((input: SetCustomerStatusInput) => rpc('customers.setStatus', input));
```

`web/src/modules/customer/components/customers-manager.tsx` — salin pola `BrandsManager` (`web/src/modules/brand/components/brands-manager.tsx`) dengan perbedaan: **tanpa** form tambah (customer dibuat lewat form task), prop `onRename: (input: { id: string; name: string }) => Promise<string | null>`, label "Customer", pesan galat tak terduga `'Gagal menyimpan customer'`, batas panjang `HANDOVER_LIMITS.customerName`, tanpa kolom jumlah item, dan hanya tombol `Ubah` serta `Nonaktifkan/Aktifkan` yang ditampilkan bila `canManage`. Aksesibilitas nama sama dengan tes: `Ubah <nama>`, `Nama baru untuk <nama>`, `Simpan nama <nama>`, `Batal ubah <nama>`, `Nonaktifkan <nama>` / `Aktifkan <nama>`. Isi lengkapnya:

```tsx
import { HANDOVER_LIMITS } from '@shared/handover';
import type { CustomerDto } from '@shared/rpc';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface CustomersManagerProps {
  customers: readonly CustomerDto[];
  canManage: boolean;
  pendingStatusId: string | null;
  /** Mengembalikan pesan galat (tampil di bawah isian) atau `null` bila berhasil. */
  onRename: (input: { id: string; name: string }) => Promise<string | null>;
  onToggleStatus: (customer: CustomerDto) => void;
}

/** Daftar customer: ganti nama dan nonaktifkan/aktifkan. Customer baru dibuat langsung dari form task. */
export function CustomersManager({
  customers,
  canManage,
  pendingStatusId,
  onRename,
  onToggleStatus,
}: CustomersManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(id: string) {
    setBusy(true);
    let message: string | null;
    try {
      message = await onRename({ id, name });
    } catch {
      message = 'Gagal menyimpan customer';
    }
    setBusy(false);
    setError(message);
    if (message === null) setEditingId(null);
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                Belum ada customer. Customer dibuat otomatis saat task serah terima disimpan.
              </TableCell>
            </TableRow>
          ) : null}
          {customers.map((customer) => (
            <TableRow key={customer.id}>
              <TableCell className="font-medium">
                {editingId === customer.id ? (
                  <div className="space-y-1">
                    <Input
                      aria-label={`Nama baru untuk ${customer.name}`}
                      maxLength={HANDOVER_LIMITS.customerName}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                    {error ? (
                      <p role="alert" className="text-sm text-destructive">
                        {error}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  customer.name
                )}
              </TableCell>
              <TableCell>
                <Badge variant={customer.status === 'active' ? 'default' : 'secondary'}>
                  {customer.status === 'active' ? 'Aktif' : 'Nonaktif'}
                </Badge>
              </TableCell>
              <TableCell className="space-x-2 text-right">
                {editingId === customer.id ? (
                  <>
                    <Button
                      size="sm"
                      aria-label={`Simpan nama ${customer.name}`}
                      disabled={busy || name.trim() === ''}
                      onClick={() => void save(customer.id)}
                    >
                      Simpan
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Batal ubah ${customer.name}`}
                      onClick={() => setEditingId(null)}
                    >
                      Batal
                    </Button>
                  </>
                ) : canManage ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Ubah ${customer.name}`}
                      onClick={() => {
                        setEditingId(customer.id);
                        setName(customer.name);
                        setError(null);
                      }}
                    >
                      Ubah
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`${customer.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} ${customer.name}`}
                      disabled={pendingStatusId === customer.id}
                      onClick={() => onToggleStatus(customer)}
                    >
                      {customer.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                  </>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

Tes "ganti nama … galat server" mengklik `Simpan nama PT Maju` dua kali: yang pertama menerima galat (`mockResolvedValueOnce`), yang kedua berhasil (`mockResolvedValue(null)` default) dan menutup isian.

`web/src/routes/_app/customer.tsx`:

```tsx
import type { CustomerDto } from '@shared/rpc';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { describeError } from '@/lib/rpc/describe-error';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { CustomersManager } from '@/modules/customer/components/customers-manager';
import {
  customersQueryOptions,
  useRenameCustomer,
  useSetCustomerStatus,
} from '@/modules/customer/queries';

export const Route = createFileRoute('/_app/customer')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(customersQueryOptions()),
  component: CustomersPage,
});

function CustomersPage() {
  const me = useMe();
  const { data: customers } = useSuspenseQuery(customersQueryOptions());
  const rename = useRenameCustomer();
  const setStatus = useSetCustomerStatus();

  async function handleRename(input: { id: string; name: string }): Promise<string | null> {
    try {
      await rename.mutateAsync(input);
      toast.success('Customer diperbarui');
      return null;
    } catch (error) {
      return describeError(error);
    }
  }

  function toggleStatus(customer: CustomerDto) {
    const status = customer.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: customer.id, status },
      {
        onSuccess: () =>
          toast.success(status === 'active' ? 'Customer diaktifkan' : 'Customer dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Customer</h1>
      <p className="text-sm text-muted-foreground">
        Customer baru dibuat otomatis saat task serah terima disimpan. Mengganti nama berlaku ke
        semua task customer itu; customer tidak dihapus, hanya dinonaktifkan.
      </p>
      <CustomersManager
        customers={customers}
        canManage={can(me, 'item', 'manage')}
        pendingStatusId={setStatus.isPending ? (setStatus.variables?.id ?? null) : null}
        onRename={handleRename}
        onToggleStatus={toggleStatus}
      />
    </div>
  );
}
```

- [ ] **Step 5: Label audit**

`audit-actions.ts` — tambahkan ke `AUDIT_ACTION_LABELS`:

```ts
  'customer.create': 'Customer dibuat',
  'customer.rename': 'Customer diganti nama',
  'customer.activate': 'Customer diaktifkan',
  'customer.deactivate': 'Customer dinonaktifkan',
  'handover.create': 'Task serah terima dibuat',
  'handover.update': 'Task serah terima diubah',
  'handover.cancel': 'Task serah terima dibatalkan',
  'handover.progress': 'Progres QC diperbarui',
  'handover.complete': 'Task serah terima selesai',
```

`audit-diff-view.tsx` — tambahkan ke `FIELD_LABELS`:

```ts
  number: 'Nomor',
  location: 'Lokasi',
  customer: 'Customer',
  note: 'Catatan',
  lines: 'Baris',
  item: 'Tipe',
  doneQty: 'Qty selesai',
  qty: 'Target',
```

dan ganti `STATUS_LABELS` menjadi:

```ts
const STATUS_LABELS: Record<string, string> = {
  active: 'Aktif',
  inactive: 'Nonaktif',
  new: 'Baru',
  in_progress: 'Dikerjakan',
  done: 'Selesai',
  cancelled: 'Dibatalkan',
};
```

- [ ] **Step 6: Data demo di mock dev** — `web/src/lib/rpc/mock-backend.ts`

Tambahkan impor `import { insertCustomer_ } from '@gas/modules/customer/repo';`, `import { insertHandover_, insertHandoverLine_ } from '@gas/modules/handover/repo';` dan `import { customer, handover, handoverLine } from '@gas-test/handover-fixtures';`; sebelum `seedMockAudit();` panggil `seedMockHandovers();` dan tambahkan di atas `seedMockAudit`:

```ts
/** Customer dan task serah terima contoh: Jakarta (Dikerjakan) dan Bandung (Baru). */
function seedMockHandovers(): void {
  insertCustomer_(customer('PT Maju Jaya'));
  insertCustomer_(customer('Budi Santoso'));
  insertHandover_(
    handover({
      id: 'ho-jkt-1',
      number: 'ST-20261009-001',
      locationId: 'loc-jkt',
      customerId: 'cust-pt-maju-jaya',
      customerName: 'PT Maju Jaya',
      note: 'Kirim sebelum Jumat',
      createdAt: '2026-10-09T02:00:00.000Z',
      createdBy: 'wh.staff@qc.local',
      updatedAt: '2026-10-09T05:00:00.000Z',
      updatedBy: 'qc.staff@qc.local',
    }),
  );
  insertHandoverLine_(
    handoverLine({ id: 'hl-1', handoverId: 'ho-jkt-1', itemId: 'item-af5xhd', itemLabel: 'Ubiquiti AF 5XHD', qty: 10, doneQty: 4, doneAt: '2026-10-09T05:00:00.000Z', doneBy: 'qc.staff@qc.local' }),
  );
  insertHandoverLine_(
    handoverLine({ id: 'hl-2', handoverId: 'ho-jkt-1', itemId: 'item-es24', itemLabel: 'Ubiquiti ES 24 250W', qty: 6 }),
  );
  insertHandover_(
    handover({
      id: 'ho-bdg-1',
      number: 'ST-20261010-001',
      locationId: 'loc-bdg',
      customerId: 'cust-budi-santoso',
      customerName: 'Budi Santoso',
      createdAt: '2026-10-10T02:00:00.000Z',
      createdBy: 'wh.staff@qc.local',
      updatedAt: '2026-10-10T02:00:00.000Z',
      updatedBy: 'wh.staff@qc.local',
    }),
  );
  insertHandoverLine_(
    handoverLine({ id: 'hl-3', handoverId: 'ho-bdg-1', itemId: 'item-es24', itemLabel: 'Ubiquiti ES 24 250W', qty: 3 }),
  );
}
```

- [ ] **Step 7: Jalankan tes, build (regenerasi route tree), typecheck**

Run: `bun run --cwd web test && bun run --cwd web build && bun run --cwd web typecheck`
Expected: semua lulus; `routeTree.gen.ts` memuat `/customer`. (`/handover` dibuat di Task 7; sebelum itu `module-links.ts`/`navigation.ts` mengacu ke `/handover` sehingga typecheck **gagal** pada `to: '/handover'` — diharapkan; diperbaiki di Task 7 Step 8.)

- [ ] **Step 8: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false web
git add web
git commit -m "feat(web): menu Serah Terima (izin salah satu dari), halaman Customer, label audit, dan data demo" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Serah terima — query, saran toleran, form buat/ubah, daftar

**Files:**
- Create: `web/src/modules/handover/queries.ts`, `schemas.ts`, `schemas.test.ts`, `lib/status.ts`, `lib/filter-handovers.ts`, `lib/filter-handovers.test.ts`, `components/customer-combobox.tsx`, `customer-combobox.test.tsx`, `item-lines-field.tsx`, `item-lines-field.test.tsx`, `handover-form.tsx`, `handover-form.test.tsx`, `handovers-table.tsx`, `handovers-table.test.tsx`; `web/src/routes/_app/handover/index.tsx`, `new.tsx`, `$handoverId/edit.tsx`, `$handoverId/index.tsx` (placeholder)
- Modify: — (rute baru saja)

**Interfaces:**
- Consumes: Task 1 (`suggestMatches`, `similarNames`, `deriveHandoverStatus` bila perlu, `HANDOVER_LIMITS`), DTO (Task 1), `useActiveLocations`, `LocationField`, `locationsWith`, `canAt`, `requireAnyPermission` (Task 6), `pickFieldErrors`, `FieldError`, `useUrlSyncedText`.
- Produces:
  - `queries.ts`: `handoverKeys`, `handoversQueryOptions(ids)`, `handoverQueryOptions(id, ids)`, `handoverOptionsQueryOptions(ids)`, `useSaveHandover()`, `useCancelHandover()`, `useSetProgress()`, `useCompleteLine()`, `useCompleteAll()`.
  - `lib/status.ts`: `HANDOVER_STATUS_LABELS`, `handoverStatusVariant(status)`.
  - `lib/filter-handovers.ts`: `filterHandovers(list, { q, status })` dengan `status: 'all' | 'active' | HandoverStatus`.
  - `schemas.ts`: `HANDOVER_FIELD_KEYS`, `handoverFormSchema`, `HandoverFormInput/Output`, `toHandoverFormDefaults(handover?, locationId?)`, `toSaveHandoverInput(values, id?)`.
  - `CustomerCombobox`, `ItemLinesField`, `HandoverForm`, `HandoversTable`; rute `/handover`, `/handover/new`, `/handover/$handoverId/edit`.

- [ ] **Step 1: Tulis tes yang gagal**

`web/src/modules/handover/schemas.test.ts`:

```ts
import type { HandoverDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { handoverFormSchema, toHandoverFormDefaults, toSaveHandoverInput } from './schemas';

const valid = {
  locationId: 'loc-a',
  customerName: ' PT Maju ',
  note: ' catatan ',
  lines: [{ itemId: 'i1', label: 'Ubiquiti ES 24', qty: 5 }],
};

test('skema menerima isian sah dan merapikan teks', () => {
  const parsed = handoverFormSchema.parse(valid);
  expect(parsed.customerName).toBe('PT Maju');
  expect(parsed.note).toBe('catatan');
});

test('skema menolak: lokasi kosong, customer kosong/tanda baca, catatan > 500, tanpa baris, qty tak sah, tipe ganda', () => {
  const issues = (over: Record<string, unknown>) => {
    const result = handoverFormSchema.safeParse({ ...valid, ...over });
    return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  };
  expect(issues({ locationId: '' })).toContain('locationId: Pilih lokasi');
  expect(issues({ customerName: '  ' })).toContain('customerName: Wajib diisi');
  expect(issues({ customerName: '--' })).toContain('customerName: Nama customer harus memuat huruf atau angka');
  expect(issues({ note: 'x'.repeat(501) })).toContain('note: Maksimal 500 karakter');
  expect(issues({ lines: [] })).toContain('lines: Minimal satu baris');
  for (const qty of [0, -1, 1.5, 100_001, Number.NaN]) {
    expect(issues({ lines: [{ itemId: 'i1', label: 'x', qty }] }).join('|')).toContain('lines.0.qty');
  }
  expect(issues({ lines: [{ itemId: 'i1', label: 'a', qty: 1 }, { itemId: 'i1', label: 'a', qty: 2 }] })).toContain(
    'lines: Tipe yang sama muncul dua kali',
  );
});

test('toSaveHandoverInput membuang label dan menyertakan id untuk ubah', () => {
  expect(toSaveHandoverInput(handoverFormSchema.parse(valid))).toEqual({
    locationId: 'loc-a',
    customerName: 'PT Maju',
    note: 'catatan',
    lines: [{ itemId: 'i1', qty: 5 }],
  });
  expect(toSaveHandoverInput(handoverFormSchema.parse(valid), 'h1')).toMatchObject({ id: 'h1' });
});

test('toHandoverFormDefaults: kosong untuk baru (dengan lokasi awal) dan terisi untuk ubah', () => {
  expect(toHandoverFormDefaults(undefined, 'loc-a')).toEqual({
    locationId: 'loc-a',
    customerName: '',
    note: '',
    lines: [],
  });
  const existing = {
    id: 'h1',
    locationId: 'loc-b',
    customerName: 'PT A',
    note: 'n',
    lines: [{ id: 'l1', itemId: 'i1', itemLabel: 'Ubiquiti ES 24', qty: 5, doneQty: 2, doneAt: '', doneBy: '' }],
  } as HandoverDto;
  expect(toHandoverFormDefaults(existing)).toEqual({
    locationId: 'loc-b',
    customerName: 'PT A',
    note: 'n',
    lines: [{ itemId: 'i1', label: 'Ubiquiti ES 24', qty: 5 }],
  });
});
```

`web/src/modules/handover/lib/filter-handovers.test.ts`:

```ts
import type { HandoverSummaryDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { filterHandovers } from './filter-handovers';

const make = (over: Partial<HandoverSummaryDto>): HandoverSummaryDto => ({
  id: 'x',
  number: 'ST-20261015-001',
  locationId: 'a',
  customerId: 'c',
  customerName: 'PT Maju Jaya',
  note: '',
  status: 'new',
  lineCount: 1,
  doneUnits: 0,
  totalUnits: 5,
  createdAt: '',
  updatedAt: '',
  ...over,
});
const list = [
  make({ id: '1', status: 'new' }),
  make({ id: '2', status: 'in_progress', number: 'ST-20261015-002', customerName: 'Budi Santoso', note: 'urgent' }),
  make({ id: '3', status: 'done', number: 'ST-20261014-001' }),
  make({ id: '4', status: 'cancelled', number: 'ST-20261013-001' }),
];
const ids = (q: string, status: Parameters<typeof filterHandovers>[1]['status'] = 'all') =>
  filterHandovers(list, { q, status }).map((t) => t.id);

test('filter status: semua, aktif (Baru + Dikerjakan), dan per status', () => {
  expect(ids('')).toEqual(['1', '2', '3', '4']);
  expect(ids('', 'active')).toEqual(['1', '2']);
  expect(ids('', 'done')).toEqual(['3']);
  expect(ids('', 'cancelled')).toEqual(['4']);
});

test('pencarian: nomor, customer, dan catatan; tidak peka huruf/tanda baca; urutan kata bebas', () => {
  expect(ids('002')).toEqual(['2']);
  expect(ids('st-20261014')).toEqual(['3']);
  expect(ids('santoso budi')).toEqual(['2']);
  expect(ids('URGENT')).toEqual(['2']);
  expect(ids('maju')).toEqual(['1', '3', '4']);
  expect(ids('tidak ada')).toEqual([]);
});
```

`web/src/modules/handover/components/customer-combobox.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test } from 'vitest';
import { CustomerCombobox } from './customer-combobox';

const customers = [
  { id: 'c1', name: 'PT Maju Jaya' },
  { id: 'c2', name: 'Budi Santoso' },
];

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <CustomerCombobox id="cust" value={value} onChange={setValue} customers={customers} />;
}

test('mengetik menampilkan saran toleran; memilih saran mengisi nama resmi', async () => {
  render(<Harness />);
  const input = screen.getByLabelText('Customer');
  await userEvent.type(input, 'maju');
  const option = await screen.findByRole('option', { name: 'PT Maju Jaya' });
  await userEvent.click(option);
  expect(input).toHaveValue('PT Maju Jaya');
});

test('nama yang belum ada: petunjuk customer baru akan dibuat; tidak memblokir', async () => {
  render(<Harness />);
  await userEvent.type(screen.getByLabelText('Customer'), 'Perusahaan Baru');
  expect(screen.getByText(/Customer baru "Perusahaan Baru" akan dibuat/)).toBeInTheDocument();
});

test('ejaan berbeda dari customer yang ada: petunjuk memakai ejaan resmi', async () => {
  render(<Harness />);
  await userEvent.type(screen.getByLabelText('Customer'), 'pt. maju  jaya');
  expect(screen.getByText(/Memakai customer yang sudah ada: "PT Maju Jaya"/)).toBeInTheDocument();
});

test('nama mirip (bukan sama): "Mirip: X, pakai ini?" dapat diklik', async () => {
  render(<Harness />);
  await userEvent.type(screen.getByLabelText('Customer'), 'Budi Santso');
  const similar = await screen.findByRole('button', { name: 'Pakai Budi Santoso' });
  await userEvent.click(similar);
  expect(screen.getByLabelText('Customer')).toHaveValue('Budi Santoso');
});

test('tanpa ketikan tidak ada saran maupun petunjuk', () => {
  render(<Harness />);
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(screen.queryByText(/Customer baru/)).toBeNull();
});
```

`web/src/modules/handover/components/item-lines-field.test.tsx`:

```tsx
import type { HandoverOptionItemDto } from '@shared/rpc';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test } from 'vitest';
import { ItemLinesField, type ItemLine } from './item-lines-field';

const options: HandoverOptionItemDto[] = [
  { id: 'i1', brand: 'Samsung', model: 'Galaxy S24', aliases: [] },
  { id: 'i2', brand: 'Ubiquiti', model: 'ES 24 250W', aliases: ['ES24'] },
];

function Harness({ initial = [] as ItemLine[], createLink }: { initial?: ItemLine[]; createLink?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ItemLinesField
        options={options}
        value={value}
        onChange={setValue}
        createItemLink={createLink ? <a href="#/item/new">Tambah item baru</a> : null}
      />
      <output data-testid="lines">{JSON.stringify(value)}</output>
    </>
  );
}
const lines = () => JSON.parse(screen.getByTestId('lines').textContent ?? '[]');

test('mengetik tipe (urutan kata bebas, typo ringan) menampilkan saran; memilih menambah baris qty 1', async () => {
  render(<Harness />);
  await userEvent.type(screen.getByLabelText('Cari tipe'), 'galaxy samsng');
  await userEvent.click(await screen.findByRole('option', { name: 'Samsung Galaxy S24' }));
  expect(lines()).toEqual([{ itemId: 'i1', label: 'Samsung Galaxy S24', qty: 1 }]);
  expect(screen.getByLabelText('Cari tipe')).toHaveValue('');
});

test('"es24" menemukan ES 24 lewat nama lain; tipe yang sudah ditambahkan tidak disarankan lagi', async () => {
  render(<Harness initial={[{ itemId: 'i2', label: 'Ubiquiti ES 24 250W', qty: 2 }]} />);
  await userEvent.type(screen.getByLabelText('Cari tipe'), 'es24');
  expect(screen.queryByRole('option')).toBeNull();
  expect(screen.getByText('Semua tipe yang cocok sudah ada di daftar.')).toBeInTheDocument();
});

test('qty dapat diubah dan baris dihapus; Enter pada pencarian menambah saran pertama tanpa mengirim form', async () => {
  render(<Harness initial={[{ itemId: 'i1', label: 'Samsung Galaxy S24', qty: 1 }]} />);
  fireEvent.change(screen.getByLabelText('Qty Samsung Galaxy S24'), { target: { value: '7' } });
  expect(lines()[0].qty).toBe(7);
  await userEvent.type(screen.getByLabelText('Cari tipe'), 'ubiquiti{Enter}');
  expect(lines().map((l: { itemId: string }) => l.itemId)).toEqual(['i1', 'i2']);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Samsung Galaxy S24' }));
  expect(lines().map((l: { itemId: string }) => l.itemId)).toEqual(['i2']);
});

test('tipe di luar katalog: pesan tidak ditemukan; tautan tambah item hanya bila disediakan', async () => {
  const { unmount } = render(<Harness />);
  await userEvent.type(screen.getByLabelText('Cari tipe'), 'zzzzzzzz');
  expect(screen.getByText(/Tipe tidak ditemukan di katalog\./)).toBeInTheDocument();
  expect(screen.queryByText('Tambah item baru')).toBeNull();
  unmount();
  render(<Harness createLink />);
  await userEvent.type(screen.getByLabelText('Cari tipe'), 'zzzzzzzz');
  expect(screen.getByText('Tambah item baru')).toBeInTheDocument();
});

test('maksimal 100 baris: pencarian dinonaktifkan', () => {
  const many: ItemLine[] = Array.from({ length: 100 }, (_, i) => ({ itemId: `x${i}`, label: `T${i}`, qty: 1 }));
  render(<Harness initial={many} />);
  expect(screen.getByLabelText('Cari tipe')).toBeDisabled();
});
```

`web/src/modules/handover/components/handovers-table.test.tsx`:

```tsx
import type { HandoverSummaryDto } from '@shared/rpc';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { HandoversTable } from './handovers-table';

const rows: HandoverSummaryDto[] = [
  { id: 'h1', number: 'ST-20261015-001', locationId: 'a', customerId: 'c', customerName: 'PT Maju', note: '', status: 'in_progress', lineCount: 2, doneUnits: 12, totalUnits: 20, createdAt: '2026-10-15T03:00:00.000Z', updatedAt: '' },
  { id: 'h2', number: 'ST-20261014-001', locationId: 'b', customerId: 'c', customerName: 'Budi', note: '', status: 'cancelled', lineCount: 1, doneUnits: 0, totalUnits: 3, createdAt: '2026-10-14T03:00:00.000Z', updatedAt: '' },
];
const locations = new Map([['a', 'Lokasi A'], ['b', 'Lokasi B']]);

test('menampilkan nomor, customer, ringkasan progres "12/20 unit", dan status berlabel', () => {
  render(<HandoversTable handovers={rows} showLocation={false} locationNames={locations} onOpen={vi.fn()} />);
  expect(screen.getByText('ST-20261015-001')).toBeInTheDocument();
  expect(screen.getByText('PT Maju')).toBeInTheDocument();
  expect(screen.getByText('12/20 unit')).toBeInTheDocument();
  expect(screen.getByText('Dikerjakan')).toBeInTheDocument();
  expect(screen.getByText('Dibatalkan')).toBeInTheDocument();
  expect(screen.queryByText('Lokasi A')).toBeNull();
});

test('kolom Lokasi hanya bila lebih dari satu lokasi terpilih; klik baris membuka detail', async () => {
  const onOpen = vi.fn();
  render(<HandoversTable handovers={rows} showLocation locationNames={locations} onOpen={onOpen} />);
  expect(screen.getByText('Lokasi A')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Buka ST-20261015-001' }));
  expect(onOpen).toHaveBeenCalledWith(rows[0]);
});

test('daftar kosong menampilkan pesan', () => {
  render(<HandoversTable handovers={[]} showLocation={false} locationNames={locations} onOpen={vi.fn()} />);
  expect(screen.getByText('Tidak ada task yang cocok.')).toBeInTheDocument();
});
```

`web/src/modules/handover/components/handover-form.test.tsx`:

```tsx
import type { HandoverOptionsDto, MeDto } from '@shared/rpc';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

const meMock = vi.hoisted(() => ({
  me: {
    email: 'wh@qc.local',
    name: 'WH',
    isSuperAdmin: false,
    permissions: { access: 'none', item: 'view', handover: 'none', qc: 'none', stock: 'none' },
    locations: [
      { id: 'loc-a', code: 'A', name: 'Lokasi A', permissions: { handover: 'manage', qc: 'none', stock: 'none' } },
    ],
  } as MeDto,
}));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => meMock.me }));
vi.mock('@/modules/location/active-locations-context', () => ({
  useActiveLocations: () => ({ selectedIds: ['loc-a'] }),
}));

import { HandoverForm } from './handover-form';
import { toHandoverFormDefaults } from '../schemas';

const options: HandoverOptionsDto = {
  items: [{ id: 'i1', brand: 'Ubiquiti', model: 'ES 24', aliases: [] }],
  customers: [{ id: 'c1', name: 'PT Maju' }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

test('mengisi customer (ketik), memilih tipe dari saran, mengatur qty, lalu menyimpan tanpa form tambahan', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <HandoverForm
      mode="create"
      defaultValues={toHandoverFormDefaults(undefined, 'loc-a')}
      options={options}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
  );
  await userEvent.type(screen.getByLabelText('Customer'), 'Perusahaan Baru');
  await userEvent.type(screen.getByLabelText('Cari tipe'), 'ubiquiti');
  await userEvent.click(await screen.findByRole('option', { name: 'Ubiquiti ES 24' }));
  await userEvent.type(screen.getByLabelText('Catatan'), 'segera');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
    locationId: 'loc-a',
    customerName: 'Perusahaan Baru',
    note: 'segera',
    lines: [{ itemId: 'i1', qty: 1 }],
  });
});

test('tanpa baris: tidak mengirim dan menampilkan pesan di field baris', async () => {
  const onSubmit = vi.fn();
  render(
    <HandoverForm mode="create" defaultValues={toHandoverFormDefaults(undefined, 'loc-a')} options={options} onSubmit={onSubmit} onCancel={vi.fn()} />,
  );
  await userEvent.type(screen.getByLabelText('Customer'), 'PT A');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Minimal satu baris')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('galat dari server ditampilkan per field (customerName dan lines)', () => {
  render(
    <HandoverForm
      mode="create"
      defaultValues={toHandoverFormDefaults(undefined, 'loc-a')}
      options={options}
      fieldErrors={{ customerName: 'Customer dinonaktifkan; aktifkan dulu di halaman Customer', lines: 'Baris 1: tipe tidak ditemukan' }}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText('Customer dinonaktifkan; aktifkan dulu di halaman Customer')).toBeInTheDocument();
  expect(screen.getByText('Baris 1: tipe tidak ditemukan')).toBeInTheDocument();
});

test('mode ubah: lokasi tampil sebagai teks (tidak dapat dipindah)', () => {
  render(
    <HandoverForm
      mode="edit"
      locationName="Lokasi A"
      defaultValues={{ locationId: 'loc-a', customerName: 'PT Maju', note: '', lines: [{ itemId: 'i1', label: 'Ubiquiti ES 24', qty: 2 }] }}
      options={options}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText('Lokasi A')).toBeInTheDocument();
  expect(screen.queryByLabelText('Lokasi')).toBeNull();
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd web test modules/handover`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Query, status, filter, skema**

`web/src/modules/handover/queries.ts`:

```ts
import type {
  CompleteLineInput,
  HandoverRefInput,
  SaveHandoverInput,
  SetProgressInput,
} from '@shared/rpc';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/lib/rpc';
import { accessKeys } from '@/modules/access/queries';
import { customerKeys } from '@/modules/customer/queries';

export const handoverKeys = {
  all: ['handovers'] as const,
  list: (ids: readonly string[]) => ['handovers', 'list', [...ids].sort()] as const,
  one: (id: string, ids: readonly string[]) => ['handovers', 'one', id, [...ids].sort()] as const,
  options: (ids: readonly string[]) => ['handovers', 'options', [...ids].sort()] as const,
};

export function handoversQueryOptions(locationIds: readonly string[]) {
  return queryOptions({
    queryKey: handoverKeys.list(locationIds),
    queryFn: () => rpc('handovers.list', { locationIds: [...locationIds] }),
    enabled: locationIds.length > 0,
  });
}

export function handoverQueryOptions(id: string, locationIds: readonly string[]) {
  return queryOptions({
    queryKey: handoverKeys.one(id, locationIds),
    queryFn: () => rpc('handovers.get', { id, locationIds: [...locationIds] }),
    enabled: locationIds.length > 0,
  });
}

export function handoverOptionsQueryOptions(locationIds: readonly string[]) {
  return queryOptions({
    queryKey: handoverKeys.options(locationIds),
    queryFn: () => rpc('handovers.options', { locationIds: [...locationIds] }),
    enabled: locationIds.length > 0,
  });
}

/** Perubahan task memuat ulang daftar/detail/opsi, customer (bisa dibuat inline), dan Log Audit. */
function useHandoverMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: handoverKeys.all }),
        queryClient.invalidateQueries({ queryKey: customerKeys.all }),
        queryClient.invalidateQueries({ queryKey: accessKeys.audit }),
      ]);
    },
  });
}

export const useSaveHandover = () =>
  useHandoverMutation((input: SaveHandoverInput) => rpc('handovers.save', input));
export const useCancelHandover = () =>
  useHandoverMutation((input: HandoverRefInput) => rpc('handovers.cancel', input));
export const useSetProgress = () =>
  useHandoverMutation((input: SetProgressInput) => rpc('handovers.setProgress', input));
export const useCompleteLine = () =>
  useHandoverMutation((input: CompleteLineInput) => rpc('handovers.completeLine', input));
export const useCompleteAll = () =>
  useHandoverMutation((input: HandoverRefInput) => rpc('handovers.completeAll', input));
```

`web/src/modules/handover/lib/status.ts`:

```ts
import type { HandoverStatus } from '@shared/handover';

export const HANDOVER_STATUS_LABELS: Record<HandoverStatus, string> = {
  new: 'Baru',
  in_progress: 'Dikerjakan',
  done: 'Selesai',
  cancelled: 'Dibatalkan',
};

/** Varian `Badge` shadcn; status tidak hanya dibedakan lewat warna (label teks selalu tampil). */
export function handoverStatusVariant(
  status: HandoverStatus,
): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (status === 'done') return 'default';
  if (status === 'cancelled') return 'destructive';
  if (status === 'in_progress') return 'secondary';
  return 'outline';
}
```

`web/src/modules/handover/lib/filter-handovers.ts`:

```ts
import type { HandoverStatus } from '@shared/handover';
import { normalizeKey } from '@shared/items';
import type { HandoverSummaryDto } from '@shared/rpc';

export interface HandoverFilter {
  q: string;
  /** `active` = Baru + Dikerjakan. */
  status: 'all' | 'active' | HandoverStatus;
}

/** Cocok bila semua kata kunci muncul di nomor, customer, atau catatan (urutan bebas, tanpa tanda baca/huruf). */
export function filterHandovers<T extends HandoverSummaryDto>(
  handovers: readonly T[],
  filter: HandoverFilter,
): T[] {
  const tokens = normalizeKey(filter.q).split(' ').filter((token) => token !== '');
  return handovers.filter((handover) => {
    if (filter.status === 'active') {
      if (handover.status !== 'new' && handover.status !== 'in_progress') return false;
    } else if (filter.status !== 'all' && handover.status !== filter.status) {
      return false;
    }
    if (tokens.length === 0) return true;
    const haystack = normalizeKey(`${handover.number} ${handover.customerName} ${handover.note}`);
    return tokens.every((token) => haystack.includes(token));
  });
}
```

`web/src/modules/handover/schemas.ts`:

```ts
import { HANDOVER_LIMITS } from '@shared/handover';
import { normalizeKey } from '@shared/items';
import type { HandoverDto, SaveHandoverInput } from '@shared/rpc';
import { z } from 'zod';

export const HANDOVER_FIELD_KEYS = ['locationId', 'customerName', 'note', 'lines'] as const;
export type HandoverFieldErrors = Partial<Record<(typeof HANDOVER_FIELD_KEYS)[number], string>>;

const lineSchema = z.object({
  itemId: z.string().min(1),
  /** Hanya untuk tampilan; tidak dikirim ke server. */
  label: z.string(),
  qty: z
    .number()
    .int('Qty harus bilangan bulat')
    .min(1, 'Minimal 1')
    .max(HANDOVER_LIMITS.qtyMax, `Maksimal ${HANDOVER_LIMITS.qtyMax}`),
});

export const handoverFormSchema = z.object({
  locationId: z.string().min(1, 'Pilih lokasi'),
  customerName: z
    .string()
    .trim()
    .min(1, 'Wajib diisi')
    .max(HANDOVER_LIMITS.customerName, `Maksimal ${HANDOVER_LIMITS.customerName} karakter`)
    .refine(
      (value) => value === '' || normalizeKey(value) !== '',
      'Nama customer harus memuat huruf atau angka',
    ),
  note: z.string().trim().max(HANDOVER_LIMITS.note, `Maksimal ${HANDOVER_LIMITS.note} karakter`),
  lines: z
    .array(lineSchema)
    .min(1, 'Minimal satu baris')
    .max(HANDOVER_LIMITS.lines, `Maksimal ${HANDOVER_LIMITS.lines} baris`)
    .refine(
      (lines) => new Set(lines.map((line) => line.itemId)).size === lines.length,
      'Tipe yang sama muncul dua kali',
    ),
});

export type HandoverFormInput = z.input<typeof handoverFormSchema>;
export type HandoverFormOutput = z.output<typeof handoverFormSchema>;

export function toHandoverFormDefaults(handover?: HandoverDto, locationId = ''): HandoverFormInput {
  if (!handover) return { locationId, customerName: '', note: '', lines: [] };
  return {
    locationId: handover.locationId,
    customerName: handover.customerName,
    note: handover.note,
    lines: handover.lines.map((line) => ({
      itemId: line.itemId,
      label: line.itemLabel,
      qty: line.qty,
    })),
  };
}

export function toSaveHandoverInput(values: HandoverFormOutput, id?: string): SaveHandoverInput {
  const input: SaveHandoverInput = {
    locationId: values.locationId,
    customerName: values.customerName,
    note: values.note,
    lines: values.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
  };
  return id ? { id, ...input } : input;
}
```

- [ ] **Step 4: Komponen saran (customer dan tipe)**

`web/src/modules/handover/components/customer-combobox.tsx`:

```tsx
import { normalizeKey } from '@shared/items';
import { similarNames, suggestMatches } from '@shared/suggest';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface CustomerComboboxProps {
  id: string;
  value: string;
  onChange: (name: string) => void;
  customers: ReadonlyArray<{ id: string; name: string }>;
  onBlur?: () => void;
}

/**
 * Isian customer dengan saran toleran (typo ringan, urutan kata bebas). Nama yang belum ada tidak memerlukan
 * form tambahan: customer dibuat otomatis saat task disimpan (FC2); petunjuk memberi tahu apa yang akan terjadi.
 */
export function CustomerCombobox({ id, value, onChange, customers, onBlur }: CustomerComboboxProps) {
  const [open, setOpen] = useState(false);
  const key = normalizeKey(value);
  const exact = customers.find((customer) => normalizeKey(customer.name) === key);
  const suggestions = key === '' || exact ? [] : suggestMatches(customers, value, (c) => [c.name], 6);
  const similar =
    key === '' || exact ? [] : similarNames(value, customers.map((customer) => customer.name));
  const listId = `${id}-suggestions`;
  return (
    <div className="relative space-y-1.5">
      <Label htmlFor={id}>Customer</Label>
      <Input
        id={id}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Tunda agar klik pada saran sempat diproses sebelum daftar ditutup.
          setTimeout(() => setOpen(false), 150);
          onBlur?.();
        }}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
      />
      {open && suggestions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Saran customer"
          className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {suggestions.map((customer) => (
            <li key={customer.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(customer.name);
                  setOpen(false);
                }}
              >
                {customer.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {key !== '' && exact && exact.name !== value.trim() ? (
        <p className="text-xs text-muted-foreground">
          Memakai customer yang sudah ada: "{exact.name}".
        </p>
      ) : null}
      {key !== '' && !exact ? (
        <p className="text-xs text-muted-foreground">
          Customer baru "{value.trim()}" akan dibuat saat task disimpan.
        </p>
      ) : null}
      {similar.length > 0 ? (
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          Mirip:
          {similar.map((name) => (
            <button
              key={name}
              type="button"
              aria-label={`Pakai ${name}`}
              className="rounded border px-1.5 py-0.5 text-foreground hover:bg-accent"
              onClick={() => onChange(name)}
            >
              {name}
            </button>
          ))}
          , pakai ini?
        </p>
      ) : null}
    </div>
  );
}
```

`web/src/modules/handover/components/item-lines-field.tsx`:

```tsx
import { HANDOVER_LIMITS } from '@shared/handover';
import type { HandoverOptionItemDto } from '@shared/rpc';
import { suggestMatches } from '@shared/suggest';
import { Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface ItemLine {
  itemId: string;
  /** Salinan "merk tipe" untuk tampilan. */
  label: string;
  qty: number;
}

export interface ItemLinesFieldProps {
  options: readonly HandoverOptionItemDto[];
  value: readonly ItemLine[];
  onChange: (lines: ItemLine[]) => void;
  /** Tautan "Tambah item baru" (hanya bila user boleh membuat item); `null` = tidak ada. */
  createItemLink?: ReactNode;
}

const labelOf = (item: HandoverOptionItemDto) => `${item.brand} ${item.model}`.trim();

/** Daftar baris `tipe × qty`: tipe dipilih dari saran toleran atas katalog (merk, tipe, nama lain). */
export function ItemLinesField({ options, value, onChange, createItemLink }: ItemLinesFieldProps) {
  const [query, setQuery] = useState('');
  const full = value.length >= HANDOVER_LIMITS.lines;
  const used = new Set(value.map((line) => line.itemId));
  const available = options.filter((item) => !used.has(item.id));
  const suggestions = suggestMatches(available, query, (item) => [item.brand, item.model, ...item.aliases], 8);
  const hasQuery = query.trim() !== '';
  const matchedButUsed =
    hasQuery &&
    suggestions.length === 0 &&
    suggestMatches(options, query, (item) => [item.brand, item.model, ...item.aliases], 1).length > 0;

  function add(item: HandoverOptionItemDto) {
    onChange([...value, { itemId: item.id, label: labelOf(item), qty: 1 }]);
    setQuery('');
  }

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada tipe. Cari dan pilih tipe di bawah.</p>
      ) : (
        <ul className="space-y-2">
          {value.map((line) => (
            <li key={line.itemId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{line.label}</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={HANDOVER_LIMITS.qtyMax}
                className="w-28"
                aria-label={`Qty ${line.label}`}
                value={Number.isNaN(line.qty) ? '' : line.qty}
                onChange={(event) =>
                  onChange(
                    value.map((row) =>
                      row.itemId === line.itemId ? { ...row, qty: Number(event.target.value) } : row,
                    ),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Hapus ${line.label}`}
                onClick={() => onChange(value.filter((row) => row.itemId !== line.itemId))}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative space-y-1.5">
        <Input
          aria-label="Cari tipe"
          placeholder={full ? 'Batas baris tercapai' : 'Cari tipe: merk, tipe, atau nama lain'}
          autoComplete="off"
          disabled={full}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault(); // jangan mengirim form
              const first = suggestions[0];
              if (first) add(first);
            }
          }}
        />
        {suggestions.length > 0 ? (
          <ul
            role="listbox"
            aria-label="Saran tipe"
            className="max-h-60 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {suggestions.map((item) => (
              <li key={item.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => add(item)}
                >
                  {labelOf(item)}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {matchedButUsed ? (
          <p className="text-xs text-muted-foreground">Semua tipe yang cocok sudah ada di daftar.</p>
        ) : null}
        {hasQuery && suggestions.length === 0 && !matchedButUsed ? (
          <p className="text-xs text-muted-foreground">
            Tipe tidak ditemukan di katalog. {createItemLink}
          </p>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Form, tabel**

`web/src/modules/handover/components/handover-form.tsx`:

```tsx
import type { HandoverOptionsDto } from '@shared/rpc';
import { useForm } from '@tanstack/react-form';
import type { ReactNode } from 'react';
import { FieldError } from '@/components/field-error';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LocationField } from '@/modules/location/location-field';
import type { HandoverFieldErrors, HandoverFormInput, HandoverFormOutput } from '../schemas';
import { handoverFormSchema } from '../schemas';
import { CustomerCombobox } from './customer-combobox';
import { ItemLinesField } from './item-lines-field';

export interface HandoverFormProps {
  mode: 'create' | 'edit';
  defaultValues: HandoverFormInput;
  options: HandoverOptionsDto;
  /** Mode ubah: nama lokasi ditampilkan sebagai teks (lokasi task tidak dapat dipindah). */
  locationName?: string;
  /** Tautan "Tambah item baru" (hanya bila user punya `item: edit`). */
  createItemLink?: ReactNode;
  submitError?: string | null;
  /** Galat per field dari server (mis. customer nonaktif, qty di bawah qty selesai). */
  fieldErrors?: HandoverFieldErrors;
  onSubmit: (values: HandoverFormOutput) => Promise<unknown>;
  onCancel: () => void;
}

export function HandoverForm({
  mode,
  defaultValues,
  options,
  locationName,
  createItemLink,
  submitError,
  fieldErrors,
  onSubmit,
  onCancel,
}: HandoverFormProps) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: handoverFormSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(handoverFormSchema.parse(value));
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
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="text-base font-semibold">Informasi task</h2>
        <form.Field name="locationId">
          {(field) => (
            <div className="space-y-1.5">
              {mode === 'edit' ? (
                <>
                  <Label>Lokasi</Label>
                  <p className="text-sm">{locationName ?? field.state.value}</p>
                </>
              ) : (
                <LocationField
                  id="handover-location"
                  module="handover"
                  level="edit"
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              )}
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.locationId]} />
            </div>
          )}
        </form.Field>
        <form.Field name="customerName">
          {(field) => (
            <div className="space-y-1.5">
              <CustomerCombobox
                id="handover-customer"
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                customers={options.customers}
              />
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.customerName]} />
            </div>
          )}
        </form.Field>
        <form.Field name="note">
          {(field) => (
            <div className="space-y-1.5">
              <Label htmlFor="handover-note">Catatan</Label>
              <Textarea
                id="handover-note"
                rows={3}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FieldError errors={[...field.state.meta.errors, fieldErrors?.note]} />
            </div>
          )}
        </form.Field>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <div>
          <h2 className="text-base font-semibold">Tipe dan qty</h2>
          <p className="text-sm text-muted-foreground">Setiap tipe hanya sekali per task.</p>
        </div>
        <form.Field name="lines">
          {(field) => (
            <div className="space-y-1.5">
              <ItemLinesField
                options={options.items}
                value={field.state.value}
                onChange={field.handleChange}
                createItemLink={createItemLink}
              />
              <FieldError stacked errors={[...field.state.meta.errors, fieldErrors?.lines]} />
            </div>
          )}
        </form.Field>
      </section>

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

`web/src/modules/handover/components/handovers-table.tsx`:

```tsx
import type { HandoverSummaryDto } from '@shared/rpc';
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
import { formatAuditTime } from '@/modules/access/lib/audit-actions';
import { HANDOVER_STATUS_LABELS, handoverStatusVariant } from '../lib/status';

export interface HandoversTableProps {
  handovers: readonly HandoverSummaryDto[];
  /** Kolom Lokasi hanya bila lebih dari satu lokasi terpilih (PRD FR-C5). */
  showLocation: boolean;
  locationNames: ReadonlyMap<string, string>;
  onOpen: (handover: HandoverSummaryDto) => void;
}

export function HandoversTable({ handovers, showLocation, locationNames, onOpen }: HandoversTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nomor</TableHead>
            <TableHead>Customer</TableHead>
            {showLocation ? <TableHead>Lokasi</TableHead> : null}
            <TableHead>Progres</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Dibuat</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {handovers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={showLocation ? 7 : 6} className="text-center text-muted-foreground">
                Tidak ada task yang cocok.
              </TableCell>
            </TableRow>
          ) : null}
          {handovers.map((handover) => (
            <TableRow key={handover.id}>
              <TableCell className="font-medium">{handover.number}</TableCell>
              <TableCell>{handover.customerName}</TableCell>
              {showLocation ? (
                <TableCell>{locationNames.get(handover.locationId) ?? handover.locationId}</TableCell>
              ) : null}
              <TableCell className="tabular-nums">
                {handover.doneUnits}/{handover.totalUnits} unit
                <div className="text-xs text-muted-foreground">{handover.lineCount} tipe</div>
              </TableCell>
              <TableCell>
                <Badge variant={handoverStatusVariant(handover.status)}>
                  {HANDOVER_STATUS_LABELS[handover.status]}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatAuditTime(handover.createdAt)}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Buka ${handover.number}`}
                  onClick={() => onOpen(handover)}
                >
                  Buka
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 6: Rute**

`web/src/routes/_app/handover/index.tsx` (daftar):

```tsx
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { locationsWith, requireAnyPermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { HandoversTable } from '@/modules/handover/components/handovers-table';
import { filterHandovers } from '@/modules/handover/lib/filter-handovers';
import { handoversQueryOptions } from '@/modules/handover/queries';
import { useActiveLocations } from '@/modules/location/active-locations-context';

const searchSchema = z.object({
  q: z.string().optional().catch(undefined),
  status: z
    .enum(['all', 'active', 'new', 'in_progress', 'done', 'cancelled'])
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/_app/handover/')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) =>
    requireAnyPermission(context.queryClient, [
      { module: 'handover', level: 'view' },
      { module: 'qc', level: 'edit' },
    ]),
  component: HandoversPage,
});

function HandoversPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  // Hanya lokasi terpilih yang boleh dibaca user (WH view ke atas atau QC edit); selebihnya tidak diminta.
  const readable = selectedIds.filter(
    (id) =>
      locationsWith(me, 'handover', 'view', [id]).length > 0 ||
      locationsWith(me, 'qc', 'edit', [id]).length > 0,
  );
  const canCreate = locationsWith(me, 'handover', 'edit', selectedIds).length > 0;
  const query = useQuery(handoversQueryOptions(readable));
  const [text, setText] = useUrlSyncedText(
    search.q ?? '',
    (value) =>
      void navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  );
  const locationNames = new Map(me.locations.map((location) => [location.id, location.name]));
  const visible = filterHandovers(query.data ?? [], {
    q: search.q ?? '',
    status: search.status ?? 'active',
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Serah Terima</h1>
        {canCreate ? (
          <Button onClick={() => void navigate({ to: '/handover/new' })}>Tambah task</Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Cari nomor, customer, atau catatan"
          aria-label="Cari task"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <NativeSelect
          aria-label="Filter status"
          className="sm:w-52"
          value={search.status ?? 'active'}
          onChange={(event) =>
            void navigate({
              search: (prev) => ({ ...prev, status: event.target.value as typeof search.status }),
              replace: true,
            })
          }
        >
          <option value="active">Aktif (Baru + Dikerjakan)</option>
          <option value="all">Semua status</option>
          <option value="new">Baru</option>
          <option value="in_progress">Dikerjakan</option>
          <option value="done">Selesai</option>
          <option value="cancelled">Dibatalkan</option>
        </NativeSelect>
      </div>
      {readable.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Pilih lokasi di header yang Anda punya akses serah terima atau QC-nya.
        </p>
      ) : query.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Gagal memuat task. Coba muat ulang.
        </p>
      ) : (
        <HandoversTable
          handovers={visible}
          showLocation={selectedIds.length > 1}
          locationNames={locationNames}
          onOpen={(handover) =>
            void navigate({ to: '/handover/$handoverId', params: { handoverId: handover.id } })
          }
        />
      )}
    </div>
  );
}
```

`web/src/routes/_app/handover/new.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/lib/rpc/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { can, locationsWith, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { HandoverForm } from '@/modules/handover/components/handover-form';
import { handoverOptionsQueryOptions, useSaveHandover } from '@/modules/handover/queries';
import type { HandoverFieldErrors, HandoverFormOutput } from '@/modules/handover/schemas';
import {
  HANDOVER_FIELD_KEYS,
  toHandoverFormDefaults,
  toSaveHandoverInput,
} from '@/modules/handover/schemas';
import { useActiveLocations } from '@/modules/location/active-locations-context';

export const Route = createFileRoute('/_app/handover/new')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'handover', 'edit'),
  component: NewHandoverPage,
});

function NewHandoverPage() {
  const navigate = useNavigate();
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const writable = locationsWith(me, 'handover', 'edit', selectedIds);
  const options = useQuery(handoverOptionsQueryOptions(writable.map((location) => location.id)));
  const save = useSaveHandover();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<HandoverFieldErrors>({});

  async function handleSubmit(values: HandoverFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      const saved = await save.mutateAsync(toSaveHandoverInput(values));
      toast.success(`Task ${saved.number} disimpan`);
      await navigate({ to: '/handover/$handoverId', params: { handoverId: saved.id } });
    } catch (error) {
      const picked = pickFieldErrors(error, HANDOVER_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Tambah task serah terima</h1>
      {writable.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tidak ada lokasi aktif terpilih yang boleh Anda ubah. Pilih lokasi di header.
        </p>
      ) : options.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : options.isError || !options.data ? (
        <p role="alert" className="text-sm text-destructive">
          Gagal memuat daftar tipe dan customer.
        </p>
      ) : (
        <HandoverForm
          mode="create"
          defaultValues={toHandoverFormDefaults(
            undefined,
            writable.length === 1 ? (writable[0]?.id ?? '') : '',
          )}
          options={options.data}
          createItemLink={
            can(me, 'item', 'edit') ? <Link to="/item/new" className="underline">Tambah item baru</Link> : null
          }
          submitError={submitError}
          fieldErrors={fieldErrors}
          onSubmit={handleSubmit}
          onCancel={() => void navigate({ to: '/handover' })}
        />
      )}
    </div>
  );
}
```

`web/src/routes/_app/handover/$handoverId/edit.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/lib/rpc/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { can, canAt, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { HandoverForm } from '@/modules/handover/components/handover-form';
import {
  handoverOptionsQueryOptions,
  handoverQueryOptions,
  useSaveHandover,
} from '@/modules/handover/queries';
import type { HandoverFieldErrors, HandoverFormOutput } from '@/modules/handover/schemas';
import {
  HANDOVER_FIELD_KEYS,
  toHandoverFormDefaults,
  toSaveHandoverInput,
} from '@/modules/handover/schemas';
import { useActiveLocations } from '@/modules/location/active-locations-context';

export const Route = createFileRoute('/_app/handover/$handoverId/edit')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'handover', 'edit'),
  component: EditHandoverPage,
});

function EditHandoverPage() {
  const { handoverId } = Route.useParams();
  const navigate = useNavigate();
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const detail = useQuery(handoverQueryOptions(handoverId, selectedIds));
  const locationId = detail.data?.locationId;
  const options = useQuery(handoverOptionsQueryOptions(locationId ? [locationId] : []));
  const save = useSaveHandover();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<HandoverFieldErrors>({});

  const back = () => void navigate({ to: '/handover/$handoverId', params: { handoverId } });

  async function handleSubmit(values: HandoverFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await save.mutateAsync(toSaveHandoverInput(values, handoverId));
      toast.success('Task disimpan');
      back();
    } catch (error) {
      const picked = pickFieldErrors(error, HANDOVER_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  const task = detail.data;
  const editable =
    task !== undefined &&
    (task.status === 'new' || task.status === 'in_progress') &&
    canAt(me, 'handover', 'edit', task.locationId);
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Ubah task {task?.number ?? ''}</h1>
      {detail.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : !task ? (
        <p role="alert" className="text-sm text-destructive">
          Task tidak ditemukan di lokasi aktif.{' '}
          <Link to="/handover" className="underline">Kembali ke daftar</Link>
        </p>
      ) : !editable ? (
        <p role="alert" className="text-sm text-destructive">
          Task ini tidak dapat diubah (sudah selesai/dibatalkan atau Anda tidak punya izin ubah).{' '}
          <Link to="/handover/$handoverId" params={{ handoverId }} className="underline">Kembali</Link>
        </p>
      ) : options.isPending || !options.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <HandoverForm
          key={task.updatedAt}
          mode="edit"
          locationName={me.locations.find((location) => location.id === task.locationId)?.name}
          defaultValues={toHandoverFormDefaults(task)}
          options={options.data}
          createItemLink={
            can(me, 'item', 'edit') ? <Link to="/item/new" className="underline">Tambah item baru</Link> : null
          }
          submitError={submitError}
          fieldErrors={fieldErrors}
          onSubmit={handleSubmit}
          onCancel={back}
        />
      )}
    </div>
  );
}
```

`web/src/routes/_app/handover/$handoverId/index.tsx` (placeholder; Task 8 menggantinya):

```tsx
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/handover/$handoverId/')({
  component: () => <p>Detail task…</p>,
});
```

- [ ] **Step 7: Jalankan tes, regenerasi route tree, typecheck**

Run: `bun run --cwd web test && bun run --cwd web build && bun run --cwd web typecheck`
Expected: semua lulus; `routeTree.gen.ts` memuat `/handover`, `/handover/new`, `/handover/$handoverId/`, `/handover/$handoverId/edit`; typecheck bersih (tautan `/handover` di navigasi kini bertipe benar). Bila TanStack Router menulis ulang argumen `createFileRoute(...)`, biarkan hasilnya.

- [ ] **Step 8: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false web
git add web
git commit -m "feat(web): serah terima — daftar, form buat/ubah dengan saran customer dan tipe toleran, customer dibuat inline" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Detail task, kontrol progres QC, batalkan, dan selesai per tipe/per task

**Files:**
- Create: `web/src/modules/handover/components/handover-detail-view.tsx`, `handover-detail-view.test.tsx`
- Modify: `web/src/routes/_app/handover/$handoverId/index.tsx` (mengganti placeholder)

**Interfaces:**
- Consumes: `HandoverDto`, `HANDOVER_STATUS_LABELS`, `handoverStatusVariant`, mutasi (Task 7), `canAt`, `can`, `formatAuditTime`, `Dialog`.
- Produces: `HandoverDetailView({ handover, locationName, canEdit, canCancel, canProgress, renderItemLink, pending, onBack, onEdit, onCancel, onSetProgress, onCompleteLine, onCompleteAll })`; rute detail.

- [ ] **Step 1: Tulis tes yang gagal** — `handover-detail-view.test.tsx`

```tsx
import type { HandoverDto } from '@shared/rpc';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { HandoverDetailView } from './handover-detail-view';

const base: HandoverDto = {
  id: 'h1',
  number: 'ST-20261015-001',
  locationId: 'a',
  customerId: 'c',
  customerName: 'PT Maju',
  note: 'kirim segera',
  status: 'in_progress',
  lineCount: 2,
  doneUnits: 2,
  totalUnits: 8,
  createdAt: '2026-10-15T03:00:00.000Z',
  updatedAt: '2026-10-15T04:00:00.000Z',
  createdBy: 'wh@qc.local',
  updatedBy: 'qc@qc.local',
  lines: [
    { id: 'l1', itemId: 'i1', itemLabel: 'Ubiquiti ES 24', qty: 5, doneQty: 2, doneAt: '2026-10-15T04:00:00.000Z', doneBy: 'qc@qc.local' },
    { id: 'l2', itemId: 'i2', itemLabel: 'Mikrotik hAP ac2', qty: 3, doneQty: 0, doneAt: '', doneBy: '' },
  ],
};

function renderView(props: Partial<Parameters<typeof HandoverDetailView>[0]> = {}) {
  const handlers = {
    onBack: vi.fn(),
    onEdit: vi.fn(),
    onCancel: vi.fn(),
    onSetProgress: vi.fn(),
    onCompleteLine: vi.fn(),
    onCompleteAll: vi.fn(),
  };
  render(
    <HandoverDetailView
      handover={base}
      locationName="Lokasi A"
      canEdit
      canCancel
      canProgress
      pending={false}
      renderItemLink={(itemId, label) => <a href={`#/item/${itemId}`}>{label}</a>}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

test('menampilkan nomor, status, customer, lokasi, catatan, progres, dan tautan tipe ke detail item', () => {
  renderView();
  expect(screen.getByText('ST-20261015-001')).toBeInTheDocument();
  expect(screen.getByText('Dikerjakan')).toBeInTheDocument();
  expect(screen.getByText('PT Maju')).toBeInTheDocument();
  expect(screen.getByText('Lokasi A')).toBeInTheDocument();
  expect(screen.getByText('kirim segera')).toBeInTheDocument();
  expect(screen.getByText('2/8 unit')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Ubiquiti ES 24' })).toHaveAttribute('href', '#/item/i1');
  expect(screen.getAllByText(/qc@qc\.local/).length).toBeGreaterThan(0); // pelaku progres per baris (FQ4)
});

test('mengubah qty selesai lalu keluar dari isian mengirim nilai baru; nilai tak sah/sama tidak dikirim', async () => {
  const { onSetProgress } = renderView();
  const input = screen.getByLabelText('Qty selesai Ubiquiti ES 24');
  expect(input).toHaveValue(2);
  await userEvent.clear(input);
  await userEvent.type(input, '4');
  await userEvent.tab();
  expect(onSetProgress).toHaveBeenCalledWith('l1', 4);
  onSetProgress.mockClear();
  await userEvent.clear(input);
  await userEvent.type(input, '9'); // di atas target 5
  await userEvent.tab();
  expect(onSetProgress).not.toHaveBeenCalled();
  expect(screen.getByText('Harus bilangan bulat 0–5')).toBeInTheDocument();
  await userEvent.clear(input);
  await userEvent.type(input, '2'); // sama dengan nilai tersimpan
  await userEvent.tab();
  expect(onSetProgress).not.toHaveBeenCalled();
});

test('tombol Selesai per tipe mengisi penuh; nonaktif bila sudah penuh', async () => {
  const { onCompleteLine } = renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Selesai Mikrotik hAP ac2' }));
  expect(onCompleteLine).toHaveBeenCalledWith('l2');
});

test('selesai per task meminta konfirmasi lebih dulu', async () => {
  const { onCompleteAll } = renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Selesaikan semua' }));
  expect(onCompleteAll).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ya, selesaikan' }));
  expect(onCompleteAll).toHaveBeenCalled();
});

test('batalkan meminta konfirmasi; Ubah memanggil callback', async () => {
  const { onCancel, onEdit } = renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  expect(onEdit).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Batalkan task' }));
  expect(onCancel).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ya, batalkan' }));
  expect(onCancel).toHaveBeenCalled();
});

test('tanpa izin: tidak ada kontrol progres, Ubah, maupun Batalkan (WH view saja)', () => {
  renderView({ canEdit: false, canCancel: false, canProgress: false });
  expect(screen.queryByLabelText(/Qty selesai/)).toBeNull();
  expect(screen.queryByRole('button', { name: /Ubah|Batalkan task|Selesaikan semua|Selesai /i })).toBeNull();
  expect(screen.getByText('2 / 5')).toBeInTheDocument(); // progres tampil sebagai teks
});

test('task Selesai atau Dibatalkan: baca saja dengan keterangan; tidak ada aksi', () => {
  renderView({ handover: { ...base, status: 'done', doneUnits: 8 }, canProgress: true, canEdit: true, canCancel: true });
  expect(screen.getByText('Task sudah selesai dan tidak dapat diubah.')).toBeInTheDocument();
  expect(screen.queryByLabelText(/Qty selesai/)).toBeNull();
  expect(screen.queryByRole('button', { name: /Ubah|Batalkan task|Selesaikan semua/ })).toBeNull();
});

test('task Dibatalkan: keterangan dibatalkan', () => {
  renderView({ handover: { ...base, status: 'cancelled' } });
  expect(screen.getByText('Task sudah dibatalkan dan tidak dapat diubah.')).toBeInTheDocument();
});

test('saat pending semua kontrol dinonaktifkan', () => {
  renderView({ pending: true });
  expect(screen.getByLabelText('Qty selesai Ubiquiti ES 24')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Selesaikan semua' })).toBeDisabled();
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd web test handover-detail-view`
Expected: FAIL — komponen belum ada.

- [ ] **Step 3: Komponen** — `web/src/modules/handover/components/handover-detail-view.tsx`

```tsx
import type { HandoverDto } from '@shared/rpc';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatAuditTime } from '@/modules/access/lib/audit-actions';
import { HANDOVER_STATUS_LABELS, handoverStatusVariant } from '../lib/status';

export interface HandoverDetailViewProps {
  handover: HandoverDto;
  locationName: string;
  /** WH: `handover: edit` di lokasi task. */
  canEdit: boolean;
  /** WH: `handover: manage` di lokasi task. */
  canCancel: boolean;
  /** QC: `qc: edit` di lokasi task. */
  canProgress: boolean;
  /** Tautan ke detail item (hanya untuk user ber-`item: view`); bila tidak ada, label teks biasa. */
  renderItemLink?: (itemId: string, label: string) => ReactNode;
  pending: boolean;
  onBack: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onSetProgress: (lineId: string, doneQty: number) => void;
  onCompleteLine: (lineId: string) => void;
  onCompleteAll: () => void;
}

function ProgressCell({
  lineId,
  label,
  qty,
  doneQty,
  disabled,
  onSetProgress,
}: {
  lineId: string;
  label: string;
  qty: number;
  doneQty: number;
  disabled: boolean;
  onSetProgress: (lineId: string, doneQty: number) => void;
}) {
  const [text, setText] = useState(String(doneQty));
  const [error, setError] = useState<string | null>(null);
  function commit() {
    const value = Number(text);
    if (text.trim() === '' || !Number.isInteger(value) || value < 0 || value > qty) {
      setError(`Harus bilangan bulat 0–${qty}`);
      return;
    }
    setError(null);
    if (value !== doneQty) onSetProgress(lineId, value);
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={qty}
          className="w-24"
          aria-label={`Qty selesai ${label}`}
          disabled={disabled}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
        />
        <span className="text-sm text-muted-foreground">/ {qty}</span>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function HandoverDetailView({
  handover,
  locationName,
  canEdit,
  canCancel,
  canProgress,
  renderItemLink,
  pending,
  onBack,
  onEdit,
  onCancel,
  onSetProgress,
  onCompleteLine,
  onCompleteAll,
}: HandoverDetailViewProps) {
  const [confirm, setConfirm] = useState<'complete' | 'cancel' | null>(null);
  const open = handover.status === 'new' || handover.status === 'in_progress';
  const closedMessage =
    handover.status === 'done'
      ? 'Task sudah selesai dan tidak dapat diubah.'
      : handover.status === 'cancelled'
        ? 'Task sudah dibatalkan dan tidak dapat diubah.'
        : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{handover.number}</h1>
            <Badge variant={handoverStatusVariant(handover.status)}>
              {HANDOVER_STATUS_LABELS[handover.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            {handover.doneUnits}/{handover.totalUnits} unit
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onBack}>
            Kembali ke daftar
          </Button>
          {open && canEdit ? (
            <Button variant="outline" disabled={pending} onClick={onEdit}>
              Ubah
            </Button>
          ) : null}
          {open && canProgress ? (
            <Button disabled={pending} onClick={() => setConfirm('complete')}>
              Selesaikan semua
            </Button>
          ) : null}
          {open && canCancel ? (
            <Button variant="destructive" disabled={pending} onClick={() => setConfirm('cancel')}>
              Batalkan task
            </Button>
          ) : null}
        </div>
      </div>

      {closedMessage ? (
        <p role="status" className="rounded-md border bg-muted/40 p-3 text-sm">
          {closedMessage}
        </p>
      ) : null}

      <dl className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Customer</dt>
          <dd className="font-medium">{handover.customerName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Lokasi</dt>
          <dd className="font-medium">{locationName}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Catatan</dt>
          <dd>{handover.note === '' ? '—' : handover.note}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Dibuat</dt>
          <dd>
            {formatAuditTime(handover.createdAt)} oleh {handover.createdBy}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Diperbarui</dt>
          <dd>
            {formatAuditTime(handover.updatedAt)} oleh {handover.updatedBy}
          </dd>
        </div>
      </dl>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Tipe dan progres</h2>
        <ul className="divide-y rounded-lg border">
          {handover.lines.map((line) => (
            <li key={line.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0 space-y-0.5">
                <div className="font-medium">
                  {renderItemLink ? renderItemLink(line.itemId, line.itemLabel) : line.itemLabel}
                </div>
                {line.doneAt !== '' ? (
                  <p className="text-xs text-muted-foreground">
                    Diperbarui {formatAuditTime(line.doneAt)} oleh {line.doneBy}
                  </p>
                ) : null}
              </div>
              <div className="flex items-start gap-2">
                {open && canProgress ? (
                  <>
                    <ProgressCell
                      key={`${line.id}-${line.doneQty}`}
                      lineId={line.id}
                      label={line.itemLabel}
                      qty={line.qty}
                      doneQty={line.doneQty}
                      disabled={pending}
                      onSetProgress={onSetProgress}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Selesai ${line.itemLabel}`}
                      disabled={pending || line.doneQty >= line.qty}
                      onClick={() => onCompleteLine(line.id)}
                    >
                      Selesai
                    </Button>
                  </>
                ) : (
                  <span className="text-sm tabular-nums">
                    {line.doneQty} / {line.qty}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={confirm !== null} onOpenChange={(next) => (next ? undefined : setConfirm(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === 'cancel' ? 'Batalkan task?' : 'Selesaikan semua tipe?'}
            </DialogTitle>
            <DialogDescription>
              {confirm === 'cancel'
                ? 'Task dibatalkan dan menjadi baca saja. Progres yang sudah tercatat tetap ada di Log Audit.'
                : 'Semua tipe diisi penuh sesuai target dan task menjadi Selesai. Tindakan ini mencatat nama dan waktu Anda.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Tidak
            </Button>
            <Button
              variant={confirm === 'cancel' ? 'destructive' : 'default'}
              disabled={pending}
              onClick={() => {
                const action = confirm;
                setConfirm(null);
                if (action === 'cancel') onCancel();
                else onCompleteAll();
              }}
            >
              {confirm === 'cancel' ? 'Ya, batalkan' : 'Ya, selesaikan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Rute detail** — ganti isi `web/src/routes/_app/handover/$handoverId/index.tsx`

```tsx
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/lib/rpc/describe-error';
import { can, canAt, requireAnyPermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { HandoverDetailView } from '@/modules/handover/components/handover-detail-view';
import {
  handoverQueryOptions,
  useCancelHandover,
  useCompleteAll,
  useCompleteLine,
  useSetProgress,
} from '@/modules/handover/queries';
import { useActiveLocations } from '@/modules/location/active-locations-context';

export const Route = createFileRoute('/_app/handover/$handoverId/')({
  beforeLoad: ({ context }) =>
    requireAnyPermission(context.queryClient, [
      { module: 'handover', level: 'view' },
      { module: 'qc', level: 'edit' },
    ]),
  component: HandoverDetailPage,
});

function HandoverDetailPage() {
  const { handoverId } = Route.useParams();
  const navigate = useNavigate();
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const query = useQuery(handoverQueryOptions(handoverId, selectedIds));
  const setProgress = useSetProgress();
  const completeLine = useCompleteLine();
  const completeAll = useCompleteAll();
  const cancel = useCancelHandover();
  const pending =
    setProgress.isPending || completeLine.isPending || completeAll.isPending || cancel.isPending;

  const task = query.data;
  if (query.isPending && selectedIds.length > 0) return <Skeleton className="h-64 w-full" />;
  if (!task) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Task tidak ditemukan di lokasi aktif.{' '}
        <Link to="/handover" className="underline">
          Kembali ke daftar
        </Link>
      </p>
    );
  }

  const ref = { id: task.id, locationId: task.locationId };
  const done = (message: string) => ({
    onSuccess: () => toast.success(message),
    onError: (error: unknown) => toast.error(describeError(error)),
  });
  const locationName = me.locations.find((location) => location.id === task.locationId)?.name ?? task.locationId;
  return (
    <HandoverDetailView
      handover={task}
      locationName={locationName}
      canEdit={canAt(me, 'handover', 'edit', task.locationId)}
      canCancel={canAt(me, 'handover', 'manage', task.locationId)}
      canProgress={canAt(me, 'qc', 'edit', task.locationId)}
      renderItemLink={
        can(me, 'item', 'view')
          ? (itemId, label) => (
              <Link to="/item/$itemId" params={{ itemId }} className="underline-offset-2 hover:underline">
                {label}
              </Link>
            )
          : undefined
      }
      pending={pending}
      onBack={() => void navigate({ to: '/handover' })}
      onEdit={() => void navigate({ to: '/handover/$handoverId/edit', params: { handoverId } })}
      onCancel={() => cancel.mutate(ref, done('Task dibatalkan'))}
      onSetProgress={(lineId, doneQty) =>
        setProgress.mutate({ ...ref, lineId, doneQty }, done('Progres disimpan'))
      }
      onCompleteLine={(lineId) => completeLine.mutate({ ...ref, lineId }, done('Tipe ditandai selesai'))}
      onCompleteAll={() => completeAll.mutate(ref, done('Task selesai'))}
    />
  );
}
```

> `can(me, 'item', 'view')` memakai izin GLOBAL modul `item` (global bersama), benar untuk menautkan ke detail item.

- [ ] **Step 5: Jalankan tes, build, typecheck**

Run: `bun run --cwd web test && bun run --cwd web build && bun run --cwd web typecheck`
Expected: lulus; typecheck bersih.

- [ ] **Step 6: Verifikasi manual di mock dev**

Run `bun run dev`.
1. Login **QC Staff**: menu **Serah Terima** muncul; pilih lokasi Jakarta di header → task `ST-20261009-001` (Dikerjakan, 4/16 unit); buka → ubah qty selesai satu tipe lalu Tab (toast "Progres disimpan"), "Selesai" per tipe, "Selesaikan semua" → konfirmasi → Selesai; coba qty 99 → pesan "Harus bilangan bulat 0–n".
2. Login **WH Staff** (Bandung): **Tambah task** → ketik customer baru (petunjuk "Customer baru … akan dibuat"), ketik "es24" lalu pilih saran, atur qty, Simpan → pindah ke detail; **Ubah** → hapus baris tanpa progres; **Batalkan task** → konfirmasi.
3. Login **Super Admin**: **Customer** → ganti nama customer; **Log Audit** → aksi `handover.*` dan `customer.*` dengan diff terbaca.
4. Ukuran ponsel (375×812): daftar, form, dan detail tanpa gulir horizontal halaman; reset ke desktop sesudahnya.

- [ ] **Step 7: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false web
git add web
git commit -m "feat(web): detail task, kontrol progres QC, selesai per tipe/per task, dan batalkan dengan konfirmasi" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Dokumentasi, E2E, dan verifikasi akhir Fase C

**Files:**
- Modify: `docs/e2e-checklist.md`, `CLAUDE.md`, `docs/adding-a-module.md`, `docs/prd/2026-10-09-qc-item-serah-terima.md`

**Interfaces:**
- Consumes: semua tugas sebelumnya.
- Produces: dokumentasi selaras dengan kode.

- [ ] **Step 1: `docs/e2e-checklist.md`** — tambahkan (lanjutan nomor terakhir, yaitu 52):

```markdown
| 53 | Login WH (`handover: edit`): Serah Terima → Tambah task; ketik customer baru, cari dua tipe lewat saran ("es24" dan "galaxy samsung" urutan kata terbalik), atur qty → Simpan | Nomor `ST-YYYYMMDD-001`, status Baru; Log Audit memuat `customer.create` lalu `handover.create` | FC2, FH2, FH3, FH4 |
| 54 | Buat task kedua di hari yang sama dengan ejaan customer berbeda ("pt. maju  jaya") | Memakai customer yang sama (ejaan resmi), nomor `-002`, tidak ada customer ganda di halaman Customer | FC2, FH4 |
| 55 | Ketik nama customer mirip ("Maju Jaya PT" atau typo) | Petunjuk "Mirip: …, pakai ini?" dapat diklik; tidak memblokir simpan | FC4 |
| 56 | Ketik tipe di luar katalog | "Tipe tidak ditemukan di katalog"; tautan "Tambah item baru" hanya untuk user `item: edit`; tipe tak dikenal tidak dapat disimpan | FH2, FH3 |
| 57 | Login QC (`qc: edit`): buka task; ubah qty selesai satu tipe (Tab), "Selesai" per tipe, lalu "Selesaikan semua" (konfirmasi) | Status Baru → Dikerjakan → Selesai; nama dan waktu per baris tampil; audit `handover.progress` dan **satu** `handover.complete` | FQ1–FQ4 |
| 58 | QC mengisi qty selesai di atas target atau pecahan | Ditolak, pesan "Harus bilangan bulat 0–n"; tidak tersimpan | FQ1 |
| 59 | Buka task Selesai atau Dibatalkan sebagai WH dan QC | Kontrol ubah/progres/batal tidak tampil; panggilan langsung ke RPC → `CONFLICT` | FH7, FQ6 |
| 60 | WH ubah task: turunkan qty di bawah qty selesai; hapus baris yang sudah ada progres | Ditolak dengan pesan di bawah daftar baris; baris tanpa progres boleh dihapus; audit `handover.update` | FH7 |
| 61 | WH (`handover: manage`) batalkan task (konfirmasi); WH `edit` saja | Task Dibatalkan, baca saja, audit `handover.cancel`; WH `edit` tidak melihat tombol Batalkan | FH8 |
| 62 | User dengan akses lokasi A saja: pilih lokasi lain / buka URL task lokasi B | Tidak ada data lokasi B; detail menampilkan "Task tidak ditemukan di lokasi aktif"; panggilan RPC ke lokasi B → `FORBIDDEN` | FH1, FH6 |
| 63 | Pilih dua lokasi di header, lalu satu | Daftar menggabungkan task; kolom Lokasi tampil hanya saat lebih dari satu lokasi | FH6 |
| 64 | Halaman Customer: ganti nama, nonaktifkan; buat task dengan customer nonaktif | Pesan "dinonaktifkan; aktifkan dulu di halaman Customer"; ganti nama ke nama customer lain ditolak | FC5 |
| 65 | WH tanpa izin `item` membuka form task | Saran tipe dan customer tetap muncul (rute serah terima) | FC3 |
| 66 | Log Audit: `handover.update` dan `handover.progress` | Baris dibandingkan per entri berwarna, status berlabel Indonesia, qty progres terbaca | FAU1, FAU2 |
| 67 | Ukuran ponsel (375×812) pada daftar, form, dan detail task | Tidak ada gulir horizontal halaman | NFR6 |
```

- [ ] **Step 2: `CLAUDE.md`** — di bagian "Struktur", setelah baris `web/src/modules/brand/`, tambahkan:

```markdown
- `web/src/modules/customer/` dan `gas/src/modules/customer/` — master customer (dibuat inline saat task disimpan; halaman hanya ganti nama/status). `web/src/modules/handover/` dan `gas/src/modules/handover/` — Serah Terima WH→QC dan pengerjaan QC; rute `handovers.*` berlokasi (`anyOf` WH/QC untuk baca; `locationId` + `id` untuk tulis, lokasi baris diperiksa ulang). Fungsi murni: `shared/handover.ts` (status turunan, nomor `ST-YYYYMMDD-NNN`) dan `shared/suggest.ts` (saran toleran typo/urutan kata, nama mirip).
```

- [ ] **Step 3: `docs/adding-a-module.md`** — tambahkan di akhir bagian "Modul berlokasi":

```markdown
7. **Baris yang diubah lewat id**: rute tulis menerima `locationId` **dan** `id`; router memeriksa izin di `locationId`, lalu servis wajib memeriksa bahwa lokasi baris yang ada sama dengan `locationId` (bila tidak, `NOT_FOUND`) sehingga izin di satu lokasi tidak dapat dipakai untuk mengubah baris lokasi lain (contoh: `loadHandoverForWrite_`).
8. **Saran toleran di klien**: pakai `suggestMatches`/`similarNames` (`shared/suggest.ts`) atas daftar yang sudah dimuat; ambil daftar lewat rute modul itu sendiri (izin modul), bukan rute modul lain yang mungkin tidak boleh diakses user.
9. **Menu dan guard dengan izin "salah satu dari"**: `NavItem.permission` boleh berupa daftar; guard route memakai `requireAnyPermission` (`web/src/modules/auth/permissions.ts`).
```

- [ ] **Step 4: Verifikasi akhir otomatis**

Run: `bun run check` lalu `bun run build`
Expected: `check` hijau (scripts, shared, gas, web); `build` lolos `verify-dist` (tanpa kode mock; **`index.html` ≤ 1,5 MB** — catat ukurannya; modul serah terima menambah komponen, bila melampaui batas hentikan dan laporkan sebelum lanjut). Bila tes web gagal serentak karena timeout, ulangi sesuai catatan memori di Global Constraints.

- [ ] **Step 5: PRD** — di bagian 9 "Definition of Done › Fase C" centang keempat butir (customer master; task serah terima; QC memperbarui qty; rute berlokasi dan audit) **hanya setelah** Step 4 lulus. Butir "Semua fase … checklist E2E diperbarui dan lulus di deployment" tetap terbuka sampai Step 6.

- [ ] **Step 6: Verifikasi manual di `/dev`** (butuh deployment)

Setelah PR digabung ke `dev` dan terdeploy: jalankan `setup` (membuat sheet `customers`, `handovers`, `handover_lines`), lalu E2E 53–67 dengan akun WH, QC, dan user satu lokasi. Catat hasilnya di PR; centang butir "Semua fase" di PRD hanya bila seluruh E2E 25–67 lulus.

- [ ] **Step 7: Commit**

```bash
bunx biome check --write --linter-enabled=false web docs
git add docs CLAUDE.md
git commit -m "docs: Fase C (customer, serah terima, pengerjaan QC) — E2E 53-67, panduan modul berlokasi, dan DoD" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Penutup (setelah Task 9)

- Ikuti `superpowers:executing-plans`: review akhir seluruh branch oleh reviewer terpisah (model paling mampu) dengan paket `review-package`, perbaiki temuan Critical/Important dalam satu putaran dengan TDD, catat Minor.
- Push branch dari `dev` (setelah PR Fase B2 digabung), buka PR ke `dev`, uji E2E 53–67 di `/dev` (termasuk izin per lokasi dengan beberapa akun).
- Yang sengaja **tidak** dikerjakan di Fase C: notifikasi (diputuskan tanpa notifikasi), modul Monitoring Stok, sinkronisasi customer dan task ke QC Desktop (customer hanya di QC App), penghapusan task (hanya dibatalkan), dan pindah lokasi task.
- Risiko yang perlu dipantau: tes web berat memori (jsdom) di mesin pengembang; ukuran `index.html` mendekati batas 1,5 MB; urutan nomor task bergantung pada pembacaan seluruh sheet `handovers` di dalam lock (cukup untuk ratusan task per hari; bila jauh lebih besar, simpan penghitung per hari di `sync_state`-seperti sheet).
