import { buildBacktestColumnDefinitions } from '../app/simulator/simulator-main-helpers.js';
import { getWorstRunColumnDefinitions } from '../app/simulator/simulator-results.js';

console.log('--- Simulator Log Columns Tests ---');

const hasHeader = (cols, header) => cols.some(col => col?.header === header);

{
    const normalCols = buildBacktestColumnDefinitions('normal');
    const detailedCols = buildBacktestColumnDefinitions('detailed');

    assert(!hasHeader(normalCols, 'VPW%'), 'Backtest normal should not include VPW%');
    assert(!hasHeader(normalCols, 'ER(real)'), 'Backtest normal should not include ER(real)');
    assert(!hasHeader(normalCols, 'RetPol'), 'Backtest normal should not include return policy');
    assert(!hasHeader(normalCols, 'CAPESt'), 'Backtest normal should not include CAPE input status');
    assert(!hasHeader(normalCols, 'Safe'), 'Backtest normal should not include Safe');
    assert(!hasHeader(normalCols, 'VTopf'), 'Backtest normal should not include VTopf');
    assert(!hasHeader(normalCols, 'StSave'), 'Backtest normal should not include StSave');
    assert(!hasHeader(normalCols, 'EntPlan'), 'Backtest normal should not include payout detail columns');
    assert(!hasHeader(normalCols, 'Liq>P'), 'Backtest normal should not include payout liquidity columns');
    assert(hasHeader(detailedCols, 'VPW%'), 'Backtest detailed should include VPW%');
    assert(hasHeader(detailedCols, 'ER(real)'), 'Backtest detailed should include ER(real)');
    assert(hasHeader(detailedCols, 'RetPol'), 'Backtest detailed should include return policy');
    assert(hasHeader(detailedCols, 'RetSrc'), 'Backtest detailed should include return source');
    assert(hasHeader(detailedCols, 'CAPESt'), 'Backtest detailed should include CAPE input status');
    assert(hasHeader(detailedCols, 'ERRaw'), 'Backtest detailed should include raw expected return');
    assert(hasHeader(detailedCols, 'ERClamp'), 'Backtest detailed should include clamped expected return');
    assert(hasHeader(detailedCols, 'SafeR'), 'Backtest detailed should include safe real return');
    assert(hasHeader(detailedCols, 'SafeSrc'), 'Backtest detailed should include safe return source');
    assert(hasHeader(detailedCols, 'Safe'), 'Backtest detailed should include Safe');
    assert(hasHeader(detailedCols, 'VTopf'), 'Backtest detailed should include VTopf');
    assert(hasHeader(detailedCols, 'StSave'), 'Backtest detailed should include StSave');
    assert(hasHeader(detailedCols, 'EntPlan'), 'Backtest detailed should include planned withdrawal');
    assert(hasHeader(detailedCols, 'EntEff'), 'Backtest detailed should include effective withdrawal');
    assert(hasHeader(detailedCols, 'VPW€'), 'Backtest detailed should include VPW total');
    assert(hasHeader(detailedCols, 'VPWFlex'), 'Backtest detailed should include VPW dynamic flex');
    assert(hasHeader(detailedCols, 'StatFlex'), 'Backtest detailed should include static flex baseline');
    assert(hasHeader(detailedCols, 'Liq>P'), 'Backtest detailed should include liquidity before payout');
    assert(hasHeader(detailedCols, 'Liq<P'), 'Backtest detailed should include liquidity after payout');
    assert(hasHeader(detailedCols, 'Liq>Z'), 'Backtest detailed should include liquidity after interest');
    assert(hasHeader(detailedCols, 'Port>P'), 'Backtest detailed should include portfolio before payout');
    assert(hasHeader(detailedCols, 'PortAkt'), 'Backtest detailed should include active portfolio end value');
    assert(hasHeader(detailedCols, 'PortEnd'), 'Backtest detailed should include portfolio end value');
    assert(hasHeader(detailedCols, 'FlowΔ'), 'Backtest detailed should include active flow delta');
    assert(hasHeader(detailedCols, 'TrAct'), 'Backtest detailed should include action trace total');
    assert(hasHeader(detailedCols, 'TrPay'), 'Backtest detailed should include payout trace total');
    assert(hasHeader(detailedCols, 'TrBond'), 'Backtest detailed should include bond refill trace total');
    assert(hasHeader(detailedCols, 'HBEnd'), 'Backtest detailed should include health bucket end value');
    assert(hasHeader(detailedCols, 'HBDeck%'), 'Backtest detailed should include health bucket real coverage');
    assert(hasHeader(detailedCols, 'HBWarn'), 'Backtest detailed should include health bucket warning');
    assert(hasHeader(normalCols, 'MinFlex€'), 'Backtest normal should include minimum flex amount');
    assert(hasHeader(normalCols, 'MinFSt'), 'Backtest normal should include minimum flex status');
    assert(hasHeader(detailedCols, 'MinFBlock'), 'Backtest detailed should include minimum flex block reason');
    assert(hasHeader(detailedCols, 'MinFEff'), 'Backtest detailed should include minimum flex effect amount');
    const backtestRunwayColumn = normalCols.find(col => col?.header === 'Runway%');
    assert(backtestRunwayColumn.valueFormatter(null) === '', 'Backtest runway column renders non-applicable coverage as empty');
    assert(backtestRunwayColumn.valueFormatter(0) === '0%', 'Backtest runway column preserves an applicable zero');

    const noGoldNormalCols = buildBacktestColumnDefinitions('normal', { goldAktiv: false });
    const noGoldDetailedCols = buildBacktestColumnDefinitions('detailed', { goldAktiv: false });
    assert(!hasHeader(noGoldNormalCols, 'Pf.Gld%'), 'Backtest normal should hide gold return when gold is inactive');
    assert(!hasHeader(noGoldNormalCols, 'Handl.G'), 'Backtest normal should hide gold trades when gold is inactive');
    assert(!hasHeader(noGoldNormalCols, 'Gold'), 'Backtest normal should hide gold value when gold is inactive');
    assert(!hasHeader(noGoldDetailedCols, 'GuardG'), 'Backtest detailed should hide gold guard column when gold is inactive');
    assert(!hasHeader(noGoldDetailedCols, 'Gld_vorR'), 'Backtest detailed should hide gold detail columns when gold is inactive');
}


{
    const normal = getWorstRunColumnDefinitions({ logDetailLevel: 'normal' });
    const detailed = getWorstRunColumnDefinitions({ logDetailLevel: 'detailed', showCareDetails: true });
    for (const id of ['histjahr', 'person1-status', 'neta', 'total']) assert(normal.some(c => c.id === id), `${id} auch über MC-Kompatibilität sichtbar`);
    for (const id of ['vpw-total', 'vpw-expectedrealreturn', 'losscarryend', 'minimumflexannual', 'health-bucket-end'])
        assert(detailed.some(c => c.id === id), `Erhaltener Detailwert ${id}`);
    for (const id of ['vpw-returnpolicy', 'vpw-dynamic-flex', 'portfolio-flow-delta', 'person1alive', 'carep1-grade'])
        assert(!detailed.some(c => c.id === id), `Exportexklusiver Wert ${id}`);
    const runway = detailed.find(c => c.id === 'runwaycoveragepct');
    assertEqual(runway.fmt(null), '', 'Fehlende Deckung bleibt leer');
    assertEqual(runway.fmt(0), '0\u00a0%', 'Beobachtete Nulldeckung bleibt Null');
    const noGold = getWorstRunColumnDefinitions({ logDetailLevel: 'detailed', goldAktiv: false });
    for (const id of ['gold', 'netg', 'nominalreturngoldpct']) assert(!noGold.some(c => c.id === id), `${id} bei Gold aus verborgen`);
}
