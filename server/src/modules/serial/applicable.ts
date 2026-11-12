import type { Env } from '@server/core/env';
import { loadItemInstructions } from '@server/modules/sticker/instruction-repo';
import { buildInstructionViews } from '@server/modules/sticker/instruction-service';
import type { ApplicableStickerDto } from '@shared/contract';
import { SERIAL_LIMITS } from '@shared/serials';

/**
 * Stiker yang berlaku bagi `itemId` pada BU `buId`: gabungan stiker hasil terjemahan semua penanda instruksi item
 * (`resolved`), memakai SATU definisi yang sama dengan tampilan detail item (`buildInstructionViews` ->
 * `stickersForType`) dengan BU item = BU serial. Stiker nonaktif dibuang; tanpa duplikat; urut nama lalu id.
 */
export async function applicableStickersOf(
  env: Env,
  itemId: string,
  buId: string,
): Promise<ApplicableStickerDto[]> {
  const photos = (await loadItemInstructions(env.DB, [itemId])).get(itemId) ?? [];
  const views = await buildInstructionViews(env, itemId, [buId], photos);
  const resolved = new Map<string, { id: string; name: string; alias: string }>();
  for (const photo of views) {
    for (const mark of photo.marks) {
      for (const sticker of mark.resolved) {
        if (sticker.inactive || resolved.has(sticker.id)) continue;
        resolved.set(sticker.id, { id: sticker.id, name: sticker.name, alias: sticker.alias });
      }
    }
  }
  if (resolved.size === 0) return [];
  const ids = [...resolved.keys()];
  const rows = await env.DB.prepare(
    `SELECT s.id, t.name AS type_name FROM stickers s JOIN sticker_types t ON t.id = s.type_id WHERE s.id IN (${ids.map(() => '?').join(', ')})`,
  )
    .bind(...ids)
    .all<{ id: string; type_name: string }>();
  const typeName = new Map(rows.results.map((row) => [row.id, row.type_name]));
  return [...resolved.values()]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1))
    .map((sticker) => ({
      id: sticker.id,
      name: sticker.name,
      alias: sticker.alias,
      typeName: typeName.get(sticker.id) ?? '',
      defaultQty: Math.min(1, SERIAL_LIMITS.stickerQtyMax),
    }));
}
