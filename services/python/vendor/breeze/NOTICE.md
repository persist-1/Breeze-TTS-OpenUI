# 推理代码来源

来自 BreezeBlue 的 Breeze TTS 2 PyTorch 推理代码及旧项目保留的 Windows/CUDA 兼容修改。上游：https://github.com/breezeblue-ai/breeze-tts 。Apache-2.0 许可证见同目录 LICENSE。

这里只保留模型、模板、编解码与推理运行器代码。旧应用的界面、桌面层、环境、模型文件与用户数据未复用。服务只加载应用目录内下载的模型与 Python 环境。移除了上游生成器写入 /tmp 的警告日志，改为 stderr，由应用内部日志接收。
