import { cn } from 'cn';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { onFormTabRequest } from '@/lib/form-tab-request';
import { LINE_TAB_LIST_CLASS, LINE_TAB_TRIGGER_CLASS } from './tab-styles';

export interface FormTab {
  id: string;
  label: string;
  content: ReactNode;
  /** Ada isian bergalat di tab ini: tab diberi titik merah. */
  hasError?: boolean;
}

/** Tab pertama yang memuat galat (untuk dibuka saat submit gagal validasi), atau `undefined`. */
export function firstTabWithError(tabs: readonly FormTab[]): string | undefined {
  return tabs.find((tab) => tab.hasError)?.id;
}

/**
 * Tab form. Semua isi tab tetap ter-mount (hanya `hidden`) agar nilai dan validasi field di tab lain tetap hidup.
 * Daftar tab menempel di bawah header: di dalam `FormDialogContent` tepat di bawah header dialog
 * (`--dialog-header-height`, diukur), di halaman di bawah bar headroom (`--headroom-offset`); `stickyTop` menimpa.
 */
export function FormTabs({
  tabs,
  value,
  onValueChange,
  stickyTop = 'var(--dialog-header-height,var(--headroom-offset,3.5rem))',
}: {
  tabs: readonly FormTab[];
  value?: string;
  onValueChange?: (id: string) => void;
  stickyTop?: string;
}) {
  const [local, setLocal] = useState(tabs[0]?.id);
  const hintId = useId();
  const requested = value ?? local;
  // Id tak dikenal (mis. `?tab=` basi) jatuh ke tab pertama agar panel tak kosong.
  const active = tabs.some((tab) => tab.id === requested) ? requested : tabs[0]?.id;
  const select = (id: string) => {
    setLocal(id);
    onValueChange?.(id);
  };
  // Permintaan dari luar (panduan interaktif): memakai jalur pilih yang sama dengan klik pengguna.
  const latest = useRef({ tabs, select });
  latest.current = { tabs, select };
  useEffect(
    () =>
      onFormTabRequest((tabId) => {
        if (!latest.current.tabs.some((tab) => tab.id === tabId)) return false;
        latest.current.select(tabId);
        return true;
      }),
    [],
  );
  return (
    <Tabs value={active} onValueChange={select}>
      <span id={hintId} className="sr-only">
        ada isian yang belum benar
      </span>
      <TabsList variant="line" style={{ top: stickyTop }} className={LINE_TAB_LIST_CLASS}>
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            data-form-tab={tab.id}
            aria-describedby={tab.hasError ? hintId : undefined}
            className={cn(LINE_TAB_TRIGGER_CLASS)}
          >
            {tab.label}
            {tab.hasError ? (
              <span
                data-slot="tab-error-dot"
                aria-hidden
                className="size-1.5 rounded-full bg-destructive"
              />
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent
          key={tab.id}
          value={tab.id}
          data-form-tab={tab.id}
          forceMount
          // Radix tidak menyembunyikan panel ber-forceMount; tanpa `hidden` semua panel tampil sekaligus.
          hidden={tab.id !== active}
          className="pt-3"
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
