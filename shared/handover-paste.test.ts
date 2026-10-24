import { describe, expect, test } from 'bun:test';
import {
  convertWhatsappFormatting,
  isChecklistLine,
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

  test('isChecklistLine: pemisah "=" atau ":" diikuti angka', () => {
    const kasus: [string, boolean][] = [
      ['X = 1 unit', true],
      ['RB 1100 X4 :3 unit', true],
      ['UAP-AC-IW : 6 unit', true],
      ['AF-5XHD-EU = 20', true],
      ['Kirim sore', false],
      ['CV.Prisma :', false],
      ['Orderan Pak OKY -', false],
      ['D~net', false],
    ];
    for (const [s, cek] of kasus) expect(isChecklistLine(s)).toBe(cek);
  });

  test('masukan kosong; teks tanpa item menjadi satu task tanpa customer', () => {
    expect(splitWhatsappBatch('')).toEqual([]);
    expect(splitWhatsappBatch('Judul :')).toEqual([{ customerSuggestion: '', note: 'Judul :' }]);
  });

  test('teks sebelum judul pertama menjadi task tanpa usulan customer', () => {
    expect(splitWhatsappBatch('A = 1 unit\nCV X :\nB = 2 unit')).toEqual([
      { customerSuggestion: '', note: '- [ ] A = 1 unit' },
      { customerSuggestion: 'CV X', note: '- [ ] B = 2 unit' },
    ]);
  });

  test('contoh 5: judul tanpa simbol, koma, pemisah ":", pesan tiap judul', () => {
    const contoh5 = [
      '[19/8, 10.53] Mas_Hendra WHJH: D~net',
      'RB 1100 X4               :3 unit (1 unit sudah di ciwo)',
      'CCR2116-12G-4S+   : 3 unit',
      'CCR2004-16G-2S+    : 2 unit',
      '[28/9, 10.14] Mas_Aden JH: Cv. Prisma,',
      'Paket V1600G1-B (AC+DC 48V) with SFP C++++ 8 unit = 5 Set',
      '[28/9, 10.49] Mas_Aden JH: Indo Akses,',
      'CCR2116-12g-4S+ = 2 unit',
      '[28/9, 11.53] Mas_Aden JH: Indo Akses,',
      'SFP C++++ = 10 unit',
      'PX20 ++++ = 10 unit',
      '[29/9, 12.30] Mas-Indi: Cv. Prisma,',
      'Paket V1600G1-B (AC+DC 48V) with SFP C++++ 8 unit = 50 Set',
      '[2/10, 08.57] Mas_Aden JH: Surya Dexacom,',
      'POE-24V-12W Gig = 3 unit',
      '[2/10, 15.41] Mas_Aden JH: Dutakom,',
      'U6-Pro = 1 unit',
    ].join('\n');
    const hasil = splitWhatsappBatch(contoh5);
    expect(hasil.map((t) => t.customerSuggestion)).toEqual([
      'D~net',
      'Cv. Prisma',
      'Indo Akses',
      'Indo Akses',
      'Cv. Prisma',
      'Surya Dexacom',
      'Dutakom',
    ]);
    expect(hasil.map((t) => t.note.split('\n').length)).toEqual([3, 1, 1, 2, 1, 1, 1]);
    expect(hasil[0]?.note.split('\n')[0]).toBe('- [ ] RB 1100 X4 :3 unit (1 unit sudah di ciwo)');
    expect(hasil[1]?.note).toContain('= 5 Set');
    expect(hasil[4]?.note).toContain('= 50 Set');
  });

  test('contoh 6: judul berisi angka/koma, baris kosong setelah judul, item tanpa satuan', () => {
    const contoh6 = [
      '[2/10, 08.35] Mas_Hendra WHJH: Orderan Online dari 3 resi',
      'UAP-AC-IW : 6 unit',
      '[7/10, 08.23] Mas-Indi: Alokasi SAS, pengambilan nyicil',
      '',
      'AF-5XHD-EU = 20',
      'LBE-M5-23-EU = 20',
      'RD-5G30 = 6',
      'RD-5G30-LW = 20',
      'U6-Mesh-Pro-EU = 10',
      'UAP-AC-PRO-EU = 30',
      'USW-Flex-2.5G-5-EU = 3',
    ].join('\n');
    const hasil = splitWhatsappBatch(contoh6);
    expect(hasil).toHaveLength(2);
    expect(hasil[0]).toEqual({
      customerSuggestion: 'Orderan Online dari 3 resi',
      note: '- [ ] UAP-AC-IW : 6 unit',
    });
    expect(hasil[1]?.customerSuggestion).toBe('Alokasi SAS, pengambilan nyicil');
    expect(hasil[1]?.note.split('\n')).toHaveLength(7);
  });

  test('judul sebaris awalan; baris non-item di antara dua item menjadi judul task berikutnya', () => {
    const hasil = splitWhatsappBatch(
      ['A = 1 unit', 'Pelanggan B -', 'C = 2 unit', 'kirim sore'].join('\n'),
    );
    expect(hasil).toEqual([
      { customerSuggestion: '', note: '- [ ] A = 1 unit' },
      { customerSuggestion: 'Pelanggan B', note: '- [ ] C = 2 unit\n\nkirim sore' },
    ]);
  });

  test('customer sama di pesan berbeda tetap task terpisah', () => {
    const hasil = splitWhatsappBatch(
      ['[1/1, 10.00] Aku: PT X,', 'A = 1', '[1/1, 10.05] Aku: PT X,', 'B = 2'].join('\n'),
    );
    expect(hasil).toHaveLength(2);
  });

  test('tanda * literal di-escape agar tidak menjadi miring; format WhatsApp tetap diubah', () => {
    expect(whatsappToNoteMarkdown('2*3 = 6 unit')).toBe('- [ ] 2\\*3 = 6 unit');
    expect(whatsappToNoteMarkdown('A*B*C = 1 unit')).toBe('- [ ] A\\*B\\*C = 1 unit');
    expect(whatsappToNoteMarkdown('RB_5009_X = 1 unit')).toBe('- [ ] RB_5009_X = 1 unit');
    expect(whatsappToNoteMarkdown('*Penting* A*B = 1')).toBe('- [ ] **Penting** A\\*B = 1');
  });

  test('whatsappToNoteMarkdown memakai definisi item baru dan tidak memecah', () => {
    expect(whatsappToNoteMarkdown('D~net\nRB 1100 X4 :3 unit\nAF = 20')).toBe(
      'D~net\n\n- [ ] RB 1100 X4 :3 unit\n- [ ] AF = 20',
    );
  });
});
