import { type ReactNode, useId, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
 * Daftar tab menempel di bawah header (`stickyTop`: offset headroom di halaman, `0px` di dalam dialog).
 */
export function FormTabs({
  tabs,
  value,
  onValueChange,
  stickyTop = 'var(--headroom-offset,3.5rem)',
}: {
  tabs: readonly FormTab[];
  value?: string;
  onValueChange?: (id: string) => void;
  stickyTop?: string;
}) {
  const [local, setLocal] = useState(tabs[0]?.id);
  const hintId = useId();
  const active = value ?? local;
  return (
    <Tabs
      value={active}
      onValueChange={(id) => {
        setLocal(id);
        onValueChange?.(id);
      }}
    >
      <span id={hintId} className="sr-only">
        ada isian yang belum benar
      </span>
      <TabsList
        variant="line"
        style={{ top: stickyTop }}
        className="sticky z-10 h-auto w-full justify-start rounded-none border-b bg-background"
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            data-form-tab={tab.id}
            aria-describedby={tab.hasError ? hintId : undefined}
            className="flex-none px-3 py-2"
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
          className="pt-4"
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
