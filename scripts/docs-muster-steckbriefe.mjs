// Kurzer Handbuchverweis aus dem vorhandenen Haushalts- und Variantenkatalog.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MUSTER_HAUSHALTE, musterVarianten } from '../app/demo/muster-haushalte.js';
export function handbookMusterHtml() {
    const count = MUSTER_HAUSHALTE.reduce((sum, h) => sum + musterVarianten(h.id).length, 0);
    return `<p>Die <a href="docs/reference/BEISPIELHAUSHALTE.html">Beispielhaushalte</a> beschreiben ${MUSTER_HAUSHALTE.length} Haushalte mit insgesamt ${count} Grundfällen und Varianten.</p>`;
}
export const MUSTER_BLOCK = /<!-- muster-steckbriefe:start -->[\s\S]*?<!-- muster-steckbriefe:end -->/;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const path = new URL('../Handbuch.html', import.meta.url), text = readFileSync(path, 'utf8');
    if (!MUSTER_BLOCK.test(text)) throw new Error('Handbuch: Steckbriefanker fehlt');
    writeFileSync(path, text.replace(MUSTER_BLOCK, `<!-- muster-steckbriefe:start -->\n${handbookMusterHtml()}\n<!-- muster-steckbriefe:end -->`));
}
