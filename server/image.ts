import { HTTPException } from 'hono/http-exception';

export interface ImageInfo { mime: string; ext: string; width: number | null; height: number | null }

export function inspectImage(buffer: Buffer): ImageInfo {
  let info: ImageInfo | undefined;
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && buffer.toString('ascii',12,16) === 'IHDR') {
    info = { mime: 'image/png', ext: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } else if (buffer.length >= 13 && /GIF8[79]a/.test(buffer.toString('ascii',0,6))) {
    info = { mime: 'image/gif', ext: 'gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  } else if (buffer.length >= 30 && buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP') {
    let width: number | null = null, height: number | null = null;
    const chunk = buffer.toString('ascii',12,16);
    if (chunk === 'VP8X') { width = buffer.readUIntLE(24,3)+1; height = buffer.readUIntLE(27,3)+1; }
    else if (chunk === 'VP8 ' && buffer.length >= 30 && buffer.subarray(23,26).equals(Buffer.from([157,1,42]))) { width = buffer.readUInt16LE(26)&0x3fff; height = buffer.readUInt16LE(28)&0x3fff; }
    else if (chunk === 'VP8L' && buffer[20] === 0x2f) { const bits = buffer.readUInt32LE(21); width = (bits&0x3fff)+1; height = ((bits>>>14)&0x3fff)+1; }
    info = { mime: 'image/webp', ext: 'webp', width, height };
  } else if (buffer.length >= 20 && buffer.toString('ascii',4,8) === 'ftyp' && ['avif','avis'].some(brand => buffer.subarray(8,Math.min(buffer.readUInt32BE(0),128,buffer.length)).includes(Buffer.from(brand)))) {
    info = { mime: 'image/avif', ext: 'avif', width: null, height: null };
  } else if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    let offset = 2;
    while (offset + 4 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset+1];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0xff) { offset++; continue; }
      const length = buffer.readUInt16BE(offset+2);
      if (length < 2 || offset+2+length > buffer.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length>=7) {
        info = { mime: 'image/jpeg', ext: 'jpg', height: buffer.readUInt16BE(offset+5), width: buffer.readUInt16BE(offset+7) };
        break;
      }
      offset += length+2;
    }
  }
  if (!info) throw new HTTPException(400, { message: '请选择有效的 JPG、PNG、GIF、WebP 或 AVIF 图片' });
  if (info.width !== null && info.height !== null && (info.width < 1 || info.height < 1 || info.width*info.height > 100_000_000)) {
    throw new HTTPException(400, { message: '图片尺寸无效或超过 1 亿像素' });
  }
  return info;
}
