import { useRef, type ComponentProps } from "react";
import { useItemLimit } from "./useItemLimit.ts";

export function ItemList({ className = "", ...props }: ComponentProps<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  useItemLimit(ref);
  return <div {...props} ref={ref} className={`item-list ${className}`} />;
}
