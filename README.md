# 💰 Controle Financeiro Pessoal (PWA)

Aplicativo de orçamento pessoal que roda direto no navegador, funciona **offline** e guarda todos os dados **localmente no seu dispositivo** (nada vai para a internet).

> **Acesse online:** https://eliassmello.github.io/Gestao-Financeira/ — instalável como app (PWA).
> **Arquivos principais:** `index.html` + `js/services.js` + `js/ui.js` (veja [Tecnologia](#️-tecnologia)).

---

## 🚀 Como usar

1. Abra o app pela **URL publicada** acima (Chrome, Edge ou Firefox) e, se quiser, **instale-o** como aplicativo (PWA) — funciona offline depois da primeira visita. Também dá para publicar a pasta em qualquer servidor estático.
2. Na primeira vez, vá em **🏦 Conta Corrente** e ajuste sua primeira conta (nome e **saldo inicial**). O sistema já cria uma "Conta Principal" automaticamente.
3. Cadastre suas **categorias** de receita e despesa em **⚙️ Config**.
4. Importe seus extratos ou lance previsões e comece a acompanhar.

> 💡 Os dados ficam salvos no navegador (IndexedDB). Use **sempre o mesmo navegador/dispositivo** e faça **backup** com frequência (veja abaixo).

---

## 🧭 Principais recursos

### 📊 Dashboard
- Relatório mensal de **receitas e despesas** (Conta Corrente + Cartão).
- Filtro por **mês de referência** e por **período** (último mês até 12 meses).
- Cartões de resumo: **Saldo Real** (soma das contas marcadas), **Entradas**, **Saídas** e **Balanço do período**.
- **Evolução Mensal**: gráfico de barras com Entradas × Saídas dos **últimos 12 meses** (terminando no mês de referência) e linha de **balanço** mês a mês.
- **🎯 Orçamento por Categoria**: barras de progresso comparando o gasto do período com o **limite mensal** definido em Config — verde (ok), amarelo (a partir de 80%) e vermelho (estourou). Com período de vários meses, o limite é multiplicado pelo nº de meses.
- **Gráficos de pizza** de distribuição de despesas e de receitas.
- Listas detalhadas de cada lançamento por categoria.

### 📅 Previsão (planejamento futuro)
- **Simulador de Saldo Futuro**: informe uma data e veja qual será o saldo projetado.
- **Soma por Categoria**: totaliza os agendamentos futuros de uma categoria.
- **Agendamento** de lançamentos futuros (entradas e saídas) com data, descrição, categoria e valor.
- **Cronograma da Conta Corrente** com o **saldo projetado** linha a linha; a **Caixa de Partida** usa o saldo das contas marcadas para refletir.
- Previsões já vencidas aparecem **destacadas em amarelo** para você conciliar com o banco.
- **🚨 Alerta de cheque especial**: a coluna Saldo Projetado é acompanhada dia a dia e a linha fica **vermelha** no dia em que a conta atinge o **limite de dias com saldo negativo dentro de um mesmo mês** (configurável, padrão **10 dias/mês**). Se não houver lançamento no dia exato do estouro, o alerta marca a **linha anterior disponível** informando a data real. Recalcula em tempo real ao alterar qualquer valor.
- **✔ Efetivar previsão (Previsto × Realizado)**: quando o valor real cair no banco, clique em **✔** no cronograma e informe o valor realizado. A previsão sai do cronograma/simulador e vai para o painel **✅ Previsto × Realizado**, que mostra por mês: previsto, realizado e **diferença** (positiva = melhor que o previsto) por lançamento, totais de entradas/saídas e **resumo por categoria**. Dá para **desfazer** (↩️) e a previsão volta ao cronograma.
- **💳 Parcelamentos Futuros do Cartão**: as parcelas restantes dos lançamentos "Parc. N/M" das faturas importadas são projetadas automaticamente mês a mês, com total comprometido e detalhe por compra. Compras repetidas em faturas consecutivas são deduplicadas (vale a fatura mais recente). Painel informativo — não altera o Saldo Projetado.
- **🔁 Lançamentos recorrentes**: cadastre regras (salário, aluguel, assinaturas...) com frequência **mensal, semanal ou anual** e fim opcional; o app gera as previsões sozinho pelos próximos 12 meses e mantém o horizonte rolando a cada abertura. Pausar/excluir remove as futuras não conciliadas.
- **🧹 Excluir por categoria**: remova de uma vez todos os agendamentos pendentes de uma categoria (útil para refazer planos gerados em massa). Previsões já efetivadas são preservadas e reflexos em investimentos são revertidos.
- **Reflexo em Investimento (opcional)**: uma **Saída** vira **Aporte** e uma **Entrada** vira **Resgate** no investimento escolhido, lançado na data e recalculado em cascata.

### 🏦 Conta Corrente (várias contas)
- **Múltiplas contas correntes**, cada uma independente (ex.: Nubank, Itaú, Carteira), com **nome** e **saldo inicial próprios**.
- **Conta ativa**: o seletor no topo define qual conta recebe as **importações** e cujos lançamentos são exibidos. Clique no nome de uma conta nos "chips" para torná-la ativa.
- **Checkbox "Refletir no dashboard/previsão"** por conta: marque quais contas entram nas **totalizações do Dashboard** e na **Caixa de Partida da Previsão**. Os totais somam **todas as contas marcadas**.
- **Importação de extrato bancário** (**.ofx, .xls, .xlsx, .csv**) direto na conta ativa, com detecção de duplicidade por conta.
- Filtros por **mês** e por **tipo** (entradas, saídas ou sem categoria) e **categorização** rápida.
- Exclusão de **um mês específico** dentro da conta ativa; criação, renomeação e exclusão de contas.

### 💳 Cartão de Crédito
- **Importação de fatura** (**.txt, .csv**), informando o **mês da fatura** e o **dia de vencimento**.
- Lançamentos **agrupados por fatura (mês de vencimento)**, da mais recente para a mais antiga, com **cabeçalho por fatura** (nº de lançamentos e total líquido); dentro de cada fatura, ordenados pela **data da compra**.
- **💳 Parcelamentos Futuros do Cartão** fica nesta aba (quadro com rolagem própria, logo acima da Área de Risco): projeção das parcelas restantes ("Parc. N/M") das faturas importadas, mês a mês, com total comprometido.
- **Totalizador da fatura**: valor líquido e soma bruta de todos os lançamentos.
- Filtros por mês e por lançamentos sem categoria; exclusão de uma **fatura inteira** por mês.

### 📈 Investimentos
- **Resumo de patrimônio** por moeda: **BRL, USD e EUR**, além dos **aportes do mês** filtrado.
- **"Fotografia do patrimônio"**: veja o saldo consolidado em qualquer mês/ano.
- Cadastro de vários investimentos (nome, instituição e moeda).
- **Histórico/evolução** de cada investimento com saldo anterior, aporte, taxa, rendimento, resgate e saldo final, em **data dia/mês/ano**.
- **Cálculo de rendimento automático** em cascata:
  - Rendimento **mensal** (taxa anual ÷ 12) para lançamentos de fim de mês.
  - Rendimento **pro rata por dias** (ACT/365) para lançamentos no meio do mês (inclusive os gerados pela Previsão); o rendimento da linha seguinte é ajustado proporcionalmente aos dias.
  - O **saldo anterior** de cada linha é sempre herdado do saldo final do mês anterior, e qualquer alteração **se propaga** para as linhas posteriores.
- Botão **🔁 Repetir** projeta vários meses de uma vez (repetindo aporte, taxa e resgate), continuando a partir do último mês.

### 🧮 Quitação (Compras Parceladas)
- Cadastre uma compra parcelada (ex.: imóvel em 22×) com **indexador estimado** (INCC/IPCA/IGP-M, % a.a.) e monte a lista de **fontes de recursos** (opcional): vários investimentos, **na ordem em que devem ser usados** (↑↓ para reordenar). Saldo e **rendimento % a.a.** de cada fonte vêm automaticamente da tabela de Investimentos (última taxa lançada) e podem ser ajustados — use a taxa líquida de IR.
- **Compra sem investimento vinculado**: deixe a lista de fontes vazia e a efetivação lança **apenas as parcelas** na 📅 Previsão, sem resgates nem aportes.
- **Projeção mês a mês editável**: na tabela, cada mês tem **Correção (% a.a.)** e **Aporte (R$)** editáveis (o Indexador e o Aporte do formulário são só os padrões). Ajuste quando o INCC real do mês ou o aporte daquele mês forem diferentes — a parcela é recalculada e tudo segue **em cascata**.
- A simulação mês a mês esgota o 1º investimento, passa ao 2º e assim por diante — cada um rendendo à **sua própria taxa**; o mês de transição divide o resgate entre as duas fontes. A tabela mostra uma **coluna de saldo por investimento** (com o resgate do mês) e o gráfico traz o saldo total + uma linha por fonte.
- Resultado na tela: veredicto (✅ cobre / ⚠️ fontes esgotam na parcela N), **aporte mensal mínimo** para fechar a conta (botão "mín." preenche), total corrigido a pagar e análise **quitar × manter aplicado** (rendimento médio ponderado das fontes × indexador).
- **Tudo é só simulação** até clicar em **✅ Efetivar**: cada parcela vira um par na 📅 Previsão (Entrada "Resgate p/ ..." refletida como **saque no investimento correto daquele mês** + Saída da parcela) e os aportes viram Saídas refletidas como **aporte na fonte ativa** — com recálculo em cascata no histórico de cada investimento. **↩️ Desfazer efetivação** remove tudo com um clique.
- **Compensação automática**: aporte e resgate do **mesmo investimento na mesma data** são abatidos entre si e apenas o **movimento líquido** é lançado (ex.: parcela de R$ 5.000 com aporte de R$ 676 vira um único resgate líquido de R$ 4.324), evitando movimentação bancária desnecessária. Se os dois se anulam, nenhum movimento é criado. Compras efetivadas antes desta versão podem ser desfeitas e re-efetivadas para ganhar a compensação.
- Suporta **várias compras** simultâneas, cada uma com seu indexador e suas fontes.
- **Operação mês a mês (após efetivar)**: depois de efetivar, o formulário do topo fica travado e a **Projeção mês a mês vira a tela de trabalho** — editar Correção/Aporte de um mês **regenera automaticamente** os lançamentos daquele mês em diante na 📅 Previsão e no 📈 Investimento. Quando você concilia a parcela (e o resgate) com **✔** na Previsão — ela sai do cronograma para o Previsto × Realizado —, a linha correspondente na projeção fica **🔒 travada** com o valor **realizado**, e os meses seguintes se re-ancoram nele sozinhos. Não há botão de reprojetar: tudo é contínuo.

### 🔍 Busca Global
- Botão **🔍 Buscar** no topo: encontre lançamentos por **descrição, categoria ou valor** (ex.: `mercado`, `1.500,00`) em **todas as contas correntes, cartão e previsões**, em todos os meses, ordenados do mais recente para o mais antigo.

### 🔒 Proteção por senha (criptografia local, opcional)
- Em **⚙️ Config → Proteção por Senha**, você pode **cifrar todos os dados** no navegador com uma senha de acesso (usa a mesma criptografia AES-GCM do backup `.pib`).
- Com a proteção ligada, o app **pede a senha ao abrir** e grava no IndexedDB apenas um bloco embaralhado — quem inspecionar pelo F12 vê `a8f9e23b…`, não "Mercado". A senha (chave) fica só na memória enquanto o app está aberto.
- **Opcional e reversível**: desligada por padrão; ao desativar (com o app desbloqueado) os dados voltam ao normal. Ao ativar, o app **exige salvar um backup** antes.
- ⚠️ **Se esquecer a senha, não há recuperação** — por isso guarde o backup e a senha dele em local seguro. Protege contra bisbilhotagem do armazenamento/perfil do navegador; não substitui cuidados com o dispositivo em si.

### 📆 Calendário Financeiro
- Visão de mês em grade com as **entradas e saídas previstas** de cada dia (agendamentos + recorrências). Navegue entre meses e clique num dia para ver os lançamentos; recorrentes aparecem com 🔁.

### 🔔 Notificações de contas a vencer
- Um **banner no topo** avisa sobre saídas previstas que vencem nos **próximos 3 dias**. Em **Config**, você pode autorizar **notificações do sistema** (aparecem ao abrir o app).

### ⚙️ Configurações
- **Backup completo** dos dados: **exportar** e **restaurar** em arquivo **.json** (inclui as contas e os orçamentos).
- Cadastro e exclusão de **categorias** de despesa e de receita.
- **Orçamento mensal por categoria de despesa**: informe um limite (R$) ao lado de cada categoria para acompanhá-la no painel 🎯 do Dashboard; deixe em branco para não acompanhar.
- O **saldo inicial** é definido por conta na aba Conta Corrente (atalho disponível aqui).
- **Zona de Perigo**: zerar todo o banco de dados.

---

## 💾 Backup e segurança dos dados

- Os dados são gravados em **IndexedDB** (banco local do navegador, `AppFinancas_DB`), com migração automática de dados antigos em `localStorage`. Contas correntes antigas (de uma única conta) são migradas automaticamente para uma "Conta Principal".
- **Faça backup periodicamente** em **Config → Salvar backup (.json)**. Para migrar de máquina ou recuperar, use **Restaurar backup (.json)**.
- **Lembrete automático**: o app mostra um aviso no topo se você **nunca fez backup** ou se o último foi há **30 dias ou mais** (dá para adiar por 7 dias). A data/hora do último backup aparece em **Config → Backup Completo**.
- Limpar os dados do navegador, trocar de dispositivo ou usar janela anônima **apaga ou não enxerga** os dados — por isso o backup é essencial.

---

## 🛠️ Tecnologia

- **PWA** (instalável e com funcionamento **offline** via Service Worker `sw.js`).
- **Estrutura de arquivos**: `index.html` contém apenas o **markup + Tailwind**; a lógica fica separada em **`js/services.js`** (modelo de dados, IndexedDB, cálculos, importação e backup) e **`js/ui.js`** (renderização, manipuladores de interface e inicialização).
- **Offline após a primeira visita**: na primeira vez que abre online, o Service Worker guarda em cache o app (`index.html`, `js/services.js`, `js/ui.js`, ícones) **e as bibliotecas** (Tailwind, Chart.js, Dexie, XLSX, pdf.js). Depois disso o app abre e funciona **sem internet** — os dados sempre ficam no IndexedDB local. Ao publicar uma nova versão, basta subir a versão do cache em `sw.js` (`CACHE_NAME`).
- **IndexedDB** através da biblioteca **Dexie.js** para armazenamento local.
- **Chart.js** para os gráficos do Dashboard.
- **Tailwind CSS** para a interface, com **🌙 modo escuro** (botão no cabeçalho; a preferência é lembrada).
- **Listas paginadas**: Conta Corrente e Cartão mostram até 300 lançamentos por vez, com botão **"Mostrar mais"** — assim anos de importações não travam o navegador.
- 100% **client-side**: nenhum dado sai do seu computador.

---

## ❓ Dúvidas rápidas

| Situação | O que fazer |
|---|---|
| Tenho mais de um banco | Crie uma conta para cada um na aba Conta Corrente e marque no dashboard as que deseja somar |
| Uma conta não aparece nos totais | Verifique se o checkbox "dashboard" daquela conta está marcado |
| Troquei de computador | Restaure o último arquivo `.json` em Config |
| Os dados sumiram | Verifique se está no mesmo navegador/perfil; restaure um backup |
| Quero recomeçar do zero | Config → Zona de Perigo → Zerar banco de dados (faça backup antes!) |
| Importação não reconheceu o arquivo | Confirme o formato: extrato `.ofx/.xls/.xlsx/.csv`, cartão `.txt/.csv` |
