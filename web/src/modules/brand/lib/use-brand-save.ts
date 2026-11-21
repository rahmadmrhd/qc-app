import { toast } from 'sonner';
import {
  type BrandSaveInput,
  type BrandSaveResult,
  brandSaveFailure,
} from '../components/brand-form-dialog';
import { useSaveBrand } from '../queries';

/** Simpan merk dari `BrandFormDialog`: toast sukses, galat dikembalikan agar tampil di dialog (dipakai daftar dan View). */
export function useBrandSave(): (input: BrandSaveInput) => Promise<BrandSaveResult> {
  const save = useSaveBrand();
  return async (input) => {
    try {
      await save.mutateAsync(input);
      toast.success(input.id ? 'Merk diperbarui' : 'Merk ditambahkan');
      return null;
    } catch (error) {
      return brandSaveFailure(error);
    }
  };
}
