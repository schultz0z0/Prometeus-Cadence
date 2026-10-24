# WhatsApp próprio — OpenWA gerenciado

O Prometeus usa [rmyndharis/OpenWA](https://github.com/rmyndharis/OpenWA), MIT, fixado no submódulo `third_party/openwa` em `173916c83b41e622f849ecd380bf36486dfd8cdf` (0.25.0). O motor é `whatsapp-web.js`, com `WWEBJS_WEB_VERSION=off`. Não é integração oficial: existe risco de bloqueio ou banimento, inclusive com baixo volume. Recomenda-se um número dedicado e destinatários autorizados. O software é open source; sua infraestrutura consome recursos.

## Instalação e operação local

Requisitos: Node24, npm e Docker Desktop em execução.

```powershell
rtk git submodule update --init --recursive
rtk npm ci
rtk npm run env:init
rtk npm run db:up
rtk npm run db:migrate
rtk npm run openwa:start
rtk npm run runtime:start
rtk npm run build
rtk npm start
```

Para atualizar uma instalação existente, pare o runtime e o processo Next antes de migrar/buildar; não substitua `.next` enquanto um servidor de produção usa seus arquivos. Recarregue app, runtime e containers com o mesmo ambiente após alterações. Nunca execute `docker compose down -v` para reiniciar.

`openwa:start` cria somente gateway e receiver deste projeto. A API do gateway fica em `127.0.0.1:2785`; o receiver não publica porta. O callback privado usa `channel-ingress:3214` na rede Docker. Não exige túnel ou URL pública. Não exponha API/dashboard à internet nem monte o Docker socket no gateway. MCP upstream está desabilitado.

`env:init` conserva valores existentes e inclui `OPENWA_ADMIN_API_KEY`, `OPENWA_API_ORIGIN`, `OPENWA_PLATFORM_DAILY_CAP=20`, `OPENWA_PLATFORM_NEW_CONVERSATION_CAP=5` e `RUNTIME_CHANNELS_MS=5000`. O master fica no servidor; cada conexão recebe chave operacional limitada à sua sessão. Credenciais da aplicação são cifradas com o keyring existente. O receiver usa somente o papel `cadence_ingress`.

## Conectar um telefone

Em `/settings/whatsapp`, escolha **Conectar número próprio**, dê um nome, leia o aviso e marque a confirmação. O QR aparece no próprio app. No telefone, use **Aparelhos conectados → Conectar aparelho**. Apenas proprietário/admin pode obter QR ou gerenciar a conexão; mudar de workspace ou perder acesso retira a imagem.

O QR existe somente em memória, com consultas sem cache. A tela consulta QR a cada três segundos na fase apropriada e estado a cada dez; o fluxo termina após dez minutos. Fechar a janela interrompe essas consultas. O pareamento real não é feito por testes automatizados.

Sessão pronta exige resposta autenticada da API, número conhecido, chave limitada e webhook registrado. Webhook de estado positivo sozinho não marca a conexão pronta. Restrição ou logout bloqueia novos envios imediatamente. **Reconectar** é uma ação explícita e troca a revisão/chave. **Desconectar** enfileira logout e revogação; falha em confirmar o desligamento remoto aparece como atenção. Nesse caso confira também Aparelhos conectados no telefone.

## Mensagens, limites e incerteza

OpenWA suporta texto individual, revisão de variáveis, inbox e cadências. Não usa templates oficiais nem a regra Meta de 24 horas. Continuam obrigatórios autorização por finalidade, supressão/opt-out, revisão humana, agenda e cotas. Resposta de serviço dentro de uma janela autêntica usa a política existente. Grupos/anexos/importação integral de histórico não fazem parte desta entrega; mídia recebida é identificada.

Política inicial: 20 mensagens automatizadas/dia/remetente, cinco novos contatos autorizados/dia e intervalo de 60–180 segundos. A cota geral do workspace continua compartilhada. Respostas para contatos conhecidos não gastam cota de novo contato. Reservas são por tentativa; disputa simultânea não excede o último slot e meia-noite usa `America/Sao_Paulo`. Uma aceitação consome a cota, mesmo que a entrega falhe depois.

O cliente não eleva o teto de infraestrutura. Uma mudança operacional precisa alinhar ambiente do backend, `app.openwa_platform_limits` no PostgreSQL e os controles do gateway, reiniciando os serviços. Não há elevação automática nem promessa de evitar bloqueio. Reduzir limites invalida revisões anteriores.

Uma resposta HTTP201 comprova aceitação, não entrega. ACK autenticado pode atualizar entregue/lida. Timeout ou resposta ambígua mantém resultado incerto e reserva; não há reenvio automático, nem com outra chave após as 24 horas de retenção do gateway. A reconciliação aceita prova positiva consultada na API da mesma sessão/remetente/destinatário. Referência: endereço do inbox deste app. Busca vazia não comprova não envio.

## Manutenção e recuperação

Veja [runtime contínuo](CONTINUOUS-RUNTIME.md). A lane `channels` mantém operações autorizadas e lê estado; não envia. Até cinco operações/conexões por rodada, sessão pronta conferida em 30s, recuperação/recibos em 15s, até 20 recibos conhecidos e páginas de 20 mensagens. Usa cursor do mais recente ao mais antigo, janela superior fixa e checkpoint apenas ao completar a paginação.

Leituras REST passam pela persistência/deduplicação dos webhooks, com origem `gateway-read`; não são apresentadas como assinatura de webhook. Janela máxima de recuperação de 15 minutos e cinco páginas. Lacuna, tempo desconhecido ou cinco falhas consecutivas pausa a automação para investigação. Reconexão explícita inicia uma nova janela limitada; não recupera silenciosamente todo o período perdido. Ausência em uma consulta nunca autoriza repetir envio incerto.

Diagnóstico sem segredos:

```powershell
rtk npm run openwa:status
rtk npm run runtime:status
```

Devem existir cinco lanes vivas: dispatch, sync, jobs, scheduler, channels. Windows usa VBS/wscript e processos ocultos; não é necessário abrir um terminal periodicamente. Alterações no ambiente exigem reinício explícito.

## Backup, restauração e atualização

Faça backup conjunto do PostgreSQL, `.env.local`/keyring e volume `openwa_data`. A sessão do telefone e o catálogo do gateway ficam em `/app/data`. Esses backups contêm credenciais: mantenha acesso restrito e não os versione nem anexe a evidências.

Antes de copiar o volume, pare o runtime e o gateway. `docker compose --env-file .env.local cp openwa:/app/data DIRETORIO_DE_BACKUP` copia os dados do container parado sem apagar o volume. Guarde também o dump PostgreSQL correspondente e as chaves. Para restaurar, pare serviços, preserve uma cópia do estado atual, restaure `/app/data` no mesmo volume e restaure banco/keyring do mesmo ponto; recrie containers com a revisão fixada e confira estado no app. Não declare a sessão pronta a partir do backup: a API precisa confirmar autenticação. Pode ser necessário parear novamente.

Atualizações do submódulo são deliberadas: ler diferenças de contrato/licença/install scripts, fixar um novo SHA, validar primeiro no projeto Compose `prometeus-cadence-openwa-qa` e banco efêmero, depois rebuildar. Não usar pull automático de imagem ou branch flutuante. A licença MIT upstream é preservada.

Memória ociosa observada sem telefone pareado no piloto de infraestrutura: aproximadamente 112 MiB no gateway e 28 MiB no receiver. Não representa o consumo do Chromium com sessão ativa; dimensionar e medir após pareamento.

Twilio está aposentado, com webhook410 e histórico preservado. Meta oficial continua disponível como conexão separada; publicações não são convertidas automaticamente.
