import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// Synthetischer Zeuge aus „Balance five-year runway forced sale“.
// Optionaler Repositorypfad erlaubt denselben Node-Lauf auf git-archive-Ständen.
const root = resolve(process.argv[2] || process.cwd());
const { EngineAPI } = await import(pathToFileURL(resolve(root, 'engine/index.mjs')));
const base = { aktuellesAlter: 67, floorBedarf: 12000, flexBedarf: 24000, minimumFlexAnnual: 0,
    flexBudgetAnnual: 7000, flexBudgetYears: 5, flexBudgetRecharge: 5000,
    inflation: 2, tagesgeld: 100000, geldmarktEtf: 0, aktuelleLiquiditaet: 100000,
    depotwertAlt: 500000, depotwertNeu: 0, costBasisAlt: 250000, costBasisNeu: 0,
    endeVJ: 100, endeVJ_1: 95, endeVJ_2: 90, endeVJ_3: 85, ath: 105, jahreSeitAth: 1,
    renteAktiv: false, renteMonatlich: 0, marketCapeRatio: 25, capeRatio: 25,
    minCashBufferMonths: 2, maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5, sparerPauschbetrag: 1000,
    detailledTranches: [{ trancheId: 'runway-witness:eq', schemaVersion: 2, sourceProfileId: 'runway-witness',
        marketValue: 500000, costBasis: 250000, shares: 1000, purchasePrice: 250, currentPrice: 500,
        purchaseDate: '2000-01-01', type: 'aktien_alt', category: 'equity', tqf: 0.3, taxExempt: false }] };
for (const liquidityRunwayYears of [1, 5]) {
    const r = EngineAPI.simulateSingleYear({ ...base, liquidityRunwayYears }, null);
    if (r.error) throw r.error;
    const a = r.ui?.action;
    if (a?.type !== 'TRANSACTION') throw new Error('BT-6a-Zeuge liefert keine Transaktion.');
    console.log(JSON.stringify({ years: liquidityRunwayYears, error: r.error?.message, market: r.ui?.market?.sKey,
        annual: r.ui?.spending?.details?.endgueltigeEntnahme, target: a?.zielLiquiditaet,
        title: a?.title, sources: a?.quellen?.map(({kind,brutto,steuer,netto}) => ({kind,brutto,steuer,netto})),
        diagnostics: a?.diagnosisEntries }));
}
