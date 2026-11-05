import { infoPopoverPosition, bindInfoPopovers } from '../app/shared/designsystem-info-popover.js';
import { optionalWealthVisible, wealthInfo, wealthAllocationRows } from '../app/shared/wealth-display.js';
import { renderBalanceOptionalAssets } from '../app/balance/balance-presentation-controls.js';
import { renderManagerProfiles } from '../app/tranches/tranchen-manager-renderer.js';
import { projectManagerProfiles } from '../app/tranches/tranchen-manager-profiles.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { tableMarkup } from '../app/balance/balance-wealth-history-renderer.js';

for (const [width, height] of [[1280, 720], [1920, 1080]]) {
    for (const anchor of [
        { right: 28, top: 100, bottom: 130 },
        { right: width - 8, top: height - 38, bottom: height - 8 },
        { right: 30, top: 10, bottom: 40 }
    ]) {
        const box = { width: 440, height: 220 }, position = infoPopoverPosition(anchor, box, width, height);
        assert(position.left >= 8 && position.left + box.width <= width - 8, 'ⓘ bleibt am linken und rechten Rand im Fenster');
        assert(position.top >= 8 && position.top + box.height <= height - 8, 'ⓘ bleibt am oberen und unteren Rand im Fenster');
        if (anchor.bottom > height - 100) assert(position.top < anchor.top, 'Am unteren Rand öffnet das Fenster nach oben');
    }
}
// Bindung an einem gewöhnlichen ⓘ, ohne Protokollklasse: inklusive Resize/Scroll.
{
    const attrs = {};
    const events = {}, button = { getAttribute: key => attrs[key] ?? null, setAttribute(key, value) { attrs[key] = value; }, addEventListener(type, fn) { events['button:' + type] = fn; }, getBoundingClientRect: () => ({ right: 30, top: 650, bottom: 680 }) };
    const pop = { style: {}, getBoundingClientRect: () => ({ width: 320, height: 180 }) };
    const host = { dataset: {}, contains: () => false, querySelector: s => s === '.ds-info-button' ? button : pop, addEventListener(type, fn) { events['host:' + type] = fn; } };
    const doc = { documentElement: { clientWidth: 1280, clientHeight: 720 }, querySelectorAll: () => [host], addEventListener(type, fn) { events[type] = fn; }, defaultView: { addEventListener(type, fn) { events[type] = fn; } } };
    bindInfoPopovers(doc); events['button:click']();
    assertEqual(pop.style.left, '30px', 'Gewöhnliches ⓘ wird links verschoben');
    assertEqual(pop.style.top, '462px', 'Gewöhnliches ⓘ klappt unten nach oben');
    assertEqual(pop.style.maxHeight, '704px', 'Überhohe Hinweise erhalten eine begrenzte Höhe');
    assertEqual(pop.style.transform, 'none', 'Alte seitenbezogene Verschiebungen gelten nach der Randkorrektur nicht weiter');
    doc.documentElement.clientHeight = 600; events.resize();
    assertEqual(pop.style.top, '412px', 'Resize korrigiert die Position erneut');
    assert(typeof events.scroll === 'function', 'Scrollen verwendet dieselbe Randkorrektur');
}
for (const [active, amount, expected] of [[false, 0, false], [true, 0, true], [false, 1, true], [true, 1, true]]) {
    assertEqual(optionalWealthVisible(active, amount), expected, 'Optionale Anlage folgt Planaktivität oder positivem Bestand');
}
const names = wealthAllocationRows({ cash: 100, geldmarkt: 200, aktien_alt: 300, gold: 400, anleihe: 500 }).map(r => r.label);
assert(names.includes('Tagesgeld') && names.includes('Geldmarkt') && !names.includes('Tagesgeld/Liquidität'), 'Tagesgeld und Geldmarkt haben eigene Namen und Beträge');
assert(wealthInfo({ cash: 100, gold: 20 }).includes('ds-wealth-amount'), 'Aufteilung enthält eigene Betragsspalte');
assert(!wealthInfo({ cash: 100 }).includes('Gold'), 'Ohne Goldbestand enthält die Liste keine Goldzeile');

const nodes = new Map();
const doc = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, dataset: {}, textContent: '', innerHTML: '', querySelector: () => null });
    return nodes.get(id);
} };
renderBalanceOptionalAssets(doc, { goldAktiv: false, goldWert: 0, initialBondBucket: 0, decumulation: { mode: 'standard' } });
assert(doc.getElementById('balanceAdopt-gold-bonds').hidden, 'Balance: Haushalt ohne Gold und Anleihen hat keine Anlagekachel');
renderBalanceOptionalAssets(doc, { goldAktiv: true, goldWert: 100, initialBondBucket: 0, decumulation: { mode: 'standard' } });
assert(!doc.getElementById('balanceAdopt-gold-bonds').hidden && !doc.getElementById('balanceAdopt-gold-bonds-value').textContent.includes(' · '), 'Balance: Goldbestand bleibt sichtbar, ohne Nullwert für Anleihen');
renderBalanceOptionalAssets(doc, { goldAktiv: false, goldWert: 0, initialBondBucket: 0, decumulation: { mode: '3_bucket_jilge' } });
assert(!doc.getElementById('balanceAdopt-gold-bonds').hidden, 'Balance: aktive Anleihenstrategie bleibt auch ohne Bestand sichtbar');

for (const withGold of [false, true]) {
    const records = createMusterHaushaltRecords('2026-10-27', 'max-erika');
    const registry = JSON.parse(records.rs_profiles_v1);
    if (withGold) for (const profile of Object.values(registry.profiles)) {
        const lots = JSON.parse(profile.data.depot_tranchen);
        lots.push({ ...lots[0], trancheId: 'ib-1-gold-' + lots[0].trancheId, type: 'gold', category: 'gold', tqf: 0, instrumentId: 'synthetic:ib-1-gold', ticker: 'GOLD', isin: '', name: 'Synthetisches Gold', marketValue: 1000, shares: 10, currentPrice: 100, purchasePrice: 100 });
        profile.data.depot_tranchen = JSON.stringify(lots);
    }
    const projection = projectManagerProfiles(registry, records.rs_current_profile);
    const household = { innerHTML: '', querySelectorAll: () => [] };
    const doc = { querySelectorAll: () => [], addEventListener() {}, getElementById: id => id === 'managerHousehold' ? household : null };
    renderManagerProfiles(doc, projection);
    const html = doc.getElementById('managerHousehold').innerHTML;
    assertEqual(html.includes('Gold'), withGold, `Max und Erika ${withGold ? 'mit' : 'ohne'} Gold: passende Haushaltszeilen`);
    assert(!html.includes('Pflegereserve-Ziel'), 'Ohne aktive Pflegereserve entfällt die Zielzeile');
    projection.profiles.forEach(p => { p.values.healthBucket.enabled = true; p.careTarget = 1000; });
    projection.household.careTarget = 2000;
    renderManagerProfiles(doc, projection);
    assert(doc.getElementById('managerHousehold').innerHTML.includes('Pflegereserve-Ziel'), 'Aktive Pflegereserve behält ihre Zielzeilen');
}
assert(!tableMarkup([{ asOf: '2026-10-27', goldWert: 0, anleihen: 0 }]).includes('>Gold<'), 'Erfasste Stände ohne Gold haben keine Goldspalte');
assert(tableMarkup([{ asOf: '2026-10-27', goldWert: 100, anleihen: 0 }]).includes('>Gold<'), 'Historischer Goldbestand bleibt in der Tabelle sichtbar');

{
    const card = { left: 400, right: 1200 }, box = { width: 440, height: 220 };
    assertEqual(infoPopoverPosition({ left: 450, right: 470, top: 100, bottom: 120 }, box, 1920, 1080, card).left, 450, 'Linkes ⓘ öffnet ab dem linken Knopfrand nach rechts');
    assertEqual(infoPopoverPosition({ left: 1100, right: 1120, top: 100, bottom: 120 }, box, 1920, 1080, card).left, 680, 'Rechtes ⓘ bleibt am rechten Knopfrand bündig');
    assertEqual(infoPopoverPosition({ left: 450, right: 470, top: 100, bottom: 120 }, { width: 1904, height: 220 }, 1920, 1080, card).left, 8, 'Sehr breites Fenster bleibt am Fensterrand');
}
