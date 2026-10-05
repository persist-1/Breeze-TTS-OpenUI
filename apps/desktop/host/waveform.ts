import fs from "node:fs";
import type { Waveform } from "../../../packages/contracts/src/index.ts";
export function readWaveform(file: string, bins = 128): Waveform {
  if (!Number.isInteger(bins) || bins < 16 || bins > 1024)
    throw Error("波形精度无效。");
  const fd = fs.openSync(file, "r"),
    length = fs.fstatSync(fd).size;
  const read = (offset: number, size: number) => {
    const b = Buffer.alloc(size);
    if (fs.readSync(fd, b, 0, size, offset) !== size)
      throw Error("音频文件不完整。");
    return b;
  };
  try {
    const header = read(0, 12);
    if (
      header.toString("ascii", 0, 4) !== "RIFF" ||
      header.toString("ascii", 8, 12) !== "WAVE"
    )
      throw Error("不支持的音频文件。");
    let rate = 0,
      channels = 0,
      bits = 0,
      format = 0;
    const chunks: { offset: number; size: number }[] = [];
    for (let offset = 12; offset + 8 <= length;) {
      const h = read(offset, 8),
        type = h.toString("ascii", 0, 4),
        size = h.readUInt32LE(4);
      if (offset + 8 + size > length) throw Error("音频文件不完整。");
      if (type === "fmt ") {
        if (size < 16) throw Error("音频格式信息不完整。");
        const f = read(offset + 8, 16);
        format = f.readUInt16LE(0);
        channels = f.readUInt16LE(2);
        rate = f.readUInt32LE(4);
        bits = f.readUInt16LE(14);
      } else if (type === "data") chunks.push({ offset: offset + 8, size });
      offset += 8 + size + (size % 2);
    }
    if (
      !channels ||
      channels > 32 ||
      !rate ||
      !chunks.length ||
      !(
        (format === 1 && [8, 16, 24, 32].includes(bits)) ||
        (format === 3 && [32, 64].includes(bits))
      )
    )
      throw Error("该音频编码暂不支持波形显示。");
    const sampleBytes = bits / 8,
      frameBytes = sampleBytes * channels,
      total = chunks.reduce((n, c) => n + c.size, 0);
    if (!total || chunks.some((c) => c.size % frameBytes))
      throw Error("音频采样数据不完整。");
    const frames = total / frameBytes,
      peaks = new Array<number>(bins).fill(0);
    let frame = 0,
      peak = 0;
    const sample = (b: Buffer, pos: number) =>
      format === 3
        ? bits === 32
          ? b.readFloatLE(pos)
          : b.readDoubleLE(pos)
        : bits === 8
          ? (b[pos] - 128) / 128
          : bits === 16
            ? b.readInt16LE(pos) / 32768
            : bits === 24
              ? b.readIntLE(pos, 3) / 8388608
              : b.readInt32LE(pos) / 2147483648;
    const chunkBytes = Math.floor(65536 / frameBytes) * frameBytes;
    for (const c of chunks)
      for (let done = 0; done < c.size;) {
        const b = read(c.offset + done, Math.min(chunkBytes, c.size - done));
        for (let pos = 0; pos < b.length; pos += frameBytes) {
          let amplitude = 0;
          for (let channel = 0; channel < channels; channel++) {
            const v = Math.abs(sample(b, pos + channel * sampleBytes));
            if (Number.isFinite(v))
              amplitude = Math.max(amplitude, Math.min(1, v));
          }
          const bin = Math.min(bins - 1, Math.floor((frame++ / frames) * bins));
          peaks[bin] = Math.max(peaks[bin], amplitude);
          peak = Math.max(peak, amplitude);
        }
        done += b.length;
      }
    return {
      duration: frames / rate,
      peaks: peaks.map((p) => Math.round(p * 1000000) / 1000000),
      peak,
    };
  } finally {
    fs.closeSync(fd);
  }
}
