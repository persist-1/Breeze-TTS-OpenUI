import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Icon } from "./ui.tsx";
import { ItemList } from "./ItemList.tsx";
const graphemes = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });
const shortLabel = (label: string) => {
  const characters = Array.from(
    graphemes.segment(label),
    (part) => part.segment,
  );
  return characters.length > 5
    ? characters.slice(0, 5).join("") + "..."
    : label;
};
export function Select({
  value,
  options,
  onChange,
  label,
  id,
  disabled = false,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  const uid = useId(),
    listId = uid + "-list",
    root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0),
    [up, setUp] = useState(false);
  const selected = options.findIndex((o) => o.value === value);
  const selectedLabel = options[selected]?.label || "请选择";
  const [bounds, setBounds] = useState({ width: 340, height: 260 });
  const show = () => {
    const r = trigger.current!.getBoundingClientRect(),
      above = innerHeight - r.bottom < 260 && r.top > innerHeight - r.bottom;
    setUp(above);
    setBounds({
      width: Math.min(340, innerWidth - r.left - 12),
      height: Math.min(260, (above ? r.top : innerHeight - r.bottom) - 12),
    });
    setActive(Math.max(0, selected));
    setOpen(true);
  };
  const choose = (index: number) => {
    if (options[index]) onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const item = document.getElementById(listId + "-" + active),
      list = document.getElementById(listId);
    if (!item || !list) return;
    const a = list.getBoundingClientRect(),
      b = item.getBoundingClientRect();
    if (b.top < a.top + 5) list.scrollTop -= a.top + 5 - b.top;
    else if (b.bottom > a.bottom - 5) list.scrollTop += b.bottom - a.bottom + 5;
  }, [open, active, listId]);
  return (
    <div className="select-control" ref={root}>
      <button
        ref={trigger}
        id={id}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-label={label}
        aria-description={selectedLabel}
        title={selectedLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? listId + "-" + active : undefined}
        disabled={disabled || !options.length}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (
            [
              "ArrowDown",
              "ArrowUp",
              "Home",
              "End",
              "Enter",
              " ",
              "Escape",
            ].includes(e.key)
          ) {
            e.preventDefault();
            if (e.key === "Escape") {
              setOpen(false);
              e.stopPropagation();
              return;
            }
            if (!open) {
              show();
              return;
            }
            if (e.key === "Enter" || e.key === " ") {
              choose(active);
              return;
            }
            setActive((n) =>
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? options.length - 1
                  : Math.max(
                      0,
                      Math.min(
                        options.length - 1,
                        n + (e.key === "ArrowDown" ? 1 : -1),
                      ),
                    ),
            );
          } else if (e.key === "Tab") setOpen(false);
        }}
      >
        <span>{shortLabel(selectedLabel)}</span>
        <Icon name="chevron" />
      </button>
      {open ? (
        <ItemList
          id={listId}
          role="listbox"
          aria-label={label}
          className={`select-menu ${up ? "opens-up" : ""}`}
          style={
            {
              maxWidth: bounds.width,
              "--viewport-limit-height": `${bounds.height}px`,
            } as CSSProperties
          }
        >
          {options.map((o, i) => (
            <button
              type="button"
              role="option"
              aria-label={o.label}
              title={o.label}
              tabIndex={-1}
              id={listId + "-" + i}
              key={o.value}
              aria-selected={value === o.value}
              className={active === i ? "active" : ""}
              onPointerMove={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span>{shortLabel(o.label)}</span>
              {value === o.value ? <Icon name="check" /> : null}
            </button>
          ))}
        </ItemList>
      ) : null}
    </div>
  );
}
