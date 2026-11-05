// Kompakter Beleg aus vollständigen Ergebnisprüfsummen; keine Rohwertfilter.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
const [beforeFile,afterFile,output,beforeRevision,...sensitivityFiles]=process.argv.slice(2);
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const before=read(beforeFile),after=read(afterFile);
assert.deepEqual(before.parameters,after.parameters);
assert.equal(before.parameters.anzahl,2000);assert.equal(before.parameters.seed,12345);
assert.equal(before.testDate,'2026-10-23');assert.equal(after.testDate,before.testDate);
const compatibility={};
for(const key of ['sophie','noHome','helga-werner']) {
    assert.deepEqual(before.scenarios[key],after.scenarios[key],`${key}: vollständige MC-Chunks und Backtests bytegleich`);
    compatibility[key]={ mc:before.scenarios[key].sha256,
        backtests:before.scenarios[key].counterchecks.map(check=>({ period:check.period,sha256:check.sha256,outcome:check.outcome })) };
}
assert.deepEqual(before.compatibility,after.compatibility,'Balance und Parität bytegleich');
Object.assign(compatibility,before.compatibility);
for(const key of ['renate','muster','gross']) {
    assert.equal(before.scenarios[key].inputsSha256,after.scenarios[key].inputsSha256,`${key}: unveränderte vollständige Eingaben`);
    assert.equal(after.scenarios[key].ruinWithHome,0,`${key}: kein Ruin mit verbliebener Immobilie`);
}
const sensitivity={};
const definitions=[['threshold07',.7,.04],['threshold13',1.3,.04],['rent028',1,.028],['rent052',1,.052]];
for(const [i,file] of sensitivityFiles.entries()) {
    const data=read(file),[key,thresholdYears,rentRate]=definitions[i];
    assert.deepEqual(data.parameters,after.parameters);
    for(const household of ['renate','muster']) {
        assert.equal(data.scenarios[household].inputsSha256,after.scenarios[household].inputsSha256);
        assert.equal(data.scenarios[household].ruinWithHome,0);
    }
    sensitivity[key]={ thresholdYears,rentRate,scenarios:data.scenarios };
}
for(const side of [before,after]) for(const [key,data] of Object.entries(side.scenarios)) {
    for(const check of data.counterchecks) {
        if(check.period==='1925–1999') {
            assert.equal(check.outcome,'incomplete');assert.equal(check.ruin,null);
            assert.equal(check.incompleteReason.bounds.startYear,1929);
        } else assert(['completed','ruin'].includes(check.outcome),`${key}/${check.period}: auswertbare Gegenprobe`);
    }
}
const evidence={ synthetic:true,beforeRevision,testDate:after.testDate,parameters:after.parameters,
    basis:'Renate Wohnung 300000 EUR, heute PG3; Max/Erika unverheiratet, Haus 800000 EUR bei Max, Immobilien und Steuer + 0 % Geld. Groß 3 Mio. EUR Geld 90/10, Haus 800000 EUR bei Max, Erika heute PG2, gleiche Erbwahl. Groß und Max/Erika Standard ohne Anleihen; Renate 3 Töpfe mit 145000 EUR Anleihen. Pflege an, Marktregime, 35 Jahre. Endvermögen real. Mietmedian: erste aktive Jahresmiete pro Notverkaufspfad in heutigen Euro, ohne Fälle mit sofort entfallener Miete. Kalenderjahr des ersten Notverkaufs. Vorherige Ruin-Pfade mit Immobilien berücksichtigen nur im Haushalt verbliebene Anteile.',
    historicalLimitation:'1925–1999 ist im bestehenden Datenvertrag nicht ausführbar: vier Vorjahre fehlen, erster Start 1929. Zusätzlich Gegenproben 1929–1963 und 1965–1999 mit je 35 Jahren innerhalb des unabhängigen Zeitraums. Der gesamte 71-Jahreslauf ab 1929 wäre für die älteren Musterpersonen außerhalb der Engine-Altersgrenze. Keine erfundenen Daten oder geänderten Altersannahmen.',
    checks:{ monteCarlo2000:true,independentHistoricalPeriod:true,sensitivityPlusMinus30:sensitivityFiles.length===4,requested1925Backtest:false },
    before,after,sensitivity,compatibility };
writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({ checks:evidence.checks,compatibility },null,2));
