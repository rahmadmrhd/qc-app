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
  const base = { actor: 'Budi', number: 'ST-20261112-001', count: 3 };
  test('teks per jenis', () => {
    expect(notificationTitle({ ...base, kind: 'created' })).toBe(
      'Budi membuat task ST-20261112-001',
    );
    expect(notificationTitle({ ...base, kind: 'createdBatch' })).toBe('Budi membuat 3 task baru');
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
    expect(payload.url).toBe('/handover/h1');
    expect(payload.tag).toBe('done:h1');
  });

  test('preview (teks komentar atau catatan) tidak pernah ikut', () => {
    for (const kind of ['commented', 'updated'] as const) {
      const payload = pushPayloadOf(dto({ kind, preview: 'RAHASIA-ISI' }));
      expect(JSON.stringify(payload)).not.toContain('RAHASIA-ISI');
    }
  });

  test('createdBatch tanpa task: url ke daftar, body tidak kosong', () => {
    const payload = pushPayloadOf(
      dto({ kind: 'createdBatch', handoverId: '', number: '', customerName: '', count: 30 }),
    );
    expect(payload.url).toBe('/handover');
    expect(payload.title).toBe('Budi membuat 30 task baru');
    expect(payload.body).not.toBe('');
    expect(payload.tag).toBe('createdBatch:');
  });
});
