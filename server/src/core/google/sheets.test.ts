import { afterEach, describe, expect, test } from 'bun:test';
import { type AppError, isAppError } from '@server/core/errors';
import { createGoogleRig, type GoogleRig, SPREADSHEET_ID } from '@server-test/google-rig';

let rig: GoogleRig;
afterEach(() => rig.restoreConsole());

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (isAppError(error)) return error;
    throw error;
  }
  throw new Error('diharapkan galat');
}

const book = () => rig.fake.sheets.get(SPREADSHEET_ID) as Map<string, string[][]>;

describe('sheetsExport', () => {
  test('replace membuat sheet bila belum ada, menulis header + baris sebagai teks (RAW), lalu menimpa', async () => {
    rig = await createGoogleRig();
    await rig.client.sheetsExport({
      sheet: 'export_brands',
      columns: ['id', 'nama'],
      rows: [
        ['1', '=HYPERLINK("http://x")'],
        ['2', '+1'],
      ],
      mode: 'replace',
    });
    expect(book().get('export_brands')).toEqual([
      ['id', 'nama'],
      ['1', '=HYPERLINK("http://x")'],
      ['2', '+1'],
    ]);
    await rig.client.sheetsExport({
      sheet: 'export_brands',
      columns: ['id'],
      rows: [['9']],
      mode: 'replace',
    });
    expect(book().get('export_brands')).toEqual([['id'], ['9']]);
    const appends = rig.fake.requests.filter((r) => r.url.pathname.endsWith(':append'));
    for (const request of appends) {
      expect(request.url.searchParams.get('valueInputOption')).toBe('RAW');
      expect(request.url.searchParams.get('insertDataOption')).toBe('INSERT_ROWS');
    }
  });

  test('sheet baru dibuat cukup lebar untuk jumlah kolom (bawaan Sheets 26 kolom)', async () => {
    rig = await createGoogleRig();
    const wide = Array.from({ length: 40 }, (_, i) => `c${i}`);
    await rig.client.sheetsExport({
      sheet: 'export_lebar',
      columns: wide,
      rows: [wide.map(() => 'x')],
      mode: 'replace',
    });
    await rig.client.sheetsExport({
      sheet: 'export_sempit',
      columns: ['a'],
      rows: [],
      mode: 'replace',
    });
    const widths = rig.fake.requests
      .filter((r) => r.url.pathname.endsWith(':batchUpdate'))
      .map(
        (r) =>
          JSON.parse(r.text ?? '{}').requests[0].addSheet.properties.gridProperties.columnCount,
      );
    expect(widths).toEqual([40, 26]);
  });

  test('append menambah baris di bawah isi; sheet belum ada = NOT_FOUND', async () => {
    rig = await createGoogleRig();
    await rig.client.sheetsExport({
      sheet: 'export_x',
      columns: ['a'],
      rows: [['1']],
      mode: 'replace',
    });
    await rig.client.sheetsExport({
      sheet: 'export_x',
      columns: ['a'],
      rows: [['2']],
      mode: 'append',
    });
    expect(book().get('export_x')).toEqual([['a'], ['1'], ['2']]);
    const error = await failure(
      rig.client.sheetsExport({
        sheet: 'export_belum',
        columns: ['a'],
        rows: [['1']],
        mode: 'append',
      }),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  test('hanya sheet berawalan export_ yang boleh ditulis (sheet sumber tak tersentuh)', async () => {
    rig = await createGoogleRig();
    book().set('brands', [['id'], ['b1']]);
    for (const sheet of [
      'brands',
      'export_',
      'export_A',
      "export_x'!A1",
      `export_${'a'.repeat(61)}`,
      '../export_x',
    ]) {
      const error = await failure(
        rig.client.sheetsExport({ sheet, columns: ['a'], rows: [], mode: 'replace' }),
      );
      expect(error.code).toBe('VALIDATION');
    }
    expect(book().get('brands')).toEqual([['id'], ['b1']]);
    expect(rig.fake.requests).toHaveLength(0);
  });

  test('batas bentuk potongan: kolom, baris, lebar baris, panjang sel', async () => {
    rig = await createGoogleRig();
    const base = {
      sheet: 'export_x',
      columns: ['a', 'b'],
      rows: [['1', '2']],
      mode: 'replace' as const,
    };
    for (const bad of [
      { ...base, columns: [] },
      { ...base, columns: Array.from({ length: 61 }, (_, i) => `c${i}`) },
      { ...base, rows: [['1']] },
      { ...base, rows: Array.from({ length: 2001 }, () => ['1', '2']) },
      { ...base, rows: [['1', 'x'.repeat(50_001)]] },
    ]) {
      expect((await failure(rig.client.sheetsExport(bad))).code).toBe('VALIDATION');
    }
    expect(rig.fake.requests).toHaveLength(0);
  });

  test('replace dicoba ulang sebagai satu kesatuan (clear + tulis) pada galat sementara; append tidak', async () => {
    rig = await createGoogleRig();
    let failed = false;
    rig.fake.intercept = (request) => {
      if (request.url.pathname.endsWith(':append') && !failed) {
        failed = true;
        return new Response('{}', { status: 503 });
      }
      return undefined;
    };
    await rig.client.sheetsExport({
      sheet: 'export_r',
      columns: ['a'],
      rows: [['1']],
      mode: 'replace',
    });
    // Tidak ada baris ganda walau percobaan pertama gagal.
    expect(book().get('export_r')).toEqual([['a'], ['1']]);

    failed = false;
    book().set('export_a', [['a']]);
    const error = await failure(
      rig.client.sheetsExport({ sheet: 'export_a', columns: ['a'], rows: [['1']], mode: 'append' }),
    );
    expect(error.code).toBe('UNAVAILABLE');
    expect(
      rig.fake.requests.filter(
        (r) => r.url.pathname.includes('export_a') && r.url.pathname.endsWith(':append'),
      ),
    ).toHaveLength(1);
  });

  test('tanpa GOOGLE_SPREADSHEET_ID = UNAVAILABLE jelas', async () => {
    rig = await createGoogleRig({ GOOGLE_SPREADSHEET_ID: '' });
    const error = await failure(
      rig.client.sheetsExport({ sheet: 'export_x', columns: ['a'], rows: [], mode: 'replace' }),
    );
    expect(error.code).toBe('UNAVAILABLE');
    expect(error.message).toContain('belum dikonfigurasi');
    expect(isAppError(await failure(rig.client.sheetsDump()))).toBe(true);
  });
});

describe('sheetsDump', () => {
  test('mengembalikan semua sheet sumber (tanpa export_) berbentuk persegi panjang; baris pertama = header', async () => {
    rig = await createGoogleRig();
    book().set('brands', [
      ['id', 'nama'],
      ['b1', 'Merk A'],
    ]);
    book().set("it'ems", [['id', 'x', 'y'], ['i1'], ['i2', 'a', 'b']]);
    book().set('kosong', []);
    book().set('export_brands', [['id'], ['x']]);
    const dump = await rig.client.sheetsDump();
    expect(Object.keys(dump).sort()).toEqual(["it'ems", 'brands', 'kosong'].sort());
    expect(dump.brands).toEqual([
      ['id', 'nama'],
      ['b1', 'Merk A'],
    ]);
    expect(dump["it'ems"]).toEqual([
      ['id', 'x', 'y'],
      ['i1', '', ''],
      ['i2', 'a', 'b'],
    ]);
    expect(dump.kosong).toEqual([]);
    const batch = rig.fake.requests.filter((r) => r.url.pathname.endsWith('values:batchGet'));
    expect(batch.length).toBeGreaterThan(0);
    // Seperti getValues() GAS lama: nilai mentah (bukan tampilan berformat) yang diubah ke teks.
    expect(batch[0]?.url.searchParams.get('valueRenderOption')).toBe('UNFORMATTED_VALUE');
    expect(batch[0]?.url.searchParams.getAll('ranges')).toContain("'it''ems'");
  });

  test('parameter sheets membatasi nama yang diambil', async () => {
    rig = await createGoogleRig();
    book().set('brands', [['id'], ['b1']]);
    book().set('items', [['id'], ['i1']]);
    expect(await rig.client.sheetsDump(['items'])).toEqual({ items: [['id'], ['i1']] });
  });

  test('spreadsheet yang tak dibagikan ke service account (404) = UNAVAILABLE akses, bukan null', async () => {
    rig = await createGoogleRig({ GOOGLE_SPREADSHEET_ID: 'TIDAKADASPREAD01' });
    expect((await failure(rig.client.sheetsDump())).code).toBe('UNAVAILABLE');
  });
});
