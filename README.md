# 💰 Controle Financeiro Pessoal (PWA)

Aplicativo de orçamento pessoal em **um único arquivo HTML**, que roda direto no navegador, funciona **offline** e guarda todos os dados **localmente no seu dispositivo** (nada vai para a internet).

> Arquivo principal: **`Financas com evolucao invest5_claude.html`**

---

## 🚀 Como usar

1. Abra o arquivo HTML no navegador (Chrome, Edge ou Firefox) com um **duplo clique**, ou publique a pasta em um servidor para instalar como aplicativo (PWA).
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
- **✔ Efetivar previsão (Previsto × Realizado)**: quando o valor real cair no banco, clique em **✔** no cronograma e informe o valor realizado. A previsão sai do cronograma/simulador e vai para o painel **✅ Previsto × Realizado**, que mostra por mês: previsto, realizado e **diferença** (positiva = melhor que o previsto) por lançamento, totais de entradas/saídas e **resumo por categoria**. Dá para **desfazer** (↩️) e a previsão volta ao cronograma.
- **💳 Parcelamentos Futuros do Cartão**: as parcelas restantes dos lançamentos "Parc. N/M" das faturas importadas são projetadas automaticamente mês a mês, com total comprometido e detalhe por compra. Compras repetidas em faturas consecutivas são deduplicadas (vale a fatura mais recente). Painel informativo — não altera o Saldo Projetado.
- **Reflexo em Investimento (opcional)**: uma **Saída** vira **Aporte** e uma **Entrada** vira **Resgate** no investimento escolhido, lançado na data e recalculado em cascata.

### 🏦 Conta Corrente (várias contas)
- **Múltiplas contas correntes**, cada uma independente (ex.: Nubank, Itaú, Carteira), com **nome** e **saldo inicial próprios**.
- **Conta ativa**: o seletor no topo define qual conta recebe as **importações** e cujos lançamentos são exibidos. Clique no nome de uma conta nos "chips" para torná-la ativa.
- **Checkbox "Refletir no dashboard/previsão"** por conta: marque quais contas entram nas **totalizações do Dashboard** e na **Caixa de Partida da Previsão**. Os totais somam **todas as contas marcadas**.
- **Importação de extrato bancário** (**.xls, .xlsx, .csv**) direto na conta ativa, com detecção de duplicidade por conta.
- Filtros por **mês** e por **tipo** (entradas, saídas ou sem categoria) e **categorização** rápida.
- Exclusão de **um mês específico** dentro da conta ativa; criação, renomeação e exclusão de contas.

### 💳 Cartão de Crédito
- **Importação de fatura** (**.txt, .csv**), informando o **mês da fatura** e o **dia de vencimento**.
- Lançamentos **agrupados por fatura (mês de vencimento)**, da mais recente para a mais antiga, com **cabeçalho por fatura** (nº de lançamentos e total líquido); dentro de cada fatura, ordenados pela **data da compra**.
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

### 🔍 Busca Global
- Botão **🔍 Buscar** no topo: encontre lançamentos por **descrição, categoria ou valor** (ex.: `mercado`, `1.500,00`) em **todas as contas correntes, cartão e previsões**, em todos os meses, ordenados do mais recente para o mais antigo.

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
- **IndexedDB** através da biblioteca **Dexie.js** para armazenamento local.
- **Chart.js** para os gráficos do Dashboard.
- **Tailwind CSS** para a interface.
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
| Importação não reconheceu o arquivo | Confirme o formato: extrato `.xls/.xlsx/.csv`, cartão `.txt/.csv` |
