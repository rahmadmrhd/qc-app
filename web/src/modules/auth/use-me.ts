import type { MeDto } from '@shared/rpc';
import { useSuspenseQuery } from '@tanstack/react-query';
import { meQueryOptions } from './queries';

export function useMe(): MeDto {
  return useSuspenseQuery(meQueryOptions()).data;
}
