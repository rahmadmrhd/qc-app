import { describe, expect, test } from 'bun:test';
import {
  convertWhatsappFormatting,
  isChecklistLine,
  isHeaderLine,
  splitWhatsappBatch,
  stripWhatsappPrefix,
  whatsappToNoteMarkdown,
} from './handover-paste';

describe('handover-paste', () => {
  test('empat contoh WhatsApp pemilik', () => {
    expect(splitWhatsappBatch('Orderan Online :\nCRS310 = 1 unt\nRB5009UG = 1 unt')).toEqual([
      {
        customerSuggestion: 'Orderan Online',
        note: '- [ ] CRS310 = 1 unt\n- [ ] RB5009UG = 1 unt',
      },
    ]);

    const contoh2 = [
      '[22/10, 10.57] Mas_Aden JH: CV.Prisma :',
      'V1600GS-ZF = 200 unit',
      '[22/10, 11.01] Mas_Aden JH: HND Gemilang :',
      'VT-861 = 1 unit',
    ].join('\n');
    expect(splitWhatsappBatch(contoh2)).toEqual([
      { customerSuggestion: 'CV.Prisma', note: '- [ ] V1600GS-ZF = 200 unit' },
      { customerSuggestion: 'HND Gemilang', note: '- [ ] VT-861 = 1 unit' },
    ]);

    const contoh3 = [
      'Orderan Pak OKY - ',
      'CCR2116 = 1 unit (Kirim dari SBY - TANPA DOKUMENT APAPUN)',
      'kirim via J&T Merah kalo bisa',
      '',
      'Mintol foto SN - Foto Unit sebelum packing & setelah packing',
    ].join('\n');
    expect(splitWhatsappBatch(contoh3)).toEqual([
      {
        customerSuggestion: 'Orderan Pak OKY',
        note: '- [ ] CCR2116 = 1 unit (Kirim dari SBY - TANPA DOKUMENT APAPUN)\n\nkirim via J&T Merah kalo bisa\n\nMintol foto SN - Foto Unit sebelum packing & setelah packing',
      },
    ]);

    const contoh4 = [
      'Lintasmaya :',
      'AF 5XHD = 16 unt',
      '',
      'Mitra Tower :',
      'RD-5G34 = 8 unt',
      '',
      'CV. Tepian :',
      'RD-5G34 = 5 unt',
      'POE 24-12W = 50 unt',
    ].join('\n');
    expect(splitWhatsappBatch(contoh4)).toEqual([
      { customerSuggestion: 'Lintasmaya', note: '- [ ] AF 5XHD = 16 unt' },
      { customerSuggestion: 'Mitra Tower', note: '- [ ] RD-5G34 = 8 unt' },
      {
        customerSuggestion: 'CV. Tepian',
        note: '- [ ] RD-5G34 = 5 unt\n- [ ] POE 24-12W = 50 unt',
      },
    ]);
  });

  test('whatsappToNoteMarkdown mempertahankan judul sebagai paragraf', () => {
    expect(whatsappToNoteMarkdown('Orderan Online :\nCRS310 = 1 unt')).toBe(
      'Orderan Online :\n\n- [ ] CRS310 = 1 unt',
    );
  });

  test('CRLF, tab, spasi ganda, dan emoji', () => {
    expect(whatsappToNoteMarkdown('A = 1 unit\r\nB\t= 2 unt 😀\r\n')).toBe(
      '- [ ] A = 1 unit\n- [ ] B = 2 unt 😀',
    );
    expect(whatsappToNoteMarkdown('A  =   1')).toBe('- [ ] A = 1');
  });

  test('format WhatsApp', () => {
    expect(convertWhatsappFormatting('*Penting* kirim _sore_ ~batal~')).toBe(
      '**Penting** kirim *sore* ~~batal~~',
    );
    for (const s of ['RB_5009_X = 1 unit', '2*3 = 6 unit', 'snake_case_word']) {
      expect(convertWhatsappFormatting(s)).toBe(s);
    }
  });

  test('bullet, nomor, dan penanda checkbox', () => {
    expect(whatsappToNoteMarkdown('- A = 1\n1. B = 2\n- [x] C = 3')).toBe(
      '- [ ] A = 1\n- [ ] B = 2\n- [ ] C = 3',
    );
  });

  test('stripWhatsappPrefix membuang awalan tanggal dan pengirim', () => {
    expect(stripWhatsappPrefix('[22/10, 10.57] Mas_Aden JH: CV.Prisma :')).toBe('CV.Prisma :');
    expect(stripWhatsappPrefix('tanpa awalan')).toBe('tanpa awalan');
  });

  test('isChecklistLine / isHeaderLine', () => {
    const kasus: [string, boolean, boolean][] = [
      ['X = 1 unit', true, false],
      ['Kirim sore', false, false],
      ['CV.Prisma :', false, true],
      ['Orderan Pak OKY -', false, true],
      ['A = 1 :', true, false],
    ];
    for (const [s, cek, judul] of kasus) {
      expect(isChecklistLine(s)).toBe(cek);
      expect(isHeaderLine(s)).toBe(judul);
    }
  });

  test('masukan kosong dan hanya judul', () => {
    expect(splitWhatsappBatch('')).toEqual([]);
    expect(splitWhatsappBatch('Judul :')).toEqual([]);
  });

  test('teks sebelum judul pertama menjadi task tanpa usulan customer', () => {
    expect(splitWhatsappBatch('A = 1 unit\nCV X :\nB = 2 unit')).toEqual([
      { customerSuggestion: '', note: '- [ ] A = 1 unit' },
      { customerSuggestion: 'CV X', note: '- [ ] B = 2 unit' },
    ]);
  });
});
