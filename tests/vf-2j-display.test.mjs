import { readFileSync } from 'node:fs';
import { protocolActionExplanation, protocolActionShortText, renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { translateProtocolText } from '../app/simulator/protocol-columns.js';
import { displayDiagnosisText } from '../app/balance/balance-diagnosis-transaction.js';
import { projectScenarioLogV2, serializeScenarioLogExportV2, serializeScenarioLogCsvV2 } from '../app/simulator/monte-carlo-export.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { projectHouseholdPlanComparison } from '../app/profile/household-plan-comparison.js';
import { projectBalanceActionOrigin } from '../app/balance/balance-action-origin.js';
import { SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import { summarizeBalanceAction } from '../app/balance/balance-action-summary.js';
import { evaluateAnnualDraft } from '../app/balance/balance-annual-storage-commit.js';
import { projectBalanceFlexTrace } from '../app/balance/balance-flex-trace.js';
import { calculateFinalWithdrawal } from '../engine/planners/spending-policy-helpers.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';

// Unveränderte Jahreszeilen aus echten Läufen mit synthetischen Musterbeständen.
const witness = JSON.parse(readFileSync(new URL('./fixtures/vf-2j-display-rows.json', import.meta.url)));
const plain = text => text.replaceAll('\u00a0', ' ');
const euro = value => `${Math.round(value).toLocaleString('de-DE')} €`;
const rowBytes = JSON.stringify(witness);
const exportRows = [witness.mixedRefill, witness.buffer, witness.noTrade, ...witness.ruinRows, witness.refillPayout, witness.payoutWithoutRefill];
const exports = () => {
    const log = projectScenarioLogV2(exportRows);
    return [serializeScenarioLogExportV2(log), serializeScenarioLogCsvV2(log)];
};
const exportBytes = exports();
for (const source of ['mc', 'backtest']) for (const moneyBasis of ['nominal', 'real']) {
    const entry = row => source === 'mc' ? row : { jahr: row.jahr, row, inflationVJ: row.inflation };
    const opts = { source, moneyBasis, strategyMode: '3_bucket_jilge' };
    const factor = row => moneyBasis === 'nominal' ? 1 : row.inflation_factor_cum * (source === 'backtest' ? 1 + row.inflation / 100 : 1);
    const money = (amount, row) => euro(amount / factor(row));
    const mixed = plain(protocolActionExplanation(entry(witness.mixedRefill), opts));
    assert(mixed.includes(`Anleihentopf aufgefüllt: ${money(70000, witness.mixedRefill)} aus dem Tagesgeld (Immobilienerlös), ${money(witness.mixedRefill.bondRefillGross - witness.mixedRefill.bondRefillTax, witness.mixedRefill)} aus Aktien`),
        `${source}/${moneyBasis}: echte Mischauffüllung nennt beide Nettoquellen`);
    assert(!mixed.includes('Anleihentopf aus Aktien aufgefüllt'), 'Mischauffüllung behauptet keine ausschließliche Aktienquelle');
    const buffer = plain(protocolActionExplanation(entry(witness.buffer), opts));
    assert(buffer.includes('Tagesgeld bis zum Mindestpuffer aufgefüllt') && buffer.includes('aus Anleihen, Aktien geschont'), 'Echter Pufferverkauf nennt Quelle und geschonte Aktien');
    assert(!buffer.includes('Notfall'), 'Pufferauffüllung heißt nicht Notfall');
    assertEqual(buffer.split(money(witness.buffer.vk.vkBnd, witness.buffer)).length - 1, 1, 'Eine Anlageklasse nennt den Verkaufsbetrag nur im Personensaldo');
    const noTrade = plain(protocolActionShortText(entry(witness.noTrade), opts));
    assertEqual(noTrade, 'Kein Verkauf möglich: Depot leer, Ausgaben aus dem Tagesgeld', 'Leeres Depot meldet keine nicht ausgeführte Umschichtung');
    assertEqual(plain(protocolActionExplanation(entry(witness.noTrade), opts)), noTrade, 'Auch das Info behauptet keinen ausgeführten Handel');
    const filled = plain(protocolActionExplanation(entry(witness.refillPayout), opts));
    assert(filled.includes('Zusätzlich für die Entnahme verkauft:'), 'Echter Auffüllteil rechtfertigt Zusätzlich');
    const onlyPayout = plain(protocolActionExplanation(entry(witness.payoutWithoutRefill), { ...opts, strategyMode: 'standard' }));
    assert(onlyPayout.includes('Für die Entnahme verkauft:') && !onlyPayout.includes('Zusätzlich'), 'Echte Helga/Werner-Laufzeile ohne Auffüllteil sagt Für die Entnahme verkauft');
    // Derselbe Verkauf als reine Entnahme: keine weitere Auffüllung in diesem Jahr.
    const payoutOnly = { ...witness.refillPayout, aktionUndGrund: `Verkauf für die Auszahlung ${witness.refillPayout.vk.vkGes} €` };
    const payoutText = plain(protocolActionExplanation(entry(payoutOnly), opts));
    assert(payoutText.startsWith('Für die Entnahme verkauft') && !payoutText.includes('Zusätzlich'), 'Reine Entnahme trägt keine zusätzliche Auffüllung vor');
    const cashOnly = { ...witness.mixedRefill, bondRefillGross: 0, bondRefillTax: 0, vk: { vkGes: 0 },
        threeBucketTrades: witness.mixedRefill.threeBucketTrades.filter(trade => trade.key === 'bonds') };
    const cashInfo = plain(protocolActionExplanation(entry(cashOnly), opts));
    assertEqual(cashInfo.split(money(cashOnly.bondRefillNet, cashOnly)).length - 1, 1, 'Auch ein reiner Anleihenkauf nennt den Betrag nur einmal');
    const both = { ...payoutOnly, vk: { ...payoutOnly.vk, vkAkt: 10000, vkGld: payoutOnly.vk.vkGes - 10000 }, threeBucketTrades: undefined };
    const bothText = plain(protocolActionShortText(entry(both), { ...opts, strategyMode: 'standard' }));
    assert(bothText.includes('Aktien verkauft') && bothText.includes('Gold verkauft') && bothText.includes('davon insgesamt'), 'Entnahmeanteil bezieht sich eindeutig auf Aktien und Gold zusammen');
}
for (const title of ['Notfall-Verkauf (Puffer-Auffüllung)', 'Notfall-Verkauf (Puffer-Sicherung)']) {
    assertEqual(displayDiagnosisText(title), translateProtocolText(title), 'Balance und Simulator übersetzen Puffer-Titel gleich');
    assert(!translateProtocolText(title).includes('Notfall'), 'Auch Puffersicherung vermeidet Notfall');
}
const ruin = witness.ruinRows.at(-1), previous = witness.ruinRows[0];
const amounts = ruin.ruin_reason.match(/\((-?\d+)\).*\((\d+)\)/).slice(1).map(Number);
for (const moneyBasis of ['nominal', 'real']) {
    const factor = moneyBasis === 'real' ? previous.inflation_factor_cum * (1 + previous.inflation / 100) : 1;
    const options = { moneyBasis, rows: witness.ruinRows };
    const expected = `Ruin: Geldvermögen ${euro(amounts[0] / factor)} reicht nicht für den Grundbedarf von ${euro(amounts[1] / factor)}`;
    assertEqual(plain(protocolActionShortText(ruin, options)), expected, 'Echte Ruinzeile folgt der gewählten Eurobasis, auch ohne eigenen Preisfaktor');
    assertEqual(plain(protocolActionExplanation(ruin, options)), expected, 'Ruin-Info nennt dieselben formatierten Beträge');
    assert(renderProtocolTable(witness.ruinRows, options).includes('reicht nicht für den Grundbedarf'), 'Auch die echte Tabellenprojektion nutzt den Ruingrund');
    assert(plain(renderProtocolTable(witness.ruinRows, { moneyBasis })).includes(expected), 'Tabellenrenderer stellt den Preisfaktor ohne eigens übergebene rows bereit');
}
const today = { ...ruin, jahr: 1 };
assert(!protocolActionShortText(today, { moneyBasis: 'real' }).includes('unbekannt'), 'Ruin im ersten Jahr hat Preisfaktor 1');

const records = createMusterHaushaltRecords('2026-10-23', 'martin-petra');
const record = Object.values(JSON.parse(records.annual_plan_record_v1).entries)[0];
const registry = JSON.parse(records.rs_profiles_v1);
const people = Object.entries(registry.profiles).map(([id, person]) => ({ id, name: person.meta.name }));
assert(record.adopted.action.quellen.every(source => source.sourceProfileName === registry.profiles[source.sourceProfileId].meta.name), 'Musterbeleg speichert Namen und vorhandene Personenkennungen');
const draft = { records, planningYear: 2026, scope: record.scope, values: record.adopted.snapshot.plan, ageByPerson: record.adopted.snapshot.ageByPerson };
const real = evaluateAnnualDraft(draft, { engineApi: EngineAPI });
assert(real.outcome.action.quellen.every(source => source.sourceProfileId && !source.sourceProfileName), 'Echte Paarrechnung kann Tagesgeldquellen mit Kennung ohne Namen liefern');
const summary = summarizeBalanceAction(real.outcome.action, real.outcome.action,
    real.runs.map(run => ({ name: run.name, action: run.ui.action })));
assert(summary.note.includes('von Martin und Petra') && !summary.note.includes('Profil'), 'Vorläufige Empfehlung nennt die tatsächlichen Haushaltsnamen');
for (const legacy of [false, true]) {
    const copy = structuredClone(records);
    if (legacy) {
        const old = JSON.parse(copy.annual_plan_record_v1);
        for (const item of Object.values(old.entries)) for (const outcome of [item.recommended, item.adopted])
            for (const source of outcome.action.quellen) delete source.sourceProfileName;
        copy.annual_plan_record_v1 = JSON.stringify(old);
    }
    const storage = { getItem: key => copy[key] ?? null };
    const comparison = projectHouseholdPlanComparison({ year: 2026, scope: record.scope, storage });
    const origin = projectBalanceActionOrigin({ comparison, year: 2026, scope: record.scope });
    const bytes = JSON.stringify(origin), { doc } = createDialogFixture(), host = doc.createElement('div');
    host.replaceChildren = (...children) => { host.children.length = 0; host.append(...children); };
    const renderer = new SummaryRenderer({ outputs: { balanceAnnualAction: host } });
    renderer.renderAnnualAction(origin, people);
    // WT-1: Die Karte zeigt den Kauf; Details & Drucken nennt je Person, woher das Geld kommt (seit WT-1b auf den Cent).
    const text = plain(renderer.planDetails.text);
    assert(text.includes('Martin | aus dem Tagesgeld') && text.includes('100.000,00 €') && text.includes('Petra | aus dem Tagesgeld') && text.includes('22.000,00 €') && !text.includes('nicht zugeordnet'),
        legacy ? 'Balance löst auch echte alte Paarbelege mit vorhandenen Kennungen auf' : 'Balance nennt beide Namen beim Muster-Jahresplan');
    assertEqual(JSON.stringify(origin), bytes, 'Zuordnung in der Anzeige verändert keine gespeicherte Handlung');
}

// Nebenbeobachtung: Die Entnahmerechnung rundet tatsächlich ab; keine bloße Anzeigerundung.
const flexRecords = createMusterHaushaltRecords('2026-10-23', 'helga-werner');
const flexRegistry = JSON.parse(flexRecords.rs_profiles_v1);
flexRegistry.profiles.muster_werner.data.profile_rente_monatlich = '1949.2';
flexRecords.rs_profiles_v1 = JSON.stringify(flexRegistry);
const flexRecord = Object.values(JSON.parse(flexRecords.annual_plan_record_v1).entries)[0];
const evaluated = evaluateAnnualDraft({ records: flexRecords, planningYear: 2026, scope: flexRecord.scope,
    values: flexRecord.adopted.snapshot.plan, ageByPerson: flexRecord.adopted.snapshot.ageByPerson }, { engineApi: EngineAPI });
const flex = projectBalanceFlexTrace({ ...evaluated.modelResult.ui, input: evaluated.inputData });
assert(Math.abs(flex.cut - .8) < 1e-7 && Math.abs(flex.householdFlexRate - 99.92) < 1e-7, 'Echte Helga/Werner-Rechnung liefert den beobachteten Hinweis 99,9 % / 1 Euro');
const netNeed = { floor: (3000 - flex.income) * 12, flex: 12000 };
assertEqual(calculateFinalWithdrawal(netNeed, 100).endgueltigeEntnahme / 12, flex.withdrawal, 'Ursache ist die bestehende Entnahmequantisierung auf 1150 Euro');
assert(Math.abs(calculateFinalWithdrawal(netNeed, 100, false).endgueltigeEntnahme / 12 - flex.withdrawal - .8) < 1e-7, 'Ohne Rechenrundung wäre die tatsächliche Entnahme 80 Cent höher');
assertEqual(JSON.stringify(witness), rowBytes, 'Sämtliche echten Laufzeilen bleiben unverändert');
assertEqual(JSON.stringify(exports()), JSON.stringify(exportBytes), 'Szenario-CSV und -JSON bleiben nach allen Anzeigeprojektionen bytegleich');
