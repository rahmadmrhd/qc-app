import {
  capRows,
  cleanText,
  ctaButton,
  dataTable,
  EMAIL_ROW_LIMIT,
  fitEmail,
  moreNote,
  paragraph,
  renderEmailDocument,
  sectionHeading,
} from '@server/core/email-layout';
import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { sendableMailLists } from '@server/core/mail-lists';
import { liveWhere } from '@server/core/soft-delete';
import { wibHour } from '@server/modules/backup/names';
import type { DigestOutcome } from '@server/modules/sticker/digest';
import { mailListsCount } from '@shared/mail-lists';
import { alertDue, daysUntil, isPostelRecipient, postelName, wibDateIso } from '@shared/postel';
import { readPostelAlert } from './alert';
import { listItemsOfPostels } from './items';
import { listPostelNumbers, type PostelNumberRecord } from './repo';

/**
 * Email ringkasan masa berlaku Postel (tahap 4b, spek §3 butir 8): satu surel per putaran penjadwal jam-an berisi semua
 * nomor Aktif yang jatuh tempo menurut `alertDue` (`shared/postel.ts`). State peringatan per nomor (`alert_sent_*`)
 * DIKLAIM secara atomik (CAS) SEBELUM surel dikirim, jadi beberapa proses atas DB yang sama tidak mengirim dobel
 * (paling-banyak-sekali, sejalan ringkasan stok); bila pengiriman gagal klaim dipulihkan (juga CAS) agar dicoba lagi.
 * Isi surel TIDAK memuat nama atau jumlah item (keputusan pemilik; nama Postel hanya tipe item, spek §3 butir 16).
 */

interface DueNumber {
  record: PostelNumberRecord;
  daysLeft: number;
  /** Nilai `alert_sent_threshold` yang diklaim. */
  claimed: number;
}

/**
 * Mengklaim state satu nomor: berhasil hanya bila tanggal habis DAN state di basis data masih sama dengan yang dibaca
 * (CAS NULL-aman pada ambang) DAN nomor itu belum terhapus (catatannya dihapus lunak di antara pembacaan dan klaim) DAN nomor itu masih nomor Aktif catatannya (seq tertinggi; `postels.save` yang menambah
 * nomor baru di antara pembacaan dan klaim menjadikannya Lama, yang tak boleh dikirimi peringatan). Tanggal ikut dipin:
 * `postels.save` yang memperpanjang tanggal mengembalikan state ke NULL/'' (sama dengan nilai yang dibaca), jadi tanpa
 * pin klaim atas tanggal lama bisa lolos dan menahan peringatan tanggal baru. Hanya satu pemanggil serentak yang
 * mendapat `true`.
 */
async function claimNumber(env: Env, due: DueNumber, today: string): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE postel_numbers SET alert_sent_threshold = ?, alert_sent_on = ? WHERE id = ? AND expires_on = ? AND alert_sent_on = ? AND alert_sent_threshold <=> ? AND ${liveWhere()} AND seq = (SELECT MAX(n2.seq) FROM postel_numbers n2 WHERE n2.postel_id = postel_numbers.postel_id)`,
  )
    .bind(
      due.claimed,
      today,
      due.record.id,
      due.record.expiresOn,
      due.record.alertSentOn,
      due.record.alertSentThreshold,
    )
    .run();
  return result.meta.changes === 1;
}

/**
 * Mengembalikan klaim ke state lama, hanya bila tanggal dan state masih nilai klaim kita (tidak menimpa klaim pihak lain
 * atas tanggal yang sudah diperpanjang).
 */
async function releaseNumber(env: Env, due: DueNumber, today: string): Promise<void> {
  await env.DB.prepare(
    'UPDATE postel_numbers SET alert_sent_threshold = ?, alert_sent_on = ? WHERE id = ? AND expires_on = ? AND alert_sent_on = ? AND alert_sent_threshold <=> ?',
  )
    .bind(
      due.record.alertSentThreshold,
      due.record.alertSentOn,
      due.record.id,
      due.record.expiresOn,
      today,
      due.claimed,
    )
    .run();
}

export interface PostelAlertItem {
  id: string;
  /** Nama Postel turunan (tipe item); kosong = pakai nomor sertifikat. */
  name: string;
  number: string;
  expiresOn: string;
  daysLeft: number;
}

function remainingText(daysLeft: number): string {
  return daysLeft < 0 ? 'sudah kedaluwarsa' : `sisa ${daysLeft} hari`;
}

function statusLabel(daysLeft: number): string {
  if (daysLeft < 0) return `Kedaluwarsa ${-daysLeft} hari lalu`;
  return daysLeft === 0 ? 'Habis hari ini' : `Sisa ${daysLeft} hari`;
}

/**
 * Subjek, teks polos, dan HTML peringatan Postel (murni, tanpa DB). Dua bagian terpisah (sudah kedaluwarsa dan segera
 * habis), masing-masing urut sisa hari menaik dan dibatasi `EMAIL_ROW_LIMIT` baris. Subjek tidak berubah dari surel
 * teks lama. Tanpa nama atau jumlah item selain nama Postel turunan.
 */
export function buildPostelAlertMail(input: {
  origin: string;
  items: readonly PostelAlertItem[];
}): {
  subject: string;
  text: string;
  html: string;
} {
  const origin = input.origin.replace(/\/+$/, '');
  const sorted = [...input.items].sort(
    (a, b) => a.daysLeft - b.daysLeft || (a.number < b.number ? -1 : a.number > b.number ? 1 : 0),
  );
  const expired = sorted.filter((item) => item.daysLeft < 0);
  const soon = sorted.filter((item) => item.daysLeft >= 0);
  const subject = `Peringatan masa berlaku Postel: ${sorted.length} sertifikat`;
  const nameOf = (item: PostelAlertItem) => {
    const number = cleanText(item.number);
    const name = cleanText(item.name, 120);
    return { number, name: name === '' ? number : name };
  };

  const build = (limit: number) => {
    const parts: string[] = [];
    const body: string[] = [];
    const listUrl = origin === '' ? '' : `${origin}/postel`;
    const groups = [
      { title: 'Sudah kedaluwarsa', tone: 'bad' as const, rows: expired },
      { title: 'Segera habis', tone: 'warn' as const, rows: soon },
    ];
    for (const group of groups) {
      if (group.rows.length === 0) continue;
      const { shown, more } = capRows(group.rows, limit);
      const blocks = shown.map((item) => {
        const { number, name } = nameOf(item);
        const lines = [
          `- ${name}`,
          `  Nomor sertifikat: ${number}`,
          `  Berlaku sampai: ${cleanText(item.expiresOn)} (${remainingText(item.daysLeft)})`,
        ];
        if (origin !== '') lines.push(`  ${origin}/postel/${cleanText(item.id)}`);
        return lines.join('\n');
      });
      parts.push(
        `${group.title} (${group.rows.length}):\n\n${blocks.join('\n\n')}${more > 0 ? `\n\ndan ${more} lainnya` : ''}`,
      );
      body.push(
        sectionHeading(group.title, group.tone, group.rows.length),
        dataTable(
          [
            { label: 'Postel' },
            { label: 'Nomor sertifikat', width: 150 },
            { label: 'Berlaku sampai', width: 90 },
            { label: 'Status', width: 140 },
          ],
          shown.map((item) => {
            const { number, name } = nameOf(item);
            return [
              {
                text: name,
                href: origin === '' ? undefined : `${origin}/postel/${cleanText(item.id)}`,
              },
              number,
              item.expiresOn,
              { badge: statusLabel(item.daysLeft), tone: group.tone },
            ];
          }),
        ),
        moreNote(more),
      );
    }
    body.unshift(
      paragraph('Sertifikat Postel berikut perlu perhatian.', { muted: true, size: 13 }),
    );
    body.push(ctaButton(listUrl, 'Buka daftar Postel'));
    const text = `Sertifikat Postel berikut perlu perhatian:\n\n${parts.join('\n\n')}\n`;
    const html = renderEmailDocument({
      title: 'Peringatan masa berlaku Postel',
      preheader: subject,
      body,
    });
    return { text, html };
  };
  const { text, html } = fitEmail(build);
  return { subject, text, html };
}

export async function checkPostelExpiryDigest(env: Env): Promise<DigestOutcome> {
  const mailer = env.MAILER;
  if (!mailer) return 'skipped';
  const { alert } = await readPostelAlert(env);
  // Data lama dapat memuat entri yang bukan satu alamat polos (spek 4b §3 butir 8): hanya yang lolos yang dikirimi.
  const lists = sendableMailLists(alert, isPostelRecipient);
  if (!alert.enabled || mailListsCount(lists) === 0) return 'skipped';
  const now = nowOf(env);
  if (wibHour(now) < alert.sendHour) return 'skipped';
  const today = wibDateIso(now);

  // Hanya nomor Aktif (seq terbesar tiap catatan); urut `postel_id, seq` sehingga yang terakhir tiap catatan = Aktif.
  const active = new Map<string, PostelNumberRecord>();
  for (const record of await listPostelNumbers(env.DB)) active.set(record.postelId, record);
  const candidates: DueNumber[] = [];
  for (const record of active.values()) {
    const daysLeft = daysUntil(record.expiresOn, today);
    const claimed = alertDue({
      daysLeft,
      thresholds: alert.thresholds,
      repeatEveryDays: alert.repeatEveryDays,
      sentThreshold: record.alertSentThreshold,
      sentOn: record.alertSentOn,
      today,
    });
    if (claimed !== null) candidates.push({ record, daysLeft, claimed });
  }
  if (candidates.length === 0) return 'skipped';

  // Paling mendesak lebih dulu, dan paling banyak `EMAIL_ROW_LIMIT` nomor yang diklaim per surel: nomor yang tak
  // muat tidak ditandai terkirim, jadi ikut putaran jam-an berikutnya (bukan hilang diam-diam di "dan N lainnya").
  candidates.sort(
    (a, b) =>
      a.daysLeft - b.daysLeft ||
      (a.record.number < b.record.number ? -1 : a.record.number > b.record.number ? 1 : 0),
  );
  const won: DueNumber[] = [];
  for (const candidate of candidates) {
    if (won.length >= EMAIL_ROW_LIMIT) break;
    if (await claimNumber(env, candidate, today)) won.push(candidate);
  }
  if (won.length === 0) return 'skipped';

  // Setelah klaim: gagal membaca nama (mis. DB putus) memulihkan klaim agar putaran berikut mencoba lagi.
  const release = async (reason: unknown) => {
    for (const due of won) {
      await releaseNumber(env, due, today).catch((releaseError: unknown) => {
        console.error(
          `peringatan: klaim peringatan Postel ${due.record.id} gagal dikembalikan; surel nomor ini dapat terlewat: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
        );
      });
    }
    console.error(
      `peringatan: email masa berlaku Postel gagal terkirim, dicoba lagi nanti: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  };

  try {
    won.sort(
      (a, b) =>
        a.daysLeft - b.daysLeft ||
        (a.record.number < b.record.number ? -1 : a.record.number > b.record.number ? 1 : 0),
    );
    const itemsByPostel = await listItemsOfPostels(
      env.DB,
      won.map((due) => due.record.postelId),
    );
    const mail = buildPostelAlertMail({
      origin: env.APP_ORIGIN ?? '',
      items: won.map((due) => ({
        id: due.record.postelId,
        name: postelName((itemsByPostel.get(due.record.postelId) ?? []).map((item) => item.model)),
        number: due.record.number,
        expiresOn: due.record.expiresOn,
        daysLeft: due.daysLeft,
      })),
    });
    await mailer.send({
      to: lists.recipients,
      cc: lists.cc,
      bcc: lists.bcc,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  } catch (error) {
    await release(error);
    return 'failed';
  }
  return 'sent';
}
