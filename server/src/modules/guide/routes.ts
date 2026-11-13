// SEMENTARA, diganti Task 3: rute panduan interaktif. `RouteTable` dipetakan dari `ApiContract`, jadi id `guides.*`
// butuh entri agar typecheck hijau; ketiganya mengembalikan daftar kosong sampai modul sungguhan ada.
import type { RouteTable } from '@server/core/router';

type GuideMethod = 'guides.list' | 'guides.mark' | 'guides.reset';

export function guideRoutes(): Pick<RouteTable, GuideMethod> {
  return {
    'guides.list': { validate: () => null, handler: () => [] },
    'guides.mark': {
      validate: (raw) => raw as { id: string; version: number },
      handler: () => [],
    },
    'guides.reset': { validate: (raw) => raw as { id: string }, handler: () => [] },
  };
}
