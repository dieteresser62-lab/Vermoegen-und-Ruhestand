// Feste Alltagstexte; Beträge und Zustände stammen ausschließlich aus den Belegen.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const number = value => finite(value) ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value) : 'unbekannt';
const euro = value => finite(value) ? `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value)} €` : 'unbekannt';
const years = count => `${count} ${count === 1 ? 'Jahr' : 'Jahre'}`;
const inYears = count => `in ${count} ${count === 1 ? 'Jahr' : 'Jahren'}`;
const yearLabel = (value, source) => value === null ? 'Jahr unbekannt'
    : source === 'monte_carlo' ? `Simulationsjahr ${value}` : `${value}`;
const when = event => event.year === null ? 'In einem nicht datierten Jahr' : `Im ${event.source === 'monte_carlo' ? 'Simulationsjahr' : 'Jahr'} ${event.year}`;
const range = event => {
    const e = event.evidence;
    return `von ${yearLabel(e.startYear, event.source)} bis ${yearLabel(e.endYear, event.source)}`;
};
const money = e => `${euro(e.amount?.valueEur)} ${e.amount?.moneyBasis === 'real' ? 'in Kaufkraft zum Laufstart' : 'nominal'}`;
const policyNames = { SafetyCapActive: 'Bereitschaft der Leitplanke', SafetyCapApplied: 'Eingriff der Leitplanke',
    SevereFlexEmergencyActive: 'Notfallregel für Flex', Alarm: 'Alarm', safety_stage_current: 'Sicherheitsstufe' };
const status = value => value === true ? 'aktiv' : value === false ? 'inaktiv' : `${value ?? 'unbekannt'}`;

/** Ein Satz und kurze Kartenwerte je Ereignis, ohne HTML oder Ursachenvermutung. */
export function describeLogAnalysisEvent(event) {
    const e = event.evidence, at = when(event);
    const result = (label, valueText, text) => ({ label, valueText, text });
    switch (event.type) {
    case 'floor_covered': return result('Grundbedarf gedeckt', years(e.years), `Der Grundbedarf bleibt in allen ${e.years} abgeschlossenen Finanzjahren dieses Laufs gedeckt.`);
    case 'ruin': return result('Finanzieller Abbruch', yearLabel(event.year, event.source), `${at} endet der Pfad finanziell${e.causeAvailable ? ` mit dem protokollierten Grund „${e.reason}“` : '; ein konkreter Grund ist im Laufbeleg nicht verfügbar'}.`);
    case 'floor_shortfall': return result('Grundbedarf ungedeckt', money(e), `${at} fehlen laut Laufbeleg ${money(e)} zur Deckung des Grundbedarfs.`);
    case 'minimum_flex_held': return result('Mindest-Flex gehalten', '0 Jahre darunter', `Der bezahlte Haushalts-Flex einschließlich Rentenbeitrag liegt in keinem der ${e.years} abgeschlossenen Jahre unter dem angewandten Mindest-Flex.`);
    case 'below_minimum_flex_phase': return result('Unter Mindest-Flex', years(e.durationYears), `Der bezahlte Haushalts-Flex einschließlich Rentenbeitrag liegt ${range(event)} für ${years(e.durationYears)} unter dem angewandten Mindest-Flex, mit bis zu ${euro(e.maximumShortfallNominalEur)} nominalem Fehlbetrag pro Jahr${e.openAtEnd ? ' und noch am Laufende' : ''}.`);
    case 'decision_flex_cut_phase': return result('Flex-Entnahme gekürzt', years(e.durationYears), `Die vorgesehene Flex-Entnahme aus dem Vermögen wird ${range(event)} ${inYears(e.durationYears)} um mindestens 10 % gekürzt, jährlich höchstens ${number(e.maximumAnnualValue)} %${e.openAtEnd ? ' und noch am Laufende' : ''}.`);
    case 'household_flex_cut_phase': return result('Haushalts-Flex gekürzt', years(e.durationYears), `Der Haushalts-Flex wird ${range(event)} auf der ${e.basis === 'static_input' ? 'statischen Wunschbasis' : e.basis === 'effective_vpw_plus_pension_surplus' ? 'dynamischen Basis mit Rentenüberschuss' : `protokollierten Basis „${e.basis}“`} für ${years(e.durationYears)} um mindestens 10 % gekürzt${e.openAtEnd ? ' und noch am Laufende' : ''}.`);
    case 'flex_basis_change': return result('Flex-Bezugsgröße wechselt', yearLabel(event.year, event.source), `${at} wechselt die protokollierte Bezugsgröße des Haushalts-Flex, deshalb werden Kürzungsphasen auf diesen Basen getrennt ausgewiesen.`);
    case 'policy_state_change': return result('Leitplanke oder Alarm', status(e.to), `${at} wechselt ${policyNames[e.field]} von ${status(e.from)} auf ${status(e.to)}.`);
    case 'initial_policy_observation': return result('Beobachteter Sicherheitsstatus', status(e.to), `${at} ist ${policyNames[e.field]} mit „${status(e.to)}“ protokolliert; der Beginn dieses Zustands ist nicht belegt.`);
    case 'market_regime_change': return result('Marktphase wechselt', `${e.from} → ${e.to}`, `${at} wechselt die Marktklassifikation der Engine von „${e.from}“ zu „${e.to}“.`);
    case 'extreme_bear': return result('Extrembär protokolliert', yearLabel(event.year, event.source), `${at} klassifiziert die Engine den Markt als Extrembär.`);
    case 'minimum_real_year_end_wealth': return result('Reales Vermögenstief', euro(e.amountRealEur), `${at} liegt der niedrigste beobachtete Jahresendstand des Gesamtvermögens einschließlich Pflegevorsorge bei ${euro(e.amountRealEur)} in Kaufkraft zum Laufstart${e.missingFinancialYears ? `; für ${years(e.missingFinancialYears)} fehlen reale Werte` : ''}.`);
    case 'real_wealth_recovery': return result('Reales Hoch wieder erreicht', yearLabel(event.year, event.source), `${at} erreicht das Gesamtvermögen erstmals seit Beginn des Rückgangs in ${yearLabel(e.fromYear, event.source)} wieder das frühere reale Hoch von ${euro(e.targetRealEur)}.`);
    case 'real_wealth_unrecovered': return result('Reales Hoch noch nicht erreicht', euro(e.targetRealEur), `Bis ${yearLabel(e.observationEnd, event.source)} wird das frühere reale Hoch von ${euro(e.targetRealEur)} in den zusammenhängend beobachteten Jahresendständen nicht wieder erreicht.`);
    case 'liquidity_below_target': return result('Liquidität unter Ziel', `${number(e.coveragePct)} %`, `${at} deckt die Liquidität nach Transaktionen und vor Auszahlung ${number(e.coveragePct)} % des Ziels${e.runwayMonths !== null ? ` bei ${number(e.runwayMonths)} Monaten Reichweite` : ' bei unbekannter Monatsreichweite'}, das allein belegt keinen Auszahlungsausfall.`);
    case 'forced_liquidity_need': return result('Bedarf vor Notverkäufen', money(e), `${at} sind nach dem Reserveeinsatz und vor Notverkäufen noch ${money(e)} Liquiditätsbedarf protokolliert.`);
    case 'forced_liquidity_coverage': return result('Notfüllung ausgeführt', money(e), `${at} liefern die protokollierten Notverkäufe ${money(e)} zusätzliche Liquidität.`);
    case 'unmet_liquidity': return result('Offener Liquiditätsbedarf', money(e), `${at} bleiben im Anleihetopf-Pfad ${money(e)} Liquiditätsbedarf offen.`);
    case 'health_reserve_use': return result('Pflegereserve verwendet', money(e), `${at} werden ${money(e)} aus der Pflegereserve verwendet.`);
    case 'large_sale': return result('Großer Verkauf', money(e), `${at} werden ${money(e)} verkauft, das sind ${number(e.shareOfPreviousYearEnd * 100)} % des Vorjahresvermögens bei einem Anzeigefilter ab 10 %.`);
    case 'tax_peak': return result('Steuerspitze', money(e), `${at} fallen ${money(e)} Jahressteuer an, mindestens doppelt so viel wie der nominale Laufmedian von ${euro(e.medianTaxNominalEur)} und mehr als 1.000 € nominal.`);
    case 'gold_purchase': return result('Gold gekauft', money(e), `${at} wird Gold für ${money(e)} gekauft.`);
    case 'gold_sale': return result('Gold verkauft', money(e), `${at} wird Gold für ${money(e)}${e.scope === 'regular_only' ? ' im regulären Verkauf' : ''} verkauft.`);
    case 'bond_refill': return result('Anleihetopf aufgefüllt', money(e), `${at} wird der Anleihetopf um brutto ${money(e)} aufgefüllt.`);
    case 'bond_sale': return result('Anleihen verkauft', money(e), `${at} werden Anleihen für ${money(e)} verkauft.`);
    case 'care_phase': return result(`Pflege ${e.personName}`, years(e.durationYears), `${e.onsetObserved ? `Für ${e.personName} beginnt ${at.charAt(0).toLowerCase() + at.slice(1)} die protokollierte Pflegephase` : `Für ${e.personName} ist ${at.charAt(0).toLowerCase() + at.slice(1)} Pflege beobachtet, ihr Beginn ist unbekannt`}; sie umfasst ${years(e.durationYears)}${e.openAtEnd ? ' und dauert am Laufende an' : ''}.`);
    case 'care_grade_change': return result(`Pflegegrad ${e.personName}`, `${e.from} → ${e.to}`, `${at} wechselt der protokollierte Pflegegrad von ${e.personName} von ${e.from} auf ${e.to}.`);
    case 'person_death': return result(`Tod ${e.personName}`, yearLabel(event.year, event.source), `${at} wechselt der protokollierte Lebensstatus von ${e.personName} von lebend auf verstorben.`);
    case 'life_state_observation': return result(`Lebensstatus ${e.personName}`, 'Todesjahr unbekannt', `${at} ist ${e.personName} als verstorben protokolliert; das Todesjahr ist wegen fehlender Vorbeobachtung unbekannt.`);
    case 'household_end': return result('Haushalt endet', yearLabel(event.year, event.source), `${at} endet der Haushalt mit dem Tod aller simulierten Personen.`);
    case 'tail_risk_overlay': return result('Stressschock angewandt', e.eventId ?? 'Modellereignis', `${at} wird der protokollierte Stressschock${e.eventId ? ` „${e.eventId}“` : ''} mit ${number(e.returnShockPct)} % Rendite- und ${number(e.inflationShockPct)} % Inflationsüberlagerung angewandt.`);
    case 'tail_risk_skipped': return result('Stressschock ausgelassen', e.eventId ?? 'Modellereignis', `${at} wird ein vorgesehener Stressschock laut Laufbeleg ausgelassen, mit dem protokollierten Grund „${e.reason}“.`);
    case 'technical_error': return result('Technischer Fehler', yearLabel(event.year, event.source), `${at} endet die auswertbare Beobachtung mit einem technischen Fehler.`);
    default: throw new TypeError(`Unknown log analysis event: ${event.type}`);
    }
}

/** Drei bis sechs Sätze über genau diesen Lauf/Pfad, niemals über eine MC-Population. */
export function summarizeLogAnalysis(model) {
    if (!model.available || model.financialYears === 0) {
        const terminal = model.prioritizedEvents.find(event => ['ruin', 'household_end', 'technical_error'].includes(event.type));
        return [terminal?.text ?? 'Für diese Auswahl liegen keine auswertbaren Finanzjahre vor.',
            'Mindest-Flex und Kürzungsphasen bleiben ohne Jahreswerte unbekannt.',
            'Ein reales Vermögenstief lässt sich ohne belegte Jahresendwerte nicht bestimmen.'];
    }
    const pick = type => model.prioritizedEvents.find(event => event.type === type);
    const sentences = [pick('ruin')?.text ?? pick('floor_shortfall')?.text ?? pick('floor_covered')?.text
        ?? 'Ob der Grundbedarf über den gesamten Lauf gedeckt bleibt, ist aus dem vorhandenen Laufbeleg unbekannt.'];
    sentences.push(model.minimumFlex.missingReason !== null
        ? 'Die Zahl der Jahre unter Mindest-Flex ist wegen fehlender oder nicht auswertbarer Jahreswerte unbekannt.'
        : model.minimumFlex.affectedYearCount === 0 ? pick('minimum_flex_held').text
            : `Der bezahlte Haushalts-Flex einschließlich Rentenbeitrag unterschreitet ${inYears(model.minimumFlex.affectedYearCount)} den angewandten Mindest-Flex.`);
    const longest = pick('decision_flex_cut_phase');
    sentences.push(longest ? longest.text : model.cuts.missingYears
        ? 'Kürzungen der vorgesehenen Flex-Entnahme sind wegen fehlender Werte nicht vollständig auswertbar.'
        : 'Die vorgesehene Flex-Entnahme aus dem Vermögen wird in keinem abgeschlossenen Jahr um mindestens 10 % gekürzt.');
    const low = pick('minimum_real_year_end_wealth');
    sentences.push(low?.text ?? 'Das reale Vermögenstief bleibt wegen fehlender Vermögens- oder Inflationswerte unbekannt.');
    if (model.nominalEndWealth !== null) sentences.push(`Am Ende des letzten abgeschlossenen Finanzjahrs sind ${euro(model.nominalEndWealth)} nominal vorhanden${model.realEndWealth !== null ? `, in Kaufkraft zum Laufstart ${euro(model.realEndWealth)}` : '; der reale Endstand ist unbekannt'}.`);
    const other = pick('liquidity_below_target') ?? pick('forced_liquidity_coverage') ?? pick('tax_peak')
        ?? pick('care_phase') ?? pick('household_end') ?? pick('tail_risk_overlay');
    if (other) sentences.push(other.text);
    return sentences.slice(0, 6);
}
