# 💰 Gestão Financeira Pessoal (PWA)

Aplicativo de controle financeiro pessoal que roda **direto no navegador**, funciona **offline** e guarda **todos os dados localmente no seu dispositivo** — nada é enviado para a internet. Cobre o ciclo completo: contas correntes, cartões de crédito, previsão de saldo, investimentos, quitação de compras parceladas, relatórios e uma calculadora de dados para tomada de decisão.

> **Acesse online:** https://eliassmello.github.io/Gestao-Financeira/ — instalável como app (PWA), funciona sem internet depois da primeira visita.

---

## 📑 Índice

- [Como começar](#-como-começar)
- [Segurança e privacidade](#-segurança-e-privacidade)
- [As telas do app](#-as-telas-do-app)
  - [📊 Dashboard](#-dashboard) · [📅 Previsão](#-previsão) · [🏦 Conta Corrente](#-conta-corrente) · [💳 Cartão de Crédito](#-cartão-de-crédito) · [📈 Investimentos](#-investimentos) · [🧮 Quitação](#-quitação-compras-parceladas) · [🔢 Cálculos](#-cálculos) · [📆 Calendário](#-calendário) · [📝 Informações](#-informações) · [⚙️ Config](#️-configurações)
- [Recursos gerais](#-recursos-gerais) (busca, atalhos, notificações, tema, mobile)
- [Importação de arquivos](#-importação-de-arquivos)
- [Backup e sincronização](#-backup-e-sincronização)
- [Tecnologia](#️-tecnologia)
- [Dúvidas rápidas](#-dúvidas-rápidas)

---

## 🚀 Como começar

1. Abra o app pela **URL publicada** (Chrome, Edge ou Firefox) e, se quiser, **instale-o** como aplicativo (PWA). No **iPhone/iPad**, use o Safari → Compartilhar → *Adicionar à Tela de Início*.
2. Na **primeira abertura**, o app pede para você **criar uma senha** (a proteção é sempre ativa — veja [Segurança](#-segurança-e-privacidade)).
3. Vá em **🏦 Conta Corrente** e ajuste sua primeira conta (nome e **saldo inicial**). Uma "Conta Principal" já é criada automaticamente.
4. Cadastre suas **categorias** de receita e despesa em **⚙️ Config**.
5. **Importe seus extratos/faturas** ou lance previsões e comece a acompanhar.
6. **Faça backup com frequência** (Config → Salvar backup). Os dados vivem só no seu navegador.

> 💡 Os dados ficam no navegador (IndexedDB). Use **sempre o mesmo navegador/dispositivo**; para levar os dados para outro aparelho, use **backup/restauração** ou a **pasta de backup automático** em nuvem.

---

## 🔒 Segurança e privacidade

- **100% client-side**: nenhum dado sai do seu dispositivo. Não há servidor, conta ou login remoto.
- **Criptografia local sempre ativa**: o app grava no IndexedDB apenas um **bloco cifrado (AES-GCM)** — quem inspecionar o armazenamento pelo F12 vê algo como `a8f9e23b…`, não "Mercado". A **senha (chave)** fica **só na memória** enquanto o app está aberto.
- **Senha pedida a cada abertura**; para trocar, use **⚙️ Config → Senha do app**. A **mesma senha** protege o app e **todos os backups** (você não gerencia senhas diferentes).
- ⚠️ **Se esquecer a senha, não há recuperação.** Guarde um backup em local seguro. A criptografia protege contra bisbilhotagem do armazenamento/perfil do navegador; não substitui o cuidado com o próprio dispositivo.

### Controle de acesso por usuário (opcional)

Além da senha pessoal (que cifra os dados no dispositivo de cada um), o app pode exigir um **nome de usuário autorizado** para abrir. A lista de autorizados é mantida pelo **administrador** por um painel reservado e publicada no repositório contendo **apenas hashes** dos nomes (o arquivo não revela quem está na lista).

- **Porta do usuário**: na abertura, a pessoa digita o nome; o app confere contra a lista publicada.
- **Porta do administrador**: um painel reservado (não documentado publicamente) onde se cadastra/remove nomes, se **gera** o arquivo da lista para commit e se **importa** um arquivo existente para continuar a administração em outra máquina. Os nomes reais viajam **cifrados** dentro do próprio arquivo (só a senha de administrador abre), então o admin **recupera os nomes** em qualquer máquina ao entrar no painel — o público continua vendo apenas hashes.
- **À prova de falha fechada**: se a lista não puder ser carregada, o acesso é **bloqueado** (apagar/bloquear o arquivo não libera ninguém). Uma vez validado, o dispositivo funciona **offline**.
- **Natureza da proteção**: por ser um app público e 100% client-side, esse controle é um **freio** contra uso não autorizado — os dados de cada pessoa continuam protegidos pela **senha dela**, então mesmo um contorno técnico não expõe dados de ninguém.

---

## 🧭 As telas do app

### 📊 Dashboard
- **Relatório mensal** de receitas e despesas (Conta Corrente + Cartão), com filtro por **mês de referência** e por **período**: um campo editável onde você **digita quantos meses** o relatório abrange (terminando no mês de referência).
- Cartões de resumo: **Saldo Real** (soma das contas marcadas), **Entradas**, **Saídas** e **Balanço do período**.
- **Gráfico de Evolução Mensal** (barras Entradas × Saídas dos últimos 12 meses + linha de balanço) e **gráficos de pizza** de distribuição de despesas e receitas, com lista detalhada por categoria.
- **🎯 Orçamento por Categoria**: barras de progresso comparando o gasto do período com o **limite mensal** definido em Config — verde (ok), amarelo (≥ 80%) e vermelho (estourou); em vários meses o limite é multiplicado pelo nº de meses.
- **Não conta o cartão em dobro**: quando há lançamentos de cartão detalhados, o **pagamento da fatura** que sai da conta corrente **não** é somado como despesa (senão contaria duas vezes). É identificado pela **categoria = nome de um cartão** (sempre) ou por **descrição típica** de pagamento de fatura. Uma nota sob "Saídas" informa o quanto foi excluído.
- **Movimentação interna fora do relatório**: transferências entre contas e aplicações/resgates de investimento (categorias "Transferido para/Recebido da conta: …" e "Aplicação em/Resgate de: …") **não** entram como despesa/receita — é só dinheiro mudando de lugar. Contas **não marcadas** para o dashboard ficam de fora de tudo (totais, gráficos, orçamento).

### 📅 Previsão
Planejamento de saldo futuro, com cronograma dia a dia.
- **Agendamento** de lançamentos futuros (entrada/saída) com data, descrição, categoria e valor; e **Simulador de Saldo Futuro** (informe uma data e veja o saldo projetado) + **Soma por Categoria**.
- **Cronograma da Conta Corrente** com o **saldo projetado** linha a linha; a **Caixa de Partida** usa o saldo das contas marcadas. Previsões já vencidas ficam **destacadas em amarelo** para conciliar.
- **🚨 Alerta de cheque especial**: a linha fica **vermelha** no dia em que a conta atinge o **limite de dias com saldo negativo no mesmo mês** (configurável, padrão 10 dias/mês); recalcula em tempo real.
- **✔ Efetivar previsão (Previsto × Realizado)**: quando o valor real cair no banco, clique em **✔** e informe o realizado. A previsão migra para o painel **✅ Previsto × Realizado** (previsto, realizado e diferença por lançamento + totais e diferença total). Dá para **↩️ desfazer**.
- **🔁 Lançamentos recorrentes**: regras (salário, aluguel, assinaturas…) com frequência **mensal, semanal ou anual** e fim opcional; o app gera as previsões dos próximos 12 meses e mantém o horizonte rolando. Pausar/excluir remove as futuras não conciliadas.
- **💳 Parcelas e despesas recorrentes do cartão** entram aqui automaticamente (veja [Cartão](#-cartão-de-crédito)).
- **🧹 Excluir por categoria** os agendamentos pendentes de uma vez (preserva os já efetivados e reverte reflexos em investimento).
- **Reflexo em Investimento (opcional)**: uma Saída vira **Aporte** e uma Entrada vira **Resgate** no investimento escolhido, recalculado em cascata.

### 🏦 Conta Corrente
Várias contas, cada uma independente.
- **Múltiplas contas** (ex.: Nubank, Itaú, Carteira) com **nome** e **saldo inicial próprios**. O seletor no topo define a **conta ativa** (recebe importações e mostra os lançamentos) — troque pelos "chips".
- **Checkbox "Refletir no dashboard/previsão"** por conta: define quais contas entram nas totalizações do Dashboard e na Caixa de Partida da Previsão.
- **Categorias de transferência automáticas**: ao criar/renomear uma conta, o app cria as categorias **"Recebido da conta: {nome}"** (receita) e **"Transferido para a conta: {nome}"** (despesa). As transferências entre contas chegam pela **importação de extrato**; categorize-as com essas categorias e elas ficam de fora do Dashboard (movimentação interna). Renomear a conta renomeia as categorias.
- **Importação de extrato** (`.ofx`, `.xls`, `.xlsx`, `.csv`) na conta ativa — veja [Importação](#-importação-de-arquivos).
- **Filtros** por mês e por tipo (entradas/saídas/sem categoria), **categorização rápida**, exclusão de **um mês específico** e criação/renomeação/exclusão de contas.

### 💳 Cartão de Crédito
- **Múltiplos cartões**, cada um com **nome** e **dia de vencimento** próprios (selecione pelo "chip"). O nome do cartão também vira **categoria de despesa** (renomear propaga). O cartão que já existia vira **"cartão atual"** (renomeável).
- **Importação de fatura** (`.txt`, `.csv` ou `.pdf`) informando só o **mês da fatura** — o dia de vencimento vem do cadastro do cartão. Reconhece **Santander** e **Caixa/CEF** em PDF — veja [Importação](#-importação-de-arquivos).
- **Lançamentos agrupados por fatura** (mês de vencimento), da mais recente para a mais antiga, com cabeçalho por fatura (nº de lançamentos e total líquido); dentro de cada fatura, ordenados pela **data da compra**. Em cada linha, a **data de vencimento** aparece em destaque e a **data da compra** logo abaixo (*Compra: DD/MM/AAAA*).
- **🔁 Parcelas na Previsão**: as parcelas futuras de **todos os cartões** entram na Previsão — uma saída por cartão por mês (total das parcelas) na data de vencimento. Sincroniza sozinho; previsões já efetivadas são preservadas.
- **🔁 Despesas recorrentes do cartão**: lista abaixo dos parcelamentos para contas fixas mensais (assinaturas, seguros) que **não são parcelas**. Entram na Previsão somadas às parcelas do cartão.
- **Desconto no pagamento recorrente**: se houver um lançamento recorrente com a **categoria = nome do cartão** (o pagamento da fatura), o total do mês (parcelas + recorrentes) é **descontado desse lançamento** — os itens continuam visíveis e nada conta em dobro.
- **✅ Conferência (Santander)**: ao importar, o app soma os lançamentos reconhecidos e **compara com o "Total Despesas/Débitos" do Resumo da fatura**, avisando se houver diferença e mostrando o **Total a pagar**.
- **💳 Parcelamentos Futuros** (quadro nesta aba): projeção das parcelas restantes ("Parc. N/M") mês a mês; **totalizador da fatura**; filtros por mês/sem categoria; exclusão de uma **fatura inteira** por mês.

### 📈 Investimentos
- **Resumo de patrimônio** por moeda (**BRL, USD, EUR**) + **aportes do mês**, e **"Fotografia do patrimônio"** em qualquer mês/ano.
- **💰 Patrimônio Líquido (BRL)**: quando há compras em Quitação, mostra o patrimônio em reais **menos o saldo devedor** das parcelas em aberto.
- **Cadastro** de vários investimentos (nome, instituição, moeda). Ao criar, o app cria **duas categorias**: despesa **"Aplicação em: {nome}"** e receita **"Resgate de: {nome}"** (renomear o investimento renomeia as categorias). Essas categorias são tratadas como **movimentação interna** (fora do Dashboard).
- **⏳ Liquidez (D+)**: informe quantos dias antes você precisa emitir a **ordem de resgate** (D+0, D+3, D+15…). Para cada **Resgate** agendado na Previsão, o app cria uma **linha-lembrete de R$ 0** essa quantidade de dias antes — e **pinta o dia de amarelo (🔔) no Calendário**. O lembrete se recalcula sozinho; pode ser **dispensado** (apagar a linha — não volta) e some sozinho para resgates já ocorridos.
- **Histórico/evolução** com saldo anterior, aporte, taxa, rendimento, resgate e saldo final (data dia/mês/ano) e **cálculo de rendimento automático em cascata**: mensal (taxa anual ÷ 12) no fim de mês e **pro rata por dias** (ACT/365) no meio do mês; o saldo anterior é herdado e qualquer alteração se propaga. Botão **🔁 Repetir** projeta vários meses de uma vez.

### 🧮 Quitação (Compras Parceladas)
Simula pagar uma compra parcelada (ex.: imóvel em 22×) resgatando de investimentos.
- Cadastre a compra com **indexador estimado** (INCC/IPCA/IGP-M, % a.a.) e monte a lista de **fontes de recursos** (vários investimentos, na ordem de uso — ↑↓ para reordenar). Saldo e rendimento vêm da tabela de Investimentos e podem ser ajustados. Ou deixe **sem fontes** → a efetivação lança só as parcelas.
- **Projeção mês a mês editável**: cada mês tem **Correção (% a.a.)** e **Aporte (R$)** editáveis; a simulação esgota o 1º investimento, passa ao 2º etc. (cada um à sua taxa), com **coluna de saldo por investimento** e gráfico.
- Resultado: veredicto (✅ cobre / ⚠️ esgota na parcela N), **aporte mensal mínimo**, total corrigido e análise **quitar × manter aplicado**.
- **✅ Efetivar**: cada parcela vira um par na Previsão (Entrada "Resgate p/ …" refletida como saque no investimento + Saída da parcela), com as **categorias específicas do investimento** ("Resgate de: …" / "Aplicação em: …"). **↩️ Desfazer** com um clique. **Compensação automática**: aporte e resgate do mesmo investimento na mesma data são abatidos entre si (só o líquido é lançado).
- **Operação contínua após efetivar**: editar Correção/Aporte regenera os meses seguintes; conciliar a parcela com **✔** trava aquele mês com o valor realizado e re-ancora os posteriores. Suporta **várias compras** ao mesmo tempo.

### 🔢 Cálculos
Uma tela para **agregar e combinar seus dados** para tomada de decisão.
- Monte até **4 termos** e combine-os com operadores **+ − × ÷** (avaliação da esquerda para a direita), com o **resultado** no final. Cada termo mostra seu valor e a quantidade de itens; atualiza sozinho.
- Cada termo escolhe a **fonte** (🏦 Conta, 💳 Cartão, 📅 Previsão, 📈 Investimento). Em Conta/Cartão dá para restringir a uma **conta/cartão específico**; até **dois filtros combinados com E** (Categoria, Data — `DD/MM/AAAA`, `MM/AAAA` ou `AAAA` — ou Descrição contém); e uma **agregação** (Soma, Média, Contagem, Mín, Máx).
- Movimento **Saídas / Entradas / Líquido** (conta/cartão/previsão); para investimento, **Aportes / Resgates / Rendimento / Saldo** (o Saldo usa o campo de Data para retornar o saldo **naquela data**; vazio = atual).
- **🔍 Lupa por termo**: abre uma janela sobreposta com os **itens que compõem o termo**. Para conta/cartão/previsão, tocar num item **abre a tela do lançamento** e o destaca; para investimento, lista as linhas do histórico.

### 📆 Calendário
- Visão de mês em grade com **entradas e saídas previstas** por dia (agendamentos + recorrências, com 🔁). Clique num dia para ver os lançamentos e o **saldo previsto até aquela data**.
- **Dias com saldo previsto negativo** ficam **vermelhos**; **dias com aviso de resgate** ficam **amarelos com 🔔**.

### 📝 Informações
- Aba de **anotações rápidas**: cada linha tem **Título** (até 60 caracteres) e **Info** (até 100). Criar, **editar** (direto nos campos) e **apagar**. Ficam salvas e vão no backup.

### ⚙️ Configurações
- Organizada em **Notificações**, **Categorias**, **Regras de categorização** e uma caixa **🔐 Segurança** (senha do app, backups e zona de perigo).
- **Categorias** de despesa e receita (criar/excluir).
- **🏷️ Regras de categorização**: *"se a descrição contém X → categoria Y"* (por tipo). Têm **prioridade** ao categorizar importações e podem ser **aplicadas de uma vez** aos lançamentos sem categoria.
- **Orçamento mensal por categoria** (limite em R$, acompanhado no painel 🎯 do Dashboard).
- **Senha do app** (trocar), **backup** (manual e automático em pasta) e **Zona de Perigo** (zerar o banco).

---

## 🌐 Recursos gerais

- **🔍 Busca Global** (botão no topo): encontre lançamentos por **descrição, categoria ou valor** (ex.: `mercado`, `1.500,00`) em **todas as contas, cartão e previsões**, em todos os meses. **Toque num resultado** e o app abre a tela que contém o item, já filtrando o mês e **destacando a linha**.
- **⌨️ Atalhos de teclado** (fora de campos de edição, maiúscula/minúscula): **D** Dashboard · **P** Previsão · **C** Conta Corrente · **A** Cartão · **I** Investimentos · **Q** Quitação · **L** Calendário · **N** Informações · **X** Cálculos · **G** Config · **B** Buscar · **T** tema · **Esc** fecha as janelas. A letra de cada aba aparece no seu tooltip.
- **🔔 Notificações de contas a vencer**: banner no topo avisa sobre saídas previstas nos **próximos 3 dias**; em Config dá para autorizar **notificações do sistema**.
- **🌙 Tema escuro** (botão no cabeçalho; a preferência é lembrada).
- **📱 Mobile**: no celular, o menu do cabeçalho **desliza na horizontal** para ocupar pouca altura.

---

## 📥 Importação de arquivos

**Extrato de conta corrente** (`.ofx`, `.xls`, `.xlsx`, `.csv`), na conta ativa:
- Datas lidas no formato **pt-BR `dd/mm/aaaa`** (sem interpretação americana).
- **Deduplicação por ocorrência**: lançamentos **legitimamente repetidos no mesmo extrato** (mesma data/descrição/valor) são **todos importados**, e **reimportar o mesmo extrato não duplica**. Em `.ofx` com `FITID`, o id único do banco diferencia os lançamentos.

**Fatura de cartão** (`.txt`, `.csv` ou `.pdf`), no cartão ativo:
- **PDF Santander** (seções *Despesas / Parcelamentos / Pagamento e Demais Créditos*) e **PDF Caixa/CEF** (seção *Demonstrativo*). Parcelamentos ("N/N" ou "N DE N") vão para o campo Parcela; créditos/estornos entram como entradas; compras internacionais importam o valor em **R$** (US$ ignorado).
- **Vários portadores** (cartões adicionais) são importados juntos; a deduplicação **por ocorrência** preserva itens legítimos repetidos e **completa importações parciais anteriores** sem duplicar.
- **Conferência (Santander)**: compara o total reconhecido com o Resumo da fatura e mostra o Total a pagar.

---

## 💾 Backup e sincronização

- Dados gravados em **IndexedDB** (`AppFinancas_DB`), com migração automática de dados antigos (`localStorage` e conta única → "Conta Principal").
- **Backup manual** em **Config → Salvar backup**: gera um arquivo **criptografado (`.pib`) com a senha do app** (reconhece também `.json` antigos na restauração). Use **Restaurar backup** para migrar de máquina ou recuperar.
- **iPhone/iPad (iOS)**: o seletor de restauração aceita **qualquer arquivo**, então o `.pib` pode ser escolhido pelo app **Arquivos** — o formato é reconhecido pelo **conteúdo**, não pela extensão.
- **Lembrete automático**: aviso no topo se você **nunca fez backup** ou se o último foi há **30 dias ou mais** (dá para adiar 7 dias).
- **📁 Backup automático em pasta (desktop Chrome/Edge)**: escolha uma **pasta fixa** para o app gravar o backup **a cada alteração** e, ao abrir, **oferecer restaurar** se a pasta tiver dados mais recentes (sempre com confirmação). Apontando para uma pasta do **Google Drive / OneDrive / Dropbox**, vira **sincronização entre máquinas**. Requer **uma autorização por sessão** (exigência do navegador); as preferências de pasta são locais e não entram no backup exportável.
- ⚠️ Limpar os dados do navegador, trocar de dispositivo ou usar janela anônima **apaga ou não enxerga** os dados — por isso o backup é essencial.

---

## 🛠️ Tecnologia

- **PWA** instalável e **offline** via Service Worker (`sw.js`): na primeira visita online, o app (`index.html`, `js/services.js`, `js/ui.js`, ícones) **e as bibliotecas** (Tailwind, Chart.js, Dexie, XLSX, pdf.js) são cacheados; depois funciona sem internet. Nova versão = subir o `CACHE_NAME` em `sw.js`.
- **Estrutura**: `index.html` (markup + Tailwind); **`js/services.js`** (modelo de dados, IndexedDB, cálculos, importação, backup, criptografia) e **`js/ui.js`** (renderização, interface, inicialização).
- **Dexie.js** (IndexedDB) · **Chart.js** (gráficos) · **XLSX** (planilhas) · **pdf.js** (faturas em PDF) · **Tailwind CSS** (interface) · **Web Crypto (AES-GCM + PBKDF2)** e **CompressionStream (gzip)** para os backups `.pib`.
- **Listas virtualizadas** (`content-visibility`): só as linhas visíveis são renderizadas, mantendo a rolagem fluida com milhares de lançamentos.
- **100% client-side**: nenhum dado sai do seu computador.

---

## ❓ Dúvidas rápidas

| Situação | O que fazer |
|---|---|
| Tenho mais de um banco | Crie uma conta para cada um na aba Conta Corrente e marque no dashboard as que deseja somar |
| Uma conta não aparece nos totais | Verifique se o checkbox "Refletir no dashboard/previsão" daquela conta está marcado |
| Transferência entre contas | Importe o extrato e categorize as duas pontas com **"Transferido para a conta: …"** e **"Recebido da conta: …"** — ficam fora do Dashboard |
| Cartão aparecendo em dobro no Dashboard | Categorize o **pagamento da fatura** (na conta corrente) com o **nome do cartão** |
| Troquei de computador / celular | Restaure o último `.pib` em **Config → Restaurar backup** (ou use a pasta de backup em nuvem) |
| Esqueci a senha | Não há recuperação — restaure de um backup feito com a senha que você lembra |
| Os dados sumiram | Confirme o mesmo navegador/perfil (não anônimo); restaure um backup |
| Quero recomeçar do zero | Config → Zona de Perigo → Zerar banco de dados (faça backup antes!) |
| Importação não reconheceu o arquivo | Extrato: `.ofx/.xls/.xlsx/.csv` · Cartão: `.txt/.csv/.pdf` (Santander/Caixa) |
