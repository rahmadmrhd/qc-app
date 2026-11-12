import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { wibHour } from '@server/modules/backup/names';
import type { DigestOutcome } from '@server/modules/sticker/digest';
import {
  alertDue,
  daysUntil,
  isPostelRecipient,
  postelName,
  stripControlChars,
  wibDateIso,
} from '@shared/postel';
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
 * (CAS NULL-aman pada ambang) DAN nomor itu masih nomor Aktif catatannya (seq tertinggi; `postels.save` yang menambah
 * nomor baru di antara pembacaan dan klaim menjadikannya Lama, yang tak boleh dikirimi peringatan). Tanggal ikut dipin:
 * `postels.save` yang memperpanjang tanggal mengembalikan state ke NULL/'' (sama dengan nilai yang dibaca), jadi tanpa
 * pin klaim atas tanggal lama bisa lolos dan menahan peringatan tanggal baru. Hanya satu pemanggil serentak yang
 * mendapat `true`.
 */
async function claimNumber(env: Env, due: DueNumber, today: string): Promise<boolean> {
  const result = await env.DB.prepare(
    'UPDATE postel_numbers SET alert_sent_threshold = ?, alert_sent_on = ? WHERE id = ? AND expires_on = ? AND alert_sent_on = ? AND alert_sent_threshold <=> ? AND seq = (SELECT MAX(n2.seq) FROM postel_numbers n2 WHERE n2.postel_id = postel_numbers.postel_id)',
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

function remainingText(daysLeft: number): string {
  return daysLeft < 0 ? 'sudah kedaluwarsa' : `sisa ${daysLeft} hari`;
}

export async function checkPostelExpiryDigest(env: Env): Promise<DigestOutcome> {
  const mailer = env.MAILER;
  if (!mailer) return 'skipped';
  const { alert } = await readPostelAlert(env);
  // Data lama dapat memuat entri yang bukan satu alamat polos (spek 4b §3 butir 8): hanya yang lolos yang dikirimi.
  const recipients = alert.recipients.filter(isPostelRecipient);
  if (!alert.enabled || recipients.length === 0) return 'skipped';
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

  const won: DueNumber[] = [];
  for (const candidate of candidates) {
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
    const origin = env.APP_ORIGIN?.replace(/\/+$/, '') ?? '';
    const blocks = won.map((due) => {
      const { record } = due;
      // Nomor dan nama disanitasi: baris tersimpan lama dapat memuat baris baru yang memecah badan surel.
      const number = stripControlChars(record.number);
      const name = stripControlChars(
        postelName((itemsByPostel.get(record.postelId) ?? []).map((item) => item.model)),
      );
      const lines = [
        `- ${name === '' ? number : name}`,
        `  Nomor sertifikat: ${number}`,
        `  Berlaku sampai: ${record.expiresOn} (${remainingText(due.daysLeft)})`,
      ];
      if (origin !== '') lines.push(`  ${origin}/postel/${record.postelId}`);
      return lines.join('\n');
    });
    await mailer.send({
      to: recipients,
      subject: `Peringatan masa berlaku Postel: ${won.length} sertifikat`,
      text: `Sertifikat Postel berikut perlu perhatian:\n\n${blocks.join('\n\n')}\n`,
    });
  } catch (error) {
    await release(error);
    return 'failed';
  }
  return 'sent';
}
