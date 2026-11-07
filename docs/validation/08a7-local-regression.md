# 08A.7 — Configurações, papéis e recuperação local

Em Contas de e-mail, a falha de leitura encerra o indicador de carregamento e mostra o erro. Atualizar consulta o servidor novamente. Uma leitura bem-sucedida remove o erro da lista, inclusive se a recuperação ocorrer pela atualização automática.

As provas adicionais exercitam:

- Lista de caixas em 503, nova consulta após clicar em Atualizar e recuperação sem recarregar a página.
- Formulários Gmail e SMTP em desktop e celular, com Escape e retorno do foco ao botão de conexão. No formulário Gmail, uma resposta 503 preserva o nome da caixa e o foco. A tentativa é interceptada antes do servidor e o banco permanece sem caixa criada.
- Proprietário, administrador e operador em E-mail, Webhooks/API e Apollo. A prova verifica a disponibilidade dos controles e a explicação para o operador. A API de chave também é exercitada com a recusa real ao operador e a criação local pelo administrador.
- Primeiros passos com título, descrição, percentual e barra no mesmo cartão. No desktop, percentual e título ficam lado a lado. No celular, o percentual fica entre a descrição e a barra.

O 503 da lista e a geometria do cartão falharam no build anterior. A prova de recuperação exige uma resposta bem-sucedida em até três segundos após clicar em Atualizar. A gravação simulada cobre a preservação do rascunho na falha. [Revisão independente](08a7-local-regression-review.md)

A comparação usou a captura guardada de Primeiros passos. A referência tinha 8 de 14 etapas e a conta fictícia local, 0 de 14. A barra reflete o estado real da conta de QA. As capturas locais estão em `output/playwright/visual-audit/08a7-first-steps-1920.png` e `08a7-first-steps-390.png`. O cartão informativo mantém a escolha do usuário. [Linha de base do 08A.6](08a6-local-closure.md)

O aceite visual e as homologações externas continuam pendentes. A sequência aprovada é concluir a parte local e usar um ambiente de homologação isolado para os pré-requisitos do 08B. Cada ação pública depende da autorização correspondente. [Matriz de aceite](08-release-matrix.json)

## Medição final

- Passaram 25 de 25 jornadas e 576 de 576 visitas com o hash final, com isolamento conferido e resíduo zero.
- O auditor aceitou 112 de 133 itens. Restam 17 bloqueados e quatro pendentes, entre eles os casos condicionais ainda abertos de popups, papéis e falhas de rede. Quatro estados comerciais têm prova local e referência desconhecida.
- Passaram 458 testes unitários e 664 integrações. Cinco testes de homologação do Stripe ficaram fora da rodada. O build, a checagem de tipos e `git diff --check` passaram. A base de conhecimento apresentou os quatro erros já conhecidos em `clone/barriers.md`.

[Jornadas](evidence/08a-final-regression/journeys.json) · [Varredura](evidence/08a-final-regression/route-sweep.json)
