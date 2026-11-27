import type {
  ListWarehouseDispatchSerialsInput,
  ListWarehouseHandoverCandidatesInput,
  ListWarehouseItemOptionsInput,
  ListWarehouseOrderOptionsInput,
  ListWarehouseOrdersInput,
  ListWarehouseReadyInput,
  ListWarehouseSerialsInput,
} from '@shared/contract';

/** Kunci query Keluar Gudang. Tidak masuk whitelist `query-persist`. */
export const serialwhKeys = {
  all: ['serialwh'] as const,
  itemOptions: (input: Omit<ListWarehouseItemOptionsInput, 'cursor'>) =>
    ['serialwh', 'item-options', input] as const,
  options: ['serialwh', 'options'] as const,
  serials: (filter: Omit<ListWarehouseSerialsInput, 'cursor'>) =>
    ['serialwh', 'serials', filter] as const,
  orderOptions: (input: Omit<ListWarehouseOrderOptionsInput, 'cursor'>) =>
    ['serialwh', 'order-options', input] as const,
  candidates: (input: Omit<ListWarehouseHandoverCandidatesInput, 'cursor'>) =>
    ['serialwh', 'candidates', input] as const,
  context: (handoverId: string) => ['serialwh', 'context', handoverId] as const,
  orders: (filter: Omit<ListWarehouseOrdersInput, 'cursor'>) =>
    ['serialwh', 'orders', filter] as const,
  order: (id: string) => ['serialwh', 'order', id] as const,
  readyList: (filter: Omit<ListWarehouseReadyInput, 'cursor'>) =>
    ['serialwh', 'ready-list', filter] as const,
  ready: (id: string) => ['serialwh', 'ready', id] as const,
  dispatchSerials: (id: string, input: Omit<ListWarehouseDispatchSerialsInput, 'id' | 'cursor'>) =>
    ['serialwh', 'dispatch-serials', id, input] as const,
  copyText: (id: string) => ['serialwh', 'copy-text', id] as const,
};
