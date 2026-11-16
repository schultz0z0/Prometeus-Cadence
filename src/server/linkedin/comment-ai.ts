import type {ConventionalRoute} from '../../domain/ai-routing.ts';
import {commentOutputJsonSchema,commentOutputSchema} from '../../domain/linkedin-sequence.ts';
import {runConventionalJson,type JsonDependencies} from '../prospecting/ai/json.ts';
// 07A.3c: the comment prompt. The runner only accepts the 4096 or 8192 output budgets; the 600 characters are the schema's.
import {linkedinCommentPrompt} from './comment-prompt.ts';
export interface CommentInput{workspaceId:string;runId:string;postText:string;guidance:string|null;person:{name:string;headline:string|null;company:string|null}}
export async function generateCommentWithRoute(route:ConventionalRoute,i:CommentInput,deps:JsonDependencies={}){
 const prompt=linkedinCommentPrompt(i);
 const r=await runConventionalJson({operationId:'linkedin-comment:'+i.runId,workspaceId:i.workspaceId,signal:AbortSignal.timeout(120e3),route,agent:'linkedin',operation:'linkedin-comment'},
  {prompt,schema:commentOutputJsonSchema,maxOutputTokens:4096,parse:v=>{const o=commentOutputSchema.safeParse(v);if(!o.success)throw new Error('LINKEDIN_COMMENT_INVALID');return o.data.comment;}},deps);
 return {text:r.value,usage:r.usage};
}
