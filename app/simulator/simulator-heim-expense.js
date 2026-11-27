// @ts-check
/** NK-3 (FR-84 Punkte 18, 19 und 21): Einmalausgaben bei Unverheirateten mit einer oder zwei Personen im Heim. Das Geld einer Person im
 * Heim geht zuerst in ihr Heim und ihre eigene Steuer; danach zahlt es höchstens ihren eigenen Anteil an einer Einmalausgabe, nie den
 * Anteil des Partners. Der Partner zahlt aus seinem Geld nach seiner Steuer und Schuld. Ohne Person im Heim ändert sich nichts. */
import { personalAssetValues } from './simulator-unmarried.js';
import { payableLiquidity } from './simulator-personal-accounts.js';
import { personalTaxStillDue } from './simulator-personal-tax.js';
import { openTaxDebt } from './simulator-tax-debt.js';

/** @param {any[]|null|undefined} shares Anteile aus `unmarriedYearShares` (`residential` bei jeder Person im Heim).
 * @param {any} portfolio Veränderlicher Portfoliozustand. */
export function heimExpenseRules(shares, portfolio) {
    const rows = shares || [];
    const ids = rows.filter(row => row.residential).map(row => /** @type {string} */ (row.profileId));
    const others = rows.filter(row => !row.residential).map(row => /** @type {string} */ (row.profileId));
    const share = (/** @type {string} */ id) => Math.max(0, Number(rows.find(row => row.profileId === id)?.share) || 0);
    const tax = (/** @type {string} */ id, /** @type {'wealth'|'liquidity'} */ stage) => openTaxDebt(portfolio, id) + personalTaxStillDue(portfolio, id, stage === 'wealth');
    const carePaid = (/** @type {string} */ id, /** @type {Map<string, number>|null} */ careCut) => Math.max(0, (Number(rows.find(row => row.profileId === id)?.care) || 0)
        - (careCut?.get(id) || 0));
    /** Geld einer Person im Heim nach ihrem selbst bezahlten Heim: vor der Auszahlung ihr Geldvermögen ohne Pflege-Rücklage (`wealth`) oder
     * ihre Liquidität (`beforePayout`), nach der Auszahlung ihre Liquidität (`liquidity`). */
    const own = (/** @type {string} */ id, /** @type {'wealth'|'beforePayout'|'liquidity'} */ stage, /** @type {Map<string, number>|null} */ careCut) => stage === 'wealth'
        ? (personalAssetValues(portfolio, { includeReserve: false }).find((/** @type {any} */ row) => row.profileId === id)?.value || 0) - carePaid(id, careCut)
        : payableLiquidity(portfolio, id) - (stage === 'beforePayout' ? carePaid(id, careCut) : 0);
    /** Geld der Personen im Heim, das nicht ihren eigenen Anteil an Einmalausgaben in Höhe von `total` zahlt (auch ihre Steuer und Schuld).
     * @param {'wealth'|'beforePayout'|'liquidity'} stage @param {number} total @param {Map<string, number>|null} [careCut] */
    const heimExcess = (stage, total, careCut = null) => ids.reduce((sum, id) => {
        const money = own(id, stage, careCut), taxes = tax(id, stage === 'wealth' ? 'wealth' : 'liquidity');
        return sum + money - Math.min(Math.max(0, money - taxes), share(id) * total);
    }, 0);
    /** Was vom Geld des Haushalts nach Grundbedarf und Pflege für Einmalausgaben in Höhe von `total` nicht zur Verfügung steht: Steuer und
     * Schuld der übrigen Personen und `heimExcess`. @param {'wealth'|'liquidity'} stage @param {number} total @param {Map<string, number>|null} [careCut] */
    const unavailable = (stage, total, careCut = null) => others.reduce((sum, id) => sum + tax(id, stage), 0) + heimExcess(stage, total, careCut);
    return { ids, others, active: ids.length > 0, heimExcess, unavailable };
}
