# 06IA — administração central e inteligência adaptativa

Implementação nativa em `codex/platform-ai-06ia`, iniciada sobre18fcc4a. Escopo: infraestrutura de IA administrada pelo dono do SaaS, com contexto, dados e consumo privados de cada cliente. A publicação na internet e a certificação de qualidade de provedores reais continuam separadas desta homologação local.

## Comportamento entregue

- Proprietário/admin de um workspace cliente não configura Apify, modelos, chaves, sondas, diagnósticos ou OAuth de infraestrutura. O menu de provedores desaparece; a URL direta explica a administração pela plataforma. As APIs e a política SQL também negam a operação, inclusive com papel antigo no cliente.
- O registro protegido `app.platform_ai_control` designa um workspace de controle e usuários explícitos. Associação administrativa atual nesse workspace e designação protegida são necessárias. Cadastro público nunca concede esse acesso. A identidade retornada ao frontend é apenas informativa.
- Política, modelo e atestação convencional são centrais. OAuth lê exclusivamente a conexão administrativa existente. Contexto aprovado da empresa/produto, pedido atual, evidências, propostas, cache e orçamento permanecem no workspace que pediu a execução.
- Instruções internas `prometeus-skills-v1` orientam leitura de contexto, público, cadência, mensagem, qualificação, resumo, segunda opinião, decisores, atribuição de contato e ranking. São contratos de produto, sem execução de código ou carregamento de skills enviadas pelo cliente. JEV recebe avaliação estruturada; não se presume um loader de skills do agente.
- O pedido atual delimita público/local/canal; o perfil da empresa explica a oferta. Por exemplo, clínicas odontológicas no Rio não são substituídas pelo ICP anterior do vendedor. Contexto ainda não aprovado é omitido como conhecimento aprovado. Fonte/pedido não podem escolher credencial, ferramenta ou permissões.
- Versão das instruções integra fingerprints e contrato de enriquecimento. Cache de qualificação inclui os dados delimitados efetivamente enviados à avaliação, inclusive contexto aprovado e versão. Resultados incertos conservam reservas e não repetem inferência automaticamente.
- Alteração de política/conexão durante a chamada preserva recibo e consumo, mas impede nova publicação de qualificação/recomendação. Ranking recebido não equivale a ranking autorizado. Revogação do administrador interrompe sonda enfileirada e impede a atestação global, inclusive se a resposta chegar depois.
- A revisão de cadências e o dispatcher consultam a mesma revisão central. Mudanças posteriores conservam o bloqueio conservador anterior: exige-se nova revisão antes de enviar.

## Administração e implantação

1. Aplicar as migrações com a identidade de deploy: `npm run db:migrate`.082 é imutável após a aplicação; não editar migrations já usadas.
2. No ambiente protegido do servidor, definir `PLATFORM_AI_WORKSPACE_ID` com o ID de um workspace de controle existente e `PLATFORM_AI_ADMIN_USER_IDS` com IDs de usuários verificados, separados por vírgula. Cada um deve ser owner/admin desse workspace. Nunca obter essa lista de cadastro ou payload do usuário.
3. Executar `npm run ai:provision` com a credencial de migração. O comando valida as identidades e grava o registro protegido. O processo web/worker não pode alterar esse registro. Manter o ID de controle igual no banco e nas réplicas do servidor; sem configuração coerente, IA falha fechada.
4. Entrar com a identidade designada, selecionar o workspace de controle e acessar Configurações → Provedores de IA. Salvar política/modelo e revisar uma sonda antes de confirmar qualquer chamada real. Apify e chaves de API continuam nos segredos/perfis do servidor; os clientes não os cadastram.
5. Reiniciar processos web/worker após alterar segredos/configuração de ambiente. Para revogar acesso, remover a designação pela implantação protegida e/ou remover/rebaixar a associação administrativa. Reexecutar o provisionamento não revoga a conta remota do provedor.

No localhost, foi designado o proprietário verificado único da Agência Prometeus já identificado no baseline financeiro. Política, arquivo OAuth criptografado e conexões de canais foram preservados. Nenhuma chave nova, rotação ou desconexão remota foi realizada. ChatGPT OAuth conserva a restrição do piloto local; isso não habilita uma oferta comercial hospedada. Para hospedagem pública, usar somente adaptador/credencial elegíveis, com sua habilitação própria.

## Evidência e reprodução

TDD com PostgreSQL real em catálogos efêmeros e transporte de provedores controlado. Cenários: cliente negado em API/SQL, designação explícita, revogação, herança de política/atestação, sonda incerta, namespace OAuth, pedido atual e contextos de duas empresas, consumo isolado, mudança central durante I/O e cache após mudança de contexto. Nenhum teste dessa rodada chamou modelo/Apify pagos ou enviou mensagem externa.

Liberação pós-correções:320/320 integrações,305/305 unitários,41/41 testes focados das correções, build de produção e typecheck após build aprovados. A revisão independente única identificou3 problemas importantes; todos receberam reprodução com falha antes da correção. A matriz está em [verification.json](evidence/06ia/verification.json). Comandos: `npm test`, `node scripts/test-integration.mjs`, `npm run build`, `npm run typecheck`. Localhost3210 responde e as seis lanes contínuas estão vivas, com último sucesso e zero falhas na medição final.

Navegador local real:12 verificações de cliente em1920/390/320px, sem menu de provedores/overflow/pageerror; contexto editável sem submissão. Administração nas mesmas três larguras: menu autorizado, edição não salva bloqueia sonda, revisão aberta e cancelada sem confirmar;503 controlado recuperado. Capturas locais mascaradas e resumos em [ui.json](evidence/06ia/ui.json). A permissão administrativa temporária da identidade QA foi removida, o registro protegido restaurado exatamente e a sessão própria revogada; nenhuma sonda/job administrativo foi criado. [Encerramento](evidence/06ia/closure.json).

## Fidelidade e limites

A tela administrativa é própria, sem referência observada do painel do dono do CadenceFlow. A navegação do cliente preserva a estrutura existente e retira a configuração de infraestrutura. Comparação observacional do contexto, sem submissões na referência:1920/390/320px, Exo2 nos títulos, navegação/colunas e seções conforme as capturas. A referência apresentou overflow em320px; o local não. Estados distintos de aprovação não são equivalência de dados.

Ainda existem diferenças conhecidas na tela de contexto: referência com mais campos de entrega/modelo de preço, ícones por seção e feedback da leitura; local com contrato próprio de produtos/aprovação e rodapé de persistência. Elas são registradas em EV-271 como diferenças preexistentes, não foram corrigidas nem recebem aceite100% por esta entrega. Estados pagos/profundos não observados continuam não observados. Não se declara réplica integral do produto, nem backend privado idêntico.

Cobertura com modelos/Actors reais, acurácia de extração/qualificação, robustez probabilística, hospedagem comercial OAuth, carga e retenção públicas não foram certificadas. As instruções e a validação determinística reduzem entradas/saídas aceitas; não garantem que um modelo respeitará toda intenção semântica. Extração de contato exige citação; confiança não comprova número ativo/WhatsApp ou entregabilidade.

## Decisões assumidas e custos

1. Reusar checkout/runtime com branch, conforme execução nativa autorizada: sem isolamento físico de checkout.
2. Preservar credenciais e OAuth administrativos existentes, sem novas chaves/chamadas: cobertura externa real permanece não medida.
3. Reusar workspace de controle e protocolos existentes: operador precisa designar identidades explicitamente antes do deploy público.
4. Incluir a revisão central do dispatcher nesta entrega: alterações globais podem exigir nova revisão de cadências já preparadas.
5. Usar permissão temporária de QA para a UI administrativa real: restauração obrigatória e comprovada no encerramento.
6. Não medir acurácia/robustez adversarial em chamadas pagas: nenhuma garantia de qualidade probabilística.
7. Manter elegibilidade OAuth hospedada/carga/retenção como gates posteriores: esta entrega não certifica lançamento público.
8. Separar revisão de código independente da evidência visual/bootstrap do executor: sem confirmação independente de paridade visual.
9. Reutilizar evidência factual de pessoas/contatos após mudanças apenas do vendedor: avaliação contextual associada pode permanecer antiga até expirar; não comprova entregabilidade. Mudanças de instrução já invalidam o contrato.

Nenhum apontamento menor foi adiado pela revisão.06IA concluído no escopo local e controlado descrito acima. O próximo pacote é06D.1 — autoria, variantes/anexos, rascunho e agenda das cadências. Não foi iniciado automaticamente nesta validação.
