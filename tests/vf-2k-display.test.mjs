import { readFileSync } from 'node:fs';
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { EngineAPI } from '../engine/index.mjs';
import { protocolActionExplanation, protocolActionShortText, renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { projectScenarioLogV2, serializeScenarioLogExportV2, serializeScenarioLogCsvV2 } from '../app/simulator/monte-carlo-export.js';
import { displayTradeAmount } from '../app/shared/transaction-display-text.js';

const plain = text => text.replaceAll('\u00a0', ' ');
const inputs = await measurementInputs(0, 'jan-lena', '2026-10-23');
const parameters = { anzahl: 2000, maxDauer: 35, blockSize: 5, seed: 12345,
    methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
const logs = new Map();
for (const run of [1648, 65, 135, 46]) {
    const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: parameters,
        widowOptions: inputs.widowOptions, useCapeSampling: false,
        runRange: { start: run, count: 1 }, logIndices: [run] });
    assertEqual(chunk.technicalInventory.technicalError, 0, `Lauf ${run}: echte Musterrechnung ohne technischen Fehler`);
    logs.set(run, chunk.runMeta[0].logDataRows);
}
// FR-67 verändert die späteren Pfade; diese synthetischen Anzeige-Belege
// stammen bytegleich aus dem Ausgangsstand und behalten die Rundungsfälle.
const { p25, buffer, cents, both } = JSON.parse(readFileSync(new URL('./fixtures/vf-2k-display-rows.json', import.meta.url)));
assertEqual(2025 + p25.jahr, 2042, 'P25-Beleg ist das Kalenderjahr 2042');
assert(p25.vk.vkAkt > 0 && p25.vk.vkAkt < .005 && buffer.vk.vkAkt > 0 && buffer.vk.vkAkt < .005,
    'Beide eingefrorenen Goldverkaufszeilen enthalten den beobachteten Aktien-Rundungsrest');
assert(both, 'Beleg aus Lauf 135 enthält einen echten Verkauf von Aktien und Gold');
assert(cents.vk.vkAkt >= .005 && cents.vk.vkAkt < .01, 'Beleg aus Lauf 46 enthält einen echten Aktienverkauf von rund einem Cent');
const bytes = JSON.stringify([...logs]);
const exports = () => [...logs.values()].flatMap(rows => {
    const projected = projectScenarioLogV2(rows);
    return [serializeScenarioLogExportV2(projected), serializeScenarioLogCsvV2(projected)];
});
const exportBytes = JSON.stringify(exports());

for (const source of ['mc', 'backtest']) for (const moneyBasis of ['nominal', 'real']) {
    const entry = row => source === 'mc' ? row : { jahr: 2025 + row.jahr, row, inflationVJ: row.inflation };
    const options = { source, moneyBasis, strategyMode: 'standard' };
    const money = (amount, row) => {
        const factor = moneyBasis === 'nominal' ? 1 : row.inflation_factor_cum * (source === 'backtest' ? 1 + row.inflation / 100 : 1);
        return `${Math.round(amount / factor).toLocaleString('de-DE')} €`;
    };
    const p25Text = plain(protocolActionShortText(entry(p25), options));
    assertEqual(p25Text, `Gold verkauft ${money(20400, p25)} · davon ${money(10400, p25)} für die Entnahme dieses Jahres`,
        `${source}/${moneyBasis}: P25 ohne Aktien-Nullverkauf und ohne insgesamt`);
    const bufferText = plain(protocolActionShortText(entry(buffer), options));
    assertEqual(bufferText, `Gold verkauft ${money(13800, buffer)} · davon ${money(3800, buffer)} für die Entnahme dieses Jahres`,
        `${source}/${moneyBasis}: Lauf 65 nennt nur den echten Goldverkauf`);
    assertEqual(plain(protocolActionExplanation(entry(buffer), options)),
        `Tagesgeld bis zum Mindestpuffer aufgefüllt (aus Gold) / Zusätzlich für die Entnahme verkauft: ${money(3800, buffer)}`,
        `${source}/${moneyBasis}: Herkunft steht direkt beim Puffer-Satz`);
    const bothText = plain(protocolActionShortText(entry(both), options));
    assert(bothText.includes(`Aktien verkauft ${money(both.vk.vkAkt, both)}`)
        && bothText.includes(`Gold verkauft ${money(both.vk.vkGld, both)}`) && bothText.includes('davon insgesamt'),
    `${source}/${moneyBasis}: insgesamt bleibt bei zwei tatsächlich verkauften Anlageklassen`);
    const bothInfo = plain(protocolActionExplanation(entry(both), options));
    assert(bothInfo.startsWith('Tagesgeld bis zum Mindestpuffer aufgefüllt (aus Aktien und Gold) / Zusätzlich für die Entnahme verkauft:'),
        `${source}/${moneyBasis}: beide echten Quellen stehen beim Puffer`);
    assert(bothInfo.endsWith('€/Jahr)'), 'Herkunft hängt nicht hinter der Flex-Obergrenze');
    const centsText = plain(protocolActionShortText(entry(cents), options));
    assert(centsText.startsWith('Aktien verkauft < 1 € · Gold verkauft') && centsText.includes('davon insgesamt'),
        `${source}/${moneyBasis}: echte Centverkäufe bleiben sichtbar, ohne als null zu erscheinen`);
    for (const row of [p25, buffer, both]) {
        const table = plain(renderProtocolTable([entry(row)], options));
        assert(table.includes(plain(protocolActionShortText(entry(row), options))), 'Tabellenzelle verwendet den korrigierten Text');
        assert(table.includes(plain(protocolActionExplanation(entry(row), options))), 'Handlungs-Info verwendet die korrigierte Herkunft');
    }
}

for (const amount of [0, 1e-11, .004999, -.004999, .005, -.005, NaN, Infinity, undefined]) {
    assertEqual(displayTradeAmount(amount), Number.isFinite(amount) && Math.abs(amount) >= .005 ? amount : 0,
        `Anzeigegrenze von einem halben Cent: ${amount}`);
}
for (const field of ['vkAkt', 'vkBnd', 'vkGld', 'executedSaleAkt', 'executedSaleEq']) {
    const row = { ...buffer, vk: { vkGes: 13800, vkGld: 13800 }, executedSaleEq: 0 };
    if (field.startsWith('vk')) row.vk[field] = 1e-11;
    else row[field] = 1e-11;
    if (field === 'vkGld') row.vk = { vkGes: 13800, vkAkt: 13800, vkGld: 1e-11 };
    const actualClass = field === 'vkGld' ? 'Aktien' : 'Gold';
    assertEqual(plain(protocolActionShortText(row)), `${actualClass} verkauft 13.800 € · davon 3.800 € für die Entnahme dieses Jahres`,
        `${field}: auch Ersatzfelder und Anleihenreste erzeugen keinen Nullverkauf`);
    assert(protocolActionExplanation(row).startsWith(`Tagesgeld bis zum Mindestpuffer aufgefüllt (aus ${actualClass}) /`),
        `${field}: Herkunft ignoriert denselben Rundungsrest`);
}
const netRow = { ...buffer, vk: { vkAkt: 13800 + 1e-11, vkGld: 13800 }, kaufAkt: 13800,
    bondRefillNet: 1e-11, bondRefillGross: 1e-11 };
const threeBuckets = { strategyMode: '3_bucket_jilge' };
assertEqual(plain(protocolActionShortText(netRow, threeBuckets)), 'Gold verkaufen 13.800 €', 'Abgeleiteter Aktiensaldo unter einem halben Cent entfällt');
assert(!protocolActionExplanation(netRow, threeBuckets).includes('Anleihentopf'), 'Rundungsrest behauptet keine Anleihenauffüllung');
const bondRemainder = { ...netRow, vk: { vkBnd: 13800 }, executedSaleEq: 13800 + 1e-11, kaufAkt: 0, bondRefillGross: 0 };
assertEqual(plain(protocolActionShortText(bondRemainder)), 'Anleihen verkauft 13.800 €', 'Aktienanteil aus Gesamtverkauf minus Anleihen ignoriert Rundungsreste');
const personalNet = { ...netRow, threeBucketTrades: [
    { profile: 'Max', label: 'Aktien', net: 1e-11 }, { profile: 'Max', label: 'Gold', net: 13800 }
] };
assertEqual(plain(protocolActionShortText(personalNet, threeBuckets)), 'Max: Gold verkaufen 13.800 €', 'Personensaldo lässt Aktien-Rundungsrest aus');
assert(protocolActionExplanation(personalNet, threeBuckets).endsWith('Saldo je Person: Max: Gold verkaufen 13.800\u00a0€'), 'Auch die Info lässt den Personen-Nullverkauf aus');
const empty = { ...buffer, vk: { vkGes: 1e-11, vkAkt: 1e-11, vkBnd: 1e-11, vkGld: 1e-11 }, executedSaleAkt: 1e-11, executedSaleEq: 1e-11 };
assertEqual(protocolActionShortText(empty), 'Kein Handel ausgeführt; Ausgaben aus dem Tagesgeld', 'Nur Rundungsreste gelten nicht als ausgeführte Auffüllung');
assertEqual(JSON.stringify([...logs]), bytes, 'Alle Ergebnisbytes der echten Läufe bleiben nach sämtlichen Anzeigen unverändert');
assertEqual(JSON.stringify(exports()), exportBytes, 'Szenario-CSV und -JSON bleiben bytegleich');
