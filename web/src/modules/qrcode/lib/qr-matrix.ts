import { encode } from 'uqr';

/** Matriks modul QR (true = gelap), tanpa quiet zone; koreksi galat level H agar aman dengan logo di tengah. */
export function qrMatrix(text: string): boolean[][] {
  return encode(text, { ecc: 'H', border: 0 }).data;
}
