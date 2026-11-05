import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Kabel REST tidak memuat base64: tak boleh ada sisa base64 di kontrak Worker (`shared/rpc.ts`). DTO base64
// hanya hidup di `shared/gas-binary.ts` (kontrak Apps Script lama) sampai `gas/` dipensiunkan.
test('shared/rpc.ts tidak memuat base64 (selain komentar)', () => {
  const text = readFileSync(join(import.meta.dir, 'rpc.ts'), 'utf8');
  const offending = text
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(
      ({ line }) =>
        /base64/i.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*'),
    );
  expect(offending).toEqual([]);
});

test('kontrak Worker memakai byte untuk id biner', () => {
  const text = readFileSync(join(import.meta.dir, 'rpc.ts'), 'utf8');
  expect(text).toContain('bytes: Uint8Array');
  expect(text).toContain('pdf: Uint8Array');
});
