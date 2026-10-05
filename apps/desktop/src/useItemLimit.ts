import { useLayoutEffect, type RefObject } from "react";

/** Measure actual rows: five wrapped items still mean five items, not five fixed heights. */
export function useItemLimit(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      const items = Array.from(root.children) as HTMLElement[];
      if (items.length <= 5) {
        root.style.removeProperty("--item-limit-height");
        return;
      }
      const style = getComputedStyle(root);
      // The shortest five-item span also caps later, shorter rows while scrolling.
      const rects = items.map((item) => item.getBoundingClientRect());
      let span = Infinity,
        trailing = parseFloat(style.paddingBottom);
      for (let i = 0; i <= items.length - 5; i++) {
        span = Math.min(span, rects[i + 4].bottom - rects[i].top);
        if (rects[i + 5])
          trailing = Math.min(
            trailing,
            Math.max(0, rects[i + 5].top - rects[i + 4].bottom),
          );
      }
      // Bottom padding must not reveal the next item underneath it.
      root.style.setProperty(
        "--item-limit-height",
        `${span + parseFloat(style.paddingTop) + trailing + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`,
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(schedule);
    const observe = () => {
      resize.disconnect();
      resize.observe(root);
      Array.from(root.children).forEach((item) => resize.observe(item));
      measure();
    };
    const mutation = new MutationObserver(observe);
    mutation.observe(root, { childList: true });
    observe();
    return () => {
      cancelAnimationFrame(frame);
      mutation.disconnect();
      resize.disconnect();
    };
  }, [ref]);
}
