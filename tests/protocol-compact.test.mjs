import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { renderWorstRunLog } from '../app/simulator/simulator-results.js';
import { getProtocolColumns, formatProtocolValue, readProtocolValue } from '../app/simulator/protocol-columns.js';
import { buildAccessibleBacktestTableHtml } from '../app/simulator/historical-backtest-ui.js';
import { projectScenarioLogV2, serializeScenarioLogCsvV2 } from '../app/simulator/monte-carlo-export.js';
import { tokenizeHTML, matchesSelector } from './funktionsinventar-contract.mjs';
import { bindInfoPopovers } from '../app/shared/designsystem-info-popover.js';
const raw = { recordType: 'financial_year', financiallyEvaluable: true, jahr: 1, jahresentnahme_real: 6000, inflation_factor_cum: 1, inflation: 0,
    entscheidung: { jahresEntnahme: 6000 }, Regime: 'bear_deep', portfolio_total_end: 100000,
    aktionUndGrund: 'BÄR (S) (Kein Handlungsbedarf) / Ein vollständiger Grund <sicher>',
    vk: { vkGes: 0 }, kaufAkt: 0 };
const original = JSON.stringify(raw);
const select = (tree, selector) => tree.elements.filter(node => matchesSelector({ elements: [node] }, selector));
const cell = (html, name) => [...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)]
    .find(match => match[0].includes(`protocol-${name}`))?.[0] || '';
for (const view of ['scenario', 'backtest', 'comparison', 'replay']) for (const logDetailLevel of ['normal', 'detailed']) {
    const source = view === 'backtest' ? 'backtest' : 'mc';
    const entry = source === 'mc' ? raw : { jahr: 2000, entscheidung: raw.entscheidung, row: raw };
    const options = { source, logDetailLevel, caRThreshold: 10000 };
    const html = view === 'backtest' ? buildAccessibleBacktestTableHtml([entry], getProtocolColumns(options),
        (column, row) => formatProtocolValue(column, readProtocolValue(column, row, options), row, options), options)
        : view === 'scenario' ? renderProtocolTable([entry], options) : renderWorstRunLog([entry], 10000, options);
    const withdrawal = cell(html, 'withdrawal'), action = cell(html, 'action');
    assertEqual(withdrawal.includes('protocol-low-withdrawal'), logDetailLevel === 'detailed', `${view}: Betrag erhält Akzentklasse`);
    assertEqual(withdrawal.includes('Niedrige Entnahme: Reale Entnahme unter dem 10-%-Wert'), logDetailLevel === 'detailed', `${view}: Info erklärt niedrigen Betrag`);
    assert(!withdrawal.includes('protocol-chip'), `${view}: kein breites Hinweisfeld`);
    assert(action.includes('>Kein Handlungsbedarf<span'), `${view}: nur Kurzhandlung vor Info`);
    assert(!action.split('<span class="ds-info">')[0].includes('Bär'), `${view}: Marktphase nicht in der Kurzhandlung`);
    assert(action.includes('Tiefer Bär (Stagflation)') && action.includes('Ein vollständiger Grund &lt;sicher&gt;'), `${view}: Info enthält bisherige vollständige Begründung`);
    const tree = tokenizeHTML(html);
    assertEqual(select(tree, 'td.protocol-withdrawal .ds-info-button').length, logDetailLevel === 'detailed' ? 1 : 0, `${view}: Info gehört zur Betragszelle`);
    assertEqual(select(tree, 'td.protocol-action .ds-info-pop').length, 1, `${view}: vollständige Begründung im gemeinsamen Info-Baustein`);
}
for (const [patch, expected] of [
    [{ kaufAkt: 40000 }, 'Aktien kaufen 40.000'],
    [{ vk: { vkGes: 30000 }, executedSaleEq: 30000 }, 'Aktien verkauft 30.000'],
    [{ vk: { vkGes: 10000 }, aktionUndGrund: 'BÄR / Verkauf für die Auszahlung 10000 €' }, 'Verkauft 10.000']
]) {
    const html = renderProtocolTable([{ ...raw, ...patch }]);
    assert(cell(html, 'action').includes(expected), 'Kurzhandlung nennt Transaktion und Betrag');
}
for (const source of ['mc', 'backtest']) for (const moneyBasis of ['real', 'nominal']) {
    // Backtest rechnet Geldflüsse zum Jahresende um, MC zum Jahresanfang.
    const year = { ...raw, inflation_factor_cum: source === 'backtest' ? 1 : 1.1,
        vk: { vkGes: 110000, vkAkt: 110000 }, kaufAkt: 0,
        aktionUndGrund: 'BÄR / Verkauf 110000.00 € / Ziel 110.000 € / Reserve 11.000,00 € / 10 % / 12 Monate' };
    const entry = source === 'mc' ? year : { jahr: 2000, row: year, netA: 110000, inflationVJ: 10 };
    const bytes = JSON.stringify(entry), options = { source, moneyBasis };
    const html = renderProtocolTable([entry], options), action = cell(html, 'action');
    const amount = moneyBasis === 'real' ? '100.000' : '110.000';
    const full = action.split('role="tooltip">')[1];
    assert(action.split('<span class="ds-info">')[0].includes(`>Aktien verkauft ${amount}\u00a0€`), `${source}/${moneyBasis}: Kurzhandlung folgt der Euro-Basis`);
    assert(full.includes(moneyBasis === 'real' ? 'Verkauf 100.000\u00a0€' : 'Verkauf 110.000\u00a0€'), `${source}/${moneyBasis}: vollständige Begründung folgt der Euro-Basis`);
    assert(full.includes(moneyBasis === 'real' ? 'Reserve 10.000\u00a0€' : 'Reserve 11.000\u00a0€'), 'Deutsche Dezimal- und Tausenderzeichen werden erkannt');
    assert(full.includes('10 % / 12 Monate'), 'Prozentwerte und Monate bleiben unverändert');
    assert(html.includes(`verkauft ${amount}\u00a0€`), `${source}/${moneyBasis}: Aktienhandel und Handlung zeigen denselben Betrag`);
    const legacy = { ...year, vk: undefined, aktionUndGrund: 'BÄR (Verkauf 110000.00 €) / vollständiger Grund' };
    assert(cell(renderProtocolTable([source === 'mc' ? legacy : { ...entry, row: legacy }], options), 'action').split('<span class="ds-info">')[0]
        .includes(moneyBasis === 'real' ? 'Verkauf 100.000\u00a0€' : 'Verkauf 110.000\u00a0€'), 'Auch ältere Logs ohne strukturierte Trades folgen der Euro-Basis');
    const sale = { ...year, immobilienverkauf: 792000, immobilienverkauf_jahr: 2000, kaufAkt: 110000, vk: { vkGes: 0 } };
    const saleHtml = renderProtocolTable([source === 'mc' ? sale : { ...entry, row: sale }], { ...options, logDetailLevel: 'detailed' });
    assert(cell(saleHtml, 'action').includes(`>Immobilienverkauf ${moneyBasis === 'real' ? '720.000' : '792.000'}\u00a0€ · Aktien kaufen ${amount}\u00a0€`), 'Handlung nennt den Immobilienverkauf zuerst, in derselben Euro-Basis');
    if (source === 'mc') assert(saleHtml.includes('data-protocol-column="home-sale"'), 'Eigene Spalte Immobilienverkauf bleibt erhalten');
    assertEqual(JSON.stringify(entry), bytes, 'Euro-Umrechnung mutiert keine Jahresdaten');
    assert(serializeScenarioLogCsvV2(projectScenarioLogV2([year])).includes(year.aktionUndGrund), 'CSV behält Kontowerte und vollständigen Originaltext');
}
for (const partnership of [undefined, { status: 'married' }, { status: 'unmarried' }]) {
    const html = renderProtocolTable([{ ...raw, abgang_erben: 0, erbschaftsteuer: 0 }], { inputs: { partnership } });
    assert(html.includes('Erbschaftsteuer: vereinfachte Rechnung'), 'Steuerspalte hat ein erklärendes Info-Popover');
    assertEqual(html.includes('Ehejahre davor zählen nicht, daher kann die echte Steuer bei langer Ehe niedriger oder höher sein.'),
        partnership?.status !== 'unmarried', 'Ehepartner-Hinweis erscheint auch ohne gespeicherte Partnerschaft');
}
assertEqual(JSON.stringify(raw), original, 'Anzeige mutiert keine Rohdaten');
const exported = projectScenarioLogV2([raw]);
assert(JSON.stringify(exported).includes('Ein vollständiger Grund <sicher>'), 'JSON erhält die volle Begründung');
assert(serializeScenarioLogCsvV2(exported).includes(raw.aktionUndGrund), 'CSV erhält die volle Begründung');
// Gemeinsamer Binder auf den tatsächlich erzeugten Info-Knoten, ohne Browser.
const tree = tokenizeHTML(renderProtocolTable([raw], { caRThreshold: 10000 }));
const doc = { activeElement: null, querySelectorAll: selector => select(tree, selector), addEventListener() {} };
for (const node of tree.elements) {
    node.dataset = {}; node.events = {};
    node.setAttribute = (name, value) => { node.attrs[name] = String(value); };
    node.getAttribute = name => node.attrs[name] ?? null;
    node.addEventListener = (name, callback) => { node.events[name] = callback; };
    node.querySelector = selector => select(tree, selector).find(candidate => node.contains(candidate));
    node.contains = candidate => candidate === node || node.children.some(child => child.contains(candidate));
    node.focus = () => { doc.activeElement = node; };
}
bindInfoPopovers(doc);
for (const host of doc.querySelectorAll('.ds-info')) {
    const button = host.querySelector('.ds-info-button');
    host.events.mouseenter(); assertEqual(host.dataset.visible, 'true', 'Hover öffnet Info');
    host.events.mouseleave(); assertEqual(host.dataset.visible, 'false', 'Verlassen schließt Info');
    host.events.focusin(); assertEqual(host.dataset.visible, 'true', 'Fokus öffnet Info');
    button.events.click(); host.events.mouseleave(); assertEqual(host.dataset.visible, 'true', 'Antippen hält Info offen');
    host.events.keydown({ key: 'Escape', preventDefault() {} }); assertEqual(host.dataset.visible, 'false', 'Escape schließt Info');
}
