import type { Env } from '@server/core/env';
import type { StickerRule, StickerStatus, StickerSystemKind } from '@shared/stickers';

const SEED_TIME = '2026-11-10T00:00:00.000Z';

/** Gambar pustaka stiker uji: baris `files` (pemilik stickerguide) + baris pustaka. */
export async function seedGuideImage(
  env: Pick<Env, 'DB'>,
  guide: { id: string; name?: string; width?: number; height?: number },
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO files (id, drive_id, mime, size, width, height, owner_type, owner_id, created_at, created_by, status) VALUES (?, ?, 'image/png', 1000, ?, ?, 'stickerguide', ?, ?, 'seed@gmail.com', 'active')",
    ).bind(
      guide.id,
      `drive-${guide.id}`,
      guide.width ?? 800,
      guide.height ?? 600,
      guide.id,
      SEED_TIME,
    ),
    env.DB.prepare(
      "INSERT INTO sticker_guide_images (id, name, thumb_mime, thumb, updated_at) VALUES (?, ?, 'image/webp', ?, ?)",
    ).bind(guide.id, guide.name ?? guide.id, Uint8Array.from([1, 2, 3]), SEED_TIME),
  ]);
}

/** Jenis stiker uji (bawaan aturan `bu`, aktif). */
export async function seedStickerType(
  env: Pick<Env, 'DB'>,
  type: {
    id: string;
    name?: string;
    rule?: StickerRule;
    status?: 'active' | 'inactive';
    /** Jenis sistem (bawaan `''`); paling banyak satu jenis per nilai terisi. */
    systemKind?: StickerSystemKind;
    /** Minimum stok bawaan (bawaan 0). */
    defaultMinQty?: number;
  },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO sticker_types (id, name, rule, status, system_kind, default_min_qty, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      type.id,
      type.name ?? type.id,
      type.rule ?? 'bu',
      type.status ?? 'active',
      type.systemKind ?? '',
      type.defaultMinQty ?? 0,
      SEED_TIME,
      SEED_TIME,
      'seed',
    )
    .run();
}

/** Stiker uji beserta tautan BU-nya (BU harus sudah di-seed pemanggil). */
export async function seedSticker(
  env: Pick<Env, 'DB'>,
  sticker: {
    id: string;
    typeId: string;
    name?: string;
    alias?: string;
    fileId?: string;
    minQty?: number;
    status?: StickerStatus;
    buIds?: string[];
  },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO stickers (id, type_id, name, alias, file_id, min_qty, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      sticker.id,
      sticker.typeId,
      sticker.name ?? sticker.id,
      sticker.alias ?? '',
      sticker.fileId ?? '',
      sticker.minQty ?? 0,
      sticker.status ?? 'active',
      SEED_TIME,
      SEED_TIME,
      'seed',
    )
    .run();
  for (const buId of sticker.buIds ?? []) {
    await env.DB.prepare('INSERT INTO sticker_business_units (sticker_id, bu_id) VALUES (?, ?)')
      .bind(sticker.id, buId)
      .run();
  }
}

/** Baris `manual_book_versions` uji (stiker dan konfigurasi QR harus sudah di-seed pemanggil bila diperlukan). */
export async function seedManualBookVersion(
  env: Pick<Env, 'DB'>,
  version: {
    stickerId: string;
    designId: string;
    version: number;
    contentHash?: string;
    contentSnapshot?: string;
    reason?: string;
  },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO manual_book_versions (sticker_id, design_id, version, content_hash, content_snapshot, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      version.stickerId,
      version.designId,
      version.version,
      version.contentHash ?? `hash-${version.version}`,
      version.contentSnapshot ?? '{}',
      version.reason ?? '',
      SEED_TIME,
      'seed',
    )
    .run();
}
