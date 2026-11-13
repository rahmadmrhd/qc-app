import type { MeDto } from '@shared/contract';
import { useSuspenseQuery } from '@tanstack/react-query';
import { meQueryOptions } from './queries';

export function useMe(): MeDto {
  return useSuspenseQuery(meQueryOptions()).data;
}
