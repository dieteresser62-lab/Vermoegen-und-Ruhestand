import {
    PFLEGE_COST_PRESETS, applyPflegeKostenPreset, updatePflegePresetHint, updatePflegeUIInfo
} from '../app/simulator/simulator-ui-pflege.js';
import { bindHouseholdPlanField } from '../app/shared/household-plan-fields.js';
import { createSelectionDocument, addField } from './designsystem-selection-dom.mjs';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';

const previous = globalThis.document;
// Festgeschriebenes Destatis-Workbook 22421-01: I34:I38 / C34:C38.
// Unabhängige Quellenkonstanten; kein Workbook-Lesen im Test oder in der App.
const careStocks = [[4344, 785822], [132378, 2300753], [297955, 1686286], [248626, 669263], [114191, 244252]];
const annualHomeShare = 3364 * 12; // vdek 01.07.2026, Eigenanteil im ersten Heimjahr.
assertEqual(annualHomeShare, 40368, 'Heim-Eigenanteil wird zum Jahresbetrag');
careStocks.forEach(([inHome, total], index) => {
    const expected = Math.round((inHome / total) * annualHomeShare / 100) * 100;
    assertEqual(PFLEGE_COST_PRESETS.amtlich.values[index + 1], expected, `PG${index + 1}: Heimanteil × Jahrespreis auf 100 € gerundet`);
});
const records = { household_plan_v1: 'synthetische unveränderte Planbytes', annual_plan_record_v1: 'synthetische Belegbytes' };
let writes = 0;
try {
    PersistenceFacade.resetPersistenceForTests({ name: 'Pflegehinweis lesend', async init() {},
        async loadAll() { return { ...records }; }, async saveBatch() { writes++; } });
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const doc = createSelectionDocument(); globalThis.document = doc;
    const floor = addField(doc, 'startFloorBedarf', '30000');
    addField(doc, 'pflegeMaxFloor', '120000');
    addField(doc, 'pflegeRegionalZuschlag', '10');
    addField(doc, 'pflegeStufe5Zusatz', '100000');
    const badge = addField(doc, 'pflegeInfoBadge');
    const check = label => {
        updatePflegeUIInfo();
        const text = badge.innerHTML.replaceAll('\u00a0', ' ');
        assert(text.includes('<strong>90.000 €</strong>'), label + ': 90.000 € Zusatzkosten-Cap ohne Cent');
        assert(text.includes('<strong>110.000 €</strong>'), label + ': Regionalzuschlag bleibt wirksam, Anzeige ohne Cent');
    };
    check('Ungebundener Legacy-Floor');
    const binding = bindHouseholdPlanField({ doc, field: floor, row: floor.parentNode, path: 'floorBedarf' });
    binding.project(30000);
    check('Formatierter gebundener Floor');
    floor.selectionStart = floor.selectionEnd = 0;
    floor.setSelectionRange = (start, end) => { floor.selectionStart = start; floor.selectionEnd = end; };
    floor.dispatchEvent({ type: 'focus' });
    assertEqual(floor.value, '30000', 'Fokus zeigt reine Zahl');
    check('Gebundener Floor im Fokus');
    floor.dispatchEvent({ type: 'blur' }); check('Gebundener Floor nach Blur');
    await PersistenceFacade.flush();
    assertEqual(writes, 0, 'Hinweislesen schreibt keine Daten');
    assertEqual(JSON.stringify(await PersistenceFacade.readPersistedRecords()), JSON.stringify(records), 'Plan- und Belegbytes unverändert');
    binding.dispose();

    const costs = [], factors = [];
    let inputEvents = 0;
    for (let grade = 1; grade <= 5; grade++) {
        const cost = doc.getElementById(`pflegeStufe${grade}Zusatz`) || addField(doc, `pflegeStufe${grade}Zusatz`, '123');
        cost.addEventListener('input', () => inputEvents++);
        costs.push(cost);
        factors.push(addField(doc, `pflegeStufe${grade}FlexCut`, String(grade * 10)));
        factors.push(addField(doc, `pflegeStufe${grade}Mortality`, String(grade + .5)));
    }
    const factorValues = factors.map(field => field.value).join('/');
    const regional = doc.getElementById('pflegeRegionalZuschlag');
    applyPflegeKostenPreset('amtlich');
    assertEqual(costs.map(field => Number(field.value)).join('/'), '200/2300/7100/15000/18900', 'Neue Staffel erreicht alle Jahresfelder');
    assertEqual(inputEvents, 5, 'Alle Kostenfelder melden Änderungen an ihre bestehenden Listener');
    assertEqual(factors.map(field => field.value).join('/'), factorValues, 'Flex und Sterblichkeit bleiben erhalten');
    assertEqual(regional.value, '10', 'Regionalzuschlag bleibt erhalten');
    const hint = addField(doc, 'pflegeStaffelPresetHint');
    updatePflegePresetHint({ value: 'amtlich' }, hint);
    assert(hint.textContent.includes('Pflege zu Hause ohne Zuzahlung angenommen'), 'Hinweis nennt die Annahme zur Pflege zu Hause');
    assert(hint.textContent.includes('40.400 €'), 'Hinweis grenzt den Preis eines Heimplatzes ab');
    applyPflegeKostenPreset('custom');
    assertEqual(costs.map(field => Number(field.value)).join('/'), '200/2300/7100/15000/18900', 'Individuelle Werte erhält die übernommenen Beträge');
    applyPflegeKostenPreset('ambulant');
    assertEqual(costs.map(field => Number(field.value)).join('/'), '36000/42000/54000/66000/78000', 'Ambulante Staffel bleibt erhalten');
    applyPflegeKostenPreset('stationaer');
    assertEqual(costs.map(field => Number(field.value)).join('/'), '45000/60000/75000/90000/105000', 'Stationäre Staffel bleibt erhalten');
} finally {
    globalThis.document = previous;
    PersistenceFacade.resetPersistenceForTests();
}
