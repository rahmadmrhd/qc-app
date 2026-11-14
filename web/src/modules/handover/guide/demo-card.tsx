import type { HandoverCommentDto, HandoverDto } from '@shared/contract';
import { deriveHandoverStatus } from '@shared/handover';
import { makeAnchor, noteToPlainText } from '@shared/handover-comments';
import { useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { HandoverCard } from '../components/handover-card';

/**
 * Kartu task CONTOH untuk demo tooltip (spek 4.6, keputusan 2026-11-14 butir F): memakai komponen asli
 * `HandoverCard`/`NoteView` dengan data palsu yang dibuat di sini, jadi tampilannya selalu sama dengan aplikasi.
 * Tanpa efek samping: tidak ada `api()`, kueri, mutasi, atau tulis storage; semua handler kosong, dan
 * `owner = ''` membuat kartu tak membaca antrean centang di perangkat.
 */

export const DEMO_ITEMS = ['CRS310 = 2 unit', 'RB5009UG = 1 unit', 'AF 5XHD = 5 unit'] as const;
export const DEMO_NOTE = DEMO_ITEMS.map((item) => `- [ ] ${item}`).join('\n');
export const DEMO_CHECKER = 'Rina QC';
const DEMO_CHECK_TIMES = [
  '2026-11-13T02:40:00.000Z',
  '2026-11-13T02:52:00.000Z',
  '2026-11-13T03:05:00.000Z',
];

/** Komentar contoh pada butir pertama; jangkar dihitung dari teks polos catatan seperti aplikasi. */
export const DEMO_COMMENT_BODY = 'Stok di gudang tinggal 1 unit, tolong dicek dulu ya.';

export function demoComment(): HandoverCommentDto {
  const anchor = makeAnchor(noteToPlainText(DEMO_NOTE), 0, DEMO_ITEMS[0].length);
  return {
    id: 'demo-komentar',
    ...anchor,
    body: DEMO_COMMENT_BODY,
    author: DEMO_CHECKER,
    at: '2026-11-13T03:10:00.000Z',
    stale: false,
  };
}

/** Task contoh dengan `checked` butir pertama tercentang (status turunan seperti aplikasi). */
export function demoHandover(checked: number, comments: HandoverCommentDto[] = []): HandoverDto {
  const status = deriveHandoverStatus('open', {
    total: DEMO_ITEMS.length,
    done: checked,
    completed: false,
  });
  return {
    id: 'demo',
    number: 'ST-20261113-001',
    locationId: 'demo',
    customerId: 'demo',
    customerName: 'PT Maju Jaya',
    note: DEMO_NOTE,
    status,
    checklist: DEMO_ITEMS.map((text, index) => ({
      index,
      text,
      checked: index < checked,
      by: index < checked ? DEMO_CHECKER : '',
      at: index < checked ? (DEMO_CHECK_TIMES[index] ?? '') : '',
    })),
    comments,
    completedAt: '',
    completedBy: '',
    createdAt: '2026-11-13T02:00:00.000Z',
    createdBy: 'Rina WH',
    updatedAt: '2026-11-13T02:00:00.000Z',
    updatedBy: 'Rina WH',
  };
}

const NOOP = () => undefined;

/** Kartu asli dengan data contoh; lencana "Contoh" menegaskan ini bukan data sungguhan. */
export function DemoHandoverCard({
  handover,
  interactiveLook = true,
}: {
  handover: HandoverDto;
  /** `true` = tampilan seperti akun QC (centang tidak redup); `false` = hanya baca. */
  interactiveLook?: boolean;
}) {
  return (
    <div className="relative p-3 pt-5" data-slot="demo-card">
      <Badge variant="secondary" className="absolute top-1.5 right-3">
        Contoh
      </Badge>
      <HandoverCard
        handover={handover}
        owner=""
        canMarkDone={interactiveLook}
        canEdit={false}
        canCancel={false}
        pending={false}
        tourTarget={false}
        onOpen={NOOP}
        onCheck={NOOP}
        onMarkDone={NOOP}
        onReopen={NOOP}
        onEdit={NOOP}
        onCancel={NOOP}
        onComment={NOOP}
      />
    </div>
  );
}

/**
 * Menyeleksi teks `quote` di dalam kontainer (seleksi asli peramban, jadi sorotannya sama dengan aslinya dan
 * `NoteView` memunculkan tombol "Balas" sendiri). Catatan dirender malas, jadi dicoba lagi tiap DOM berubah. Hanya
 * menyentuh seleksi dokumen, dan melepasnya saat adegan berganti.
 */
export function useDemoSelection(quote: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = ref.current;
    if (!container || quote === null) return;
    let done = false;
    const select = () => {
      if (done || typeof window.getSelection !== 'function') return;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const start = node.textContent?.indexOf(quote) ?? -1;
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + quote.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        done = true;
        observer.disconnect();
        return;
      }
    };
    const observer = new MutationObserver(select);
    observer.observe(container, { childList: true, subtree: true });
    select();
    return () => {
      observer.disconnect();
      const selection = window.getSelection?.();
      if (selection && selection.rangeCount > 0) {
        const anchor = selection.anchorNode;
        if (anchor && container.contains(anchor)) selection.removeAllRanges();
      }
    };
  }, [quote]);
  return ref;
}
