// Usage: node scripts/audit-release-coverage.mjs [manifest] [evidenceRoot]. Exits non-zero until the release is fully accepted.
import {auditReleaseCoverage,releaseCoverageAccepted} from './lib/release-coverage.ts';
const [manifestPath='docs/validation/08-release-matrix.json',evidenceRoot='docs/validation/evidence/08a-final-regression']=process.argv.slice(2);
const r=await auditReleaseCoverage({manifestPath,evidenceRoot});
const accepted=releaseCoverageAccepted({required:r.required,passed:r.passed,criticalFailures:r.criticalFailures,unknownUnclassified:r.unclassified.length})&&!r.unregistered.length&&!r.exceptions.length;
console.log(`Aceite integral: ${accepted?'sim':'não'} (${r.passed}/${r.required})`);
for(const [title,list] of [['Falhas',r.failed],['Bloqueados',r.blocked],['Pendentes',r.pending],['Referência desconhecida, com prova local',r.referenceUnknown],['Desconhecidos sem classificação',r.unclassified],['Páginas fora do registro',r.unregistered],['Exceções',r.exceptions]])
 if(list.length)console.log(`\n${title} (${list.length}):\n`+list.map(i=>'- '+i).join('\n'));
process.exitCode=accepted?0:1;
