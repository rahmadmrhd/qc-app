export const brandKeys = {
  all: ['brands'] as const,
  list: ['brands', 'list'] as const,
  one: (id: string) => ['brands', 'one', id] as const,
};
