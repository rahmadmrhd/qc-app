import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { insertJobStmt } from '@server/modules/jobs/repo';
import { JOB_SYSTEM_ACTOR } from '@server/modules/jobs/service';
import { isPostelRecipient, stripControlChars } from '@shared/postel';
import type { JobHandler, StepOutcome } from '../jobs/consumer';
import { readSerialAlert } from './alert';

/**
 * Surel "Serial Number rusak" (tahap 5b, spek §4.6) lewat antrean job: aksi `declare_broken` memasang baris job ke
 * `batch()`-nya sendiri (atomik; `alert-listener.ts`), dan runner mengirimnya di luar permintaan pengguna. Gagal kirim
 * diulang runner (3x) lalu job `failed`; aksi pengguna tidak terpengaruh. Pengaturan dibaca SAAT KIRIM, bukan saat
 * aksi, jadi mematikan sakelar menahan surel yang masih antre.
 */
export interface SerialAlertJobInput {
  serialId: string;
  caseId: string;
  eventId: string;
}

/** Pernyataan `INSERT` job `serial_alert` (dibuat sistem). */
export function serialAlertJobStmt(env: Env, input: SerialAlertJobInput): DbStatement {
  const now = nowIso(env);
  return insertJobStmt(env.DB, {
    id: crypto.randomUUID(),
    kind: 'serial_alert',
    status: 'queued',
    progress: 0,
    result: '',
    error: '',
    createdBy: JOB_SYSTEM_ACTOR,
    createdAt: now,
    updatedAt: now,
    input: JSON.stringify(input),
    state: '',
    step: 0,
    leaseUntil: 0,
  });
}

export interface SerialBrokenSnapshot {
  serial: string;
  buCode: string;
  buName: string;
  itemLabel: string;
  damage: string;
  caseNumber: string;
  occurredOn: string;
  /** Kosong bila `APP_ORIGIN` tak diatur. */
  link: string;
}

/**
 * Subjek dan badan teks polos. SENGAJA tanpa pesan Markdown kejadian, nama atau email pelaku, dan angka stok (keputusan
 * pemilik, OQ-13). Setiap nilai dibersihkan dari karakter kontrol agar tak memecah baris badan atau menyisipkan header.
 */
export function serialBrokenMail(snapshot: SerialBrokenSnapshot): {
  subject: string;
  text: string;
} {
  const clean = (value: string) => stripControlChars(value);
  const lines = [
    'Ada Serial Number yang dinyatakan rusak.',
    '',
    `Serial Number: ${clean(snapshot.serial)}`,
    `BU: ${clean(snapshot.buName)} (${clean(snapshot.buCode)})`,
    `Item: ${clean(snapshot.itemLabel)}`,
    `Kerusakan: ${clean(snapshot.damage)}`,
    `Nomor kasus: ${clean(snapshot.caseNumber)}`,
    `Tanggal: ${clean(snapshot.occurredOn)}`,
  ];
  if (snapshot.link !== '') lines.push('', `Buka: ${snapshot.link}`);
  return {
    subject: `Serial Number rusak: ${clean(snapshot.serial)} (${clean(snapshot.buCode)})`,
    text: `${lines.join('\n')}\n`,
  };
}

interface SnapshotRow {
  serial: string;
  bu_code: string;
  bu_name: string;
  brand_name: string | null;
  model: string | null;
  damage: string | null;
  case_number: string | null;
  occurred_on: string | null;
}

async function loadSnapshot(
  env: Env,
  input: SerialAlertJobInput,
): Promise<SerialBrokenSnapshot | null> {
  const row = await env.DB.prepare(
    'SELECT s.serial, bu.code AS bu_code, bu.name AS bu_name, b.name AS brand_name, i.model, c.damage, c.number AS case_number, e.occurred_on FROM serials s JOIN business_units bu ON bu.id = s.bu_id LEFT JOIN items i ON i.id = s.item_id LEFT JOIN brands b ON b.id = i.brand_id LEFT JOIN serial_cases c ON c.id = ? AND c.serial_id = s.id LEFT JOIN serial_events e ON e.id = ? AND e.serial_id = s.id WHERE s.id = ?',
  )
    .bind(input.caseId, input.eventId, input.serialId)
    .first<SnapshotRow>();
  if (!row) return null;
  const origin = env.APP_ORIGIN?.replace(/\/+$/, '') ?? '';
  return {
    serial: row.serial,
    buCode: row.bu_code,
    buName: row.bu_name,
    itemLabel: `${row.brand_name ?? ''} ${(row.model ?? '').trim()}`.trim(),
    damage: row.damage ?? '',
    caseNumber: row.case_number ?? '',
    occurredOn: row.occurred_on ?? '',
    link: origin === '' ? '' : `${origin}/serial/${input.serialId}`,
  };
}

function parseInput(text: string): SerialAlertJobInput | null {
  try {
    const value = JSON.parse(text) as Partial<SerialAlertJobInput> | null;
    if (
      typeof value?.serialId === 'string' &&
      typeof value.caseId === 'string' &&
      typeof value.eventId === 'string'
    ) {
      return { serialId: value.serialId, caseId: value.caseId, eventId: value.eventId };
    }
  } catch {
    // jatuh ke null
  }
  return null;
}

/**
 * Satu langkah: sakelar mati, tanpa penerima, atau SMTP belum diatur = `skipped`; selainnya satu surel ke semua
 * penerima. Penerima tersimpan yang bukan satu alamat polos dibuang (data lama). Galat kirim DILEMPAR (runner mengulang
 * sampai `JOB_MAX_ATTEMPTS` lalu job `failed`); galat non-AppError dianggap sementara oleh runner.
 */
export const serialAlertHandler: JobHandler = {
  async run(ctx): Promise<StepOutcome> {
    const { env } = ctx;
    const input = parseInput(ctx.job.input);
    const mailer = env.MAILER;
    if (!input || !mailer) return { progress: 100, done: { result: 'skipped' } };
    const { alert } = await readSerialAlert(env);
    const recipients = alert.recipients.filter(isPostelRecipient);
    if (!alert.enabled || recipients.length === 0) {
      return { progress: 100, done: { result: 'skipped' } };
    }
    const snapshot = await loadSnapshot(env, input);
    if (!snapshot) return { progress: 100, done: { result: 'skipped' } };
    const mail = serialBrokenMail(snapshot);
    await mailer.send({ to: recipients, subject: mail.subject, text: mail.text });
    return { progress: 100, done: { result: 'sent' } };
  },
};
