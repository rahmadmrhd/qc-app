import type { DemoScene } from '@/modules/guide/lib/demo-types';
import { DemoHandoverCard, demoHandover } from './demo-card';

/**
 * Demo tooltip `tip-handover-checklist` (spek 4.6): kartu task contoh memakai komponen asli. Hanya tampilan
 * (`inert`): tidak ada yang dapat diklik atau diubah, tanpa data atau halaman asli.
 */
function ChecklistFrame({ checked }: { checked: number }) {
  return (
    <div inert>
      <DemoHandoverCard handover={demoHandover(checked)} />
    </div>
  );
}

export const ChecklistDemoScenes: readonly DemoScene[] = [
  {
    kind: 'kode',
    caption: 'Isi catatan task berupa checklist, satu butir per barang.',
    durationMs: 3500,
    render: () => <ChecklistFrame checked={0} />,
  },
  {
    kind: 'kode',
    caption:
      'Tim QC mencentang butir yang sudah dikerjakan. Nama dan waktunya tercatat, status jadi Dikerjakan.',
    durationMs: 4000,
    render: () => <ChecklistFrame checked={1} />,
  },
  {
    kind: 'kode',
    caption: 'Kalau semua butir tercentang, status task otomatis jadi Selesai.',
    durationMs: 4000,
    render: () => <ChecklistFrame checked={3} />,
  },
];
