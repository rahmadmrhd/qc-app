import type { UserContext } from '@server/modules/access/context';
import { buIdsWithLevel } from '@shared/business-units';

/**
 * BU yang boleh dilihat user untuk item (level `item` >= `view` pada BU itu). Himpunan kosong = tidak melihat item
 * apa pun (user tanpa penugasan BU, atau penugasannya basi). Dipakai jalur baca item, berkas item, dan aturan tulis.
 */
export function visibleBuIds(user: UserContext): string[] {
  return buIdsWithLevel(user.businessUnits, 'item', 'view');
}
