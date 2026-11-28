import type { Preparer } from '@server/core/db';
import { type ClDraftFile, routerUsedBy } from '@shared/countrylock-bundle';
import { firmwareRows, listLiveFilesWithText } from './repo';

/** "Dipakai oleh" semua berkas router hidup: jalur berkas -> kode firmware yang skripnya merujuk `/temp/<nama dasar>`. */
export async function loadRouterUsage(db: Preparer): Promise<Map<string, string[]>> {
  const [heads, firmwares] = await Promise.all([listLiveFilesWithText(db), firmwareRows(db)]);
  const files: ClDraftFile[] = heads.map(({ file, revision, text }) => ({
    path: file.path,
    role: file.role,
    sha256: revision.sha256,
    size: revision.size,
    ...(text === null ? {} : { text }),
  }));
  return routerUsedBy(
    files,
    firmwares.map(({ brand, code, scriptPath, parallel }) => ({
      brand,
      code,
      scriptPath,
      parallel,
    })),
  );
}
