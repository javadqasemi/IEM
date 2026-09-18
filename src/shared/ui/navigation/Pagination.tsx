import { Button } from "@/shared/ui/primitives";

export function Pagination({
  page,
  pages,
  total,
  perPage,
  onChange,
}: {
  page: number;
  pages: number;
  total: number;
  perPage: number;
  onChange: (next: number) => void;
}) {
  if (pages <= 1) {
    return (
      <p className="eyebrow text-muted" aria-live="polite">
        {total} {total === 1 ? "Eintrag" : "Einträge"}
      </p>
    );
  }
  const first = (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="eyebrow text-muted" aria-live="polite">
        {first}–{last} von {total}
      </p>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Zurück
        </Button>
        <span className="px-2 font-mono text-[12px] tnum text-muted">
          {page} / {pages}
        </span>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Weiter
        </Button>
      </div>
    </div>
  );
}
