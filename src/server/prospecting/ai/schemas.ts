import {z} from 'zod';
export const verdict=z.enum(['fits','does_not_fit','insufficient_evidence']);
const probability=z.number().finite().min(0).max(1);
export const jevResponse=z.object({answers:z.object({fit:z.object({type:z.literal('choice'),choice:verdict,confidence:probability.optional(),probabilities:z.partialRecord(verdict,probability).optional()}),quality:z.object({type:z.literal('noul'),noul:probability}).optional(),coverage:z.object({type:z.literal('score'),score:z.number().finite().min(0).max(2)}).optional()}),usage:z.object({prompt_tokens:z.number().int().min(0).optional(),completion_tokens:z.number().int().min(0).optional(),cost:z.number().finite().min(0).optional()}).optional()});
export const generationSchema=z.strictObject({summary:z.string().trim().min(1).max(2000),evidenceIds:z.array(z.string().max(120)).min(1).max(3)});
export const generationJsonSchema={type:'object',additionalProperties:false,required:['summary','evidenceIds'],properties:{summary:{type:'string',maxLength:2000},evidenceIds:{type:'array',items:{type:'string'},minItems:1,maxItems:3}}};
