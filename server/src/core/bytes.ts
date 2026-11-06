// Satu-satunya tempat konversi byte <-> base64 di server: isi berkas di kabel REST adalah byte mentah, dan base64
// hanya dipakai di batas jembatan Google (`bridge-client`), cache isi berkas, dan muatan job (`job_blobs`).
// Tes pagar (`files.test.ts`) mengizinkan konversi base64 hanya di berkas ini dan `base64url.ts`.

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

export function base64ToBytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'));
}

/** Sidik pendek (hex, 24 karakter) dari teks: dipakai sebagai ETag yang tak membuka id Drive. */
export async function shortDigest(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Buffer.from(digest).toString('hex').slice(0, 24);
}
