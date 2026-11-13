import { CHECKLIST_TIP_ID, COMMENT_TIP_ID } from '@/modules/handover/guide/tip-ids';
import { registerDemoLoader } from '../lib/demo-types';
import type { GuideEntry, GuidePermission } from '../lib/types';

const WH_VIEW: GuidePermission = { module: 'handover', level: 'view', scope: 'location' };
const QC_EDIT: GuidePermission = { module: 'qc', level: 'edit', scope: 'location' };

/**
 * Tooltip demo Serah Terima di luar `handover.ts`: kartu task CONTOH (spek 4.6, bagian 6 butir F) sehingga langkah
 * checklist dan komentar tetap terjelaskan walau papan kosong. Hanya metadata; adegannya dimuat malas.
 */
export const HANDOVER_TIP_CHECKLIST: GuideEntry = {
  id: CHECKLIST_TIP_ID,
  kind: 'tip',
  status: 'disimpan',
  version: 1,
  title: 'Cara kerja checklist dan status task',
  izin: [WH_VIEW, QC_EDIT],
  steps: [],
};

export const HANDOVER_TIP_COMMENT: GuideEntry = {
  id: COMMENT_TIP_ID,
  kind: 'tip',
  status: 'disimpan',
  version: 1,
  title: 'Cara memberi komentar pada catatan',
  izin: [WH_VIEW, QC_EDIT],
  steps: [],
};

registerDemoLoader(CHECKLIST_TIP_ID, async () => {
  const { ChecklistDemoScenes } = await import('@/modules/handover/guide/checklist-demo');
  return ChecklistDemoScenes;
});

registerDemoLoader(COMMENT_TIP_ID, async () => {
  const { CommentDemoScenes } = await import('@/modules/handover/guide/comment-demo');
  return CommentDemoScenes;
});

export const HANDOVER_TIPS: readonly GuideEntry[] = [HANDOVER_TIP_CHECKLIST, HANDOVER_TIP_COMMENT];
