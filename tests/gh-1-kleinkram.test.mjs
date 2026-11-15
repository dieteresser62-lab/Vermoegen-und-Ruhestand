// GH-1: Kleinkram aus dem Gutachten vom 13.11.2026 (Gemini Hydrogen). Nur synthetische Daten (Musterhaushalte, Testdatum 28.10.2026).
import { buildKeyParams } from '../app/balance/balance-diagnosis-keyparams.js';
import { buildBackupSummary, compareBackupSummaries, assertBackupSummary } from '../app/data/data-backup-summary.js';
import { backupChangesText } from '../app/data/data-renderer.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { projectOverviewFromRecords } from '../app/overview/overview-model.js';
import { pensionDetail } from '../app/overview/overview-renderer.js';
import { EngineAPI } from '../engine/index.mjs';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { planScope } from '../app/profile/household-plan.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { readStoredMonteCarloDuration, writeMonteCarloDurationMarker, MONTE_CARLO_DURATION_EXPLICIT_KEY } from '../app/simulator/monte-carlo-duration.js';
import { coverageAssumptions } from '../app/simulator/simulator-assumption-lines.js';
import { coveredByIncome, transactionBlockText, minimumFlexBlockText, minimumFlexStatusText, PENSION_SURPLUS_CUT_TEXT } from '../app/balance/balance-diagnosis-labels.js';

class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.className = ''; this.dataset = {}; this.textContent = ''; }
    append(...nodes) { nodes.forEach(node => { if (node) this.children.push(node); }); }
    appendChild(node) { this.children.push(node); return node; }
    setAttribute() {}
}
const flatten = node => !node ? '' : (node.textContent || '') + (node.children || []).map(flatten).join('');
const hadDocument = 'document' in globalThis, previousDocument = globalThis.document;
globalThis.document = { createElement: tag => new Node(tag) };

// Punkt 1 (F-01): Einkünfte decken den Bedarf (Martin und Petra: Entnahme 0, Grund covered_by_pension_surplus) → keine „100,0 %“.
{
    const surplus = { peakRealVermoegen: 700000, currentRealVermoegen: 700000, cumulativeInflationFactor: 1, kuerzungProzent: 100, jahresentnahme: 0,
        minimumFlexAnnual: 3000, minimumFlexStatus: 'not_needed', minimumFlexBlockReason: 'covered_by_pension_surplus',
        minimumFlexHouseholdFlexAnnual: 12000, minimumFlexPensionContributionAnnual: 12000 };
    const text = flatten(buildKeyParams(surplus));
    assert(text.includes(`Kürzung ggü. Flex-Bedarf${PENSION_SURPLUS_CUT_TEXT}`), 'Diagnose: „Kürzung ggü. Flex-Bedarf: keine – Einkünfte decken den Bedarf“');
    assert(!/100,0\s*%/.test(text), 'keine „100,0 %“ bei Überschuss');
    assert(text.includes('Nicht benötigt: Einkünfte decken den Bedarf') && !text.includes('covered_by_pension_surplus'), 'Mindest-Flex nennt den Grund deutsch');
    assert(coveredByIncome({ ...surplus, minimumFlexBlockReason: null }), 'Erkennung auch über Entnahme 0 bei Flex-Bedarf, den die Einkünfte tragen');
    assert(!coveredByIncome({ ...surplus, minimumFlexBlockReason: null, minimumFlexPensionContributionAnnual: 2000 }), 'Entnahme 0 ohne gedeckten Flex-Bedarf ist kein Überschuss');
    const cut = flatten(buildKeyParams({ ...surplus, minimumFlexBlockReason: null, jahresentnahme: 24000, kuerzungProzent: 25 }));
    assert(/Kürzung ggü\. Flex-Bedarf25,0\s*%/.test(cut), `echte Kürzung bleibt in Prozent (${cut.match(/Kürzung[^A-Z]*/)?.[0]})`);
    assertEqual(transactionBlockText('min_trade'), 'Unter Mindestgröße', 'bekannter Code deutsch');
    assertEqual(transactionBlockText('new_engine_code'), 'Sonstiger Grund', 'unbekannter Code: „Sonstiger Grund“ statt roh');
    assertEqual(transactionBlockText(null), 'Keine Blockade', 'ohne Code: keine Blockade');
    assertEqual(minimumFlexBlockText('no_open_depot_flex_need'), 'kein offener Flex-Bedarf aus dem Depot', 'Mindest-Flex-Grund deutsch');
    assertEqual(minimumFlexStatusText('irgendwas_neues'), 'Sonstiger Status', 'unbekannter Status nicht roh');
}
if (hadDocument) globalThis.document = previousDocument; else delete globalThis.document;

// Punkt 3: Satz zum Pflegefall getrennt nach „Geld reicht nicht“ und „Aktien und Gold aufgebraucht“ (26 Läufe mit Engpass, davon 8 gescheitert).
// VK-3c (Gemini Befund 2): Jede Zahl nennt ihre Grundmenge.
{
    const inputs = { rentAdjMode: 'cpi', pflegefallLogikAktivieren: true };
    const results = { extraKPI: { pflege: { household: { shortfallRateWithCarePct: 50, sampleSize: 40, shortfallRateWithoutCarePct: 10, noCareSampleSize: 60 } } } };
    assertEqual(coverageAssumptions(inputs, results, { failCount: 8 }).careShare,
        '26 Läufe mit Engpass, davon 20 mit Pflegefall. Von den 26 reicht in 8 das Geld nicht; in 18 sind Aktien und Gold aufgebraucht, Rente und Liquidität reichen aber noch.',
        'Satz trennt gescheiterte Läufe von aufgebrauchten Aktien und Gold');
    assert(coverageAssumptions(inputs, results).careShare.startsWith('Von 26 Läufen, in denen'), 'ohne Zahl der gescheiterten Läufe bleibt der bisherige Satz');
}

// Punkt 5 (F-06): „Seit der letzten Sicherung geändert“ erkennt Haushalts- und Planwerte; alte Zusammenfassungen (Version 1) bleiben lesbar.
{
    const time = '2026-10-01T12:00:00.000Z', now = '2026-10-28T12:00:00.000Z';
    const records = createMusterHaushaltRecords('2026-10-28', 'max-erika', 'grund');
    const basis = await buildBackupSummary(records, time);
    assertEqual(basis.version, 2, 'neue Zusammenfassung Version 2 mit Bereichen');
    const compare = async source => compareBackupSummaries(basis, await buildBackupSummary(source, now), time);
    assertEqual(JSON.stringify((await compare(records)).areas), JSON.stringify({ plan: 'unchanged', income: 'unchanged', partnership: 'unchanged', care: 'unchanged' }), 'ohne Änderung alles unverändert');
    const registry = JSON.parse(records.rs_profiles_v1), active = records.rs_current_profile;
    const other = Object.keys(registry.profiles).find(id => id !== active);
    const income = structuredClone(records); income.profile_rente_monatlich = '2400';
    assertEqual((await compare(income)).areas.income, 'changed', 'Einkünfte der aktiven Person geändert');
    const otherCare = structuredClone(records); const reg = JSON.parse(otherCare.rs_profiles_v1);
    reg.profiles[other].data.profile_care_grade_today = '2'; otherCare.rs_profiles_v1 = JSON.stringify(reg);
    assertEqual((await compare(otherCare)).areas.care, 'changed', 'Pflege der anderen Person geändert');
    const plan = structuredClone(records); const planRecord = JSON.parse(plan.household_plan_v1);
    for (const entry of Object.values(planRecord.entries)) entry.values.floorBedarf = Number(entry.values.floorBedarf) + 1000;
    plan.household_plan_v1 = JSON.stringify(planRecord);
    const planChanges = await compare(plan);
    assertEqual(`${planChanges.areas.plan} ${planChanges.areas.income}`, 'changed unchanged', 'Bedarf im Haushaltsplan geändert, Einkünfte nicht');
    assert(backupChangesText(planChanges).startsWith('Haushalt & Plan geändert. Geprüft:'), `Text nennt den Bereich (${backupChangesText(planChanges)})`);
    const old = { version: 1, exportedAt: basis.exportedAt, profiles: basis.profiles };
    assertEqual(assertBackupSummary(old), old, 'Version 1 bleibt gültig');
    const fromOld = compareBackupSummaries(old, await buildBackupSummary(records, now), time);
    assertEqual(fromOld.areas.plan, 'unknown', 'alte Basis: Bereiche unbekannt');
    assertEqual(backupChangesText(fromOld), 'Keine Änderungen in Monatsabschlüssen, Tagesgeld-Einträgen und Tranchen. Haushalt & Plan, Einkünfte, Partnerschaft und Erbe sowie Pflege: seit der letzten Sicherung nicht feststellbar.',
        'keine falsche Entwarnung bei alter Sicherung');
}

// Punkt 6: Übersicht, Rente vor Beginn (Musterhaushalt Max und Erika am 28.10.2026).
{
    const records = createMusterHaushaltRecords('2026-10-28', 'max-erika', 'grund');
    const registry = JSON.parse(records.rs_profiles_v1);
    const now = new Date('2026-10-28T12:00:00Z');
    const overview = projectOverviewFromRecords({ registry, activeId: records.rs_current_profile, liveData: records, now });
    const lines = overview.members.map(person => `${person.name}: ${pensionDetail(person, now)}`);
    const erika = overview.members.find(person => person.name === 'Erika');
    assert(/^Rente ab \d{2}\.\d{2}\.2027/.test(erika?.personDates?.pensionStatus || ''), `Erika: Rentenbeginn in der Zukunft (${erika?.personDates?.pensionStatus})`);
    assert(lines.some(line => /^Erika: [\d.]+\s€ Rente ab \d{2}\/\d{4}$/.test(line)), `Erika: „… € Rente ab MM/JJJJ“ (${lines.join(' | ')})`);
    assert(lines.some(line => /^Max: [\d.]+\s€ Rente \/ Monat$/.test(line)), 'Max: laufende Rente als Monatsbetrag');
}

// Punkt 8 (F-02): Fehlt der Gold-Mindestanteil bei aktivem Gold, setzt die Normalisierung 0 statt NaN (Max und Erika, Balance 2026).
{
    setAppTestDate('2026-10-28');
    const records = createMusterHaushaltRecords('2026-10-28', 'max-erika', 'grund');
    const registry = JSON.parse(records.rs_profiles_v1);
    const calc = buildBalanceEngineInputFromStorage({ storage: { getItem: key => records[key] ?? null }, scope: planScope('household', Object.keys(registry.profiles)), referenceYear: 2026 });
    const input = { ...calc.engineInput, goldAktiv: true, goldZielProzent: 5 };
    delete input.goldFloorProzent;
    const result = EngineAPI.simulateSingleYear(input, calc.engineLastState);
    const minGold = result.diagnosis?.transactionDiagnostics?.goldThresholds?.minGoldReserve;
    assert(!result.error, `aktives Gold ohne Gold-Floor rechnet ohne Fehler (${result.error?.message || ''})`);
    assertEqual(minGold, 0, 'Gold-Mindestreserve 0 statt NaN');
    const set = EngineAPI.simulateSingleYear({ ...input, goldFloorProzent: 2 }, calc.engineLastState);
    assert(set.diagnosis?.transactionDiagnostics?.goldThresholds?.minGoldReserve > 0, 'gesetzter Gold-Floor bleibt wirksam');
}

// Punkt 11: „35 Jahre“ nach dem Neuladen. Alte gespeicherte 35 ohne Markierung bleibt automatisch; eine bewusst eingetragene 35 bleibt stehen.
{
    assertEqual(readStoredMonteCarloDuration('35'), '', 'alte Vorgabe 35 ohne Markierung: automatisch');
    assertEqual(readStoredMonteCarloDuration('35', true), '35', 'bewusst eingetragene 35 bleibt');
    const data = {};
    const storage = { setItem: (key, value) => { data[key] = String(value); }, removeItem: key => { delete data[key]; } };
    writeMonteCarloDurationMarker(storage, '35');
    assertEqual(data[MONTE_CARLO_DURATION_EXPLICIT_KEY], 'true', 'Eintrag 35 setzt die Markierung');
    writeMonteCarloDurationMarker(storage, '');
    assert(!(MONTE_CARLO_DURATION_EXPLICIT_KEY in data), 'leeres Feld (automatisch) entfernt die Markierung');
    assert(MONTE_CARLO_DURATION_EXPLICIT_KEY.startsWith('sim_'), 'Markierung ist eine Simulator-Einstellung (wandert mit Sicherung und Profilwechsel)');
}
