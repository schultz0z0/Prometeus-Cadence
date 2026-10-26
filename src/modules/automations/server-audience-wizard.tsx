"use client";
import Link from 'next/link';
import {useDemo} from '@/demo/provider';
import {usePlanningFlow} from '@/modules/planning/use-planning-flow';
import {useApprovedPlanningContext,ProductPicker} from '@/modules/planning/product-picker';
import {AudienceProposals,AudienceProposalEditor,audienceEdits,type AudienceEdits} from '@/modules/planning/audience-proposals';
import {AnalysisReview,SelectionReview} from '@/modules/planning/analysis-review';
import {AnalysisStatus} from '@/modules/planning/analysis-status';
import {Button,Field,PageHeader,Steps,Notice,LinkButton,ChannelPills} from '@/components/ui/primitives';
export function ServerAudienceWizard({initialJob}:{initialJob?:string}){
 const workspace=useDemo(),flow=usePlanningFlow({kind:'planning',task:'audience_plan',description:'',channel:'whatsapp',timezone:workspace.preferences.timezone},initialJob),{context,error}=useApprovedPlanningContext();
 const {state,dispatch,busy}=flow,input=state.input;if(input.task!=='audience_plan')return null;
 const edited=state.edits as unknown as AudienceEdits|null;
 if(state.created?.listId)return <><PageHeader title="Pronto" description="A lista e as duas automações foram criadas e continuam pausadas." back="/automations"/><section className="panel panel-pad stack"><h2>{edited?.title}</h2><Notice>Nenhuma busca ou mensagem foi iniciada. Revise e ative a recorrência quando desejar.</Notice><div className="row wrap"><LinkButton variant="primary" href={`/cadences/new/ai?list=${encodeURIComponent(state.created.listId)}&channel=${edited?.channel??input.channel}${input.productId?'&product='+encodeURIComponent(input.productId):''}`}>Criar a cadência dessa lista →</LinkButton><LinkButton href={'/contacts?list='+encodeURIComponent(state.created.listId)}>Ver lista</LinkButton><LinkButton href="/automations">Ir para automações</LinkButton></div></section>{state.error&&<p role="alert">{state.error}</p>}</>;
 return <div className="workflow-reference ai-workflow-reference audience-ai-reference"><PageHeader title="Nova automação com IA" description="Descreva o público, revise três propostas e confirme o que será criado." back="/automations"/><Steps items={['Quem alcançar','Escolher o plano']} current={state.view==='input'?0:1}/>
  {(state.error||error)&&<p className="error-bar" role="alert">{state.error||error}</p>}
  {state.view==='input'?<div className="workspace-form"><div className="ai-workflow-main">
    <section className="panel panel-pad stack"><h2>Quem você quer alcançar</h2><div className="audience-description-layout"><Field label="Descreva seu público" help="Se ficar em branco, a IA usa o contexto aprovado da empresa."><textarea rows={3} maxLength={4000} value={input.description} onChange={e=>dispatch({type:'input',input:{...input,description:e.target.value}})} placeholder="Ex.: clínicas de estética em São Paulo que já têm mais de um consultório"/></Field><div className="audience-examples"><small>EXEMPLOS</small>{['clínicas de estética em São Paulo','indústrias de embalagem no Sul','escritórios de contabilidade com mais de 10 funcionários','lojas de material de construção do interior'].map(value=><button type="button" key={value} className="pill" onClick={()=>dispatch({type:'input',input:{...input,description:value}})}>{value}</button>)}</div></div></section>
    <section className="panel panel-pad stack"><h2>Por onde você vai falar</h2><ChannelPills value={input.channel} onChange={value=>dispatch({type:'input',input:{...input,channel:value as typeof input.channel}})}/><small>Você revisa as propostas antes de criar a lista e as automações.</small></section>
    <section className="panel panel-pad stack ai-workflow-context"><ProductPicker context={context} value={input.productId??''} onChange={value=>dispatch({type:'input',input:{...input,productId:value||undefined}})}/><Field label="Fuso dos horários sugeridos"><input value={input.timezone} onChange={e=>dispatch({type:'input',input:{...input,timezone:e.target.value}})}/></Field></section>
    <div className="form-actions"><Button variant="primary" disabled={busy} onClick={flow.prepare}>Montar o plano com IA →</Button></div>
  </div><aside className="panel panel-pad stack ai-workflow-aside"><h3>O que a IA vai montar</h3><p><strong>Três propostas completas,</strong> com lista, busca e qualificação.</p><p><strong>Você escolhe e ajusta uma</strong> antes de criar. A criação deixa as automações pausadas.</p><p>O tamanho do mercado continua desconhecido sem uma consulta comprovada.</p><footer><Link href="/automations/new">Preferir configuração manual →</Link></footer></aside></div>:<>
   <AnalysisStatus data={flow.analysis.data} error={flow.analysis.error} onRefresh={flow.analysis.refresh}/>
   {state.view==='options'&&state.proposal?.task==='audience_plan'&&<AudienceProposals options={state.proposal.options} recommended={state.proposal.recommendedOptionId} disabled={busy||!['completed','partial'].includes(flow.analysis.data?.job.state??'')} onSelect={option=>dispatch({type:'select',optionId:option.id,edits:audienceEdits(option) as unknown as Record<string,unknown>})}/>}
   {state.view==='edit'&&edited&&<><AudienceProposalEditor value={edited} onChange={value=>dispatch({type:'edit',edits:value as unknown as Record<string,unknown>})}/><div className="form-actions"><Button disabled={busy} onClick={()=>dispatch({type:'back'})}>Voltar às opções</Button><Button variant="primary" disabled={busy} onClick={flow.prepareSelection}>Criar assim →</Button></div></>}
   <div className="proposal-actions"><Button disabled={busy} onClick={()=>dispatch({type:'new-review'})}>Mudar o público ou pedir outros três</Button><small>Uma nova geração exige outra revisão de custo.</small></div>
  </>}
  {state.previousJobId&&<p className="secondary-text"><Link href={'/executions/'+state.previousJobId}>Ver análise anterior no histórico →</Link></p>}
  {state.review&&<AnalysisReview review={state.review} busy={busy} error={state.error} onConfirm={flow.confirm} onClose={()=>{if(!busy)dispatch({type:'dismiss-review'});}}/>}
  {state.selectionReview&&<SelectionReview review={state.selectionReview} busy={busy} error={state.error} onConfirm={flow.confirmSelection} onClose={()=>{if(!busy)dispatch({type:'dismiss-selection'});}}/>}
 </div>;
}
