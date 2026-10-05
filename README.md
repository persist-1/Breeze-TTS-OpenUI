<img src="assets/brand/logo.svg" width="80" height="80" alt="OpenUI 图标" />

# OpenUI · breeze-tts-openui

基于 [Breeze-TTS-2](https://www.modelscope.cn/models/BreezeBlue/Breeze-TTS-2) 模型的独立社区扩展应用，为创作者提供 **文本转语音、音色克隆、音色描述与演绎指导**，探索模型在 **角色扮演与同伴、语音代理、游戏、有声书与有声剧、直播、播客** 等场景中的应用。

## 使用
**仅支持 Windows 10/11；**
在项目 **Releases** 页面下载免安装 ZIP，解压后使用。

## 开发

需要 Windows 与 Node.js 24+。克隆仓库后安装依赖，启动开发客户端：

```powershell
git clone "<仓库地址>" breeze-tts-openui
cd breeze-tts-openui
$env:electron_config_cache = "$PWD\.runtime\cache\electron"
npm install --cache .runtime/cache/npm
npm run dev
```

运行环境与模型通过应用设置安装。双击 `一键打包.cmd` 制作免安装 ZIP；代码结构见 [架构说明](docs/ARCHITECTURE.md)。

## 许可

应用代码与原创图标采用 [Apache-2.0](LICENSE)。模型及自托管生成结果遵守官方 [研究与非商业协议](MODEL_LICENSE)，商业使用需另获书面授权；本项目不代表模型官方。
