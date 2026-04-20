const fs = require('fs');
const zlib = require('zlib');

function createPNG(size, bgR, bgG, bgB, fgR, fgG, fgB) {
  const width = size;
  const height = size;

  // Raw pixel data (RGBA) with filter byte per row
  const rawData = Buffer.alloc((width * 4 + 1) * height);

  const cx = width / 2;
  const cy = height / 2;
  const outerR = width * 0.38;
  const innerR = width * 0.12;
  const pinTop = cy - width * 0.15;
  const pinBot = cy + width * 0.25;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1);
    rawData[rowOffset] = 0; // filter: none

    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy + width * 0.05;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Background with rounded corners
      const cornerR = width * 0.15;
      const inRect = x >= cornerR && x < width - cornerR ||
                     y >= cornerR && y < height - cornerR;
      const inCornerTL = Math.sqrt((x - cornerR) ** 2 + (y - cornerR) ** 2) <= cornerR;
      const inCornerTR = Math.sqrt((x - (width - cornerR)) ** 2 + (y - cornerR) ** 2) <= cornerR;
      const inCornerBL = Math.sqrt((x - cornerR) ** 2 + (y - (height - cornerR)) ** 2) <= cornerR;
      const inCornerBR = Math.sqrt((x - (width - cornerR)) ** 2 + (y - (height - cornerR)) ** 2) <= cornerR;
      const inBg = inRect || inCornerTL || inCornerTR || inCornerBL || inCornerBR;

      if (!inBg) {
        rawData[px] = 0; rawData[px + 1] = 0; rawData[px + 2] = 0; rawData[px + 3] = 0;
        continue;
      }

      // Pin marker shape
      const pinDy = y - (cy - width * 0.1);
      const pinDist = Math.sqrt(dx * dx + pinDy * pinDy);
      const isCircle = pinDist <= outerR;
      const isInnerCircle = pinDist <= innerR;
      const isPin = y > cy + width * 0.1 && y < cy + width * 0.35 &&
                    Math.abs(dx) < (cy + width * 0.35 - y) * 0.35;

      if ((isCircle && !isInnerCircle) || isPin) {
        rawData[px] = fgR; rawData[px + 1] = fgG; rawData[px + 2] = fgB; rawData[px + 3] = 255;
      } else if (isInnerCircle) {
        rawData[px] = bgR; rawData[px + 1] = bgG; rawData[px + 2] = bgB; rawData[px + 3] = 255;
      } else {
        rawData[px] = bgR; rawData[px + 1] = bgG; rawData[px + 2] = bgB; rawData[px + 3] = 255;
      }
    }
  }

  // Compress
  const compressed = zlib.deflateSync(rawData);

  // Build PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type);
    const crc = crc32(Buffer.concat([typeB, data]));
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc >>> 0);
    return Buffer.concat([len, typeB, data, crcB]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', iend),
  ]);
}

// CRC32
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generate icons
const sizes = [72, 192, 512];
const dir = 'frontend/icons';

sizes.forEach(size => {
  const png = createPNG(size, 15, 15, 35, 233, 69, 96); // bg: #0f0f23, fg: #e94560
  fs.writeFileSync(`${dir}/icon-${size}.png`, png);
  console.log(`Created icon-${size}.png`);
});
