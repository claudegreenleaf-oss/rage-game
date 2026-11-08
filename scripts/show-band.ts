// Print a band of a zone as ASCII with object markers.  npx tsx scripts/show-band.ts w1 3
import { readFileSync } from 'node:fs';
const [id, k] = [process.argv[2]!, Number(process.argv[3] ?? 0)];
const l = JSON.parse(readFileSync(`src/levels/world/${id}.json`, 'utf8'));
const rows: string[][] = l.tiles.slice(k * 12, k * 12 + 12).map((r: string) => r.split(''));
for (const o of l.objects) { const y = Math.floor(o.y) - k * 12; if (y >= 0 && y < 12 && o.x >= 0) { const ch = { crate: 'K', vine: 'V', bench: 'B', relic: o.kind === 'note' ? 'n' : 'j', platform: 'M', laser: 'L', crusher: 'C' }[o.type as string]; if (ch) rows[y]![Math.floor(o.x)] = ch; } }
rows.forEach((r, i) => console.log(String(k * 12 + i).padStart(3), r.join('')));
