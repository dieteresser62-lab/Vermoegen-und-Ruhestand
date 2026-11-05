/** @import * as CoreTypes from '../../typcheck/rechenkern.js' */
import { rng } from './simulator-utils.js';

/** Opt-in: Originalstrom unverändert aufzeichnen, Variante nach Zweck/Jahr abspielen.
 * Pflege-Forks behalten ihren eigenen Strom. Nach Ausgangsruin fehlende Marktjahre
 * kommen aus einem getrennten Fortsetzungsstrom; Todesziehungen bleiben aufgezeichnet.

 * @param {CoreTypes.Random} source @param {CoreTypes.ComparisonPairing | null} pairing
 * @param {number} runIndex @param {number} runSeed @returns {CoreTypes.Random} */
export function comparisonRandomSource(source, pairing, runIndex, runSeed) {
    if (!pairing) return source;
    const recording = pairing.mode === 'record';
    if (recording) pairing.tapes.set(runIndex, new Map());
    const tape = pairing.tapes.get(runIndex);
    if (!tape) throw new Error('Vergleich nicht möglich: Zufallsziehungen des Ausgangslaufs fehlen.');
    let phase = 'initial';
    const positions = new Map();
    const continuation = rng(runSeed).fork('DECISION_COMPARISON_MARKET_CONTINUATION');
    /** @param {CoreTypes.Random | null} generator @param {string | null} [fixedKey] @returns {CoreTypes.Random} */
    const wrap = (generator, fixedKey = null) => {
        const next = () => {
            const key = fixedKey || phase;
            const index = positions.get(key) || 0;
            positions.set(key, index + 1);
            if (recording) {
                if (!tape.has(key)) tape.set(key, []);
                const value = generator();
                tape.get(key).push(value);
                return value;
            }
            if (!tape.has(key) && key.startsWith('market:')) tape.set(key, []);
            const values = tape.get(key);
            if (values && index < values.length) return values[index];
            // Nur Marktfortsetzung nach Ausgangsruin darf zusätzliche Werte benötigen.
            if (key.startsWith('market:') && pairing.continuationYears.get(runIndex) <= Number(key.slice(7))) {
                const value = continuation();
                values.push(value);
                return value;
            }
            throw new Error(`Vergleich nicht möglich: abweichende Zufallsziehung (${key}, Lauf ${runIndex + 1}).`);
        };
        next.fork = label => wrap(recording ? generator.fork(label) : null, `fork:${label}`);
        return next;
    };
    const next = wrap(source);
    next.comparisonPhase = value => { phase = value; };
    return next;
}
