// Oracle uji: persis `ScriptTemplate.Render` aplikasi lama (WPF). Replace literal berurutan atas
// tujuh kunci, semua kemunculan, peka huruf besar/kecil, nilai null menjadi string kosong, tanpa
// escape. Hanya dipakai tes untuk membuktikan paritas pada nilai "aman"; JANGAN dipakai di kode
// produksi (nilai tak aman merusak skrip tanpa peringatan).

const LEGACY_KEYS = [
  'ipTarget',
  'usernameTarget',
  'passwordTarget',
  'ipServer',
  'usernameServer',
  'passwordServer',
  'sshKey',
] as const;

export function legacyRender(
  raw: string,
  values: Partial<Record<(typeof LEGACY_KEYS)[number], string | null>>,
): string {
  if (!raw) return raw;
  let out = raw;
  for (const key of LEGACY_KEYS) {
    out = out.split(`{${key}}`).join(values[key] ?? '');
  }
  return out;
}
