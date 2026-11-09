# Revisão independente dos recortes de CNPJ

A revisão em modo somente leitura apontou duas regressões. Desabilitar a opção podia encerrar uma execução com um run ativo. A reconciliação também podia aceitar um run anterior com o mesmo INPUT. O primeiro cenário foi reproduzido antes do ajuste do checkpoint. Depois desse ajuste, o teste ainda falhou na tentativa de vincular o run antigo.

A prova final usa um dataset remoto simulado no primeiro recorte e um início incerto no segundo. A configuração muda depois de a jornada ser confirmada. O teste recusa o run antigo, o run da faixa errada e um identificador já usado no mesmo workspace. O run correto continua o job, um CNPJ repetido fica fora do Maps e uma única inserção é debitada.

O teste simula as respostas do provedor. Ele não homologa os filtros do build compartilhado nem demonstra uma queda real entre o recibo e a troca de recorte. [Relatório](06b6c-registry-complementary-slices.md)
