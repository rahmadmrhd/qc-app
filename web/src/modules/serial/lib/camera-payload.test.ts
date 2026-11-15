import { expect, test } from 'vitest';
import { CAMERA_DUPLICATE_WINDOW_MS, createPayloadGate } from './camera-payload';

function setup() {
  let time = 1_000_000;
  const gate = createPayloadGate(CAMERA_DUPLICATE_WINDOW_MS, () => time);
  return {
    gate,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

test('satu payload banyak baris dipecah dengan pemecah tempel: normalisasi, tanpa duplikat dalam payload', () => {
  const { gate } = setup();
  expect(gate.accept(' abc123 \r\n4c:5e:0c:1a:2b:3d\nABC123\n\n')).toBe('ABC123\n4C5E0C1A2B3D');
});

test('payload yang sama dalam jendela tidak diteruskan lagi; setelah hilang melewati jendela diteruskan lagi', () => {
  const { gate, advance } = setup();
  expect(gate.accept('SN1')).toBe('SN1');
  advance(1000);
  expect(gate.accept('SN1')).toBeNull();
  advance(CAMERA_DUPLICATE_WINDOW_MS - 1);
  // Terlihat lagi tepat sebelum jendela habis: jendela bergeser, masih dianggap sama.
  expect(gate.accept('SN1')).toBeNull();
  advance(CAMERA_DUPLICATE_WINDOW_MS);
  expect(gate.accept('SN1')).toBe('SN1');
});

test('hanya serial yang masih baru yang diteruskan dari payload banyak baris', () => {
  const { gate, advance } = setup();
  expect(gate.accept('A1\nB2')).toBe('A1\nB2');
  advance(500);
  expect(gate.accept('A1\nC3')).toBe('C3');
  expect(gate.accept('A1\nB2')).toBeNull();
});

test('baris tak sah diteruskan (agar pemanggil menolaknya) tetapi tak berulang dalam jendela', () => {
  const { gate, advance } = setup();
  const bad = 'X'.repeat(200);
  expect(gate.accept(bad)).toBe(bad);
  advance(100);
  expect(gate.accept(bad)).toBeNull();
  expect(gate.accept('   \n  ')).toBeNull();
});
