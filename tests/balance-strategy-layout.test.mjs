import fs from 'node:fs';
import { tokenizeHTML } from './funktionsinventar-contract.mjs';
import { createSelectionDocument, addField } from './designsystem-selection-dom.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { createLocalStorageAdapter } from '../app/shared/persistence-adapter-localstorage.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { householdPlanFieldSpec, readBoundHouseholdPlanField } from '../app/shared/household-plan-fields.js';
import { BALANCE_PLAN_FIELD_MAP, getBalancePlanTrial, renderBalancePlanTrial } from '../app/balance/balance-plan-trial.js';
import { renderBalanceStrategyValues } from '../app/balance/balance-presentation-controls.js';

const tree = tokenizeHTML(fs.readFileSync(new URL('../Balance.html', import.meta.url), 'utf8'));
const node = id => tree.elements.find(node => node.attrs.id === id);
const inside = (child, parent) => { for (let item = child; item; item = item.parent) if (item === parent) return true; return false; };
const need = tree.elements.find(node => node.attrs['aria-labelledby'] === 'h-strategy-need');
const parameters = node('balanceAllParameters');
// Strategiereiter ausgewählt; native details-Ahnen behalten ihren Anfangszustand.
const visible = child => {
    for (let item = child; item && item !== node('tab-strategy'); item = item.parent) {
        if ('hidden' in item.attrs) return false;
        if (item.parent?.tag === 'details' && item.tag !== 'summary' && !('open' in item.parent.attrs)) return false;
    }
    return inside(child, node('tab-strategy'));
};
assertEqual(tree.elements.filter(item => item.tag === 'input' && inside(item, need)).map(item => item.attrs.id).join(','),
    'floorBedarf,flexBedarf,minimumFlexAnnual', 'Offene Bedarfskarte zeigt genau Grundbedarf, Wunschbedarf und Mindest-Flex');
assert(visible(need) && ['floorBedarf', 'flexBedarf', 'minimumFlexAnnual'].every(id => visible(node(id))), 'Die drei Bedarfswerte sind im Strategiereiter offen sichtbar');
assert(!('open' in parameters.attrs), 'Alle Parameter ist beim Seitenaufruf geschlossen');
assertEqual(tree.elements.filter(item => item.tag === 'details' && inside(item, node('tab-strategy'))).length, 1, 'Ein gemeinsamer Parameterzugang');
for (const id of ['liquidityRunwayYears', 'minCashBufferMonths', 'dynamicFlexPreset', 'horizonMethod', 'flexBudgetAnnual', 'rebalancingBand', 'endeVJ', 'marketCapeRatio'])
    assert(inside(node(id), parameters) && !visible(node(id)), id + ': im geschlossenen Parameterbereich erhalten');
for (const heading of ['h-strategy-adopt', 'h-strategy-market']) {
    const card = tree.elements.find(item => item.attrs['aria-labelledby'] === heading);
    assert(visible(card) && card.attrs.class.includes('balance-strategy-wide'), heading + ': offen über volle Breite');
    assert(!tree.elements.some(item => ['input', 'select'].includes(item.tag) && inside(item, card)), heading + ': Kacheln sind nur lesend');
}
assertEqual(tree.elements.filter(item => item.attrs.class === 'balance-value-tile' && inside(item, node('balanceAdoptedRows'))).length, 6, 'Übernommen zeigt sechs Kacheln');
assertEqual(tree.elements.filter(item => item.attrs.class === 'balance-value-tile' && inside(item, tree.elements.find(item => item.attrs['aria-labelledby'] === 'h-strategy-market'))).length, 6, 'Marktdaten zeigt sechs Kacheln');
assertEqual(householdPlanFieldSpec('horizonMethod').label, 'Horizont-Methode', 'Methode hat den gemeinsamen eindeutigen Namen');

const backend = new Map(Object.entries(createMusterHaushaltRecords('2026-10-09')));
P.resetPersistenceForTests(createLocalStorageAdapter({ getItem: key => backend.get(key) ?? null,
    setItem: (key, value) => backend.set(key, value), removeItem: key => backend.delete(key),
    key: i => [...backend.keys()][i] ?? null, get length() { return backend.size; } }));
await P.init({ installLifecycleHooks: false });
try {
    const doc = createSelectionDocument();
    for (const [id, path] of Object.entries(BALANCE_PLAN_FIELD_MAP)) {
        const spec = householdPlanFieldSpec(path);
        const field = addField(doc, id, '', spec?.options);
        if (spec?.checkbox) field.type = 'checkbox';
    }
    addField(doc, 'rebalancingBand', '25');
    const trial = getBalancePlanTrial(doc), values = trial.values();
    renderBalancePlanTrial(doc, { project: true });
    const before = JSON.stringify(P.exportAllSync().records);
    for (const id of ['floorBedarf', 'flexBedarf', 'minimumFlexAnnual']) {
        const field = doc.getElementById(id);
        assert(field.disabled && readBoundHouseholdPlanField(field) === values[id], id + ': liest denselben bestätigten Planwert');
        assert(!field.value.includes('€'), id + ': Einheit wird nur am Rahmen angezeigt');
        const reason = doc.getElementById(field.getAttribute('aria-describedby'));
        assert(reason?.textContent === 'aus Haushalt & Plan' && reason.dataset.fieldState === 'adopted', id + ': Herkunft bleibt zugänglich');
    }
    trial.start(); renderBalancePlanTrial(doc, { project: true });
    for (const id of ['floorBedarf', 'flexBedarf', 'minimumFlexAnnual', 'flexBudgetAnnual', 'liquidityRunwayYears', 'marketCapeRatio', 'rebalancingBand'])
        assert(!doc.getElementById(id).disabled, id + ': bisherige Versuchseingabe bleibt erreichbar');
    const floor = doc.getElementById('floorBedarf'); floor.value = '25.000'; trial.capture(['floorBedarf']);
    assertEqual(trial.values().floorBedarf, 25000, 'Versuch liest die deutsche Eingabe');
    trial.reset(); renderBalancePlanTrial(doc, { project: true });
    assertEqual(readBoundHouseholdPlanField(floor), values.floorBedarf, 'Zurück zum Plan verwirft den Versuch');
    assertEqual(JSON.stringify(P.exportAllSync().records), before, 'Anzeige, Versuch und Rückkehr schreiben keinen Plan');
    for (const id of ['balanceMarket-endeVJ-value', 'balanceMarket-endeVJ-detail', 'balanceMarket-endeVJ_3-detail', 'balanceMarket-ath-detail', 'balanceMarket-cape-value', 'balanceGoldBandFrame', 'balanceGoldOff']) addField(doc, id);
    const input = { endeVJ: 142.8, ath: 146.1, jahreSeitAth: .2, marketCapeRatio: 32, inflation: 2, goldAktiv: false };
    renderBalanceStrategyValues(doc, input, 2025);
    assertEqual(doc.getElementById('balanceMarket-endeVJ-detail').textContent, '2025', 'Marktkachel nennt das Vorjahr');
    assertEqual(doc.getElementById('balanceMarket-endeVJ_3-detail').textContent, '2022', 'VJ−3 nennt seine Jahreszahl');
    assert(doc.getElementById('balanceMarket-ath-detail').textContent.includes('0,2') && doc.getElementById('balanceMarket-cape-value').textContent.includes('2,0'), 'Zeit seit Hoch, CAPE und Inflation bleiben sichtbar');
    assert(!doc.getElementById('balanceGoldOff').hidden && doc.getElementById('balanceGoldBandFrame').dataset.goldActive === 'false', 'Ausgeschaltetes Gold zeigt Gold aus statt des Bandwerts');
    renderBalanceStrategyValues(doc, { ...input, goldAktiv: true }, 2025);
    assert(doc.getElementById('balanceGoldOff').hidden && doc.getElementById('balanceGoldBandFrame').dataset.goldActive === 'true', 'Aktives Gold zeigt den erhaltenen Bandwert');
} finally { P.resetPersistenceForTests(); }
