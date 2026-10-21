// Explicit versions whose exec/schema/isolation flags have been inspected.
export function verifiedCodexVersion(version:string){
  return ['codex-cli 0.163.0-alpha.10.2','codex-cli 0.163.0-alpha.11'].includes(version);
}
