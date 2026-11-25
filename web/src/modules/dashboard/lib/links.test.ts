import type { MeDto } from '@shared/contract';
import { describe, expect, test } from 'vitest';
import { widgetLinks } from './links';

const me = (stickerView: boolean) =>
  ({
    email: 'a@x.id',
    isSuperAdmin: false,
    permissions: { sticker: stickerView ? 'view' : 'none' },
    locations: [],
    businessUnits: [],
  }) as unknown as MeDto;

describe('widgetLinks', () => {
  test('widget non-daftar tanpa tautan', () => {
    expect(widgetLinks(me(true), 'hs.created')).toEqual({ index: null, row: null });
  });

  test('Serah Terima: indeks /handover; baris ke detail task', () => {
    const links = widgetLinks(me(false), 'hs.oldest');
    expect(links.index).toEqual({ to: '/handover' });
    expect(links.row?.('h1')).toEqual({
      to: '/handover/$handoverId',
      params: { handoverId: 'h1' },
    });
  });

  test('Serial terakhir: baris membuka daftar Serial terfilter item', () => {
    const links = widgetLinks(me(false), 'sn.latest');
    expect(links.index).toEqual({ to: '/serial' });
    expect(links.row?.('i1')).toEqual({ to: '/serial', search: { itemIds: ['i1'] } });
  });

  test('Laporan terlama: indeks /serial/reports; baris ke detail laporan', () => {
    const links = widgetLinks(me(false), 'rp.oldest');
    expect(links.index).toEqual({ to: '/serial/reports' });
    expect(links.row?.('c1')).toEqual({ to: '/serial/reports/$caseId', params: { caseId: 'c1' } });
  });

  test('Stok perlu perhatian: baris ke detail stiker hanya bagi sticker: view', () => {
    expect(widgetLinks(me(true), 'st.attention').row?.('k1')).toEqual({
      to: '/sticker/$stickerId',
      params: { stickerId: 'k1' },
    });
    const noView = widgetLinks(me(false), 'st.attention');
    expect(noView.index).toEqual({ to: '/sticker' });
    expect(noView.row).toBeNull();
  });
});
