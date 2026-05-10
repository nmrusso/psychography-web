import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'public/assets/emblema-white-trans.png');
const publicDir = join(root, 'public');

// favicon 32x32: fondo #0A0A0A + emblema blanco centrado con padding
async function makeFavicon(size, outFile) {
  const pad = Math.round(size * 0.12);
  const inner = size - pad * 2;

  const emblem = await sharp(src)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 255 } }
  })
    .composite([{ input: emblem, top: pad, left: pad }])
    .png()
    .toFile(join(publicDir, outFile));

  console.log(`✓ ${outFile} (${size}x${size})`);
}

await makeFavicon(32,  'favicon-32.png');
await makeFavicon(16,  'favicon-16.png');
await makeFavicon(180, 'apple-touch-icon.png');

// favicon.ico — usamos el de 32px renombrado (los browsers modernos aceptan PNG como .ico)
import { copyFileSync } from 'fs';
copyFileSync(join(publicDir, 'favicon-32.png'), join(publicDir, 'favicon.ico'));
console.log('✓ favicon.ico (copy of 32px)');

// favicon.svg — inline del emblema con fondo negro
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#0A0A0A"/>
  <image href="/assets/emblema-white-trans.png" x="10" y="10" width="80" height="80"/>
</svg>`;
import { writeFileSync } from 'fs';
writeFileSync(join(publicDir, 'favicon.svg'), svgContent);
console.log('✓ favicon.svg');
