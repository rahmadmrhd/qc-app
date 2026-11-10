import type { Db, DbStatement, Preparer } from '@server/core/db';
import type { ItemStickerMarkDto, ItemStickerPhotoInput } from '@shared/contract';

/** Foto instruksi tersimpan: urutan (`position`), label BU (`null` = tanpa label), dan penanda berurutan. */
export interface StoredPhoto {
  guideId: string;
  caption: string;
  buId: string | null;
  position: number;
  marks: ItemStickerMarkDto[];
}

interface PhotoRow {
  item_id: string;
  guide_id: string;
  caption: string;
  bu_id: string;
  position: number | string;
}

interface MarkRow {
  item_id: string;
  guide_id: string;
  x: number | string;
  y: number | string;
  sticker_id: string;
  type_id: string;
  note: string;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/**
 * Pernyataan untuk mengganti SELURUH instruksi satu item (dijalankan di dalam `batch()` penyimpanan item): hapus
 * semua foto item (penanda ikut terhapus lewat kunci asing), lalu sisipkan foto dan penanda. `position` foto dan
 * penanda dari urutan larik. Batas jumlah/nilai dijaga validator, bukan di sini.
 *
 * `fresh` = item belum punya foto (item baru, atau item yang ada tetapi tanpa foto tersimpan): `DELETE` dilewati
 * (pola `replaceItemBusinessUnitsStmts`). `DELETE` pada item tanpa baris memasang kunci gap (REPEATABLE READ) yang
 * dapat membuat deadlock pada pembuatan serentak. Aman untuk item yang ada: penulisan lain pada item itu menaikkan
 * `items.updated_at`, sehingga CAS `UPDATE items` di batch yang sama menggagalkan penulis yang basi.
 */
export function replaceItemInstructionStmts(
  db: Preparer,
  itemId: string,
  photos: readonly ItemStickerPhotoInput[],
  fresh: boolean,
): DbStatement[] {
  const statements: DbStatement[] = fresh
    ? []
    : [db.prepare('DELETE FROM item_sticker_photos WHERE item_id = ?').bind(itemId)];
  if (photos.length === 0) return statements;
  statements.push(
    db
      .prepare(
        `INSERT INTO item_sticker_photos (item_id, guide_id, caption, bu_id, \`position\`) VALUES ${photos.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
      )
      .bind(
        ...photos.flatMap((photo, index) => [
          itemId,
          photo.guideId,
          photo.caption,
          photo.buId ?? '',
          index,
        ]),
      ),
  );
  const marks = photos.flatMap((photo) =>
    photo.marks.map((mark, index) => ({ guideId: photo.guideId, index, mark })),
  );
  if (marks.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO item_sticker_marks (item_id, guide_id, \`position\`, x, y, sticker_id, type_id, note) VALUES ${marks.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        )
        .bind(
          ...marks.flatMap(({ guideId, index, mark }) => [
            itemId,
            guideId,
            index,
            mark.x,
            mark.y,
            mark.target.kind === 'sticker' ? mark.target.stickerId : '',
            mark.target.kind === 'type' ? mark.target.typeId : '',
            mark.note,
          ]),
        ),
    );
  }
  return statements;
}

/** Memuat instruksi beberapa item sekaligus: foto berurutan `position` dengan penandanya berurutan. Item tanpa foto tidak ada di peta. */
export async function loadItemInstructions(
  db: Db,
  itemIds: readonly string[],
): Promise<Map<string, StoredPhoto[]>> {
  const result = new Map<string, StoredPhoto[]>();
  if (itemIds.length === 0) return result;
  const marks = new Map<string, ItemStickerMarkDto[]>();
  const [photoRows, markRows] = await Promise.all([
    db
      .prepare(
        `SELECT item_id, guide_id, caption, bu_id, \`position\` FROM item_sticker_photos WHERE item_id IN (${placeholders(itemIds.length)}) ORDER BY item_id, \`position\``,
      )
      .bind(...itemIds)
      .all<PhotoRow>(),
    db
      .prepare(
        `SELECT item_id, guide_id, x, y, sticker_id, type_id, note FROM item_sticker_marks WHERE item_id IN (${placeholders(itemIds.length)}) ORDER BY item_id, guide_id, \`position\``,
      )
      .bind(...itemIds)
      .all<MarkRow>(),
  ]);
  for (const row of markRows.results) {
    const key = JSON.stringify([row.item_id, row.guide_id]);
    const list = marks.get(key) ?? [];
    list.push({
      x: Number(row.x),
      y: Number(row.y),
      target:
        row.sticker_id !== ''
          ? { kind: 'sticker', stickerId: row.sticker_id }
          : { kind: 'type', typeId: row.type_id },
      note: row.note,
    });
    marks.set(key, list);
  }
  for (const row of photoRows.results) {
    const list = result.get(row.item_id) ?? [];
    list.push({
      guideId: row.guide_id,
      caption: row.caption,
      buId: row.bu_id === '' ? null : row.bu_id,
      position: Number(row.position),
      marks: marks.get(JSON.stringify([row.item_id, row.guide_id])) ?? [],
    });
    result.set(row.item_id, list);
  }
  return result;
}

/** Item yang punya instruksi: minimal satu penanda (foto tanpa penanda tidak dihitung). */
export async function hasInstructionsOf(db: Db, itemIds: readonly string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const rows = await db
    .prepare(
      `SELECT DISTINCT item_id FROM item_sticker_marks WHERE item_id IN (${placeholders(itemIds.length)})`,
    )
    .bind(...itemIds)
    .all<{ item_id: string }>();
  return new Set(rows.results.map((row) => row.item_id));
}

/** Filter instruksi stiker pada daftar item (`items.list`). */
export interface InstructionFilter {
  instruction?: 'none';
  stickerId?: string;
  typeId?: string;
  stickerMode?: 'has' | 'missing';
}

/**
 * Syarat `WHERE` untuk filter instruksi pada daftar item (alias tabel item `i`), dengan nilai yang harus di-bind
 * berurutan. Pencocokan jenis -> stiker DICERMINKAN dari `stickersForType` (`shared/stickers.ts`; satu definisi
 * dengan tampilan detail, dijaga tes kesepakatan): stiker `active` berjenis itu; aturan jenis `none` = semua,
 * selain itu hanya yang tertaut ke minimal satu BU item (`item_business_units`); status jenis tak berpengaruh.
 *
 * - `instruction: 'none'`: item tanpa satu pun penanda (foto tanpa penanda tidak dihitung).
 * - `stickerId`: "memakai" = penanda langsung ke stiker itu (apa pun statusnya/BU-nya), atau penanda jenis yang
 *   menurut aturan di atas menghasilkan stiker itu bagi item.
 * - `typeId`: "memakai" = penanda jenis itu, atau penanda langsung ke stiker berjenis itu.
 * - `stickerMode: 'missing'` (bawaan `has`) = kebalikan "memakai"; BU terlihat tetap dijaga pemanggil.
 */
export function instructionFilterSql(filter: InstructionFilter): {
  clauses: string[];
  binds: unknown[];
} {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (filter.instruction === 'none') {
    clauses.push('NOT EXISTS (SELECT 1 FROM item_sticker_marks m0 WHERE m0.item_id = i.id)');
  }
  const negate = filter.stickerMode === 'missing' ? 'NOT ' : '';
  if (filter.stickerId !== undefined) {
    clauses.push(
      `${negate}EXISTS (SELECT 1 FROM item_sticker_marks m WHERE m.item_id = i.id AND (m.sticker_id = ? OR (m.type_id <> '' AND EXISTS (SELECT 1 FROM stickers s JOIN sticker_types t ON t.id = s.type_id WHERE s.id = ? AND s.type_id = m.type_id AND s.status = 'active' AND (t.rule = 'none' OR EXISTS (SELECT 1 FROM sticker_business_units sb JOIN item_business_units ib ON ib.bu_id = sb.bu_id WHERE sb.sticker_id = s.id AND ib.item_id = i.id))))))`,
    );
    binds.push(filter.stickerId, filter.stickerId);
  } else if (filter.typeId !== undefined) {
    clauses.push(
      `${negate}EXISTS (SELECT 1 FROM item_sticker_marks m WHERE m.item_id = i.id AND (m.type_id = ? OR (m.sticker_id <> '' AND EXISTS (SELECT 1 FROM stickers s2 WHERE s2.id = m.sticker_id AND s2.type_id = ?))))`,
    );
    binds.push(filter.typeId, filter.typeId);
  }
  return { clauses, binds };
}
