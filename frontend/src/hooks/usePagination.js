import { useEffect, useMemo, useState } from "react";

/**
 * Client-side paging for a list that is already fully in memory.
 * Returns the slice for the current page plus the state the Pagination bar needs.
 *
 * @param {Array}  items    Full list to page through.
 * @param {number} pageSize Rows per page.
 */
export const usePagination = (items = [], pageSize = 10) => {
  const [page, setPage] = useState(1);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Clamp while rendering so a shrinking list never shows a blank page.
  const currentPage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageItems = useMemo(
    () => items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [items, currentPage, pageSize],
  );

  return { page: currentPage, setPage, pageItems, total, totalPages, pageSize };
};

export default usePagination;
