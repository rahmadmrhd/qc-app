/** Fixture tes: byte dari teks base64 (isi berkas di kabel REST adalah byte mentah; jembatan palsu menyimpan base64). */
export function bytesOfBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'));
}
