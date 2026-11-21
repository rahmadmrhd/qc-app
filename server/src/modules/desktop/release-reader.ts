import { getBridge } from '@server/core/bridge-client';
import { nowOf } from '@server/core/env';
import { isDriveId } from '@server/core/google/settings';
import type { AppBindings } from '@server/http/security';
import { createReleaseReader, type ReleaseReader } from './app-release';

// Satu pembaca per klien Google (per proses di produksi; per env di tes) agar memo tak bocor antar tes. Dipakai rute
// publik `/api/desktop/app-*` dan rute REST `desktop.releases`.
const releaseReaders = new WeakMap<object, { folderId: string; reader: ReleaseReader }>();

/** Pembaca rilis untuk env ini, atau `null` bila `DESKTOP_RELEASES_FOLDER_ID` kosong/bukan id Drive yang sah. */
export function releaseReaderOf(env: AppBindings['Bindings']): ReleaseReader | null {
  const folderId = env.DESKTOP_RELEASES_FOLDER_ID ?? '';
  if (!isDriveId(folderId)) return null;
  const client = getBridge(env);
  const known = releaseReaders.get(client);
  if (known?.folderId === folderId) return known.reader;
  const reader = createReleaseReader({ client, folderId, now: () => nowOf(env) });
  releaseReaders.set(client, { folderId, reader });
  return reader;
}
