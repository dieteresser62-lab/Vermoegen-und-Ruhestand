// Ergänzt unveränderte Ganzseiten um den sichtbaren Bildschirm und verknüpft das Inventar.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'auftrag/GV-2-kontakt');
const documents = await Promise.all(['vorher', 'nachher', 'partnerschaft-vorher', 'partnerschaft-nachher']
    .map(name => fs.readFile(path.join(directory, `${name}.md`), 'utf8')));
const inventory = await fs.readFile(path.join(root, 'auftrag/GV-2-inventar.md'), 'utf8');
const rows = inventory.split('\n').filter(line => /^\| \d+ \|/.test(line)).map(line => line.split('|').map(cell => cell.trim()));
const records = documents.flatMap(document => document.split('\n').filter(line => line.startsWith('| [')).map(line => {
    const cells = line.split('|').map(cell => cell.trim());
    return { file: cells[1].match(/\]\(([^)]+)\)/)[1], place: cells[2], expected: cells[3] };
}));
const browser = await chromium.launch({ headless: true });
let count = 0;
try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const record of records) {
        const png = await fs.readFile(path.join(directory, record.file));
        const width = png.readUInt32BE(16), height = width === 1920 ? 1080 : 1440;
        await page.setViewportSize({ width, height });
        await page.setContent(`<body style="margin:0"><img style="display:block" src="data:image/png;base64,${png.toString('base64')}"></body>`);
        await page.locator('img').evaluate(image => image.decode());
        record.screen = record.file.replace('.png', '-bildschirm.png');
        await page.screenshot({ path: path.join(directory, record.screen), animations: 'disabled' });
        if (++count % 50 === 0) console.log(`${count}/${records.length} Bildschirme ergänzt.`);
    }
} finally { await browser.close(); }
const chapter = file => file.replace(/^(vorher|nachher)-(immobilien|grund|drei-toepfe)-/, '').replace(/-(1920|2560)\.png$/, '');
const indexRows = records.map(record => {
    const state = chapter(record.file);
    const numbers = rows.filter(row => row[8] === state
        || state.startsWith('person-') && row[2] === 'Person und Depot'
        || state.startsWith('verlauf-') && row[2] === 'Verlauf Haushalt/Person'
        || state.startsWith('handbuch') && row[2].startsWith('Handbuch')
        || state.startsWith('monte-carlo-care') && row[2] === 'Monte Carlo Pflege'
        || state.startsWith('werkstatt-') && row[2] === 'Werkstatt'
        || record.file.includes('martin-petra') && row[2] === 'Partnerschaft').map(row => row[1]);
    return `| [${record.file}](${record.file}) · [Bildschirm](${record.screen}) | ${numbers.join(', ') || 'ergänzende Seitenabnahme'} | ${record.place} | ${record.expected} |`;
});
const changedFiles = [...new Set([
    ...execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' }).trim().split('\n'),
    ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
].filter(Boolean))].sort();
const adjustedTests = changedFiles.filter(file => file.startsWith('tests/') && file.endsWith('.mjs') && !file.includes('gv-2-'));
const content = `# GV-2 · Kontaktbogen

Nur synthetische Spielbereiche. Vorher: unveränderte Quellen des Ausgangscommits nach ET-2 aus einer separaten Kopie. Nachher: Arbeitsbaum mit GV-2. Die Vorher-Kopie enthält weder echte Browserprofile noch Nutzerdaten. Die Aufnahmen verwenden Spielkurse am 23.10.2026, Monte Carlo 128 Pfade und Seed 12345.

Fälle: Max und Erika mit Haus und vermieteter Wohnung; Max und Erika ohne Immobilien; Helga und Werner mit Gold, Anleihen und Haus. Martin und Petra ergänzen die beiden Erbbedienwege. Jeweils 1920×1080 und 2560×1440 bei Skalierung 1. Der erste Link zeigt die vollständige Seite; Bildschirm zeigt den unveränderten oberen Ausschnitt in der jeweiligen Fenstergröße.

Zum direkten Vergleich öffne den [Kontaktbogen nebeneinander](kontakt.html). Die Nummern verweisen auf das [Inventar](../GV-2-inventar.md). ${records.length} Ganzseiten und ${records.length} Bildschirme, jeweils vorher und nachher. Bei erklärenden Geldkennzahlen bleibt die ausgewiesene Geldbasis erhalten. Die Kontaktaufnahmen zeigen die Zustände zur Abnahme; sie ersetzen keine Freigabe der Steuerung.

| Bild / Bildschirm | Inventarstellen | Seite und Fall | Was zu sehen sein soll |
|---|---|---|---|
${indexRows.join('\n')}

## Geänderte Dateien

${changedFiles.map(file => `- [${file}](../../${file})`).join('\n')}

## Testerwartungen

Alle Testdateien wurden auf die geänderten Texte durchsucht, einschließlich simulator-monte-carlo-browser.mjs und browser-smoke.test.mjs. Beim separaten Monte-Carlo-Browsertest war keine Erwartungsänderung nötig. Es gibt keine neuen Browserfälle. Der Node-Test gv-2-wealth-consistency.test.mjs prüft Gesamtwerte, Verkauf, Geldruin, Fächer und unveränderte Finanzbytes. Der bestehende Node-Testadapter für die Simulatorfelder erhält die neuen Anzeigehilfen als Abhängigkeiten.

${adjustedTests.map(file => `- [${file}](../../${file})`).join('\n')}
`;
await fs.writeFile(path.join(directory, 'index.md'), content);
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pairs = records.filter(record => record.file.startsWith('nachher-')).map(record => ({
    after: record, before: records.find(other => other.file === record.file.replace(/^nachher-/, 'vorher-')),
    width: record.file.endsWith('-1920.png') ? '1920' : '2560',
    state: chapter(record.file),
    family: record.file.includes('-martin-petra-') ? 'Martin und Petra' : record.file.includes('-drei-toepfe-') ? 'Helga und Werner' : record.file.includes('-immobilien-') ? 'Max und Erika mit Immobilien' : 'Max und Erika ohne Immobilien'
}));
const families = [...new Set(pairs.map(pair => pair.family))];
const states = [...new Set(pairs.map(pair => pair.state))];
const gallery = `<!doctype html><html lang="de"><meta charset="utf-8"><title>GV-2 · Kontaktbogen</title>
<link rel="stylesheet" href="../../css/tokens.css"><link rel="stylesheet" href="../../css/fonts.css">
<style>body{margin:24px;background:var(--page);color:var(--text-main);font-family:var(--font-sans)}h1,h2{font-family:var(--font-serif);font-weight:500}nav{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:24px 0}select{font:inherit;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface)}article{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin:20px 0}article[hidden]{display:none}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;min-width:0}img{display:block;width:100%;height:auto;border:1px solid var(--border)}figcaption{margin:8px 0}a{color:var(--accent)}small{color:var(--text-muted)}</style>
<h1>GV-2 · Vorher und nachher</h1><p>Nur synthetische Spielbereiche. Beide Bilder zeigen denselben Fall und dieselbe Fenstergröße. Ein Klick öffnet die ganze Seite.</p>
<p><a href="index.md">Inventarzuordnung und Dateiliste</a></p>
<nav><label>Haushalt <select id="family">${families.map(value => `<option>${escape(value)}</option>`).join('')}</select></label><label>Fensterbreite <select id="width"><option>1920</option><option>2560</option></select></label><label>Ansicht <select id="state"><option value="">Alle</option>${states.map(value => `<option>${escape(value)}</option>`).join('')}</select></label></nav>
${pairs.map(pair => `<article data-family="${escape(pair.family)}" data-width="${pair.width}" data-state="${escape(pair.state)}"><h2>${escape(pair.after.place)} · ${pair.width} px</h2><p>${escape(pair.after.expected)}</p><div class="pair">${[['Vorher', pair.before], ['Nachher', pair.after]].map(([label, record]) => `<figure><figcaption>${label} · <a href="${escape(record.file)}">Ganze Seite öffnen</a></figcaption><a href="${escape(record.file)}"><img loading="lazy" src="${escape(record.screen)}" alt="${label}: ${escape(record.place)}"></a></figure>`).join('')}</div></article>`).join('')}
<script>const ids=['family','width','state'];function show(){const values=Object.fromEntries(ids.map(id=>[id,document.getElementById(id).value]));document.querySelectorAll('article').forEach(node=>node.hidden=node.dataset.family!==values.family||node.dataset.width!==values.width||!!values.state&&node.dataset.state!==values.state)}ids.forEach(id=>document.getElementById(id).addEventListener('change',show));show();</script></html>`;
await fs.writeFile(path.join(directory, 'kontakt.html'), gallery);
console.log(`GV-2 Kontaktbogen: ${records.length} Ganzseiten, ${records.length} Bildschirmaufnahmen, ${rows.length} Inventarstellen verknüpft.`);
