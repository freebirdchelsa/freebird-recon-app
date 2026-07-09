import sharp from 'sharp';
import { mkdirSync } from 'fs';

const SRC = 'C:\\Users\\FreeBird Auto\\OneDrive - freebirdauto.com\\Reconditioning\\2x\\Asset 1@2x.png';
const OUT = 'public';
const NAVY = '#0D2440';
const SKY = '#3B8CDE';

mkdirSync(OUT, { recursive: true });

// Standard icons: the source is already a white bird on a sky-blue circle —
// resize straight down, keep transparent corners (the OS applies its own mask).
await sharp(SRC).resize(192, 192).png().toFile(`${OUT}/icon-192.png`);
await sharp(SRC).resize(512, 512).png().toFile(`${OUT}/icon-512.png`);

// Maskable icon: OSes crop aggressively to a circle/squircle, so the bird's
// wingtips (which touch the edge in the source) need breathing room — shrink
// it onto a solid sky-blue square background well inside the safe zone.
const maskableInner = await sharp(SRC).resize(360, 360).png().toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 4, background: SKY },
})
  .composite([{ input: maskableInner, gravity: 'center' }])
  .png()
  .toFile(`${OUT}/icon-512-maskable.png`);

// Favicon-ish small icon for the browser tab.
await sharp(SRC).resize(64, 64).png().toFile(`${OUT}/icon-64.png`);

console.log('icons written to', OUT);
