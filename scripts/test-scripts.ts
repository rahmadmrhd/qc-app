// Menjalankan tes di `scripts/`. Tes `scripts/migrate/*.test.ts` dikecualikan HANYA di Windows: Bun 1.4.2 di Windows
// segfault acak pada berkas-berkas itu (catatan rencana T33); di Linux (CI) semuanya dijalankan.
const args = ['test', './scripts'];
if (process.platform === 'win32') args.push('--path-ignore-patterns', 'scripts/migrate/*.test.ts');

const proc = Bun.spawn([process.execPath, ...args], { stdout: 'inherit', stderr: 'inherit' });
process.exit(await proc.exited);

export {};
