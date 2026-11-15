// One AI agent per module. All share the platform provider; each owns its operations, instructions and (optionally) its model.
export const AI_OPERATIONS=['qualify','decisors','company-people','planning','linkedin-comment','assistant-answer','sdr-turn','sdr-simulation','sdr-search-plan'] as const;
export type AiOperation=typeof AI_OPERATIONS[number];
export type AiAgentId='prospecting'|'linkedin'|'assistant'|'sdr';
export const AI_AGENTS:Record<AiAgentId,{label:string;operations:readonly AiOperation[];instructions:readonly string[]}>={
 prospecting:{label:'Prospecção',operations:['qualify','decisors','company-people','planning'],instructions:['src/domain/ai-skills.ts','src/server/prospecting/ai/output.ts','src/server/prospecting/ai/decisors.ts','src/server/planning/prompts.ts']},
 linkedin:{label:'LinkedIn',operations:['linkedin-comment'],instructions:['src/server/linkedin/comment-prompt.ts']},
 assistant:{label:'Assistente',operations:['assistant-answer'],instructions:['src/server/assistant/prompt.ts']},
 sdr:{label:'Agente SDR',operations:['sdr-turn','sdr-simulation','sdr-search-plan'],instructions:['src/domain/sdr-turn.ts']},
};
export const AI_AGENT_IDS=Object.keys(AI_AGENTS) as AiAgentId[];
export function assertAgentOperation(agent:AiAgentId,operation:AiOperation):void{
 if(!AI_AGENTS[agent]?.operations.includes(operation))throw new Error('AI_AGENT_OPERATION');
}
