import type { DbStatement } from '@server/core/db';
import { ctaButton, kvTable, paragraph, renderEmailDocument } from '@server/core/email-layout';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { newId } from '@server/core/id';
import { sendableMailLists } from '@server/core/mail-lists';
import { liveWhere } from '@server/core/soft-delete';
import { insertJobStmt } from '@server/modules/jobs/repo';
import { JOB_SYSTEM_ACTOR } from '@server/modules/jobs/service';
import { formatBuLabel } from '@shared/business-units';
import { mailListsCount } from '@shared/mail-lists';
import { markdownToPlain } from '@shared/markdown-plain';
import { isPostelRecipient, stripControlChars, wibDateIso } from '@shared/postel';
import { publicActorName, reportLinkExpiresAt } from '@shared/serials';
import type { JobHandler, StepOutcome } from '../jobs/consumer';
import { readSerialAlert } from './alert';
import { signReportToken } from './public-link';

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
    id: newId(),
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
  /** Tipe item (`items.model`), dipakai pada subjek. */
  itemModel: string;
  caseNumber: string;
  /** Nama lokasi unit saat dinyatakan rusak. */
  locationName: string;
  /** Tanggal laporan dibuka dan tanggal dinyatakan rusak (`YYYY-MM-DD`). */
  reportedOn: string;
  brokenOn: string;
  /** Nama pelaku yang menyatakan rusak (bukan alamat surelnya). */
  actorName: string;
  /** Catatan Markdown kejadian "Rusak" apa adanya; diubah ke teks polos saat surel dirakit. */
  note: string;
  /** Kosong bila `APP_ORIGIN` atau rahasia sesi tak tersedia. */
  link: string;
  /** Tanggal (WIB) tautan berlaku sampai; kosong bila tanpa tautan. */
  linkExpiresOn: string;
}

/**
 * Subjek dan badan teks polos (rancangan 2026-11-14 §4.7, menggantikan OQ-13 pemilik 2026-11-14): memuat item, BU,
 * nomor LP, lokasi unit, tanggal, nama pelaku, dan catatan penuh (Markdown menjadi teks; gambar dijelaskan jumlahnya),
 * serta tautan bertanda tangan. TANPA angka stok dan alamat surel pengguna. Setiap nilai dibersihkan dari karakter
 * kontrol/pengatur arah teks (catatan per baris agar susunan baris tetap) sehingga tak menyisipkan header atau menyamarkan
 * teks.
 */
export function serialBrokenMail(snapshot: SerialBrokenSnapshot): {
  subject: string;
  text: string;
  html: string;
} {
  const clean = (value: string) => stripControlChars(value);
  const { text: plain, imageCount } = markdownToPlain(snapshot.note);
  const noteLines = plain
    .split(/\r?\n/)
    .map((line) => clean(line).trimEnd())
    .join('\n')
    .trim();
  const lines = [
    'Ada Serial Number yang dinyatakan rusak.',
    '',
    `Serial Number: ${clean(snapshot.serial)}`,
    `Item: ${clean(snapshot.itemLabel)}`,
    `BU: ${formatBuLabel({ code: clean(snapshot.buCode), name: clean(snapshot.buName) })}`,
    `Nomor LP: ${clean(snapshot.caseNumber)}`,
    `Lokasi unit: ${clean(snapshot.locationName)}`,
    `Dilaporkan: ${clean(snapshot.reportedOn)}`,
    `Dinyatakan rusak: ${clean(snapshot.brokenOn)}`,
    `Oleh: ${clean(publicActorName(snapshot.actorName))}`,
    '',
    'Catatan:',
    noteLines === '' ? '-' : noteLines,
  ];
  if (imageCount > 0) lines.push(`(${imageCount} gambar, lihat di tautan)`);
  if (snapshot.link !== '') {
    lines.push('', `Buka: ${clean(snapshot.link)}`);
    if (snapshot.linkExpiresOn !== '') {
      lines.push(`Tautan berlaku sampai ${clean(snapshot.linkExpiresOn)}.`);
    }
  }
  const body = [
    paragraph('Ada Serial Number yang dinyatakan rusak.'),
    '<div style="height:10px;line-height:10px;font-size:0">&nbsp;</div>',
    kvTable([
      { label: 'Serial Number', value: snapshot.serial },
      { label: 'Item', value: snapshot.itemLabel },
      { label: 'BU', value: formatBuLabel({ code: snapshot.buCode, name: snapshot.buName }) },
      { label: 'Nomor LP', value: snapshot.caseNumber },
      { label: 'Lokasi unit', value: snapshot.locationName },
      { label: 'Dilaporkan', value: snapshot.reportedOn },
      { label: 'Dinyatakan rusak', value: snapshot.brokenOn },
      { label: 'Oleh', value: publicActorName(snapshot.actorName) },
    ]),
    '<div style="height:8px;line-height:8px;font-size:0">&nbsp;</div>',
    paragraph('Catatan', { muted: true, size: 13 }),
    paragraph(noteLines === '' ? '-' : noteLines),
    ...(imageCount > 0
      ? [paragraph(`(${imageCount} gambar, lihat di tautan)`, { muted: true, size: 13 })]
      : []),
    ...(snapshot.link !== ''
      ? [
          ctaButton(snapshot.link, 'Buka laporan'),
          ...(snapshot.linkExpiresOn !== ''
            ? [
                `<div style="text-align:center">${paragraph(`Tautan berlaku sampai ${snapshot.linkExpiresOn}.`, { muted: true, size: 12 })}</div>`,
              ]
            : []),
        ]
      : []),
  ];
  const html = renderEmailDocument({
    title: 'Serial Number rusak',
    preheader: `${snapshot.serial}, ${snapshot.itemLabel}, ${snapshot.buCode}: dinyatakan rusak`,
    headerBadge: { text: 'Rusak', tone: 'bad' },
    body,
  });
  return {
    subject: `Serial Number rusak: ${clean(snapshot.serial)} (${clean(snapshot.itemModel)}, ${clean(snapshot.buCode)})`,
    text: `${lines.join('\n')}\n`,
    html,
  };
}

interface SnapshotRow {
  serial: string;
  bu_code: string;
  bu_name: string;
  brand_name: string | null;
  model: string | null;
  location_name: string | null;
  case_number: string | null;
  opened_on: string | null;
  closed_on: string | null;
  case_updated_at: string | null;
  occurred_on: string | null;
  actor_name: string | null;
  message: string | null;
}

async function loadSnapshot(
  env: Env,
  input: SerialAlertJobInput,
): Promise<SerialBrokenSnapshot | null> {
  const row = await env.DB.prepare(
    `SELECT s.serial, bu.code AS bu_code, bu.name AS bu_name, b.name AS brand_name, i.model, l.name AS location_name, c.number AS case_number, c.opened_on, c.closed_on, c.updated_at AS case_updated_at, e.occurred_on, e.actor_name, e.message FROM serials s JOIN business_units bu ON bu.id = s.bu_id LEFT JOIN items i ON i.id = s.item_id LEFT JOIN brands b ON b.id = i.brand_id LEFT JOIN locations l ON l.id = s.location_id LEFT JOIN serial_cases c ON c.id = ? AND c.serial_id = s.id LEFT JOIN serial_events e ON e.id = ? AND e.serial_id = s.id WHERE ${liveWhere('s')} AND s.id = ?`,
  )
    .bind(input.caseId, input.eventId, input.serialId)
    .first<SnapshotRow>();
  if (!row) return null;
  const origin = env.APP_ORIGIN?.replace(/\/+$/, '') ?? '';
  // Dasar kedaluwarsa = waktu SERVER saat laporan ditutup (`updated_at` diset `now` oleh penutupan), bukan tanggal
  // kejadian pilihan pengguna (bisa mundur jauh sehingga tautan langsung kedaluwarsa); keputusan pemilik 2026-11-23.
  const expiresAt = reportLinkExpiresAt(
    reportLinkBaseDate((row.closed_on ?? '').trim(), row.case_updated_at ?? ''),
  );
  // Tanpa tautan bila origin, rahasia sesi, atau tanggal penutupan laporan tak tersedia; surel tetap terkirim.
  let link = '';
  let linkExpiresOn = '';
  if (origin !== '' && env.SESSION_SECRET && Number.isFinite(expiresAt)) {
    const token = await signReportToken(env.SESSION_SECRET, input.caseId, expiresAt);
    link = `${origin}/laporan/${token}`;
    linkExpiresOn = wibDateIso(expiresAt);
  }
  return {
    serial: row.serial,
    buCode: row.bu_code,
    buName: row.bu_name,
    itemLabel: `${row.brand_name ?? ''} ${(row.model ?? '').trim()}`.trim(),
    itemModel: (row.model ?? '').trim(),
    caseNumber: row.case_number ?? '',
    locationName: row.location_name ?? '',
    reportedOn: row.opened_on ?? '',
    brokenOn: row.occurred_on ?? '',
    actorName: row.actor_name ?? '',
    note: row.message ?? '',
    link,
    linkExpiresOn,
  };
}

/**
 * Tanggal dasar masa berlaku tautan: yang lebih akhir antara `closed_on` (tanggal kejadian) dan tanggal WIB penutupan
 * di server (`updated_at` laporan). Kosong bila laporan belum tertutup (`closed_on` kosong).
 */
export function reportLinkBaseDate(closedOn: string, caseUpdatedAt: string): string {
  if (closedOn === '') return '';
  const stamp = Date.parse(caseUpdatedAt);
  if (!Number.isFinite(stamp)) return closedOn;
  const serverDate = wibDateIso(stamp);
  return serverDate > closedOn ? serverDate : closedOn;
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
    const lists = sendableMailLists(alert, isPostelRecipient);
    if (!alert.enabled || mailListsCount(lists) === 0) {
      return { progress: 100, done: { result: 'skipped' } };
    }
    const snapshot = await loadSnapshot(env, input);
    if (!snapshot) return { progress: 100, done: { result: 'skipped' } };
    const mail = serialBrokenMail(snapshot);
    await mailer.send({
      to: lists.recipients,
      cc: lists.cc,
      bcc: lists.bcc,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return { progress: 100, done: { result: 'sent' } };
  },
};
