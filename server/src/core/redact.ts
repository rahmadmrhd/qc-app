/**
 * Membersihkan rahasia dari teks sebelum masuk log/galat/email: setiap kemunculan rahasia diganti `***`.
 * Rahasia kosong atau sangat pendek (< 4 karakter) diabaikan agar tidak merusak teks biasa.
 */
export function redactSecrets(text: string, ...secrets: Array<string | undefined>): string {
  let result = text;
  for (const secret of secrets) {
    if (secret === undefined || secret.length < 4) continue;
    result = result.split(secret).join('***');
  }
  return result;
}
