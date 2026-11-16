const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
async function downloadImage(item, folder, signal, onProgress) {
  const timeout = AbortSignal.timeout(120000);
  const response = await fetch(item.url, { signal: AbortSignal.any([signal, timeout]), redirect: 'follow' });
  if (!response.ok) throw new Error(`Image server returned HTTP ${response.status}.`);
  const ext = types[(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()];
  if (!ext) { await response.body?.cancel(); throw new Error('This address is not a supported image file. Use a direct JPG, PNG, WebP, GIF, or AVIF URL; Instagram post pages are not image URLs.'); }
  const maxBytes = 100 * 1024 * 1024; const total = Number(response.headers.get('content-length')) || 0;
  if (total > maxBytes) { await response.body?.cancel(); throw new Error('This image exceeds the 100 MB limit.'); }
  const filename = path.join(folder, `image-${item.id}.${ext}`); const partial = `${filename}.part`; let bytes = 0;
  const counter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; if (bytes > maxBytes) return callback(new Error('This image exceeds the 100 MB limit.')); onProgress(total ? Math.min(99, bytes / total * 100) : 0); callback(null, chunk); } });
  try { await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(partial), { signal: AbortSignal.any([signal, timeout]) }); if (!bytes) throw new Error('The server returned an empty image.'); await fs.promises.rename(partial, filename); return { file: filename, title: `Image · ${new URL(item.url).hostname}`, bytes }; }
  catch (error) { await fs.promises.unlink(partial).catch(() => {}); throw error; }
}
module.exports = { downloadImage };
