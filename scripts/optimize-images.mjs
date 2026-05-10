import sharp from 'sharp';
import { stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, '..', 'public', 'assets');

// [filename, maxWidth, webpQuality]
// maxWidth: null = no resize (already small enough)
// Portraits: 1200px — shown at ~480px, 2x retina = 960, 1200 is safe headroom
// Hero/full-width: 2400px — 1440px viewport at ~1.67x
// Logos/emblems: 800–1200px — used as decorative or small UI elements
const images = [
  ['adriel-portrait.jpg',       1200, 85],
  ['band-hero.jpg',             2400, 85],
  ['nathan-portrait.jpg',       1200, 85],
  ['poster-movie.jpg',          1200, 85],
  ['press-angel.jpg',           null, 85],
  ['press-neural.jpg',          null, 85],
  ['press-odeholm.jpg',         null, 85],
  ['press-sugarman.jpg',        null, 85],
  ['screams-still.jpg',         1920, 85],
  ['yanina-portrait.jpg',       1200, 85],
  // PNGs with alpha — quality 90 (lossy WebP preserves edges well at this level)
  ['adriel-logo-violeta.png',    512, 90],
  ['emblema-negro.png',          800, 90],
  ['emblema-transparent.png',    800, 90],
  ['emblema-white-trans.png',    800, 90],
  ['emblema-white.png',          800, 90],
  ['psychography-logo.png',     1200, 90],
];

const fmt = (n) => (n >= 1024 ? (n / 1024).toFixed(1) + ' MB' : n + ' KB');

let totalBefore = 0, totalAfter = 0;

for (const [file, maxW, quality] of images) {
  const inPath  = join(dir, file);
  const outName = file.replace(/\.(jpe?g|png)$/i, '.webp');
  const outPath = join(dir, outName);

  const meta   = await sharp(inPath).metadata();
  const before = Math.round((await stat(inPath)).size / 1024);
  totalBefore += before;

  let pipeline = sharp(inPath);
  if (maxW && meta.width > maxW) {
    pipeline = pipeline.resize(maxW, null, { fit: 'inside', withoutEnlargement: true });
  }

  const { info } = await pipeline
    .webp({ quality })
    .toFile(outPath)
    .then(info => ({ info }));

  const after = Math.round((await stat(outPath)).size / 1024);
  totalAfter += after;

  const ratio = Math.round((1 - after / before) * 100);
  const dims  = `${meta.width}x${meta.height}`;
  const newW  = maxW && meta.width > maxW ? maxW : meta.width;
  const newH  = maxW && meta.width > maxW ? Math.round(meta.height * maxW / meta.width) : meta.height;
  const newDims = `${newW}x${newH}`;

  console.log(
    `${outName.padEnd(32)} ${dims.padEnd(12)} → ${newDims.padEnd(12)}  ${fmt(before).padStart(8)} → ${fmt(after).padStart(7)}  (-${ratio}%)`
  );
}

console.log('');
console.log(`Total: ${fmt(totalBefore)} → ${fmt(totalAfter)}  (-${Math.round((1 - totalAfter / totalBefore) * 100)}%)`);
