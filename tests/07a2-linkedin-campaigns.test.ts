import test from 'node:test';
import assert from 'node:assert/strict';
import {linkedinInviteEligible,campaignDraftSchema,defaultCampaignDraft,renderInviteNote,inviteWindowOpen,campaignBlockers,parsePostId,isPeopleSearchUrl,degreeOf,LINKEDIN_DAILY_CAP} from '../src/domain/linkedin-campaign.ts';
import {NO_LINKEDIN} from '../src/domain/linkedin-capabilities.ts';

test('07A.2 a pending invite or an existing connection is never invited again',()=>{
 assert.equal(linkedinInviteEligible({connectedAlready:false,pendingInvite:true,approved:true}),false);
 assert.equal(linkedinInviteEligible({connectedAlready:true,pendingInvite:false,approved:true}),false);
 assert.equal(linkedinInviteEligible({connectedAlready:false,pendingInvite:false,approved:false}),false);
 assert.equal(linkedinInviteEligible({connectedAlready:false,pendingInvite:false,approved:true}),true);
});

test('07A.2 the draft keeps every visible control and refuses what the provider cannot take',()=>{
 const d=defaultCampaignDraft();
 assert.equal(d.dailyLimit,12);assert.deepEqual(d.source.degrees,[2,3]);assert.equal(LINKEDIN_DAILY_CAP,12);
 const ok=campaignDraftSchema.safeParse({...d,name:'[RE] Diretores'});assert.equal(ok.success,true);
 assert.equal(campaignDraftSchema.safeParse({...d,name:'x',dailyLimit:13}).success,false,'12 is the ceiling');
 assert.equal(campaignDraftSchema.safeParse({...d,name:'x',note:'a'.repeat(301)}).success,false);
 assert.equal(campaignDraftSchema.safeParse({...d,name:'x',note:'Oi {apelido}'}).success,false,'unknown token');
 assert.equal(campaignDraftSchema.safeParse({...d,name:'x',source:{...d.source,degrees:[1]}}).success,false,'1st degree is never invited');
 assert.equal(campaignDraftSchema.safeParse({...d,name:'x',extra:1}).success,false);
 assert.equal(campaignDraftSchema.safeParse({...d,name:'x',source:{...d.source,roles:['a','b','c','d','e','f']}}).success,false,'up to 5 roles');
});

test('07A.2 the note only uses facts from the profile; a missing fact skips the person',()=>{
 assert.equal(renderInviteNote('Olá, {nome}! Vi a {empresa}.',{nome:'Ana',empresa:'[RE] Acme'}),'Olá, Ana! Vi a [RE] Acme.');
 assert.equal(renderInviteNote('Olá, {nome}! Vi a {empresa}.',{nome:'Ana'}),null);
 assert.equal(renderInviteNote('',{}),'');
 assert.equal(renderInviteNote('{prova}',{prova:'x'.repeat(301)}),null,'over 300 after filling');
});

test('07A.2 invites leave on weekdays between 9h and 18h in Brasília',()=>{
 assert.equal(inviteWindowOpen(new Date('2026-11-04T13:00:00Z')),true,'Wed 10h BRT');
 assert.equal(inviteWindowOpen(new Date('2026-11-04T11:59:00Z')),false,'Wed 8:59 BRT');
 assert.equal(inviteWindowOpen(new Date('2026-11-04T21:00:00Z')),false,'Wed 18h BRT');
 assert.equal(inviteWindowOpen(new Date('2026-11-07T15:00:00Z')),false,'Saturday');
});

test('07A.2 activation blockers: account, capabilities, warming and decision-maker triage',()=>{
 const d={...defaultCampaignDraft(),name:'x',warming:false,decisionMakerOnly:false};
 const caps={...NO_LINKEDIN,connect:true,audience:true,invite:true,acceptance:true};
 assert.deepEqual(campaignBlockers(d,{accountReady:true,capabilities:caps}),[]);
 assert.equal(campaignBlockers(d,{accountReady:false,capabilities:caps}).length,1);
 assert.equal(campaignBlockers(d,{accountReady:true,capabilities:{...caps,invite:false}}).length,1);
 assert.equal(campaignBlockers({...d,warming:true},{accountReady:true,capabilities:caps}).length,1);
 assert.equal(campaignBlockers({...d,warming:true},{accountReady:true,capabilities:{...caps,profileActions:['visit','like']}}).length,1,'warming is not implemented yet: always blocked');
 assert.equal(campaignBlockers({...d,decisionMakerOnly:true},{accountReady:true,capabilities:caps}).length,1);
});

test('07A.2 links and degrees are read strictly',()=>{
 assert.equal(parsePostId('https://www.linkedin.com/posts/ana_tema-activity-7236734771807019010-3qVO'),'7236734771807019010');
 assert.equal(parsePostId('https://www.linkedin.com/feed/update/urn:li:activity:7236734771807019010/'),'7236734771807019010');
 assert.equal(parsePostId('https://example.com/posts/activity-1'),null);
 assert.equal(isPeopleSearchUrl('https://www.linkedin.com/search/results/people/?keywords=ceo'),true);
 assert.equal(isPeopleSearchUrl('https://www.linkedin.com/search/results/companies/?keywords=ceo'),false);
 assert.equal(isPeopleSearchUrl('http://www.linkedin.com/search/results/people/'),false);
 assert.equal(degreeOf('DISTANCE_1'),1);assert.equal(degreeOf('DISTANCE_3'),3);assert.equal(degreeOf('OUT_OF_NETWORK'),null);
});
