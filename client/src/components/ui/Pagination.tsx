import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

/** Previous/next paging with the position announced. Hidden when there is a single page. */
export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        icon={<ChevronLeft className="size-4" aria-hidden="true" />}
      >
        Previous
      </Button>
      <span className="text-sm text-muted" aria-current="page">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
    </nav>
  );
}
