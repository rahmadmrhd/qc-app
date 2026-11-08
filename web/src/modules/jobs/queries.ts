import type { JobDto } from '@shared/contract';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/api-error';

export const jobKeys = {
  one: (id: string) => ['jobs', id] as const,
};

/** Jeda polling bertahap: 1 dtk, 2 dtk, lalu 5 dtk (percobaan ke-0, ke-1, selanjutnya). */
export function jobPollDelay(attempt: number): number {
  return attempt <= 0 ? 1000 : attempt === 1 ? 2000 : 5000;
}

export const isJobFinished = (job: JobDto | undefined): boolean =>
  job?.status === 'done' || job?.status === 'failed';

export function jobQueryOptions(id: string) {
  return queryOptions({
    queryKey: jobKeys.one(id),
    queryFn: () => api('jobs.get', { id }),
  });
}

/** Status pekerjaan latar; polling bertahap sampai `done` atau `failed`. */
export function useJob(jobId: string | null) {
  return useQuery({
    ...jobQueryOptions(jobId ?? ''),
    enabled: jobId !== null,
    refetchInterval: (query) =>
      isJobFinished(query.state.data) ? false : jobPollDelay(query.state.dataUpdateCount - 1),
  });
}

export interface AwaitJobOptions {
  onProgress?: (job: JobDto) => void;
  /** Disuntik agar dapat diuji. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Menunggu pekerjaan selesai dengan polling `jobs.get` (jeda bertahap). Mengembalikan job `done`; job `failed`
 * dilempar sebagai `ApiError` berisi pesan galat server agar pemanggil dapat menampilkannya dan mengulang.
 */
export async function awaitJob(jobId: string, options: AwaitJobOptions = {}): Promise<JobDto> {
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    const job = await api('jobs.get', { id: jobId });
    options.onProgress?.(job);
    if (job.status === 'done') return job;
    if (job.status === 'failed') {
      throw new ApiError('INTERNAL', job.error ?? 'Pekerjaan gagal di server. Coba ulangi.', '-');
    }
    await sleep(jobPollDelay(attempt));
  }
}
