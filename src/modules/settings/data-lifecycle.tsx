"use client";
import{useEffect,useRef,useState}from'react';
import{Copy,Eraser,Info,Loader2,Merge,Save,Search,TriangleAlert,Undo2}from'lucide-react';
import{useIdentity}from'@/client/workspace-provider';
import{useAction}from'@/demo/provider';
import{Badge,Button,Field,Modal,Notice,Toggle}from'@/components/ui/primitives';
import{retentionChoices,retentionLabel,retentionNeedsTypedConfirmation,type IdentityKind,type RetentionPolicy}from'@/domain/data-lifecycle';
type Group={kind:IdentityKind;value:string;ids:string[];leads:{id:string;name:string;email:string|null;phone:string|null;listName:string|null}[]};
type MergeRow={id:string;kind:IdentityKind;value:string;state:'merged'|'undone';createdAt:string;undoUntil:string;canUndo:boolean};
type Privacy={retention:RetentionPolicy&{revision:number;updatedAt:string|null;updatedBy:string|null};canManage:boolean};
const keyLabel:Record<string,string>={cnpj:'mesmo CNPJ',email:'mesmo e-mail',phone:'mesmo telefone'};
const groupKey=(g:Group)=>g.ids.join('|');
function useLifecycle(){
 const workspace=useIdentity()?.activeWorkspaceId;
 return async function call<T>(path:string,init?:{method?:string;body?:unknown}):Promise<T>{
  let r:Response;try{r=await fetch(path,{method:init?.method??'GET',cache:'no-store',headers:{'content-type':'application/json',...(workspace?{'x-cadence-workspace':workspace}:{})},body:init?.body===undefined?undefined:JSON.stringify(init.body)});}catch{throw Error('Falha de conexão. Tente novamente.');}
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.message??'Não deu para concluir. Tente novamente.');return data as T;
 };
}
function Panel({icon,title,description,action,footer,children}:{icon:React.ReactNode;title:string;description?:string;action?:React.ReactNode;footer?:React.ReactNode;children:React.ReactNode}){
 return <section className="settings-reference-panel lifecycle-panel"><header className="settings-reference-panel-head"><span className="settings-reference-symbol">{icon}</span><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>{action}</header><div className="settings-reference-panel-body">{children}</div>{footer&&<footer className="lifecycle-footer">{footer}</footer>}</section>;
}
export function DuplicateContacts(){
 const identity=useIdentity(),call=useLifecycle(),run=useAction();
 const[summary,setSummary]=useState<number|null>(null),[groups,setGroups]=useState<Group[]|null>(null),[selected,setSelected]=useState<Set<string>>(new Set()),[merges,setMerges]=useState<MergeRow[]|null>(null),[loadError,setLoadError]=useState('');
 const[scanning,setScanning]=useState(false),[review,setReview]=useState<{token:string;groups:unknown[];removed:number;blockers:string[]}|null>(null),[busy,setBusy]=useState(false),[failures,setFailures]=useState<string[]>([]),[undo,setUndo]=useState<MergeRow|null>(null);
 const mergeRequest=useRef<string|null>(null),undoRequest=useRef(new Map<string,string>());
 async function loadMerges(){try{setMerges((await call<{merges:MergeRow[]}>('/api/data-lifecycle?view=merges')).merges);setLoadError('');}catch(e){setLoadError(e instanceof Error?e.message:'Não deu para carregar as fusões.');}}
 async function count(){try{setSummary((await call<{groups:Group[]}>('/api/data-lifecycle',{method:'POST',body:{action:'scan'}})).groups.length);}catch{setSummary(null);}}
 useEffect(()=>{if(identity){void count();void loadMerges();}},[identity?.activeWorkspaceId]);// eslint-disable-line react-hooks/exhaustive-deps
 if(!identity)return <div className="settings-reference lifecycle-reference"><h1 className="sr-only">Contatos duplicados</h1><Notice>A busca de duplicados está disponível no modo autenticado.</Notice></div>;
 async function scan(){setScanning(true);setFailures([]);try{const found=(await call<{groups:Group[]}>('/api/data-lifecycle',{method:'POST',body:{action:'scan'}})).groups;setGroups(found);setSummary(found.length);setSelected(new Set(found.map(groupKey)));}catch(e){await run(()=>{throw e;});}finally{setScanning(false);}}
 const chosen=()=>(groups??[]).filter(g=>selected.has(groupKey(g))).map(g=>({targetId:g.ids[0],sourceIds:g.ids.slice(1),kind:g.kind,value:g.value}));
 async function prepare(){setBusy(true);try{await run(async()=>{const input={groups:chosen()},r=await call<{token:string;removed:number;blockers:string[]}>('/api/data-lifecycle',{method:'POST',body:{action:'prepare-merge',input}});mergeRequest.current=crypto.randomUUID();setReview({...r,groups:input.groups});});}finally{setBusy(false);}}
 async function confirm(){if(!review||busy)return;setBusy(true);const ok=await run(async()=>{const r=await call<{merged:number;failures:{message:string}[]}>('/api/data-lifecycle',{method:'POST',body:{action:'confirm-merge',input:{groups:review.groups,token:review.token,requestId:mergeRequest.current}}});
   setFailures(r.failures.map(f=>f.message));setReview(null);setGroups(null);mergeRequest.current=null;await Promise.all([count(),loadMerges()]);
   if(r.failures.length)throw Error(`${r.merged} fundido(s), ${r.failures.length} com erro.`);},'Contatos fundidos.');setBusy(false);if(ok)setReview(null);}
 async function confirmUndo(){if(!undo||busy)return;setBusy(true);const requestId=undoRequest.current.get(undo.id)??crypto.randomUUID();undoRequest.current.set(undo.id,requestId);
  if(await run(async()=>{await call('/api/data-lifecycle/'+undo.id+'/undo',{method:'POST',body:{requestId}});setUndo(null);await Promise.all([count(),loadMerges()]);},'Contato restaurado.'))undoRequest.current.delete(undo.id);setBusy(false);}
 const removedSelected=chosen().reduce((n,g)=>n+g.sourceIds.length,0);
 return <div className="settings-reference lifecycle-reference duplicates-reference">
  <h1 className="sr-only">Contatos duplicados</h1>
  <Panel icon={<Copy size={20}/>} title="Contatos duplicados" description="A importação e o Gerador já não criam duplicado: um contato achado de novo é atualizado, não repetido. Esta faxina é para o que entrou antes disso."
   footer={<>{groups&&groups.length>0&&<Button className="lifecycle-merge" variant="primary" disabled={!selected.size||busy} onClick={()=>void prepare()}><Merge size={16}/>{busy&&!review?'Revisando…':`Fundir ${selected.size} ${selected.size===1?'grupo':'grupos'}`}</Button>}</>}>
   <div className="lifecycle-scan"><Button disabled={scanning} onClick={()=>void scan()}>{scanning?<Loader2 size={16} className="spin"/>:<Search size={16}/>}Procurar duplicados</Button>{summary!==null&&<span>{summary>0?`${summary.toLocaleString('pt-BR')} ${summary===1?'grupo possível':'grupos possíveis'}`:'nenhum duplicado por chave forte'}</span>}</div>
   <p className="lifecycle-hint"><TriangleAlert size={14}/>Só fundimos por CNPJ, e-mail e telefone. Nome+cidade e site ficam de fora: empresas diferentes compartilham os dois, e fundir não é pular — é apagar um registro.</p>
   {failures.length>0&&<Notice tone="error">{failures.join(' ')}</Notice>}
   {groups&&groups.length===0&&<p className="muted">Nada a fundir.</p>}
   {groups&&groups.length>0&&<div className="lifecycle-groups">{groups.map(g=>{const key=groupKey(g);return <label key={key} className="lifecycle-group"><input type="checkbox" aria-label={`Fundir grupo: ${keyLabel[g.kind]} ${g.value}`} checked={selected.has(key)} onChange={()=>setSelected(s=>{const n=new Set(s);if(n.has(key))n.delete(key);else n.add(key);return n;})}/><span><span className="lifecycle-group-key"><Badge>{keyLabel[g.kind]}</Badge><small>{g.value}</small></span>{g.leads.map((l,i)=><span key={l.id} className="lifecycle-lead"><span className={i===0?'keep':'drop'}>{l.name||'(sem nome)'}</span><small> · {l.email||l.phone||'sem contato'}{l.listName?` · ${l.listName}`:''}{i===0?' · fica':''}</small></span>)}</span></label>;})}</div>}
  </Panel>
  <Panel icon={<Undo2 size={20}/>} title="Fusões recentes" description="Cada fusão guarda o contato apagado inteiro. Desfazer o traz de volta com as conversas e notas, por até 7 dias.">
   {loadError?<div className="stack"><p role="alert">{loadError}</p><Button onClick={()=>void loadMerges()}>Tentar novamente</Button></div>:merges===null?<div className="lifecycle-loading"><Loader2 size={16} className="spin"/></div>:merges.length===0?<p className="muted">Nenhuma fusão ainda.</p>:<div className="lifecycle-merges">{merges.map(m=><div key={m.id} className="lifecycle-merge-row"><span>{new Date(m.createdAt).toLocaleString('pt-BR')} · por {keyLabel[m.kind]} ({m.value})</span>{m.state==='undone'?<small>desfeita</small>:m.canUndo?<button type="button" onClick={()=>setUndo(m)}>Desfazer</button>:<small>prazo encerrado</small>}</div>)}</div>}
  </Panel>
  {review&&<Modal title={`Fundir ${review.removed} ${review.removed===1?'contato':'contatos'}?`} onClose={()=>{if(!busy)setReview(null);}}><div className="stack">
   <p>O contato mais antigo de cada grupo fica e recebe o que faltava nele: conversas, notas, execuções, resultados da qualificação e matrículas nas cadências passam para ele. Os outros são apagados. Cada fusão fica registrada em Fusões recentes e pode ser desfeita por 7 dias.</p>
   {review.blockers.length>0&&<Notice tone="error">{review.blockers.join(' ')}</Notice>}
   <div className="form-actions"><Button type="button" disabled={busy} onClick={()=>setReview(null)}>Cancelar</Button><Button type="button" variant="danger" disabled={busy||review.blockers.length>0} onClick={()=>void confirm()}>{busy?'Fundindo…':'Fundir'}</Button></div></div></Modal>}
  {undo&&<Modal title="Desfazer esta fusão?" onClose={()=>{if(!busy)setUndo(null);}}><div className="stack">
   <p>O contato apagado volta, com as conversas e notas que a fusão levou. O que foi copiado para o contato principal fica — aquilo preencheu campo vazio, não sobrescreveu nada. Se o contato principal mudou depois da fusão, ela não pode mais ser desfeita.</p>
   <div className="form-actions"><Button type="button" disabled={busy} onClick={()=>setUndo(null)}>Cancelar</Button><Button type="button" variant="primary" disabled={busy} onClick={()=>void confirmUndo()}>{busy?'Desfazendo…':'Desfazer'}</Button></div></div></Modal>}
 </div>;
}
export function PrivacySettings(){
 const identity=useIdentity(),call=useLifecycle(),run=useAction();
 const[data,setData]=useState<Privacy|null>(null),[error,setError]=useState(''),[draft,setDraft]=useState<RetentionPolicy>({active:false,sentDays:365,replyDays:365}),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[confirming,setConfirming]=useState(false),[typed,setTyped]=useState('');
 function apply(p:Privacy){setData(p);setDraft({active:p.retention.active,sentDays:p.retention.sentDays,replyDays:p.retention.replyDays});}
 async function load(){try{apply(await call<Privacy>('/api/data-lifecycle?view=privacy'));setError('');}catch(e){setError(e instanceof Error?e.message:'Não deu para carregar.');}}
 useEffect(()=>{if(identity)void load();},[identity?.activeWorkspaceId]);// eslint-disable-line react-hooks/exhaustive-deps
 const head=<><h1>Privacidade dos dados</h1><p className="subtitle">Por quanto tempo o texto das mensagens fica guardado</p></>;
 if(!identity)return <div className="settings-reference lifecycle-reference privacy-reference">{head}<Notice>A retenção de mensagens está disponível no modo autenticado.</Notice></div>;
 if(!data)return <div className="settings-reference lifecycle-reference privacy-reference">{head}{error?<div className="stack"><p role="alert">{error}</p><Button onClick={()=>void load()}>Tentar novamente</Button></div>:<div className="lifecycle-loading"><Loader2 size={16} className="spin"/></div>}</div>;
 if(!data.canManage)return <div className="settings-reference lifecycle-reference privacy-reference">{head}<Panel icon={<Info size={20}/>} title="Só o dono da conta"><p className="lifecycle-text">Esta configuração apaga dados da conta inteira, então só o dono da conta vê e muda. Fale com ele se precisar.</p></Panel></div>;
 const saved=data.retention,changed=saved.active!==draft.active||draft.active&&(saved.sentDays!==draft.sentDays||saved.replyDays!==draft.replyDays),needsTyped=retentionNeedsTypedConfirmation(saved,draft);
 async function save(confirm?:'APAGAR'){setBusy(true);setMessage('');const ok=await run(async()=>{apply(await call<Privacy>('/api/data-lifecycle',{method:'POST',body:{action:'retention',input:{...draft,expectedRevision:saved.revision,...(confirm?{confirm}:{})}}}));setConfirming(false);setTyped('');
  setMessage(draft.active?'Salvo. O texto mais antigo que o prazo passa a ser apagado pela rotina automática.':'Exclusão desligada. Daqui pra frente nada mais é apagado. O que já foi apagado não volta.');});setBusy(false);return ok;}
 const choices=(kind:'sent'|'reply',current:number)=>[...new Set([...retentionChoices(kind),current])].sort((a,b)=>a-b);
 return <div className="settings-reference lifecycle-reference privacy-reference">{head}
  <Panel icon={<Eraser size={20}/>} title="Apagar o texto de mensagens antigas" description="Por padrão guardamos todo o histórico das suas conversas, sem prazo. Se a sua empresa precisa de um prazo de retenção, ligue aqui e escolha depois de quanto tempo o texto é apagado."
   action={<Badge tone={saved.active?'orange':'neutral'}>{saved.active?'Ligada':'Desligada: guarda tudo'}</Badge>}
   footer={<>{message&&<p role="status" className="lifecycle-message">{message}</p>}<Button variant="primary" className="lifecycle-save" disabled={!changed||busy} onClick={()=>{if(needsTyped){setConfirming(true);return;}void save();}}><Save size={14}/>Salvar</Button></>}>
   <Toggle label="Apagar o texto de mensagens antigas" description={draft.active?'O texto mais antigo que os prazos abaixo é apagado pela rotina automática.':'Desligado: o histórico fica guardado, sem prazo.'} checked={draft.active} disabled={busy} onChange={v=>{setDraft({...draft,active:v});setMessage('');}}/>
   {draft.active&&<div className="field-grid lifecycle-fields">
    <Field label="Mensagens enviadas: apagar o texto depois de"><select value={draft.sentDays} disabled={busy} onChange={e=>{setDraft({...draft,sentDays:Number(e.target.value)});setMessage('');}}>{choices('sent',draft.sentDays).map(v=><option key={v} value={v}>{retentionLabel(v)}</option>)}</select></Field>
    <Field label="Respostas recebidas: apagar o texto depois de"><select value={draft.replyDays} disabled={busy} onChange={e=>{setDraft({...draft,replyDays:Number(e.target.value)});setMessage('');}}>{choices('reply',draft.replyDays).map(v=><option key={v} value={v}>{retentionLabel(v)}</option>)}</select></Field>
   </div>}
   <div className="lifecycle-warning"><p><TriangleAlert size={16}/>O texto apagado não pode ser recuperado.</p><ul>
    <li><strong>Mensagens enviadas</strong> são as das cadências (e-mail e WhatsApp). <strong>Respostas recebidas</strong> são as que os leads mandam e caem na caixa de entrada.</li>
    <li>Nas conversas, a mensagem continua aparecendo (quem mandou, quando e, no e-mail, o assunto), mas o texto vira “texto indisponível”. A IA também deixa de ver esse texto como contexto do lead.</li>
    <li>Não entram nesta exclusão as cópias guardadas pelo provedor do WhatsApp ou do e-mail conectado. As cópias de segurança do banco seguem o prazo da infraestrutura.</li>
    <li>Os prazos mínimos são de 30 dias para mensagens enviadas e 90 dias para respostas.</li>
   </ul></div>
   {saved.active&&<p className="lifecycle-note">Ligada: enviadas após {retentionLabel(saved.sentDays)}, respostas após {retentionLabel(saved.replyDays)}{saved.updatedAt?` (última mudança em ${new Date(saved.updatedAt).toLocaleDateString('pt-BR')}${saved.updatedBy?` por ${saved.updatedBy}`:''})`:''}. A exclusão roda em lotes; o histórico antigo pode levar algum tempo para ser todo apagado.</p>}
  </Panel>
  {confirming&&<Modal title={saved.active?'Encurtar o prazo e apagar mais texto?':'Ligar a exclusão do texto de mensagens antigas?'} onClose={()=>{if(!busy){setConfirming(false);setTyped('');}}}><div className="stack">
   <p>A rotina automática apaga o texto das <strong>mensagens enviadas há mais de {retentionLabel(draft.sentDays)}</strong> e das <strong>respostas recebidas há mais de {retentionLabel(draft.replyDays)}</strong>, incluindo as que já passaram do prazo hoje.</p>
   <p><strong>O texto apagado não pode ser recuperado.</strong> Nas conversas, essas mensagens continuam aparecendo, mas como “texto indisponível”.</p>
   <Field label="Digite APAGAR para confirmar"><input data-autofocus value={typed} disabled={busy} onChange={e=>setTyped(e.target.value)}/></Field>
   <div className="form-actions"><Button type="button" disabled={busy} onClick={()=>{setConfirming(false);setTyped('');}}>Cancelar</Button><Button type="button" variant="danger" disabled={busy||typed!=='APAGAR'} onClick={()=>void save('APAGAR')}>{busy?'Salvando…':'Apagar texto antigo'}</Button></div></div></Modal>}
 </div>;
}
