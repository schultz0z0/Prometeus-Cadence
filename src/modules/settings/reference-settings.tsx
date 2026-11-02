"use client";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { Button, Field, Notice } from "@/components/ui/primitives";

export {NotificationSettings} from './notification-settings';
import {DuplicateContacts,PrivacySettings} from './data-lifecycle';
import {WebhookSettings} from './webhooks';

export function ReferenceSettings({section}:{section:string}) {
  if(section==='dados') return <DuplicateContacts/>;
  if(section==='privacy') return <PrivacySettings/>;
  if(section==='mcp') return <div className="reference-settings mcp-reference"><h1>MCP</h1><p className="subtitle">Opere seu workspace de dentro do Claude ou do ChatGPT, por linguagem natural.</p><section className="reference-panel"><header><Icon name="CirclePlay"/><div><h2>Como funciona, em 2 minutos</h2><p>Do conector instalado ao primeiro pedido feito pela conversa.</p></div></header><div className="reference-panel-body"><Button disabled icon="Play">Ver o vídeo</Button></div></section><section className="reference-panel"><header><Icon name="Bot"/><div><h2>Claude e ChatGPT</h2><p>Criar cadências, qualificar leads e consultar métricas sem sair da conversa.</p></div></header><div className="reference-panel-body"><Field label="URL DO CONECTOR"><input readOnly disabled placeholder="Conector em preparação"/></Field><Notice>O servidor MCP do Prometeus ainda não está disponível. A IA do aplicativo é gerenciada pela plataforma e usa o contexto aprovado da sua empresa.</Notice><Link href="/settings/context">Revisar contexto de IA →</Link><div className="field-grid"><div><h3>Claude</h3><p>Adicione um conector personalizado quando o endpoint do workspace for habilitado.</p></div><div><h3>ChatGPT</h3><p>O conector usará as permissões da sua conta e pedirá autorização de acesso.</p></div></div></div></section><section className="reference-panel"><header><Icon name="MessageSquare"/><h2>Comece por aqui: pedidos prontos</h2></header><div className="reference-prompt-grid">{['Configurar a conta do zero','Reescrever uma cadência com tom humano','Leads novos toda semana','O que responder para quem respondeu'].map(t=><div key={t}><strong>{t}</strong><p className="muted">Disponível com a integração MCP do workspace.</p></div>)}</div></section></div>;
  return <WebhookSettings/>;
}
