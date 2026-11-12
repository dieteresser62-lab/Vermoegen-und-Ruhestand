// PE-1/MP-1: Ursprüngliche Protokollreihenfolge, einschließlich optionaler Gruppen.
// Die drei frühen Gruppen werden dynamisch vorangestellt, unbekannte Felder erhalten.
const LOG_FIELD_ORDER = Object.freeze(`
entscheidung FlexRatePct MinFlexRatePct minimumFlexAnnual flex_wunsch_haushalt_nominal flex_unter_mindestflex
minimumFlexStatus minimumFlexBlockReason minimumFlexStatusBeforeSafetyOverride minimumFlexRequiredRate
minimumFlexEffectiveBefore minimumFlexEffectiveAfter minimumFlexApplicable minimumFlexEffectiveFinal
minimumFlexShortfallAnnual minimumFlexFulfilled SafetyCapActive SafetyCapFlexRatePct
SafetyCapEffectiveFlexRatePct SafetyCapRawCandidateFlexRatePct SafetyCapSource SafetyCapAnchorStage
SafetyCapApplied SafetyCapDeferredByRateLimit FinalLimitingPolicy SevereFlexEmergencyActive MarketExtremeBear
RealTotalWealthDrawdownPct RealTotalWealthDrawdownThresholdPct MinimumFlexOverrideAllowed
AlarmActiveDiagnostic WithdrawalBurdenFactor AlarmWealthSufficient AlarmWealthSufficientThreshold
WithdrawalBurdenGateRole ProtectedPortfolioWithdrawalAnnual ProtectedPortfolioWithdrawalRatePct
ProtectedPortfolioWithdrawalRateThresholdPct ProtectedPortfolioWithdrawalCapacityCritical
ProtectedPortfolioWithdrawalGateRole BaseAlarmCutPct EffectiveAlarmCutPct FloorProtectionPolicy WealthRedF
WealthQuoteUsedPct CutReason Alarm Regime QuoteEndPct RunwayCoveragePct RunwayMeasurementPhase
RunwayCoveragePostPayoutEndOfYearPct RunwayTargetRawMonths RunwayTargetSmoothedMonths
RunwayTargetSmoothingApplied RunwayTargetSmoothingFallback RunwayTargetSeverityPct RunwayTargetHardMinMonths
RealReturnEquityPct RealReturnGoldPct NominalReturnEquityPct NominalReturnGoldPct entnahmequote entnahme_plan
entnahme_effektiv vpw_total vpw_dynamic_flex static_flex_baseline safety_stage_current safety_score
safety_risk_streak safety_stable_streak safety_transition safety_runway_pre_months
runway_after_transaction_before_payout_months safety_runway_after_transaction_before_payout_months
safety_runway_post_months runway_post_payout_end_of_year_months safety_real_drawdown_pct liq_before_payout
liq_after_payout liq_after_interest portfolio_total_before_payout portfolio_active_end portfolio_flow_delta
tax_cash_adjustment cash_interest_taxable_signed cash_interest_tax_delta stressReplayTransactionDiagnostics
balance_trace health_bucket_enabled health_bucket_start health_bucket_triggered health_bucket_reason
health_bucket_eligible_need health_bucket_used health_bucket_uncovered_need health_bucket_interest
health_bucket_end health_bucket_target_nominal health_bucket_target_inflation_adjusted
health_bucket_real_coverage_pct health_bucket_target_gap health_bucket_warning portfolio_total_end
steuern_gesamt vk kaufAkt kaufGld wertAktien wertGold liquiditaet eq_before_return eq_after_return
eq_after_sales eq_after_buys gold_before_return gold_after_return gold_after_sales gold_after_buys netTradeEq
executedSaleEq wertAktienEnthaeltAnleihen executedSaleAkt executedSaleAnl liqStart personalPayout
personalPayoutSales personAccounts personalTaxModel tax_funding_sale_gross cashInterestEarned liqEnd
liq_post_payout_end_of_year zielLiquiditaet bondBucketAfter bondRefillGross bondRefillNet bondRefillTax
bondSaleAmount aktionUndGrund usedSPB floor_brutto pflegegeld pflegegeld_personen sonstige_einkuenfte
sonstige_einkuenfte_personen einkuenfte_gespart einkuenfte_gespart_personen pension_annual rente1 rente2
renteSum floor_aus_depot flex_brutto flex_erfuellt_nominal flex_brutto_haushalt flex_rentenueberschuss
flex_aus_depot_bedarf flex_haushalt_basis flex_aus_depot_erfuellt flex_haushalt_erfuellt
flex_haushalt_kuerzung_pct inflation_factor_cum jahresentnahme_real pflege_aktiv pflege_zusatz_floor
pflege_zusatz_floor_delta pflege_flex_faktor pflege_kumuliert pflege_grade pflege_grade_label
pflege_delta_flex WidowBenefitP1 WidowBenefitP2 NeedLiq GuardGold GuardEq GuardNote Person1Alive Person2Alive
lossCarryEnd taxSavedByLossCarry pflege_floor_anchor pflege_maxfloor_anchor pflege_cap_zusatz CareP1_Active
CareP1_Cost CareP1_Grade CareP1_GradeLabel CareP2_Active CareP2_Cost CareP2_Grade CareP2_GradeLabel
CareP1_FamilyFallback CareP2_FamilyFallback grundbedarf_zu_hause pflege_heimkosten pflege_heim_eigene_ausgaben
CareP1_Form CareP1_HeimBestand CareP1_HeimJahr CareP1_HeimZuschuss CareP1_HeimKosten CareP1_HeimEigeneAusgaben
CareP2_Form CareP2_HeimBestand CareP2_HeimJahr CareP2_HeimZuschuss CareP2_HeimKosten CareP2_HeimEigeneAusgaben threeBucket
`.trim().split(/\s+/));

/**
 * @param target
 * @param key
 * @param value Zu prüfender oder darzustellender Wert.
 * @returns {void}
 */
export function copyLogField(target, key, value) {
    // Object spread erzeugte auch für diesen Namen eine eigene Datenproperty.
    if (key === '__proto__') Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
    else target[key] = value;
}

/**
 * @template T
 * @param {T & object} logData
 * @param [earlyGroups]
 * @returns {T} Gleiche eigene Felder in der öffentlichen Reihenfolge.
 */
export function restoreSimulatorLogOrder(logData, earlyGroups = []) {
    const ordered = /** @type {T & object} */ ({});
    const append = key => {
        if (Object.hasOwn(logData, key) && !Object.hasOwn(ordered, key)) copyLogField(ordered, key, logData[key]);
    };
    for (const source of earlyGroups) if (source) for (const key of Object.keys(source)) append(key);
    for (const key of LOG_FIELD_ORDER) append(key);
    for (const key of Object.keys(logData)) append(key);
    return ordered;
}
