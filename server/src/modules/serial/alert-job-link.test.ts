import { describe, expect, test } from 'bun:test';
import { reportLinkExpiresAt } from '@shared/serials';
import { reportLinkBaseDate, type SerialBrokenSnapshot, serialBrokenMail } from './alert-job';

// Dasar kedaluwarsa tautan publik = waktu SERVER saat laporan ditutup, bukan tanggal kejadian pilihan pengguna
// (keputusan pemilik 2026-11-23). Murni, tanpa basis data.
describe('reportLinkBaseDate', () => {
  test('tanggal kejadian mundur jauh: dasar = tanggal WIB penutupan di server', () => {
    // Ditutup 2026-11-23 10:00 WIB (03:00Z) dengan tanggal kejadian 45 hari lalu.
    expect(reportLinkBaseDate('2026-10-09', '2026-11-23T03:00:00.000Z')).toBe('2026-11-23');
  });

  test('batas hari WIB: 17:00Z sudah hari berikutnya di WIB', () => {
    expect(reportLinkBaseDate('2026-11-23', '2026-11-23T17:30:00.000Z')).toBe('2026-11-24');
  });

  test('tanggal kejadian sama atau lebih akhir dari penutupan server: tanggal kejadian dipakai', () => {
    expect(reportLinkBaseDate('2026-11-23', '2026-11-23T03:00:00.000Z')).toBe('2026-11-23');
    expect(reportLinkBaseDate('2026-11-25', '2026-11-23T03:00:00.000Z')).toBe('2026-11-25');
  });

  test('updated_at tak terbaca: jatuh ke tanggal kejadian; laporan belum tertutup: kosong (tanpa tautan)', () => {
    expect(reportLinkBaseDate('2026-11-12', 't')).toBe('2026-11-12');
    expect(reportLinkBaseDate('2026-11-12', '')).toBe('2026-11-12');
    expect(reportLinkBaseDate('', '2026-11-23T03:00:00.000Z')).toBe('');
    expect(
      Number.isFinite(reportLinkExpiresAt(reportLinkBaseDate('', '2026-11-23T03:00:00.000Z'))),
    ).toBe(false);
  });

  test('tautan tidak langsung kedaluwarsa untuk kejadian bertanggal lama', () => {
    const expiresAt = reportLinkExpiresAt(
      reportLinkBaseDate('2026-09-01', '2026-11-23T03:00:00.000Z'),
    );
    expect(expiresAt).toBeGreaterThan(Date.parse('2026-11-23T03:00:00.000Z'));
  });
});

describe('serialBrokenMail (HTML)', () => {
  const base: SerialBrokenSnapshot = {
    serial: 'SN-1',
    buCode: 'WFI',
    buName: 'Wifi',
    itemLabel: 'Ruijie EG105',
    itemModel: 'EG105',
    caseNumber: 'LP/WFI/2611-0007',
    locationName: 'Gudang QC',
    reportedOn: '2026-11-20',
    brokenOn: '2026-11-25',
    actorName: 'budi.santoso@contoh.co.id',
    note: 'Port **mati**\n\n- LED padam\n\n![f](x.png)',
    link: 'https://qc.test/laporan/v1.abc.123.sig',
    linkExpiresOn: '2027-01-24',
  };
  const FORBIDDEN = /<(script|img|link|iframe|object|embed|form)\b|javascript:/i;

  test('html + teks polos; lencana Rusak, kunci-nilai, catatan per baris, tombol dan masa berlaku', () => {
    const mail = serialBrokenMail(base);
    expect(mail.html).toContain('<html lang="id">');
    expect(mail.html).toContain('Rusak');
    for (const value of [
      'SN-1',
      'Ruijie EG105',
      'WFI - Wifi',
      'LP/WFI/2611-0007',
      'Gudang QC',
      'budi.santoso',
    ]) {
      expect(mail.html).toContain(value);
    }
    expect(mail.html).not.toContain('contoh.co.id');
    expect(mail.html).toContain('LED padam');
    expect(mail.html).toContain('<br>');
    expect(mail.html).toContain('(1 gambar, lihat di tautan)');
    expect(mail.html).toContain('href="https://qc.test/laporan/v1.abc.123.sig"');
    expect(mail.html).toContain('Buka laporan');
    expect(mail.html).toContain('Tautan berlaku sampai 2027-01-24.');
    expect(mail.html).not.toMatch(FORBIDDEN);
    expect(mail.text).toContain('Buka: https://qc.test/laporan/v1.abc.123.sig');
    expect(mail.text).toContain('Tautan berlaku sampai 2027-01-24.');
  });

  test('tanpa tautan: tanpa tombol; nilai berbahaya tidak bocor', () => {
    const mail = serialBrokenMail({
      ...base,
      link: '',
      linkExpiresOn: '',
      serial: '<script>x</script>‮\u0007\nBcc: a@b.co',
      note: '<img src=x onerror=alert(1)>\nbaris‮dua',
    });
    expect(mail.html).not.toContain('href=');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img');
    expect(mail.html).not.toContain('‮');
    expect(mail.html).not.toContain('\u0007');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.subject).not.toMatch(/[\r\n]/);
    const styles = [...mail.html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
    expect(styles).toHaveLength(1);
    expect(styles[0]?.[1]).toStartWith('@media');
  });
});
