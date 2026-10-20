import {handleAuthRequest} from '@/server/auth/auth';
export const runtime='nodejs';
export const GET=handleAuthRequest;
export const POST=handleAuthRequest;
