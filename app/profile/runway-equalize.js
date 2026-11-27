// @ts-check
/** FR-87: „Reichweite zuerst“ gleicht die operative Liquidität der Personen an (gleicher Bedarfsanteil je Person).
 * `fill` (Auffüllen): Der Betrag geht zuerst an die Person mit der wenigsten Liquidität, bis alle gleich viel haben, dann zu gleichen Teilen.
 * `drain` (Auszahlung): Zuerst zahlt die Person mit der meisten Liquidität, bis alle gleich viel haben, dann zu gleichen Teilen;
 * der Aufrufer begrenzt den Betrag auf die Summe der Liquidität.
 * @param {number[]} levels Liquidität je Person @param {number} amount @param {'fill'|'drain'} [direction] @returns {number[]} Betrag je Person */
export function equalizeLiquidity(levels, amount, direction = 'fill') {
    const sign = direction === 'drain' ? -1 : 1;
    const finite = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
    const start = levels.map(level => sign * finite(level));
    const total = finite(amount);
    const sorted = start.slice().sort((a, b) => a - b);
    let water = 0, sumBelow = 0;
    for (let count = 1; count <= sorted.length; count += 1) {
        sumBelow += sorted[count - 1];
        water = (total + sumBelow) / count;
        if (count === sorted.length || water <= sorted[count]) break;
    }
    return start.map(level => Math.max(0, water - level));
}
