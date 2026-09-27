/** Shared pagination contract, so every list endpoint answers the same shape. */
export const PAGE_SIZE_DEFAULT = 24;
export const PAGE_SIZE_MAX = 100;

export type PageMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

export function pageMeta(page: number, pageSize: number, total: number): PageMeta {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1 && total > 0,
  };
}

export function offsetFor(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}
