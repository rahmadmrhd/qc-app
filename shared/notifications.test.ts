import { describe, expect, test } from 'bun:test';
import type { HandoverStatus } from './handover';
import {
  CHECK_WINDOW_MS,
  type HandoverSnap,
  handoverEventsOf,
  NOTIFICATION_KINDS,
  NOTIFICATION_PREVIEW_MAX,
  NOTIFICATION_RETENTION_DAYS,
  NOTIFICATION_SIDE,
  type NotificationDto,
  notificationPreviewText,
  notificationTitle,
  pushPayloadOf,
} from './notifications';

function snap(status: HandoverStatus, overrides: Partial<HandoverSnap> = {}): HandoverSnap {
  return { status, customerId: 'c1', note: '- [ ] a', ...overrides };
}

describe('handoverEventsOf', () => {
  test('create menghasilkan created', () => {
    expect(handoverEventsOf('create', null, snap('new'))).toEqual(['created']);
  });

  test('save: updated hanya bila catatan atau customer berubah', () => {
    expect(handoverEventsOf('save', snap('new'), snap('new', { note: '- [ ] b' }))).toEqual([
      'updated',
    ]);
    expect(handoverEventsOf('save', snap('new'), snap('new', { customerId: 'c2' }))).toEqual([
      'updated',
    ]);
    expect(handoverEventsOf('save', snap('new'), snap('new'))).toEqual([]);
  });

  test('save yang mengubah catatan sekaligus menyelesaikan task: updated lalu done', () => {
    expect(
      handoverEventsOf('save', snap('in_progress'), snap('done', { note: '- [x] a' })),
    ).toEqual(['updated', 'done']);
  });

  test('save tanpa perubahan catatan tetapi status berubah jadi done: hanya done', () => {
    expect(handoverEventsOf('save', snap('in_progress'), snap('done'))).toEqual(['done']);
  });

  test('check: checked tanpa transisi, hanya done bila menyelesaikan task', () => {
    expect(handoverEventsOf('check', snap('new'), snap('in_progress'))).toEqual(['checked']);
    expect(handoverEventsOf('check', snap('in_progress'), snap('done'))).toEqual(['done']);
  });

  test('check yang melepas centang task Selesai tetap checked, bukan dibuka kembali', () => {
    expect(handoverEventsOf('check', snap('done'), snap('in_progress'))).toEqual(['checked']);
  });

  test('done: hanya bila ada transisi ke Selesai', () => {
    expect(handoverEventsOf('done', snap('new'), snap('done'))).toEqual(['done']);
    expect(handoverEventsOf('done', snap('done'), snap('done'))).toEqual([]);
  });

  test('cancel, reopen, comment', () => {
    expect(handoverEventsOf('cancel', snap('new'), snap('cancelled'))).toEqual(['cancelled']);
    expect(handoverEventsOf('reopen', snap('cancelled'), snap('new'))).toEqual(['reopened']);
    expect(handoverEventsOf('comment', snap('new'), snap('new'))).toEqual(['commented']);
  });

  test('tanpa keadaan sebelumnya, aksi selain create tidak menghasilkan kejadian', () => {
    expect(handoverEventsOf('save', null, snap('new'))).toEqual([]);
    expect(handoverEventsOf('check', null, snap('done'))).toEqual([]);
  });
});

describe('notificationTitle', () => {
  const base = { actor: 'Budi', number: 'ST-20261112-001', count: 3, customerName: 'PT Maju' };
  test('teks per jenis', () => {
    expect(notificationTitle({ ...base, kind: 'created' })).toBe(
      'Budi membuat task ST-20261112-001',
    );
    expect(notificationTitle({ ...base, kind: 'createdBatch', customerName: '' })).toBe(
      'Budi membuat 3 task baru',
    );
    expect(notificationTitle({ ...base, kind: 'createdBatch', customerName: 'Lokasi A' })).toBe(
      'Budi membuat 3 task baru di Lokasi A',
    );
    expect(notificationTitle({ ...base, kind: 'updated' })).toBe(
      'Budi mengubah task ST-20261112-001',
    );
    expect(notificationTitle({ ...base, kind: 'cancelled' })).toBe(
      'Budi membatalkan task ST-20261112-001',
    );
    expect(notificationTitle({ ...base, kind: 'reopened' })).toBe(
      'Budi membuka kembali task ST-20261112-001',
    );
    expect(notificationTitle({ ...base, kind: 'done' })).toBe(
      'Budi menyelesaikan task ST-20261112-001',
    );
    expect(notificationTitle({ ...base, kind: 'checked' })).toBe(
      'Budi memperbarui 3 butir di ST-20261112-001',
    );
    expect(notificationTitle({ ...base, kind: 'commented' })).toBe(
      'Budi mengomentari task ST-20261112-001',
    );
  });
});

describe('konstanta', () => {
  test('sisi penerima menurut spek 3 dan semua jenis terdaftar', () => {
    expect(Object.keys(NOTIFICATION_SIDE).sort()).toEqual([...NOTIFICATION_KINDS].sort());
    expect(NOTIFICATION_SIDE).toEqual({
      created: 'qc',
      createdBatch: 'qc',
      updated: 'qc',
      cancelled: 'qc',
      reopened: 'qc',
      done: 'wh',
      checked: 'wh',
      commented: 'all',
    });
  });

  test('jendela, umur, dan batas cuplikan', () => {
    expect(CHECK_WINDOW_MS).toBe(300_000);
    expect(NOTIFICATION_RETENTION_DAYS).toBe(90);
    expect(NOTIFICATION_PREVIEW_MAX).toBe(140);
  });
});

describe('pushPayloadOf', () => {
  function dto(overrides: Partial<NotificationDto>): NotificationDto {
    return {
      id: 'n1',
      kind: 'commented',
      handoverId: 'h1',
      locationId: 'loc-a',
      number: 'ST-20261112-001',
      customerName: 'PT Maju',
      actor: 'Budi',
      count: 0,
      preview: 'RAHASIA-ISI',
      createdAt: '2026-11-12T00:00:00.000Z',
      readAt: '',
      ...overrides,
    };
  }

  test('body memuat nomor dan customer; url dan tag menurut task', () => {
    const payload = pushPayloadOf(dto({ kind: 'done', preview: '' }));
    expect(payload.title).toBe('Budi menyelesaikan task ST-20261112-001');
    expect(payload.body).toBe('ST-20261112-001 - PT Maju');
    expect(payload.url).toBe('/handover/h1?loc=loc-a');
    expect(payload.tag).toBe('done:h1');
  });

  test('preview (catatan atau komentar) ikut di body setelah nomor dan customer (keputusan 2026-11-13)', () => {
    for (const kind of ['commented', 'updated', 'created'] as const) {
      const payload = pushPayloadOf(dto({ kind, preview: 'Cek kabel LAN' }));
      expect(payload.body).toBe('ST-20261112-001 - PT Maju\nCek kabel LAN');
    }
  });

  test('push memakai preview tersimpan apa adanya, sama dengan yang tampil di lonceng', () => {
    const preview = notificationPreviewText('- 1. Kabel');
    expect(preview).toBe('1. Kabel');
    expect(pushPayloadOf(dto({ preview })).body).toBe(`ST-20261112-001 - PT Maju\n${preview}`);
  });

  test('body hanya preview bila tanpa nomor dan customer; tetap berisi bila semuanya kosong', () => {
    expect(pushPayloadOf(dto({ number: '', customerName: '', preview: 'Isi' })).body).toBe('Isi');
    expect(pushPayloadOf(dto({ number: '', customerName: '', preview: '' })).body).toBe(
      'Serah Terima',
    );
  });
});

describe('notificationPreviewText', () => {
  test('membuang penanda daftar dan centang, melewati baris kosong, menggabung dengan " · "', () => {
    expect(notificationPreviewText('- [ ] A = 1\n- [x] B = 2\n\n* C\n3. D\n1) E')).toBe(
      'A = 1 · B = 2 · C · D · E',
    );
  });

  test('teks biasa dan CRLF; kosong tetap kosong; tanda hubung di tengah kalimat dipertahankan', () => {
    expect(notificationPreviewText('Tolong cek\r\nlagi - sekarang')).toBe(
      'Tolong cek · lagi - sekarang',
    );
    expect(notificationPreviewText('')).toBe('');
    expect(notificationPreviewText('  \n  ')).toBe('');
  });

  test('escape Markdown dan entitas HTML dari editor didekode; penanda centang tetap dibuang', () => {
    expect(
      notificationPreviewText(
        '- [ ] RB\\_5009\\_X = 1 unit\n- [ ] Kabel UTP &amp; konektor = 2 pcs\n&lt;urgent&gt; &#35;7',
      ),
    ).toBe('RB_5009_X = 1 unit · Kabel UTP & konektor = 2 pcs · <urgent> #7');
  });

  test('pemisah baris Unicode (NEL, U+2028, U+2029) dan CR tunggal memecah baris; tetap satu baris', () => {
    const [nel, ls, ps] = [0x85, 0x2028, 0x2029].map((code) => String.fromCharCode(code));
    const result = notificationPreviewText(`a${ls}b${ps}c${nel}d\re`);
    expect(result).toBe('a · b · c · d · e');
    expect(/[\n\r\u0085\u2028\u2029]/.test(result)).toBe(false);
  });

  test('karakter kontrol dan pengatur arah teks (bidi) dibuang', () => {
    const rlo = String.fromCharCode(0x202e);
    const pdf = String.fromCharCode(0x202c);
    const lri = String.fromCharCode(0x2066);
    const pdi = String.fromCharCode(0x2069);
    expect(notificationPreviewText(`${rlo}abc${pdf} def${String.fromCharCode(7)}g`)).toBe(
      'abc def g',
    );
    expect(notificationPreviewText(`x${lri}y${pdi}`)).toBe('x y');
  });

  test('urutan: penanda daftar dibuang dari teks MENTAH dulu; teks harfiah yang di-escape tetap (kunci urutan)', () => {
    // `\-` dan `1\.` di-escape penulis = teks harfiah, bukan butir daftar, jadi tidak boleh dibuang.
    expect(notificationPreviewText('\\- item')).toBe('- item');
    expect(notificationPreviewText('1\\. Langkah')).toBe('1. Langkah');
    expect(notificationPreviewText('- \\[ \\] x')).toBe('[ ] x');
    // Entitas yang menghasilkan tanda hubung juga bukan penanda daftar.
    expect(notificationPreviewText('&#45; x')).toBe('- x');
    // Dekode hanya sekali.
    expect(notificationPreviewText('&amp;amp;')).toBe('&amp;');
  });

  test('pengatur arah teks (bidi) dan pemisah baris yang datang lewat entitas ikut dibuang', () => {
    expect(notificationPreviewText('&#8238;abc')).toBe('abc');
    expect(notificationPreviewText('a&#8232;b')).toBe('a b');
    expect(notificationPreviewText('&#x2066;x&#x2069;')).toBe('x');
  });

  test('entitas yang menghasilkan baris baru tidak merusak jaminan satu baris', () => {
    expect(notificationPreviewText('a&#10;b')).toBe('a b');
  });
});

describe('pushPayloadOf (lanjutan)', () => {
  function dto(overrides: Partial<NotificationDto>): NotificationDto {
    return {
      id: 'n1',
      kind: 'commented',
      handoverId: 'h1',
      locationId: 'loc-a',
      number: 'ST-20261112-001',
      customerName: 'PT Maju',
      actor: 'Budi',
      count: 0,
      preview: '',
      createdAt: '2026-11-12T00:00:00.000Z',
      readAt: '',
      ...overrides,
    };
  }

  test('createdBatch tanpa task: url ke daftar, body tidak kosong', () => {
    const payload = pushPayloadOf(
      dto({ kind: 'createdBatch', handoverId: '', number: '', customerName: '', count: 30 }),
    );
    expect(payload.url).toBe('/handover?loc=loc-a');
    expect(payload.title).toBe('Budi membuat 30 task baru');
    expect(payload.body).not.toBe('');
    expect(payload.tag).toBe('createdBatch:');
  });

  test('createdBatch menyebut lokasi di judul dan body; url membawa lokasi yang di-escape', () => {
    const payload = pushPayloadOf(
      dto({
        kind: 'createdBatch',
        handoverId: '',
        number: '',
        customerName: 'Lokasi A',
        count: 30,
        locationId: 'loc a/1',
      }),
    );
    expect(payload.title).toBe('Budi membuat 30 task baru di Lokasi A');
    expect(payload.body).toBe('Lokasi A');
    expect(payload.url).toBe('/handover?loc=loc%20a%2F1');
  });
});
