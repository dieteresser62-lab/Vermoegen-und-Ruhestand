"use strict";

import { EngineAPI } from '../../engine/index.mjs';
import { STRATEGY_OPTIONS } from '../../types/strategy-options.js';
import { formatDisplayNumber, formatDisplayFixed } from '../shared/designsystem-number-format.js';
import { formatDisplayPercentValue, formatDisplayPercentRatio } from '../shared/shared-formatting.js';

export const PROTOCOL_GROUPS = Object.freeze({ year: 'Jahr / Alter', persons: 'Personen',
    withdrawal: 'Entnahme und Rente', strategy: 'Strategie', market: 'Marktphase', action: 'Handlung',
    wealth: 'Vermögen am Jahresende', care: 'Pflege' });

// Einziger aktiver Anzeigekatalog. Zugriffe unterscheiden flache MC- und verschachtelte Backtestzeilen.
// Tupel: Kennung, Bezeichnung, Gruppe, Format, MC-Pfad, Backtest-Pfad, Kompatibilitätskopf, Anwendbarkeit, alter MC-Normalmodus.
const DEFINITIONS = [
    ["year","Jahr","year","integer","jahr","jahr","Jahr","both",true],
    ["runway","Liquidität reicht","strategy","years",null,null,"Runway","both",false],
    ["year-status","Status","market","text",null,null,"Jahresstatus","both",false],
    ["household-care","Pflege","care","text",null,null,"Pflegestatus","both",false],
    ["withdrawal","Entnahme","withdrawal","money","entscheidung.jahresEntnahme","entscheidung.jahresEntnahme","Entn.","both",true],
    ["floor-brutto","Floor-Bedarf","withdrawal","money","floor_brutto","row.floor_brutto","Floor","both",true],
    ["rente1","Jahresrente Person 1","withdrawal","money","rente1","row.rente1","Rente1","both",false],
    ["rente2","Jahresrente Person 2","withdrawal","money","rente2","row.rente2","Rente2","both",false],
    ["rentesum","Renten","withdrawal","money","renteSum","row.renteSum","RenteSum","both",true],
    ["floor-aus-depot","Aus dem Depot zu deckender Floor","withdrawal","money","floor_aus_depot","row.floor_aus_depot","FloorDep","both",false],
    ["flexratepct","Flex-Rate","withdrawal","percent0","FlexRatePct","row.FlexRatePct","Flex%","both",true],
    ["minflexratepct","Mindest-Flex-Rate in Prozent","withdrawal","percent0","MinFlexRatePct","row.MinFlexRatePct","MinF%","both",true],
    ["wealthredf","Vermögensbedingte Kürzung in Prozent","withdrawal","percent0","WealthRedF","row.WealthRedF","WRed%","both",true],
    ["wealthquoteusedpct","Verwendete Vermögensquote in Prozent","withdrawal","percent0","WealthQuoteUsedPct","row.WealthQuoteUsedPct","WQ%","both",true],
    ["flex-erfuellt-nominal","Erfüllter Flex-Betrag aus dem Depot","withdrawal","money","flex_erfuellt_nominal","row.flex_erfuellt_nominal","FlexDep€","both",true],
    ["row-flex-haushalt-erfuellt","Erfüllter Haushalts-Flex","withdrawal","money","flex_haushalt_erfuellt","row.flex_haushalt_erfuellt","FlexHH€","both",false],
    ["row-flex-haushalt-kuerzung-pct","Haushalts-Flex-Kürzung","withdrawal","percent0","flex_haushalt_kuerzung_pct","row.flex_haushalt_kuerzung_pct","FlexHH%","both",false],
    ["minimumflexannual","Mindest-Flex pro Jahr in Euro","withdrawal","money","minimumFlexAnnual","row.minimumFlexAnnual","MinFlex€","both",true],
    ["row-minimumflexeffectivefinal","Tatsächlich erfüllter Mindest-Flex","withdrawal","money","minimumFlexEffectiveFinal","row.minimumFlexEffectiveFinal","MinFIst€","both",false],
    ["row-minimumflexshortfallannual","Fehlbetrag zum Mindest-Flex","withdrawal","money","minimumFlexShortfallAnnual","row.minimumFlexShortfallAnnual","MinFGap€","both",false],
    ["minimumflexstatus","Mindest-Flex-Status","withdrawal","text","minimumFlexStatus","row.minimumFlexStatus","MinFSt","both",true],
    ["entnahme-plan","Geplante Entnahme","withdrawal","money","entnahme_plan","row.entnahme_plan","EntPlan","both",false],
    ["entnahme-effektiv","Effektive Entnahme","withdrawal","money","entnahme_effektiv","row.entnahme_effektiv","EntEff","both",false],
    ["vpw-total","VPW-Gesamtentnahme in Euro","withdrawal","money","vpw_total","row.vpw_total","VPW€","both",false],
    ["vpw-dynamic-flex","Dynamischer VPW-Flex-Betrag","withdrawal","money","vpw_dynamic_flex","row.vpw_dynamic_flex","VPWFlex","both",false],
    ["static-flex-baseline","Statische Flex-Basis","withdrawal","money","static_flex_baseline","row.static_flex_baseline","StatFlex","both",false],
    ["vpw-vpwrate","VPW-Entnahmerate in Prozent","withdrawal","ratio","vpw.vpwRate","vpw.vpwRate","VPW%","both",false],
    ["vpw-horizonyears","Planungshorizont in Jahren","strategy","integer","vpw.horizonYears","vpw.horizonYears","Hor","both",false],
    ["vpw-status","VPW-Status","withdrawal","text","vpw.status","vpw.status","VPWSt","both",false],
    ["vpw-safetystage","VPW-Sicherheitsstufe","strategy","integer","vpw.safetyStage","vpw.safetyStage","Safe","both",false],
    ["vpwfallbackhint","VPW-Hinweis","withdrawal","text",null,"vpwFallbackHint","VPWHint","both",false],
    ["jahresentnahme-real","Reale Jahresentnahme","withdrawal","money","jahresentnahme_real","row.jahresentnahme_real","Entn_real","both",false],
    ["adjpct","Rentenanpassung in Prozent","strategy","percent",null,"adjPct","Adj%","both",false],
    ["vpw-caperatioused","Zyklisch bereinigtes Kurs-Gewinn-Verhältnis","strategy","decimal","vpw.capeRatioUsed","vpw.capeRatioUsed","CAPE","both",false],
    ["vpw-returnpolicy","Rendite-Policy","strategy","text","vpw.returnPolicy","vpw.returnPolicy","RetPol","both",false],
    ["vpw-expectedreturnsource","Quelle der erwarteten Rendite","strategy","text","vpw.expectedReturnSource","vpw.expectedReturnSource","RetSrc","both",false],
    ["vpw-capeinputstatus","CAPE-Eingabestatus","strategy","text","vpw.capeInputStatus","vpw.capeInputStatus","CAPESt","both",false],
    ["vpw-expectedreturncape","Aus CAPE erwartete reale Rendite","strategy","ratio","vpw.expectedReturnCape","vpw.expectedReturnCape","ER(CAPE)","both",false],
    ["vpw-expectedrealreturn","Verwendete erwartete reale Rendite","strategy","ratio","vpw.expectedRealReturn","vpw.expectedRealReturn","ER(real)","both",false],
    ["vpw-expectedrealreturnraw","Erwartete reale Rendite vor Begrenzung","strategy","ratio","vpw.expectedRealReturnRaw","vpw.expectedRealReturnRaw","ERRaw","both",false],
    ["vpw-expectedrealreturnclamped","Erwartete reale Rendite nach Begrenzung","strategy","ratio","vpw.expectedRealReturnClamped","vpw.expectedRealReturnClamped","ERClamp","both",false],
    ["vpw-saferealreturn","Sichere reale Rendite","strategy","ratio","vpw.safeRealReturn","vpw.safeRealReturn","SafeR","both",false],
    ["vpw-saferealreturnsource","Quelle der sicheren realen Rendite","strategy","text","vpw.safeRealReturnSource","vpw.safeRealReturnSource","SafeSrc","both",false],
    ["row-safety-score","Sicherheitsbewertung","strategy","integer",null,"row.safety_score","SafSc","both",false],
    ["row-safety-risk-streak","Aufeinanderfolgende Risikojahre","strategy","integer",null,"row.safety_risk_streak","RiskSt","both",false],
    ["row-safety-stable-streak","Aufeinanderfolgende stabile Jahre","strategy","integer",null,"row.safety_stable_streak","StabSt","both",false],
    ["row-safety-transition","Übergang der Sicherheitsstufe","strategy","text",null,"row.safety_transition","SafTr","both",false],
    ["minimumflexblockreason","Blockierungsgrund des Mindest-Flex","withdrawal","text","minimumFlexBlockReason","row.minimumFlexBlockReason","MinFBlock","both",false],
    ["minimumflexeffectiveafter","Wirkung des Mindest-Flex in Euro","withdrawal","money","minimumFlexEffectiveAfter","row.minimumFlexEffectiveAfter","MinFEff","both",false],
    ["row-safety-real-drawdown-pct","Realer Vermögensrückgang in Prozent","strategy","percent0",null,"row.safety_real_drawdown_pct","DDreal%","both",false],
    ["row-safety-runway-pre-months","Reichweite vor der Aktion in Monaten","strategy","months",null,"row.safety_runway_pre_months","RunPre","both",false],
    ["row-safety-runway-post-months","Reichweite nach der Aktion in Monaten","strategy","months",null,"row.safety_runway_post_months","RunPost","both",false],
    ["market","Marktphase","market","text","Regime","row.Regime","Markt","both",true],
    ["action","Handlung","action","text","aktionUndGrund","row.aktionUndGrund","Status","both",true],
    ["cutreason","Kürzungsgrund","action","text","CutReason","row.CutReason","Cut","both",true],
    ["alarm","Alarmstatus","action","boolean","Alarm","row.Alarm","Alarm","both",true],
    ["quoteendpct","Quote","withdrawal","percent","QuoteEndPct","row.QuoteEndPct","Quote%","both",true],
    ["runwaycoveragepct","Runway-Deckung in Prozent","strategy","percent0","RunwayCoveragePct","row.RunwayCoveragePct","Runway%","both",true],
    ["runwaytargetsmoothedmonths","Geglättetes Runway-Ziel in Monaten","strategy","months","RunwayTargetSmoothedMonths","row.RunwayTargetSmoothedMonths","RunZiel","both",true],
    ["runwaytargetseveritypct","Runway-Zielschwere in Prozent","strategy","percent0","RunwayTargetSeverityPct","row.RunwayTargetSeverityPct","RunSev","both",true],
    ["nominalreturnequitypct","Aktienrendite in Prozent","market","ratio","NominalReturnEquityPct",null,"Pf.Akt%","both",true],
    ["nominalreturngoldpct","Goldrendite in Prozent","market","ratio","NominalReturnGoldPct",null,"Pf.Gld%","both",true],
    ["inflation","Inflation","market","percent","inflation","inflationVJ","Infl.","both",true],
    ["neta","Nettohandel Aktien: positiv = Verkauf, negativ = Kauf","action","money",null,"netA","Handl.A","both",true],
    ["netg","Nettohandel Gold: positiv = Verkauf, negativ = Kauf","action","money",null,"netG","Handl.G","both",true],
    ["handl-bd","Nettohandel Bonds: positiv = Verkauf, negativ = Kauf","action","money",null,null,"Handl.Bd","both",true],
    ["steuern-gesamt","Steuern","action","money","steuern_gesamt","row.steuern_gesamt","St.","both",true],
    ["equity","Aktien/ETF","wealth","money","wertAktien",null,"ETF","both",true],
    ["gold","Gold","wealth","money","wertGold","wertGold","Gold","both",true],
    ["cash","Liquidität","wealth","money","liquiditaet","liquiditaet","Liq.","both",true],
    ["bonds","Bonds und Puffer","wealth","money","bondBucketAfter",null,"Bonds/Puffer","both",true],
    ["losscarryend","Verlusttopf am Jahresende","strategy","money","lossCarryEnd","row.lossCarryEnd","VTopf","both",false],
    ["taxsavedbylosscarry","Steuerersparnis durch Verlusttopf","strategy","money","taxSavedByLossCarry","row.taxSavedByLossCarry","StSave","both",false],
    ["liq-before-payout","Liquidität vor Entnahme","strategy","money","liq_before_payout","row.liq_before_payout","Liq>P","both",false],
    ["liq-after-payout","Liquidität nach Entnahme","strategy","money","liq_after_payout","row.liq_after_payout","Liq<P","both",false],
    ["liq-after-interest","Liquidität nach Verzinsung","strategy","money","liq_after_interest","row.liq_after_interest","Liq>Z","both",false],
    ["portfolio-total-before-payout","Gesamtportfolio vor Entnahme","strategy","money","portfolio_total_before_payout","row.portfolio_total_before_payout","Port>P","both",false],
    ["portfolio-active-end","Aktives Portfolio am Jahresende","strategy","money","portfolio_active_end","row.portfolio_active_end","PortAkt","both",false],
    ["total","Vermögen","wealth","money","portfolio_total_end","row.portfolio_total_end","PortEnd","both",false],
    ["portfolio-flow-delta","Portfolio-Flow-Differenz","strategy","money","portfolio_flow_delta","row.portfolio_flow_delta","FlowΔ","both",false],
    ["tract","Portfoliostand nach Aktionsverkäufen","wealth","money",null,null,"TrAct","both",false],
    ["trpay","Portfoliostand nach Entnahme","wealth","money",null,null,"TrPay","both",false],
    ["trbond","Portfoliostand nach Auffüllung des Bondtopfs","wealth","money",null,null,"TrBond","both",false],
    ["health-bucket-start","Pflegebucket am Jahresanfang","care","money","health_bucket_start","row.health_bucket_start","HBStart","both",false],
    ["health-bucket-used","Pflegebucket-Nutzung","care","money","health_bucket_used","row.health_bucket_used","HBUse","both",false],
    ["health-bucket-interest","Pflegebucket-Verzinsung","care","money","health_bucket_interest","row.health_bucket_interest","HBZins","both",false],
    ["health-bucket-end","Pflegebucket am Jahresende","care","money","health_bucket_end","row.health_bucket_end","HBEnd","both",false],
    ["health-bucket-target-inflation-adjusted","Inflationsangepasstes Pflegebucket-Ziel","care","money","health_bucket_target_inflation_adjusted","row.health_bucket_target_inflation_adjusted","HBZiel","both",false],
    ["health-bucket-real-coverage-pct","Reale Pflegebucket-Zieldeckung in Prozent","care","percent0","health_bucket_real_coverage_pct","row.health_bucket_real_coverage_pct","HBDeck%","both",false],
    ["health-bucket-target-gap","Pflegebucket-Ziellücke","care","money","health_bucket_target_gap","row.health_bucket_target_gap","HBLücke","both",false],
    ["health-bucket-triggered","Pflegebucket-Trigger","care","boolean","health_bucket_triggered","row.health_bucket_triggered","HBTrig","both",false],
    ["health-bucket-warning","Pflegebucket-Warnung","care","text","health_bucket_warning","row.health_bucket_warning","HBWarn","both",false],
    ["liqstart","Liquidität vor Verzinsung","strategy","money","liqStart","row.liqStart","Liq@rC-","both",false],
    ["cashinterestearned","Erhaltene Liquiditätszinsen","strategy","money","cashInterestEarned","row.cashInterestEarned","Zins€","both",false],
    ["liqend","Liquidität nach Verzinsung","strategy","money","liqEnd","row.liqEnd","Liq@rC+","both",false],
    ["zielliquiditaet","Zielbestand der Liquidität","strategy","money","zielLiquiditaet","row.zielLiquiditaet","ZielLiq","both",false],
    ["runwaytargetrawmonths","Ungeglättetes Runway-Ziel in Monaten","strategy","months","RunwayTargetRawMonths","row.RunwayTargetRawMonths","RunRaw","both",false],
    ["runwaytargethardminmonths","Harte Runway-Untergrenze in Monaten","strategy","months","RunwayTargetHardMinMonths","row.RunwayTargetHardMinMonths","RunMin","both",false],
    ["runwaytargetsmoothingfallback","Ersatzwert bei Runway-Zielglättung","strategy","boolean","RunwayTargetSmoothingFallback","row.RunwayTargetSmoothingFallback","RunFb","both",false],
    ["needliq","Benötigte Liquiditätsauffüllung","action","money","NeedLiq","row.NeedLiq","NeedLiq","both",false],
    ["guardgold","Goldbetrag der Schutzregel","action","money","GuardGold","row.GuardGold","GuardG","both",false],
    ["guardeq","Aktienbetrag der Schutzregel","action","money","GuardEq","row.GuardEq","GuardA","both",false],
    ["guardnote","Begründung der Schutzregel","action","text","GuardNote","row.GuardNote","GuardNote","both",false],
    ["eq-before-return","Aktien vor Rendite","strategy","money","eq_before_return","row.eq_before_return","Akt_vorR","both",false],
    ["eq-after-return","Aktien nach Rendite","strategy","money","eq_after_return","row.eq_after_return","Akt_nachR","both",false],
    ["eq-after-sales","Aktien nach Verkauf","strategy","money","eq_after_sales","row.eq_after_sales","Akt_nachV","both",false],
    ["eq-after-buys","Aktien nach Kauf","strategy","money","eq_after_buys","row.eq_after_buys","Akt_nachK","both",false],
    ["gold-before-return","Gold vor Rendite","strategy","money","gold_before_return","row.gold_before_return","Gld_vorR","both",false],
    ["gold-after-return","Gold nach Rendite","strategy","money","gold_after_return","row.gold_after_return","Gld_nachR","both",false],
    ["gold-after-sales","Gold nach Verkauf","strategy","money","gold_after_sales","row.gold_after_sales","Gld_nachV","both",false],
    ["gold-after-buys","Gold nach Kauf","strategy","money","gold_after_buys","row.gold_after_buys","Gld_nachK","both",false],
    ["histjahr","Historisches Jahr","year","integer","histJahr",null,"Hist","mc",true],
    ["person1alive","Lebensstatus Person 1","care","alive","Person1Alive",null,"P1L","both",true],
    ["carep1-active","Pflege Person 1","care","boolean","CareP1_Active",null,"P1","both",true],
    ["carep1-grade","Pflegegrad Person 1","care","grade","CareP1_Grade",null,"P1_PG","both",true],
    ["person2alive","Lebensstatus Person 2","care","alive","Person2Alive",null,"P2L","both",true],
    ["carep2-active","Pflege Person 2","care","boolean","CareP2_Active",null,"P2","both",true],
    ["carep2-grade","Pflegegrad Person 2","care","grade","CareP2_Grade",null,"P2_PG","both",true],
    ["pflege-floor-anchor","Floor bei Pflegeeintritt","care","money","pflege_floor_anchor",null,"Floor@Eintritt","care",false],
    ["pflege-maxfloor-anchor","Maximaler Pflege-Floor","care","money","pflege_maxfloor_anchor",null,"MaxPflege@Jahr","care",false],
    ["pflege-cap-zusatz","Obergrenze Pflegezusatz","care","money","pflege_cap_zusatz",null,"CapZusatz@Jahr","care",false],
    ["pflege-delta-flex","Flexänderung durch Pflege","care","money","pflege_delta_flex",null,"PflegeΔ_Flex","care",false],
    ["pflege-zusatz-floor","Pflege-Zusatzbedarf","care","money","pflege_zusatz_floor",null,"PflegeZiel","care",false],
    ["pflege-zusatz-floor-delta","Änderung Pflegebedarf","care","money","pflege_zusatz_floor_delta",null,"PflegeΔ","care",false],
    ["pflege","Pflegekosten gesamt","care","money",null,null,"PflegeΣ","care",false],
    ["pflege-flex-faktor","Flexfaktor bei Pflege","care","ratio","pflege_flex_faktor",null,"FlexPfl%","care",false],
    ["carep1-cost","Pflegekosten Person 1","care","money","CareP1_Cost",null,"P1€","care",false],
    ["carep2-cost","Pflegekosten Person 2","care","money","CareP2_Cost",null,"P2€","care",false],
];

const UNIT = Object.freeze({ money: 'EUR', percent: 'Prozentpunkte', percent0: 'Prozentpunkte',
    ratio: 'Ratio', years: 'Monate → Jahre', months: 'Monate', integer: 'Anzahl', decimal: 'Verhältnis',
    text: 'Text', boolean: 'Wahrheitswert', alive: 'Lebensstatus', grade: 'Pflegegrad' });
const EXPLANATIONS = Object.freeze({
    year: 'Kalenderjahr und Alter aus dem gerechneten Lauf; beim Monte Carlo zusätzlich das Simulationsjahr.',
    market: 'Marktregime dieses Jahres; das historische Samplingjahr ist kein Kalenderjahr.',
    withdrawal: 'Geplante Jahresentnahme in nominalen Euro.',
    'quoteendpct': 'Vorläufige Entnahme auf Basis der Vorjahres-Flexrate vor Transaktion und Auszahlung; Depot ohne Liquidität und Pflegebucket als Nenner. Prozentpunkte, keine Aktienquote.',
    runway: 'Liquiditätsreichweite nach Transaktion und vor Entnahme: vorhandene Monate geteilt durch zwölf.',
    flexratepct: 'Anteil des gewünschten Flex-Betrags, der ausgezahlt wurde. Prozentpunkte; unter 100 % bedeutet Kürzung.',
    rentesum: 'Summe der Jahresrenten beider Personen in nominalen Euro.',
    'steuern-gesamt': 'Steuern auf die Verkäufe dieses Jahres in nominalen Euro.',
    equity: 'Aktien- und ETF-Bestand am Jahresende; in der Drei-Bucket-Strategie ohne den separat ausgewiesenen Bondtopf.',
    action: 'Vollständige Aktion und Begründung des Rechenlaufs.',
    total: 'Gesamtportfolio am Jahresende einschließlich des Pflegebuckets, soweit im Rohwert enthalten.',
    neta: 'Nettohandel Aktien: positiv = Verkauf, negativ = Kauf.',
    netg: 'Nettohandel Gold: positiv = Verkauf, negativ = Kauf.',
    'handl-bd': 'Nettohandel Bonds: positiv = Verkauf, negativ = Kauf; MC berücksichtigt Bruttoauffüllung, Backtest Nettoauffüllung.'
});
const SHORT_HEADERS = Object.freeze({
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
});

export const EXPORT_ONLY_PROTOCOL_IDS = Object.freeze([
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
]);
const exportOnly = new Set(EXPORT_ONLY_PROTOCOL_IDS);

export const PROTOCOL_COLUMNS = Object.freeze(DEFINITIONS.map(([id, label, group, format, mcPath, backtestPath, legacyHeader, applicability, legacyNormal]) => Object.freeze({
    id, label, header: SHORT_HEADERS[id] || label, visibility: exportOnly.has(id) ? 'export' : 'display', group, format, unit: UNIT[format], mcPath, backtestPath, legacyHeader, applicability, legacyNormal,
    explanation: EXPLANATIONS[id] || `${label}. ${PROTOCOL_GROUPS[group]}; Einheit des Rohwerts: ${UNIT[format]}. Fehlende Beobachtungen bleiben leer.`
})));

export function protocolNestedValue(row, path) {
    if (!path) return undefined;
    return path.split('.').reduce((value, part) => value?.[part], row);
}
export function protocolRowData(row, source = 'mc') { return source === 'backtest' ? row?.row || {} : row || {}; }
export function protocolRowFlags(entry, source = 'mc') {
    const row = protocolRowData(entry, source);
    const reduction = row.flex_haushalt_kuerzung_pct ?? entry?.entscheidung?.kuerzungProzent;
    return { ruin: row.recordType === 'terminal_ruin' || row.Regime === 'BANKRUPT' || row.aktionUndGrund === '!!! RUIN !!!',
        cut: Number.isFinite(reduction) && reduction > 0,
        care: Boolean(row.CareP1_Active || row.CareP2_Active || row.pflege_aktiv) };
}
const finite = value => typeof value === 'number' && Number.isFinite(value);
const tracePhases = { TrAct: 'after_action_sales', TrPay: 'after_payout', TrBond: 'after_bond_refill' };
export function readProtocolValue(column, entry, options = {}) {
    const source = options.source || 'mc', row = protocolRowData(entry, source), h = column.legacyHeader;
    const flags = protocolRowFlags(entry, source);
    if (column.id === 'year-status') return flags.ruin ? 'Ruin' : flags.cut ? 'Kürzung' : 'Ohne Kürzung';
    if (column.id === 'household-care') return [1, 2].filter(p => row[`CareP${p}_Active`]).map(p => `Person ${p}${row[`CareP${p}_Grade`] != null ? ` · Pflegegrad ${row[`CareP${p}_Grade`]}` : ''}`).join(' / ') || (flags.care ? 'Pflege aktiv' : '—');
    if (column.id === 'runway') return source === 'backtest' && Object.hasOwn(row, 'runway_after_transaction_before_payout_months')
        ? row.runway_after_transaction_before_payout_months : row.runway_after_transaction_before_payout_months ?? entry?.runway_after_transaction_before_payout_months;
    if (h in tracePhases) return row.balance_trace?.find(item => item?.phase === tracePhases[h])?.total;
    if (h === 'Pf.Akt%' || h === 'Pf.Gld%') return row[h === 'Pf.Akt%' ? 'NominalReturnEquityPct' : 'NominalReturnGoldPct'];
    if (h === 'PflegeΣ') return row.CareP1_Cost == null && row.CareP2_Cost == null ? undefined : (row.CareP1_Cost || 0) + (row.CareP2_Cost || 0);
    if (h === 'Handl.A' || h === 'Handl.G') {
        if (source === 'backtest') return entry?.[h === 'Handl.A' ? 'netA' : 'netG'];
        const direct = row[h === 'Handl.A' ? 'netTradeEq' : 'netTradeGold'];
        const sale = row.vk?.[h === 'Handl.A' ? 'vkAkt' : 'vkGld'], buy = row[h === 'Handl.A' ? 'kaufAkt' : 'kaufGld'];
        return finite(direct) ? direct : sale == null && buy == null ? undefined : (sale || 0) - (buy || 0);
    }
    if (h === 'Handl.Bd') {
        if ((row.threeBucket?.bondSaleAmount ?? row.bondSaleAmount) == null
            && (source === 'backtest' ? row.threeBucket?.bondRefillNet ?? row.bondRefillNet : row.threeBucket?.bondRefillGross ?? row.bondRefillNet) == null) return undefined;
        return (Number(row.threeBucket?.bondSaleAmount ?? row.bondSaleAmount) || 0)
        - (Number(source === 'backtest' ? row.threeBucket?.bondRefillNet ?? row.bondRefillNet : row.threeBucket?.bondRefillGross ?? row.bondRefillNet) || 0);
    }
    if (h === 'Bonds/Puffer') return row.bondBucketAfter ?? row.threeBucket?.bondBucketAfter;
    if (h === 'ETF') {
        const value = source === 'backtest' ? entry?.wertAktien : row.wertAktien;
        const bond = row.bondBucketAfter ?? row.threeBucket?.bondBucketAfter ?? 0;
        return finite(value) ? Math.max(0, value - (options.strategyMode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE ? bond : 0)) : undefined;
    }
    return protocolNestedValue(entry, source === 'backtest' ? column.backtestPath : column.mcPath);
}

export function translateProtocolText(value) {
    const scenarios = { HEISS: 'Markt heiß gelaufen', ATH: 'Stabiler Höchststand', ERHOLUNG: 'Bestätigte Erholung',
        REC_BÄR: 'Erholung im Bärenmarkt', KORREKTUR: 'Junge Korrektur', BÄR: 'Tiefer Bär', SEITWÄRTS: 'Lange Seitwärtsbewegung' };
    return String(value ?? '').replace(/\b(?:REC_BÄR|HEISS|ATH|ERHOLUNG|KORREKTUR|BÄR|SEITWÄRTS)(?![\p{L}\p{N}_])/gu, key => scenarios[key])
        .replaceAll('(S)', '(Stagflation)').replaceAll(' (Kein Handlungsbedarf)', ' · kein Handlungsbedarf')
        .replaceAll('!!! RUIN !!!', 'Ruin').replaceAll('Notfall-Refill', 'Notfallauffüllung')
        .replaceAll('MinRW-Refill', 'Mindestreichweite auffüllen').replaceAll('Puffer-Refill', 'Liquiditätspuffer auffüllen')
        .replaceAll('Reinvest', 'Wiederanlage').replaceAll('Rebal.(G+)', 'Gold kaufen')
        .replaceAll('Rebal.(G-)', 'Gold verkaufen').replaceAll('Rebal.(A+)', 'Aktien kaufen');
}
export function formatProtocolValue(column, value, entry, options = {}) {
    if (column.format === 'text') {
        if (column.id === 'health-bucket-warning' && String(value).startsWith('Pflegebucket auf verfuegbare Liquiditaet gekappt:')) {
            return 'Pflegereserve beim Start auf die verfügbare Liquidität begrenzt.';
        }
        if (column.id === 'market') return ({ accumulation: 'Ansparphase', BANKRUPT: 'Ruin', recovery: 'Bestätigte Erholung', side_long: 'Lange Seitwärtsbewegung' })[value]
            || EngineAPI.getConfig().TEXTS?.SCENARIO?.[value] || String(value ?? '');
        return translateProtocolText(value);
    }
    if (column.format === 'boolean') return value == null ? '' : value ? 'aktiv' : '—';
    if (column.format === 'alive') return value == null ? '—' : value ? '✓' : '†';
    if (column.format === 'grade') {
        const raw = entry && protocolRowData(entry, options.source);
        const person = column.legacyHeader === 'P1_PG' ? 1 : 2;
        return value == null || raw && !raw[`CareP${person}_Active`] ? '—' : `Pflegegrad ${value}`;
    }
    if (column.legacyHeader === 'FlexPfl%' && entry && !protocolRowData(entry, options.source).pflege_aktiv) return '—';
    if (!finite(value)) return '';
    if (column.format === 'money') {
        if (entry) {
            const row = protocolRowData(entry, options.source);
            const startFactor = row.inflation_factor_cum;
            const inflation = options.source === 'backtest' ? entry.inflationVJ : row.inflation;
            const realWithdrawal = column.id === 'jahresentnahme-real';
            if (realWithdrawal && options.moneyBasis !== 'real') {
                value = finite(row.entnahme_effektiv) ? row.entnahme_effektiv
                    : finite(startFactor) && startFactor > 0 ? value * startFactor : NaN;
            } else if (realWithdrawal && options.source === 'backtest') {
                const nominal = finite(row.entnahme_effektiv) ? row.entnahme_effektiv : value * startFactor;
                const factor = finite(inflation) ? startFactor * (1 + inflation / 100) : NaN;
                value = finite(factor) && factor > 0 ? nominal / factor : NaN;
            } else if (!realWithdrawal && options.moneyBasis === 'real') {
                const endStock = ['equity', 'gold', 'bonds', 'cash', 'total', 'losscarryend', 'health-bucket-end'].includes(column.id);
                const factor = endStock || options.source === 'backtest'
                    ? finite(inflation) ? startFactor * (1 + inflation / 100) : NaN : startFactor;
                value = finite(factor) && factor > 0 ? value / factor : NaN;
            }
            if (!finite(value)) return '—';
        }
        const trade = ['neta', 'netg', 'handl-bd'].includes(column.id);
        if (trade && value === 0) return '—';
        const money = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(trade ? Math.abs(value) : value);
        return trade ? `${value > 0 ? 'verkauft' : 'gekauft'} ${money}` : money;
    }
    if (column.format === 'ratio') return formatDisplayPercentRatio(value, { fractionDigits: 1, invalid: '' });
    if (column.format === 'percent' || column.format === 'percent0') return formatDisplayPercentValue(value, { fractionDigits: column.format === 'percent0' ? 0 : 1, invalid: '' });
    if (column.format === 'years') return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value / 12)}\u00a0Jahre`;
    if (column.format === 'months') return `${formatDisplayFixed(value, 0)}\u00a0Monate`;
    if (column.format === 'decimal') return formatDisplayFixed(value, 1);
    if (column.id === 'histjahr') return String(Math.round(value));
    return formatDisplayNumber(value, { fractionDigits: 0 });
}

const STANDARD_IDS = ['year', 'histjahr', 'person1-status', 'person2-status', 'withdrawal', 'rentesum',
    'runway', 'market', 'nominalreturnequitypct', 'inflation', 'action', 'neta', 'netg', 'handl-bd',
    'equity', 'gold', 'bonds', 'cash', 'total'];
const GOLD_HEADERS = new Set(['Pf.Gld%', 'Handl.G', 'Gold', 'GuardG', 'Gld_vorR', 'Gld_nachR', 'Gld_nachV', 'Gld_nachK']);

// Flüchtiger Anzeigebeleg: keine Erweiterung von Rohdaten oder Exportmetadaten.
export function createProtocolPersonContext(inputs = {}, persons = []) {
    const count = inputs.partner?.aktiv ? 2 : 1;
    return Object.freeze({ partnerActive: count === 2, careEnabled: inputs.pflegefallLogikAktivieren === true,
        persons: Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({
            name: typeof persons[index]?.name === 'string' ? persons[index].name.trim() : ''
        }))) });
}
function personColumns(options) {
    const context = options.personDisplayContext || createProtocolPersonContext(options.inputs);
    return context.persons.map((person, index) => {
        const label = person.name || `Person ${index + 1}`;
        return { id: `person${index + 1}-status`, label, header: label,
            group: 'persons', format: 'person', unit: 'Lebensstatus', visibility: 'display', person: index + 1,
            explanation: `${label}: Lebensstatus, bei aktiver Pflege der Pflegegrad, nach Tod das beobachtete Todesjahr.` };
    });
}
export function getProtocolColumns(options = {}) {
    const source = options.source || 'mc', detailed = options.logDetailLevel === 'detailed';
    const personContext = options.personDisplayContext || createProtocolPersonContext(options.inputs);
    const named = text => text?.replace(/Person ([12])/g, (_, person) => personContext.persons[Number(person) - 1]?.name || `Person ${person}`);
    let columns = PROTOCOL_COLUMNS.filter(column => {
        const h = column.legacyHeader;
        if (column.visibility === 'export') return false;
        if (source === 'backtest' && (column.group === 'care' || column.applicability === 'mc')) return false;
        if (column.group === 'care' && !(source === 'mc' && detailed && options.showCareDetails)) return false;
        if (options.goldAktiv === false && GOLD_HEADERS.has(h)) return false;
        if (['Handl.Bd', 'Bonds/Puffer'].includes(h) && options.strategyMode !== STRATEGY_OPTIONS.THREE_BUCKET_JILGE) return false;
        if (!detailed && !STANDARD_IDS.includes(column.id)) return false;
        if (['year', 'year-status', 'runway', 'household-care', 'equity'].includes(column.id)) return true;
        return Boolean(source === 'backtest' ? column.backtestPath : column.mcPath)
            || ['Pf.Akt%', 'Pf.Gld%', 'Handl.A', 'Handl.G', 'Handl.Bd', 'Bonds/Puffer', 'PflegeΣ'].includes(h);
    });
    if (source === 'mc') columns.push(...personColumns(options));
    const groups = Object.keys(PROTOCOL_GROUPS);
    columns.sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group)
        || (STANDARD_IDS.includes(a.id) ? STANDARD_IDS.indexOf(a.id) : 1000)
            - (STANDARD_IDS.includes(b.id) ? STANDARD_IDS.indexOf(b.id) : 1000));
    return columns.map(column => {
        if (column.id === 'jahresentnahme-real') column = { ...column, label: 'Entnahme aus Vermögen', header: 'Entnahme aus Vermögen' };
        if (column.group !== 'persons' && /Person [12]/.test(column.label)) {
            column = { ...column, label: named(column.label), header: named(column.label), explanation: named(column.explanation) };
        }
        const formatter = (value, entry) => formatProtocolValue(column, value, entry, options);
        const explanation = column.format === 'money'
            ? column.explanation.replaceAll('in nominalen Euro', options.moneyBasis === 'real' ? 'in heutiger Kaufkraft' : 'in nominalen Euro')
                + ` Anzeige: ${options.moneyBasis === 'real' ? 'heutige Euro' : 'nominale Euro'}.` : column.explanation;
        return { ...column, title: `${column.label}. ${explanation}`,
            key: source === 'backtest' ? column.backtestPath : column.mcPath,
            extractor: entry => readProtocolValue(column, entry, options),
            fmt: formatter, valueFormatter: formatter, align: ['text', 'boolean', 'alive', 'grade', 'person'].includes(column.format) ? 'left' : 'right',
            cellClass: entry => {
                if (!['Handl.A', 'Handl.G', 'Handl.Bd'].includes(column.legacyHeader)) return '';
                const value = readProtocolValue(column, entry, options);
                return value > 0 ? 'backtest-trade-sale' : value < 0 ? 'backtest-trade-buy' : '';
            }
        };
    });
}
