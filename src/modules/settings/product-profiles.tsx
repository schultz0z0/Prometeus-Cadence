"use client";
import {useEffect,useState} from 'react';
import {useCapabilities,useContextClient,useWorkspaceRefresh} from '@/client/workspace-provider';
import type {ProductView,ProductProfile} from '@/domain/products';
import {emptyWorkspace} from '@/domain/empty-workspace';
import {Button,Modal,Field,Badge,Notice} from '@/components/ui/primitives';
import {ContextSuggestions} from './context-suggestions';
const empty:ProductProfile={name:'',offer:'',idealCustomer:'',differentiators:'',socialProof:'',sources:''};
const fields:[keyof ProductProfile,string][]=[['name','Nome'],['offer','Oferta'],['idealCustomer','Cliente ideal'],['differentiators','Diferenciais'],['socialProof','Provas e cases'],['sources','Fontes e observações']];
export function ProductProfiles({domain,companyRevision}:{domain:string;companyRevision:number}){
 const client=useContextClient(),capabilities=useCapabilities(),canEdit=!!capabilities?.includes('context.approve');
 const [products,setProducts]=useState<ProductView[]>([]),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[editor,setEditor]=useState<ProductView|null|undefined>(undefined);
 const [approvedVersion,setApprovedVersion]=useState<number|null>(null);
 useEffect(()=>{let live=true;client?.get().then(s=>{if(live){setProducts(s.products);setApprovedVersion(s.approved?.version??null);setError('');}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[client,refresh,companyRevision]);
 return <section className="panel panel-pad section-gap stack">
  <div className="row between wrap"><h2>Perfis de produtos e serviços</h2>{canEdit&&<Button icon="Plus" onClick={()=>setEditor(null)}>Adicionar produto</Button>}</div>
  <p className="secondary-text">Aprovação e versões próprias para usar um produto específico nas gerações. O texto legado do perfil da empresa é preservado.</p>
  {!error&&<p className="secondary-text">Contexto da empresa usado pela IA: {approvedVersion===null?'nenhuma versão aprovada':`versão aprovada ${approvedVersion}`}. Edições de rascunho não substituem essa versão.</p>}
  {error&&<p role="alert">{error}</p>}
  {!products.length&&!error&&<p className="muted">Nenhum perfil de produto cadastrado.</p>}
  {products.map(product=><article className="row between wrap" key={product.id}><div><strong>{product.draft.name}</strong><p className="secondary-text">Revisão {product.revision} · {product.approved?`aprovado v${product.approved.version}`:'sem versão aprovada'}</p></div><div className="row"><Badge tone={product.archived?'neutral':product.approved?'green':'orange'}>{product.archived?'Arquivado':product.approved?'Tem versão aprovada':'Rascunho'}</Badge><Button onClick={()=>setEditor(product)}>{canEdit&&!product.archived?'Revisar':'Ver perfil'}</Button></div></article>)}
  {editor!==undefined&&<ProductEditor key={editor?.id??'new'} initial={editor} domain={domain} canEdit={canEdit} onClose={()=>setEditor(undefined)} onSaved={()=>setRefresh(v=>v+1)}/>}
 </section>;
}
function ProductEditor({initial,domain,canEdit,onClose,onSaved}:{initial:ProductView|null;domain:string;canEdit:boolean;onClose:()=>void;onSaved:()=>void}){
 const client=useContextClient(),refreshWorkspace=useWorkspaceRefresh(),[view,setView]=useState(initial),[draft,setDraft]=useState<ProductProfile>(()=>structuredClone(initial?.draft??empty)),[sourceJobId,setSourceJobId]=useState<string|undefined>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
 const writable=canEdit&&!view?.archived;
 async function save(action:'save-draft'|'approve'|'archive'){
  if(!client||!writable||busy)return;setBusy(true);setError('');setSaved('');
  try{const next=await client.saveProduct({id:view?.id,expectedRevision:view?.revision??0,action,...(action==='archive'?{}:{profile:draft}),...(sourceJobId?{sourceJobId}:{})});setView(next);setDraft(next.draft);setSaved(action==='approve'?'Produto aprovado.':action==='archive'?'Produto arquivado.':'Rascunho salvo.');onSaved();await refreshWorkspace?.();}
  catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar.');}finally{setBusy(false);}
 }
 return <Modal wide title={view?'Perfil do produto':'Novo produto'} onClose={()=>{if(!busy)onClose();}}>
  <div className="stack">{view?.approved&&<Notice>Versão aprovada {view.approved.version}. Novas edições ficam como rascunho até uma nova aprovação.</Notice>}
  {fields.map(([key,label])=><Field key={key} label={label}><textarea disabled={!writable||busy} rows={key==='name'?1:3} maxLength={key==='name'?160:4000} value={draft[key]} onChange={e=>setDraft(p=>({...p,[key]:e.target.value}))}/></Field>)}
  {writable&&view&&<div className="row wrap"><ContextSuggestions productId={view.id} current={{...emptyWorkspace().companyProfile,...draft,domain}} onAccepted={setSourceJobId} onChange={p=>setDraft(Object.fromEntries(fields.map(([key])=>[key,p[key]])) as unknown as ProductProfile)}/></div>}
  {!view&&<small>Salve o primeiro rascunho para solicitar uma leitura do produto no site da empresa.</small>}
  {error&&<p role="alert" className="error-bar">{error} Seu texto foi preservado.</p>}{saved&&<p role="status">{saved}</p>}
  {writable&&<div className="row wrap"><Button disabled={busy||!draft.name.trim()} onClick={()=>save('save-draft')}>Salvar rascunho</Button><Button variant="primary" disabled={busy||!view||!draft.offer.trim()||!draft.idealCustomer.trim()} onClick={()=>save('approve')}>Aprovar produto</Button>{view&&<Button disabled={busy} onClick={()=>save('archive')}>Arquivar</Button>}</div>}
  </div>
 </Modal>;
}
