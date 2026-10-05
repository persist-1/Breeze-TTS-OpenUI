import fs from "node:fs";
export function wavHeader(sampleRate: number, bytes: number): Buffer {
  const b = Buffer.alloc(44);
  b.write("RIFF");
  b.writeUInt32LE(36 + bytes, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(bytes, 40);
  return b;
}
export function inspectWav(buffer: Buffer) {
  if (
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  )
    throw Error("请选择有效 WAV 文件。");
  let rate = 0,
    channels = 0,
    bits = 0,
    format = 0,
    bytes = 0,
    offset = 12;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32LE(offset + 4);
    if (offset + 8 + size > buffer.length) throw Error("WAV 文件不完整。");
    const type = buffer.toString("ascii", offset, offset + 4);
    if (type === "fmt " && size >= 16) {
      format = buffer.readUInt16LE(offset + 8);
      channels = buffer.readUInt16LE(offset + 10);
      rate = buffer.readUInt32LE(offset + 12);
      bits = buffer.readUInt16LE(offset + 22);
    }
    if (type === "data") bytes += size;
    offset += 8 + size + (size % 2);
  }
  if (![1, 3].includes(format) || !channels || !rate || !bits || !bytes)
    throw Error("不支持的 WAV 编码，请使用 PCM 或浮点 WAV。");
  const duration = bytes / ((rate * channels * bits) / 8);
  if (duration < 1 || duration > 120)
    throw Error("参考录音应为 1 至 120 秒；这是应用导入限制。");
  return { duration, rate, channels, bits };
}
