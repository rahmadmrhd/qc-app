// Menjalankan tes di `scripts/`.
const args = ['test', './scripts'];

const proc = Bun.spawn([process.execPath, ...args], { stdout: 'inherit', stderr: 'inherit' });
process.exit(await proc.exited);

export {};
