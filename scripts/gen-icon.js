// 生成应用图标（无依赖）：圆角蓝底 + 白色 T 字
// assets/tray.png (16x16) + assets/icon.png (256x256)
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, pixelFn) {
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      const o = rowStart + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function drawIcon(size) {
  const R = size * 0.22;
  const BLUE = [37, 99, 235];
  const WHITE = [255, 255, 255];
  return (x, y) => {
    // 圆角矩形判定
    const cx = Math.min(Math.max(x, R), size - 1 - R);
    const cy = Math.min(Math.max(y, R), size - 1 - R);
    const inside = (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
    if (!inside) return [0, 0, 0, 0];
    // 白色 T 字
    const u = (v) => v * size;
    const inT =
      (y >= u(0.30) && y <= u(0.42) && x >= u(0.26) && x <= u(0.74)) ||
      (x >= u(0.44) && x <= u(0.56) && y >= u(0.30) && y <= u(0.72));
    return inT ? [...WHITE, 255] : [...BLUE, 255];
  };
}

function main() {
  const outDir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(outDir, { recursive: true });
  const tray = encodePNG(16, drawIcon(16));
  const icon = encodePNG(256, drawIcon(256));
  fs.writeFileSync(path.join(outDir, 'tray.png'), tray);
  fs.writeFileSync(path.join(outDir, 'icon.png'), icon);
  console.log('icons written:', path.join(outDir, 'tray.png'), path.join(outDir, 'icon.png'));
}

main();
