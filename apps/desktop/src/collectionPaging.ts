export const collectionSizes = [8, 15, 30] as const;
export type CollectionSize = (typeof collectionSizes)[number];
export const defaultCollectionSize: CollectionSize = 15;

/** Keep first, last and current pages visible without an unbounded button row. */
export function pageNumbers(page: number, pages: number): (number | "gap")[] {
  const numbers =
    pages <= 5
      ? Array.from({ length: pages }, (_, i) => i + 1)
      : page <= 3
        ? [1, 2, 3, 4, pages]
        : page >= pages - 2
          ? [1, pages - 3, pages - 2, pages - 1, pages]
          : [1, page - 1, page, page + 1, pages];
  return numbers.flatMap((number, i) =>
    i && number - numbers[i - 1] > 1 ? ["gap" as const, number] : [number],
  );
}
