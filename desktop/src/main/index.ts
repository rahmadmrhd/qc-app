// Entri proses utama. Sementara (Task 6) hanya menangani `--smoke` agar hasil kemas dapat
// diverifikasi; Task 14 menggantikannya dengan jendela, protokol app://, dan jembatan.

import { app } from 'electron';
import { collectSmokeReport } from './smoke';

if (process.argv.includes('--smoke')) {
  collectSmokeReport()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report)}\n`, () => app.exit(0));
    })
    .catch((error: unknown) => {
      process.stderr.write(`smoke gagal: ${String(error)}\n`, () => app.exit(1));
    });
} else {
  app.quit();
}
