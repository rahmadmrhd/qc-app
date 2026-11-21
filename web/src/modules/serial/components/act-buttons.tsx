import { type ActorModules, availableActions, type SerialFlowState } from '@shared/serial-flow';
import { Button } from '@/components/ui/button';
import { flowRowLabel } from '../lib/labels';

/**
 * Jenis dialog update. Beberapa aksi tabel transisi digabung jadi satu dialog: Diagnosis memuat tahap diagnosis,
 * diperbaiki, selesai, dan Rusak; Cek ulang memuat hasil lolos atau tidak lolos (rancangan laporan rusak §4.4).
 */
export type ActKind = 'report' | 'send' | 'receive' | 'diagnosis' | 'recheck' | 'note';

export interface ActButtonSpec {
  kind: ActKind;
  label: string;
}

const KIND_OF = {
  report_failure: 'report',
  send: 'send',
  receive: 'receive',
  service_diagnosis: 'diagnosis',
  declare_broken: 'diagnosis',
  recheck: 'recheck',
  recheck_pass: 'recheck',
  recheck_fail: 'recheck',
  note: 'note',
} as const;

/** Urutan tombol: aksi alur dulu, Catatan terakhir. */
const KIND_ORDER: readonly ActKind[] = [
  'report',
  'send',
  'receive',
  'diagnosis',
  'recheck',
  'note',
];

const KIND_LABEL: Record<ActKind, string> = {
  report: 'Lapor rusak',
  send: 'Kirim ke servis',
  receive: 'Terima',
  diagnosis: 'Diagnosis',
  recheck: 'Cek ulang',
  note: 'Catatan',
};

/** Tombol yang tersedia (satu per jenis dialog) menurut tabel transisi: sumber yang sama dengan server. */
export function actButtonSpecs(state: SerialFlowState, actor: ActorModules): ActButtonSpec[] {
  const rows = availableActions(state, actor);
  const kinds = new Set(rows.map((row) => KIND_OF[row.action]));
  return KIND_ORDER.filter((kind) => kinds.has(kind)).map((kind) => {
    const receive = rows.find((row) => row.action === 'receive');
    return {
      kind,
      label: kind === 'receive' && receive ? flowRowLabel(receive) : KIND_LABEL[kind],
    };
  });
}

export interface ActButtonsProps {
  state: SerialFlowState;
  actor: ActorModules;
  onPick: (kind: ActKind) => void;
}

/** Baris tombol update di sebelah judul "Riwayat": satu tombol per aksi yang tersedia. Tanpa aksi, tidak tampil. */
export function ActButtons({ state, actor, onPick }: ActButtonsProps) {
  const specs = actButtonSpecs(state, actor);
  if (specs.length === 0) return null;
  return (
    <fieldset
      aria-label="Update baru"
      data-tour="serial-actions"
      className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
    >
      {specs.map((spec) => (
        <Button
          key={spec.kind}
          type="button"
          size="sm"
          variant={spec.kind === 'report' ? 'soft' : 'outline'}
          color={spec.kind === 'report' ? 'destructive' : 'primary'}
          onClick={() => onPick(spec.kind)}
        >
          {spec.label}
        </Button>
      ))}
    </fieldset>
  );
}
