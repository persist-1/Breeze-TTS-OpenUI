import { useState } from "react";
import type { Voice } from "../../../packages/contracts/src/index.ts";
import { Button, Empty, Icon } from "./ui.tsx";
import { ItemList } from "./ItemList.tsx";
export function SelectedMaterial({
  name,
  detail,
  icon = "voices",
  action = "更换",
  missing = false,
  onClick,
}: {
  name: string;
  detail: string;
  icon?: string;
  action?: string;
  missing?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`selected-material ${missing ? "missing" : ""}`}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span className="choice-copy">
        <strong>{name}</strong>
        <small>{detail}</small>
      </span>
      <span className="choice-action">{action}</span>
    </button>
  );
}
export function VoicePicker({
  voices,
  selected,
  onSelect,
  close,
}: {
  voices: Voice[];
  selected: string;
  onSelect: (voice: Voice | null) => void;
  close: () => void;
}) {
  const [search, setSearch] = useState("");
  const shown = voices.filter((v) =>
    (v.name + " " + v.description + " " + (v.transcript || ""))
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="picker-body">
      <input
        aria-label="搜索音色"
        placeholder="搜索音色名称或内容"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ItemList className="choices" aria-label="音色选项">
        {!search ? (
          <button
            className={`choice ${!selected ? "selected" : ""}`}
            aria-pressed={!selected}
            onClick={() => onSelect(null)}
          >
            <strong>默认声音</strong>
            <span>由模型选择声音</span>
            {!selected ? <Icon name="check" /> : null}
          </button>
        ) : null}
        {shown.map((v) => {
          const usable =
            v.kind === "design" ||
            !!(v.assetId && v.consent && v.transcript?.trim());
          return (
            <button
              className={`choice ${selected === v.id ? "selected" : ""}`}
              key={v.id}
              aria-pressed={selected === v.id}
              disabled={!usable}
              onClick={() => onSelect(v)}
            >
              <strong>{v.name}</strong>
              <span>
                {v.kind === "reference"
                  ? usable
                    ? "参考录音 · 已核对"
                    : "参考录音 · 请到音色库核对"
                  : v.description}
              </span>
              {selected === v.id ? <Icon name="check" /> : null}
            </button>
          );
        })}
      </ItemList>
      {search && !shown.length ? (
        <Empty title="没有匹配的音色">
          <Button onClick={() => setSearch("")}>清除搜索</Button>
        </Empty>
      ) : null}
      <a className="button" href="#voices" onClick={close}>
        管理音色库
      </a>
    </div>
  );
}
