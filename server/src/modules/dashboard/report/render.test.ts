import { describe, expect, test } from 'bun:test';
import type { WidgetId } from '@shared/dashboard';
import { widgetMeta } from '@shared/dashboard';
import type { EmailWidgetData } from '@shared/dashboard-public';
import { hasControlChars } from '@shared/postel';
import {
  EMAIL_HTML_MAX_BYTES,
  type EmailReportInput,
  formatNumber,
  percentWidths,
  renderReportEmail,
  TEST_BUTTON_NOTE,
  TEST_NOTE,
  TRIMMED_NOTE,
} from './render';

const CTA = 'https://qc.test/dashboard-publik/v1.abc.123.sig';

const item = (id: WidgetId, data: EmailWidgetData) => ({ meta: widgetMeta(id), data });

function input(
  widgets: EmailReportInput['widgets'],
  overrides: Partial<EmailReportInput> = {},
): EmailReportInput {
  return {
    reportName: 'Ringkasan mingguan',
    periodLabel: 'Minggu lalu',
    scopeLabel: 'BU: X · Lokasi: Gudang',
    scheduleLabel: 'Senin 08.00 WIB',
    ownerName: 'owner',
    widgets,
    ctaUrl: CTA,
    linkExpiresLabel: 'Tautan berlaku sampai 7 Des 2026',
    ...overrides,
  };
}

const byteSize = (text: string) => new TextEncoder().encode(text).length;

const labels = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    key: `2026-11-${String(index + 1).padStart(2, '0')}`,
    label: `${index + 1} Nov`,
  }));

function series(count: number, seriesCount: number): EmailWidgetData {
  return {
    kind: 'series',
    bucket: 'day',
    points: labels(count),
    series: Array.from({ length: seriesCount }, (_, index) => ({
      key: String(index),
      label: index === 0 ? 'Dibuat' : 'Selesai',
      values: Array.from({ length: count }, (__, point) => (point * 7 + index * 3) % 23),
    })),
  };
}

function list(rows: number, total: number, textLength = 12): EmailWidgetData {
  const columns = widgetMeta('hs.oldest').listColumns ?? [];
  return {
    kind: 'list',
    columns: columns.map((column) => ({ ...column })),
    rows: Array.from({ length: rows }, (_, index) => {
      const row: Record<string, string | number> = {};
      for (const column of columns) {
        row[column.key] = `${column.key}-${index} ${'x'.repeat(textLength)}`;
      }
      return row;
    }),
    total,
  };
}

describe('formatNumber', () => {
  test('ribuan memakai titik, desimal koma, maks. satu desimal', () => {
    expect(formatNumber(1234567)).toBe('1.234.567');
    expect(formatNumber(12.34)).toBe('12,3');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(-5)).toBe('-5');
  });
});

describe('percentWidths', () => {
  test('jumlah selalu 100 dan nilai positif minimal 1', () => {
    for (const values of [[1, 1, 1], [97, 2, 1], [1, 1000, 1], [5], [3, 3, 3, 3, 3, 3, 3]]) {
      const widths = percentWidths(values);
      expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
      for (const [index, value] of values.entries()) {
        if (value > 0) expect(widths[index]).toBeGreaterThanOrEqual(1);
      }
    }
    expect(percentWidths([0, 0])).toEqual([0, 0]);
  });
});

describe('Review Focus 2: teks data tidak menyusupkan markup', () => {
  const evil = '<script>alert(1)</script>';
  const quote = '"onload="x';
  const bidi = `rapi‮kacau\u0007`;

  test('nama laporan, label irisan, dan isi daftar di-escape; bidi dan kontrol dibuang', () => {
    const parts: EmailWidgetData = {
      kind: 'parts',
      slices: [
        { key: '0', label: evil, value: 3 },
        { key: '1', label: quote, value: 2 },
        { key: '2', label: bidi, value: 1 },
      ],
    };
    const rendered = renderReportEmail(
      input(
        [
          item('hs.status', parts),
          item('hs.byCustomer', parts),
          item('hs.oldest', {
            kind: 'list',
            columns: [{ key: 'customer', label: evil }],
            rows: [{ customer: `${evil}${quote}${bidi}` }],
            total: 1,
          }),
        ],
        { reportName: `${evil} ${quote} ${bidi}`, ownerName: evil },
      ),
    );
    const html = rendered.html;
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html).not.toContain('alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('"onload="x');
    expect(html).toContain('&quot;onload=&quot;x');
    // HTML tak memuat baris baru, karakter kontrol, atau pengatur arah teks; teks polos hanya boleh berbaris baru.
    expect(hasControlChars(html)).toBe(false);
    expect(hasControlChars(rendered.text.split('\n').join(' '))).toBe(false);
    expect(hasControlChars(rendered.subject)).toBe(false);
  });

  test('subjek dibatasi 120 karakter nama, bentuk [QC] <nama>, <periode>, dan [UJI] saat uji', () => {
    const long = 'N'.repeat(300);
    const rendered = renderReportEmail(input([], { reportName: long }));
    expect(rendered.subject).toBe(`[QC] ${`${'N'.repeat(119)}…`}, Minggu lalu`);
    expect(renderReportEmail(input([], { test: true })).subject).toBe(
      '[UJI] [QC] Ringkasan mingguan, Minggu lalu',
    );
    expect(renderReportEmail(input([])).subject).toBe('[QC] Ringkasan mingguan, Minggu lalu');
  });
});

describe('struktur HTML', () => {
  const rendered = renderReportEmail(
    input([
      item('hs.created', { kind: 'number', value: 3, previous: 2 }),
      item('hs.status', {
        kind: 'parts',
        slices: [{ key: '0', label: 'Baru', value: 2 }],
      }),
      item('hs.trend', series(7, 2)),
      item('hs.oldest', list(5, 12)),
    ]),
  );

  test('tanpa script, img, link, iframe, dan javascript:', () => {
    const lower = rendered.html.toLowerCase();
    for (const forbidden of ['<script', '<img', '<link', '<iframe', 'javascript:', '<style']) {
      expect(lower).not.toContain(forbidden);
    }
  });

  test('tepat satu href (tombol) bernilai ctaUrl dan tak ada URL lain', () => {
    expect(rendered.html.match(/href=/g)).toHaveLength(1);
    expect(rendered.html).toContain(`href="${CTA}"`);
    expect(rendered.html.split(CTA).join('')).not.toContain('http');
  });

  test('tabel utama berlebar 600 dan teks tombol ada', () => {
    expect(rendered.html).toContain('width="600"');
    expect(rendered.html).toContain('Buka dashboard lengkap');
    expect(rendered.html).toContain('Tautan berlaku sampai 7 Des 2026');
    expect(rendered.html).toContain('Hubungi pemilik untuk berhenti atau mengubah isinya');
  });

  test('surel uji: subjek [UJI], keterangan uji di atas badan HTML dan sebagai baris pertama teks polos', () => {
    const rendered = renderReportEmail(input([], { test: true }));
    expect(rendered.subject.startsWith('[UJI] ')).toBe(true);
    expect(rendered.html).toContain(TEST_NOTE);
    expect(rendered.html.indexOf(TEST_NOTE)).toBeLessThan(
      rendered.html.indexOf('Ringkasan mingguan</div>'),
    );
    expect(rendered.text.split('\n')[0]).toBe(TEST_NOTE);
    expect(rendered.html).not.toContain(TEST_BUTTON_NOTE);
  });

  test('surel uji laporan milik orang lain menambah kalimat tombol ke Dashboard; penanda hak tetap terpisah', () => {
    const rendered = renderReportEmail(input([], { test: true, buttonToApp: true, trimmed: true }));
    expect(rendered.html).toContain(TEST_BUTTON_NOTE);
    expect(rendered.text).toContain(TEST_BUTTON_NOTE);
    expect(rendered.html).toContain(TRIMMED_NOTE);
    expect(rendered.html.indexOf(TEST_BUTTON_NOTE)).not.toBe(rendered.html.indexOf(TRIMMED_NOTE));
    expect(rendered.text.split('\n').filter((line) => line === TRIMMED_NOTE)).toHaveLength(1);
  });

  test('pratinjau memuat keterangan uji tanpa awalan subjek; surel terjadwal tidak memuat keduanya', () => {
    const preview = renderReportEmail(input([], { testNotice: true }));
    expect(preview.html).toContain(TEST_NOTE);
    expect(preview.subject.startsWith('[UJI]')).toBe(false);
    const real = renderReportEmail(input([]));
    expect(real.html).not.toContain(TEST_NOTE);
    expect(real.text).not.toContain(TEST_NOTE);
    expect(real.subject).not.toContain('UJI');
    expect(real.html).not.toContain(TRIMMED_NOTE);
  });
});

describe('Review Focus 5: ukuran surel', () => {
  test('12 widget terbesar (30 kolom, daftar 5 baris bersel panjang) <= 90 KB', () => {
    const widgets = [
      item('hs.trend', series(30, 2)),
      item('sn.trend', series(30, 1)),
      item('rp.trend', series(30, 2)),
      item('st.movement', series(30, 2)),
      item('hs.oldest', list(5, 99, 200)),
      item('sn.transit', {
        kind: 'list',
        columns: widgetMeta('sn.transit').listColumns?.map((c) => ({ ...c })) ?? [],
        rows: Array.from({ length: 5 }, () =>
          Object.fromEntries(
            (widgetMeta('sn.transit').listColumns ?? []).map((c) => [c.key, 'y'.repeat(200)]),
          ),
        ),
        total: 50,
      }),
      item('hs.created', { kind: 'number', value: 1234, previous: 1000 }),
      item('sn.recorded', { kind: 'number', value: 55, previous: 60 }),
      item('rp.opened', { kind: 'number', value: 4, previous: 2 }),
      item('hs.status', {
        kind: 'parts',
        slices: Array.from({ length: 9 }, (_, index) => ({
          key: String(index),
          label: `Status ${index}`,
          value: index + 1,
        })),
      }),
      item('hs.byCustomer', {
        kind: 'parts',
        slices: Array.from({ length: 12 }, (_, index) => ({
          key: String(index),
          label: `Customer ${index} ${'z'.repeat(60)}`,
          value: 100 - index,
        })),
      }),
      item('sn.byBu', {
        kind: 'parts',
        slices: [{ key: '0', label: 'BU', value: 3 }],
      }),
    ];
    expect(widgets).toHaveLength(12);
    const rendered = renderReportEmail(input(widgets));
    expect(byteSize(rendered.html)).toBeLessThanOrEqual(EMAIL_HTML_MAX_BYTES);
    // Dengan keterangan uji dan penanda hak (surel uji laporan orang lain) batas tetap berlaku.
    const test = renderReportEmail(
      input(widgets, { test: true, buttonToApp: true, trimmed: true }),
    );
    expect(byteSize(test.html)).toBeLessThanOrEqual(EMAIL_HTML_MAX_BYTES);
  });

  test('fixture yang sengaja melebihi batas memicu render kompak dan tetap <= 90 KB', () => {
    const widgets = (['hs.trend', 'sn.trend', 'rp.trend', 'st.movement'] as const).flatMap((id) =>
      [0, 1, 2].map(() => item(id, series(31, 2))),
    );
    expect(widgets).toHaveLength(12);
    const rendered = renderReportEmail(input(widgets));
    expect(byteSize(rendered.html)).toBeLessThanOrEqual(EMAIL_HTML_MAX_BYTES);
    // 12 widget deret terlebar melewati batas pada tingkat normal; render ulang memuat ringkasan angka.
    expect(rendered.html).toContain('tertinggi');
  });

  test('beban sedang tetap dirender penuh (tanpa pemotongan)', () => {
    const rendered = renderReportEmail(input([item('sn.trend', series(31, 1))]));
    expect(rendered.html).not.toContain('periode terakhir');
  });
});

describe('visual per jenis widget', () => {
  const html = (widget: ReturnType<typeof item>) => renderReportEmail(input([widget])).html;

  test('number: naik, turun, tetap, dan previous 0', () => {
    expect(html(item('hs.created', { kind: 'number', value: 3, previous: 2 }))).toContain(
      '▲ Naik 50% dari periode lalu',
    );
    expect(html(item('hs.created', { kind: 'number', value: 1, previous: 2 }))).toContain(
      '▼ Turun 50% dari periode lalu',
    );
    expect(html(item('hs.created', { kind: 'number', value: 2, previous: 2 }))).toContain(
      'Tetap dibanding periode lalu',
    );
    const zero = html(item('hs.created', { kind: 'number', value: 5, previous: 0 }));
    expect(zero).toContain('Naik dari periode lalu (0)');
    expect(zero).not.toMatch(/Naik \d+%/);
    expect(html(item('hs.created', { kind: 'number', value: 5 }))).not.toContain('periode lalu');
  });

  test('warna delta menurut deltaGood, bukan selalu naik = hijau', () => {
    // hs.created naik = baik (hijau); rp.opened naik = buruk (merah); rp.opened turun = baik (hijau).
    expect(html(item('hs.created', { kind: 'number', value: 3, previous: 2 }))).toContain(
      'color:#047857;padding-top:2px">▲',
    );
    expect(html(item('rp.opened', { kind: 'number', value: 3, previous: 2 }))).toContain(
      'color:#b91c1c;padding-top:2px">▲',
    );
    expect(html(item('rp.opened', { kind: 'number', value: 1, previous: 2 }))).toContain(
      'color:#047857;padding-top:2px">▼',
    );
    expect(html(item('hs.created', { kind: 'number', value: 2, previous: 2 }))).toContain(
      'color:#4b5563;padding-top:2px">•',
    );
  });

  test('donut: batang bertumpuk berjumlah 100 dan 7 irisan menjadi 6 + Lainnya', () => {
    const slices = Array.from({ length: 7 }, (_, index) => ({
      key: String(index),
      label: `Irisan ${index}`,
      value: 10 + index,
    }));
    const out = html(item('hs.status', { kind: 'parts', slices }));
    const barWidths = [
      ...out.matchAll(/<td width="(\d+)%" bgcolor="#[0-9a-f]{6}" height="16"/g),
    ].map((match) => Number(match[1]));
    expect(barWidths).toHaveLength(7); // 6 irisan + Lainnya
    expect(barWidths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(out).toContain('Lainnya');
    expect(out).not.toContain('Irisan 0'); // irisan terkecil masuk "Lainnya"
    expect(out).toContain('Irisan 6');
  });

  test('barH/bar pada parts: batang horizontal berlabel dengan nilai tertulis', () => {
    const out = html(
      item('hs.byCustomer', {
        kind: 'parts',
        slices: [
          { key: '0', label: 'Customer A', value: 10 },
          { key: '1', label: 'Customer B', value: 5 },
        ],
      }),
    );
    expect(out).toContain('Customer A');
    expect(out).toContain('>10<');
    expect(out).toContain('width="50%"');
  });

  test('deret waktu: kolom per titik, legenda dua seri, nilai tertulis', () => {
    const out = html(item('hs.trend', series(7, 2)));
    expect(out).toContain('Dibuat');
    expect(out).toContain('Selesai');
    expect(out).toContain('total');
    expect(out.match(/valign="bottom" height="80"/g)).toHaveLength(7);
  });

  test('kosong: parts, series, dan daftar', () => {
    expect(html(item('hs.status', { kind: 'parts', slices: [] }))).toContain('Belum ada data');
    expect(
      html(
        item('hs.status', {
          kind: 'parts',
          slices: [{ key: '0', label: 'A', value: 0 }],
        }),
      ),
    ).toContain('Belum ada data');
    expect(
      html(item('hs.trend', { kind: 'series', bucket: 'day', points: [], series: [] })),
    ).toContain('Belum ada data');
    expect(html(item('hs.trend', series(0, 2)))).toContain('Belum ada data');
    expect(html(item('hs.oldest', { kind: 'list', columns: [], rows: [], total: 0 }))).toContain(
      'Tidak ada data',
    );
  });

  test('daftar: "Menampilkan 5 dari 12" dan hanya 5 baris', () => {
    const out = html(item('hs.oldest', list(5, 12)));
    expect(out).toContain('Menampilkan 5 dari 12');
    expect(out).toContain('number-4');
    expect(out).not.toContain('number-5');
  });

  test('kartu angka berurutan dibagi tiga per baris', () => {
    const out = html(item('hs.active', { kind: 'number', value: 1 }));
    expect(out.match(/width="33%"/g)).toHaveLength(3); // satu kartu + dua sel pengisi
  });
});

describe('teks polos', () => {
  test('memuat ctaUrl di baris sendiri, nilai tiap widget, dan daftar', () => {
    const rendered = renderReportEmail(
      input([
        item('hs.created', { kind: 'number', value: 1234, previous: 1000 }),
        item('hs.status', {
          kind: 'parts',
          slices: [{ key: '0', label: 'Baru', value: 4 }],
        }),
        item('hs.trend', series(3, 2)),
        item('hs.oldest', list(5, 12)),
      ]),
    );
    const lines = rendered.text.split('\n');
    expect(lines).toContain(CTA);
    expect(rendered.text).toContain('Task dibuat: 1.234 (Naik 23% dari periode lalu)');
    expect(rendered.text).toContain('Baru: 4 (100%)');
    expect(rendered.text).toContain('Menampilkan 5 dari 12');
    expect(rendered.text).toContain('Dibuat (total');
    expect(rendered.text).toContain('Periode: Minggu lalu');
  });
});
