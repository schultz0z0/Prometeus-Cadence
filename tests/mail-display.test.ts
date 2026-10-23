import test from 'node:test';import assert from 'node:assert/strict';
import {splitQuotedMail} from '../src/client/mail-display.ts';
test('new reply remains visible while the quoted Portuguese or English history is separately expandable',()=>{
 for(const marker of ['Em sex., 23 de out. de 2026, <sales@example.org>\nescreveu:','On Fri, Oct 23, sales@example.org wrote:']){
  const value=splitQuotedMail('Recebi o teste, funcionando.\n\n'+marker+'\n\n> Mensagem anterior\n> Assinatura');
  assert.equal(value.body,'Recebi o teste, funcionando.');assert.equal(value.quoted,marker+'\n\n> Mensagem anterior\n> Assinatura');
 }
});
test('ordinary prose and unrecognized quotations remain visible without being discarded',()=>{
 for(const body of ['Texto simples','Em nossa empresa escrevemos:\nOutra informação importante','Valor aprovado:\n> 100 reais','<script>alert(1)</script>'])assert.deepEqual(splitQuotedMail(body),{body,quoted:null});
 assert.deepEqual(splitQuotedMail(''),{body:'',quoted:null});
});
