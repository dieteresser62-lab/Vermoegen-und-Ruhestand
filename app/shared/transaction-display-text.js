/** Nur die Handelsanzeige: Rundungsreste unter einem halben Cent sind null.
 *
 * @param value Zu verarbeitender Wert.
 * @returns {number} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function displayTradeAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && Math.abs(amount) >= .005 ? amount : 0;
}

/** Deutsche Darstellung von Handlungstexten.
 *
 * @param value Zu verarbeitender Wert.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function translateBufferActionText(value) {
    return String(value ?? '')
        .replaceAll('Notfall-Verkauf (Puffer-Auffüllung)', 'Tagesgeld bis zum Mindestpuffer aufgefüllt')
        .replaceAll('Notfall-Verkauf (Puffer-Sicherung)', 'Tagesgeld-Mindestpuffer gesichert')
        .replaceAll('Notfall-Refill', 'Tagesgeld bis zum Mindestpuffer aufgefüllt');
}

// TX-2: Englische Restwörter aus Engine-Texten in die eingeführten deutschen Begriffe (Glossar, Jahresbudget, Handlungsanweisung).
// Genauere Wendungen stehen vor den allgemeinen Wörtern.
const ENGINE_TERMS = [
    ['Glättung (Final-Guardrail)', 'Letzte Änderungsgrenze'], ['Guardrail (Bären-Cap)', 'Bärenmarkt-Obergrenze'],
    ['Guardrail (Runway-Cap)', 'Liquiditäts-Obergrenze'], ['Flex-Budget (Cap)', 'Flex-Budget'],
    ['Safety-Cap (schwere Flex-Notlage)', 'Schwere Flex-Notlage'], ['Safety-Cap', 'Sicherheitsgrenze'],
    ['Safety-Obergrenze', 'Sicherheitsgrenze'], ['Safety-Ziel', 'Ziel der Sicherheitsgrenze'],
    ['Dynamic-Flex Safety', 'Dynamic-Flex-Sicherheitsstufe'], ['Dynamic-Flex Re-Entry', 'Dynamic-Flex-Rückkehr'], ['(Blend ', '(Mischung '],
    ['Vorsicht beim Budget-Floor', 'Vorsicht bei der Budgetuntergrenze'], ['Budget-Floor Deckung', 'Deckung der Budgetuntergrenze'],
    ['Budget-Floor', 'Budgetuntergrenze'], ['Puffer-Schutz (Floor-Fill)', 'Puffer-Schutz (Grundbedarf)'],
    ['Netto-Floor', 'Netto-Grundbedarf'], ['Floor-Anteil', 'Grundbedarfsanteil'],
    ['Recovery-Cap', 'Erholungsregel'], ['Safe-Wert', 'sicheren Wert'],
    ['Alarm-Deeskalation (Recovery)', 'Alarm-Deeskalation (Erholung)'], ['Alarm-Deeskalation (Peak)', 'Alarm-Deeskalation (Höchststand)'],
    ['Vermögens-Peak', 'Vermögens-Höchststand'], ['ATH-Abstand', 'Abstand zum Allzeithoch'], ['ATH-Daten', 'Allzeithoch-Daten'],
    ['neutraler Fallback', 'neutraler Ersatzwert'], ['Cap wirksam', 'Obergrenze wirksam'], ['(Cap aktiv)', '(begrenzt)'],
    ['Notfall-Cap', 'Notfall-Obergrenze'], ['-> Cap', '-> Obergrenze'], ['nach Capping', 'nach Begrenzung'],
    ['Bärenmarkt-Auffüllung (Drip)', 'Bärenmarkt-Auffüllung'], ['Surplus Rebalancing', 'Überschuss anlegen'], ['(3-Bucket)', '(3 Töpfe)'],
    ['Realer Drawdown', 'Realer Rückgang'], ['Drawdown', 'Rückgang'],
    ['Runway-Notfüllung', 'Notauffüllung'], ['Runway-Überschuss investieren', 'Überschüssige Liquidität anlegen'],
    ['des Runway-Ziels', 'der Zielreichweite'], ['Runway-Ziel', 'Zielreichweite'], ['Runway-Deckung', 'Reichweitendeckung'],
    ['Runway-Sicherung', 'Reichweitensicherung'], ['Mindest-Runway', 'Mindestreichweite'], ['Runway-Minimum', 'Mindestreichweite'],
    ['Guardrails', 'Leitplanken'], ['Guardrail', 'Leitplanke']
];

/** Deutsche Begriffe für die Darstellung von Engine-Texten.
 *
 * @param value Zu verarbeitender Wert.
 * @returns {string} Anzeigetext mit deutschen Begriffen.
 */
export function translateEngineTerms(value) {
    let text = String(value ?? '');
    for (const [term, label] of ENGINE_TERMS) text = text.replaceAll(term, label);
    return text.replace(/\bRunway\b/g, 'Reichweite').replace(/\bFloor\b/g, 'Grundbedarf');
}
