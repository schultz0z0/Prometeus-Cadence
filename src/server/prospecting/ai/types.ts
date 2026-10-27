import type {Evidence} from '../../../domain/prospecting.ts';
import type {Fetch} from '../providers/types.ts';
export interface DecisionContext{operationId:string;signal:AbortSignal;credential:string;fetcher?:Fetch}
export interface DecisionInput{criteria:string;evidence:Evidence[];facts:Record<string,unknown>;intent?:'contact-evidence'}
export interface GenerationInput{task:'summary'|'second_opinion';evidence:Evidence[];criteria:string}
