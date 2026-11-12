import type { Env } from '@server/core/env';
import { normalizeKey } from '@shared/items';

const SEED_TIME = '2026-11-11T00:00:00.000Z';

export interface SeedPostelNumber {
  id?: string;
  number: string;
  /** Tanggal 'YYYY-MM-DD'. */
  expiresOn: string;
  link?: string;
  /** Bawaan 1..n menurut urutan. */
  seq?: number;
  alertSentThreshold?: number | null;
  alertSentOn?: string;
}

export interface SeedPostelInput {
  id?: string;
  note?: string;
  attachments?: string[];
  /** Item (sudah di-seed) yang ditautkan: mengisi `items.postel_id`. */
  itemIds?: string[];
  numbers: SeedPostelNumber[];
}

/** Catatan Postel uji beserta nomor dan penunjuk item. Mengembalikan id catatan. */
export async function seedPostel(env: Pick<Env, 'DB'>, input: SeedPostelInput): Promise<string> {
  const id = input.id ?? `postel-${crypto.randomUUID()}`;
  // Upsert: `seedItem({ postelId })` sudah dapat membuat catatan kosong ber-id sama (kunci asing `items_postel_fk`).
  await env.DB.prepare(
    'INSERT INTO postels (id, note, attachments, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE note = VALUES(note), attachments = VALUES(attachments)',
  )
    .bind(
      id,
      input.note ?? '',
      JSON.stringify(input.attachments ?? []),
      SEED_TIME,
      SEED_TIME,
      'seed',
    )
    .run();
  for (const [index, entry] of input.numbers.entries()) {
    await env.DB.prepare(
      'INSERT INTO postel_numbers (id, postel_id, number, number_key, expires_on, link, seq, alert_sent_threshold, alert_sent_on, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        entry.id ?? `${id}-n${index + 1}`,
        id,
        entry.number,
        normalizeKey(entry.number),
        entry.expiresOn,
        entry.link ?? '',
        entry.seq ?? index + 1,
        entry.alertSentThreshold ?? null,
        entry.alertSentOn ?? '',
        SEED_TIME,
        SEED_TIME,
        'seed',
      )
      .run();
  }
  for (const itemId of input.itemIds ?? []) {
    await env.DB.prepare('UPDATE items SET postel_id = ? WHERE id = ?').bind(id, itemId).run();
  }
  return id;
}
