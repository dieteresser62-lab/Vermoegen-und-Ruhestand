import { renderProtocolTable, protocolActionExplanation } from '../app/simulator/protocol-renderer.js';
import { protocolWealthText, rowWealthText } from '../app/simulator/wealth-display.js';

// TD-4: Das ⓘ „Aufteilung des Vermögens“ rechnet wie die Bestandszelle; Geldvermögen ohne Immobilien.
const euro = text => Number(String(text).replace(/[^\d-]/g, ''));
const parts = text => [...String(text).matchAll(/([A-Za-zäöüÄÖÜ ]+?) (-?[\d.]+)\s€ \(/g)].map(([, label, amount]) => [label.trim(), euro(amount)]);
const homes = [{ wert: 100000, nutzung: 'selbst' }];
const backtestRow = { recordType: 'financial_year', financiallyEvaluable: true, inflation_factor_cum: 1.2,
    portfolio_total_end: 252000, wertAktien: 150000, wertGold: 30000, liquiditaet: 52000, bondBucketAfter: 20000,
    wertAktienEnthaeltAnleihen: true, immobilien_selbst_end: 126000, immobilien_vermietet_end: 0, immobilien_wert_end: 126000 };
const entry = { jahr: 2001, inflationVJ: 5, row: backtestRow };
const factor = 1.2 * 1.05;

for (const moneyBasis of ['real', 'nominal']) {
    const divisor = moneyBasis === 'real' ? factor : 1;
    const money = protocolWealthText(entry, { source: 'backtest', moneyBasis, withHomes: false });
    assert(!money.includes('—'), `${moneyBasis}: Backtest-ⓘ zeigt Beträge statt „—“`);
    const moneyParts = parts(money);
    assertEqual(JSON.stringify(moneyParts.map(([label]) => label)), JSON.stringify(['Tagesgeld', 'Aktien', 'Gold', 'Anleihen']),
        `${moneyBasis}: Geldvermögen-ⓘ nennt nur Geldteile`);
    const sum = moneyParts.reduce((total, [, amount]) => total + amount, 0);
    assert(Math.abs(sum - 252000 / divisor) <= 2, `${moneyBasis}: Teile ergeben den Zellenwert Geldvermögen (${sum})`);
    const withHomes = protocolWealthText(entry, { source: 'backtest', moneyBasis, withHomes: true });
    const homeParts = parts(withHomes);
    assert(homeParts.some(([label]) => label === 'Immobilien selbst genutzt'), `${moneyBasis}: Gesamt-ⓘ nennt Immobilien`);
    const homeSum = homeParts.reduce((total, [, amount]) => total + amount, 0);
    assert(Math.abs(homeSum - (252000 + 126000) / divisor) <= 3, `${moneyBasis}: Teile ergeben Geldvermögen plus Immobilien (${homeSum})`);
}

// Die gerenderte Tabelle verwendet dieselbe Rechnung und denselben Faktor wie die Zelle.
const html = renderProtocolTable([entry], { source: 'backtest', moneyBasis: 'real', inputs: { home: homes } });
assert(!html.includes('Tagesgeld — ()'), 'Gerenderte Realansicht zeigt keine leeren Teile mehr');
assert(html.includes(protocolWealthText(entry, { source: 'backtest', moneyBasis: 'real', withHomes: false }).split(' · ')[0]),
    'Gerendertes ⓘ enthält die Geldteile aus dem Zellenfaktor');
const realCell = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(252000 / factor);
assert(html.includes(realCell), 'Zelle Geldvermögen zeigt den realen Wert mit demselben Faktor');

// Monte Carlo führt die Inflation an der Zeile; das Ergebnis bleibt wie bisher.
const mcRow = { ...backtestRow, inflation: 5 };
assertEqual(protocolWealthText(mcRow, { source: 'mc', moneyBasis: 'real' }), rowWealthText(mcRow, 'real'), 'MC-Zeile unverändert');
assertEqual(protocolWealthText(mcRow, { source: 'mc', moneyBasis: 'nominal' }), rowWealthText(mcRow, 'nominal'), 'MC nominal unverändert');

// Zelle ohne Wert (Ruinzeile ohne Preisfaktor): kein ⓘ mit leeren Teilen.
const ruin = { jahr: 2002, inflationVJ: 5, row: { ...backtestRow, inflation_factor_cum: undefined } };
const ruinHtml = renderProtocolTable([ruin], { source: 'backtest', moneyBasis: 'real', inputs: { home: homes } });
assert(!ruinHtml.includes('Tagesgeld — ()'), 'Keine leere Aufteilung in Zeilen ohne Preisfaktor');

// Handlungstext Nichtverheiratete: Überschuss-Satz nur, wenn genau eine Person verkauft.
const payout = persons => ({ jahr: 2003, inflationVJ: 2, row: { ...backtestRow, inflation: undefined, aktionUndGrund: 'Verkauf für die Auszahlung',
    personalPayoutSales: persons.map(name => ({ profileId: name, name, share: 0.5, gross: 1000 })) } });
const one = protocolActionExplanation(payout(['Max']), { source: 'backtest' }), two = protocolActionExplanation(payout(['Max', 'Erika']), { source: 'backtest' });
assert(one.includes('Der Überschuss der anderen Person bleibt auf ihrem Tagesgeld, bis die App ihn nach ihren Regeln anlegt.'), 'Eine verkaufende Person: Satz zum Überschuss der anderen');
assert(two.includes('Nicht verheiratet') && !two.includes('Überschuss der anderen Person'), 'Beide verkaufen: kein Satz über einen Überschuss');
