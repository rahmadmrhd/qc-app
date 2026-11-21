import type { PostelDto } from '@shared/contract';
import { expect, test } from 'vitest';
import { postelFormSchema, toPostelFormDefaults, toSavePostelInput } from './schemas';

const row = (over: Record<string, unknown> = {}) => ({
  key: 'k',
  number: 'AB-1',
  expiresOn: '2027-06-01',
  link: '',
  ...over,
});

const values = (over: Record<string, unknown> = {}) => ({
  items: [{ id: 'i1', brand: 'PBE', model: 'M5' }],
  numbers: [row()],
  note: '',
  attachments: [],
  ...over,
});

const messages = (hidden: number, input: unknown) => {
  const result = postelFormSchema(hidden).safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

test('nilai sah lolos', () => {
  expect(messages(0, values())).toEqual([]);
});

test('item wajib kecuali ada item tersembunyi', () => {
  expect(messages(0, values({ items: [] }))).toContain('Pilih minimal satu item');
  expect(messages(2, values({ items: [] }))).toEqual([]);
});

test('minimal satu nomor', () => {
  expect(messages(0, values({ numbers: [] }))).toContain('Isi minimal satu nomor sertifikat');
});

test('galat nomor bernomor baris: kosong, terlalu panjang, tanggal, tautan', () => {
  expect(messages(0, values({ numbers: [row({ number: '  ' })] }))).toContain(
    'Nomor 1: nomor sertifikat wajib diisi',
  );
  expect(messages(0, values({ numbers: [row({ number: 'x'.repeat(101) })] }))).toContain(
    'Nomor 1: nomor sertifikat maksimal 100 karakter',
  );
  expect(messages(0, values({ numbers: [row(), row({ expiresOn: '' })] }))).toContain(
    'Nomor 2: tanggal habis wajib diisi',
  );
  expect(messages(0, values({ numbers: [row({ expiresOn: '2027-02-29' })] }))).toContain(
    'Nomor 1: tanggal habis tidak valid',
  );
  expect(messages(0, values({ numbers: [row({ link: 'ftp://x' })] }))).toContain(
    'Nomor 1: tautan harus diawali http:// atau https://',
  );
  expect(
    messages(0, values({ numbers: [row({ link: `https://x/${'a'.repeat(2000)}` })] })),
  ).toContain('Nomor 1: tautan maksimal 2000 karakter');
});

test('nomor memuat baris baru, kontrol, atau pengatur arah teks ditolak; nomor wajar lolos', () => {
  for (const number of ['SN-1\nBcc: x', 'SN-1\tX', 'SN-1\u0000X', 'SN-1\u202EX', 'SN-1\u2028X']) {
    expect(messages(0, values({ numbers: [row({ number })] }))).toContain(
      'Nomor 1: tidak boleh memuat karakter kontrol atau baris baru',
    );
  }
  expect(messages(0, values({ numbers: [row({ number: 'SN/001.A 12 é' })] }))).toEqual([]);
});

test('catatan maksimal 1000 karakter; lampiran maksimal 10', () => {
  expect(messages(0, values({ note: 'x'.repeat(1001) }))).toContain(
    'Catatan maksimal 1000 karakter',
  );
  const attachment = { id: 'f', mime: 'image/png', size: 1, filename: 'a.png' };
  expect(
    messages(0, values({ attachments: Array.from({ length: 11 }, () => attachment) })),
  ).toContain('Maksimal 10 lampiran');
});

test('toSavePostelInput: tanpa id/expectedUpdatedAt untuk tambah; memangkas spasi', () => {
  const input = toSavePostelInput(
    {
      items: [{ id: 'i1', brand: 'PBE', model: 'M5' }],
      numbers: [
        { key: 'k', number: ' AB-1 ', expiresOn: '2027-06-01', link: ' https://x.example ' },
      ],
      note: ' halo ',
      attachments: [{ id: 'f1', mime: 'image/png', size: 1, filename: 'a.png' }],
    },
    undefined,
  );
  expect(input).toEqual({
    note: 'halo',
    itemIds: ['i1'],
    numbers: [{ number: 'AB-1', expiresOn: '2027-06-01', link: 'https://x.example' }],
    attachmentIds: ['f1'],
  });
});

test('toPostelFormDefaults: mode tambah memberi satu baris kosong; mode ubah memuat DTO', () => {
  const blank = toPostelFormDefaults(undefined);
  expect(blank.numbers).toHaveLength(1);
  expect(blank.numbers[0]).toMatchObject({ number: '', expiresOn: '', link: '' });
  expect(blank.numbers[0]?.id).toBeUndefined();
  const postel = {
    note: 'n',
    numbers: [
      {
        id: 'n1',
        number: 'A',
        expiresOn: '2027-01-01',
        link: '',
        role: 'active',
        condition: 'valid',
        daysLeft: 1,
      },
    ],
    items: [{ id: 'i1', brand: 'B', model: 'M' }],
    attachments: [{ id: 'f1', mime: 'image/png', size: 1, filename: 'a.png' }],
  } as unknown as PostelDto;
  const loaded = toPostelFormDefaults(postel);
  expect(loaded.numbers[0]).toMatchObject({ key: 'n1', id: 'n1', number: 'A' });
  expect(loaded.items).toEqual([{ id: 'i1', brand: 'B', model: 'M' }]);
  expect(loaded.attachments).toHaveLength(1);
  expect(loaded.note).toBe('n');
});

test('toPostelFormDefaults membawa penanda terhapus item hanya bila terhapus', () => {
  const defaults = toPostelFormDefaults({
    id: 'p1',
    name: 'N',
    note: '',
    numbers: [],
    items: [
      { id: 'a', brand: 'B', model: 'M1' },
      { id: 'b', brand: 'B', model: 'M2', deleted: true },
    ],
    itemCount: 1,
    hiddenItemCount: 0,
    attachments: [],
    today: '2026-11-20',
    soonDays: 90,
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
  } as never);
  expect(defaults.items).toEqual([
    { id: 'a', brand: 'B', model: 'M1' },
    { id: 'b', brand: 'B', model: 'M2', deleted: true },
  ]);
});
