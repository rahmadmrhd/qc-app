import type {
  ListWarehouseDispatchesInput,
  ListWarehouseDispatchSerialsInput,
  ListWarehouseHandoverCandidatesInput,
  ListWarehouseItemOptionsInput,
  ListWarehouseOrderOptionsInput,
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
  dispatches: (filter: Omit<ListWarehouseDispatchesInput, 'cursor'>) =>
    ['serialwh', 'dispatches', filter] as const,
  dispatch: (id: string) => ['serialwh', 'dispatch', id] as const,
  order: (id: string) => ['serialwh', 'order', id] as const,
  dispatchSerials: (id: string, input: Omit<ListWarehouseDispatchSerialsInput, 'id' | 'cursor'>) =>
    ['serialwh', 'dispatch-serials', id, input] as const,
  copyText: (id: string) => ['serialwh', 'copy-text', id] as const,
};
