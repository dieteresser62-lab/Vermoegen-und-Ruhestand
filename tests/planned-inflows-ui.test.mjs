import { readIncome } from '../app/profile/profile-income.js';
import { applyPersonIncomeToDom, bindPersonIncome } from '../app/tranches/tranchen-manager-income.js';
import { createSelectionDocument, addField } from './designsystem-selection-dom.mjs';
import { setAppTestDate } from '../app/shared/app-clock.js';

setAppTestDate('2026-10-21');
try {
    const doc = createSelectionDocument();
    for (const id of ['profileEinkuenfte', 'profileFixedIncomeRows', 'profileOneTimeIncomeRows', 'profileFixedIncomeAdd', 'profileOneTimeIncomeAdd', 'profilePensionRow', 'profilePensionRemove', 'profileRenteMonatlich', 'profileRentenbeginn', 'profileRentenanpassungArt', 'profileRentenanpassungPct', 'profileIncomeStatus', 'profileIncomeCurrent', 'profileIncomeNext', 'profileIncomeNextLabel', 'profileIncomeOnce']) addField(doc, id);
    const pension = doc.getElementById('profileRenteMonatlich'); pension.value = '1150';
    doc.getElementById('profileRentenbeginn').value = '01.2029';
    const salary = { id: 'salary', art: 'sonstige', bezeichnung: 'Gehalt', betragMonat: 4200, ab: null, bis: '2028-12', anpassung: 'lohn' };
    const occupational = { ...salary, id: 'occupational', bezeichnung: 'Betriebsrente', betragMonat: 180, ab: '2029-01', bis: null, anpassung: 'keine' };
    const once = { id: 'once', monat: '2028-06', betrag: 50000, bezeichnung: 'Rückzahlung' };
    applyPersonIncomeToDom([salary, occupational, once], doc); bindPersonIncome(doc);
    const wageButton = [...doc.getElementById('profileFixedIncomeRows').querySelectorAll('*')].find(button => button.tagName === 'BUTTON' && button.textContent === 'wie Löhne');
    assert(wageButton && wageButton.title.includes('sinkt nominal nie') && wageButton.getAttribute('aria-pressed') === 'true', 'Kurzer Lohnknopf erklärt die Untergrenze im title und bleibt aktiv');
    for (const id of ['income-0-ab', 'income-1-bis']) {
        const open = doc.getElementById(id);
        assertEqual(open.placeholder, '—', 'Gespeicherte offene Einkunftsgrenze zeigt einen Strich');
        open.dispatchEvent({ type: 'focus' });
        assertEqual(open.placeholder, 'MM.JJJJ', 'Bearbeitung zeigt das Monatsformat');
        open.dispatchEvent({ type: 'blur' });
        assertEqual(open.placeholder, '—', 'Verlassen zeigt wieder den Strich');
        assertEqual(open.value, '', 'Der Strich gelangt nicht in den Eingabewert');
    }
    assertEqual(readIncome(doc.getElementById('profileEinkuenfte').value)[0].ab, null, 'Offene Grenze bleibt im Speicher leer');
    assertEqual(doc.getElementById('profileFixedIncomeRows').children.length, 2, 'Feste Einkünfte erscheinen als eigene Zeilen');
    assertEqual(doc.getElementById('profileOneTimeIncomeRows').children.length, 1, 'Einmalige Einkünfte erscheinen darunter');
    assertEqual(doc.getElementById('profileIncomeCurrent').textContent, '4.200 € / Monat', 'Heute zählt nur das Gehalt');
    assertEqual(doc.getElementById('profileIncomeNext').textContent, '1.330 € / Monat', 'Künftige Summe verbindet Rente und Betriebsrente');
    assertEqual(doc.getElementById('profileIncomeOnce').textContent, '50.000 €', 'Dritte Summe zeigt einmalige Einkünfte');
    const edit = (index, key, value) => { const field = doc.getElementById(`income-${index}-${key}`); field.value = value; field.dispatchEvent({ type: 'input' }); };
    edit(0, 'betragMonat', '4300,50');
    assertEqual(readIncome(doc.getElementById('profileEinkuenfte').value)[0].betragMonat, 4300.5, 'Deutscher Eurobetrag bleibt exakt');
    edit(0, 'ab', '01.2030');
    assert(doc.getElementById('income-0-bis-error').textContent.includes('Ende darf nicht vor'), 'Umgekehrter Zeitraum wird erklärt');
    edit(0, 'ab', '');
    assertEqual(doc.getElementById('profileIncomeStatus').textContent, '', 'Leerer Beginn ist erlaubt');
    doc.getElementById('profileOneTimeIncomeAdd').dispatchEvent({ type: 'click' });
    assert(doc.getElementById('income-3-betrag-error').textContent.includes('größer als 0'), 'Neue leere Betragszeile wird geprüft');
    edit(3, 'betrag', '1250'); edit(3, 'monat', '12.2029');
    assertEqual(readIncome(doc.getElementById('profileEinkuenfte').value)[3].monat, '2029-12', 'Monat/Jahr wird kanonisch gespeichert');
    for (const raw of ['7.2028', '07.2028', '07/2028']) {
        edit(3, 'monat', raw); doc.getElementById('income-3-monat').dispatchEvent({ type: 'blur' });
        assertEqual(readIncome(doc.getElementById('profileEinkuenfte').value)[3].monat, '2028-07', raw + ': derselbe kanonische Monat');
        assertEqual(doc.getElementById('income-3-monat').value, '07.2028', raw + ': einheitliche Monatsanzeige');
    }
    doc.getElementById('profileOneTimeIncomeRows').children[1].querySelector('button').dispatchEvent({ type: 'click' });
    assertEqual(readIncome(doc.getElementById('profileEinkuenfte').value).length, 3, 'Entfernen erhält die übrigen Einkünfte');
    doc.getElementById('profilePensionRemove').dispatchEvent({ type: 'click' });
    assertEqual(pension.value, '1150', 'Rentenzeile bleibt vor versehentlichem Entfernen geschützt');
    pension.value = '0'; doc.getElementById('profileRentenbeginn').value = '';
    const type = doc.getElementById('income-1-art'); type.value = 'rente'; type.dispatchEvent({ type: 'change' });
    assertEqual(pension.value, '180', 'Eine feste Zeile kann zur einzigen gesetzlichen Rente werden');
    assertEqual(doc.getElementById('profileRentenbeginn').value, '01.2029', 'Gesetzliche Rente übernimmt den Beginnmonat');
    assertEqual(readIncome(doc.getElementById('profileEinkuenfte').value).filter(entry => entry.art).length, 1, 'Gesetzliche Rente wird nicht zusätzlich in der Liste gespeichert');
    doc.getElementById('profilePensionRemove').dispatchEvent({ type: 'click' });
    pension.value = '0'; doc.getElementById('profileRentenbeginn').value = ''; delete doc.getElementById('profilePensionRow').dataset.added;
    doc.getElementById('profileFixedIncomeAdd').dispatchEvent({ type: 'click' });
    assertEqual(doc.getElementById('income-2-bis').placeholder, 'MM.JJJJ', 'Gerade hinzugefügte Einkunftszeile zeigt das Monatsformat');
    const emptyType = doc.getElementById('income-2-art'); emptyType.value = 'rente'; emptyType.dispatchEvent({ type: 'change' });
    applyPersonIncomeToDom(readIncome(doc.getElementById('profileEinkuenfte').value), doc);
    assert(!doc.getElementById('profilePensionRow').hidden, 'Neue leere Rentenzeile bleibt bis zur Betragseingabe offen');
    doc.getElementById('profileEinkuenfte').disabled = true;
    pension.value = '0'; doc.getElementById('profileRentenbeginn').value = ''; delete doc.getElementById('profilePensionRow').dataset.added;
    doc.getElementById('profileFixedIncomeAdd').dispatchEvent({ type: 'click' });
    assertEqual(readIncome(doc.getElementById('profileEinkuenfte').value).length, 2, 'Schreibsperre schützt auch dynamische Zeilen');
} finally { setAppTestDate(null); }
