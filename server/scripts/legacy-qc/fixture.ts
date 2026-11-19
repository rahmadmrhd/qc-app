// Mini-dump untuk tes: meniru bentuk tabel QC lama (kolom sesuai `INSERT` mysqldump) dengan kasus pinggir yang nyata.
import type { Tables } from './dump';

export function miniDump(): Tables {
  return {
    users: [
      [3, 'rahmadmrhd', 'x', 'Rahmad Maulana', 1, 1, 1, 1, '', '2022-08-26 16:07:58', 0],
      [19, 'desmon', 'x', 'Johanes Desmon', 1, 1, 2, 2, '', '2022-09-26 10:30:20', 0],
    ],
    // [id, merk, nama, isCountryLock, firmware, stickers, deleted]
    typeItem: [
      [1, 'Ubiquiti', 'UAP AC Lite', 0, 'fw1', '', 0],
      [2, 'Ubiquiti', 'UAP AC LR', 0, '', '', 0],
      [3, 'Mikrotik', 'RB4011iGS+RM', 1, 'AC', '', 0], // Country Lock + firmware sah -> kolom
      [4, 'VSOL', 'V2802DAC', 0, '', '', 0],
      [5, 'Ubiquiti', 'US-8-150W', 0, '', '', 0],
      [6, 'Ubiquiti', 'US 8 150W', 0, '', '', 0], // kunci sama dengan tipe 5 -> dilebur
      [7, 'Ubiquiti', 'Test', 2, '', '', 1], // dihapus lunak
      // Dua item Country Lock yang sudah ada di tujuan (apply.test.ts): firmware tujuan kosong -> diisi; sudah berisi -> dibiarkan.
      [8, 'Ubiquiti', 'NanoStation', 1, 'M', '', 0],
      [9, 'Ubiquiti', 'NanoStation Loco', 1, 'WA', '', 0],
      [10, 'Mikrotik', 'hEX', 1, 'kode-asing', '', 0], // kode tak ada di daftar merk -> tak dibawa, masuk detail
      [11, 'VSOL', 'V1600D', 1, 'AC', '', 0], // merk tanpa daftar firmware -> tak dibawa, masuk detail
    ],
    files: [[10, 'DRIVEID1', 'Panduan [QC]']],
    tipeAttachment: [[1, 10]],
    historyTypeItem: [[1, 1, 1, 'rahmadmrhd', 'Added to Database', '2022-03-01 10:00:00']],
    // [id, date, idTypeItem, serialNumber, sample, note, last_businessUnit, last_location, deleted]
    dataqc: [
      [100, '2024-01-10', 1, 'f5bc0f1e4059', 0, '', 1, 1, 0], // huruf kecil -> dinormalkan
      [101, '2024-02-01', 3, 'AA11BB22CC33', 1, 'Jakarta', 2, 2, 0], // Teakwave, Jakarta
      [102, '2024-03-05', 4, 'VT0001234567', 0, '', 0, 0, 0], // BU None + lokasi None -> merk VSOL -> IJW, Surabaya
      [103, '2024-01-01', 1, 'DUP12345X', 0, '', 1, 1, 0], // bentrok dengan 104 (BU 1 dan 3 = Spectrum)
      [104, '2024-05-01', 2, 'DUP12345X', 0, '', 3, 2, 0], // terbaru: menang
      [105, '2024-05-02', 1, 'HAPUS0000001', 0, '', 1, 1, 1], // dihapus lunak: dilewati
      [106, '2024-05-03', 1, 'INTERRUPTED', 0, '', 1, 1, 0], // sampah: hanya huruf
      [107, '2024-05-04', 1, 'AB 12 CD', 0, '', 1, 1, 0], // sampah: spasi
      [108, '2024-05-05', 1, 'AC8BA9543AD8  ', 0, '', 1, 1, 0], // spasi ekor dibuang; tanpa riwayat -> recorded sintetis
      [109, '2024-05-06', 1, 'ZZ99YY88XX77', 0, '', 2, 2, 0], // Ubiquiti di Teakwave
      // Serial yang sama di DUA BU lama (kasus nyata: 105 serial Spectrum + Teakwave): dilipat jadi satu, terbaru (111,
      // Teakwave) menang; Spectrum masuk riwayat BU sebagai BU yang sudah ditinggalkan.
      [110, '2024-02-01', 1, 'XBU123456789', 0, '', 1, 1, 0],
      [111, '2024-06-01', 1, 'xbu123456789', 0, '', 2, 2, 0],
    ],
    // [idDataqc, idBusinessUnit, idLocation, username, action, timestamp]
    historyDataqc: [
      [100, 1, 1, 'rahmadmrhd', 'Added to Database', '2024-01-10 09:00:00'],
      [
        100,
        1,
        1,
        'rahmadmrhd',
        'Update on:Tipe=UAP AC LR->UAP AC Lite, Test Date=09/01/2024->10/01/2024, ',
        '2024-01-11 10:00:00',
      ],
      [101, 2, 2, 'desmon', 'Added to Database', '2024-02-01 08:00:00'],
      [102, 0, 0, 'rahmadmrhd', 'Added to Database', '2024-03-05 08:00:00'],
      [103, 1, 1, 'desmon', 'Added to Database', '2024-01-01 08:00:00'],
      [104, 3, 2, 'desmon', 'Added to Database', '2024-05-01 08:00:00'],
      [104, 3, 2, 'desmon', 'Re-added to Database', '2024-05-02 08:00:00'],
      [103, 1, 1, 'desmon', 'Re-added to Database', '2024-06-01 08:00:00'], // riwayat catatan yang dilipat, paling akhir
      [105, 1, 1, 'rahmadmrhd', 'Added to Database', '2024-05-02 08:00:00'],
      [109, 2, 2, 'desmon', 'Added to Database', '2024-05-06 08:00:00'],
      [110, 1, 1, 'rahmadmrhd', 'Added to Database', '2024-02-01 08:00:00'],
      [111, 2, 2, 'desmon', 'Added to Database', '2024-06-01 09:00:00'],
    ],
  };
}
