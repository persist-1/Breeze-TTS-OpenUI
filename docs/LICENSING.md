# 许可与标识来源

核对日期：2026-10-05。下列说明帮助区分适用范围，不修改或取代官方协议原文。

## 代码与模型分别适用

| 内容 | 协议 | 项目内文件 |
| --- | --- | --- |
| 本项目界面、桌面宿主、自编服务代码与原创图标 | Apache-2.0 | `LICENSE`、`NOTICE` |
| 上游 Breeze 推理代码 | Apache-2.0 | `services/python/vendor/breeze/LICENSE`、`NOTICE.md` |
| Breeze-TTS-2 权重、模型材料、衍生模型与自托管生成结果 | BREEZEBLUE RESEARCH AND NON-COMMERCIAL LICENSE AGREEMENT v1.1，2026-09-01 | `MODEL_LICENSE` |
| Electron 等第三方组件 | 各自协议 | `THIRD_PARTY_NOTICES.md`、发行目录许可证 |

官方 [代码仓库](https://github.com/breezeblue-ai/breeze-tts) 与 [代码 LICENSE](https://github.com/breezeblue-ai/breeze-tts/blob/main/LICENSE) 指明代码采用 Apache-2.0。模型自定义协议第 1.2 条明确排除已按 Apache-2.0 授权的代码；因此应用代码继承 Apache-2.0，模型协议单独保留，不能混为一个协议。

[模型协议原文](https://huggingface.co/BreezeBlue/Breeze-TTS-2/blob/3e28c5151381a722f1d8661b4118c298caa77aa4/LICENSE) 明确声明其不是开源协议，仅授予研究与非商业使用。个人、教育、爱好用途仍需遵守全部条款。商业内容、客户交付、营利、生产业务等需另获书面商业授权；自托管生成音频也受约束。协议没有“小规模创作者免费商用”或收入门槛例外。购买托管平台订阅不自动授予自托管模型及输出的商用权。本文仅概括范围，完整限制见 `MODEL_LICENSE`。

本项目的 ZIP 不附带模型权重。用户在设置下载模型并使用时，仍须遵守官方模型协议；单独分发界面代码不会把模型改为 Apache-2.0。

## 官方标识与社区标识

[官方网站条款第 9 条](https://breezeblue.ai/legal/terms) 要求使用官方名称、logo、品牌标识获得事先书面同意；模型协议第 7.4 条与 Apache-2.0 第 6 条均未授予商标使用权。未发现允许把官方 logo 改为社区项目标识的明确许可。

模型协议第 4 条还限制把 BreezeBlue、Breeze TTS 2 或易混淆名称作为衍生产品的主要名称；允许准确的描述性署名。本项目主界面与图标使用 **OpenUI**，说明中准确标注使用 Breeze-TTS-2，明确为独立社区客户端；保留已有源码目录、模型标识及启动文件名兼容。若将来公开发行，名称与宣传也应保持社区身份清晰，不宣称官方背书。

用户选择独立创作并轻微借鉴图形概念。项目图标采用通用竖向声波节奏、原创对称弧形轮廓与松绿色；没有直接描摹官方条纹加字母 b 图形或使用其字标。来源参考不构成官方授权，也不保证不存在任何商标争议。

## 获取与核对方式

- `npm run licenses:sync`：从 [Apache 官方模板](https://www.apache.org/licenses/LICENSE-2.0.txt) 获取 `LICENSE` 原文；从固定模型版本获取自定义协议原文并写入 `MODEL_LICENSE`，不重新创作法律条款。
- 固定模型版本：`3e28c5151381a722f1d8661b4118c298caa77aa4`。同步脚本同时核对 [ModelScope 原文](https://www.modelscope.cn/models/BreezeBlue/Breeze-TTS-2/resolve/master/LICENSE)；与固定版本不一致时停止，不静默替换协议。
- `licenses/provenance.json` 保存来源、时间、版本、字节数与 SHA-256；`NOTICE` 保留模型协议第 4 条要求的原文声明，vendored 源码的已有署名继续保留。
- 一键打包携带 `LICENSE`、`MODEL_LICENSE`、`NOTICE`、第三方通知和来源清单；不携带官方 logo 参考图。

## 图标使用

`assets/brand/logo.svg` 为可编辑主文件；`logo.png` 为透明背景 1024×1024 PNG；`icon-16.png` 至 `icon-256.png` 为小尺寸 PNG；`app.ico` 含 16、24、32、48、64、128、256 七档图标。

`npm run brand:build` 在项目内部通过 Electron 渲染 SVG、检查视口、平涂颜色与透明背景，并同步应用公共素材。概念探索使用 AI 图像生成；交付文件为独立编写的矢量图及其栅格导出，不把参考图或带纹理的概念稿作为成品。

应用顶部、页面图标和 Electron 窗口引用该素材。一键打包会将其写入当次生成的 EXE 图标资源，保留阶段进度，不修改开发依赖中的 Electron 程序或已有发行包。
