# Correção 03C — LLM convencional com ChatGPT OAuth direto

Data: 23/10/2026. Estado: aprovado pelo usuário para implementação direta, sem nova rodada de desenho/plano. Motivação: esclarecimento do usuário de que OAuth significa autorizar sua conta na plataforma, sem executável Codex CLI local. Referência: [estudo e fontes verificadas](../../research/2026-10-23-chatgpt-oauth-correction.md).

## Resultado

Em Configurações › Provedores de IA, acrescentar **ChatGPT OAuth** como LLM convencional independente de `codex-local`, OpenAI API e Gemini API. Administrador autoriza sua conta pelo navegador, escolhe um modelo disponível àquela conta e confirma um teste. O app usa OAuth diretamente por HTTPS para inferência, sem processo Codex local e sem extrair credenciais de outro aplicativo.

Preservar a regra aprovada 03B: LLM convencional faz decisões e geração sozinha quando JEV não está conectado; com JEV habilitado e disponível, ele decide acompanhado da convencional testada. JEV não recebe capacidade de executar sozinho. Não trocar automaticamente para uma API cobrada quando a cota do plano termina.

## Abordagem proposta e limites

1. **Recomendada para a instalação local atual:** Sign in with ChatGPT, registro dinâmico documentado e uso autorizado do plano através da API pública. Não exige CLI nem client ID de outro app. Aplicar somente com modo local e origem loopback compatíveis.
2. Oferta comercial hospedada: preparar a separação de configuração, mas bloquear ativação até haver registro/habilitação próprios da OpenAI e configuração válida. A documentação atual reserva esse cenário a parceiros habilitados. A implementação local não é evidência dessa habilitação.
3. Copiar o client ID fixo do AionUI ou encapsular o CLI: não atende ao contrato escolhido para o Prometeus. A referência AionUI serve para estudar fluxo e UX, sem copiar tokens, pressupostos de audiência ou validação incompleta de JWT.

As alternativas são condicionadas pelo ambiente: uso local agora e configuração comercial própria antes de hospedar. A proposta técnica não altera as assinaturas dos usuários nem promete acesso a qualquer modelo.

## Autorizações e isolamento

- Conectar, escolher modelo e desconectar exigem administrador atual do workspace.
- Gerar state, nonce e PKCE por tentativa; validade curta, uso único e vínculo a usuário, sessão, workspace, conexão e revisão. Validar vínculo novamente no callback.
- Persistir identificador opaco e estável do host antes da autorização; conservar o registro emitido da conta. Não substituir a conta ativa até validar a nova autorização.
- Validar assinatura do ID token contra JWKS oficial, emissor, audiência, nonce e validade. Verificar os escopos concedidos de uso do plano; identidade autorizada sozinha não habilita inferência.
- Guardar tokens e PKCE cifrados no servidor com AAD de workspace/conexão/revisão. DTOs não retornam tokens; não usar localStorage, URLs com tokens, logs, diagnósticos ou credenciais do AionUI.
- Modelo e fingerprint congelados nas revisões e jobs. Mudança de conexão, modelo, política ou revogação invalida novas execuções e confirmações antigas conforme os guardas existentes.
- Renovar token rotativo de forma serializada e atômica. Revogação exige reconexão; falha de rede não autoriza retry cego de inferência.

## Inferência e uso

Consultar catálogo da conta com seu bearer OAuth; mostrar os modelos anunciados sem declarar acesso comprovado antes de um teste concluído. Usar o contrato oficial de Responses para esse fluxo, com histórico próprio, streaming e armazenamento remoto desabilitado. Consumir o evento terminal antes de confirmar sucesso; stream incompleto ou erro tardio de cota não é geração válida.

Respeitar os parâmetros e ferramentas suportados no fluxo, adaptar saída JSON às validações existentes e limitar bytes/tempo localmente. Não conceder ferramentas extras por causa do OAuth. Reutilizar journal, reserva/consumo e resultados incertos; contabilizar chamadas do plano separadamente das APIs pagas, sem inventar equivalência monetária.

Não executar teste real automaticamente ao conectar ou abrir a tela. O usuário confirma a inferência e o uso do plano. Preparar fixtures OAuth/Responses que não dependam de créditos; piloto real requer o próprio usuário concluir a autorização. A cota da conta pode ser compartilhada com outras aplicações.

## UX

Exibir provedor escolhido, conta autorizada, modelo, estado da conexão, expiração/reconexão e último teste. Oferecer conectar, reconectar, selecionar modelo, testar e desconectar. Preservar seleção e rascunhos durante atualização automática. Não alterar o login do SaaS nem trocar de workspace por causa da autorização ChatGPT.

Manter `Codex CLI local` explicitamente identificado como opção separada para instalações que a utilizam. Conectar OAuth não migra silenciosamente jobs ou revisões já preparados com esse adaptador.

## Aceite

1. Registro inicial e reconexão com estado/nonce/PKCE corretos; rejeitar replay, expiração, sessão/workspace/revisão trocados, conta incompatível e token inválido.
2. Renovação concorrente sem perda do token rotativo e revogação sem reaproveitamento de credenciais antigas.
3. Catálogo da conta, modelo selecionado e inferência completa com Responses; tratar erro de cota durante stream como falha, não conteúdo aplicado.
4. Executar qualificação e geração sem CLI, com JEV ausente e em híbrido; JEV isolado continua bloqueado.
5. Testar isolamento entre duas empresas e rejeição de jobs preparados antes de mudança/revogação.
6. Fixtures, testes de integração, typecheck e build. Piloto real registrado separadamente; publicação comercial permanece pendente de habilitação externa.

## Revisão de implementação

Mapear os pontos síncronos atuais de configuração da IA para leitura de metadados por workspace, sem colocar tokens em `AiRoute`. Atualizar tipos/validações e funções de banco com migrações novas; não editar migrações aplicadas. Reaproveitar transporte, cifra e contratos existentes quando compatíveis, preservando privilégios mínimos do worker.

Decisão de implementação local: registros OAuth cifrados em armazenamento local privado por workspace, conforme a documentação do fluxo local, com gravação atômica. Uma trava transacional do PostgreSQL serializa refresh e alterações entre processos usando o papel existente do worker, sem ampliar seus privilégios. A intenção de refresh é persistida antes da chamada; interrupção exige reconexão sem repetir o token rotativo. Isso preserva os contratos síncronos de configuração atuais. Somente metadados não secretos compõem o fingerprint. O PostgreSQL continua armazenando política, revisão, jobs e uso. A modalidade hospedada comercial permanece desabilitada.
