# 06E.1 — Autenticador, sessões e membros

Data:30/10/2026; fechamento02/11/2026. Estado: concluído local/controlado após revisão independente ([revisão](06e1-security-members-review.md)). Não é aceite de paridade100% nem de produção pública.

## Contrato entregue

- BetterAuth1.7.12 realiza TOTP e backup criptografado; guardas do produto verificam sessão, desafio, validade, tentativas e replay. Nenhum algoritmo TOTP próprio. QR produzido localmente com qrcode1.5.4, sem serviço externo.
- Pareamento exige senha ou sessão recente de conta sem senha. Segredo/QR e dez backups aparecem somente no popup privado; confirmação de guarda precede a ativação. Entrada por senha exige o segundo fator; sessão criada por outro caminho também fica bloqueada até provar o fator.
- Código incorreto, expirado, repetido ou de outro usuário não concede acesso. Dois desafios concorrentes consomem o mesmo backup apenas uma vez. Desativação exige senha e TOTP e encerra sessões. Troca de senha invalida sessões anteriores, desafios e a sessão substituta que a biblioteca cria depois da alteração.
- Sessões revogadas/expiradas retornam401; sessão ativa pendente de2FA retorna403/TWO_FACTOR_REQUIRED. Login, onboarding e APIs compartilham esse contrato. Transações interativas revalidam a sessão; workers mantêm leases/fencing e checagens de membership existentes.
- Convites reservam assentos sob lock; os novos duram sete dias, conforme observação atual da referência, sem reescrever validades antigas. HTTP de convite/papel/remoção exige requestId; papel/remoção exige revisão. Repetição não duplica convite ou envio. Último proprietário é preservado também por trigger SQL.
- Administração do workspace não concede administração da plataforma. SMTP, Apify e LLM permanecem configurações centrais; nenhuma credencial ou autoridade externa foi ampliada.

## Validação executada

Testes do pacote cobrem senha incorreta, desafio estrangeiro/expirado, TOTP inválido/repetido, backup concorrente, revogação, troca de senha com cookie substituto, bloqueio dos endpoints nativos diretos, sessão social pendente, SQL sem acesso ao segredo, duas remoções de proprietários, disputa pelo último assento, revisão, idempotência e HTTP/origem/input.

Os logs privados mantêm os ciclos RED→GREEN. Suíte focada:19/19; unitários:366/366. Uma execução ampla anterior passou464/464; a execução ampliada com as regressões novas e o aceite final serão registrados abaixo após terminar. Build e tipos executados; o gate definitivo usa a revisão final do código.

Browser real contra o banco operacional local, com duas identidades descartáveis e workspace exclusivo:

1. Pareamento com senha errada e correta; QR carregado, backups exigidos, Escape com aviso antes do descarte e confirmação alcançável por scroll em390px. Ativação confirmada e persistida após reload.
2. Login por senha desafiado, código inválido recusado, backup aceito e seleção explícita do workspace. Desativação invalidou a sessão; entrada seguinte voltou a usar senha sem desafio.
3. Falha de GET/sessões, recuperação e preservação do rascunho. Convite, capacidade esgotada sem perder e-mail, aceite viaUI como operador sem acesso administrativo global, promoção, conflito409 e remoção com acesso de negócio imediatamente negado.
4. Encerramento de outra sessão preservando a atual; troca de senha voltou ao login e deixou a sessão antiga e a substituta inutilizáveis. Link de reset ausente e token inválido oferecem recuperação.

Alguns roteiros foram retomados: o primeiro esperava dashboard antes da seleção normal de workspace; outro usou o nome acessível exato incorreto para a senha com texto de ajuda. Isso não foi tratado como prova de sucesso. Os checkpoints posteriores foram conferidos no navegador e no banco. A mesma QA descobriu e comprovou as correções reais de erro de rede e rotação de sessão.

## Visual e referência

REA passivo e RES emL4: Segurança/Membros e páginas públicas em1920×855,390×844 e320×844. Nenhum envio, ativação, integração, convite, trial ou ajuste persistido na referência. Evidências e hashes: [manifest](evidence/06e1-security-members/manifest.json).

Comparados composição de cartões, cabeçalhos, campos, footer da senha, botões e estados vazios. A geometria da senha foi ajustada para alinhar o início dos cartões seguintes. O reset sem token passou a reproduzir o estado observado “Link inválido”. A marca Prometeus e as divergências já escolhidas permanecem.

Limites explícitos:

- Popup de pareamento, backup, conta com2FA, convite válido e múltiplos membros da referência não foram submetidos/exercitados. São implementação funcional própria, sem afirmação de backend idêntico.
- A referência descreve código por e-mail e dispositivos confiáveis por30dias. A entrega mostra sessões ativas reais e exige2FA a cada entrada; não anuncia bypass ou código por e-mail que não implementou. Essa diferença permanece na matriz final08A.
- A senha mínima continua12caracteres e a troca exige nova entrada, conforme contrato de segurança do produto; a referência anuncia8e continuidade da sessão.
- Credencialless/OAuth foi validado com estado de sessão sintético real no banco e no adapter, sem nova autorização Google do operador. Configuração pública, proxy confiável, e-mails externos, carga e recuperação operacional pertencem ao08B.
- O RES padrão não mascarou endereçosIPv4 das primeiras capturas privadas. As três imagens próprias de Segurança foram apagadas e refeitas com máscara explícita antes de publicar o acervo; nenhum segredo foi capturado.

## QA, runtime e custos

L-026 encerrada: removidos por identificadores exatos os dois usuários próprios, workspace, memberships/convites, fatores/desafios, sessões e projeções técnicas geradas pela fixture. L-027 restaurada: captura final somente leitura com QA dedicada anterior, encerrando apenas a nova sessão própria. Nenhuma conta, sessão, canal ou dado do operador foi alterado. Navegadores próprios encerrados. E-mails de cadastro/convite foram enviados somente ao capturador local; não são prova de SMTP público.

Migrações091/091a aplicadas localmente. Nenhuma chamada paga de Actor/LLM ou mensagem externa; custo externo desta QA:zero. O runtime contínuo foi reiniciado após a migração; saúde definitiva registrada no fechamento. Sem merge/push/deploy público nesta entrega.

## Decisões de execução

1. Checkout nativo/branch própria: preserva o runtime existente; custo: menos isolamento de filesystem.
2. Algoritmos/schema da versão instalada e guardas do produto: evita segundo TOTP; custo: manter o wrapper em upgrades da biblioteca.
3. Prova de sessão independente da forma de login: fecha caminho OAuth/verification sem hook nativo; custo: clientes tratam TWO_FACTOR_REQUIRED e endpoints autenticados nativos ficam bloqueados enquanto pendentes.
4. Checagem de sessão apenas para a role real cadence_app: workers usam leases/fencing existentes; custo: trabalho já autorizado continua pela lease, sujeito às revalidações existentes.
5. qrcode MIT fixado para render local: segredo não sai para serviço QR; custo: manter uma dependência de runtime e seus tipos. O Setup não estava exposto para descoberta nesta sessão.
6. Compatibilidade com chamadas internas antigas sob lock; ingresso HTTP/UI exige revisão e requestId: custo: chamada interna antiga não tem detecção otimista de conflito.

## Fechamento

Revisão independente em02/11 (intervalo786ef97..515ed06): sem Critical, um Important corrigido com RED→GREEN — botões secundários do formulário de código sem `type="button"` submetiam o código, e "Recomeçar pareamento" ativava o autenticador. Dois menores→08A. Contagem final: 367/367 unitários, 466/466 integrações, 4/4 unitárias do pacote, build e tipos exit0, `git diff --check` limpo. A correção não foi reexercitada em navegador; está coberta por regressão estática. Próximo:06E.2 — duplicados, fusão, privacidade e ciclo dos dados.
