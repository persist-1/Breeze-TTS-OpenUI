import { useRef, useEffect, useState, type ReactNode } from "react";
import { ItemList } from "./ItemList.tsx";
import type { Direction } from "../../../packages/contracts/src/index.ts";
const icons: Record<string, ReactNode> = {
  list: <path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  previous: <path d="m15 5-7 7 7 7" />,
  next: <path d="m9 5 7 7-7 7" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  projects: (
    <>
      <rect x="3" y="6" width="18" height="15" rx="2" />
      <path d="M7 6V3h10v3M3 12h18M10 12v3h4v-3" />
    </>
  ),
  edit: <path d="m15 4 5 5M4 20l4-1L21 6l-4-4L4 15Z" />,
  play: <path d="m8 5 12 7-12 7Z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  pause: <path d="M8 5v14M16 5v14" />,
  power: (
    <>
      <path d="M12 3v8M7 5a8 8 0 1 0 10 0" />
    </>
  ),
  loader: <path d="M20 12a8 8 0 1 1-8-8" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  grip: (
    <>
      <path
        d="M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01"
        strokeWidth="3"
      />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="15" cy="17" r="3" />
    </>
  ),
  studio: (
    <>
      <path d="M4 8v8m4-12v16m4-14v12m4-9v6m4-7v8" />
    </>
  ),
  voices: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a6 6 0 0 1 12 0v2m2-14a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 5" />
    </>
  ),
  directions: (
    <>
      <path d="M5 4h14v16H5zM8 8h8m-8 4h8m-8 4h5" />
    </>
  ),
  tasks: (
    <>
      <path d="M8 5h13M8 12h13M8 19h13" />
      <circle cx="3" cy="5" r=".6" />
      <circle cx="3" cy="12" r=".6" />
      <circle cx="3" cy="19" r=".6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.5" />
    </>
  ),
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  refresh: <path d="M20 7v5h-5m4-5a8 8 0 1 0 1 10" />,
  alert: (
    <>
      <path d="m12 3 10 18H2Z M12 9v5m0 3v1" />
    </>
  ),
  folder: <path d="M3 5h7l2 3h9v13H3Z" />,
  brackets: <path d="M8 4H4v16h4m8-16h4v16h-4" />,
  up: <path d="m5 15 7-7 7 7" />,
  down: <path d="m5 9 7 7 7-7" />,
};
export function Icon({ name }: { name: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name] || icons.info}
    </svg>
  );
}
export function Button({
  children,
  icon,
  tone = "",
  ...props
}: {
  children?: ReactNode;
  icon?: string;
  tone?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`button ${tone}`} {...props}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}
export function Help({ children }: { children: ReactNode }) {
  return (
    <details className="help">
      <summary aria-label="查看说明">
        <Icon name="info" />
      </summary>
      <div className="help-content">{children}</div>
    </details>
  );
}
export function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      className={`switch ${value ? "on" : ""}`}
      role="switch"
      aria-label="启用演绎指导"
      aria-checked={value}
      onClick={() => onChange(!value)}
    >
      <span />
      {value ? "已启用" : "关闭"}
    </button>
  );
}
export function Tabs({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (value: string) => void;
  items: [string, string][];
}) {
  return (
    <div className="segmented">
      {items.map(([id, label]) => (
        <button
          key={id}
          aria-pressed={id === value}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <Button icon="close" aria-label="关闭" onClick={onClose} />
      </div>
      {children}
    </dialog>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon name="studio" />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function DirectionSelect({
  items,
  selected,
  onSelect,
}: {
  items: Direction[];
  selected: string;
  onSelect: (d: Direction) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = items.filter((d) =>
    (d.name + " " + d.instruction).toLowerCase().includes(query.toLowerCase()),
  );
  return items.length ? (
    <div className="picker-body">
      <input
        aria-label="搜索演绎指导"
        placeholder="搜索指导名称或内容"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ItemList className="choices" aria-label="演绎指导选项">
        {filtered.map((d) => (
          <button
            className={`choice ${selected === d.id ? "selected" : ""}`}
            key={d.id}
            aria-pressed={selected === d.id}
            onClick={() => onSelect(d)}
          >
            <strong>{d.name}</strong>
            <span>{d.instruction}</span>
            {selected === d.id ? <Icon name="check" /> : null}
          </button>
        ))}
      </ItemList>
      {!filtered.length ? (
        <Empty title="没有匹配的指导">
          <Button onClick={() => setQuery("")}>清除搜索</Button>
        </Empty>
      ) : null}
    </div>
  ) : (
    <Empty title="还没有演绎指导">
      <a href="#directions">创建演绎指导</a>
    </Empty>
  );
}
export function confirmDelete(
  kind: string,
  name: string,
  extra: string,
  remove: () => Promise<void>,
  show: (node: ReactNode) => void,
) {
  const close = () => show(null);
  show(
    <DeleteConfirmation
      name={name}
      extra={extra}
      remove={remove}
      close={close}
    />,
  );
}
function DeleteConfirmation({
  name,
  extra,
  remove,
  close,
}: {
  name: string;
  extra: string;
  remove: () => Promise<void>;
  close: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title={`删除${name}`}
      onClose={() => {
        if (!busy) close();
      }}
    >
      <p>{extra}</p>
      <p className="danger-copy">永久删除，无法恢复。</p>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="actions end">
        <Button disabled={busy} onClick={close}>
          取消
        </Button>
        <Button
          tone="danger"
          icon="trash"
          disabled={busy}
          onClick={() => {
            if (busy) return;
            setBusy(true);
            void remove()
              .then(close)
              .catch((e) => {
                setBusy(false);
                setError(String(e).replace(/^Error: /, ""));
              });
          }}
        >
          {busy ? "正在删除…" : "永久删除"}
        </Button>
      </div>
    </Modal>
  );
}
