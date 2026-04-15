import { Button } from "./Button"

export interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

function clampPage(page: number, totalPages: number) {
  return Math.max(1, Math.min(page, totalPages))
}

function buildPages(currentPage: number, totalPages: number) {
  const pages = new Set<number>([1, totalPages, currentPage - 1, currentPage, currentPage + 1])
  return Array.from(pages)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right)
}

export function Pagination({ onPageChange, page, pageSize, total }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = clampPage(page, totalPages)
  const pages = buildPages(safePage, totalPages)

  if (totalPages <= 1) {
    return null
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onPageChange(safePage - 1)}
        disabled={safePage === 1}
        className="h-8 w-8 px-0 py-0 text-slate-600"
        aria-label="Previous page"
      >
        ‹
      </Button>

      {pages.map((pageNumber) => (
        <Button
          key={pageNumber}
          variant={pageNumber === safePage ? "primary" : "ghost"}
          size="sm"
          onClick={() => onPageChange(pageNumber)}
          className={["h-8 w-8 px-0 py-0", pageNumber !== safePage ? "text-slate-600" : ""].join(" ")}
        >
          {pageNumber}
        </Button>
      ))}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onPageChange(safePage + 1)}
        disabled={safePage === totalPages}
        className="h-8 w-8 px-0 py-0 text-slate-600"
        aria-label="Next page"
      >
        ›
      </Button>
    </div>
  )
}
