import { expect, test } from 'vitest';
import { postelDeleteUsage } from './delete-usage';

test('keterangan hapus menyebut jumlah item dan bahwa item tersambung lagi saat dipulihkan (bukan "dilepas")', () => {
  const text = postelDeleteUsage(3);
  expect(text).toContain('Memuat 3 item');
  expect(text).toContain('dipulihkan');
  expect(text).not.toContain('dilepas');
});
