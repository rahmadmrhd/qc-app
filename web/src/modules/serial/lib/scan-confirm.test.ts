import { expect, test } from 'vitest';
import {
  CONFIRM_FRAMES_1D,
  CONFIRM_FRAMES_2D,
  CONFIRM_REPEAT_COOLDOWN_MS,
  CONFIRM_WINDOW_MS,
  createScanConfirmer,
} from './scan-confirm';

function setup() {
  let time = 1000;
  const confirmer = createScanConfirmer({ now: () => time });
  return {
    confirmer,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

test('konstanta: 2D lebih longgar daripada 1D, dalam jendela 1,2 dtk', () => {
  expect(CONFIRM_FRAMES_2D).toBe(2);
  expect(CONFIRM_FRAMES_1D).toBe(3);
  expect(CONFIRM_WINDOW_MS).toBe(1200);
});

test('1D diterima pada bingkai ke-3 yang sama berturut-turut, bukan lebih awal', () => {
  const { confirmer, advance } = setup();
  const code = { text: 'SN123456', format: 'code_128' };
  expect(confirmer.observe(code)).toBeNull();
  advance(120);
  expect(confirmer.observe(code)).toBeNull();
  advance(120);
  expect(confirmer.observe(code)).toBe('SN123456');
});

test('2D diterima pada bingkai ke-2', () => {
  const { confirmer, advance } = setup();
  for (const format of ['qr_code', 'data_matrix', 'aztec', 'pdf417']) {
    const text = `X-${format}`;
    expect(confirmer.observe({ text, format })).toBeNull();
    advance(120);
    expect(confirmer.observe({ text, format })).toBe(text);
    advance(CONFIRM_REPEAT_COOLDOWN_MS + 1);
    confirmer.observe(null);
  }
});

test('tanpa format dianggap 1D (lebih ketat)', () => {
  const { confirmer, advance } = setup();
  const code = { text: 'ABC' };
  expect(confirmer.observe(code)).toBeNull();
  advance(120);
  expect(confirmer.observe(code)).toBeNull();
  advance(120);
  expect(confirmer.observe(code)).toBe('ABC');
});

test('bacaan parsial yang berganti-ganti ditolak', () => {
  const { confirmer, advance } = setup();
  const reads = [
    '602232C88836',
    '602232106',
    '602232183W',
    '602232C88836',
    '602232106',
    '602232183W',
  ];
  for (const text of reads) {
    expect(confirmer.observe({ text, format: 'code_128' })).toBeNull();
    advance(120);
  }
});

test('bingkai tanpa bacaan mereset hitungan', () => {
  const { confirmer, advance } = setup();
  const code = { text: 'SN1', format: 'code_128' };
  confirmer.observe(code);
  advance(120);
  confirmer.observe(code);
  advance(120);
  expect(confirmer.observe(null)).toBeNull();
  advance(120);
  expect(confirmer.observe(code)).toBeNull();
  advance(120);
  expect(confirmer.observe(code)).toBeNull();
  advance(120);
  expect(confirmer.observe(code)).toBe('SN1');
});

test('bacaan berbeda di tengah mereset; hitungan dimulai dari 1 untuk teks baru', () => {
  const { confirmer, advance } = setup();
  const a = { text: 'AAA', format: 'code_128' };
  const b = { text: 'BBB', format: 'code_128' };
  confirmer.observe(a);
  advance(120);
  confirmer.observe(a);
  advance(120);
  expect(confirmer.observe(b)).toBeNull();
  advance(120);
  expect(confirmer.observe(b)).toBeNull();
  advance(120);
  expect(confirmer.observe(b)).toBe('BBB');
});

test('jendela waktu: bingkai yang sama tetapi tersebar lebih lama dari jendela tidak dihitung', () => {
  const { confirmer, advance } = setup();
  const code = { text: 'SN1', format: 'code_128' };
  expect(confirmer.observe(code)).toBeNull();
  advance(CONFIRM_WINDOW_MS - 100);
  expect(confirmer.observe(code)).toBeNull();
  // Bingkai ke-3 jatuh di luar jendela sejak bingkai pertama: seri dimulai ulang dari bingkai ini.
  advance(200);
  expect(confirmer.observe(code)).toBeNull();
  advance(120);
  expect(confirmer.observe(code)).toBeNull();
  advance(120);
  expect(confirmer.observe(code)).toBe('SN1');
});

test('setelah diterima, ditahan terus tidak diteruskan lagi; kembali sesudah jeda hilang dan cooldown', () => {
  const { confirmer, advance } = setup();
  const code = { text: 'SN1', format: 'qr_code' };
  confirmer.observe(code);
  advance(120);
  expect(confirmer.observe(code)).toBe('SN1');
  for (let i = 0; i < 20; i++) {
    advance(120);
    expect(confirmer.observe(code)).toBeNull();
  }
  // Hilang sebentar lalu terlihat lagi dalam cooldown: tidak diteruskan.
  confirmer.observe(null);
  advance(120);
  expect(confirmer.observe(code)).toBeNull();
  advance(120);
  expect(confirmer.observe(code)).toBeNull();
  // Setelah cooldown sejak penerimaan terakhir berlalu, bacaan baru lagi (hilang dulu) diteruskan lagi.
  confirmer.observe(null);
  advance(CONFIRM_REPEAT_COOLDOWN_MS);
  confirmer.observe(code);
  advance(120);
  expect(confirmer.observe(code)).toBe('SN1');
});

test('teks lain langsung bisa diterima walau teks sebelumnya baru diterima (cooldown per teks)', () => {
  const { confirmer, advance } = setup();
  confirmer.observe({ text: 'AAA', format: 'qr_code' });
  advance(120);
  expect(confirmer.observe({ text: 'AAA', format: 'qr_code' })).toBe('AAA');
  advance(120);
  confirmer.observe({ text: 'BBB', format: 'qr_code' });
  advance(120);
  expect(confirmer.observe({ text: 'BBB', format: 'qr_code' })).toBe('BBB');
});

test('format 1D dan 2D bercampur pada teks yang sama: memakai yang lebih ketat', () => {
  const { confirmer, advance } = setup();
  confirmer.observe({ text: 'ABC', format: 'code_128' });
  advance(120);
  expect(confirmer.observe({ text: 'ABC', format: 'qr_code' })).toBeNull();
  advance(120);
  expect(confirmer.observe({ text: 'ABC', format: 'qr_code' })).toBe('ABC');
});

test('teks kosong dianggap tak ada bacaan', () => {
  const { confirmer, advance } = setup();
  const code = { text: 'SN1', format: 'code_128' };
  confirmer.observe(code);
  advance(120);
  confirmer.observe({ text: '', format: 'code_128' });
  advance(120);
  expect(confirmer.observe(code)).toBeNull();
});
