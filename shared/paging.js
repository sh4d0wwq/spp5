export function normalizePage(page) {
  const pageNum = Math.max(1, Number(page?.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(page?.pageSize) || 20));
  return { pageNum, pageSize, offset: (pageNum - 1) * pageSize };
}

export function toConnection(nodes, total, pageNum, pageSize) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  return {
    nodes,
    totalCount: total,
    pageInfo: {
      page: pageNum,
      pageSize,
      totalPages: total === 0 ? 0 : totalPages,
      hasNextPage: pageNum * pageSize < total,
      hasPreviousPage: pageNum > 1 && total > 0,
    },
  };
}

export function emptyConnection(page) {
  const { pageNum, pageSize } = normalizePage(page);
  return toConnection([], 0, pageNum, pageSize);
}

export function directionOf(sort) {
  return sort?.direction === 'DESC' ? 'DESC' : 'ASC';
}

export function likeContains(raw) {
  const cleaned = String(raw ?? '').trim().toLowerCase().replace(/[%_\\]/g, '');
  if (!cleaned) return null;
  return `%${cleaned}%`;
}

export function toFts(raw) {
  const terms = String(raw ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 2)
    .slice(0, 8);
  if (!terms.length) return null;
  return terms.map((term) => `"${term.replaceAll('"', '')}"*`).join(' AND ');
}
