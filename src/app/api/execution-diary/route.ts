import {executionDiaryRequest} from '../../../server/operations/execution-diary.ts';

export function GET(request:Request) {
  return executionDiaryRequest(request);
}
