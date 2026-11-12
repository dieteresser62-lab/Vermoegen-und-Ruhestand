// TJ-1/TJ-2 (FR-48/51): Im Todesjahr entscheidet die Engine Kauf und Auffüllung mit dem, was nach dem Nachlass
// bei der überlebenden Person bleibt; gekauft und verkauft wird nur aus ihren Beständen. 100 % bleibt unverändert.
import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixture } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { deathYearCashShare, deathYearCashLimit, deathYearTransactionView } from '../app/simulator/simulator-death-year-cash.js';

// Sollfall wörtlich: Person 1 hat 300.000 €, Person 2 350.000 € Liquidität. Aus eigener Liquidität
// zahlen sie 100.000 − 15.000 € und 40.000 − 5.000 €; die Engine will den Überschuss über 450.000 € anlegen.
{
    const portfolio = { personAccounts: [{ profileId: 'p1', tagesgeld: 300000, geldmarktEtf: 0 },
        { profileId: 'p2', tagesgeld: 350000, geldmarktEtf: 0 }] };
    const transition = { deathThisYear: true, survivor: { deceasedProfileId: 'p2', survivorProfileId: 'p1' } };
    const limit = (partnership, requested = 650000 - 450000) => deathYearCashLimit({ portfolio, transition, requested,
        share: deathYearCashShare({ inputs: { partnership, partner: { aktiv: true }, simulationPeople: [{}, {}] },
            transition, hasLifeEvents: true }),
        bookings: () => [{ profileId: 'p1', amount: 100000 - 15000 }, { profileId: 'p2', amount: 40000 - 5000 }] });
    const none = limit({ status: 'unmarried', inheritance: { p2: 0 } });
    assertEqual(none.capacity, 0, 'Sollfall 0 %: 300.000 € liegen unter 450.000 €, Person 1 legt nichts an');
    assertEqual(none.reserves.find(row => row.profileId === 'p2').amount, 350000,
        'Sollfall 0 %: Liquidität der verstorbenen Person steht für Käufe nicht bereit');
    const half = limit({ status: 'unmarried', inheritance: { p2: 50 } });
    assertClose(half.capacity, 300000 + .5 * 315000 - 450000, 1e-6,
        'Gegenprobe 50 %: höchstens 7.500 € über dem Ziel, verfügbar sind 457.500 €');
    assertEqual(half.survivorProfileId, 'p1', 'Gegenprobe 50 %: Käufe belasten nur die überlebende Person');
    assertEqual(limit({ status: 'unmarried', inheritance: { p2: 100 } }), null, 'Unverheiratet 100 %: Haushaltssicht wie bisher');
    assertEqual(limit({ status: 'married' }), null, 'Verheiratet mit Vorgabe 100 %: Haushaltssicht wie bisher');
    assertEqual(limit(undefined), null, 'Ohne Partnerschaftsangabe gilt wie im Nachlass die Vorgabe für Verheiratete');
    assertEqual(limit({ status: 'unmarried', inheritance: { p2: 0 } }, 0), null, 'Ohne Anlage aus Liquidität keine Änderung');
    // TJ-2: dieselbe Sicht für die Auffüllentscheidung der Engine.
    const view = (p1, p2, share) => deathYearTransactionView({ transition, share, householdLiquidity: p1 + p2,
        inputs: {}, bookings: () => [{ profileId: 'p1', amount: 100000 - 15000 }, { profileId: 'p2', amount: 40000 - 5000 }],
        portfolio: { personAccounts: [{ profileId: 'p1', tagesgeld: p1, geldmarktEtf: 0 }, { profileId: 'p2', tagesgeld: p2, geldmarktEtf: 0 }],
            depotTranchesAktien: [], depotTranchesGold: [], depotTranchesGeldmarkt: [] } });
    assertEqual(view(300000, 350000, 0).engineView.aktuelleLiquiditaet, 300000, 'TJ-1-Sollfall 0 %: die Engine sieht 300.000 €');
    assertEqual(view(300000, 350000, .5).engineView.aktuelleLiquiditaet, 457500, 'TJ-1-Gegenprobe 50 %: die Engine sieht 457.500 €');
    assertEqual(view(50000, 600000, 0).engineView.aktuelleLiquiditaet, 50000, 'TJ-2-Sollfall: für Person 1 zählen 50.000 €');
    assertEqual(view(50000, 600000, 1), null, 'Erbanteil 100 %: keine eigene Sicht');
}

// Dieselben Bestände im echten Jahreslauf: Person 2 stirbt; Zinsen und Inflation 0.
const NO_PURCHASE = 'Kein Kauf im Sterbejahr: freie Liquidität gehört zum Nachlass';
const LIMITED = 'Kauf im Sterbejahr auf die eigene Liquidität begrenzt';
function deathYear(status, percent, { saving = false, threeBucket = false, legacy = false, p1Cash = 300000,
    p2Cash = 350000, costBasis = 2000000, deceased = 'muster_b', rendite = 0, engine = EngineAPI, p2Stock = 0 } = {}) {
    const lot = (profileId, marketValue, cost) => ({ schemaVersion: 2, trancheId: `${profileId}:welt`, sourceProfileId: profileId,
        type: 'aktien_neu', category: 'equity', marketValue, costBasis: cost, shares: marketValue / 100,
        purchasePrice: 100 * cost / marketValue, currentPrice: 100, purchaseDate: '2020-01-01', tqf: 0, taxExempt: false });
    // Optional hält auch Person 2 Aktien, ohne Kursgewinn und damit steuerlich günstiger (Codex TJ12, Befund 1).
    const lots = [lot('muster_a', 2000000, costBasis), ...(p2Stock ? [lot('muster_b', p2Stock, p2Stock)] : [])];
    const inputs = { ...structuredClone(fixture), dynamicFlex: false, goldAktiv: false,
        startFloorBedarf: 90000, startFlexBedarf: 30000, floorBedarf: 90000, flexBedarf: 30000, minimumFlexAnnual: 0,
        survivorFloorPercent: 100, survivorFlexPercent: 100, survivorMinimumFlexPercent: 100, liquidityRunwayYears: 4.5,
        renteMonatlich: 1250, renteStartOffsetJahre: 0, renteStartMonate: 12, rentAdjPct: 0,
        partner: { ...structuredClone(fixture.partner), monatsrente: 10000 / 12, brutto: 10000, startInJahren: 0, renteStartMonate: 12 },
        partnership: { schemaVersion: 1, status, inheritance: { [deceased]: percent }, marriedInheritance: { [deceased]: percent } },
        tagesgeld: p1Cash + p2Cash, geldmarktEtf: 0, depotwertAlt: 0, depotwertNeu: 2000000 + p2Stock, einstandAlt: 0,
        einstandNeu: costBasis + p2Stock, startVermoegen: 2000000 + p2Stock + p1Cash + p2Cash, detailledTranches: lots };
    inputs.simulationPeople[0].tagesgeld = p1Cash;
    inputs.simulationPeople[1].tagesgeld = p2Cash;
    for (const person of inputs.simulationPeople) {
        person.liquidityRunwayYears = 4.5;
        // Altformat ohne persönliche Pauschbeträge: kein persönliches Steuerbuch, keine erfundenen Freibeträge.
        if (legacy) delete person.sparerPauschbetrag;
    }
    if (saving) Object.assign(inputs, { accumulationPhase: { enabled: true, sparrate: 0 }, transitionYear: 5 });
    if (threeBucket) Object.assign(inputs, { mode: '3_bucket_jilge', decumulation: { ...inputs.decumulation, mode: '3_bucket_jilge' } });
    const household = deceased === 'muster_b' ? { p1Alive: true, p2Alive: false } : { p1Alive: false, p2Alive: true };
    const year = { jahr: 2000, inflation: 0, rendite, gold_eur_perf: 0, zinssatz: 0, lohn: 0 };
    const result = simulateOneYear(initMcRunState(inputs), inputs, year, 0, null, 0, household, 1, engine);
    const label = `${status} ${percent} %${saving ? ' Ansparjahr' : ''}${threeBucket ? ' Drei-Töpfe' : ''}${legacy ? ' Altformat' : ''}`
        + `${deceased === 'muster_a' ? ' Person 1 stirbt' : ''}${p1Cash !== 300000 ? ` Person 1 ${p1Cash / 1000}k` : ''}${rendite ? ' Bär' : ''}`
        + `${p2Stock ? ' Person 2 mit Aktien' : ''}`;
    assertEqual(result.kind, 'success', `${label}: Todesjahr rechnet`);
    const log = result.logData;
    const paid = profileId => log.personalPayout?.items.find(row => row.profileId === profileId)?.amount || 0;
    assertClose(log.portfolio_flow_delta, 0, .03, `${label}: Jahresbilanz vollständig erklärt`);
    assert(log.personAccounts.every(account => account.tagesgeld >= 0), `${label}: kein Konto negativ`);
    return { log, label, action: result.ui?.action, p1: paid('muster_a'), p2: paid('muster_b'),
        survivorCash: log.personAccounts[0].tagesgeld, bonds: log.balance_trace?.at(-1).bonds };
}
const sold = action => (action.quellen || []).filter(source => source.kind !== 'liquiditaet');
function purchaseLog({ log, label, action }, text, invested, requested) {
    assertEqual(log.aktionUndGrund.split(' / ')[0], text, `${label}: Protokoll nennt den tatsächlichen Kauf`);
    if (!invested) assertEqual(action.type, 'NONE', `${label}: Aktion ohne Handlung`);
    assertEqual(action.details.kaufAkt, invested, `${label}: Aktionsbetrag ist der angelegte Betrag`);
    assertEqual(action.diagnosisEntries.find(entry => entry.step === 'Surplus Rebalancing').impact,
        `${text}. Angelegt ${invested}€ von ${requested}€ Überschuss.`, `${label}: Diagnose nennt angelegt und geplant`);
}

{
    // TJ-1-Sollfall: 300.000 € liegen unter dem Ziel. Kein Kauf; die bestehende Auffüllregel füllt aus Aktien von Person 1 (TJ-2).
    const { log, label, action, p1, p2, survivorCash } = deathYear('unmarried', 0);
    assert(log.zielLiquiditaet > 300000 && log.zielLiquiditaet < 650000, `${label}: Ziel liegt zwischen eigener und Haushaltsliquidität`);
    assertEqual(log.rente1 + log.rente2, 20000, `${label}: Einkünfte 15.000 € und im Todesjahr 5.000 €`);
    assertEqual(log.kaufAkt, 0, `${label}: kein Kauf aus der Liquidität, die den Haushalt verlässt`);
    assertEqual(log.vk.vkGes, 160000, `${label}: Auffüllung aus Aktien`);
    assert(sold(action).every(source => source.sourceProfileId === 'muster_a'), `${label}: nur Person 1 verkauft`);
    assertClose(survivorCash, 300000 + 160000 + 15000 - p1, .01, `${label}: Person 1 behält eigene Liquidität samt Auffüllung`);
    assertClose(log.abgang_erben, 350000 + 5000 - p2, .01, `${label}: Liquidität von Person 2 nach ihren Buchungen verlässt den Haushalt`);
    assertEqual(log.tax_funding_sale_gross || 0, 0, `${label}: kein Verkauf beim Nachlass`);
}
{
    // Für Person 1 zählen 469.839,62 €, der eigene Überschuss über dem Ziel liegt unter dem Mindesthandel.
    const { log, label, p1, p2, survivorCash } = deathYear('unmarried', 50);
    const inherited = .5 * (350000 + 5000 - p2);
    assertClose(300000 + inherited - log.zielLiquiditaet, 19739.62, .01, `${label}: eigener Überschuss über dem Ziel`);
    assertEqual(log.kaufAkt, 0, `${label}: unter dem Mindesthandel kein Kauf`);
    assertEqual(log.aktionUndGrund, 'ATH (Kein Handlungsbedarf)', `${label}: Protokoll ohne Handlung`);
    assertClose(log.abgang_erben, inherited, .01, `${label}: die andere Hälfte verlässt den Haushalt`);
    assertClose(log.vk.vkGes, log.erbschaftsteuer, .01, `${label}: einziger Verkauf zahlt die Erbschaftsteuer (FR-54)`);
    assertClose(survivorCash, 300000 + 15000 - p1 + inherited, .01, `${label}: Person 1 behält ihre Liquidität und erbt die Hälfte`);
}
{
    // Mehr eigene Liquidität: Die Engine kauft aus dem eigenen Überschuss, abgerundet und nur von Person 1.
    const { log, label, action, p2 } = deathYear('unmarried', 50, { p1Cash: 400000 });
    const surplus = 400000 + .5 * (350000 + 5000 - p2) - log.zielLiquiditaet;
    assertEqual(log.kaufAkt, 120000, `${label}: Kauf aus dem eigenen Überschuss`);
    assert(log.kaufAkt <= surplus && log.kaufAkt >= 25000, `${label}: Kauf zwischen Mindesthandel und eigenem Überschuss`);
    assert(action.quellen.every(source => source.sourceProfileId === 'muster_a'), `${label}: nur Person 1 zahlt`);
}
{
    // Geerbt werden 90 %, das Geld kommt aber erst mit dem Nachlass: Kauf nur aus eigener freier Liquidität.
    const none = deathYear('unmarried', 90, { p1Cash: 50000, p2Cash: 600000 });
    assertEqual(none.log.kaufAkt, 0, `${none.label}: ohne freie eigene Liquidität kein Kauf`);
    purchaseLog(none, NO_PURCHASE, 0, 120000);
    const limited = deathYear('unmarried', 90, { p1Cash: 150000, p2Cash: 600000 });
    assertEqual(limited.log.kaufAkt, 70000, `${limited.label}: Kauf auf eigene freie Liquidität begrenzt und abgerundet`);
    purchaseLog(limited, LIMITED, 70000, 200000);
}
for (const status of ['married', 'unmarried']) {
    // Werte des Ausgangsstands 0b8dda5d: Haushaltssicht mit vollem Überschuss.
    const { log, label } = deathYear(status, 100);
    assertEqual(log.kaufAkt, 190000, `${label}: Kauf wie bisher`);
    assertEqual(log.liqEnd, 364000, `${label}: Liquidität am Jahresende wie bisher`);
    assertEqual(log.abgang_erben, 0, `${label}: nichts verlässt den Haushalt`);
}
for (const legacy of [false, true]) {
    const married = deathYear('married', 0, { legacy });
    assertEqual(married.log.kaufAkt, 0, `${married.label}: FR-51 gilt auch für Verheiratete mit eingestelltem Anteil`);
    assertEqual(married.log.vk.vkGes, 160000, `${married.label}: Auffüllung aus Aktien`);
    assertClose(married.survivorCash, 300000 + 160000 - married.p1, .01, `${married.label}: Person 1 behält ihre Liquidität samt Auffüllung`);
    assertClose(married.log.abgang_erben, 350000 - married.p2, .01, `${married.label}: Liquidität von Person 2 verlässt den Haushalt`);
    if (!legacy) continue;
    const unmarried = deathYear('unmarried', 0, { legacy });
    assertEqual(unmarried.log.kaufAkt, 0, `${unmarried.label}: Grenze gilt ohne persönliche Steuerbücher`);
    assertClose(unmarried.survivorCash, 300000 + 160000 + 15000 - unmarried.p1, .01, `${unmarried.label}: Person 1 behält eigene Liquidität samt Auffüllung`);
}
for (const legacy of [false, true]) {
    // Person 1 stirbt, die Überlebende steht in der Cashreihenfolge hinten: Kauf trotzdem nur von ihr.
    const { log, label, action } = deathYear('unmarried', 0, { legacy, p2Cash: 600000, deceased: 'muster_a' });
    assertEqual(log.kaufAkt, 130000, `${label}: Kauf aus eigenem Überschuss`);
    assert(action.quellen.every(source => source.sourceProfileId === 'muster_b'), `${label}: nur die Überlebende zahlt`);
    assertEqual(log.wertAktien, 130000, `${label}: gekauftes Los gehört der Überlebenden`);
}
{
    const { log, label, survivorCash } = deathYear('unmarried', 0, { saving: true });
    assertEqual(log.kaufAkt, 0, `${label}: auch im Ansparjahr kein Kauf aus fremder Liquidität`);
    assertEqual(survivorCash, 300000, `${label}: Person 1 behält ihre Liquidität`);
    assertEqual(log.abgang_erben, 350000, `${label}: Liquidität von Person 2 verlässt den Haushalt`);
}
// TJ-2-Sollfall: Person 1 hat 50.000 €, Person 2 600.000 €. Für Person 1 zählen 50.000 €; die bestehende
// Runway-Notfüllung hebt auf 75 % des Ziels an und ist auf 10 % des Aktienbestands begrenzt (200.000 €).
for (const status of ['unmarried', 'married']) {
    const { log, label, action, p1, p2, survivorCash } = deathYear(status, 0, { p1Cash: 50000, p2Cash: 600000 });
    assertEqual(log.vk.vkGes, 200000, `${label}: Auffüllung nach der bestehenden Notfüllregel`);
    assert(sold(action).every(source => source.sourceProfileId === 'muster_a'), `${label}: nur Person 1 verkauft`);
    assertClose(survivorCash, 50000 + 200000 + (status === 'unmarried' ? 15000 : 0) - p1, .01, `${label}: Person 1 endet mit eigener Reserve`);
    assertClose(log.abgang_erben, 600000 + (status === 'unmarried' ? 5000 : 0) - p2, .01, `${label}: Nachlass verlässt den Haushalt`);
    assertEqual(log.personalPayoutSales, undefined, `${label}: kein Verkauf für die eigene Auszahlung`);
    assertEqual(log.tax_funding_sale_gross || 0, 0, `${label}: kein Notverkauf beim Nachlass`);
}
// Spiegeltest: Die Entscheidung im Todesjahr ist die der Engine für einen Haushalt, der nur die Sicht der
// überlebenden Person besitzt (Liquidität, die an die Erben geht, und ihre Bestände gibt es dort nicht).
// Verglichen wird auch die endgültige Aktion nach der persönlichen Zuordnung und ihre Ausführung (TJ-2b).
for (const [options, label] of [[{ p1Cash: 50000, p2Cash: 600000 }, 'Notfüllung'], [{}, 'Auffüllung'],
    [{ p1Cash: 400000, percent: 50 }, 'Kauf'], [{ p1Cash: 50000, p2Cash: 600000, rendite: -.3 }, 'Bär mit Notfüllung'],
    [{ p1Cash: 350000, p2Cash: 600000, rendite: -.3 }, 'Bär mit Sperre'], [{ p1Cash: 50000, p2Cash: 600000, threeBucket: true }, 'Drei Töpfe'],
    [{ p1Cash: 50000, p2Cash: 600000, p2Stock: 1000000, costBasis: 1000000 }, 'Nachlass mit günstigerem Aktienlos'],
    [{ p1Cash: 50000, p2Cash: 600000, p2Stock: 1000000, costBasis: 1000000, status: 'married' }, 'Nachlasslos verheiratet'],
    [{ p1Cash: 50000, p2Cash: 600000, p2Stock: 1000000, costBasis: 1000000, threeBucket: true }, 'Nachlasslos Drei Töpfe']]) {
    const calls = [];
    const engine = { ...EngineAPI, simulateSingleYear(input, lastState) {
        const result = EngineAPI.simulateSingleYear(input, lastState);
        calls.push({ input: structuredClone(input), lastState: structuredClone(lastState), result });
        return result;
    } };
    const { action: final, log } = deathYear(options.status || 'unmarried', options.percent ?? 0, { ...options, engine });
    const { input: { transactionView, ...household }, lastState, result } = calls.at(-1);
    assert(transactionView, `Spiegeltest ${label}: Todesjahr mit eigener Sicht`);
    if (!options.p2Stock) {
        // Ohne Depot der verstorbenen Person ändert die Sicht die Ausgabenplanung nicht: Ein eigener Engine-Lauf mit
        // nur dieser Sicht entscheidet genauso. (Mit Nachlassdepot sinkt dort das Vermögen und damit die Flex-Rate.)
        const mirror = EngineAPI.simulateSingleYear({ ...household, ...transactionView }, lastState);
        const decided = spending => [spending.monatlicheEntnahme, spending.details.flexRate, spending.details.endgueltigeEntnahme];
        assertEqual(JSON.stringify(decided(mirror.ui.spending)), JSON.stringify(decided(result.ui.spending)), `Spiegeltest ${label}: gleiche beschlossene Entnahme`);
        assertEqual(JSON.stringify(mirror.ui.action), JSON.stringify(result.ui.action), `Spiegeltest ${label}: gleiche Engine-Entscheidung`);
    }
    const planned = result.ui.action;
    const ownLots = new Set(transactionView.detailledTranches.map(lot => lot.trancheId));
    const sales = (final.quellen || []).filter(source => source.kind !== 'liquiditaet');
    assert(sales.every(source => source.sourceProfileId === 'muster_a' && ownLots.has(source.trancheId)),
        `Spiegeltest ${label}: nach der Zuordnung nur Lose der überlebenden Person`);
    assert((final.quellen || []).every(source => source.sourceProfileId === 'muster_a'), `Spiegeltest ${label}: nach der Zuordnung zahlt nur sie`);
    assertClose(final.verwendungen.liquiditaet || 0, planned.verwendungen.liquiditaet || 0, .01,
        `Spiegeltest ${label}: Auffüllung nach der Zuordnung wie entschieden`);
    if (!options.threeBucket) {
        assertClose(final.verwendungen.aktien || 0, planned.verwendungen.aktien || 0, .01, `Spiegeltest ${label}: Kauf nach der Zuordnung wie entschieden`);
        assertEqual([...new Set(sales.map(source => source.trancheId))].join(), [...new Set((planned.quellen || [])
            .filter(source => source.kind !== 'liquiditaet').map(source => source.trancheId))].join(), `Spiegeltest ${label}: dieselben Lose wie entschieden`);
    }
    const phase = name => log.balance_trace.find(row => row.phase === name);
    const executed = phase('after_returns').equity + phase('after_returns').bonds
        - phase('after_action_sales').equity - phase('after_action_sales').bonds;
    assertClose(executed, sales.reduce((total, source) => total + source.brutto, 0), .01, `Spiegeltest ${label}: Ausführung folgt der Zuordnung`);
}
// Codex TJ12, Befund 1: Beide besitzen Aktien, das Los von Person 2 ist steuerlich günstiger. Verkauft wird trotzdem
// nur aus Person 1s Depot; ihre Reserve kommt an, das Nachlasslos geht unverkauft an die Erben.
for (const [status, threeBucket, sale, cash] of [['unmarried', false, 230077.75, 198164.38], ['married', false, 230077.75, 151000],
    ['unmarried', true, 800272.14, 198164.38], ['married', true, 800272.14, 151000]]) {
    const { log, label, action, survivorCash } = deathYear(status, 0, { p1Cash: 50000, p2Cash: 600000, p2Stock: 1000000,
        costBasis: 1000000, threeBucket });
    assert(sold(action).every(source => source.sourceProfileId === 'muster_a'), `${label}: endgültige Verkaufsquellen nur von Person 1`);
    assertClose(log.vk.vkGes, sale, .01, `${label}: Verkauf aus Person 1s Aktien`);
    assertClose(survivorCash, cash, .01, `${label}: Reserve kommt bei Person 1 an`);
    assertEqual(log.personalPayoutSales, undefined, `${label}: kein Verkauf für die eigene Auszahlung`);
    assertClose(log.abgang_erben, (status === 'unmarried' ? 1552835.62 : 1600000), .01, `${label}: Nachlass samt Aktien unverkauft an die Erben`);
}
{
    // Codex TJ12, Befund 2: Überschuss 26.000 € über Mindesthandel 25.000 €; die eigene Liquidität trägt den Auftrag.
    const { log, label, action } = deathYear('married', 0, { p1Cash: 476100 });
    assertEqual(log.kaufAkt, 25000, `${label}: Kauf wie in der Standardengine`);
    assertEqual(log.aktionUndGrund, 'Profilverbund-Transaktionen / Rebal.(A+)', `${label}: kein Nachlasshinweis ohne Kürzung`);
    assert(action.quellen.every(source => source.sourceProfileId === 'muster_a'), `${label}: Kauf von Person 1`);
}
{
    // Bärenmarkt: Notfüllung nur bis 75 % des Ziels; darüber greift die bestehende Sperre wie ohne Todesfall.
    const filled = deathYear('unmarried', 0, { p1Cash: 50000, p2Cash: 600000, rendite: -.3 });
    assertEqual(filled.log.vk.vkGes, 90000, `${filled.label}: Notfüllung auch im Bärenmarkt`);
    const blocked = deathYear('unmarried', 0, { p1Cash: 350000, p2Cash: 600000, rendite: -.3 });
    assertEqual(blocked.log.vk.vkGes, 0, `${blocked.label}: Sperre im Bärenmarkt, kein Verkauf`);
    assertEqual(blocked.log.aktionUndGrund, 'BÄR (Kein Handlungsbedarf)', `${blocked.label}: Protokoll ohne Handlung`);
}
// Drei Töpfe mit 50 % Kursgewinn: Die bestehende Auffüllregel füllt Liquidität und Anleihenziel (5 × 96.000 €) aus Aktien
// der überlebenden Person; Verheiratete wie Unverheiratete verkaufen und versteuern gleich.
for (const [status, percent, sale, tax, bonds, cash] of [
    ['unmarried', 0, 743219.58, 97748.33, 480000, 379792], ['married', 0, 743219.58, 97748.33, 480000, 369471.25],
    ['unmarried', 50, 597563.84, 72611.95, 435048.11, 384160.38], ['married', 50, 552611.95, 72611.95, 480000, 379000]]) {
    const { log, label, survivorCash, bonds: bondsEnd } = deathYear(status, percent, { threeBucket: true, costBasis: 1000000 });
    assertEqual(log.kaufAkt, 0, `${label}: kein Kauf aus Liquidität`);
    assertClose(bondsEnd, bonds, .01, `${label}: Anleihenbestand nach Auffüllung${percent ? ' und Erbschaftsteuer' : ''}`);
    assertClose(log.vk.vkGes, sale, .01, `${label}: Verkauf für die Auffüllung${percent && status === 'unmarried' ? ' und die Erbschaftsteuer' : ''}`);
    assertClose(log.steuern_gesamt, tax, .01, `${label}: Kapitalertragsteuer auf den Aktienverkauf`);
    assertClose(survivorCash, cash, .01, `${label}: Liquidität der überlebenden Person`);
}
{
    // TJ-2c (Codex TJ2B F1): Im Todesjahr gilt die bestehende FR-16-Zahlungsfolge unverändert. Die Steuer von P1 auf
    // 1.000 € Geldmarktgewinn zahlt die Haushaltsliquidität vor dem Nachlass; danach erbt P1 die Hälfte des Rests.
    const mm = { schemaVersion: 2, trancheId: 'muster_a:geldmarkt', sourceProfileId: 'muster_a', type: 'geldmarkt', category: 'money_market',
        marketValue: 2000, costBasis: 1000, shares: 20, purchasePrice: 50, currentPrice: 100, purchaseDate: '2020-01-01', tqf: 0, taxExempt: false };
    const inputs = { ...structuredClone(fixture), dynamicFlex: false, goldAktiv: false, startFloorBedarf: 102000, startFlexBedarf: 0,
        floorBedarf: 102000, flexBedarf: 0, minimumFlexAnnual: 0, survivorFloorPercent: 100, survivorFlexPercent: 100,
        survivorMinimumFlexPercent: 100, renteMonatlich: 0, renteStartOffsetJahre: 0, renteStartMonate: 12, rentAdjPct: 0, startSPB: 0,
        partner: { ...structuredClone(fixture.partner), monatsrente: 10000 / 12, brutto: 10000, startInJahren: 0, renteStartMonate: 12, sparerPauschbetrag: 0 },
        partnership: { schemaVersion: 1, status: 'unmarried', inheritance: { muster_b: 50 } },
        tagesgeld: 100000, geldmarktEtf: 2000, depotwertAlt: 0, depotwertNeu: 0, einstandAlt: 0, einstandNeu: 0, startVermoegen: 102000,
        detailledTranches: [mm] };
    inputs.simulationPeople[0].tagesgeld = 0;
    inputs.simulationPeople[1].tagesgeld = 100000;
    for (const person of inputs.simulationPeople) person.sparerPauschbetrag = 0;
    const year = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 };
    const result = simulateOneYear(initMcRunState(inputs), inputs, year, 0, null, 0, { p1Alive: true, p2Alive: false }, 1, EngineAPI);
    assertEqual(result.kind, 'success', 'FR-16 im Todesjahr: kein Steuerruin vor der Erbverteilung');
    assertClose(result.logData.steuern_gesamt, 263.75, .01, 'FR-16 im Todesjahr: Steuer auf den Geldmarktgewinn');
    assertClose(result.logData.personAccounts[0].tagesgeld, 2368.13, .01, 'FR-16 im Todesjahr: P1 erhält 2.368,13 €');
}
