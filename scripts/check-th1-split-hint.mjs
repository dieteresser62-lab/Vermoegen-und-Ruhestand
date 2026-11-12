// TH-1: Zählt Tranchen mit Hinweis „Möglicher Split“ in einer Vollsicherung. Ausgabe nur Zählwerte, nie Namen, Kurse oder Fehlertexte.
import { readFile } from 'node:fs/promises';

const output = process.stdout.write.bind(process.stdout);
for (const method of ['log', 'error', 'warn', 'info', 'debug']) console[method] = () => {};
try {
    const { detectPossibleSplit } = await import('../app/tranches/tranche-split-hint.js');
    const { DAILY_PRICES_KEY } = await import('../app/tranches/tranchen-history-store.js');
    const records = JSON.parse(await readFile(process.argv[2], 'utf8'))?.records;
    if (!records || typeof records !== 'object') throw new Error();
    const prices = records[DAILY_PRICES_KEY] ? JSON.parse(records[DAILY_PRICES_KEY]) : { version: 1, symbols: {} };
    const registry = JSON.parse(records.rs_profiles_v1 || '{"profiles":{}}');
    const tranches = Object.values(registry.profiles || {}).flatMap(profile => JSON.parse(profile?.data?.depot_tranchen || '[]'));
    output(JSON.stringify({ profiles: Object.keys(registry.profiles || {}).length, tranches: tranches.length,
        withTicker: tranches.filter(t => t?.ticker).length, priceSymbols: Object.keys(prices.symbols || {}).length,
        splitHints: tranches.filter(t => detectPossibleSplit(t, prices)).length }) + '\n');
} catch {
    output(JSON.stringify({ failures: 1 }) + '\n');
    process.exitCode = 1;
}
