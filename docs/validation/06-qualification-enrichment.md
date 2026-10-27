# 06B.2 — qualificação, enriquecimento e recorrência

26/10/2026. Branch `codex/qualification-enrichment-06b2`, base `ab336b7`. [Plano](../superpowers/plans/2026-10-26-prometeus-cadence-06b2-qualification-enrichment.md) e [contrato](../superpowers/specs/2026-10-26-prometeus-cadence-06b2-design.md). Implementação própria operacional nos casos abaixo; não é comprovação do backend privado ou paridade integral do CadenceFlow.

## Resultado entregue

- Qualificador avulso e recorrente com módulos efetivos: e-mail, telefone, descoberta de site, extração profunda, formato/DNS, CNPJ, classificação e resumo por IA. Opções de site/e-mail ausente/processados, limite, idioma e critérios chegam ao executor. “Desqualificar se não encontrar e-mail” produz proposta aplicável, sujeita à revisão. Formato/DNS não verificam a existência de uma caixa postal.
- Enriquecimento em lotes de até100 CNPJs únicos. O seletor de lotes permite acessar empresas posteriores às100 primeiras. Revisão mostra empresas, cache, teto de novas consultas, crédito comercial e reserva de computação. Preview não cria lista, execução nem chamada paga; confirmar e aplicar são ações distintas.
- Fluxo limitado de CNPJ/QSA → site da empresa → busca pública de decisores/perfis LinkedIn → extração estruturada por LLM tradicional → validação literal das fontes. O modo híbrido acrescenta avaliação JEV sobre as evidências. Nome/cargo do QSA ajudam na busca por nome + empresa quando o site não resolve o contato. Telefone corporativo próximo ao nome não se transforma em celular pessoal.
- As instruções internas versionadas distinguem CNPJ/QSA, páginas da empresa, resultados públicos do LinkedIn, homônimos, conflitos e dados ausentes. Conteúdo coletado é dado não confiável, não instrução. Sem pessoa e contato pessoal explicitamente atribuídos por citação existente: abstenção. Não inferimos padrão de e-mail, titularidade, caixa válida nem WhatsApp ativo. CPF, idade e nacionalidade não integram o registro de sócios mantido pelo módulo.
- Cache privado por workspace/CNPJ/contrato:30 dias útil,1 dia sem resultado. Uma nova resolução útil consome um crédito comercial por empresa; vazio e reutilização do cache não consomem. O teto também limita novas consultas vazias. Custos dos fornecedores são independentes do crédito comercial. Mudança de limite não invalida cache pago; cache prometido que expirou não dispara consulta paga silenciosamente.
- Receipts e consumo técnico são persistidos mesmo quando o modelo devolve formato inválido ou a autorização muda durante a chamada. Configuração, associação, lease e orçamento são rechecados antes da publicação. POST incerto mantém reserva e exige reconciliação, sem repetição automática. Cancelamento registra intenção de abortar e consulta o resultado, sem repetir o POST de abort.
- Resultados úteis permanecem revisáveis, inclusive se uma empresa posterior falhar. Aplicação transacional cria uma lista de pessoas e prova de origem protegida no banco. Replay não duplica contato/consumo; campos/contexto alterados rejeitam aplicação antiga. A isenção de importações exige essa prova, não um campo editável enviado pelo cliente.
- Detalhe do contato mostra origem, cargo, citação e qualidade. O filtro “com decisor com evidência” usa a prova protegida e os dados atuais; editar uma etiqueta não forja enriquecimento. Mudanças de dados que deixam de corresponder à prova removem a alegação.
- Reengajamento transfere contatos da mesma base para outra lista somente após cadência concluída, intervalo mínimo e ausência de resposta/opt-out/trabalho pendente ou incerto. Registra transferência, conserva identidade/histórico e não inicia uma mensagem nem outra cadência. Conclusões antigas sem data comprovada permanecem inelegíveis; novos eventos têm data real de conclusão.

## Ferramentas e limites das fontes

Foram reaproveitados os perfis Apify CNPJ/WEB e o roteamento/journal de IA existentes. O Actor CNPJ configurado fornece dados empresariais mais amplos que nome/cargo, mas não comprova contato pessoal; sua documentação informa e-mail ausente e permite QSA via `includePartners`. Campos corporativos preservados incluem endereço, porte, CNAE, capital e natureza jurídica.

Não há Actor autenticado dedicado ao LinkedIn configurado nesta entrega. O caminho implementado usa busca WEB/páginas públicas, com cobertura dependente do que está publicado. Não se alega coleta privada, descoberta garantida de celular ou atividade de WhatsApp. Nenhum Actor novo foi contratado, instalado ou ativado. A consulta obrigatória ao acervo O Setup não pôde ser feita porque `setup-agent` não estava exposto/configurado nas ferramentas disponíveis; por isso reutilizamos os recursos existentes, sem recomendar uma ferramenta nova ou criar uma skill instalável do Codex.

No07A, OAuth oficial sozinho não autoriza todo o fluxo observado no concorrente. A documentação LinkedIn restringe convites e mensagens a programas aprovados; mensagens exigem ação afirmativa específica do membro, excluindo eventos programados/automatizados. Um futuro conector precisa comprovar as capacidades concedidas, e o sistema deve bloquear ações não suportadas. Isso não comprova como o CadenceFlow executa suas próprias operações. Fontes primárias e barreiras: [KB](../reverse-engineering/visual-2026-10-25/clone/barriers.md).

## Referência, visual e navegador

REA observou o redirecionamento de um navegador novo ao login e encerrou seu processo próprio (`ev_6e3902656227f5d891d7375a5f757c401deceb8a55840c598c5f94d5d2ca295d`). Isso é prova de barreira de autenticação, não de enriquecimento. Playwright/RES usaram uma sessão autenticada para observação transitória, com bloqueio de métodos de escrita e restauração do armazenamento local. Nenhum preview pago, automação, compra, mensagem ou configuração foi confirmado na referência.

Foram comparados qualificador vazio/selecionado, enriquecimento e superfície inicial do wizard em1920×855 e390×844. Corrigidos cartões de consumo, ajuda numerada/colapsada no mobile, tabela em cartões, ação principal e popups. A referência mostrou overflow no qualificador mobile; isso não foi reproduzido no app local. O wizard da referência permaneceu parcialmente em carregamento sob o guard de escrita; seu avanço não recebe aceite nesta sessão. Sua semântica de reengajamento veio da observação anterior do seletor de fontes, não de uma execução remota.

No app próprio: configuração/preview, loading, falha503 controlada, Escape, revisão de aplicação, resultado, detalhe com evidência e filtros foram verificados em1920/390/320px. A aplicação usou o backend real e persistiu após recarga. O replay visual da seleção já aplicada modificou apenas uma resposta GET de QA e nunca foi confirmado novamente. Esperamos o término da transição de layout de200ms antes de medir: o falso overflow capturado durante o redimensionamento não foi tratado como falha persistente. As medições finais estabilizadas não tiveram overflow horizontal nem `pageerror` nos estados declarados.

Evidência resumida: [visual.json](evidence/06b2/visual.json). As capturas mascaradas de trabalho permanecem em `output/playwright/06b2/`, ignoradas pelo Git; alguns exemplos revisados estão em [screens](evidence/06b2/screens). Dados de sessão/credenciais não acompanham a entrega.

Diferenças explícitas: CTA “Histórico” ocupa a ação do enriquecimento em vez de vender um crédito cujo catálogo ainda não está habilitado; a mensagem informa contato publicado sem prometer WhatsApp ativo. A conta de referência não ativou trial, enquanto a QA local tem trial de7 dias. Shell/branding, conteúdo, contagens e estados pagos diferem; não é comparação pixel a pixel do mesmo estado populado. Ajustes globais e estados não observados continuam com seus donos06A-V/06F/08A.

## Verificação e revisão

- **302/302 unitários** e **306/306 integrações**, zero falhas na execução final. Catálogo PostgreSQL novo por rodada, separado do banco local durável. Migrações080/081 também aplicadas ao banco local; não serão editadas após esse rollout.
- Build de produção e TypeScript sequencial aprovados após as últimas mudanças visuais. Localhost3210 reiniciado oculto; seis serviços contínuos vivos e com ciclos bem-sucedidos, sem janelas de terminal recorrentes criadas pelo procedimento.
- Testes cobrem evidência, filtros/idioma, fonte alterada, cache útil/vazio/expirado, cobrança única concorrente, crédito esgotado com cache, isolamento/RLS, role/configuração revogada, POST incerto/reconciliação, cancelamento, saída malformada com consumo, resultado parcial aplicável e falsificação de isenção/proveniência.
- Recorrência cobre filtro/módulo reais, fingerprint de trabalho já aplicado, data/intervalo, resposta/opt-out, pendência/incerteza, pausa e replay. Nenhum teste envia mensagem real.
- Revisão independente única:0 críticos,6 importantes. Todos reproduzidos RED→GREEN: telefone corporativo aceito como pessoal; publicação após troca de configuração; perda do estado parcial na reconciliação; proposta “sem e-mail” ignorada; fingerprint ausente na recorrência; lotes da UI além de100 inacessíveis. Sem menores abertos nessa revisão.
- A primeira regressão completa pós-revisão teve305/306 por um teste antigo que exigia duas leases simultâneas sob `SKIP LOCKED` do mesmo workspace. O teste agora adquire as leases sequencialmente e mantém o despacho concorrente que verifica a quota; a nova regressão completa passou306/306. O protocolo de produção não foi alterado por esse ajuste de fixture.
- Validação RES da KB aprovada com0 erros/0 linhas abertas. O script original usa chaves de caminho com `/` e falhou em reconhecer headings de barreira quando executado no Windows com `\`; a cópia temporária de execução normalizou apenas esse separador. O script instalado foi preservado e nenhuma regra de validação foi suprimida.

## QA e continuidade

Identidade/workspace QA dedicados reutilizados. Dois leads empresariais fictícios e um decisor entregue foram removidos pelo comando real do app; somente a nova lista de saída vazia foi removida depois, por ID e nome conhecidos. Permanecem o workspace/lista vazios preexistentes e o histórico concluído explicitamente marcado como sintético. Política de IA e workspace QA anterior restaurados; sessão QA revogada; zero jobs QA ativos. A assinatura original foi conferida contra o baseline e preservada. [closure.json](evidence/06b2/closure.json).

O aceite deste pacote é local/operacional, com fornecedores controlados. Cobertura e acurácia reais exigem piloto pago próprio autorizado; deploy público, retenção, carga e certificação operacional permanecem08B. Não é necessário o operador executar uma ação manual para encerrar esta QA.

### Direção nova do operador:06IA

Durante o encerramento, o operador definiu **Apify/LLM como configuração exclusiva do dono da plataforma**, compartilhada pelos clientes do SaaS; as contas dos clientes conectam somente seus canais/identidades próprios. Chaves OpenAI/Gemini/Apify já são lidas do servidor; porém a política/teste/OAuth de IA ainda têm tela e autorização por administrador do workspace. **Essa administração ainda precisa ser centralizada: não está concluída neste pacote.** A distinção entre administrador da plataforma e proprietário de um cliente não pode depender de esconder um botão.

O novo **06IA — administração e inteligência central de IA** vem antes da próxima ampliação06D.1/06F: provedor/modelo e permissões centrais, instruções versionadas por tarefa, contexto da empresa do workspace + público-alvo + pedido atual, interpretação dos contratos Apify, regras de abstenção e avaliações por cenário. O contexto do cliente é dado privado parametrizado, não uma chave/API ou autoridade para trocar as instruções centrais. JEV será avaliado como componente estruturado; não se pressupõe suporte nativo a skills de agente. Aceite inclui ausência de vazamento entre empresas, prompt injection, mudança de contexto/configuração, consumo/quotas e conjuntos de avaliação verificáveis. Nenhuma skill/plugin novo foi instalado para registrar esse marco.

### Decisões de execução e custo se estiverem erradas

1. Reusar o checkout/runtime e uma branch própria, sem outro checkout físico: evita desalinhar a homologação; perde isolamento físico de arquivos.
2. Reusar Apify WEB/CNPJ + LLM para evidência pública, sem presumir Actor LinkedIn autenticado: preserva o contrato disponível; cobertura pode ser insuficiente e exigir outro adaptador aprovado.
3. Excluir limites/credenciais da identidade do cache, incluindo perfis/modelo/contrato: alterações de orçamento não apagam uma resolução paga; uma mudança semântica não versionada poderia reutilizar dado antigo até o TTL.
4. Reengajamento significa transferir concluídos sem resposta, conforme seletor observado: não requalifica nem envia; o usuário precisará da ação posterior de cadência se desejar contato.
5. Não inventar data de conclusão histórica: contatos sem data ficam fora; uma base legada pode exigir backfill com prova.
6. A revisão independente não conferiu todos os viewports: a conferência foi do implementador; diferenças visuais não observadas podem permanecer.
7. Não usar chamadas pagas para julgar cobertura/acurácia: validação controlada não mede a qualidade do fornecedor real; o piloto ainda é necessário.
8. Verificar build/regressão diretamente, sem inferir sucesso do parecer: as provas valem para a árvore e ambiente medidos, não para toda implantação futura.
9. Reservar aceite público/retensão/carga para08B: este pacote não certifica produção pública; exige homologação posterior.
10. Ajustar apenas a preparação do teste OpenWA para o contrato `SKIP LOCKED`, mantendo a corrida de despacho: evita um falso negativo; não mede aquisição concorrente de leases nesse teste específico, coberta pelos contratos existentes.
11. Incorporar06IA como próxima entrega, sem trocar a implementação em encerramento: mantém a sequência autorizada pelo operador; a administração por workspace continua uma pendência explícita que bloqueia alegar prontidão comercial dessa configuração.

Menores adiados da revisão final: nenhum. Pendências acima são limites de observação/produção ou novo escopo, não falhas menores ocultadas.
