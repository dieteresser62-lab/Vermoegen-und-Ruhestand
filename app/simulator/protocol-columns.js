"use strict";

import { EngineAPI } from '../../engine/index.mjs';
import { STRATEGY_OPTIONS } from '../../types/strategy-options.js';
import { formatDisplayNumber, formatDisplayFixed } from '../shared/designsystem-number-format.js';
import { formatDisplayPercentValue, formatDisplayPercentRatio } from '../shared/shared-formatting.js';
import { protocolAnnualTotals, CARE_COLUMN_EXPLANATIONS } from './protocol-cashflows.js';
import { translateBufferActionText } from '../shared/transaction-display-text.js';

export const PROTOCOL_GROUPS = Object.freeze({ year: 'Jahr / Alter', persons: 'Personen',
    withdrawal: 'Einnahmen und Ausgaben', care: 'Pflege', strategy: 'Strategie', market: 'Marktphase',
    action: 'Handlung', wealth: 'Vermögen am Jahresende' });

// Einziger aktiver Anzeigekatalog. Zugriffe unterscheiden flache MC- und verschachtelte Backtestzeilen.
// Tupel: Kennung, Bezeichnung, Gruppe, Format, MC-Pfad, Backtest-Pfad, Kompatibilitätskopf, Anwendbarkeit, alter MC-Normalmodus.
/** @type {[string, string, string, string, string | null, string | null, string, string, boolean][]} */
const DEFINITIONS = [
    ["year","Jahr","year","integer","jahr","jahr","Jahr","both",true],
    ["runway","Liquidität reicht","strategy","years",null,null,"Runway","both",false],
    ["year-status","Status","market","text",null,null,"Jahresstatus","both",false],
    ["household-care","Pflege","care","text",null,null,"Pflegestatus","both",false],
    ["income-total","Einnahmen","withdrawal","money","einnahmen_gesamt","row.einnahmen_gesamt","Einnahmen","both",true],
    ["expense-total","Ausgaben","withdrawal","money","ausgaben_gesamt","row.ausgaben_gesamt","Ausgaben","both",true],
    ["withdrawal","Laufende Entnahme","withdrawal","money","entscheidung.jahresEntnahme","entscheidung.jahresEntnahme","Entn.","both",true],
    ["floor-brutto","Floor-Bedarf","withdrawal","money","floor_brutto","row.floor_brutto","Floor","both",true],
    ["home-rent","Miete nach Notverkauf","withdrawal","money","wohnmiete","row.wohnmiete","Miete nach Notverkauf","both",false],
    ["rente1","Jahresrente Person 1","withdrawal","money","rente1","row.rente1","Rente1","both",false],
    ["rente2","Jahresrente Person 2","withdrawal","money","rente2","row.rente2","Rente2","both",false],
    ["rentesum","Renten","withdrawal","money","renteSum","row.renteSum","RenteSum","both",true],
    ["other-income","Sonstige Einkünfte","withdrawal","money","sonstige_einkuenfte","row.sonstige_einkuenfte","Sonstige Einkünfte","both",true],
    ["income-saved","davon angelegt","withdrawal","money","einkuenfte_gespart","row.einkuenfte_gespart","davon angelegt","both",false],
    ["widow-income-offset","Kürzung Hinterbliebenenrente","withdrawal","money","WidowIncomeOffset","row.WidowIncomeOffset","Rentenanrechnung","both",false],
    ["planned-expenses","Geplante Ausgaben","withdrawal","money","geplante_ausgaben","row.geplante_ausgaben","Geplante Ausgaben","both",false],
    ["zufluss","Einmalige Einkünfte","withdrawal","money","zufluss","row.zufluss","Zufluss","both",true],
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
    ["jahresentnahme-real","Laufende Entnahme","withdrawal","money","jahresentnahme_real","row.jahresentnahme_real","Entn_real","both",false],
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
    ["handl-bd","Nettohandel Anleihen: positiv = Verkauf, negativ = Kauf","action","money",null,null,"Handl.Bd","both",true],
    ["sale-equity","Aktien verkauft","action","money","vk.vkAkt","row.vk.vkAkt","Vk.Akt","both",false],
    ["sale-bonds","Anleihen verkauft","action","money","vk.vkBnd","row.vk.vkBnd","Vk.Anl","both",true],
    ["steuern-gesamt","Steuern","action","money","steuern_gesamt","row.steuern_gesamt","St.","both",true],
    ["inheritance-outflow","An Erben","action","money","abgang_erben",null,"An Erben","mc",false],
    ["inheritance-tax","Erbschaftsteuer","action","money","erbschaftsteuer",null,"Erbschaftsteuer","mc",false],
    ["residence-tax","Steuer Wohnrecht (§ 23)","action","money","wohnrechtsteuer",null,"Steuer Wohnrecht (§ 23)","mc",false],
    ["home-sale","Immobilienverkauf","action","money","immobilienverkauf","row.immobilienverkauf","Immobilienverkauf","both",false],
    ["home-sale-year","Verkaufsjahr","action","integer","immobilienverkauf_jahr","row.immobilienverkauf_jahr","Immobilienverkauf Jahr","both",false],
    ["equity","Aktien/ETF","wealth","money","wertAktien",null,"ETF","both",true],
    ["gold","Gold","wealth","money","wertGold","wertGold","Gold","both",true],
    ["cash","Liquidität","wealth","money","liquiditaet","liquiditaet","Liq.","both",true],
    ["bonds","Anleihentopf","wealth","money","bondBucketAfter",null,"Bonds/Puffer","both",true],
    ["losscarryend","Verlusttopf am Jahresende","strategy","money","lossCarryEnd","row.lossCarryEnd","VTopf","both",false],
    ["taxsavedbylosscarry","Steuerersparnis durch Verlusttopf","strategy","money","taxSavedByLossCarry","row.taxSavedByLossCarry","StSave","both",false],
    ["liq-before-payout","Liquidität vor Entnahme","strategy","money","liq_before_payout","row.liq_before_payout","Liq>P","both",false],
    ["liq-after-payout","Liquidität nach Entnahme","strategy","money","liq_after_payout","row.liq_after_payout","Liq<P","both",false],
    ["liq-after-interest","Liquidität nach Verzinsung","strategy","money","liq_after_interest","row.liq_after_interest","Liq>Z","both",false],
    ["portfolio-total-before-payout","Gesamtportfolio vor Entnahme","strategy","money","portfolio_total_before_payout","row.portfolio_total_before_payout","Port>P","both",false],
    ["portfolio-active-end","Aktives Portfolio am Jahresende","strategy","money","portfolio_active_end","row.portfolio_active_end","PortAkt","both",false],
    ["total","Geldvermögen","wealth","money","portfolio_total_end","row.portfolio_total_end","PortEnd","both",false],
    ["home-value","Immobilien","wealth","money","immobilien_wert_end","row.immobilien_wert_end","Immobilien","both",false],
    ["total-with-homes","Gesamtvermögen","wealth","money",null,null,"Gesamtvermögen","both",false],
    ["portfolio-flow-delta","Portfolio-Flow-Differenz","strategy","money","portfolio_flow_delta","row.portfolio_flow_delta","FlowΔ","both",false],
    ["tract","Portfoliostand nach Aktionsverkäufen","wealth","money",null,null,"TrAct","both",false],
    ["trpay","Portfoliostand nach Entnahme","wealth","money",null,null,"TrPay","both",false],
    ["trbond","Portfoliostand nach Auffüllung des Anleihentopfs","wealth","money",null,null,"TrBond","both",false],
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
const EXPLANATIONS = Object.freeze({ ...CARE_COLUMN_EXPLANATIONS,
    year: 'Kalenderjahr und Alter aus dem gerechneten Lauf; beim Monte Carlo zusätzlich das Simulationsjahr.',
    market: 'Marktregime dieses Jahres; das historische Samplingjahr ist kein Kalenderjahr.',
    withdrawal: 'Entnahme aus dem Vermögen für Grundbedarf und Flex; feste geplante Ausgaben zählen zum Grundbedarf, einmalige stehen in eigener Spalte',
    'jahresentnahme-real': 'Entnahme aus dem Vermögen für Grundbedarf und Flex; feste geplante Ausgaben zählen zum Grundbedarf, einmalige stehen in eigener Spalte',
    'income-total': 'Renten nach Hinterbliebenen-Anrechnung plus sonstige und einmalige Einkünfte in nominalen Euro. Das ⓘ zeigt die Jahresposten; davon angelegt zählt nicht zusätzlich zur Summe.',
    'expense-total': 'Jahresbedarf mit Pflege (zu Hause Zusatz, im Heim Heimkosten und eigene Ausgaben statt des Grundbedarfsanteils) plus tatsächlich erfüllter Haushalts-Flex und einmalige geplante Ausgaben in nominalen Euro; feste geplante Ausgaben stecken im Grundbedarf. Das ⓘ zeigt die Posten und darunter getrennt, wie viel davon aus dem Vermögen bezahlt wurde: laufende Entnahme plus einmalige geplante Ausgaben.',
    'quoteendpct': 'Vorläufige Entnahme auf Basis der Vorjahres-Flexrate vor Transaktion und Auszahlung; Depot ohne Liquidität und Pflegebucket als Nenner. Prozentpunkte, keine Aktienquote.',
    runway: 'Liquiditätsreichweite nach Transaktion und vor Entnahme: vorhandene Monate geteilt durch zwölf.',
    flexratepct: 'Anteil des gewünschten Flex-Betrags, der ausgezahlt wurde. Prozentpunkte; unter 100 % bedeutet Kürzung.',
    rentesum: 'Summe der Jahresrenten beider Personen in nominalen Euro.',
    'other-income': 'Feste sonstige Nettoeinkünfte aller Personen im Jahr in nominalen Euro.',
    'income-saved': 'Überschuss aus Renten und festen sonstigen Einkünften nach Grundbedarf und Flex, dem persönlichen Tagesgeld gutgeschrieben. Anlage nach den bestehenden Regeln.',
    'widow-income-offset': 'Kürzung der Hinterbliebenenrente durch die eigene gesetzliche Rente oberhalb des Freibetrags; im Todesjahr nur für die letzten drei Monate.',
    'steuern-gesamt': 'Steuern auf die Verkäufe dieses Jahres in nominalen Euro.',
    equity: 'Aktien- und ETF-Bestand am Jahresende; in der Drei-Bucket-Strategie ohne den separat ausgewiesenen Anleihentopf.',
    action: 'Vollständige Aktion und Begründung des Rechenlaufs.',
    total: 'Tagesgeld, Anleihen, Aktien, Gold; damit rechnet die App Entnahmen und Ruin',
    'home-value': 'Wert der Immobilien, die noch im Haushalt sind, wie beim Verkauf angesetzt; wächst mit der Inflation, in heutigen Euro daher gleichbleibend',
    'total-with-homes': 'Geldvermögen plus Immobilien',
    neta: 'Nettohandel Aktien: positiv = Verkauf, negativ = Kauf.',
    netg: 'Nettohandel Gold: positiv = Verkauf, negativ = Kauf.',
    'handl-bd': 'Anleihenverkauf − Auffüllung des Anleihentopfs. Beispiel: 34.504 € verkauft − 30.916 € aufgefüllt = 3.588 € verkauft (netto). Positiv = verkauft, negativ = gekauft.',
    'sale-equity': 'Gebuchte Aktienverkäufe ohne Anleihen, einschließlich zusätzlicher Deckungsverkäufe.',
    'sale-bonds': 'Gebuchte Anleihenverkäufe ohne Aktien, einschließlich zusätzlicher Deckungsverkäufe.'
});
const SHORT_HEADERS = Object.freeze({
    "widow-income-offset": "Rentenanrechnung",
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
    "jahresentnahme-real": "Laufende Entnahme",
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
    "handl-bd": "Anleihenhandel (netto)",
    "bonds": "Anleihentopf",
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
    "trbond": "Stand nach Anleihentopf",
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

/**
 * @param row - Jahreszeile.
 * @param path - Fixierter Replaypfad.
 * @returns Ergebnis der Operation.
 */
export function protocolNestedValue(row, path) {
    if (!path) return undefined;
    return path.split('.').reduce((value, part) => value?.[part], row);
}
/**
 * @param row - Jahreszeile.
 * @param {string} [source] - Quelle des Laufbelegs.
 * @returns Ergebnis der Operation.
 */
export function protocolRowData(row, source = 'mc') { return source === 'backtest' ? row?.row || {} : row || {}; }
/**
 * @param entry - Protokolleintrag.
 * @param {string} [source] - Quelle des Laufbelegs.
 * @returns Ergebnis der Operation.
 */
export function protocolRowFlags(entry, source = 'mc') {
    const row = protocolRowData(entry, source);
    const wish = row.flex_wunsch_haushalt_nominal;
    const reduction = Number.isFinite(wish) && Number.isFinite(row.flex_haushalt_erfuellt)
        ? wish > 0 ? Math.max(0, 100 - row.flex_haushalt_erfuellt / wish * 100) : 0
        : row.entscheidung?.kuerzungProzent ?? entry?.entscheidung?.kuerzungProzent ?? row.flex_haushalt_kuerzung_pct;
    return { ruin: row.recordType === 'terminal_ruin' || row.Regime === 'BANKRUPT' || row.aktionUndGrund === '!!! RUIN !!!',
        cut: Number.isFinite(wish) && wish > 0 && Number.isFinite(reduction) && reduction > 0,
        care: Boolean(row.CareP1_Active || row.CareP2_Active || row.pflege_aktiv) };
}
const finite = value => typeof value === 'number' && Number.isFinite(value);
const tracePhases = { TrAct: 'after_action_sales', TrPay: 'after_payout', TrBond: 'after_bond_refill' };
/**
 * @param column - Kontext für column.
 * @param entry - Protokolleintrag.
 * @param [options] - Optionen des Aufrufers.
 * @returns Ergebnis der Operation.
 */
export function readProtocolValue(column, entry, options = {}) {
    const source = options.source || 'mc', row = protocolRowData(entry, source), h = column.legacyHeader;
    if (column.id === 'total-with-homes') return finite(row.portfolio_total_end) && finite(row.immobilien_wert_end)
        ? row.portfolio_total_end + row.immobilien_wert_end : undefined;
    if (column.id === 'income-total' || column.id === 'expense-total') {
        const totals = protocolAnnualTotals(row);
        return totals[column.id === 'income-total' ? 'einnahmen_gesamt' : 'ausgaben_gesamt'];
    }
    if (column.incomeProfileId !== undefined) return row.sonstige_einkuenfte_personen?.find(person => person.profileId === column.incomeProfileId)?.amount ?? 0;
    const flags = protocolRowFlags(entry, source);
    if (column.id === 'year-status') return flags.ruin ? 'Ruin' : flags.cut ? 'Kürzung' : 'Ohne Kürzung';
    if (column.id === 'household-care') return [1, 2].filter(p => row[`CareP${p}_Active`]).map(p => `Person ${p}${row[`CareP${p}_Grade`] != null ? ` · Pflegegrad ${row[`CareP${p}_Grade`]}` : ''}${row[`CareP${p}_Form`] === 'residential' ? ' · im Heim' : ''}`).join(' / ') || (flags.care ? 'Pflege aktiv' : '—');
    if (column.id === 'runway') return source === 'backtest' && Object.hasOwn(row, 'runway_after_transaction_before_payout_months')
        ? row.runway_after_transaction_before_payout_months : row.runway_after_transaction_before_payout_months ?? entry?.runway_after_transaction_before_payout_months;
    if (h in tracePhases) return row.balance_trace?.find(item => item?.phase === tracePhases[h])?.total;
    if (h === 'Pf.Akt%' || h === 'Pf.Gld%') return row[h === 'Pf.Akt%' ? 'NominalReturnEquityPct' : 'NominalReturnGoldPct'];
    if (h === 'PflegeΣ') return row.CareP1_Cost == null && row.CareP2_Cost == null ? undefined : (row.CareP1_Cost || 0) + (row.CareP2_Cost || 0);
    if (h === 'Handl.A' && options.strategyMode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE
        && (row.vk?.vkAkt != null || row.kaufAkt != null)) {
        return row.vk?.vkAkt == null && row.kaufAkt == null ? undefined
            : (Number(row.vk?.vkAkt) || 0) - (Number(row.kaufAkt) || 0);
    }
    if (h === 'Handl.A' || h === 'Handl.G') {
        if (source === 'backtest') return entry?.[h === 'Handl.A' ? 'netA' : 'netG'];
        const direct = row[h === 'Handl.A' ? 'netTradeEq' : 'netTradeGold'];
        const sale = row.vk?.[h === 'Handl.A' ? 'vkAkt' : 'vkGld'], buy = row[h === 'Handl.A' ? 'kaufAkt' : 'kaufGld'];
        return finite(direct) ? direct : sale == null && buy == null ? undefined : (sale || 0) - (buy || 0);
    }
    if (h === 'Handl.Bd') {
        const sale = row.vk?.vkBnd ?? row.threeBucket?.bondSaleAmount ?? row.bondSaleAmount;
        const buy = row.bondRefillNet ?? row.threeBucket?.bondRefillNet ?? row.bondRefillGross;
        return sale == null && buy == null ? undefined : (Number(sale) || 0) - (Number(buy) || 0);
    }
    if (h === 'Bonds/Puffer') return row.bondBucketAfter ?? row.threeBucket?.bondBucketAfter;
    if (h === 'ETF') {
        const value = source === 'backtest' ? entry?.wertAktien : row.wertAktien;
        const bond = row.bondBucketAfter ?? row.threeBucket?.bondBucketAfter ?? 0;
        return finite(value) ? Math.max(0, value - (options.strategyMode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE ? bond : 0)) : undefined;
    }
    return protocolNestedValue(entry, source === 'backtest' ? column.backtestPath : column.mcPath);
}

/**
 * @param value - Zu prüfender oder darzustellender Wert.
 * @returns {string}
 */
export function translateProtocolText(value) {
    const scenarios = { HEISS: 'Markt heiß gelaufen', ATH: 'Stabiler Höchststand', ERHOLUNG: 'Bestätigte Erholung',
        REC_BÄR: 'Erholung im Bärenmarkt', KORREKTUR: 'Junge Korrektur', BÄR: 'Tiefer Bär', SEITWÄRTS: 'Lange Seitwärtsbewegung' };
    return translateBufferActionText(value).replace(/\b(?:REC_BÄR|HEISS|ATH|ERHOLUNG|KORREKTUR|BÄR|SEITWÄRTS)(?![\p{L}\p{N}_])/gu, key => scenarios[key])
        .replaceAll('Profilverbund-Transaktionen', 'Verkäufe und Käufe je Person')
        .replaceAll('Runway-Notfüllung', 'Liquidität aufgefüllt')
        .replaceAll('(Cap aktiv)', '(begrenzt)').replaceAll('(neutral)', '(unauffälliger Markt)')
        .replaceAll('(Bär)', '(Bärenmarkt)').replaceAll('(3-Bucket)', '(3 Töpfe)')
        .replaceAll('Verkauf für die Auszahlung', 'Für die Entnahme verkauft:').replaceAll('Auszahlung', 'Entnahme')
        .replaceAll('Runway-Überschuss investieren', 'Überschüssige Liquidität anlegen')
        .replaceAll('Bärenmarkt-Auffüllung (Drip)', 'Liquidität im Bärenmarkt schrittweise auffüllen')
        .replaceAll('Opportunistisches Rebalancing (Skim & Fill)', 'Anlagen umschichten und Liquidität auffüllen')
        .replaceAll('Opportunistisches Rebalancing', 'Anlagen bei günstiger Marktlage umschichten')
        .replaceAll('Dynamic-Flex-Obergrenze', 'Obergrenze des dynamischen Flex-Bedarfs')
        .replaceAll('(S)', '(Stagflation)').replaceAll(' (Kein Handlungsbedarf)', ' · kein Handlungsbedarf')
        .replaceAll('!!! RUIN !!!', 'Ruin')
        .replaceAll('MinRW-Refill', 'Mindestreichweite auffüllen').replaceAll('Puffer-Refill', 'Liquiditätspuffer auffüllen')
        .replaceAll('Gesamtvermögen', 'Geldvermögen')
        .replaceAll('Bonds Auffüllen', 'Anleihen auffüllen')
        .replaceAll('Reinvest', 'Wiederanlage').replaceAll('Rebal.(G+)', 'Gold kaufen')
        .replaceAll('Rebal.(G-)', 'Gold verkaufen').replaceAll('Rebal.(A+)', 'Aktien kaufen');
}
/**
 * @param column - Kontext für column.
 * @param value - Zu prüfender oder darzustellender Wert.
 * @param entry - Protokolleintrag.
 * @param [options] - Optionen des Aufrufers.
 * @returns Darstellung der übergebenen Laufdaten.
 */
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
    if (!finite(value)) return column.id === 'runway' ? '—' : '';
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
                const endStock = ['equity', 'gold', 'bonds', 'cash', 'total', 'home-value', 'total-with-homes', 'losscarryend', 'health-bucket-end'].includes(column.id);
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
    if (['histjahr', 'home-sale-year'].includes(column.id)) return String(Math.round(value));
    return formatDisplayNumber(value, { fractionDigits: 0 });
}

const STANDARD_IDS = ['year', 'histjahr', 'person1-status', 'person2-status', 'income-total', 'expense-total',
    'runway', 'market', 'nominalreturnequitypct', 'inflation', 'action', 'inheritance-outflow', 'inheritance-tax', 'residence-tax', 'neta', 'netg', 'handl-bd', 'sale-bonds',
    'equity', 'gold', 'bonds', 'cash', 'total', 'home-value', 'total-with-homes'];
const GOLD_HEADERS = new Set(['Pf.Gld%', 'Handl.G', 'Gold', 'GuardG', 'Gld_vorR', 'Gld_nachR', 'Gld_nachV', 'Gld_nachK']);
const NORMAL_CARE_IDS = new Set(['carep1-cost', 'carep2-cost', 'pflege']);
const DETAIL_CASHFLOW_IDS = ['widow-income-offset', 'zufluss', 'other-income', 'income-saved'];

// Flüchtiger Anzeigebeleg: keine Erweiterung von Rohdaten oder Exportmetadaten.
/**
 * @param [inputs] - Eingaben des Laufes.
 * @param [persons] - Kontext für persons.
 * @returns Aus den übergebenen Daten abgeleitete Ergebnisform.
 */
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

function incomePersonColumns(options) {
    const source = options.source || 'mc', people = new Map();
    for (const person of options.inputs?.simulationPeople || []) people.set(person.profileId, true);
    for (const entry of options.rows || []) for (const person of protocolRowData(entry, source).sonstige_einkuenfte_personen || []) {
        people.set(person.profileId, true);
    }
    return [...people.keys()].map((profileId, index) => {
        const position = options.inputs?.simulationPeople?.findIndex(person => person.profileId === profileId) ?? -1;
        const name = options.personDisplayContext?.persons?.[position >= 0 ? position : index]?.name
            || options.inputs?.simulationPeople?.[position]?.name || `Person ${position >= 0 ? position + 1 : index + 1}`;
        return { id: `other-income-person-${index + 1}`, label: `Sonstige Einkünfte ${name}`, header: `Sonstige · ${name}`,
            group: 'withdrawal', format: 'money', unit: 'EUR', visibility: 'display',
            explanation: 'Feste sonstige Nettoeinkünfte dieser Person im Jahr in nominalen Euro.', incomeProfileId: profileId };
    });
}
/**
 * @param [options] - Optionen des Aufrufers.
 * @returns Ergebnis der Operation.
 */
export function getProtocolColumns(options = {}) {
    const source = options.source || 'mc', detailed = options.logDetailLevel === 'detailed';
    const personContext = options.personDisplayContext || createProtocolPersonContext(options.inputs);
    const named = text => text?.replace(/Person ([12])/g, (_, person) => personContext.persons[Number(person) - 1]?.name || `Person ${person}`);
    const conditional = Object.fromEntries(DETAIL_CASHFLOW_IDS.map(id => [id, detailed]));
    let columns = options.columns ? options.columns.map(column => {
        // Legacy-Spalten erhalten dieselben Gruppen und Kennungen wie der Katalog.
        const catalog = PROTOCOL_COLUMNS.find(item => column.id ? item.id === column.id : item.legacyHeader === column.header);
        return catalog ? { ...catalog, ...column, group: catalog.group,
            header: ['handl-bd', 'bonds'].includes(catalog.id) ? catalog.header : column.header } : column;
    }) : PROTOCOL_COLUMNS.filter(column => {
        const h = column.legacyHeader;
        if (column.visibility === 'export') return false;
        if (['home-value', 'total-with-homes'].includes(column.id)) return Boolean(options.inputs?.home?.length)
            || (options.rows || []).some(entry => Object.hasOwn(protocolRowData(entry, source), 'immobilien_wert_end'));
        if (column.id === 'home-rent') return detailed
            && (options.rows || []).some(entry => Object.hasOwn(protocolRowData(entry, source), 'wohnmiete'));
        if (['inheritance-outflow', 'inheritance-tax'].includes(column.id)
            && !(options.rows || []).some(entry => Object.hasOwn(protocolRowData(entry, source), 'abgang_erben'))) return false;
        if (column.id === 'residence-tax') return (options.rows || []).some(entry => Object.hasOwn(protocolRowData(entry, source), 'wohnrechtsteuer'));
        if (['home-sale', 'home-sale-year'].includes(column.id)) return (options.rows || [])
            .some(entry => Object.hasOwn(protocolRowData(entry, source), 'immobilienverkauf'));
        if (source === 'backtest' && (column.group === 'care' || column.applicability === 'mc')) return false;
        if (column.group === 'care' && !detailed
            && !(source === 'mc' && options.showCareDetails && NORMAL_CARE_IDS.has(column.id))) return false;
        if (options.goldAktiv === false && GOLD_HEADERS.has(h)) return false;
        if (['Handl.Bd', 'Bonds/Puffer', 'Vk.Anl'].includes(h) && options.strategyMode !== STRATEGY_OPTIONS.THREE_BUCKET_JILGE) return false;
        if (!detailed && column.group !== 'care' && !STANDARD_IDS.includes(column.id)) return false;
        if (['year', 'year-status', 'runway', 'household-care', 'equity'].includes(column.id)) return true;
        return Boolean(source === 'backtest' ? column.backtestPath : column.mcPath)
            || ['Pf.Akt%', 'Pf.Gld%', 'Handl.A', 'Handl.G', 'Handl.Bd', 'Bonds/Puffer', 'PflegeΣ'].includes(h);
    });
    if (!options.columns && source === 'mc') columns.push(...personColumns(options));
    if (!options.columns && detailed) columns.push(...incomePersonColumns(options));
    for (const id of (!options.columns || columns.some(column => column.group === 'withdrawal') ? ['income-total', 'expense-total'] : [])) {
        if (!columns.some(column => column.id === id)) columns.push(PROTOCOL_COLUMNS.find(column => column.id === id));
    }
    // Zusatzspalten gehen vor der gemeinsamen Sortierung durch dieselbe Auswahl.
    for (const [id, visible] of Object.entries(conditional)) {
        if (visible && !columns.some(column => column.id === id)) columns.push(PROTOCOL_COLUMNS.find(column => column.id === id));
    }
    columns = columns.filter(column => (!Object.hasOwn(conditional, column.id) || conditional[column.id])
        && (detailed || column.group !== 'withdrawal' || ['income-total', 'expense-total'].includes(column.id))
        && column.visibility !== 'export'
        && !PROTOCOL_COLUMNS.some(item => item.id === column.id && item.visibility === 'export')
        && !(source === 'backtest' && ['care', 'persons'].includes(column.group)));
    const groups = Object.keys(PROTOCOL_GROUPS);
    const rank = column => {
        if (column.id === 'home-value') return STANDARD_IDS.indexOf('total') + .1;
        if (column.id === 'total-with-homes') return STANDARD_IDS.indexOf('total') + .2;
        const incomeOrder = ['income-total', 'expense-total', 'withdrawal', 'rentesum', 'rente1', 'rente2', 'other-income', 'zufluss', 'planned-expenses', 'income-saved', 'widow-income-offset'];
        if (incomeOrder.includes(column.id)) return incomeOrder.indexOf(column.id) - incomeOrder.length;
        if (column.incomeProfileId !== undefined) return -0.5;
        const standard = STANDARD_IDS.indexOf(column.id);
        if (standard !== -1) return standard;
        const detail = PROTOCOL_COLUMNS.findIndex(item => item.id === column.id);
        return STANDARD_IDS.length + (detail === -1 ? PROTOCOL_COLUMNS.length : detail);
    };
    columns.sort((a, b) => groups.indexOf(a.group || 'strategy') - groups.indexOf(b.group || 'strategy')
        || rank(a) - rank(b));
    return columns.map(column => {
        if (column.id === 'total') column = { ...column, header: 'Geldvermögen', exportHeader: 'PortEnd' };
        if (column.id === 'zufluss') column = { ...column, label: 'Einmalige Einkünfte', header: 'Einmalige Einkünfte', exportHeader: 'Zufluss' };
        if (column.id === 'withdrawal') column = { ...column, exportHeader: 'Entnahme' };
        if (column.id === 'jahresentnahme-real') column = { ...column, label: 'Laufende Entnahme', header: 'Laufende Entnahme', exportHeader: 'Entnahme aus Vermögen' };
        if (column.group !== 'persons' && /Person [12]/.test(column.label)) {
            column = { ...column, label: named(column.label), header: named(column.label), explanation: named(column.explanation) };
        }
        const formatter = (value, entry) => formatProtocolValue(column, value, entry, options);
        const explanation = column.format === 'money'
            ? (column.explanation || '').replaceAll('in nominalen Euro', options.moneyBasis === 'real' ? 'in heutiger Kaufkraft' : 'in nominalen Euro')
                + ` Anzeige: ${options.moneyBasis === 'real' ? 'heutige Euro' : 'nominale Euro'}.` : column.explanation;
        return { ...column, title: column.title || `${column.label || column.header}. ${explanation || ''}`,
            key: column.key ?? (source === 'backtest' ? column.backtestPath : column.mcPath),
            extractor: column.extractor || (entry => readProtocolValue(column, entry, options)),
            fmt: column.fmt || formatter, valueFormatter: column.valueFormatter || formatter,
            align: column.align || (['text', 'boolean', 'alive', 'grade', 'person'].includes(column.format) ? 'left' : 'right'),
            cellClass: column.cellClass || (entry => {
                if (!['Handl.A', 'Handl.G', 'Handl.Bd'].includes(column.legacyHeader)) return '';
                const value = readProtocolValue(column, entry, options);
                return value > 0 ? 'backtest-trade-sale' : value < 0 ? 'backtest-trade-buy' : '';
            })
        };
    });
}
