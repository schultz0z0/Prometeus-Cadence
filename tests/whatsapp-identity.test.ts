import test from 'node:test';import assert from 'node:assert/strict';
import {leadWhatsappPhone} from '../src/domain/whatsapp-identity.ts';
test('a lead phone becomes E.164, reading a number without country code as Brazilian',()=>{
 for(const [raw,expected] of [['+55 21 96434-2764','+5521964342764'],['(21) 96434-2764','+5521964342764'],['21964342764','+5521964342764'],['2133334444','+552133334444'],['5521964342764','+5521964342764'],['+1 415 555 0100','+14155550100']] as const)assert.equal(leadWhatsappPhone(raw),expected,raw);
 for(const raw of [undefined,null,'','abc','12345','+0 21 9999','964342764'])assert.equal(leadWhatsappPhone(raw),null,String(raw));
});
