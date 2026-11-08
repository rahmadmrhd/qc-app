import type { UserDto, UserStatus } from '@shared/contract';

export interface UserFilter {
  q: string;
  status: UserStatus | 'all';
}

export function filterUsers(users: readonly UserDto[], filter: UserFilter): UserDto[] {
  const query = filter.q.trim().toLowerCase();
  return users.filter((user) => {
    if (filter.status !== 'all' && user.status !== filter.status) return false;
    if (!query) return true;
    return user.email.includes(query) || user.name.toLowerCase().includes(query);
  });
}
