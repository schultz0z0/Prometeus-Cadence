"use client";
import { useState } from "react";
import { SdrOverview } from './sdr-overview';
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import {
  PageHeader,
  Button,
  LinkButton,
  Modal,
  Notice,
  Field,
  Badge,
} from "@/components/ui/primitives";
export function LinkedinSdr({
  sdr = false,
  section = "dashboard",
}: {
  sdr?: boolean;
  section?: string;
}) {
  if (!sdr) return <LinkedinReference section={section} />;
  return <SdrOverview />;
}
const campaignPath = "/linkedin/campaigns/new";
function LinkedinPrerequisites() {
  return <div className="li-prerequisites">
    <small>PRA OS CONVITES SAÍREM, NESTA ORDEM</small>
    <ol>
      <li className="li-next"><span>1</span><div>Disponibilizar a integração<small>LinkedIn ainda não está disponível neste workspace</small></div></li>
      <li><span>2</span><div>Conectar o seu LinkedIn<small>depois do passo 1</small></div></li>
      <li><span>3</span><div>Ligar a campanha<small>depois do passo 2</small></div></li>
    </ol>
  </div>;
}
function LinkedinReference({section}: {section: string}) {
  return <div className="linkedin-reference">
    {section === "dashboard" ? <LinkedinOverview /> : section === "campaigns/new" ? <LinkedinCampaignDraft /> : section === "campaigns" ? <LinkedinCampaigns /> : section === "enrichment" ? <LinkedinEnrichment /> : section === "cadences" ? <LinkedinCadences /> : section === "templates" ? <LinkedinTemplates /> : <LinkedinWaiting section={section} />}
  </div>;
}
function LinkedinOverview() {
  return <>
    <section className="li-panel li-overview">
      <div className="li-overview-heading"><span className="li-brand-icon"><Icon name="Linkedin" size={27}/></span><div>
        <h1>Prospecção no LinkedIn</h1>
        <p>Você fala com a pessoa certa pelo cargo, não com o e-mail genérico da empresa. Monte a sua campanha agora: a gente mostra o público de verdade e o resultado que você teria.</p>
        <LinkButton href={campaignPath} variant="primary" icon="Plus">Montar minha primeira campanha <Icon name="ArrowRight" size={15}/></LinkButton>
      </div></div>
      <LinkedinPrerequisites />
      <p className="li-footnote">Você pode preparar o público e o convite. A integração de busca e envio no LinkedIn está pendente; nenhuma campanha será ativada.</p>
    </section>
    <div className="li-four-grid li-process">
      {[["Users","1 · Escolha quem","Cargo, cidade e setor. A gente mostra quantas pessoas existem com essa mira e quem são as primeiras."],["Send","2 · Convite com nota","Uma nota curta, escrita por você e adaptada pela IA pra cada pessoa. Sai no ritmo seguro da sua conta."],["MessageSquare","3 · Aceitou? Conversa","Quem aceita cai numa cadência de mensagens no LinkedIn, e a resposta chega na sua caixa aqui."],["ListChecks","4 · Vira lead","Aceites entram numa lista com e-mail e telefone enriquecidos, prontos pra cadência ou pro CRM."]].map(([icon,title,body])=><section className="li-panel" key={title}><Icon name={icon} size={20}/><h2>{title}</h2><p>{body}</p></section>)}
    </div>
    <section className="li-panel li-projection"><h3><Icon name="Sparkles" size={16}/>O que você teria em 22 dias úteis <small>estimativa · 12 convites/dia</small></h3>
      <div className="li-three-grid">{[["264","Convites enviados"],["66–92","Novas conexões"],["8–18","Conversas abertas"]].map(([value,label])=><div key={label}><strong>{value}</strong><small>{label}</small></div>)}</div>
      <p className="li-footnote">Cenário ilustrativo de prospecção B2B por convite. Não são resultados do workspace nem uma promessa de desempenho.</p>
    </section>
  </>;
}
function LinkedinCampaigns() {
  return <><PageHeader title="Campanhas de convite" description="A campanha só envia convite. O que acontece depois do aceite é da cadência." actions={<LinkButton href={campaignPath} variant="primary" icon="Plus">Nova campanha</LinkButton>}/>
    <section className="li-panel li-campaign-empty"><Icon name="Send" size={32}/><h2>Nenhuma campanha ainda</h2><p>Antes de disparar, você explora o público: roda a busca, vê quantas pessoas ela devolve e uma amostra dos perfis. Convite não volta, então errar a mira custa a cota da semana.</p><p className="li-footnote">A integração está pendente. Você pode preparar um rascunho local.</p><LinkButton href={campaignPath} variant="primary" icon="Plus">Criar a primeira</LinkButton></section>
  </>;
}
const waitingCopy: Record<string, {title:string;description:string;icon:string}> = {
  people: {title:"Aqui ficam as pessoas da sua prospecção", description:"Cada convidado aparece nesta lista com o estágio dele, na fila, convidado, aceitou, respondeu, e vira lead com e-mail e telefone quando aceita. Preenche assim que a sua primeira campanha ligar.",icon:"Users"},
  pipeline: {title:"Aqui fica o pipeline do LinkedIn",description:"Cada pessoa da campanha aparece na coluna do estágio dela: na fila, aquecida, convidada, aceitou, respondeu. Preenche assim que a sua primeira campanha ligar.",icon:"Columns3"},
  approvals: {title:"Comentários que a IA escreve, você aprova",description:"Quando um passo da campanha comenta num post, o texto para aqui antes de sair: você lê, ajusta e aprova. É a única ação pública do módulo, por isso ninguém publica sem a sua palavra.",icon:"MessageSquare"},
};
function LinkedinWaiting({section}: {section:string}) {
  const copy=waitingCopy[section]??waitingCopy.people;
  return <div className="li-waiting-layout"><section className="li-panel li-waiting"><Icon name="Linkedin" size={32}/><h1>{copy.title}</h1><p>{copy.description}</p><div className="row"><LinkButton href={campaignPath} variant="primary">Montar uma campanha <Icon name="ArrowRight" size={15}/></LinkButton><LinkButton href="/linkedin/dashboard">Como funciona</LinkButton></div></section><LinkedinPrerequisites/></div>;
}
function LinkedinEnrichment() {
  return <><PageHeader title="Enriquecimento" description="O que o sistema descobre sozinho, e o que você pode aprofundar antes de contactar."/>
    <div className="li-two-grid li-enrichment"><section className="li-panel"><h2>Automático, em toda campanha</h2><ul>{["Perfil e empresa lidos antes do convite, para personalizar a nota.","E-mail e telefone extraídos do perfil no aceite, quando a pessoa os expõe.","Último post guardado para orientar a conversa."].map(text=><li key={text}><Icon name="CheckCircle2" size={17}/>{text}</li>)}</ul><p className="li-footnote">Este fluxo estará disponível quando a integração LinkedIn for implementada.</p></section>
    <section className="li-panel"><h2>Opcional, você escolhe, por lista</h2><p>Os dados extraídos podem virar variáveis nos seus templates.</p><ul>{[["Globe","Site + resumo com IA","Consulta páginas públicas e resume a empresa."],["Search","Extração profunda","Aprofunda a consulta nas páginas disponíveis."],["Mail","Verificar e-mail","A verificação disponível hoje é de formato e domínio."],["MessageSquare","Checar WhatsApp","Validação de WhatsApp pendente de integração."]].map(([icon,title,body])=><li key={title}><Icon name={icon} size={17}/><div><strong>{title}</strong><p>{body}</p></div></li>)}</ul></section></div>
    <section className="li-panel li-list-empty"><h2>Suas listas do LinkedIn</h2><p>Nenhuma lista do LinkedIn ainda, ela nasce junto da primeira campanha.</p></section>
  </>;
}
function LinkedinCadences() {
  const [query,setQuery]=useState(""),[status,setStatus]=useState(""),[view,setView]=useState("Lista"),[period,setPeriod]=useState("30 dias"),[order,setOrder]=useState("Mais recentes"),[unavailable,setUnavailable]=useState(false);
  return <><PageHeader title="Cadências" description="Cadências para quem aceitou seu convite" actions={<Button variant="primary" icon="Plus" onClick={()=>setUnavailable(true)}>Nova cadência</Button>}/>
    <div className="li-info-strip"><span>Estas são as cadências que trabalham quem aceitou seu convite. Quem ainda não aceitou é assunto da <Link href="/linkedin/campaigns">campanha</Link>.</span><Link href="/cadences">Ver todas</Link></div>
    <div className="li-toolbar li-cadence-toolbar"><input aria-label="Buscar cadência LinkedIn" placeholder="Buscar cadência, lista ou tag…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Status" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Status: todas</option>{["Ativas","Pausadas","Inativas","Concluídas","Rascunhos"].map(x=><option key={x}>{x}</option>)}</select><select aria-label="Período das métricas" value={period} onChange={e=>setPeriod(e.target.value)}>{["hoje","7 dias","30 dias","90 dias","tudo"].map(x=><option key={x} value={x}>Métricas: {x}</option>)}</select><select aria-label="Ordenar" value={order} onChange={e=>setOrder(e.target.value)}>{["Mais recentes","Mais antigas","Nome A–Z","Mais enviados","Mais respostas","Melhor taxa de resposta","Mais ativas hoje"].map(x=><option key={x}>{x}</option>)}</select><div className="li-view" role="group" aria-label="Visualização">{["Lista","Cards"].map(x=><Button key={x} aria-label={x} title={x} aria-pressed={view===x} onClick={()=>setView(x)} icon={x==="Lista"?"ListChecks":"LayoutDashboard"}/>)}</div></div>
    <section className="li-cadence-empty li-campaign-empty"><Icon name="Search" size={24}/><h2>Nenhuma cadência com esses filtros</h2><p>Tire um filtro ou mude a busca.</p><Button onClick={()=>{setQuery("");setStatus("");setPeriod("30 dias");setOrder("Mais recentes");}}>Limpar filtros</Button><p className="li-footnote">Cadências de LinkedIn aguardam a integração. Suas cadências atuais continuam em Disparos em Massa.</p></section>
    {unavailable&&<LinkedinUnavailable title="Cadência de LinkedIn" onClose={()=>setUnavailable(false)}/>}
  </>;
}
function LinkedinTemplates() {
  const [query,setQuery]=useState(""),[channel,setChannel]=useState("LinkedIn"),[view,setView]=useState("Cards"),[unavailable,setUnavailable]=useState(false);
  return <><PageHeader title="Templates do LinkedIn" description="Seus textos prontos de convite e mensagem do LinkedIn. Reutilize nos passos das campanhas." actions={<Button variant="primary" icon="Plus" onClick={()=>setUnavailable(true)}>Novo template</Button>}/>
    <div className="li-toolbar"><input aria-label="Buscar template" placeholder="Buscar templates…" value={query} onChange={e=>setQuery(e.target.value)}/><div className="li-view">{["Todos","Email","WhatsApp","LinkedIn"].map(x=><Button key={x} aria-pressed={channel===x} onClick={()=>setChannel(x)}>{x}</Button>)}</div><div className="li-view" role="group" aria-label="Visualização">{["Lista","Cards"].map(x=><Button key={x} aria-pressed={view===x} onClick={()=>setView(x)} icon={x==="Lista"?"ListChecks":"LayoutDashboard"}>{x}</Button>)}</div></div>
    <section className="li-panel li-templates-empty li-campaign-empty"><div className="li-template-illustration" aria-hidden="true"><Icon name="FileText" size={38}/><Icon name="Mail" size={26}/><Icon name="MessageSquare" size={26}/></div><h2>Crie seu primeiro template</h2><p>Um modelo de mensagem pronto para reaproveitar nas cadências, sem reescrever.</p><Button variant="primary" icon="Plus" onClick={()=>setUnavailable(true)}>Criar template</Button></section><div className="li-three-grid li-template-help">{[["Escreva uma vez","Textos de convite e mensagem com variáveis."],["Use em várias cadências","Cada passo pode reutilizar um template."],["Revise antes de enviar","A integração LinkedIn ainda está pendente."]].map(([title,body])=><div key={title}><strong>{title}</strong><p>{body}</p></div>)}</div>
    {unavailable&&<LinkedinUnavailable title="Template de LinkedIn" onClose={()=>setUnavailable(false)}/>}
  </>;
}
function LinkedinUnavailable({title,onClose}: {title:string;onClose:()=>void}) {
  return <Modal title={title} onClose={onClose}><Notice>A integração LinkedIn ainda não está disponível. Nenhum registro será criado e nenhuma mensagem será enviada.</Notice><div className="form-actions"><Button onClick={onClose}>Fechar</Button></div></Modal>;
}

function LinkedinCampaignDraft() {
  const [name,setName]=useState(""),[audience,setAudience]=useState("filters"),[description,setDescription]=useState(""),[filterMode,setFilterMode]=useState("filters"),[roles,setRoles]=useState(""),[location,setLocation]=useState(""),[sector,setSector]=useState(""),[keyword,setKeyword]=useState(""),[link,setLink]=useState(""),[proof,setProof]=useState(""),[extraProof,setExtraProof]=useState(false),[note,setNote]=useState(""),[daily,setDaily]=useState(12),[expiry,setExpiry]=useState(30),[decisionMaker,setDecisionMaker]=useState(true),[warming,setWarming]=useState(true),[enrich,setEnrich]=useState(false),[review,setReview]=useState(false),[unavailable,setUnavailable]=useState(false);
  const append=(token:string)=>setNote(current=>(current+(current&&!current.endsWith(" ")?" ":"")+token).slice(0,300));
  return <><PageHeader title="Nova campanha" back="/linkedin/campaigns"/>
    <form className="li-campaign-form" onSubmit={e=>{e.preventDefault();setReview(true);}}>
      <div className="li-campaign-main">
      <section className="li-panel"><h2><span className="li-step">1</span>Como você vai chamar esta prospecção</h2><Field label="Nome da campanha"><input required value={name} maxLength={100} onChange={e=>setName(e.target.value)} placeholder="Ex.: Diretores comerciais · São Paulo"/></Field></section>
      <section className="li-panel"><h2><span className="li-step">2</span>Quem você quer alcançar</h2><p>Descreva o público e explore antes de ativar: convite enviado não volta atrás.</p>
        <div className="li-two-grid li-audience-choice">{[["filters","SlidersHorizontal","Por filtros","Cargo, setor e localização. Encontra quem se parece com o cliente ideal."],["post","MessageSquare","Por engajamento em post","Quem curtiu ou comentou um post. O assunto vira a abertura da conversa."]].map(([value,icon,title,body])=><button key={value} type="button" aria-pressed={audience===value} onClick={()=>setAudience(value)}><Icon name={icon} size={20}/><strong>{title}</strong><small>{body}</small></button>)}</div>
        {audience==="post"?<Field label="Link do post do LinkedIn"><input type="url" placeholder="https://www.linkedin.com/posts/…" value={link} onChange={e=>setLink(e.target.value)}/></Field>:<>
          <Field label="Descreva quem você quer alcançar"><textarea rows={3} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Ex.: sócios de empresas de tecnologia em São Paulo"/></Field><Button type="button" disabled={!description.trim()} icon="Sparkles" onClick={()=>setUnavailable(true)}>Montar filtros com IA</Button><small className="li-muted">A sugestão cai nos campos abaixo para você revisar. Nada é aplicado sozinho.</small>
          <div className="li-view li-filter-mode"><Button type="button" aria-pressed={filterMode==="filters"} onClick={()=>setFilterMode("filters")}>Montar filtros</Button><Button type="button" aria-pressed={filterMode==="link"} onClick={()=>setFilterMode("link")}>Colar link do LinkedIn</Button></div>
          {filterMode==="link"?<Field label="Link da busca do LinkedIn"><input type="url" value={link} onChange={e=>setLink(e.target.value)} placeholder="https://www.linkedin.com/search/results/people/…"/></Field>:<>
            <LinkedinSuggestionField label="Cargos" value={roles} onChange={setRoles} options={["CEO","Sócio","Fundador","Proprietário","Diretor","Diretor Comercial","Head de Vendas","Gerente Comercial","Diretor de Marketing","Gerente de Marketing","Head de Marketing","Diretor de TI"]} help="Até 5 cargos. Somar cargos amplia o público; cada cargo vira uma busca própria."/>
            <LinkedinSuggestionField label="Localização" value={location} onChange={setLocation} options={["Brasil","São Paulo","Rio de Janeiro","Minas Gerais","Paraná","Santa Catarina","Rio Grande do Sul","São Paulo e Região","Argentina","México","Portugal","Estados Unidos"]} help="País, estado ou cidade. Somar lugares amplia o público."/>
            <LinkedinSuggestionField label="Setor" value={sector} onChange={setSector} options={["Software","Marketing e publicidade","Serviços financeiros","Educação","Varejo","Logística e cadeia de suprimentos","Indústria","Serviços e consultoria de TI","Hospitais e atendimento médico","Construção"]} help="Opcional. A pessoa precisa atender a todos os campos preenchidos."/>
            <Field label="Palavra-chave no perfil (opcional)" help="A palavra precisa aparecer no perfil. Na dúvida, deixe vazio e explore antes."><input value={keyword} onChange={e=>setKeyword(e.target.value)}/></Field>
            <details className="li-combination"><summary>Como estes campos se combinam</summary><p>Dentro do mesmo campo, soma. Entre campos, cruza: cargo e localização e setor. Cada campo novo fecha o público.</p></details>
            <fieldset className="li-checkboxes"><legend>Distância na rede</legend><label><input type="checkbox" defaultChecked/>2º grau, amigo de amigo</label><label><input type="checkbox" defaultChecked/>3º grau, fora da sua rede</label><small>Quem já é sua conexão (1º grau) fica sempre de fora.</small></fieldset>
          </>}
        </>}
        <div className="row wrap"><Button type="button" icon="Search" onClick={()=>setUnavailable(true)}>Explorar público</Button><small>Explorar não gasta convite.</small></div><label className="li-check"><input type="checkbox" checked={decisionMaker} onChange={e=>setDecisionMaker(e.target.checked)}/><span><strong>Descartar antes do convite quem não for decisor</strong><small>A triagem precisa da integração e será revisada antes de qualquer convite.</small></span></label>
      </section>
      <section className="li-panel"><h2><span className="li-step">3</span>O que a pessoa vai ler no convite</h2><p>Deixe em branco para enviar convite sem nota.</p><Field label="Suas provas (o que a ficha {prova} escreve)"><input value={proof} onChange={e=>setProof(e.target.value)} placeholder="Uma frase curta e verificável sobre sua empresa"/></Field><Button type="button" onClick={()=>setExtraProof(!extraProof)}>Outra prova (para usar em outro ângulo)</Button>{extraProof&&<Field label="Outra prova"><input/></Field>}<small className="li-muted">Frases verificáveis. Vão literais, sem a IA reescrever.</small><div className="li-tokens"><span>Inserir:</span>{["{nome}","{empresa}","{cargo}","{setor}","{prova}"].map(token=><Button type="button" key={token} onClick={()=>append(token)}>{token}</Button>)}<Button type="button" icon="Sparkles" onClick={()=>setUnavailable(true)}>trecho da IA</Button></div><Field label={`Texto do convite · ${note.length} / 300`}><textarea rows={4} maxLength={300} value={note} onChange={e=>setNote(e.target.value)}/></Field><Button type="button" onClick={()=>setNote("Olá, {nome}! Vi seu trabalho na {empresa} e achei que valia nos conectarmos. Posso acompanhar suas novidades por aqui?")}>Usar a nota sugerida (sem pedido, só o motivo pra conectar)</Button></section>
      </div><aside className="li-campaign-aside"><section className="li-panel"><h2><span className="li-step">4</span>Em que ritmo os convites saem</h2><div className="li-two-grid"><Field label="Convites por dia" help="É o alvo da campanha, não uma promessa de envio."><input type="number" min={1} max={100} required value={daily} onChange={e=>setDaily(Number(e.target.value))}/></Field><Field label="Expirar convite depois de (dias)" help="Retirar um convite não devolve a cota da semana."><input type="number" min={1} max={365} required value={expiry} onChange={e=>setExpiry(Number(e.target.value))}/></Field></div><label className="li-check"><input type="checkbox" checked={warming} onChange={e=>setWarming(e.target.checked)}/><span><strong>Permitir aquecimento social</strong><small>Visitar o perfil e curtir um post antes do convite. Execução pendente de integração.</small></span></label></section>
      <section className="li-panel"><h2><span className="li-step">5</span>Para onde vão os que aceitarem</h2><Field label="Lista dos aceites"><select defaultValue="new"><option value="new">Criar uma lista nova automaticamente (recomendado)</option></select></Field><p className="li-muted">É esta lista que alimenta a cadência. Nenhuma lista é criada nesta prévia.</p><label className="li-check"><input type="checkbox" role="switch" checked={enrich} onChange={e=>setEnrich(e.target.checked)}/><span><strong>Enriquecer sozinho quem aceitar</strong><small>Roda depois do aceite, antes da cadência. Integração pendente.</small></span></label><Field label="Lista dos não aceites (opcional)"><select defaultValue="none"><option value="none">Não usar</option><option value="new">Criar uma lista nova ao implementar a campanha</option></select></Field><p className="li-muted">Convites expirados podem alimentar uma cadência de e-mail. Os convites do LinkedIn saem espaçados no horário comercial.</p></section>
      </aside><div className="li-draft-notice"><Icon name="Info" size={17}/><span>Rascunho local desta tela. Não é salvo no workspace e será perdido ao sair ou recarregar. Busca, IA e envio aguardam integração.</span></div><div className="form-actions"><LinkButton href="/linkedin/campaigns">Cancelar</LinkButton><Button variant="primary" type="submit" disabled={!name.trim()}>Revisar rascunho local</Button></div>
    </form>
    {review&&<Modal title="Revisar rascunho local" onClose={()=>setReview(false)}><div className="stack"><h3>{name}</h3><dl className="li-review"><dt>Público</dt><dd>{audience==="post"?"Engajamento em post":filterMode==="link"?"Busca por link":[roles,location,sector,keyword].filter(Boolean).join(" · ")||description||"Ainda não definido"}</dd><dt>Convite</dt><dd>{note||"Sem nota"}</dd><dt>Ritmo pretendido</dt><dd>{daily} por dia · expirar em {expiry} dias</dd></dl><Notice>A prévia permanece apenas nesta tela. Nenhuma campanha, lista, busca ou envio foi criado. A integração LinkedIn ainda não está disponível.</Notice><div className="form-actions"><Button onClick={()=>setReview(false)}>Continuar editando</Button></div></div></Modal>}
    {unavailable&&<LinkedinUnavailable title="Integração LinkedIn pendente" onClose={()=>setUnavailable(false)}/>}
  </>;
}
function LinkedinSuggestionField({label,value,onChange,options,help}: {label:string;value:string;onChange:(value:string)=>void;options:string[];help:string}) {
  return <div className="li-suggestion-field"><Field label={label}><input value={value} onChange={e=>onChange(e.target.value)}/></Field><div className="li-suggestions">{options.map(option=><button type="button" key={option} aria-pressed={value.split(", ").includes(option)} onClick={()=>{const selected=value?value.split(", "):[];onChange(selected.includes(option)?selected.filter(x=>x!==option).join(", "):[...selected,option].join(", "));}}>{option}</button>)}</div><small className="li-muted">{help}</small></div>;
}
