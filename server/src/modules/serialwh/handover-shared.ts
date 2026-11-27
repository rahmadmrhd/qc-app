// Pembantu bersama jalur tautan task Serah Terima (kandidat, tautan, konteks). Hanya kueri bersaring soft delete.
import type { Env } from '@server/core/env';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import { listBusinessUnitBriefs } from '@server/modules/access/repo';
import type { DetectableItem } from '@shared/item-detect';
import { notificationPreviewText } from '@shared/notifications';
import { hasLevel } from '@shared/permissions';
import { whLiveBuIds } from './access';

/** Batas jumlah Item yang dimuat untuk pencocokan nama (cukup untuk katalog besar). */
export const DETECTABLE_ITEMS_MAX = 5000;
export const PREVIEW_MAX = 120;

/** Lokasi tempat pemanggil boleh membaca task: `handover: view` atau `qc: edit` (aturan `assertHandoverReadable`). */
export function readableHandoverLocationIds(user: Pick<UserContext, 'locations'>): string[] {
  return Object.entries(user.locations)
    .filter(([, access]) => hasLevel(access.handover, 'view') || hasLevel(access.qc, 'edit'))
    .map(([locationId]) => locationId);
}

export const placeholders = (count: number): string => Array(count).fill('?').join(', ');

/** Cuplikan satu baris catatan task, dipotong `PREVIEW_MAX` karakter. */
export function notePreview(note: string): string {
  return notificationPreviewText(note).slice(0, PREVIEW_MAX);
}

/** Item hidup aktif pada BU ber-`serialwh: edit` pemanggil (BU hidup), dengan nama merk. */
export async function loadDetectableItems(env: Env, user: UserContext): Promise<DetectableItem[]> {
  const buIds = whLiveBuIds(user, 'edit');
  if (buIds.length === 0) return [];
  const rows = await env.DB.prepare(
    `SELECT i.id, b.name AS brand_name, i.model FROM items i JOIN brands b ON b.id = i.brand_id WHERE ${liveWhere('i')} AND ${liveWhere('b')} AND i.status = 'active' AND EXISTS (SELECT 1 FROM item_business_units l WHERE l.item_id = i.id AND l.bu_id IN (${placeholders(buIds.length)})) ORDER BY i.id LIMIT ${DETECTABLE_ITEMS_MAX}`,
  )
    .bind(...buIds)
    .all<{ id: string; brand_name: string; model: string }>();
  return rows.results.map((row) => ({
    id: row.id,
    brandName: row.brand_name.trim(),
    model: row.model.trim(),
  }));
}

export interface BuLabel {
  code: string;
  name: string;
}

/** Kode dan nama SEMUA BU (BU terhapus tetap memberi nama pada SO lama). */
export async function buLabels(env: Env): Promise<Map<string, BuLabel>> {
  const briefs = await listBusinessUnitBriefs(env);
  return new Map(briefs.map((bu) => [bu.id, { code: bu.code, name: bu.name }]));
}
