/** Parser sederhana berkas `.dev.vars` (KEY=value per baris, komentar `#`). */
export function parseDevVars(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Isi `.dev.vars` awal dari `.dev.vars.example` dengan rahasia sesi acak. */
export function renderDevVars(example: string, randomSecret: string): string {
  return example.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${randomSecret}`);
}
