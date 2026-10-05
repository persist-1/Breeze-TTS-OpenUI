import type { FixedInput } from "../../../packages/contracts/src/index.ts";
import { Icon, Help } from "./ui.tsx";

/** Display the immutable input, never infer historical fields from today's draft. */
export function InputSnapshot({
  input,
  seed,
}: {
  input: FixedInput;
  seed: number;
}) {
  const saved = input.presentation;
  const legacy = !saved && !!input.instruction;
  return (
    <>
      <div className="snapshot-fields">
        <section
          className="snapshot-field snapshot-manuscript"
          aria-label="待合成文稿"
        >
          <h5>
            <Icon name="edit" />
            待合成文稿
          </h5>
          <p className="snapshot-copy">{input.text || "文稿为空"}</p>
        </section>
        <section className="snapshot-field" aria-label="使用音色">
          <div className="snapshot-field-head">
            <h5>
              <Icon name="voices" />
              使用音色
            </h5>
            <span className="badge neutral">
              {input.reference
                ? "参考录音"
                : saved?.voiceDescription
                  ? saved.voiceSource === "library"
                    ? "音色库"
                    : "音色描述"
                  : legacy
                    ? "未单独保存"
                    : "默认声音"}
            </span>
          </div>
          {input.reference ? (
            <>
              <p className="snapshot-copy">{input.reference.name}</p>
              <details className="reference-snapshot">
                <summary>
                  <Icon name="brackets" />
                  参考录音逐字稿
                  <Icon name="chevron" />
                </summary>
                <p className="snapshot-copy">{input.reference.transcript}</p>
              </details>
            </>
          ) : saved?.voiceDescription ? (
            <p className="snapshot-copy">
              {saved.voiceSource === "library" ? (
                <strong className="snapshot-material-name">
                  {input.voiceName}
                </strong>
              ) : null}
              {saved.voiceDescription}
            </p>
          ) : (
            <p className="snapshot-copy snapshot-empty">
              {legacy ? (
                <>
                  <strong className="snapshot-material-name">
                    {input.voiceName || "音色名称未保存"}
                  </strong>
                  音色描述未单独保存。
                </>
              ) : (
                "未指定音色，使用模型默认声音。"
              )}
            </p>
          )}
        </section>
        <section className="snapshot-field" aria-label="演绎指导">
          <div className="snapshot-field-head">
            <h5>
              <Icon name="directions" />
              演绎指导
            </h5>
            <span className="badge neutral">
              {saved
                ? !saved.directionEnabled
                  ? "未启用"
                  : saved.directionSource === "preset"
                    ? "预设演绎"
                    : "演绎描述"
                : legacy
                  ? "未单独保存"
                  : "未指定"}
            </span>
          </div>
          <p
            className={`snapshot-copy${saved?.direction ? "" : " snapshot-empty"}`}
          >
            {saved?.direction ||
              (legacy
                ? "演绎指导未单独保存，无法准确还原。"
                : saved?.directionEnabled
                  ? "已启用，未填写指导。"
                  : "未指定额外演绎指导。")}
          </p>
        </section>
      </div>
      <details
        className="instruction-snapshot"
        key={input.signature + ":" + seed}
      >
        <summary>
          <Icon name="brackets" />
          查看完整指令
          <Icon name="chevron" />
        </summary>
        <div className="instruction-context">
          <span>
            {legacy ? "历史记录 · 当时提交的合并原文" : "实际提交给模型的指令"}
          </span>
          <Help>
            {legacy
              ? "这份记录没有分别保存音色描述与演绎指导，无法准确拆分。以下原文完整保留，不按换行推测归属。"
              : "音色描述和已启用的演绎指导按顺序组合。使用参考录音时，声音身份由录音提供；文稿与参考录音均独立传入。"}
          </Help>
        </div>
        <p className="snapshot-copy">
          {input.instruction || "未提交文字指令。"}
        </p>
      </details>
      <dl className="snapshot-params" aria-label="生成参数">
        <div>
          <dt>语言</dt>
          <dd>{input.language === "zh" ? "中文" : "English"}</dd>
        </div>
        <div>
          <dt>随机种子</dt>
          <dd>{seed}</dd>
        </div>
        <div>
          <dt>引导强度</dt>
          <dd>{input.cfg}</dd>
        </div>
      </dl>
    </>
  );
}
