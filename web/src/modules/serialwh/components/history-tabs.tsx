import { LINE_TAB_LIST_CLASS, LINE_TAB_TRIGGER_CLASS } from '@/components/page/tab-styles';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export interface HistoryTabsProps {
  tab: 'order' | 'ready';
  onChange: (tab: 'order' | 'ready') => void;
}

/** Tab Riwayat Gudang: "Keluar ke SO" (catatan SO) dan "Ready" (pencatatan tanpa SO). */
export function HistoryTabs({ tab, onChange }: HistoryTabsProps) {
  return (
    <Tabs value={tab} onValueChange={(next) => onChange(next === 'ready' ? 'ready' : 'order')}>
      <TabsList variant="line" className={LINE_TAB_LIST_CLASS} aria-label="Jenis riwayat">
        <TabsTrigger value="order" className={LINE_TAB_TRIGGER_CLASS}>
          Keluar ke SO
        </TabsTrigger>
        <TabsTrigger value="ready" className={LINE_TAB_TRIGGER_CLASS}>
          Ready
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
