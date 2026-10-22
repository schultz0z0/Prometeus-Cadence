import 'server-only';
import type {Principal} from '../../domain/workspace.ts';
import type {PublicationInputV2,PublicationReview,PublicationReviewV2} from '../../domain/cadence-runtime.ts';
import * as legacy from './publication-legacy.ts';
import * as v2 from './publication-v2.ts';
export {listPublications,pausePublication,publicationState} from './publication-legacy.ts';
export function preparePublication(p:Principal,input:PublicationInputV2):Promise<PublicationReviewV2>;
export function preparePublication(p:Principal,input:unknown):Promise<PublicationReview>;
export function preparePublication(p:Principal,input:unknown):Promise<PublicationReview|PublicationReviewV2>{return isV2(input)?v2.preparePublicationV2(p,input):legacy.preparePublication(p,input);}
export function confirmPublication(p:Principal,input:unknown){return isV2(input)?v2.confirmPublicationV2(p,input):legacy.confirmPublication(p,input);}
function isV2(input:unknown){return !!input&&typeof input==='object'&&'version'in input&&input.version===2;}
