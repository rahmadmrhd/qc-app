import type {
  CloneQrPdfInput,
  ExportQrDesignInput,
  QrDesignRefInput,
  SaveQrDesignInput,
  UploadQrPdfInput,
} from '@shared/rpc';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/lib/rpc';
import { accessKeys } from '@/modules/access/queries';

export const qrKeys = {
  all: ['qrcodes'] as const,
  list: ['qrcodes', 'list'] as const,
  one: (id: string) => ['qrcodes', 'one', id] as const,
};

export function qrDesignsQueryOptions() {
  return queryOptions({ queryKey: qrKeys.list, queryFn: () => rpc('qrcodes.list', null) });
}

export function qrDesignQueryOptions(id: string) {
  return queryOptions({ queryKey: qrKeys.one(id), queryFn: () => rpc('qrcodes.get', { id }) });
}

function useQrMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qrKeys.all }),
        queryClient.invalidateQueries({ queryKey: accessKeys.audit }),
      ]);
    },
  });
}

export const useSaveQrDesign = () =>
  useQrMutation((input: SaveQrDesignInput) => rpc('qrcodes.save', input));
export const useDeleteQrDesign = () =>
  useQrMutation((input: QrDesignRefInput) => rpc('qrcodes.delete', input));
export const useCloneQrPdf = () =>
  useQrMutation((input: CloneQrPdfInput) => rpc('qrcodes.cloneFromDrive', input));
export const useUploadQrPdf = () =>
  useQrMutation((input: UploadQrPdfInput) => rpc('qrcodes.uploadPdf', input));
export const useExportQrDesign = () =>
  useQrMutation((input: ExportQrDesignInput) => rpc('qrcodes.export', input));
