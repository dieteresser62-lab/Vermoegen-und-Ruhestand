import { readFileSync } from 'node:fs';
import { renderSimulatorPortfolioTiles } from '../app/simulator/simulator-portfolio-display.js';

const nodes = new Map(['simMoneyWealth', 'simBondWealth', 'simGoldTile', 'simBondTile', 'simPortfolioParameters']
    .map(id => [id, { hidden: false, textContent: '' }]));
const doc = { getElementById: id => nodes.get(id) };
renderSimulatorPortfolioTiles(doc, { goldAktiv: false }, { money: 1000, gold: 0, bonds: 0 });
assert(nodes.get('simGoldTile').hidden && nodes.get('simBondTile').hidden, 'Haushalt ohne optionale Anlagen zeigt keine leeren Gold- und Anleihenkacheln');
assert(nodes.get('simPortfolioParameters').hidden, 'Leere Portfolio-Parameterkarte entfällt');
assertEqual(nodes.get('simMoneyWealth').textContent, '1.000', 'Geldvermögen wird als lesender Hauptwert formatiert');
for (const goldAktiv of [true, false]) {
    renderSimulatorPortfolioTiles(doc, { goldAktiv }, { money: 1200, gold: goldAktiv ? 0 : 200, bonds: 0 });
    assert(!nodes.get('simGoldTile').hidden, 'Gold erscheint bei aktivem Plan oder positivem Bestand');
}
renderSimulatorPortfolioTiles(doc, { decumulation: { mode: 'standard' } }, { money: 1300, gold: 0, bonds: 300 });
assert(!nodes.get('simBondTile').hidden && nodes.get('simPortfolioParameters').hidden, 'Anleihenbestand bleibt sichtbar; Anleihentopf-Parameter braucht die aktive Strategie');
renderSimulatorPortfolioTiles(doc, { decumulation: { mode: '3_bucket_jilge' } }, { money: 1000, gold: 0, bonds: 0 });
assert(!nodes.get('simBondTile').hidden && !nodes.get('simPortfolioParameters').hidden, 'Aktive Anleihenstrategie zeigt auch einen leeren Starttopf');
const html = readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8');
const tiles = html.split('id="simStep1Content"')[1].split('<h3')[0];
assert(tiles.includes('for="geldmarktEtf">Geldmarkt</label>') && tiles.includes('for="tagesgeld">Tagesgeld</label>'), 'Auch ohne Gold zeigen die Hauptkacheln Geldmarkt neben Tagesgeld');
assertEqual((html.match(/id="geldmarktEtf"/g) || []).length, 1, 'Geldmarkt erscheint nur einmal in den Annahmen');
assert(!html.split('id="simPortfolioParameters"')[1].split('</details>')[0].includes('geldmarktEtf'), 'Alle Parameter wiederholt Geldmarkt nicht');

