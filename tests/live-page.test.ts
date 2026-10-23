import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeLiveItems} from '../src/client/live-page.ts';
test('live head replaces stale statuses while retaining previously loaded pages',()=>{
 assert.deepEqual(mergeLiveItems([{id:'a',status:'pending'},{id:'b',status:'old'}],[{id:'c',status:'new'},{id:'a',status:'accepted'}]),[{id:'c',status:'new'},{id:'a',status:'accepted'},{id:'b',status:'old'}]);
});
