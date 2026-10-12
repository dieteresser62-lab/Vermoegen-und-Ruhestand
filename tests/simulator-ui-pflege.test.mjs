import { updatePflegeUIInfo } from '../app/simulator/simulator-ui-pflege.js';
import { bindHouseholdPlanField } from '../app/shared/household-plan-fields.js';
import { createSelectionDocument, addField } from './designsystem-selection-dom.mjs';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';

const previous = globalThis.document;
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
        assert(text.includes('<strong>90.000,00 €</strong>'), label + ': exakt 90.000,00 € Zusatzkosten-Cap');
        assert(text.includes('<strong>110.000,00 €</strong>'), label + ': Regionalzuschlag bleibt wirksam');
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
} finally {
    globalThis.document = previous;
    PersistenceFacade.resetPersistenceForTests();
}
