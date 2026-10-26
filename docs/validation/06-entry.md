# 06A-P e fechamento visual conhecido06A-V

Data:26/10/2026. Plano autorizado: `docs/superpowers/plans/2026-10-26-prometeus-cadence-06ap-entry.md`. Entrega continua o roteiro aprovado; não constitui aceite100% de todo o produto.

## Implementação

- Cadastro com telefone canônico, confirmação de senha, documentos próprios em popup/URL e checkbox desmarcado. Hook de criação valida aceite/versões no servidor e grava horário do servidor. Campos não podem ser sobrescritos por `update-user`.
- Migração074 aditiva; usuários anteriores permanecem acessíveis. Novas identidades sociais precisam completar cadastro antes de obter acesso às operações do workspace. O fluxo OAuth remoto não foi aprovado/executado automaticamente: foi exercitado o hook real de criação e o gate/serviço local correspondente.
- Verificação encaminha para destino permitido, conservando intenção de plano ou convite. Convites continuam vinculados ao e-mail verificado e ao estado autoritativo do servidor. Trocar conta encerra a sessão.
- Recuperação e redefinição preservam destino de entrada. Link inválido/expirado/utilizado mostra caminho para pedir outro; respostas não confirmam se um endereço está cadastrado. Reenvio tem trava no cliente e rate limit existente no servidor.
- Criar conta/workspace não ativa trial, checkout ou assinatura. Mantidos trial7 dias sem cartão/cobrança automática e créditos pré-pagos.
- Assistente passou de modal central para painel flutuante lateral460×620 com limite de viewport, fechamento por Escape, retorno de foco e atalhos reais. Composer permanece desabilitado/identificado porque conversa e diagnósticos contextuais pertencem06F. O feed de notificações06C.3 também não afirma falsamente que canais estão desconectados.

## Documentos próprios

Preparados a pedido expresso do operador. Publicação ampliada **homologacao-2026-10-26-v2**, primeira publicação preservada em histórico. [Registro e fontes](../legal/README.md). Texto descreve homologação e a operação efetiva, sem copiar os termos do concorrente ou inventar CNPJ/endereço/encarregado. Identificação jurídica completa, governança e revisão para a oferta comercial continuam necessárias antes de produção.

## Provas funcionais

- Unitários finais:265 aprovados,0 falhas, incluindo documentos históricos e recusa de versões inexistentes.
- Integrações focadas finais:19 aprovadas — autenticação, registros protegidos, gate social, sessão não verificada, usuário legado, convites/isolamento, rate limit, migrações e recuperação de senha. Banco isolado descartado ao concluir.
- E2E de navegador390px: cadastro→popup de termos→rascunho preservado→e-mail capturado→verificação→workspace→plano; recuperar/redefinir senha→link usado; login mantém convite inválido→rejeição; troca de conta revoga sessão. Não houve compra nem envio externo.
- Jornada de navegador repetida no build final com publicaçãov2. Checagem SQL dos dois fixtures confirmou billing `inactive`, sem trial iniciado e sem assinatura, e a versão jurídica correspondente em cada aceite. Todas sessões dos fixtures revogadas. Dois workspaces vazios, cada um pertencente exclusivamente à sua identidade de QA, foram retidos como fixtures; Agência Prometeus não foi alterada por essas identidades.
- Revisão independente com um retorno sobre a correção final: P3 de foco em rerender corrigido por callback estável; acrescentados testes do hook social real e da sessão autenticada não verificada. O retorno identificou os dois casos de enumeração descritos abaixo; ambos foram reproduzidos e corrigidos antes da entrega.
- Suíte completa de integração:266 aprovados,0 falhas. Depois da publicaçãov2 e das proteções abaixo, reexecução focada19/19. Typecheck e builds aprovados. A entrega inclui refinamento de espaçamento/cópia e remove explicações técnicas de configuração do botão Google indisponível.
- Regressões encontradas e corrigidas: metadados ausentes eram recusados apenas no hook de criação, distinguindo e-mail existente de novo por200/400. A revisão também identificou formato de formulário/casing de Content-Type e o campo sintético `registrationRequired:null` versus false. Três testes reproduziram os casos. Signup agora exige JSON normalizado, valida antes do handler e mantém false também na resposta sintética; o hook social continua marcando true e foi revalidado. Resultado19 testes focados verdes, sem retirar a proteção do hook.
- Varredura pública:36 combinações,12 destinos×1920/390/320px,0 erros de página e0 overflow. Inclui documentos atual/histórico, recuperação, erros de token e redirecionamento não autenticado de convite/workspace/perfil. Versão jurídica inexistente retorna404.
- Assistente: Escape fecha, foco retorna ao gatilho, ciclo de fonte é restaurado, rerender não rouba foco e link de limites abre Meu plano. Conferido no browser, além da revisão estática.

## Visual e limites

Referência pública inspecionada anonimamente, sem submissão/aceite. Assistente inspecionado somente com abertura/fechamento transiente na sessão autenticada fornecida. RES usado para mascaramento/registro de evidências; REA de login/controlado e inventário anterior permanece como base de EV-266. Nenhuma observação do backend privado foi inventada.

Comparação: cadastro em1920×855,390×844 e320×740; assistente em1920×855 e390×844. Estrutura, tamanhos de campos, separação desktop/mobile, etapas, links e popup foram ajustados com base na referência. As diferenças deliberadas incluem marca própria existente,7 dias, sem cartão/autocharge, dados e documentos próprios, Google desabilitado enquanto não configurado, e chat06F indisponível. A sugestão contextual dinâmica da referência não foi simulada. Referência e local têm estados financeiros/dados diferentes; isso é separado da comparação da geometria do painel.

Artefatos locais mascarados em `output/playwright/entry-06ap/`; logs em `.runtime/entry-*.log`. Não versionar cookies, tokens, dados da conta ou screenshots sem máscara. Registro resumido final: `docs/reverse-engineering/visual-2026-10-25/evidence/EV-268-entry-implementation.json`.

## Próximo marco

**06A-H — homologação do ciclo financeiro existente em Stripe sandbox:** pacotes, idempotência de créditos, alteração/renovação/falha/cancelamento e retorno autoritativo na UI. O assistente conversacional completo permanece06F; nenhuma nova oferta/módulo foi habilitada por esta entrega.
