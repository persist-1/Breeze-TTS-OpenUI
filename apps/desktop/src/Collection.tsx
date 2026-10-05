import { Button, Icon } from "./ui.tsx";
import { Select } from "./Select.tsx";
import {
  collectionSizes,
  pageNumbers,
  type CollectionSize,
} from "./collectionPaging.ts";
import type { CollectionState } from "./useCollection.ts";

export function CollectionControls({
  collection: c,
  noun,
  total,
  filtered = false,
}: {
  collection: CollectionState;
  noun: string;
  total: number;
  filtered?: boolean;
}) {
  return (
    <div className="collection-controls">
      <span className="collection-count badge neutral" role="status">
        <Icon name="list" />
        {filtered ? (
          <>
            匹配 <strong>{c.total}</strong> / 共 {total} {noun}
          </>
        ) : (
          <>
            共 <strong>{c.total}</strong> {noun}
          </>
        )}
      </span>
      <span className="sr-only" role="status">
        {c.total
          ? `第${c.page}页，共${c.pages}页，显示第${c.start + 1}至${c.end}项`
          : "没有可显示的内容"}
      </span>
      <div className="collection-browse">
        <div
          className="collection-view segmented"
          role="group"
          aria-label="展示方式"
        >
          <button
            aria-pressed={c.view === "list"}
            onClick={() => c.setView("list")}
          >
            <Icon name="list" />
            列表
          </button>
          <button
            aria-pressed={c.view === "grid"}
            onClick={() => c.setView("grid")}
          >
            <Icon name="grid" />
            网格
          </button>
        </div>
        <label className="collection-size">
          <span>每页</span>
          <Select
            label="每页显示数量"
            value={String(c.size)}
            options={collectionSizes.map((size) => ({
              value: String(size),
              label: `${size} 项`,
            }))}
            onChange={(value) => c.setSize(Number(value) as CollectionSize)}
          />
        </label>
        <Pagination collection={c} />
      </div>
    </div>
  );
}

export function Pagination({
  collection: c,
  footer = false,
}: {
  collection: CollectionState;
  footer?: boolean;
}) {
  if (c.pages <= 1) return null;
  return (
    <nav
      className={`collection-pagination ${footer ? "collection-footer" : ""}`}
      aria-label={footer ? "底部分页" : "分页"}
    >
      <div className="page-buttons">
        <Button
          icon="previous"
          aria-label="上一页"
          title="上一页"
          disabled={c.page <= 1}
          onClick={() => c.setPage(c.page - 1)}
        />
        {pageNumbers(c.page, c.pages).map((page, i) =>
          page === "gap" ? (
            <span className="page-gap" aria-hidden="true" key={`gap-${i}`}>
              …
            </span>
          ) : (
            <Button
              key={page}
              aria-label={`第${page}页`}
              aria-current={page === c.page ? "page" : undefined}
              onClick={() => c.setPage(page)}
            >
              {page}
            </Button>
          ),
        )}
        <Button
          icon="next"
          aria-label="下一页"
          title="下一页"
          disabled={c.page >= c.pages}
          onClick={() => c.setPage(c.page + 1)}
        />
      </div>
    </nav>
  );
}
