import { PROTOCOL_COLUMNS, PROTOCOL_GROUPS, getProtocolColumns, readProtocolValue, formatProtocolValue, EXPORT_ONLY_PROTOCOL_IDS } from '../app/simulator/protocol-columns.js';
import { STRATEGY_OPTIONS } from '../types/strategy-options.js';

const options = { strategyMode: STRATEGY_OPTIONS.THREE_BUCKET_JILGE, goldAktiv: true };
assertEqual(new Set(PROTOCOL_COLUMNS.map(column => column.id)).size, PROTOCOL_COLUMNS.length, 'Jede Katalogkennung ist eindeutig');
for (const source of ['mc', 'backtest']) {
    const columns = getProtocolColumns({ ...options, source });
    assert(columns.length >= 12 && columns.length <= 19, `${source}: normale Ansicht ist kuratiert`);
    for (const column of columns) {
        assert(column.id && column.label && column.explanation && column.unit && column.format, `${source}/${column.id}: vollständige Metadaten`);
        assert(Object.hasOwn(PROTOCOL_GROUPS, column.group), `${source}/${column.id}: gültige Gruppe`);
    }
}
const raw = {
    jahr: 3, histJahr: 1974, entscheidung: { jahresEntnahme: 12345.67 },
    floor_brutto: 24000, rente1: 8000, rente2: 4000, renteSum: 12000,
    FlexRatePct: 75, QuoteEndPct: 3.25, inflation: 2.75, NominalReturnEquityPct: -.125, NominalReturnGoldPct: .05,
    runway_after_transaction_before_payout_months: 30, RunwayCoveragePct: 0, RunwayTargetSmoothedMonths: 120,
    wertAktien: 100000, wertGold: 20000, liquiditaet: 30000, portfolio_total_end: 153000,
    netTradeEq: -1234, netTradeGold: 321, vk: { vkAkt: 1000, vkGld: 500 }, kaufAkt: 2000, kaufGld: 800,
    threeBucket: { bondBucketAfter: 15000, bondSaleAmount: 2000, bondRefillGross: 3500, bondRefillNet: 3000 },
    vpw: { vpwRate: .0345, expectedRealReturn: -.015, capeRatioUsed: 25.15 },
    balance_trace: [{ phase: 'after_action_sales', total: 160000 }, { phase: 'after_payout', total: 155000 }, { phase: 'after_bond_refill', total: 154000 }],
    CareP1_Cost: 2000, CareP2_Cost: 3000, CareP1_Active: 1, CareP1_Grade: 2,
    pflege_zusatz_floor: 2000, pflege_flex_faktor: .75, pflege_aktiv: true
};
const backtest = { jahr: 2002, row: { ...raw }, entscheidung: raw.entscheidung, vpw: raw.vpw,
    wertAktien: 100000, wertGold: 20000, liquiditaet: 30000, inflationVJ: 2.75, netA: -1234, netG: 321 };
for (const [source, entry, expectations] of [
    ['mc', raw, { 'Jahr': 3, 'Entn.': 12345.67, Floor: 24000, RenteSum: 12000, 'Flex%': 75, 'Quote%': 3.25,
        'Pf.Akt%': -.125, 'Pf.Gld%': .05, 'Infl.': 2.75, Runway: 30, 'Runway%': 0, 'RunZiel': 120,
        'Handl.A': -1234, 'Handl.G': 321, 'Handl.Bd': -1500, ETF: 85000, Gold: 20000, 'Liq.': 30000,
        'Bonds/Puffer': 15000, PortEnd: 153000, TrAct: 160000, TrPay: 155000, TrBond: 154000, 'PflegeΣ': 5000 }],
    ['backtest', backtest, { 'Jahr': 2002, 'Entn.': 12345.67, Floor: 24000, RenteSum: 12000, 'Flex%': 75, 'Quote%': 3.25,
        'Pf.Akt%': -.125, 'Pf.Gld%': .05, 'Infl.': 2.75, Runway: 30, 'Runway%': 0, 'RunZiel': 120,
        'Handl.A': -1234, 'Handl.G': 321, 'Handl.Bd': -1000, ETF: 85000, Gold: 20000, 'Liq.': 30000,
        'Bonds/Puffer': 15000, PortEnd: 153000, TrAct: 160000, TrPay: 155000, TrBond: 154000 }]
]) {
    const before = JSON.stringify(entry), cols = getProtocolColumns({ ...options, source, logDetailLevel: 'detailed', showCareDetails: true });
    for (const [header, expected] of Object.entries(expectations)) {
        const column = PROTOCOL_COLUMNS.find(item => item.legacyHeader === header);
        assert(column, `${source}: ${header} vorhanden`);
        assertEqual(readProtocolValue(column, entry, { ...options, source }), expected, `${source}/${header}: unabhängiges Rohwertorakel`);
    }
    assertEqual(JSON.stringify(entry), before, `${source}: keine Änderung der fachlichen Zeile`);
}
const find = header => PROTOCOL_COLUMNS.find(column => column.legacyHeader === header);
for (const [header, value, expected] of [
    ['Entn.', 12345.67, '12.346\u00a0€'], ['Handl.A', -1234, 'gekauft 1.234\u00a0€'], ['Pf.Akt%', -.125, '-12,5\u00a0%'],
    ['Quote%', 3.25, '3,3\u00a0%'], ['VPW%', .0345, '3,5\u00a0%'], ['Runway', 30, '2,5\u00a0Jahre'],
    ['Runway', 0, '0\u00a0Jahre'], ['Runway', null, ''], ['Runway', undefined, ''],
    ['Entn.', 0, '0\u00a0€'], ['Entn.', null, ''], ['Runway%', 0, '0\u00a0%'], ['Runway%', null, '']
]) assertEqual(formatProtocolValue(find(header), value), expected, `${header}: Zahl, Einheit, Vorzeichen und Verfügbarkeit`);
for (const detailed of [false, true]) {
    const base = { source: 'mc', ...options, logDetailLevel: detailed ? 'detailed' : 'normal' };
    const hidden = getProtocolColumns(base), visible = getProtocolColumns({ ...base, showCareDetails: true });
    assert(!hidden.some(c => c.group === 'care'), 'Pflegekosten nur bei Pflegedetails');
    for (const header of ['PflegeZiel', 'PflegeΣ', 'P1€', 'P2€', 'HBStart', 'HBUse', 'HBEnd', 'HBWarn'])
        assertEqual(visible.some(c => c.legacyHeader === header), detailed, `Pflegewert ${header} nur mit beiden Detailschaltern`);
    assert(!visible.some(c => c.legacyHeader === 'Floor@Eintritt'), 'Pflegeanker bleibt exportexklusiv');
    assert(!getProtocolColumns({ ...base, source: 'backtest', showCareDetails: true }).some(c => c.group === 'care'), 'Backtest enthält keine Pflegefelder');
}
const detail = getProtocolColumns({ source: 'mc', ...options, logDetailLevel: 'detailed', showCareDetails: true });
for (const header of 'MinFlex€ MinFSt VPW% ER(real) CAPE Safe Handl.Bd VTopf StSave PortEnd HBEnd HBWarn GuardNote'.split(' '))
    assert(detail.some(c => c.legacyHeader === header), `Erhaltener MC-Detailwert: ${header}`);
for (const source of ['mc', 'backtest']) {
    const cols = getProtocolColumns({ source, logDetailLevel: 'detailed', goldAktiv: false });
    for (const header of ['Gold', 'Pf.Gld%', 'Handl.G', 'GuardG', 'Gld_nachK', 'Bonds/Puffer', 'Handl.Bd'])
        assert(!cols.some(c => c.legacyHeader === header), `${source}: strategisch nicht anwendbares ${header} verborgen`);
}
assertEqual(readProtocolValue(find('Handl.A'), { vk: { vkAkt: 1000 }, kaufAkt: 2000 }), -1000, 'Handelsfallback erhält Kaufvorzeichen');
assertEqual(readProtocolValue(find('TrPay'), {}), undefined, 'Fehlender Trace wird nicht zu Null');

const expectedExportOnly = [
    "wealthquoteusedpct",
    "minflexratepct",
    "minimumflexblockreason",
    "minimumflexeffectiveafter",
    "vpw-dynamic-flex",
    "static-flex-baseline",
    "vpw-horizonyears",
    "vpw-returnpolicy",
    "vpw-expectedreturnsource",
    "vpw-capeinputstatus",
    "vpw-expectedreturncape",
    "vpw-expectedrealreturnraw",
    "vpw-expectedrealreturnclamped",
    "vpw-saferealreturn",
    "vpw-saferealreturnsource",
    "row-safety-score",
    "row-safety-risk-streak",
    "row-safety-stable-streak",
    "row-safety-transition",
    "row-safety-real-drawdown-pct",
    "row-safety-runway-pre-months",
    "row-safety-runway-post-months",
    "runwaytargetseveritypct",
    "runwaytargetrawmonths",
    "runwaytargethardminmonths",
    "runwaytargetsmoothingfallback",
    "liq-before-payout",
    "liq-after-payout",
    "liq-after-interest",
    "liqstart",
    "liqend",
    "portfolio-total-before-payout",
    "portfolio-active-end",
    "portfolio-flow-delta",
    "tract",
    "trpay",
    "trbond",
    "guardgold",
    "guardeq",
    "eq-before-return",
    "eq-after-return",
    "eq-after-sales",
    "eq-after-buys",
    "gold-before-return",
    "gold-after-return",
    "gold-after-sales",
    "gold-after-buys",
    "health-bucket-interest",
    "health-bucket-target-inflation-adjusted",
    "health-bucket-real-coverage-pct",
    "health-bucket-target-gap",
    "health-bucket-triggered",
    "pflege-floor-anchor",
    "pflege-maxfloor-anchor",
    "pflege-cap-zusatz",
    "pflege-delta-flex",
    "pflege-zusatz-floor-delta",
    "pflege-flex-faktor",
    "person1alive",
    "person2alive",
    "carep1-active",
    "carep2-active",
    "carep1-grade",
    "carep2-grade"
];
assertEqual(EXPORT_ONLY_PROTOCOL_IDS.length, 64, '58 Rechenspuren und sechs Personen-Einzelwerte');
assertEqual([...EXPORT_ONLY_PROTOCOL_IDS].sort().join(','), expectedExportOnly.sort().join(','), 'Exakte exportexklusive Vertragsmenge');
const expectedHeaders = {
    "floor-aus-depot": "Floor aus Depot",
    "minflexratepct": "Mindest-Flex-Rate",
    "wealthredf": "Vermögenskürzung",
    "wealthquoteusedpct": "Vermögensquote",
    "flex-erfuellt-nominal": "Flex aus Depot",
    "row-flex-haushalt-erfuellt": "Haushalts-Flex",
    "row-flex-haushalt-kuerzung-pct": "Kürzung Haushalt",
    "minimumflexannual": "Mindest-Flex",
    "row-minimumflexeffectivefinal": "Mindest-Flex erfüllt",
    "row-minimumflexshortfallannual": "Mindest-Flex-Lücke",
    "minimumflexstatus": "Mindest-Flex-Status",
    "minimumflexblockreason": "Mindest-Flex-Sperre",
    "minimumflexeffectiveafter": "Mindest-Flex-Wirkung",
    "vpw-total": "VPW-Entnahme",
    "vpw-dynamic-flex": "VPW-Flex",
    "static-flex-baseline": "Flex-Basis",
    "vpw-vpwrate": "VPW-Rate",
    "vpw-horizonyears": "Planungshorizont",
    "vpw-safetystage": "VPW-Sicherheitsstufe",
    "jahresentnahme-real": "Entnahme real",
    "rente1": "Rente Person 1",
    "rente2": "Rente Person 2",
    "adjpct": "Rentenanpassung",
    "vpw-caperatioused": "CAPE",
    "vpw-returnpolicy": "Rendite-Regel",
    "vpw-expectedreturnsource": "Renditequelle",
    "vpw-capeinputstatus": "CAPE-Status",
    "vpw-expectedreturncape": "Rendite aus CAPE",
    "vpw-expectedrealreturn": "Erwartete Rendite",
    "vpw-expectedrealreturnraw": "Rendite vor Grenze",
    "vpw-expectedrealreturnclamped": "Rendite nach Grenze",
    "vpw-saferealreturn": "Sichere Rendite",
    "vpw-saferealreturnsource": "Quelle sichere Rendite",
    "row-safety-score": "Sicherheitswert",
    "row-safety-risk-streak": "Risikojahre in Folge",
    "row-safety-stable-streak": "Stabile Jahre in Folge",
    "row-safety-transition": "Stufenwechsel",
    "row-safety-real-drawdown-pct": "Rückgang real",
    "row-safety-runway-pre-months": "Reichweite vorher",
    "row-safety-runway-post-months": "Reichweite nachher",
    "runwaycoveragepct": "Runway-Deckung",
    "runwaytargetsmoothedmonths": "Runway-Ziel",
    "runwaytargetseveritypct": "Runway-Zielschwere",
    "runwaytargetrawmonths": "Runway-Ziel roh",
    "runwaytargethardminmonths": "Runway-Minimum",
    "runwaytargetsmoothingfallback": "Runway-Ersatzwert",
    "nominalreturnequitypct": "Aktienrendite",
    "nominalreturngoldpct": "Goldrendite",
    "neta": "Aktienhandel",
    "netg": "Goldhandel",
    "handl-bd": "Bondhandel",
    "bonds": "Bonds/Puffer",
    "losscarryend": "Verlusttopf",
    "taxsavedbylosscarry": "Steuerersparnis",
    "liq-before-payout": "Liquidität vor Entnahme",
    "liq-after-payout": "Liquidität nach Entnahme",
    "liq-after-interest": "Liquidität nach Zinsen",
    "liqstart": "Liquidität vor Zinsen",
    "liqend": "Liquidität nach Zinsen",
    "cashinterestearned": "Liquiditätszinsen",
    "zielliquiditaet": "Ziel-Liquidität",
    "needliq": "Auffüllbedarf",
    "portfolio-total-before-payout": "Portfolio vor Entnahme",
    "portfolio-active-end": "Aktives Portfolio",
    "portfolio-flow-delta": "Flow-Differenz",
    "tract": "Stand nach Verkäufen",
    "trpay": "Stand nach Entnahme",
    "trbond": "Stand nach Bondtopf",
    "guardgold": "Schutzregel Gold",
    "guardeq": "Schutzregel Aktien",
    "guardnote": "Schutzregel Grund",
    "eq-before-return": "Aktien vor Rendite",
    "eq-after-return": "Aktien nach Rendite",
    "eq-after-sales": "Aktien nach Verkauf",
    "eq-after-buys": "Aktien nach Kauf",
    "gold-before-return": "Gold vor Rendite",
    "gold-after-return": "Gold nach Rendite",
    "gold-after-sales": "Gold nach Verkauf",
    "gold-after-buys": "Gold nach Kauf",
    "histjahr": "Gezogenes Jahr",
    "person1alive": "Lebensstatus Person 1",
    "person2alive": "Lebensstatus Person 2",
    "carep1-active": "Pflege Person 1",
    "carep2-active": "Pflege Person 2",
    "carep1-grade": "Pflegegrad Person 1",
    "carep2-grade": "Pflegegrad Person 2",
    "carep1-cost": "Pflegekosten Person 1",
    "carep2-cost": "Pflegekosten Person 2",
    "health-bucket-start": "Pflegebucket Beginn",
    "health-bucket-used": "Pflegebucket genutzt",
    "health-bucket-interest": "Pflegebucket Zinsen",
    "health-bucket-end": "Pflegebucket Ende",
    "health-bucket-target-inflation-adjusted": "Pflegebucket-Ziel",
    "health-bucket-real-coverage-pct": "Pflegebucket-Deckung",
    "health-bucket-target-gap": "Pflegebucket-Lücke",
    "health-bucket-triggered": "Pflegebucket ausgelöst",
    "health-bucket-warning": "Pflegebucket-Warnung",
    "pflege-floor-anchor": "Floor bei Pflegebeginn",
    "pflege-maxfloor-anchor": "Pflege-Floor maximal",
    "pflege-cap-zusatz": "Pflegezusatz-Grenze",
    "pflege-delta-flex": "Flex durch Pflege",
    "pflege-zusatz-floor": "Pflege-Zusatzbedarf",
    "pflege-zusatz-floor-delta": "Änderung Pflegebedarf",
    "pflege": "Pflegekosten",
    "pflege-flex-faktor": "Flexfaktor Pflege"
};
for (const [id, header] of Object.entries(expectedHeaders))
    assertEqual(PROTOCOL_COLUMNS.find(column => column.id === id)?.header, header, `${id}: verbindlicher Kurzkopf`);
for (const source of ['mc', 'backtest']) for (const logDetailLevel of ['normal', 'detailed'])
for (const goldAktiv of [false, true]) for (const strategyMode of [STRATEGY_OPTIONS.STANDARD, STRATEGY_OPTIONS.THREE_BUCKET_JILGE])
for (const showCareDetails of [false, true]) for (const compatibility of [false, true]) {
    const context = { source, logDetailLevel, goldAktiv, strategyMode, showCareDetails, compatibility, inputs: { partner: { aktiv: true } } };
    const columns = getProtocolColumns(context);
    assert(columns.every(column => !expectedExportOnly.includes(column.id)), 'Kein exportexklusiver Wert über Kompatibilität sichtbar');
    assert(columns.every(column => column.header.trim() && column.header.length <= 24), 'Alle Köpfe kurz und nichtleer');
    assert(columns.every(column => column.title.includes(column.label) && column.title.includes(column.explanation)), 'Alle Langtexte und Erklärungen assistiv erhalten');
    const groups = [...new Set(columns.map(column => column.group))];
    const ordered = ['year', 'persons', 'withdrawal', 'strategy', 'market', 'action', 'wealth', 'care'].filter(group => groups.includes(group));
    assertEqual(groups.join(','), ordered.join(','), 'Gruppenfolge in jeder Ansicht');
    if (source === 'backtest') assert(!columns.some(column => ['care', 'persons'].includes(column.group)), 'Backtest ohne Personen/Pflege');
    if (logDetailLevel === 'normal') {
        const expected = ['year', ...(source === 'mc' ? ['histjahr', 'person1-status', 'person2-status'] : []),
            'withdrawal', 'rentesum', 'runway', 'market', 'nominalreturnequitypct', 'inflation',
            'action', 'neta', ...(goldAktiv ? ['netg'] : []), ...(strategyMode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE ? ['handl-bd'] : []),
            'equity', ...(goldAktiv ? ['gold'] : []), ...(strategyMode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE ? ['bonds'] : []), 'cash', 'total'];
        assertEqual(columns.map(column => column.id).join(','), expected.join(','), 'Exakte Standardfolge');
    }
}
for (const header of ['Handl.A', 'Handl.G', 'Handl.Bd']) {
    for (const [value, expected] of [[12000, 'verkauft 12.000\u00a0€'], [-8000, 'gekauft 8.000\u00a0€'], [0, '—'], [null, ''], [undefined, '']])
        assertEqual(formatProtocolValue(find(header), value), expected, `${header}: verständlicher Handel ohne erfundene Null`);
    assertEqual(readProtocolValue(find(header), {}), undefined, `${header}: unbeobachteter Handel fehlt`);
}
assertEqual(readProtocolValue(find('Handl.G'), { vk: { vkGld: 25 }, kaufGld: 30 }), -5, 'Goldfallback unverändert');
assertEqual(readProtocolValue(find('Handl.A'), { netTradeEq: 0, vk: { vkAkt: 99 } }), 0, 'Echte direkte Null hat Vorrang');

const retained = { flex_haushalt_erfuellt: 8765.43, flex_haushalt_kuerzung_pct: 12.5,
    minimumFlexEffectiveFinal: 2345.67, minimumFlexShortfallAnnual: 654.33 };
for (const [id, expected] of [['row-flex-haushalt-erfuellt', 8765.43], ['row-flex-haushalt-kuerzung-pct', 12.5],
    ['row-minimumflexeffectivefinal', 2345.67], ['row-minimumflexshortfallannual', 654.33]]) {
    for (const source of ['mc', 'backtest']) {
        const column = getProtocolColumns({ source, logDetailLevel: 'detailed' }).find(c => c.id === id);
        assert(column, `${source}/${id}: ausdrücklich erhaltener Detailwert`);
        assertEqual(readProtocolValue(column, source === 'mc' ? retained : { row: retained }, { source }), expected,
            `${source}/${id}: unabhängiges Rohwertorakel für erfüllten Betrag, Kürzung und Mindest-Flex-Lücke`);
    }
}

// Befund 7: Kalenderjahre sind keine gruppierten Anzahlen.
for (const year of [1965, 2001]) {
    const column = PROTOCOL_COLUMNS.find(c => c.id === 'histjahr');
    assertEqual(formatProtocolValue(column, year), String(year), 'Gezogenes Jahr ohne Tausenderpunkt');
    assertEqual(readProtocolValue(column, { histJahr: year }, { source: 'mc' }), year, 'Unveränderter Rohwert');
}
assertEqual(formatProtocolValue({ format: 'integer' }, 1965), '1.965', 'Gewöhnliche Anzahl bleibt gruppiert');
