/** Which accounts are ticked on the holdings page, remembered per user in this browser. */

export interface SavedSelection {
  selected: number[];
  /** Account ids that existed when this was saved, so accounts created later default to ticked. */
  known: number[];
}

const key = (userId: number) => `cinnamon.holdings.selection.${userId}`;

export function loadSelection(userId: number): SavedSelection | null {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedSelection>;
    const ints = (a: unknown) => Array.isArray(a) && a.every((n) => Number.isInteger(n));
    return ints(v.selected) && ints(v.known) ? (v as SavedSelection) : null;
  } catch {
    return null; // private mode, blocked storage or corrupt JSON: behave as if nothing was saved
  }
}

export function saveSelection(userId: number, selected: number[], known: number[]): void {
  try {
    localStorage.setItem(key(userId), JSON.stringify({ selected, known }));
  } catch {
    /* storage unavailable: the selection simply isn't remembered */
  }
}

/** Parse `?accounts=1,2`. null = parameter absent; [] = present but empty (explicitly none). */
export function parseUrlSelection(raw: string | null): number[] | null {
  if (raw === null) return null;
  if (raw.trim() === '') return [];
  const ids = raw.split(',').map((s) => Number(s));
  return ids.every((n) => Number.isInteger(n) && n > 0) ? ids : null; // junk in the URL is ignored
}

/**
 * Decide the initial selection. Priority: URL, then saved, then everything.
 * Deleted accounts are dropped; accounts created since the save are ticked.
 */
export function reconcile(
  existing: number[],
  fromUrl: number[] | null,
  saved: SavedSelection | null,
): number[] {
  if (fromUrl !== null) return existing.filter((id) => fromUrl.includes(id));
  if (saved === null) return [...existing];
  return existing.filter((id) => saved.selected.includes(id) || !saved.known.includes(id));
}
