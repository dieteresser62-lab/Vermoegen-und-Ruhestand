// BV-1: Handbuchbilder verkleinern (pngquant, Format bleibt PNG) und Bildrauschen vermeiden (Pixelvergleich gegen die vorhandene Datei).
// Ohne npm-Abhängigkeit: pngquant ist ein Systemwerkzeug; der PNG-Leser deckt die Formate von Playwright und pngquant ab.
import { spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';

/** Aufruf wie im Auftrag; `-` liest und schreibt über die Standardkanäle. */
export const PNGQUANT_ARGS = Object.freeze(['--quality=70-90', '--speed=1', '--strip', '-']);
/** Geändert ist ein Bild, wenn die Maße abweichen oder mehr als 8 Pixel in einem Farbkanal um mehr als 32 abweichen. VK-3c: Grenze 8 statt 16;
 * gemessen erkennt sie alle Ziffernpaare ab 11 px und „+19,0 %“ → „−19,0 %“ in grauer Schrift (kleinste Abweichung 10), unveränderte Aufnahmen 0. */
export const NOISE_LIMIT = Object.freeze({ channel: 32, pixels: 8 });

let available = null;
/** @returns {boolean} ob `pngquant` aufrufbar ist (einmal geprüft). */
export function pngquantAvailable() {
    if (available === null) {
        const probe = spawnSync('pngquant', ['--version'], { encoding: 'utf8' });
        available = probe.status === 0;
    }
    return available;
}

/** Verkleinert eine PNG-Aufnahme mit pngquant. Fehlt das Werkzeug oder verfehlt es die Mindestqualität, bleibt `fallback(buffer)`.
 * @param {Buffer} buffer @param {(buffer: Buffer) => Buffer} fallback @returns {{buffer: Buffer, quantized: boolean}} */
export function shrinkPng(buffer, fallback) {
    if (!pngquantAvailable()) return { buffer: fallback(buffer), quantized: false };
    const run = spawnSync('pngquant', [...PNGQUANT_ARGS], { input: buffer, maxBuffer: 64 * 1024 * 1024 });
    if (run.status !== 0 || !run.stdout?.length) return { buffer: fallback(buffer), quantized: false };
    const out = Buffer.from(run.stdout);
    return out.length < buffer.length ? { buffer: out, quantized: true } : { buffer: fallback(buffer), quantized: false };
}

/** Verkleinert eine neue Aufnahme genau wie die vorhandene Datei: mit deren Palette (`pngquant --map`). Zwei getrennt verkleinerte, fast
 * gleiche Aufnahmen wählen sonst leicht andere Paletten und weichen in Hunderten Pixeln um mehr als 32 ab (Befund BV-1, zweiter voller Lauf).
 * @param {Buffer} buffer neue Aufnahme @param {string} paletteFile vorhandene PNG mit Palette @returns {Buffer|null} */
export function remapPng(buffer, paletteFile) {
    if (!pngquantAvailable()) return null;
    const run = spawnSync('pngquant', ['--map', paletteFile, '--strip', '-'], { input: buffer, maxBuffer: 64 * 1024 * 1024 });
    return run.status === 0 && run.stdout?.length ? Buffer.from(run.stdout) : null;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Liest ein nicht verschachteltes PNG mit 8 Bit je Kanal (Grau, RGB, Grau+Alpha, RGBA) oder Palette (1–8 Bit) als RGBA.
 * @param {Buffer} buffer @returns {{width: number, height: number, rgba: Uint8Array}} */
export function decodePng(buffer) {
    if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Kein PNG.');
    let width = 0, height = 0, depth = 0, type = 0, interlace = 0, palette = null, alpha = null;
    const data = [];
    for (let offset = 8; offset < buffer.length;) {
        const size = buffer.readUInt32BE(offset), kind = buffer.toString('ascii', offset + 4, offset + 8);
        const body = buffer.subarray(offset + 8, offset + 8 + size);
        if (kind === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
        else if (kind === 'PLTE') palette = body;
        else if (kind === 'tRNS') alpha = body;
        else if (kind === 'IDAT') data.push(body);
        else if (kind === 'IEND') break;
        offset += size + 12;
    }
    if (interlace) throw new Error('Verschachtelte PNG werden nicht gelesen.');
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
    if (!channels || (type !== 3 && depth !== 8) || (type === 3 && ![1, 2, 4, 8].includes(depth))) throw new Error(`PNG-Format ${type}/${depth} nicht unterstützt.`);
    const raw = inflateSync(Buffer.concat(data));
    const bpp = Math.max(1, (channels * depth) >> 3), stride = Math.ceil(width * channels * depth / 8);
    const lines = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const out = lines.subarray(y * stride, (y + 1) * stride), prev = y ? lines.subarray((y - 1) * stride, y * stride) : null;
        for (let i = 0; i < stride; i++) {
            const a = i >= bpp ? out[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0;
            let value = line[i];
            if (filter === 1) value += a;
            else if (filter === 2) value += b;
            else if (filter === 3) value += (a + b) >> 1;
            else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
            out[i] = value & 255;
        }
    }
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        const row = lines.subarray(y * stride, (y + 1) * stride);
        for (let x = 0; x < width; x++) {
            const target = (y * width + x) * 4;
            if (type === 3) {
                const index = depth === 8 ? row[x] : (row[(x * depth) >> 3] >> (8 - depth - ((x * depth) & 7))) & ((1 << depth) - 1);
                rgba[target] = palette[index * 3]; rgba[target + 1] = palette[index * 3 + 1]; rgba[target + 2] = palette[index * 3 + 2];
                rgba[target + 3] = alpha && index < alpha.length ? alpha[index] : 255;
            } else {
                const source = x * channels;
                const gray = type === 0 || type === 4;
                rgba[target] = row[source]; rgba[target + 1] = gray ? row[source] : row[source + 1]; rgba[target + 2] = gray ? row[source] : row[source + 2];
                rgba[target + 3] = type === 6 ? row[source + 3] : type === 4 ? row[source + 1] : 255;
            }
        }
    }
    return { width, height, rgba };
}

/** Zählt Pixel, die in mindestens einem Kanal um mehr als `channel` abweichen. Ein Versatz des ganzen Inhalts um ein Pixel (Lage des
 * Ausschnitts schwankt zwischen Läufen um Bruchteile eines Pixels) gilt nicht als Änderung: geprüft werden alle Verschiebungen um
 * höchstens ein Pixel, gezählt wird die beste. @param {Buffer} next @param {Buffer} previous
 * @param {{channel?: number, pixels?: number}} [limit] @returns {{changed: boolean, pixels: number, reason: string}} */
export function comparePng(next, previous, limit = NOISE_LIMIT) {
    const a = decodePng(next), b = decodePng(previous);
    if (a.width !== b.width || a.height !== b.height) return { changed: true, pixels: Infinity, reason: `Maße ${b.width}×${b.height} → ${a.width}×${a.height}` };
    const channel = limit.channel ?? NOISE_LIMIT.channel, maxPixels = limit.pixels ?? NOISE_LIMIT.pixels;
    const count = (dx, dy, stop) => {
        let pixels = 0;
        for (let y = Math.max(0, -dy); y < Math.min(a.height, b.height - dy); y++) {
            for (let x = Math.max(0, -dx); x < Math.min(a.width, b.width - dx); x++) {
                const i = (y * a.width + x) * 4, j = ((y + dy) * b.width + x + dx) * 4;
                if (Math.abs(a.rgba[i] - b.rgba[j]) > channel || Math.abs(a.rgba[i + 1] - b.rgba[j + 1]) > channel
                    || Math.abs(a.rgba[i + 2] - b.rgba[j + 2]) > channel || Math.abs(a.rgba[i + 3] - b.rgba[j + 3]) > channel) {
                    if (++pixels > stop) return pixels;
                }
            }
        }
        return pixels;
    };
    let pixels = count(0, 0, Infinity), shift = '';
    if (pixels > maxPixels) for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const shifted = count(dx, dy, maxPixels);
        if (shifted <= maxPixels) { pixels = shifted; shift = ` nach Versatz ${dx}/${dy}`; break; }
    }
    return { changed: pixels > maxPixels, pixels, reason: `${pixels} Pixel abweichend${shift}` };
}
