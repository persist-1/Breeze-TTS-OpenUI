// Rasterize the editable project SVG; no creative edits to generated raster images.
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { crc32 } from "node:zlib";
const origin =
  "Origin: independent OpenUI vector artwork, assets/brand/logo.svg; rendered locally by Electron via scripts/render-brand.ts. Flat pine-green #315f49 plate, white curved brackets and three voice bars; transparent outer background. AI-assisted concept exploration; no official logo pixels or generated concept raster used.";
function withOrigin(png: Buffer) {
  const data = Buffer.from("impeccable:prompt\0" + origin, "utf8");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write("tEXt", 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}
const root = process.cwd();
const temp = path.join(root, ".runtime/icon-build");
for (const name of [
  "userData",
  "sessionData",
  "temp",
  "appData",
  "crashDumps",
] as const) {
  const dir = path.join(temp, name);
  fs.mkdirSync(dir, { recursive: true });
  app.setPath(name, dir);
}
app.setAppLogsPath(path.join(temp, "logs"));
app.commandLine.appendSwitch("disk-cache-dir", path.join(temp, "cache"));
app.commandLine.appendSwitch("disable-crash-reporter");
async function render() {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    width: 1024,
    height: 1024,
    useContentSize: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const brand = path.join(root, "assets/brand");
  const svg = fs.readFileSync(path.join(brand, "logo.svg"), "utf8");
  await window.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        `<style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:100vw;height:100vh}</style>${svg}`,
      ),
  );
  await new Promise((r) => setTimeout(r, 400));
  const viewport = await window.webContents.executeJavaScript(
    "({width:innerWidth,height:innerHeight,scale:devicePixelRatio})",
  );
  if (viewport.width !== 1024 || viewport.height !== 1024)
    throw Error(
      "SVG 视口尺寸不符：" +
        JSON.stringify({ viewport, content: window.getContentSize() }),
    );
  const master = await window.webContents.capturePage(
    { x: 0, y: 0, width: 1024, height: 1024 },
    { stayHidden: true, stayAwake: true },
  );
  const pixels = master.toBitmap();
  const pixel = (x: number, y: number) =>
    Array.from(pixels.subarray((y * 1024 + x) * 4, (y * 1024 + x) * 4 + 4));
  if (
    pixel(0, 0)[3] !== 0 ||
    pixel(512, 512).join() !== "255,255,255,255" ||
    pixel(512, 100).join() !== "73,95,49,255"
  )
    throw Error("SVG 颜色或透明背景不符。");
  const frames: { size: number; png: Buffer }[] = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256, 1024]) {
    const image = master.resize({ width: size, height: size, quality: "best" });
    if (image.getSize().width !== size || image.getSize().height !== size)
      throw Error("图标尺寸不符。");
    const png = withOrigin(image.toPNG());
    fs.writeFileSync(
      path.join(brand, size === 1024 ? "logo.png" : `icon-${size}.png`),
      png,
    );
    if (size !== 1024) frames.push({ size, png });
  }
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, png }, i) => {
    const p = 6 + i * 16;
    header[p] = header[p + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, p + 4);
    header.writeUInt16LE(32, p + 6);
    header.writeUInt32LE(png.length, p + 8);
    header.writeUInt32LE(offset, p + 12);
    offset += png.length;
  });
  fs.writeFileSync(
    path.join(brand, "app.ico"),
    Buffer.concat([header, ...frames.map((f) => f.png)]),
  );
  const publicDir = path.join(root, "apps/desktop/public/brand");
  fs.mkdirSync(publicDir, { recursive: true });
  for (const name of ["logo.svg", "icon-32.png", "icon-256.png"])
    fs.copyFileSync(path.join(brand, name), path.join(publicDir, name));
  console.log(
    "已导出 SVG、1024px PNG、16–256px PNG、七尺寸 ICO 与应用公共素材。",
  );
  window.destroy();
  app.quit();
}
render().catch((error) => {
  console.error(error);
  app.exit(1);
});
