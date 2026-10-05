import { useEffect, useRef, useState } from "react";
import {
  collectionSizes,
  defaultCollectionSize,
  type CollectionSize,
} from "./collectionPaging.ts";

export type CollectionView = "list" | "grid";
function savedSize(scope: string): CollectionSize {
  try {
    const size = Number(
      localStorage.getItem(`openui.collection.size.${scope}`),
    );
    if (collectionSizes.includes(size as CollectionSize))
      return size as CollectionSize;
  } catch {}
  return defaultCollectionSize;
}

function savedView(scope: string): CollectionView {
  try {
    return localStorage.getItem(`openui.collection.${scope}`) === "grid"
      ? "grid"
      : "list";
  } catch {
    return "list";
  }
}

export function useCollection<T>(items: T[], scope: string, filterKey: string) {
  const [state, setState] = useState(() => ({
    scope,
    filterKey,
    view: savedView(scope),
    size: savedSize(scope),
    page: 1,
  }));
  const region = useRef<HTMLDivElement>(null);
  const scrollRequested = useRef(false);
  const revealRequested = useRef<string | null>(null);
  const view = state.scope === scope ? state.view : savedView(scope);
  const size = state.scope === scope ? state.size : savedSize(scope);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page =
    state.scope === scope && state.filterKey === filterKey
      ? Math.min(state.page, pages)
      : 1;
  const start = (page - 1) * size;
  // Commit a clamped page so later additions cannot resurrect an invalid page.
  useEffect(() => {
    if (
      state.scope !== scope ||
      state.filterKey !== filterKey ||
      state.page !== page
    )
      setState({ scope, filterKey, view, size, page });
  }, [scope, filterKey, view, size, page, state]);
  useEffect(() => {
    if (!scrollRequested.current) return;
    scrollRequested.current = false;
    const element = region.current;
    if (element && element.getBoundingClientRect().top < 0) {
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: "start" });
    }
  }, [page, view, size]);
  useEffect(() => {
    const id = revealRequested.current;
    if (!id) return;
    const item = Array.from(
      region.current?.querySelectorAll<HTMLElement>("[data-collection-id]") ||
        [],
    ).find((element) => element.dataset.collectionId === id);
    if (!item) return;
    revealRequested.current = null;
    item.focus({ preventScroll: true });
    const bounds = item.getBoundingClientRect();
    if (bounds.top < 100 || bounds.bottom > innerHeight)
      item.scrollIntoView({ block: "nearest" });
  }, [state, items]);
  return {
    view,
    page,
    pages,
    size,
    start,
    total: items.length,
    end: Math.min(start + size, items.length),
    items: items.slice(start, start + size),
    region,
    reveal(id: string, index: number, nextFilterKey: string) {
      revealRequested.current = id;
      setState({
        scope,
        filterKey: nextFilterKey,
        view,
        size,
        page: Math.floor(Math.max(0, index) / size) + 1,
      });
    },
    setPage(next: number) {
      scrollRequested.current = true;
      setState({
        scope,
        filterKey,
        view,
        size,
        page: Math.max(1, Math.min(pages, next)),
      });
    },
    setView(next: CollectionView) {
      if (next === view) return;
      try {
        localStorage.setItem(`openui.collection.${scope}`, next);
      } catch {}
      scrollRequested.current = true;
      setState({
        scope,
        filterKey,
        view: next,
        size,
        page,
      });
    },
    setSize(next: CollectionSize) {
      if (next === size || !collectionSizes.includes(next)) return;
      try {
        localStorage.setItem(`openui.collection.size.${scope}`, String(next));
      } catch {}
      scrollRequested.current = true;
      setState({
        scope,
        filterKey,
        view,
        size: next,
        page: Math.floor(start / next) + 1,
      });
    },
  };
}

export type CollectionState = ReturnType<typeof useCollection>;
