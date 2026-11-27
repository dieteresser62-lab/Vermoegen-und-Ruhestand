// NK-3 Soll 2 (Schutztest, Nachtrag der Steuerung Punkt 1): Trägt der Staat die Pflege ganz, ändert sie das Liquiditätsziel des
// Jahresabschlusses nicht (J1, NK-2d). Das gilt mit und ohne neue feste Ausgabe im Folgejahr. J1-Haushalt: Grundbedarf 12.000 €, Helga trägt
// mit 60.000 € Tagesgeld, Werner Grad 3 zu Hause ohne Geld und Einkünfte; feste Ausgabe ab Januar 2027 1.000 €/Monat. Erfundene Beträge.
// Gemessen am 16.11.2026: Ziel in allen vier Fällen 60.000 €. Ob feste Ausgaben des Folgejahres das Ziel allgemein erhöhen sollen, ist eine
// eigene Fachfrage und nicht Teil von NK-3.
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { PROFILE_TRANCHES_KEY } from '../app/profile/profile-state.js';
import { PLANNED_EXPENSES_KEY } from '../app/profile/household-planned-expenses.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
setAppTestDate('2026-11-15');

const target = (care, fixedFrom) => {
    const { records, scope } = pfa2Records({ care: [null, care], unmarried: true, cash: [60000, 0], plan: { floorBedarf: 12000, householdWithdrawalMode: `one_carries:${IDS[0]}` } });
    const registry = JSON.parse(records.rs_profiles_v1);
    registry.profiles[IDS[1]].data[PROFILE_TRANCHES_KEY] = '[]';
    records.rs_profiles_v1 = JSON.stringify(registry);
    if (records.rs_current_profile === IDS[1]) records[PROFILE_TRANCHES_KEY] = '[]';
    if (fixedFrom) records[PLANNED_EXPENSES_KEY] = JSON.stringify({ version: 1, entries: { [scope.key]: { scope, items: [
        { id: 'fest', bezeichnung: 'Feste Ausgabe', betragMonat: 1000, ab: fixedFrom, bis: null, anpassung: 'keine' }] } } });
    const calculation = buildBalanceEngineInputFromStorage({ storage: countingStorage(records).storage, scope, referenceYear: 2026 });
    return { aid: calculation.inputData.careAid?.total || 0, target: EngineAPI.simulateSingleYear(calculation.engineInput, calculation.engineLastState).ui.zielLiquiditaet };
};
const care = { grade: 3, form: 'home-support' };

// Die feste Ausgabe wird gelesen: Beginnt sie schon im Planjahr, steigt das Ziel.
assert(target(null, '2026-01').target > 60000, 'Folgejahr: feste Ausgabe im Planjahr erhöht das Ziel (Eingabe wirkt)');
// Ohne feste Ausgabe: 60.000 € mit und ohne Pflege.
{
    const without = target(null, null), withCare = target(care, null);
    assertEqual(`${withCare.aid} · ${withCare.target} · ${without.target}`, '18000 · 60000 · 60000', 'Ohne feste Ausgabe: Ziel 60.000 €, Pflege trägt der Staat');
}
// Mit fester Ausgabe ab Januar 2027: Ziel mit voll staatlich getragener Pflege gleich dem Ziel ohne Pflege.
{
    const without = target(null, '2027-01'), withCare = target(care, '2027-01');
    assertEqual(`${withCare.aid} · ${withCare.target}`, `18000 · ${without.target}`, 'Mit fester Ausgabe im Folgejahr: Ziel wie ohne Pflege');
    assertEqual(without.target, 60000, 'Mit fester Ausgabe im Folgejahr: gemessenes Ziel 60.000 €');
}
