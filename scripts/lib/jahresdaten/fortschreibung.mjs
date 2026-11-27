/**
 * Fortschreibungsschicht: hängt ein Jahr aus einer Jahreslieferung an eine Ketten-Ausgabe an.
 *
 * Die Rechenregel liefert die Jahreszeile (alle Jahrestabellen der Kette für Y). Danach setzt die Kette
 * Endjahr, letzte Segmente und Wertehashes; der Block `fortschreibung.lieferungen` hält Jahr, SHA-256
 * und Eingangswerte (Y und Anschluss Y−1) jeder angehängten Lieferung fest. Werte vor Y bleiben unverändert (geprüft).
 * Dieselben Funktionen nutzen `--uebernehmen` und die Bauskripte (für Jahre nach dem Grundbestand).
 */
import { lieferungFehler, lieferungLesen } from './lieferung.mjs';
import HISTORICAL_DATENSTAND from '../../../app/simulator/historical-datenstand.js';

/** @param {any} chain @param {string} pfad @returns {Record<string, any>} */
function tabelle(chain, pfad) {
    return pfad.split('.').reduce((node, key) => node?.[key], chain);
}

/**
 * Alle Jahreswerte einer Kette für ein Jahr.
 * @param {import('./ketten.mjs').KettenModul} modul @param {any} chain @param {number} year
 * @returns {Record<string, any>}
 */
export function jahreszeile(modul, chain, year) {
    return Object.fromEntries(modul.KETTE.jahresfelder.map(pfad => [pfad, tabelle(chain, pfad)?.[year]]));
}

/**
 * Eintrag im Fortschreibungsblock.
 * @param {any} lieferung @param {string} sha256 SHA-256 der Datei lieferung.json.
 */
export function fortschreibungsEintrag(lieferung, sha256) {
    return {
        jahr: lieferung.jahr,
        sha256,
        lieferant: lieferung.lieferant,
        status: lieferung.status,
        methode: lieferung.methode,
        quelle: lieferung.quelle.url,
        abrufdatum: lieferung.quelle.abrufdatum,
        veroeffentlichungsstand: lieferung.quelle.veroeffentlichungsstand,
        perioden: lieferung.perioden,
        ...(lieferung.basis ? { basis: lieferung.basis } : {}),
        werte: lieferung.werte,
        anschluss: lieferung.anschluss
    };
}

/** Bricht ab, wenn sich ein Wert vor `year` geändert hat (Soll 4: alte Jahre eingefroren). */
function alteJahreUnveraendert(modul, vorher, nachher, year) {
    for (const pfad of modul.KETTE.jahresfelder) {
        const alt = tabelle(vorher, pfad);
        const neu = tabelle(nachher, pfad);
        const altJahre = Object.keys(alt);
        const neuJahre = Object.keys(neu).filter(key => Number(key) !== year);
        if (altJahre.join() !== neuJahre.join() || altJahre.some(key => JSON.stringify(alt[key]) !== JSON.stringify(neu[key]))) {
            throw new Error(`${modul.KETTE.label}: Die Fortschreibung würde Werte vor ${year} in ${pfad} ändern.`);
        }
    }
}

/**
 * Hängt das Jahr der Lieferung an.
 * @param {import('./ketten.mjs').KettenModul} modul @param {any} chain @param {any} lieferung @param {string} sha256
 * @returns {any} Neue Kette.
 */
export function zeileAnhaengen(modul, chain, lieferung, sha256) {
    const year = lieferung.jahr;
    if (year !== modul.endjahr(chain) + 1) {
        throw new Error(`${modul.KETTE.label}: Jahr ${year} schließt nicht an das Endjahr ${modul.endjahr(chain)} an.`);
    }
    const zeile = modul.zeileBerechnen(chain, lieferung);
    const next = structuredClone(chain);
    for (const pfad of modul.KETTE.jahresfelder) {
        if (!(pfad in zeile)) throw new Error(`${modul.KETTE.label}: Die Rechenregel liefert ${pfad} nicht.`);
        tabelle(next, pfad)[year] = zeile[pfad];
    }
    modul.endjahrSetzen(next, year);
    next.fortschreibung = { lieferungen: [...(chain.fortschreibung?.lieferungen ?? []), fortschreibungsEintrag(lieferung, sha256)] };
    alteJahreUnveraendert(modul, chain, next, year);
    return next;
}

/**
 * Entfernt das letzte Jahr (für die Rückwärtsprobe in einer Wegwerfkopie).
 * @param {import('./ketten.mjs').KettenModul} modul @param {any} chain @param {number} year
 */
export function zeileEntfernen(modul, chain, year) {
    if (year !== modul.endjahr(chain)) throw new Error(`${modul.KETTE.label}: Nur das Endjahr ${modul.endjahr(chain)} lässt sich entfernen.`);
    const next = structuredClone(chain);
    for (const pfad of modul.KETTE.jahresfelder) delete tabelle(next, pfad)[year];
    modul.endjahrSetzen(next, year - 1);
    if (next.fortschreibung) {
        const rest = next.fortschreibung.lieferungen.filter(eintrag => eintrag.jahr !== year);
        if (rest.length) next.fortschreibung.lieferungen = rest;
        else delete next.fortschreibung;
    }
    return next;
}

/**
 * Für die Bauskripte: hängt an den Grundbestand alle übernommenen Jahre bis `endYear` aus den Jahreslieferungen an.
 * Jede Lieferung muss den SHA-256 haben, den der Datenstand bei der Übernahme festgeschrieben hat, und die neu
 * berechnete Jahreszeile muss der übernommenen gleichen. Sonst bricht der Bau ab: Ein Bau schreibt übernommene Jahre
 * nie um; eine Revision ist ein eigener Vorgang. Fehlende, ungültige oder vorläufige Lieferungen brechen ebenfalls ab.
 * @param {import('./ketten.mjs').KettenModul} modul @param {any} grundbestand
 * @param {{root: string, endYear: number, datenstand?: any}} options Datenstand ohne Angabe: der eingebettete.
 */
export function fortschreibungAnwenden(modul, grundbestand, { root, endYear, datenstand = HISTORICAL_DATENSTAND }) {
    let chain = grundbestand;
    const startJahr = modul.endjahr(grundbestand) + 1;
    const uebernommen = startJahr <= endYear ? modul.lesen(root) : null;
    for (let year = startJahr; year <= endYear; year += 1) {
        const gelesen = lieferungLesen(root, modul.KETTE, year);
        const ort = `data/historical/${modul.KETTE.id}/jahre/${year}/lieferung.json`;
        if (!gelesen.vorhanden) throw new Error(`${modul.KETTE.label}: Für ${year} fehlt die Jahreslieferung ${ort}.`);
        const festgeschrieben = datenstand?.seriesHashes?.[modul.KETTE.seriesId]?.lieferungen?.find(eintrag => eintrag.jahr === year);
        if (!festgeschrieben) throw new Error(`${modul.KETTE.label}: ${year} ist laut Datenstand nicht übernommen; zuerst npm run jahresdaten -- ${year} --uebernehmen.`);
        if (gelesen.sha256 !== festgeschrieben.sha256) {
            throw new Error(`${modul.KETTE.label}: Jahreslieferung ${year} weicht vom übernommenen Stand ab (SHA-256 ${gelesen.sha256} statt ${festgeschrieben.sha256}); eine Revision ist ein eigener Vorgang.`);
        }
        const fehler = [gelesen.lesefehler, ...gelesen.rohdatenFehler].filter(Boolean);
        if (!gelesen.lesefehler) fehler.push(...lieferungFehler(gelesen.lieferung, modul.KETTE, year));
        if (gelesen.lieferung?.status !== 'endgueltig') fehler.push('Status ist nicht endgueltig');
        if (fehler.length) throw new Error(`${modul.KETTE.label}: Jahreslieferung ${year} ist nicht verwendbar: ${fehler.join('; ')}.`);
        chain = zeileAnhaengen(modul, chain, gelesen.lieferung, gelesen.sha256);
        if (JSON.stringify(jahreszeile(modul, chain, year)) !== JSON.stringify(jahreszeile(modul, uebernommen, year))) {
            throw new Error(`${modul.KETTE.label}: Die neu berechnete Jahreszeile ${year} weicht von der übernommenen ab; der Bau schreibt übernommene Jahre nicht um.`);
        }
    }
    return chain;
}
