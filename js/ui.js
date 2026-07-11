// ============================================================================
// ui.js — renderização, manipuladores de interface e inicialização
// Gerado a partir do script único do index.html (mesmo escopo global; funções
// continuam acessíveis pelos handlers onclick do HTML).
// ============================================================================

        // Registo do Service Worker para PWA
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js').then(reg => {
                    console.log('Service Worker registrado!', reg.scope);
                }).catch(err => console.log('Falha no Service Worker', err));
            });
        }

        // ===== Tema claro/escuro (persistido em localStorage) =====
        function aplicarTema(tema) {
            const escuro = tema === 'dark';
            document.documentElement.classList.toggle('dark', escuro);
            const btn = document.getElementById('btn-tema');
            if (btn) { btn.innerText = escuro ? '☀️' : '🌙'; btn.title = escuro ? 'Mudar para modo claro' : 'Mudar para modo escuro'; }
            try { localStorage.setItem('tema', escuro ? 'dark' : 'light'); } catch (e) {}
        }
        function toggleTema() {
            aplicarTema(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
        }
        // Aplica o tema salvo o quanto antes (ui.js roda no fim do body)
        aplicarTema((() => { try { return localStorage.getItem('tema'); } catch (e) { return null; } })() || 'light');


        function debouncedRenderRelatorio() { debounce('renderRelatorio', () => renderRelatorio(), 100); }

        function debouncedRenderTransactionsBanco() { debounce('renderTransactionsBanco', () => renderTransactionsBanco(), 100); }

        function debouncedRenderTransactionsCartao() { debounce('renderTransactionsCartao', () => renderTransactionsCartao(), 100); }

        function debouncedCalcularSaldoAlvo() { debounce('calcularSaldoAlvo', () => calcularSaldoAlvo(), 100); }

        function debouncedCalcularSomaCategoriaFuturo() { debounce('calcularSomaCategoriaFuturo', () => calcularSomaCategoriaFuturo(), 100); }

        function debouncedBuscaGlobal() { debounce('buscaGlobal', () => executarBuscaGlobal(), 200); }

        function debouncedSimularQuitacao() { debounce('simularQuitacao', () => renderSimulacaoQuitacao(), 250); }


        async function init() {
            // A criptografia é SEMPRE ativa. Duas situações ao abrir:
            //  • já existe senha cadastrada  -> tela de desbloqueio (pede a senha);
            //  • ainda não existe senha       -> carrega o que houver e pede para CRIAR uma
            //    senha (que passa a proteger tudo, inclusive os backups).
            try {
                const meta = await db.config.get('cripto');
                if (meta && meta.enabled) {
                    if (!chaveSessao) { criptoAtivada = true; mostrarTelaBloqueio(); return; }
                    await continuarInit();
                    return;
                }
            } catch (e) {}
            // Sem senha ainda: carrega os dados atuais (texto puro/migração) e exige criar senha.
            await loadDataFromDB();
            mostrarTelaCriarSenha();
        }

        async function continuarInit() {
            await loadDataFromDB();

            // Rola o horizonte das recorrências (gera novas ocorrências que entraram nos 12 meses)
            try { if (gerarLancamentosRecorrentes()) await saveToDB(); } catch(e) {}
            // Sincroniza as parcelas dos cartões na Previsão
            try { if (sincronizarParcelasCartao()) await saveToDB(); } catch(e) {}
            // Gera os lembretes de resgate (D+X) na Previsão
            try { if (sincronizarLembretesResgate()) await saveToDB(); } catch(e) {}

            // Backup automático em pasta (desktop): tenta sincronizar ao abrir. Se a
            // permissão da pasta ainda não foi concedida nesta sessão, mostra um banner
            // para o usuário autorizar com um clique (exigência do navegador).
            try {
                await carregarAutoBkp();
                if (autoBkpCfg && autoBkpCfg.ativo && autoBkpHandle) {
                    if (await verificarPermissaoPasta(false)) {
                        if (autoBkpCfg.restaurarAoAbrir) await autoRestaurarSeMaisNovo(false);
                    } else {
                        safeRun(atualizarBannerAutoBkp);
                    }
                }
            } catch(e) {}

            const inputSaldoIni = document.getElementById('input-saldo-inicial');
            if (inputSaldoIni) inputSaldoIni.value = (appState.saldoInicial || 0).toFixed(2);
            const inputLimNeg = document.getElementById('prev-limite-negativo');
            if (inputLimNeg) inputLimNeg.value = appState.limiteDiasNegativos || 10;

            const today = new Date();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const yyyy = today.getFullYear();
            const dd = String(today.getDate()).padStart(2, '0');
            
            try {
                document.getElementById('dash-month-filter').value = `${yyyy}-${mm}`;
                document.getElementById('fatura-mes').value = `${yyyy}-${mm}`;
                document.getElementById('prev-target-date').value = `${yyyy}-${mm}-${dd}`;
                document.getElementById('inv-month-filter').value = `${yyyy}-${mm}`;
                document.getElementById('pr-month-filter').value = `${yyyy}-${mm}`;
            } catch(e) {}

            safeRun(updateFutureCategoriesDropdown);
            safeRun(updatePrevSumDropdown);
            safeRun(updateFutureInvestimentoDropdown);
            
            safeRun(renderContasUI);
            safeRun(preencherFormConta);
            safeRun(renderCartoesUI);
            safeRun(atualizarLembreteBackup);
            safeRun(atualizarInfoUltimoBackup);
            updateFilterMesBancoLight();
            updateFilterMesCartaoLight();
            renderInvestimentos();
            renderCategoriesTab();
            updateSaldoDisplay();
            
            const activeTab = document.querySelector('.tab-content:not(.hidden)')?.id || 'tab-dashboard';
            if (activeTab === 'tab-dashboard') renderRelatorio();
            else if (activeTab === 'tab-previsao') renderPrevisao();
            else if (activeTab === 'tab-extrato') renderTransactionsBanco();
            else if (activeTab === 'tab-cartao') renderTransactionsCartao();
            
            try {
                document.getElementById('fileInputBanco').addEventListener('change', e => handleFileUpload(e, 'banco'));
                document.getElementById('fileInputCartao').addEventListener('change', e => handleFileUpload(e, 'cartao'));
            } catch(e) {}

            safeRun(renderRecorrencias);
            safeRun(atualizarBannerVencimentos);
            safeRun(notificarVencimentosSeAtivo);
        }


        // Preenche um <select> de filtro com os meses (MM/AAAA) presentes na lista, do mais
        // recente para o mais antigo, preservando a seleção atual quando ainda existir
        function preencherFiltroMeses(selectId, transacoes) {
            const select = document.getElementById(selectId);
            if (!select) return;
            const atual = select.value;
            const meses = new Set();
            for (let t of transacoes) {
                const n = mesAnoNum(t.data);
                if (n !== null) meses.add(`${String(((n - 1) % 12) + 1).padStart(2, '0')}/${Math.floor((n - 1) / 12)}`);
            }
            const arr = [...meses].sort((a, b) => mesAnoNum(b) - mesAnoNum(a));
            select.innerHTML = `<option value="todos">Todos os Meses</option>` + arr.map(m => `<option value="${m}">${m}</option>`).join('');
            if (arr.includes(atual)) select.value = atual;
        }


        function updateFilterMesBancoLight() { preencherFiltroMeses('filterMesBanco', appState.transactions.filter(x => x.contaId === contaSelecionadaId)); }

        function updateFilterMesCartaoLight() { preencherFiltroMeses('filterMesCartao', appState.ccTransactions.filter(t => (t.cartaoId || null) === cartaoSelecionadoId)); }


        function switchTab(tabId) {
            try {
                document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
                const targetTab = document.getElementById(`tab-${tabId}`);
                if (targetTab) targetTab.classList.remove('hidden');
                
                document.querySelectorAll('.tab-btn').forEach(btn => {
                    btn.classList.remove('bg-indigo-700', 'text-white');
                    btn.classList.add('text-indigo-100', 'hover:bg-indigo-500');
                });
                const activeBtn = document.getElementById(`btn-${tabId}`);
                if(activeBtn) {
                    activeBtn.classList.add('bg-indigo-700', 'text-white');
                    activeBtn.classList.remove('text-indigo-100', 'hover:bg-indigo-500');
                }
                
                if (tabId === 'dashboard') renderRelatorio();
                if (tabId === 'previsao') renderPrevisao();
                if (tabId === 'extrato') { renderContasUI(); preencherFormConta(); renderTransactionsBanco(); }
                if (tabId === 'cartao') { safeRun(renderCartoesUI); renderTransactionsCartao(); }
                if (tabId === 'investimentos') renderInvestimentos();
                if (tabId === 'quitacao') renderQuitacao();
                if (tabId === 'calendario') renderCalendario();
                if (tabId === 'config') { renderCategoriesTab(); safeRun(renderRegrasCategoria); safeRun(atualizarInfoUltimoBackup); safeRun(renderCardSenha); safeRun(atualizarCardNotif); safeRun(renderCardAutoBkp); }
            } catch(err) {}
        }


        function clearFilter(type) {
            if (type === 'extrato') {
                document.getElementById('filterMesBanco').value = 'todos';
                document.getElementById('filterSelectBanco').value = 'todos';
                renderTransactionsBanco();
            } else {
                document.getElementById('dash-month-filter').value = '';
                document.getElementById('dash-range-filter').value = '1';
                renderRelatorio();
            }
        }


        function deletarFaturaMes() {
            const mesValue = document.getElementById('delete-fatura-mes').value;
            if(!mesValue) { alert('Selecione um mês para apagar os lançamentos do cartão.'); return; }
            const [ano, mes] = mesValue.split('-');
            const targetSuffix = `${mes}/${ano}`;
            const lenAntes = appState.ccTransactions.length;
            appState.ccTransactions = appState.ccTransactions.filter(t => {
                if ((t.cartaoId || null) !== cartaoSelecionadoId) return true; // só a fatura do cartão ativo
                if(!t.data) return true;
                return !t.data.endsWith(targetSuffix);
            });
            const deletados = lenAntes - appState.ccTransactions.length;
            if(deletados > 0) {
                sincronizarParcelasCartao();
                saveData();
                alert(`Foram apagados ${deletados} lançamentos do Cartão "${getCartaoAtivo() ? getCartaoAtivo().nome : ''}" com vencimento em ${mes}/${ano}.`);
                document.getElementById('delete-fatura-mes').value = '';
            } else { alert(`Nenhum lançamento encontrado em ${mes}/${ano}.`); }
        }


        function handleFileUpload(e, targetType) {
            const file = e.target.files[0];
            if (!file) return;

            if (targetType === 'cartao') {
                let dataVencimentoFatura = "";
                let anoFaturaCartao = "";

                const fatMes = document.getElementById('fatura-mes').value;
                const cartaoAtivo = getCartaoAtivo();
                if (!cartaoAtivo) { alert("Cadastre/selecione um cartão antes de importar a fatura."); e.target.value = ''; return; }
                if (!fatMes) {
                    alert("Informe o Mês da Fatura ANTES de selecionar o arquivo.");
                    e.target.value = ''; return;
                }
                const fatDia = Math.min(Math.max(parseInt(cartaoAtivo.diaVencimento, 10) || 10, 1), 31); // do cadastro do cartão
                const [anoFat, mesFat] = fatMes.split('-');
                anoFaturaCartao = anoFat;
                const ultimoDiaMes = new Date(Number(anoFat), Number(mesFat), 0).getDate();
                const diaVenc = Math.min(fatDia, ultimoDiaMes);
                dataVencimentoFatura = `${String(diaVenc).padStart(2, '0')}/${mesFat}/${anoFat}`;

                if ((file.name || '').toLowerCase().endsWith('.pdf')) {
                    importarPdfFaturaCartao(file, e, dataVencimentoFatura, anoFaturaCartao);
                    return;
                }

                const reader = new FileReader();
                reader.onload = function(evt) {
                    processarConteudoCartao(evt.target.result, e, dataVencimentoFatura, anoFaturaCartao);
                };
                reader.readAsText(file, 'UTF-8');

            } else if (targetType === 'banco') {
                if (!contaSelecionadaId || !getContaById(contaSelecionadaId)) {
                    alert("Selecione (ou crie) uma Conta Corrente antes de importar o extrato.");
                    e.target.value = '';
                    return;
                }
                if ((file.name || '').toLowerCase().endsWith('.ofx')) {
                    const r = new FileReader();
                    r.onload = ev => importarOFX(ev.target.result, e);
                    r.readAsText(file, 'UTF-8');
                    return;
                }
                const reader = new FileReader();
                reader.onload = function(evt) {
                    try {
                        const data = new Uint8Array(evt.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });
                        const firstSheetName = workbook.SheetNames[0];
                        const worksheet = workbook.Sheets[firstSheetName];
                        
                        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, dateNF: 'dd/mm/yyyy' });
                        
                        let headerRowIndex = -1;
                        let finalIdxData = -1, finalIdxDesc = -1, finalIdxValor = -1, finalIdxCredito = -1, finalIdxDebito = -1, finalIdxCat = -1;

                        for(let i=0; i < Math.min(15, json.length); i++) {
                            const row = json[i];
                            if(!row || !row.length) continue;
                            
                            let idxData = -1, idxDesc = -1, idxValor = -1, idxCredito = -1, idxDebito = -1, idxCat = -1;
                            
                            for(let j=0; j < row.length; j++) {
                                const cell = String(row[j] || '').toLowerCase().trim();
                                
                                if(cell === 'data' || cell.includes('data') || cell === 'dt.') idxData = j;
                                else if(cell.includes('descri') || cell.includes('hist') || cell.includes('lanç') || cell.includes('lanc') || cell.includes('detalhe')) idxDesc = j;
                                else if(cell === 'valor' || cell.includes('valor ') || cell.includes('valor(r$)')) idxValor = j;
                                else if(cell.includes('créd') || cell.includes('cred') || cell === 'entrada' || cell === 'c') idxCredito = j;
                                else if(cell.includes('déb') || cell.includes('deb') || cell === 'saida' || cell === 'saída' || cell === 'd') idxDebito = j;
                                else if(cell.includes('categoria') || cell.includes('cat.')) idxCat = j;
                            }
                            
                            if(idxData !== -1 && idxDesc !== -1 && (idxValor !== -1 || (idxCredito !== -1 && idxDebito !== -1))) {
                                headerRowIndex = i;
                                finalIdxData = idxData;
                                finalIdxDesc = idxDesc;
                                finalIdxValor = idxValor;
                                finalIdxCredito = idxCredito;
                                finalIdxDebito = idxDebito;
                                finalIdxCat = idxCat;
                                break;
                            }
                        }

                        if (headerRowIndex === -1) {
                            alert("Colunas não identificadas no arquivo da Conta Corrente.\nCertifique-se de ter colunas com 'Data', 'Descrição' e 'Valor' (ou 'Crédito' e 'Débito').\nLinha 1 detectada: " + JSON.stringify(json[0] || []));
                            e.target.value = ''; return;
                        }

                        let addedCount = 0;
                        for (let i = headerRowIndex + 1; i < json.length; i++) {
                            const row = json[i];
                            if (!row || !row.length) continue;

                            let dataRaw = row[finalIdxData];
                            if (!dataRaw) continue;
                            
                            let dataStr = String(dataRaw).trim();
                            if (dataStr.match(/^\d{4}-\d{2}-\d{2}/)) {
                                const p = dataStr.split('T')[0].split('-');
                                dataStr = `${p[2]}/${p[1]}/${p[0]}`;
                            } else if (dataStr.match(/^\d{2}-\d{2}-\d{4}/)) {
                                dataStr = dataStr.replace(/-/g, '/');
                            }

                            // Só importa linhas cujo campo de data contenha uma data válida (ignora saldo, totais, rodapé)
                            const mData = dataStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
                            if (!mData) continue;
                            const diaD = parseInt(mData[1], 10), mesD = parseInt(mData[2], 10);
                            const anoD = mData[3].length === 2 ? '20' + mData[3] : mData[3];
                            if (diaD < 1 || diaD > 31 || mesD < 1 || mesD > 12) continue;
                            dataStr = `${String(diaD).padStart(2, '0')}/${String(mesD).padStart(2, '0')}/${anoD}`;

                            let descricao = String(row[finalIdxDesc] || '').trim();
                            
                            const parseVal = (v) => {
                                if(v === undefined || v === null || v === '') return 0;
                                if(typeof v === 'number') return v;
                                let str = String(v).replace(/\s/g, '').replace('R$', '').replace('R', '').replace('$', '').trim();
                                
                                if(str.indexOf(',') > -1 && str.indexOf('.') > -1) {
                                    if(str.lastIndexOf(',') > str.lastIndexOf('.')) {
                                        str = str.replace(/\./g, '').replace(',', '.');
                                    } else {
                                        str = str.replace(/,/g, '');
                                    }
                                } else if(str.indexOf(',') > -1) {
                                    str = str.replace(',', '.');
                                }
                                const parsed = parseFloat(str);
                                return isNaN(parsed) ? 0 : parsed;
                            };

                            let credito = 0, debito = 0;
                            if(finalIdxValor !== -1) {
                                const val = parseVal(row[finalIdxValor]);
                                if (val > 0) credito = val;
                                else if (val < 0) debito = Math.abs(val);
                            } else {
                                credito = parseVal(row[finalIdxCredito]);
                                debito = Math.abs(parseVal(row[finalIdxDebito]));
                                if (debito > 0) credito = 0;
                            }

                            if (credito === 0 && debito === 0) continue;

                            let finalCat = '';
                            const tipoCat = debito > 0 ? 'despesas' : 'receitas';

                            if(finalIdxCat !== -1 && row[finalIdxCat]) {
                                let catLida = String(row[finalIdxCat]).trim();
                                const catArr = appState.categories[tipoCat] || [];
                                
                                let matched = catArr.find(c => c.toLowerCase() === catLida.toLowerCase());
                                if(!matched) matched = catArr.find(c => c.toLowerCase().includes(catLida.toLowerCase()) || catLida.toLowerCase().includes(c.toLowerCase()));
                                
                                if(matched) {
                                    finalCat = matched;
                                } else {
                                    appState.categories[tipoCat].push(catLida);
                                    finalCat = catLida;
                                }
                            } else {
                                finalCat = findBestCategoryMatch(descricao, debito > 0);
                            }

                            const realUniqueId = 'bco_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9) + '_' + i;
                            
                            const exists = appState.transactions.some(t =>
                                t.contaId === contaSelecionadaId &&
                                t.descricao === descricao &&
                                t.data === dataStr &&
                                Math.abs((t.debito || t.credito) - (debito || credito)) < 0.01
                            );

                            if (!exists) {
                                appState.transactions.push({
                                    id: realUniqueId, data: dataStr, descricao: descricao, contaId: contaSelecionadaId,
                                    credito: credito, debito: debito, categoria: finalCat || '', isDuplicate: false
                                });
                                addedCount++;
                            }
                        }

                        updateFilterMesBancoLight();
                        updateFutureCategoriesDropdown(); 
                        updatePrevSumDropdown();
                        
                        if (addedCount > 0) alert(`Foram importados ${addedCount} lançamentos da Conta Corrente com sucesso.`);
                        else alert("Nenhum lançamento novo foi importado. Eles já existem ou o arquivo está vazio.");
                        
                        e.target.value = ''; 
                        saveData();

                    } catch (err) {
                        alert("Erro ao processar o arquivo Excel/CSV: " + err.message);
                        e.target.value = '';
                    }
                };
                
                reader.readAsArrayBuffer(file);
            }
        }


        // Importa um extrato .ofx na conta ativa (dedup por FITID ou descrição+data+valor)
        function importarOFX(texto, e) {
            try {
                const txns = parseOFX(texto);
                if (!txns.length) { alert("Nenhum lançamento encontrado no arquivo OFX. Confira se é um extrato .ofx válido."); e.target.value = ''; return; }
                const fitidsExistentes = new Set(appState.transactions.filter(t => t.contaId === contaSelecionadaId && t.fitid).map(t => t.fitid));
                let addc = 0;
                for (const tx of txns) {
                    const dup = (tx.fitid && fitidsExistentes.has(tx.fitid)) || appState.transactions.some(t =>
                        t.contaId === contaSelecionadaId && t.data === tx.data && t.descricao === tx.descricao &&
                        Math.abs((t.debito || t.credito) - (tx.debito || tx.credito)) < 0.01);
                    if (dup) continue;
                    const cat = findBestCategoryMatch(tx.descricao, tx.debito > 0);
                    appState.transactions.push({
                        id: 'ofx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                        data: tx.data, descricao: tx.descricao, contaId: contaSelecionadaId,
                        credito: tx.credito, debito: tx.debito, categoria: cat || '', fitid: tx.fitid || '', isDuplicate: false
                    });
                    if (tx.fitid) fitidsExistentes.add(tx.fitid);
                    addc++;
                }
                updateFilterMesBancoLight(); updateFutureCategoriesDropdown(); updatePrevSumDropdown();
                alert(addc > 0 ? `Foram importados ${addc} lançamentos do OFX com sucesso.` : "Nenhum lançamento novo — todos já existem na conta.");
                e.target.value = ''; saveData();
            } catch (err) { alert("Erro ao processar o arquivo OFX: " + err.message); e.target.value = ''; }
        }

        function updateSaldoDisplay() {
            const saldo = getSaldoAtualReal();
            const el = document.getElementById('card-saldo-real');
            if (el) el.innerText = formatCurrency(saldo);
        }


        // MOTOR DE FILTRAGEM DO DASHBOARD ATUALIZADO (Robusto para todos os formatos de data)
        function renderRelatorio() {
            const filterEl = document.getElementById('dash-month-filter');
            let filterVal = filterEl ? filterEl.value : '';
            
            if (!filterVal) {
                const today = new Date();
                filterVal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
                if (filterEl) filterEl.value = filterVal;
            }

            const rangeEl = document.getElementById('dash-range-filter');
            const range = rangeEl ? (parseInt(rangeEl.value) || 1) : 1;
            
            let transReais = appState.transactions.filter(t => contaIncluida(t.contaId));
            let transCartoes = appState.ccTransactions;

            const [anoStr, mesStr] = filterVal.split('-');
            const endNum = parseInt(anoStr, 10) * 12 + parseInt(mesStr, 10);
            const startNum = endNum - range + 1;

            const inRange = (dataStr) => {
                const tNum = mesAnoNum(dataStr);
                return tNum !== null && tNum >= startNum && tNum <= endNum;
            };

            transReais = transReais.filter(t => inRange(t.data)); 
            transCartoes = transCartoes.filter(c => inRange(c.data));

            let recCaixa = 0, desCaixa = 0;
            for (let t of transReais) { recCaixa += Number(t.credito)||0; desCaixa += Number(t.debito)||0; }
            for (let t of transCartoes) { recCaixa += Number(t.credito)||0; desCaixa += Number(t.debito)||0; }
            const balanco = recCaixa - desCaixa;

            document.getElementById('card-receitas-periodo').innerText = formatCurrency(recCaixa);
            document.getElementById('card-despesas-periodo').innerText = formatCurrency(desCaixa);
            const balEl = document.getElementById('card-balanco-periodo');
            balEl.innerText = formatCurrency(balanco);
            balEl.className = balanco >= 0 ? "text-2xl font-bold text-indigo-600 mt-1" : "text-2xl font-bold text-rose-600 mt-1";

            let desMap = {}; let recMap = {};
            const despesasCat = appState.categories.despesas || []; const receitasCat = appState.categories.receitas || [];
            for (let c of despesasCat) desMap[c] = 0; desMap['Não Categorizado'] = 0;
            for (let c of receitasCat) recMap[c] = 0; recMap['Não Categorizado'] = 0;

            for (let t of transReais) {
                if (t.debito > 0) { let c = t.categoria || 'Não Categorizado'; if(desMap[c]===undefined) desMap[c]=0; desMap[c] += Number(t.debito)||0; }
                if (t.credito > 0) { let c = t.categoria || 'Não Categorizado'; if(recMap[c]===undefined) recMap[c]=0; recMap[c] += Number(t.credito)||0; }
            }
            for (let t of transCartoes) {
                let c = t.categoria || 'Não Categorizado';
                if (t.debito > 0) { if(desMap[c]===undefined) desMap[c]=0; desMap[c] += Number(t.debito)||0; }
                if (t.credito > 0) { if(recMap[c]===undefined) recMap[c]=0; recMap[c] += Number(t.credito)||0; }
            }

            const arrDespesas = []; for (let k in desMap) { if (desMap[k] > 0 && k !== 'Não Categorizado') arrDespesas.push({cat: k, val: desMap[k]}); }
            arrDespesas.sort((a,b) => b.val - a.val);
            const arrReceitas = []; for (let k in recMap) { if (recMap[k] > 0 && k !== 'Não Categorizado') arrReceitas.push({cat: k, val: recMap[k]}); }
            arrReceitas.sort((a,b) => b.val - a.val);

            const listaD = document.getElementById('lista-detalhe-despesas'); listaD.innerHTML = '';
            if(arrDespesas.length === 0) listaD.innerHTML = `<li class="text-slate-400 py-2">Sem despesas categorizadas.</li>`;
            for (let item of arrDespesas) {
                const media = item.val / range;
                listaD.innerHTML += `
                    <li class="flex justify-between items-center py-2 border-b border-slate-50 last:border-0 hover:bg-slate-50 px-2">
                        <div class="flex flex-col min-w-0"><span class="text-slate-600 truncate font-medium mr-2">${item.cat}</span>
                        ${range > 1 ? `<span class="text-xs text-slate-400">Média: ${formatCurrency(media)}/mês</span>` : ''}</div>
                        <span class="font-semibold text-rose-600 whitespace-nowrap">${formatCurrency(item.val)}</span>
                    </li>`;
            }

            const listaR = document.getElementById('lista-detalhe-receitas'); listaR.innerHTML = '';
            if(arrReceitas.length === 0) listaR.innerHTML = `<li class="text-slate-400 py-2">Sem receitas categorizadas.</li>`;
            for (let item of arrReceitas) {
                const media = item.val / range;
                listaR.innerHTML += `
                    <li class="flex justify-between items-center py-2 border-b border-slate-50 last:border-0 hover:bg-slate-50 px-2">
                        <div class="flex flex-col min-w-0"><span class="text-slate-600 truncate font-medium mr-2">${item.cat}</span>
                        ${range > 1 ? `<span class="text-xs text-slate-400">Média: ${formatCurrency(media)}/mês</span>` : ''}</div>
                        <span class="font-semibold text-emerald-600 whitespace-nowrap">${formatCurrency(item.val)}</span>
                    </li>`;
            }

            try {
                const ctxD = document.getElementById('chartDespesas');
                if(ctxD) {
                    const labelsD = arrDespesas.map(i => i.cat); const dadosD = arrDespesas.map(i => i.val);
                    if (expenseChartInstance) expenseChartInstance.destroy();
                    expenseChartInstance = new Chart(ctxD.getContext('2d'), {
                        type: 'doughnut', data: { labels: labelsD, datasets: [{ data: dadosD, backgroundColor: generateColors(labelsD.length, 'despesa') }] },
                        options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } } }
                    });
                }
                const ctxR = document.getElementById('chartReceitas');
                if(ctxR) {
                    const labelsR = arrReceitas.map(i => i.cat); const dadosR = arrReceitas.map(i => i.val);
                    if (incomeChartInstance) incomeChartInstance.destroy();
                    incomeChartInstance = new Chart(ctxR.getContext('2d'), {
                        type: 'doughnut', data: { labels: labelsR, datasets: [{ data: dadosR, backgroundColor: generateColors(labelsR.length, 'receita') }] },
                        options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } } }
                    });
                }
            } catch(e) {}

            safeRun(() => renderOrcamento(desMap, range));
            safeRun(() => renderEvolucaoMensal(endNum));
        }


        // Gráfico de barras Entradas x Saídas (+ linha de balanço) dos 12 meses que
        // terminam no mês de referência do Dashboard. Usa as mesmas fontes do relatório:
        // contas correntes marcadas para refletir + cartão de crédito.
        function renderEvolucaoMensal(endNum) {
            const ctx = document.getElementById('chartEvolucao');
            if (!ctx) return;
            const NUM_MESES = 12;
            const startNum = endNum - NUM_MESES + 1;
            const receitas = new Array(NUM_MESES).fill(0);
            const despesas = new Array(NUM_MESES).fill(0);
            const somar = (t) => {
                const n = mesAnoNum(t.data);
                if (n === null || n < startNum || n > endNum) return;
                receitas[n - startNum] += Number(t.credito) || 0;
                despesas[n - startNum] += Number(t.debito) || 0;
            };
            for (let t of appState.transactions) { if (contaIncluida(t.contaId)) somar(t); }
            for (let t of appState.ccTransactions) somar(t);

            const labels = [];
            for (let i = 0; i < NUM_MESES; i++) {
                const num = startNum + i;
                const y = Math.floor((num - 1) / 12);
                const m = ((num - 1) % 12) + 1;
                labels.push(`${String(m).padStart(2, '0')}/${String(y).slice(2)}`);
            }
            const balanco = receitas.map((r, i) => r - despesas[i]);

            if (evolucaoChartInstance) evolucaoChartInstance.destroy();
            evolucaoChartInstance = new Chart(ctx.getContext('2d'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'Entradas', data: receitas, backgroundColor: 'rgba(16, 185, 129, 0.75)', borderRadius: 3, order: 2 },
                        { label: 'Saídas', data: despesas, backgroundColor: 'rgba(244, 63, 94, 0.75)', borderRadius: 3, order: 2 },
                        { label: 'Balanço', data: balanco, type: 'line', borderColor: '#4f46e5', backgroundColor: '#4f46e5', borderWidth: 2, pointRadius: 3, tension: 0.3, order: 1 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
                        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatCurrency(c.parsed.y)}` } }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                        y: { ticks: { font: { size: 10 }, callback: (v) => formatCurrencyNumber(v) } }
                    }
                }
            });
        }


        // Painel de orçamento do Dashboard: compara o gasto de cada categoria no período
        // filtrado com o limite mensal (multiplicado pelo nº de meses do período)
        function renderOrcamento(desMap, range) {
            const cont = document.getElementById('lista-orcamento');
            const resumo = document.getElementById('orcamento-resumo');
            const nota = document.getElementById('orcamento-nota');
            if (!cont) return;
            if (nota) nota.innerText = range > 1
                ? `Gasto do período vs. limite mensal × ${range} meses`
                : 'Gasto do período vs. limite mensal definido em ⚙️ Config';

            const items = [];
            const catsDespesa = appState.categories.despesas || [];
            for (let cat in (appState.orcamentos || {})) {
                if (!catsDespesa.includes(cat)) continue;
                const limMensal = Number(appState.orcamentos[cat]) || 0;
                if (limMensal <= 0) continue;
                const lim = limMensal * range;
                const gasto = Number(desMap[cat]) || 0;
                items.push({ cat, lim, gasto, pct: (gasto / lim) * 100 });
            }
            if (items.length === 0) {
                cont.innerHTML = `<p class="text-sm text-slate-400">Nenhum limite definido. Informe o orçamento mensal das categorias de despesa em <b>⚙️ Config</b>.</p>`;
                if (resumo) resumo.innerText = '';
                return;
            }
            items.sort((a, b) => b.pct - a.pct);

            let totLim = 0, totGasto = 0, html = '';
            for (let it of items) {
                totLim += it.lim; totGasto += it.gasto;
                const corBarra = it.pct > 100 ? 'bg-rose-500' : (it.pct >= 80 ? 'bg-amber-400' : 'bg-emerald-500');
                const corTexto = it.pct > 100 ? 'text-rose-600' : (it.pct >= 80 ? 'text-amber-600' : 'text-emerald-600');
                html += `
                    <div>
                        <div class="flex justify-between items-baseline text-sm mb-1">
                            <span class="font-medium text-slate-600 truncate mr-2">${escapeHtml(it.cat)}${it.pct > 100 ? ' ⚠️' : ''}</span>
                            <span class="whitespace-nowrap text-xs text-slate-500">${formatCurrency(it.gasto)} de ${formatCurrency(it.lim)} <b class="${corTexto}">(${Math.round(it.pct)}%)</b></span>
                        </div>
                        <div class="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                            <div class="${corBarra} h-2.5 rounded-full transition-all" style="width:${Math.min(100, it.pct)}%"></div>
                        </div>
                    </div>`;
            }
            cont.innerHTML = html;
            if (resumo) {
                const pctTotal = totLim > 0 ? Math.round((totGasto / totLim) * 100) : 0;
                resumo.innerText = `Total: ${formatCurrency(totGasto)} de ${formatCurrency(totLim)} (${pctTotal}%)`;
                resumo.className = 'text-sm font-semibold whitespace-nowrap ' + (pctTotal > 100 ? 'text-rose-600' : (pctTotal >= 80 ? 'text-amber-600' : 'text-emerald-600'));
            }
        }


        function updatePrevSumDropdown() {
            const dropdown = document.getElementById('prev-sum-categoria');
            if(!dropdown) return;
            const selected = dropdown.value; dropdown.innerHTML = '<option value="">-- Categoria --</option>';
            const todas = sortedCats([...(appState.categories.despesas||[]), ...(appState.categories.receitas||[])]);
            for (let cat of todas) { const opt = document.createElement('option'); opt.value = cat; opt.innerText = cat; dropdown.appendChild(opt); }
            if(todas.includes(selected)) dropdown.value = selected;
        }


        function calcularSomaCategoriaFuturo() {
            const catSel = document.getElementById('prev-sum-categoria').value;
            const resultEl = document.getElementById('prev-sum-result');
            if(!resultEl) return;
            if(!catSel) { resultEl.innerText = 'R$ 0,00'; return; }
            let soma = 0; for (let f of appState.futureTransactions) { if(!f.conciliado && f.categoria === catSel) soma += Number(f.valor) || 0; }
            resultEl.innerText = formatCurrency(soma);
        }


        function renderPrevisao() {
            updateFutureInvestimentoDropdown();
            let saldoMutavel = getSaldoAtualReal();
            document.getElementById('prev-saldo-atual').innerText = formatCurrency(saldoMutavel);
            document.getElementById('prev-saldo-atual').className = saldoMutavel >= 0 ? "font-bold text-slate-800 text-2xl" : "font-bold text-rose-600 text-2xl";

            const tbody = document.getElementById('lista-previsao-cronologica'); tbody.innerHTML = '';
            const today = new Date(); today.setHours(0,0,0,0);

            const pendentes = appState.futureTransactions.filter(f => !f.conciliado);
            if (pendentes.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400">Nenhum agendamento.</td></tr>`;
            } else {
                const futs = [...pendentes];
                futs.sort((a,b) => converterDataBRParaDate(a.data) - converterDataBRParaDate(b.data));
                const alertasNeg = calcularAlertasChequeEspecial(futs, getSaldoAtualReal());
                let html = '';
                for (let f of futs) {
                    const isDeb = f.tipo === 'debito'; const val = Number(f.valor) || 0;
                    if(isDeb) saldoMutavel -= val; else saldoMutavel += val;
                    const corVal = isDeb ? 'text-rose-600' : 'text-emerald-600';
                    const corSal = saldoMutavel >= 0 ? 'text-indigo-600' : 'text-rose-600';
                    const isVencido = converterDataBRParaDate(f.data) <= today;
                    const alerta = alertasNeg[f.id];
                    let rowClass = isVencido ? 'bg-amber-100 hover:bg-amber-200 border-amber-200' : 'bg-white hover:bg-slate-50 border-slate-100';
                    if (alerta) rowClass = 'bg-rose-200 hover:bg-rose-300 border-rose-400';

                    const invNome = f.investimentoId ? (appState.investimentos.find(i => i.id === f.investimentoId)?.nome) : null;
                    const badgeInv = invNome ? `<span class="ml-2 text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold" title="Reflete em ${escapeHtml(invNome)} (${isDeb?'Aporte':'Resgate'})">📈 ${isDeb?'Aporte':'Resgate'}</span>` : '';
                    const badgeAlerta = alerta ? `<span class="block text-[10px] font-bold text-rose-700 mt-1">🚨 ${alerta.map(a => `${a.limite}º dia no vermelho em ${a.mes}${a.exato ? '' : ` (atingido em ${a.dia}, sem lançamento nesse dia)`}`).join(' · ')} — ultrapassa o limite do cheque especial</span>` : '';

                    html += `
                        <tr class="${rowClass} border-b transition">
                            <td class="p-4 font-semibold text-slate-600 whitespace-nowrap">${f.data} ${alerta ? '🚨' : (isVencido?'⚠️':'')}</td>
                            <td class="p-4 text-slate-800 font-medium">${escapeHtml(f.descricao)}${badgeInv}${badgeAlerta}</td>
                            <td class="p-4"><span class="text-[11px] bg-white border border-slate-200 px-2 py-1 rounded text-slate-600">${escapeHtml(f.categoria)}</span></td>
                            <td class="p-4 font-bold ${corVal} whitespace-nowrap">${isDeb?'-':'+'} ${formatCurrency(val)}</td>
                            <td class="p-4 text-right font-bold ${corSal} whitespace-nowrap">${formatCurrency(saldoMutavel)}</td>
                            <td class="p-4 text-right whitespace-nowrap">
                                <button onclick="efetivarPrevisao('${f.id}')" title="Efetivar: informar o valor realizado e enviar para Previsto × Realizado" class="text-emerald-600 hover:bg-emerald-50 bg-white border p-1 rounded transition font-bold">✔</button>
                                <button onclick="editFutureTransaction('${f.id}')" class="text-indigo-500 hover:bg-indigo-50 bg-white border p-1 rounded transition">✏️</button>
                                <button onclick="repeatFutureTransaction('${f.id}')" class="text-sky-500 hover:bg-sky-50 bg-white border p-1 rounded transition">🔁</button>
                                <button onclick="deleteFutureTransaction('${f.id}')" class="text-rose-500 hover:bg-rose-50 bg-white border p-1 rounded transition">🗑️</button>
                            </td>
                        </tr>`;
                }
                tbody.innerHTML = html;
            }
            // Dropdown de limpeza por categoria (só categorias com agendamentos pendentes)
            const selLimpa = document.getElementById('prev-limpar-categoria');
            if (selLimpa) {
                const contagem = {};
                for (const f of appState.futureTransactions) {
                    if (f.conciliado) continue;
                    const c = f.categoria || 'Não Categorizado';
                    contagem[c] = (contagem[c] || 0) + 1;
                }
                const atual = selLimpa.value;
                selLimpa.innerHTML = '<option value="">-- Categoria --</option>' +
                    Object.keys(contagem).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
                        .map(c => `<option value="${c.replace(/"/g, '&quot;')}">${escapeHtml(c)} (${contagem[c]})</option>`).join('');
                if ([...selLimpa.options].some(o => o.value === atual)) selLimpa.value = atual;
            }

            calcularSaldoAlvo(); calcularSomaCategoriaFuturo();
            safeRun(renderPrevistoRealizado);
            safeRun(renderRecorrencias);
        }


        function salvarLimiteNegativo(valor) {
            const v = parseInt(valor);
            appState.limiteDiasNegativos = (!isNaN(v) && v >= 1 && v <= 31) ? v : 10;
            const el = document.getElementById('prev-limite-negativo');
            if (el) el.value = appState.limiteDiasNegativos;
            saveData();
        }


        function calcularSaldoAlvo() {
            const dtInput = document.getElementById('prev-target-date').value;
            if(!dtInput) { document.getElementById('prev-target-result').innerText = 'R$ 0,00'; return; }
            const tgt = new Date(dtInput + 'T23:59:59'); let sim = getSaldoAtualReal();
            for (let f of appState.futureTransactions) {
                if (f.conciliado) continue;
                if (converterDataBRParaDate(f.data) <= tgt) { if (f.tipo === 'debito') sim -= Number(f.valor)||0; else sim += Number(f.valor)||0; }
            }
            const resEl = document.getElementById('prev-target-result');
            resEl.innerText = formatCurrency(sim); resEl.className = sim >= 0 ? "font-bold text-lg text-white" : "font-bold text-lg text-rose-300";
        }


        function updateFutureCategoriesDropdown() {
            const tipo = document.getElementById('fut-tipo').value;
            const dropdown = document.getElementById('fut-categoria'); if(!dropdown) return; 
            dropdown.innerHTML = '';
            const lista = sortedCats(tipo === 'debito' ? appState.categories.despesas : appState.categories.receitas);
            for (let cat of lista) { const opt = document.createElement('option'); opt.value = cat; opt.innerText = cat; dropdown.appendChild(opt); }
        }


        // ===== Lançamentos recorrentes (UI) =====
        function atualizarCategoriasRec() {
            const tipo = document.getElementById('rec-tipo').value;
            const dd = document.getElementById('rec-categoria'); if (!dd) return;
            const atual = dd.value;
            dd.innerHTML = '';
            for (const c of sortedCats(tipo === 'debito' ? appState.categories.despesas : appState.categories.receitas)) {
                const o = document.createElement('option'); o.value = c; o.innerText = c; dd.appendChild(o);
            }
            if ([...dd.options].some(o => o.value === atual)) dd.value = atual;
        }
        function atualizarCamposFreqRec() {
            const f = document.getElementById('rec-freq').value;
            document.getElementById('rec-campo-dia').classList.toggle('hidden', f === 'semanal');
            document.getElementById('rec-campo-diasemana').classList.toggle('hidden', f !== 'semanal');
            document.getElementById('rec-campo-mes').classList.toggle('hidden', f !== 'anual');
        }
        function salvarRecorrencia() {
            const desc = document.getElementById('rec-desc').value.trim();
            const valor = parseFloat(document.getElementById('rec-valor').value) || 0;
            if (!desc || valor <= 0) { alert("Informe descrição e valor da recorrência."); return; }
            const rec = {
                id: 'rec_' + Date.now(),
                descricao: desc, tipo: document.getElementById('rec-tipo').value,
                categoria: document.getElementById('rec-categoria').value || '',
                valor, freq: document.getElementById('rec-freq').value,
                dia: parseInt(document.getElementById('rec-dia').value) || 1,
                diaSemana: parseInt(document.getElementById('rec-diasemana').value) || 0,
                mesAno: parseInt(document.getElementById('rec-mes').value) || 1,
                inicio: null,
                fim: document.getElementById('rec-fim').value ? ultimoDiaMes(document.getElementById('rec-fim').value) : null,
                ativo: true
            };
            appState.recorrencias.push(rec);
            gerarLancamentosRecorrentes();
            sincronizarParcelasCartao();
            document.getElementById('rec-desc').value = ''; document.getElementById('rec-valor').value = '';
            saveData();
            renderRecorrencias();
            alert(`Recorrência "${desc}" criada — as previsões dos próximos 12 meses já entraram no cronograma.`);
        }
        function toggleRecorrencia(id) {
            const r = appState.recorrencias.find(x => x.id === id); if (!r) return;
            r.ativo = !r.ativo;
            gerarLancamentosRecorrentes();
            sincronizarParcelasCartao();
            saveData(); renderRecorrencias();
        }
        function excluirRecorrencia(id) {
            const r = appState.recorrencias.find(x => x.id === id); if (!r) return;
            if (!confirm(`Excluir a recorrência "${r.descricao}"?\nAs previsões futuras dela (não conciliadas) serão removidas do cronograma.`)) return;
            appState.recorrencias = appState.recorrencias.filter(x => x.id !== id);
            gerarLancamentosRecorrentes();
            sincronizarParcelasCartao();
            saveData(); renderRecorrencias();
        }
        function renderRecorrencias() {
            const cont = document.getElementById('lista-recorrencias');
            if (!cont) return;
            atualizarCategoriasRec();
            const recs = appState.recorrencias || [];
            if (!recs.length) { cont.innerHTML = '<p class="text-xs text-slate-400">Nenhuma recorrência cadastrada.</p>'; return; }
            const nomeFreq = (r) => r.freq === 'semanal' ? `toda ${['dom','seg','ter','qua','qui','sex','sáb'][r.diaSemana]}`
                : r.freq === 'anual' ? `todo ano em ${String(r.dia).padStart(2,'0')}/${String(r.mesAno).padStart(2,'0')}`
                : `todo dia ${r.dia}`;
            let html = '';
            for (const r of recs) {
                const cor = r.tipo === 'debito' ? 'text-rose-600' : 'text-emerald-600';
                html += `
                    <div class="flex flex-wrap items-center justify-between gap-2 border border-slate-100 rounded-lg px-3 py-2 ${r.ativo ? '' : 'opacity-50'}">
                        <div class="min-w-0">
                            <span class="text-sm font-medium text-slate-700">${escapeHtml(r.descricao)}</span>
                            <span class="text-xs ${cor} font-semibold ml-1">${r.tipo === 'debito' ? '-' : '+'} ${formatCurrency(r.valor)}</span>
                            <span class="block text-[11px] text-slate-400">${escapeHtml(r.categoria || 'Sem categoria')} · ${nomeFreq(r)}${r.fim ? ` · até ${String(r.fim).split('-').reverse().join('/')}` : ''}</span>
                        </div>
                        <div class="flex gap-1">
                            <button onclick="toggleRecorrencia('${r.id}')" title="${r.ativo ? 'Pausar' : 'Reativar'}" class="text-xs border rounded px-2 py-1 ${r.ativo ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'} bg-white">${r.ativo ? '⏸' : '▶'}</button>
                            <button onclick="excluirRecorrencia('${r.id}')" title="Excluir" class="text-xs border rounded px-2 py-1 text-rose-500 hover:bg-rose-50 bg-white">🗑️</button>
                        </div>
                    </div>`;
            }
            cont.innerHTML = html;
        }

        function updateFutureInvestimentoDropdown() {
            const dropdown = document.getElementById('fut-investimento'); if(!dropdown) return;
            const atual = dropdown.value;
            dropdown.innerHTML = '<option value="">-- Não refletir --</option>';
            for (let inv of (appState.investimentos || [])) {
                const opt = document.createElement('option');
                opt.value = inv.id;
                opt.innerText = `${inv.nome} (${inv.banco})`;
                dropdown.appendChild(opt);
            }
            if ([...dropdown.options].some(o => o.value === atual)) dropdown.value = atual;
        }


        function cancelEditFuture() {
            editingFutureId = null; document.getElementById('futureForm').reset();
            document.getElementById('editing-badge').classList.add('hidden');
            const btn = document.getElementById('btn-submit-futuro'); btn.innerText = "Agendar"; 
            btn.className = "w-full bg-indigo-600 text-white rounded-md p-2 text-sm font-bold hover:bg-indigo-700 transition";
            document.getElementById('btn-cancelar-edicao').classList.add('hidden'); updateFutureCategoriesDropdown();
        }


        function editFutureTransaction(id) {
            const item = appState.futureTransactions.find(f => f.id === id); if(!item) return;
            const [d, m, y] = item.data.split('/');
            document.getElementById('fut-data').value = `${y}-${m}-${d}`; document.getElementById('fut-descricao').value = item.descricao;
            document.getElementById('fut-tipo').value = item.tipo; updateFutureCategoriesDropdown(); 
            document.getElementById('fut-categoria').value = item.categoria; document.getElementById('fut-valor').value = item.valor;
            updateFutureInvestimentoDropdown();
            const invSel = document.getElementById('fut-investimento'); if(invSel) invSel.value = item.investimentoId || '';
            editingFutureId = id; document.getElementById('editing-badge').classList.remove('hidden');
            const btn = document.getElementById('btn-submit-futuro'); btn.innerText = "Salvar Editado"; 
            btn.className = "w-full bg-emerald-600 text-white rounded-md p-2 text-sm font-bold hover:bg-emerald-700 transition";
            document.getElementById('btn-cancelar-edicao').classList.remove('hidden');
            const det = document.getElementById('details-previsao'); if (det) det.open = true;
            det ? det.scrollIntoView({behavior: 'smooth', block: 'center'}) : null;
        }


        function repeatFutureTransaction(id) {
            const item = appState.futureTransactions.find(f => f.id === id); if(!item) return;
            const qtd = parseInt(prompt(`Repetir o lançamento "${item.descricao}" por quantos meses?`, "1"));
            if(isNaN(qtd) || qtd <= 0) return;
            let [dd, mm, yyyy] = item.data.split('/').map(Number);
            for(let i = 1; i <= qtd; i++) {
                let nData = new Date(yyyy, mm - 1 + i, dd);
                const novo = {
                    id: 'fut_' + Date.now() + '_' + i,
                    data: `${String(nData.getDate()).padStart(2,'0')}/${String(nData.getMonth()+1).padStart(2,'0')}/${nData.getFullYear()}`,
                    descricao: item.descricao, tipo: item.tipo, valor: item.valor, categoria: item.categoria,
                    investimentoId: item.investimentoId || ''
                };
                if (novo.investimentoId) aplicarReflexoInvestimento(novo);
                appState.futureTransactions.push(novo);
            }
            saveData(); alert(`${qtd} repetições geradas.`);
        }


        function addFutureTransaction(e) {
            e.preventDefault();
            const dIn = document.getElementById('fut-data').value.split('-'); const dFmt = `${dIn[2]}/${dIn[1]}/${dIn[0]}`;
            const invSel = document.getElementById('fut-investimento');
            const obj = {
                id: editingFutureId || 'fut_' + Date.now(), data: dFmt,
                descricao: document.getElementById('fut-descricao').value, tipo: document.getElementById('fut-tipo').value,
                valor: parseFloat(document.getElementById('fut-valor').value), categoria: document.getElementById('fut-categoria').value,
                investimentoId: invSel ? (invSel.value || '') : ''
            };
            if (editingFutureId) {
                const idx = appState.futureTransactions.findIndex(f => f.id === editingFutureId);
                if(idx !== -1) {
                    reverterReflexoInvestimento(appState.futureTransactions[idx]);
                    appState.futureTransactions[idx] = obj;
                    if (obj.investimentoId) aplicarReflexoInvestimento(obj);
                }
                cancelEditFuture();
            } else {
                if (obj.investimentoId) aplicarReflexoInvestimento(obj);
                appState.futureTransactions.push(obj);
                document.getElementById('futureForm').reset(); updateFutureCategoriesDropdown();
            }
            saveData();
        }


        function deleteFutureTransaction(id) {
            if(confirm("Apagar este lançamento agendado?")) {
                const item = appState.futureTransactions.find(f => f.id === id);
                if (item) reverterReflexoInvestimento(item);
                appState.futureTransactions = appState.futureTransactions.filter(f => f.id !== id);
                saveData();
            }
        }


        // ===== Previsto × Realizado =====

        // Efetiva (concilia) uma previsão: registra o valor que realmente caiu no banco.
        // A previsão sai do cronograma/simulador e passa a aparecer no painel Previsto × Realizado.
        function efetivarPrevisao(id) {
            const item = appState.futureTransactions.find(f => f.id === id); if(!item) return;
            const resp = prompt(`Valor realmente ${item.tipo === 'debito' ? 'pago' : 'recebido'} de "${item.descricao}"\n(previsto: ${formatCurrency(item.valor)}):`, Number(item.valor).toFixed(2));
            if (resp === null) return;
            let v = String(resp).trim().replace(/[R$\s]/g, '');
            if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
            const num = parseFloat(v);
            if (isNaN(num) || num < 0) { alert("Valor inválido."); return; }
            item.conciliado = true;
            item.realizado = num;
            const hj = new Date();
            item.dataConciliacao = `${String(hj.getDate()).padStart(2,'0')}/${String(hj.getMonth()+1).padStart(2,'0')}/${hj.getFullYear()}`;
            // Conversa com a Quitação: trava o mês na Projeção e re-ancora os meses
            // seguintes (só os ainda não realizados são regenerados na Previsão/Investimento)
            sincronizarCompraApos(item);
            saveData();
        }


        function desfazerConciliacao(id) {
            const item = appState.futureTransactions.find(f => f.id === id); if(!item) return;
            if (!confirm(`Desfazer a efetivação de "${item.descricao}"? Ela voltará ao cronograma como pendente.`)) return;
            delete item.conciliado; delete item.realizado; delete item.dataConciliacao;
            sincronizarCompraApos(item);
            saveData();
        }


        function renderPrevistoRealizado() {
            const tbody = document.getElementById('lista-previsto-realizado'); if(!tbody) return;
            const filtroEl = document.getElementById('pr-month-filter');
            let filtro = filtroEl ? filtroEl.value : '';
            if (!filtro) {
                const t = new Date();
                filtro = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}`;
                if (filtroEl) filtroEl.value = filtro;
            }
            const [fy, fm] = filtro.split('-').map(Number);
            const filtroNum = fy * 12 + fm;

            const itens = appState.futureTransactions.filter(f => f.conciliado && mesAnoNum(f.data) === filtroNum);
            itens.sort((a,b) => converterDataBRParaDate(a.data) - converterDataBRParaDate(b.data));

            const cards = document.getElementById('pr-cards');
            const porCat = document.getElementById('pr-por-categoria');
            if (itens.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400">Nenhuma previsão efetivada neste mês. Use o botão ✔ no cronograma acima.</td></tr>`;
                if (cards) cards.innerHTML = '';
                if (porCat) porCat.innerHTML = '';
                return;
            }

            let html = '';
            let prevDeb = 0, realDeb = 0, prevCred = 0, realCred = 0, difTotal = 0;
            const mapaCat = {};
            for (let f of itens) {
                const isDeb = f.tipo === 'debito';
                const prev = Number(f.valor) || 0, real = Number(f.realizado) || 0;
                const dif = diferencaConciliacao(f);
                difTotal += dif;
                if (isDeb) { prevDeb += prev; realDeb += real; } else { prevCred += prev; realCred += real; }
                const c = f.categoria || 'Não Categorizado';
                if (!mapaCat[c]) mapaCat[c] = { prev: 0, real: 0, dif: 0 };
                mapaCat[c].prev += prev; mapaCat[c].real += real; mapaCat[c].dif += dif;

                const corDif = dif > 0 ? 'text-emerald-600' : (dif < 0 ? 'text-rose-600' : 'text-slate-400');
                html += `
                    <tr class="hover:bg-slate-50 transition">
                        <td class="p-3 font-semibold text-slate-600 whitespace-nowrap">${f.data}<span class="block text-[10px] font-normal text-slate-400">efetivada ${f.dataConciliacao || ''}</span></td>
                        <td class="p-3 text-slate-800 font-medium">${escapeHtml(f.descricao)} <span class="text-[10px] ${isDeb ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'} px-1.5 py-0.5 rounded font-bold">${isDeb ? 'Saída' : 'Entrada'}</span></td>
                        <td class="p-3"><span class="text-[11px] bg-white border border-slate-200 px-2 py-1 rounded text-slate-600">${escapeHtml(f.categoria)}</span></td>
                        <td class="p-3 text-right whitespace-nowrap text-slate-500">${formatCurrency(prev)}</td>
                        <td class="p-3 text-right whitespace-nowrap font-bold ${isDeb ? 'text-rose-600' : 'text-emerald-600'}">${formatCurrency(real)}</td>
                        <td class="p-3 text-right whitespace-nowrap font-bold ${corDif}">${dif > 0 ? '+' : ''}${formatCurrency(dif)}</td>
                        <td class="p-3 text-center whitespace-nowrap">
                            <button onclick="desfazerConciliacao('${f.id}')" title="Desfazer: volta ao cronograma como pendente" class="text-sky-500 hover:bg-sky-50 bg-white border p-1 rounded transition">↩️</button>
                            <button onclick="deleteFutureTransaction('${f.id}')" title="Excluir definitivamente" class="text-rose-500 hover:bg-rose-50 bg-white border p-1 rounded transition">🗑️</button>
                        </td>
                    </tr>`;
            }
            tbody.innerHTML = html;

            if (cards) {
                const corDifT = difTotal > 0 ? 'text-emerald-600' : (difTotal < 0 ? 'text-rose-600' : 'text-slate-500');
                cards.innerHTML = `
                    <div class="bg-rose-50 p-4 rounded-xl border border-rose-100">
                        <p class="text-xs font-semibold text-rose-500 uppercase">Saídas</p>
                        <p class="text-sm text-slate-500 mt-1">Previsto: <b>${formatCurrency(prevDeb)}</b></p>
                        <p class="text-sm text-slate-500">Realizado: <b class="text-rose-600">${formatCurrency(realDeb)}</b></p>
                    </div>
                    <div class="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                        <p class="text-xs font-semibold text-emerald-600 uppercase">Entradas</p>
                        <p class="text-sm text-slate-500 mt-1">Previsto: <b>${formatCurrency(prevCred)}</b></p>
                        <p class="text-sm text-slate-500">Realizado: <b class="text-emerald-600">${formatCurrency(realCred)}</b></p>
                    </div>
                    <div class="bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <p class="text-xs font-semibold text-slate-500 uppercase">Diferença Total</p>
                        <p class="text-2xl font-bold mt-1 ${corDifT}">${difTotal > 0 ? '+' : ''}${formatCurrency(difTotal)}</p>
                        <p class="text-[10px] text-slate-400">Positiva = melhor que o previsto</p>
                    </div>`;
            }

            if (porCat) {
                let chips = '';
                const catsOrdenadas = Object.keys(mapaCat).sort((a,b) => mapaCat[a].dif - mapaCat[b].dif);
                for (let c of catsOrdenadas) {
                    const m = mapaCat[c];
                    const cor = m.dif > 0 ? 'text-emerald-600' : (m.dif < 0 ? 'text-rose-600' : 'text-slate-400');
                    chips += `
                        <div class="flex justify-between items-center gap-2 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-sm">
                            <span class="font-medium text-slate-600 truncate">${escapeHtml(c)}</span>
                            <span class="whitespace-nowrap text-xs text-slate-500">${formatCurrency(m.prev)} → ${formatCurrency(m.real)} <b class="${cor}">(${m.dif > 0 ? '+' : ''}${formatCurrency(m.dif)})</b></span>
                        </div>`;
                }
                porCat.innerHTML = `<p class="text-xs font-bold text-slate-500 uppercase mb-2">Resumo por categoria</p><div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">${chips}</div>`;
            }
        }


        function renderParcelamentosFuturos() {
            const cont = document.getElementById('lista-parcelamentos');
            const totalEl = document.getElementById('parc-total-futuro');
            if (!cont) return;
            const porMes = calcularParcelamentosFuturos(cartaoSelecionadoId);
            const meses = Object.keys(porMes).map(Number).sort((a,b) => a - b);
            if (meses.length === 0) {
                cont.innerHTML = `<p class="text-sm text-slate-400">Nenhum parcelamento futuro identificado nas faturas importadas.</p>`;
                if (totalEl) totalEl.innerText = formatCurrency(0);
                return;
            }
            let totalGeral = 0, html = '';
            for (let n of meses) {
                const itens = porMes[n].sort((a,b) => b.valor - a.valor);
                const totalMes = itens.reduce((s, i) => s + i.valor, 0);
                totalGeral += totalMes;
                const y = Math.floor((n - 1) / 12), mm = ((n - 1) % 12) + 1;
                const rotulo = `${String(mm).padStart(2,'0')}/${y}`;
                let linhas = '';
                for (let it of itens) {
                    linhas += `
                        <li class="flex justify-between items-center px-4 py-1.5">
                            <span class="text-slate-600 truncate mr-2">${escapeHtml(it.desc)} <span class="text-[10px] text-slate-400 whitespace-nowrap">(parcela ${it.parcela}/${it.total})</span></span>
                            <span class="text-rose-600 font-medium whitespace-nowrap">${formatCurrency(it.valor)}</span>
                        </li>`;
                }
                html += `
                    <details class="border border-slate-100 rounded-lg overflow-hidden">
                        <summary class="flex justify-between items-center bg-slate-50 hover:bg-slate-100 px-4 py-2.5 cursor-pointer select-none">
                            <span class="font-bold text-slate-700 text-sm">📅 ${rotulo} <span class="font-normal text-xs text-slate-400">(${itens.length} parcela${itens.length > 1 ? 's' : ''})</span></span>
                            <span class="font-bold text-rose-600 text-sm">${formatCurrency(totalMes)}</span>
                        </summary>
                        <ul class="divide-y divide-slate-50 text-sm bg-white">${linhas}</ul>
                    </details>`;
            }
            cont.innerHTML = html;
            if (totalEl) totalEl.innerText = formatCurrency(totalGeral);
        }


        function adicionarFonteQuitacao() {
            const sel = document.getElementById('qp-add-investimento');
            const inv = appState.investimentos.find(i => i.id === sel.value);
            if (!inv) { alert("Cadastre/selecione um investimento primeiro."); return; }
            if (fontesQuitacao.some(f => f.investimentoId === inv.id)) return;
            fontesQuitacao.push({
                investimentoId: inv.id,
                taxa: taxaInvestimentoAtual(inv),
                saldo: Math.round(saldoAtualInvestimento(inv) * 100) / 100
            });
            renderFontesQuitacao(); renderSimulacaoQuitacao();
        }


        function removerFonteQuitacao(i) { fontesQuitacao.splice(i, 1); renderFontesQuitacao(); renderSimulacaoQuitacao(); }


        function moverFonteQuitacao(i, delta) {
            const j = i + delta;
            if (j < 0 || j >= fontesQuitacao.length) return;
            [fontesQuitacao[i], fontesQuitacao[j]] = [fontesQuitacao[j], fontesQuitacao[i]];
            renderFontesQuitacao(); renderSimulacaoQuitacao();
        }


        function atualizarFonteQuitacao(i, campo, valor) {
            if (!fontesQuitacao[i]) return;
            fontesQuitacao[i][campo] = parseFloat(valor) || 0;
            debouncedSimularQuitacao();
        }


        function renderFontesQuitacao() {
            const cont = document.getElementById('qp-fontes');
            const selAdd = document.getElementById('qp-add-investimento');
            if (!cont || !selAdd) return;
            // dropdown só com investimentos ainda não usados
            selAdd.innerHTML = '';
            const disponiveis = (appState.investimentos || []).filter(inv => !fontesQuitacao.some(f => f.investimentoId === inv.id));
            if (!disponiveis.length) {
                selAdd.innerHTML = '<option value="">-- sem investimentos disponíveis --</option>';
            } else {
                for (const inv of disponiveis) {
                    const opt = document.createElement('option');
                    opt.value = inv.id;
                    opt.innerText = `${inv.nome} (${inv.banco}) — ${formatCurrency(saldoAtualInvestimento(inv))}`;
                    selAdd.appendChild(opt);
                }
            }
            if (!fontesQuitacao.length) {
                cont.innerHTML = '<p class="text-xs text-slate-400">Nenhuma fonte adicionada (opcional). Sem fontes, a efetivação lança <b>apenas as parcelas</b> na 📅 Previsão, sem resgates de investimento.</p>';
                return;
            }
            let html = '';
            for (let i = 0; i < fontesQuitacao.length; i++) {
                const f = fontesQuitacao[i];
                const inv = appState.investimentos.find(x => x.id === f.investimentoId);
                const nome = inv ? `${inv.nome} (${inv.banco})` : '(investimento removido)';
                html += `
                    <div class="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
                        <span class="w-6 h-6 flex items-center justify-center bg-indigo-600 text-white rounded-full text-xs font-bold shrink-0">${i + 1}º</span>
                        <span class="font-medium text-sm text-slate-700 flex-1 min-w-[130px] truncate">${escapeHtml(nome)}</span>
                        <label class="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">Saldo (R$)
                            <input type="number" step="0.01" value="${f.saldo}" onchange="atualizarFonteQuitacao(${i}, 'saldo', this.value)" class="w-28 text-sm font-normal border border-slate-200 rounded-md p-1.5 text-right outline-none focus:ring-1 focus:ring-indigo-500">
                        </label>
                        <label class="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">Rend. % a.a.
                            <input type="number" step="0.01" value="${f.taxa}" onchange="atualizarFonteQuitacao(${i}, 'taxa', this.value)" class="w-20 text-sm font-normal border border-slate-200 rounded-md p-1.5 text-right outline-none focus:ring-1 focus:ring-indigo-500">
                        </label>
                        <div class="flex gap-1">
                            <button onclick="moverFonteQuitacao(${i}, -1)" title="Usar antes" class="text-indigo-500 hover:bg-indigo-50 bg-white border p-1 rounded transition text-xs font-bold ${i === 0 ? 'opacity-30' : ''}">↑</button>
                            <button onclick="moverFonteQuitacao(${i}, 1)" title="Usar depois" class="text-indigo-500 hover:bg-indigo-50 bg-white border p-1 rounded transition text-xs font-bold ${i === fontesQuitacao.length - 1 ? 'opacity-30' : ''}">↓</button>
                            <button onclick="removerFonteQuitacao(${i})" title="Remover fonte" class="text-rose-500 hover:bg-rose-50 bg-white border p-1 rounded transition text-xs font-bold">✕</button>
                        </div>
                    </div>`;
            }
            cont.innerHTML = html;
        }


        function lerFormCompra() {
            const total = parseInt(document.getElementById('qp-total').value) || 0;
            const pagas = parseInt(document.getElementById('qp-pagas').value) || 0;
            return {
                nome: document.getElementById('qp-nome').value.trim(),
                valorParcela: parseFloat(document.getElementById('qp-parcela').value) || 0,
                total, pagas,
                restantes: Math.max(0, total - pagas),
                taxaIndexador: parseFloat(document.getElementById('qp-indexador').value) || 0,
                mesPrimeira: document.getElementById('qp-mes-primeira').value,
                dia: Math.min(31, Math.max(1, parseInt(document.getElementById('qp-dia').value) || 10)),
                fontes: fontesQuitacao.map(f => ({ ...f })),
                taxasMes: { ...taxasMesQuitacao },
                aportesMes: { ...aportesMesQuitacao },
                aporte: parseFloat(document.getElementById('qp-aporte').value) || 0,
                categoria: document.getElementById('qp-categoria').value
            };
        }


        // Sobrescreve (ou limpa, se vazio/igual ao padrão) a correção de um mês.
        function definirTaxaMesQuitacao(nAbs, valor) {
            const v = parseFloat(valor);
            const padrao = parseFloat(document.getElementById('qp-indexador').value) || 0;
            if (isNaN(v) || v === padrao) delete taxasMesQuitacao[nAbs];
            else taxasMesQuitacao[nAbs] = v;
            aplicarEdicaoProjecao();
        }

        // Sobrescreve (ou limpa) o aporte de um mês específico.
        function definirAporteMesQuitacao(nAbs, valor) {
            const v = parseFloat(valor);
            const padrao = parseFloat(document.getElementById('qp-aporte').value) || 0;
            if (valor === '' || isNaN(v) || v === padrao) delete aportesMesQuitacao[nAbs];
            else aportesMesQuitacao[nAbs] = v;
            aplicarEdicaoProjecao();
        }

        // Após editar correção/aporte de um mês: se a compra já foi efetivada, propaga
        // para os lançamentos da Previsão/Investimento (meses travados intactos); senão
        // apenas recalcula a simulação.
        function aplicarEdicaoProjecao() {
            const compra = appState.comprasParceladas.find(c => c.id === compraQuitacaoId);
            if (compra && compra.status === 'efetivada') {
                compra.taxasMes = { ...taxasMesQuitacao };
                compra.aportesMes = { ...aportesMesQuitacao };
                aplicarLancamentosCompra(compra);
                updateFutureCategoriesDropdown(); updatePrevSumDropdown();
                saveData();
            } else {
                renderSimulacaoQuitacao();
            }
        }


        function renderSimulacaoQuitacao() {
            const res = document.getElementById('quitacao-resultado');
            if (!res) return;
            const compraAtual = appState.comprasParceladas.find(c => c.id === compraQuitacaoId);
            const efetivada = compraAtual && compraAtual.status === 'efetivada';
            const p = efetivada ? planoDaCompra(compraAtual) : lerFormCompra();
            if (!p.valorParcela || !p.restantes || !p.mesPrimeira) { res.classList.add('hidden'); return; }
            res.classList.remove('hidden');

            const nota = document.getElementById('quitacao-tabela-nota');
            if (nota) nota.innerHTML = efetivada
                ? 'Edite <b>Correção</b> e <b>Aporte</b> dos meses ainda não realizados — as mudanças vão para a 📅 Previsão e o 📈 Investimento. Meses conciliados (✔ na Previsão) ficam 🔒 travados com o valor realizado.'
                : 'Edite <b>Correção</b> e <b>Aporte</b> de cada mês; a projeção recalcula em cascata.';

            const semFontes = !p.fontes.length;
            const sim = simularQuitacao(p);
            const aporteMin = aporteMinimoQuitacao(p);
            const nomesOrdem = p.fontes.map((f, i) => `${i + 1}º ${escapeHtml(nomeCurtoInvestimento(f.investimentoId))}`).join(' → ');

            const ver = document.getElementById('quitacao-veredicto');
            if (semFontes) {
                ver.className = "p-5 rounded-xl border text-base font-bold bg-indigo-50 border-indigo-200 text-indigo-800";
                ver.innerHTML = `ℹ️ Compra <b>sem investimento vinculado</b>: ao efetivar, apenas as <b>${p.restantes} parcelas</b> serão lançadas na 📅 Previsão (sem resgates nem aportes). Ajuste a correção mês a mês na tabela abaixo, se precisar.`;
            } else if (sim.quita) {
                ver.className = "p-5 rounded-xl border text-base font-bold bg-emerald-50 border-emerald-200 text-emerald-800";
                ver.innerHTML = `✅ As fontes (${nomesOrdem}) ${p.aporte > 0 ? `com aporte de ${formatCurrency(p.aporte)}/mês ` : ''}cobrem as <b>${p.restantes} parcelas restantes</b> — sobra projetada de <b>${formatCurrency(sim.sobraFinal)}</b> ao final.`;
            } else {
                ver.className = "p-5 rounded-xl border text-base font-bold bg-rose-50 border-rose-200 text-rose-800";
                ver.innerHTML = `⚠️ As fontes (${nomesOrdem}) esgotam na <b>parcela ${p.pagas + sim.quebraEm + 1} de ${p.total}</b>. Aporte mensal necessário para quitar tudo: <b>${formatCurrency(aporteMin)}</b>.`;
            }

            const cards = document.getElementById('quitacao-cards');
            const somaSaldos = p.fontes.reduce((a, f) => a + (Number(f.saldo) || 0), 0);
            const taxaMedia = somaSaldos > 0 ? p.fontes.reduce((a, f) => a + (Number(f.taxa) || 0) * (Number(f.saldo) || 0), 0) / somaSaldos : 0;
            const rotuloComparativo = taxaMedia > p.taxaIndexador
                ? `Rendimento médio das fontes (${taxaMedia.toFixed(1)}% a.a.) supera o indexador (${p.taxaIndexador}% a.a.): manter aplicado e pagar mês a mês tende a ser melhor que quitar à vista.`
                : `O indexador (${p.taxaIndexador}% a.a.) corre acima do rendimento médio das fontes (${taxaMedia.toFixed(1)}% a.a.): avalie antecipar/quitar as parcelas.`;
            cards.innerHTML = `
                <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                    <p class="text-xs font-semibold text-slate-500 uppercase">Parcelas restantes</p>
                    <p class="text-2xl font-bold text-slate-700 mt-1">${p.restantes}</p>
                    <p class="text-[10px] text-slate-400 mt-1">de ${p.total} (${p.pagas} pagas)</p>
                </div>
                <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                    <p class="text-xs font-semibold text-rose-500 uppercase">Total corrigido a pagar</p>
                    <p class="text-2xl font-bold text-rose-600 mt-1">${formatCurrency(sim.totalParcelas)}</p>
                    <p class="text-[10px] text-slate-400 mt-1">indexador padrão ${p.taxaIndexador}% a.a.${Object.keys(p.taxasMes).length ? ` + ${Object.keys(p.taxasMes).length} mês(es) com taxa ajustada` : ''}</p>
                </div>` + (semFontes ? '' : `
                <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                    <p class="text-xs font-semibold text-emerald-600 uppercase">Aporte mínimo</p>
                    <p class="text-2xl font-bold text-emerald-600 mt-1">${formatCurrency(aporteMin)}</p>
                    <p class="text-[10px] text-slate-400 mt-1">por mês, para quitar sem faltar saldo</p>
                </div>
                <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                    <p class="text-xs font-semibold text-indigo-500 uppercase">Quitar × manter aplicado</p>
                    <p class="text-xs text-slate-600 mt-2">${rotuloComparativo}</p>
                </div>`);

            // Cabeçalho dinâmico: coluna de correção editável por mês e, se houver
            // fontes, uma coluna de saldo por investimento na ordem de uso
            const head = document.getElementById('quitacao-tabela-head');
            head.innerHTML = `
                <th class="p-3 whitespace-nowrap">Parcela</th>
                <th class="p-3 whitespace-nowrap">Vencimento</th>
                <th class="p-3 text-right whitespace-nowrap" title="Correção aplicada NA parcela deste mês. O valor padrão vem do Indexador (% a.a.); ajuste aqui quando a taxa real do mês for diferente — os meses seguintes continuam no padrão.">Correção (% a.a.)</th>
                <th class="p-3 text-right whitespace-nowrap">Parcela corrigida</th>
                ${semFontes ? '' : `
                <th class="p-3 text-right whitespace-nowrap">Rendimento</th>
                <th class="p-3 text-right whitespace-nowrap">Aporte</th>
                ${p.fontes.map((f, i) => `<th class="p-3 text-right whitespace-nowrap">${i + 1}º ${escapeHtml(nomeCurtoInvestimento(f.investimentoId))}</th>`).join('')}
                <th class="p-3 text-right whitespace-nowrap">Saldo total</th>`}`;

            const tbody = document.getElementById('quitacao-tabela');
            let html = '';
            for (const l of sim.linhas) {
                const corSaldo = l.saldoTotal >= 0 ? 'text-indigo-600' : 'text-rose-600';
                const nAbs = l.nAbs;
                const dis = l.locked ? 'disabled' : '';
                const ajustadaTx = p.taxasMes[nAbs] !== undefined;
                const celTaxa = l.k === 0
                    ? `<td class="p-2 text-right text-slate-300" title="A 1ª parcela restante é o valor informado no formulário, sem correção">—</td>`
                    : `<td class="p-2 text-right whitespace-nowrap">
                        <input type="number" step="0.01" value="${l.taxaCorrecao}" ${dis} onchange="definirTaxaMesQuitacao(${nAbs}, this.value)" title="${ajustadaTx ? 'Taxa ajustada deste mês (apague ou iguale ao padrão para voltar)' : 'Padrão do indexador — edite se a taxa real deste mês for diferente'}" class="w-20 text-sm border ${l.locked ? 'border-slate-100 bg-slate-50 text-slate-400' : (ajustadaTx ? 'border-amber-400 bg-amber-50 font-bold text-amber-700' : 'border-slate-200 text-slate-500')} rounded-md p-1 text-right outline-none focus:ring-1 focus:ring-indigo-500">
                       </td>`;
                const ajustadoAp = p.aportesMes[nAbs] !== undefined;
                const celAporte = `<td class="p-2 text-right whitespace-nowrap">
                        <input type="number" step="0.01" min="0" value="${l.aporte ? l.aporte : ''}" placeholder="0" ${dis} onchange="definirAporteMesQuitacao(${nAbs}, this.value)" title="${ajustadoAp ? 'Aporte ajustado deste mês' : 'Aporte padrão — edite para este mês'}" class="w-24 text-sm border ${l.locked ? 'border-slate-100 bg-slate-50 text-slate-400' : (ajustadoAp ? 'border-amber-400 bg-amber-50 font-bold text-amber-700' : 'border-slate-200 text-slate-500')} rounded-md p-1 text-right outline-none focus:ring-1 focus:ring-emerald-500">
                       </td>`;
                const celulasFontes = semFontes ? '' : l.saldos.map((s, fi) => {
                    const resgate = l.resgates.find(r => r.fi === fi);
                    return `<td class="p-3 text-right whitespace-nowrap ${s > 0.004 ? 'text-slate-600' : 'text-slate-300'}">
                        ${formatCurrency(s)}
                        ${resgate ? `<span class="block text-[10px] text-rose-500">− ${formatCurrency(resgate.valor)}</span>` : ''}
                    </td>`;
                }).join('');
                const rowCls = l.locked ? 'bg-emerald-50/70' : (!semFontes && l.falta > 0 ? 'bg-rose-50' : 'hover:bg-slate-50');
                html += `
                    <tr class="${rowCls}">
                        <td class="p-3 font-semibold text-slate-600 whitespace-nowrap">${l.locked ? '🔒 ' : ''}${nAbs}/${p.total}</td>
                        <td class="p-3 whitespace-nowrap">${dataParcelaQuitacao(p.mesPrimeira, p.dia, l.k)}</td>
                        ${celTaxa}
                        <td class="p-3 text-right whitespace-nowrap font-medium ${l.locked ? 'text-emerald-700' : 'text-rose-600'}">${formatCurrency(l.parcela)}${l.locked ? '<span class="block text-[10px] text-emerald-600 font-normal">realizada</span>' : ''}</td>
                        ${semFontes ? '' : `
                        <td class="p-3 text-right whitespace-nowrap text-emerald-600">${formatCurrency(l.rendimento)}</td>
                        ${celAporte}
                        ${celulasFontes}
                        <td class="p-3 text-right whitespace-nowrap font-bold ${corSaldo}">${formatCurrency(l.saldoTotal)}</td>`}
                    </tr>`;
            }
            tbody.innerHTML = html;

            try {
                const ctx = document.getElementById('chartQuitacao');
                if (ctx) {
                    const labels = sim.linhas.map(l => dataParcelaQuitacao(p.mesPrimeira, p.dia, l.k).substring(3));
                    const coresFontes = ['#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#64748b'];
                    const datasetsFontes = p.fontes.map((f, fi) => ({
                        label: `${fi + 1}º ${nomeCurtoInvestimento(f.investimentoId)}`,
                        data: sim.linhas.map(l => Math.max(0, l.saldos[fi])),
                        type: 'line', borderColor: coresFontes[fi % coresFontes.length], backgroundColor: coresFontes[fi % coresFontes.length],
                        borderWidth: 1.5, borderDash: [5, 3], pointRadius: 0, tension: 0.3, order: 1
                    }));
                    if (quitacaoChartInstance) quitacaoChartInstance.destroy();
                    quitacaoChartInstance = new Chart(ctx.getContext('2d'), {
                        type: 'bar',
                        data: {
                            labels,
                            datasets: [
                                { label: 'Parcela corrigida', data: sim.linhas.map(l => l.parcela), backgroundColor: 'rgba(244, 63, 94, 0.6)', borderRadius: 3, order: 2 },
                                ...(semFontes ? [] : [{ label: 'Saldo total', data: sim.linhas.map(l => l.saldoTotal), type: 'line', borderColor: '#4f46e5', backgroundColor: '#4f46e5', borderWidth: 2, pointRadius: 3, tension: 0.3, order: 1 }]),
                                ...datasetsFontes
                            ]
                        },
                        options: {
                            responsive: true, maintainAspectRatio: false,
                            interaction: { mode: 'index', intersect: false },
                            plugins: {
                                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
                                tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatCurrency(c.parsed.y)}` } }
                            },
                            scales: {
                                x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                                y: { ticks: { font: { size: 10 }, callback: (v) => formatCurrencyNumber(v) } }
                            }
                        }
                    });
                }
            } catch (e) {}
        }


        function usarAporteMinimo() {
            const p = lerFormCompra();
            if (!p.valorParcela || !p.restantes || !p.fontes.length) return;
            document.getElementById('qp-aporte').value = aporteMinimoQuitacao(p).toFixed(2);
            renderSimulacaoQuitacao();
        }


        function renderQuitacao() {
            if (!document.getElementById('qp-fontes')) return;
            renderFontesQuitacao();

            const selCat = document.getElementById('qp-categoria');
            const catAtual = selCat.value;
            selCat.innerHTML = '<option value="__nova__">➕ Criar categoria com o nome da compra</option>';
            for (const c of sortedCats(appState.categories.despesas)) {
                const opt = document.createElement('option'); opt.value = c; opt.innerText = c; selCat.appendChild(opt);
            }
            if ([...selCat.options].some(o => o.value === catAtual)) selCat.value = catAtual;

            if (!document.getElementById('qp-mes-primeira').value) {
                const t = new Date();
                document.getElementById('qp-mes-primeira').value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
            }

            renderListaComprasParceladas();
            atualizarBotoesCompra();
            renderSimulacaoQuitacao();
        }


        function renderListaComprasParceladas() {
            const cont = document.getElementById('lista-compras-parceladas');
            if (!cont) return;
            if (!appState.comprasParceladas.length) {
                cont.innerHTML = '<p class="text-xs text-slate-400">Nenhuma compra cadastrada ainda. Preencha o formulário abaixo e clique em 💾 Salvar compra.</p>';
                return;
            }
            let html = '';
            for (const c of appState.comprasParceladas) {
                const ativa = c.id === compraQuitacaoId;
                const badge = c.status === 'efetivada'
                    ? '<span class="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">EFETIVADA</span>'
                    : '<span class="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-bold">SIMULAÇÃO</span>';
                html += `
                    <button onclick="carregarCompraParcelada('${c.id}')" class="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition ${ativa ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}">
                        ${escapeHtml(c.nome)} ${badge}
                        <span class="text-[10px] ${ativa ? 'text-indigo-200' : 'text-slate-400'}">${Math.max(0, c.total - c.pagas)} de ${c.total} restantes</span>
                    </button>`;
            }
            cont.innerHTML = html;
        }


        // Habilita/desabilita o formulário de cadastro (topo). Quando a compra está
        // efetivada, o topo fica travado e a edição acontece só na Projeção mês a mês;
        // os botões Desfazer/Excluir continuam ativos.
        function setFormQuitacaoEnabled(enabled) {
            const box = document.getElementById('form-compra-campos');
            if (box) box.querySelectorAll('input, select, button').forEach(el => { el.disabled = !enabled; });
            for (const id of ['btn-desfazer-compra', 'btn-excluir-compra']) {
                const b = document.getElementById(id); if (b) b.disabled = false;
            }
        }


        function atualizarBotoesCompra() {
            const compra = appState.comprasParceladas.find(c => c.id === compraQuitacaoId);
            const efetivada = compra && compra.status === 'efetivada';
            const btnEf = document.getElementById('btn-efetivar-compra');
            const btnDes = document.getElementById('btn-desfazer-compra');
            const btnExc = document.getElementById('btn-excluir-compra');
            if (btnEf) btnEf.classList.toggle('hidden', !!efetivada);
            if (btnDes) btnDes.classList.toggle('hidden', !efetivada);
            if (btnExc) btnExc.classList.toggle('hidden', !compra);
            document.getElementById('form-compra-titulo').innerText = compra
                ? `${compra.nome} — ${efetivada ? 'efetivada · edite Correção/Aporte na Projeção mês a mês abaixo' : 'em simulação'}`
                : 'Dados da compra (a simulação recalcula automaticamente)';
            setFormQuitacaoEnabled(!efetivada);
        }


        function novaCompraParcelada() {
            compraQuitacaoId = null;
            fontesQuitacao = [];
            taxasMesQuitacao = {};
            aportesMesQuitacao = {};
            setFormQuitacaoEnabled(true);
            for (const id of ['qp-nome', 'qp-parcela', 'qp-total']) document.getElementById(id).value = '';
            document.getElementById('qp-pagas').value = '0';
            document.getElementById('qp-aporte').value = '0';
            document.getElementById('qp-indexador').value = '7';
            renderQuitacao();
        }


        function salvarCompraParcelada(silencioso) {
            const p = lerFormCompra();
            if (!p.nome || !p.valorParcela || !p.total || !p.mesPrimeira) { alert("Preencha ao menos: nome, valor da parcela, parcelas totais e mês da próxima parcela."); return null; }
            let compra = appState.comprasParceladas.find(c => c.id === compraQuitacaoId);
            if (compra && compra.status === 'efetivada') { alert("Esta compra já foi efetivada. Desfaça a efetivação antes de alterá-la."); return null; }
            if (!compra) {
                compra = { id: 'compra_' + Date.now(), status: 'simulacao' };
                appState.comprasParceladas.push(compra);
                compraQuitacaoId = compra.id;
            }
            Object.assign(compra, p);
            saveData();
            if (!silencioso) alert("Compra salva. Use ✅ Efetivar quando quiser lançar as parcelas no sistema.");
            return compra;
        }


        function carregarCompraParcelada(id) {
            const c = appState.comprasParceladas.find(x => x.id === id);
            if (!c) return;
            compraQuitacaoId = id;
            fontesQuitacao = normalizarFontesCompra(c).map(f => ({ ...f }));
            taxasMesQuitacao = { ...(c.taxasMes || {}) };
            aportesMesQuitacao = { ...(c.aportesMes || {}) };
            document.getElementById('qp-nome').value = c.nome;
            document.getElementById('qp-parcela').value = c.valorParcela;
            document.getElementById('qp-total').value = c.total;
            document.getElementById('qp-pagas').value = c.pagas;
            document.getElementById('qp-indexador').value = c.taxaIndexador;
            document.getElementById('qp-mes-primeira').value = c.mesPrimeira;
            document.getElementById('qp-dia').value = c.dia;
            document.getElementById('qp-aporte').value = c.aporte;
            renderQuitacao();
            document.getElementById('qp-categoria').value = c.categoria || '__nova__';
            renderSimulacaoQuitacao();
        }


        function efetivarCompraParcelada() {
            const compra = salvarCompraParcelada(true);
            if (!compra) return;
            const temFontes = (compra.fontes || []).length > 0;
            const sim = simularQuitacao(planoDaCompra(compra));
            if (temFontes && !sim.quita) { alert("A simulação não quita todas as parcelas — as fontes esgotam antes do fim.\nAjuste o aporte (por mês ou o padrão, botão \"mín.\") ou as fontes antes de efetivar."); return; }

            const movimentos = montarMovimentosCompra(compra, sim);
            const nResgates = movimentos.filter(m => m.grupo === 'resgate').length;
            const nAportes = movimentos.filter(m => m.grupo === 'aporte').length;
            const nomesFontes = compra.fontes.map((f, i) => `${i + 1}º ${nomeCurtoInvestimento(f.investimentoId)}`).join(', ');
            const resumoInvestimentos = temFontes
                ? `• ${nResgates} resgates líquidos${nAportes ? ` e ${nAportes} aportes líquidos` : ''} nos investimentos (${nomesFontes})\n\nAporte e resgate do mesmo investimento na mesma data são compensados entre si — só a diferença é lançada.`
                : `• Sem investimento vinculado: nenhum resgate/aporte será criado.`;
            if (!confirm(`Efetivar "${compra.nome}"?\n\nSerão criados na Previsão:\n• ${compra.restantes} parcelas (Saída)\n${resumoInvestimentos}\nTotal corrigido: ${formatCurrency(sim.totalParcelas)}.\n\nDepois de efetivar você continua ajustando Correção e Aporte de cada mês na Projeção mês a mês — as mudanças fluem para a Previsão e o Investimento. Pode desfazer tudo com um clique.`)) return;

            compra.status = 'efetivada';
            const r = aplicarLancamentosCompra(compra);
            updateFutureCategoriesDropdown(); updatePrevSumDropdown();
            saveData();
            setFormQuitacaoEnabled(false);
            alert(`"${compra.nome}" efetivada!\n• ${r.criados} lançamentos criados na 📅 Previsão${temFontes ? `\n• ${nResgates} resgates líquidos${nAportes ? ` e ${nAportes} aportes líquidos` : ''} nos investimentos (${nomesFontes})` : ''}\n\nAgora edite Correção/Aporte na tabela; meses conciliados ficam travados.`);
        }


        function desfazerEfetivacaoCompra() {
            const compra = appState.comprasParceladas.find(c => c.id === compraQuitacaoId);
            if (!compra || compra.status !== 'efetivada') return;
            const gerados = appState.futureTransactions.filter(f => f.compraId === compra.id);
            const conciliados = gerados.filter(f => f.conciliado).length;
            if (!confirm(`Desfazer a efetivação de "${compra.nome}"?\n${gerados.length} lançamentos serão removidos da Previsão e os movimentos revertidos no investimento.${conciliados ? `\n\nAtenção: ${conciliados} lançamento(s) já conciliado(s) também serão removidos.` : ''}`)) return;
            for (const f of gerados) reverterReflexoInvestimento(f);
            appState.futureTransactions = appState.futureTransactions.filter(f => f.compraId !== compra.id);
            compra.status = 'simulacao';
            saveData();
            setFormQuitacaoEnabled(true);
            carregarCompraParcelada(compra.id);
        }


        function excluirCompraParcelada() {
            const compra = appState.comprasParceladas.find(c => c.id === compraQuitacaoId);
            if (!compra) return;
            if (compra.status === 'efetivada') { alert("Desfaça a efetivação antes de excluir a compra."); return; }
            if (!confirm(`Excluir a compra "${compra.nome}"? (apenas o cadastro da simulação)`)) return;
            appState.comprasParceladas = appState.comprasParceladas.filter(c => c.id !== compra.id);
            compraQuitacaoId = null;
            saveData();
        }


        // ===== Limpeza da Previsão por categoria =====
        function excluirPrevisoesPorCategoria() {
            const sel = document.getElementById('prev-limpar-categoria');
            const cat = sel ? sel.value : '';
            if (!cat) { alert("Escolha uma categoria."); return; }
            const alvo = appState.futureTransactions.filter(f => !f.conciliado && (f.categoria || 'Não Categorizado') === cat);
            if (!alvo.length) { alert("Nenhum agendamento pendente nessa categoria."); return; }
            if (!confirm(`Excluir ${alvo.length} agendamento(s) pendente(s) da categoria "${cat}"?\n\n• Previsões já efetivadas (Previsto × Realizado) não serão tocadas.\n• Reflexos em investimentos serão revertidos.`)) return;
            for (const f of alvo) reverterReflexoInvestimento(f);
            const ids = new Set(alvo.map(f => f.id));
            appState.futureTransactions = appState.futureTransactions.filter(f => !ids.has(f.id));
            saveData();
        }


        function assignCategory(transactionId, category, type, selEl) {
            const lista = type === 'banco' ? appState.transactions : (type === 'cartao' ? appState.ccTransactions : null);
            const transaction = lista ? lista.find(t => t.id === transactionId) : null;
            if (!transaction) return;
            transaction.categoria = category;
            cachedSaldoAtual = null;
            // Com o select em mãos e sem o filtro "pendentes" ativo, atualiza a linha no
            // lugar e persiste em segundo plano — evita re-renderizar a lista inteira
            // (que é lento e perde a posição de rolagem) a cada categorização
            const filtroEl = document.getElementById(type === 'banco' ? 'filterSelectBanco' : 'filterSelectCartao');
            if (selEl && (!filtroEl || filtroEl.value !== 'pendentes')) {
                selEl.dataset.cat = category;
                selEl.classList.toggle('border-amber-400', !category);
                selEl.classList.toggle('bg-amber-50', !category);
                selEl.classList.toggle('border-slate-200', !!category);
                saveToDB();
                return;
            }
            saveData();
        }


        function renderContasUI() {
            const select = document.getElementById('conta-select');
            if (!select) return;
            const prev = select.value; // preserva o modo "NOVA CONTA" durante a criação
            select.innerHTML = '<option value="nova">-- NOVA CONTA --</option>';
            for (let c of (appState.contas || [])) {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.innerText = c.nome + (c.incluirDashboard === false ? '  (fora do dashboard)' : '');
                select.appendChild(opt);
            }
            if (prev === 'nova') select.value = 'nova';
            else if (contaSelecionadaId && getContaById(contaSelecionadaId)) select.value = contaSelecionadaId;

            const chips = document.getElementById('contas-chips');
            if (chips) {
                chips.innerHTML = '';
                for (let c of (appState.contas || [])) {
                    const marcado = c.incluirDashboard !== false ? 'checked' : '';
                    const ativa = c.id === contaSelecionadaId ? 'ring-2 ring-indigo-400' : '';
                    chips.innerHTML += `
                        <div class="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 ${ativa}">
                            <button onclick="selecionarConta('${c.id}')" class="text-sm font-semibold text-slate-700 hover:text-indigo-600" title="Tornar esta a conta ativa">${escapeHtml(c.nome)}</button>
                            <span class="text-xs text-slate-400 whitespace-nowrap">${formatCurrency(getSaldoConta(c.id))}</span>
                            <label class="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer" title="Refletir no dashboard e na previsão">
                                <input type="checkbox" ${marcado} onchange="toggleContaDashboard('${c.id}')"> dashboard
                            </label>
                        </div>`;
                }
            }

            const saldoEl = document.getElementById('conta-saldo-atual');
            const nomeEl = document.getElementById('conta-saldo-atual-nome');
            const ativa = getContaById(contaSelecionadaId);
            if (saldoEl) saldoEl.innerText = formatCurrency(ativa ? getSaldoConta(contaSelecionadaId) : 0);
            if (nomeEl) nomeEl.innerText = ativa ? ativa.nome : 'Conta';
        }


        function preencherFormConta() {
            const sel = document.getElementById('conta-select');
            const nome = document.getElementById('conta-nome');
            const saldo = document.getElementById('conta-saldo-inicial');
            const chk = document.getElementById('conta-dashboard');
            if (!sel || !nome || !saldo || !chk) return;
            if (sel.value === 'nova') {
                nome.value = ''; saldo.value = '0.00'; chk.checked = true;
            } else {
                const c = getContaById(sel.value);
                if (c) { nome.value = c.nome; saldo.value = (Number(c.saldoInicial)||0).toFixed(2); chk.checked = c.incluirDashboard !== false; }
            }
        }


        function carregarConta() {
            const sel = document.getElementById('conta-select');
            if (!sel) return;
            if (sel.value !== 'nova') contaSelecionadaId = sel.value;
            preencherFormConta();
            renderContasUI();
            updateFilterMesBancoLight();
            renderTransactionsBanco();
        }


        function selecionarConta(id) {
            if (!getContaById(id)) return;
            contaSelecionadaId = id;
            const sel = document.getElementById('conta-select');
            if (sel) sel.value = id;
            preencherFormConta();
            renderContasUI();
            updateFilterMesBancoLight();
            renderTransactionsBanco();
        }


        function salvarConta() {
            const sel = document.getElementById('conta-select');
            if (!sel) return;
            const nome = (document.getElementById('conta-nome').value || '').trim();
            const saldoInicial = parseFloat(document.getElementById('conta-saldo-inicial').value) || 0;
            const incluir = document.getElementById('conta-dashboard').checked;
            if (!nome) { alert("Informe o nome da conta."); return; }
            if (sel.value === 'nova') {
                const id = 'conta_' + Date.now() + '_' + Math.random().toString(36).substr(2,5);
                appState.contas.push({ id, nome, saldoInicial, incluirDashboard: incluir });
                contaSelecionadaId = id;
                sel.value = id;
            } else {
                const c = getContaById(sel.value);
                if (c) { c.nome = nome; c.saldoInicial = saldoInicial; c.incluirDashboard = incluir; }
            }
            renderContasUI();
            preencherFormConta();
            updateFilterMesBancoLight();
            saveData();
        }


        function excluirConta() {
            const sel = document.getElementById('conta-select');
            if (!sel || sel.value === 'nova') { alert("Selecione uma conta existente para excluir."); return; }
            if ((appState.contas || []).length <= 1) { alert("É necessário manter ao menos uma conta corrente."); return; }
            const c = getContaById(sel.value);
            if (!c) return;
            const qtd = appState.transactions.filter(t => t.contaId === c.id).length;
            if (!confirm(`Excluir a conta "${c.nome}"${qtd ? ` e suas ${qtd} transação(ões)` : ''}? Esta ação não pode ser desfeita.`)) return;
            appState.transactions = appState.transactions.filter(t => t.contaId !== c.id);
            appState.contas = appState.contas.filter(x => x.id !== c.id);
            contaSelecionadaId = appState.contas[0].id;
            sel.value = contaSelecionadaId;
            renderContasUI();
            preencherFormConta();
            updateFilterMesBancoLight();
            saveData();
        }


        function toggleContaDashboard(id) {
            const c = getContaById(id);
            if (!c) return;
            c.incluirDashboard = !(c.incluirDashboard !== false); // alterna inclusão
            renderContasUI();
            saveData();
        }


        function optionsCategoria(isDeb, selecionada) {
            const key = (isDeb ? 'd|' : 'r|') + (selecionada || '');
            if (_optsCache[key]) return _optsCache[key];
            const cats = sortedCats(isDeb ? appState.categories.despesas : appState.categories.receitas);
            let opts = `<option value="">-- Selecione --</option>`;
            for (let c of cats) opts += `<option value="${c.replace(/"/g, '&quot;')}"${selecionada === c ? ' selected' : ''}>${escapeHtml(c)}</option>`;
            return _optsCache[key] = opts;
        }


        function prepararSelectCategoria(sel) {
            if (!sel || !sel.classList || !sel.classList.contains('cat-select') || sel.dataset.pronto === '1') return;
            sel.dataset.pronto = '1';
            sel.innerHTML = optionsCategoria(sel.dataset.deb === '1', sel.dataset.cat || '');
        }


        function selectCategoriaHtml(t, tipo) {
            const isDeb = t.debito > 0;
            const catAttr = (t.categoria || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
            const optAtual = t.categoria
                ? `<option value="${catAttr}" selected>${escapeHtml(t.categoria)}</option>`
                : `<option value="">-- Selecione --</option>`;
            return `<select data-id="${t.id}" data-tipo="${tipo}" data-deb="${isDeb ? 1 : 0}" data-cat="${catAttr}" class="cat-select w-full md:w-64 text-xs border rounded-md p-2 mt-2 md:mt-0 ${t.categoria ? 'border-slate-200' : 'border-amber-400 bg-amber-50'}">${optAtual}</select>`;
        }


        function ativarSelectsPreguicosos(containerId) {
            const cont = document.getElementById(containerId);
            if (!cont || cont.dataset.lazyOk === '1') return;
            cont.dataset.lazyOk = '1';
            cont.addEventListener('mousedown', e => prepararSelectCategoria(e.target));
            cont.addEventListener('focusin', e => prepararSelectCategoria(e.target));
            cont.addEventListener('change', e => {
                const s = e.target;
                if (s && s.classList && s.classList.contains('cat-select')) assignCategory(s.dataset.id, s.value, s.dataset.tipo, s);
            });
        }


        function linhaTransacaoHtml(t, dataHtml, corValor, tipo, fnApagar) {
            const isDeb = t.debito > 0; const val = isDeb ? t.debito : t.credito;
            return `
                <div class="virt-row flex flex-col md:flex-row justify-between p-4 border-b ${t.isDuplicate ? 'bg-yellow-100 hover:bg-yellow-200 border-yellow-300' : 'hover:bg-slate-50'}">
                    <div class="flex-1 grid grid-cols-3 md:grid-cols-4 gap-2 items-center">
                        ${dataHtml}
                        <span class="text-sm text-slate-700 truncate col-span-2" title="${escapeHtml(t.descricao)}">${escapeHtml(t.descricao)}</span>
                        <div class="flex items-center justify-end gap-2">
                            <span class="${corValor} font-semibold">${isDeb ? '-' : '+'} ${formatCurrency(val)}</span>
                            <button onclick="${fnApagar}('${t.id}')" class="text-rose-400 hover:text-rose-600 font-bold ml-2 text-xl" title="Apagar transação">&times;</button>
                        </div>
                    </div>
                    ${selectCategoriaHtml(t, tipo)}
                </div>`;
        }


        // ===== Paginação simples das listas grandes =====
        // Renderiza no máximo LIMITE_LISTA linhas por vez; acima disso mostra um rodapé
        // "Mostrar mais" que amplia o limite. Evita travar o navegador com anos de
        // lançamentos. O limite volta ao padrão sempre que o filtro/conta muda.
        const LIMITE_LISTA = 1000;
        let _bancoAte = LIMITE_LISTA, _bancoSig = null;
        let _cartaoAte = LIMITE_LISTA, _cartaoSig = null;
        function mostrarMaisBanco() { _bancoAte += LIMITE_LISTA; renderTransactionsBanco(); }
        function mostrarMaisCartao() { _cartaoAte += LIMITE_LISTA; renderTransactionsCartao(); }
        function rodapePaginacao(mostrando, total, fn) {
            return `<div class="p-3 text-center text-xs text-slate-500 bg-slate-50 border-t border-slate-100">
                Mostrando <b>${mostrando}</b> de <b>${total}</b> lançamentos
                <button onclick="${fn}()" class="ml-2 bg-indigo-600 text-white px-3 py-1 rounded-md font-bold hover:bg-indigo-700">Mostrar mais ${Math.min(LIMITE_LISTA, total - mostrando)}</button>
            </div>`;
        }

        function renderTransactionsBanco() {
            const container = document.getElementById('transactionsContainerBanco');
            renderContasUI();
            ativarSelectsPreguicosos('transactionsContainerBanco');
            const filter = document.getElementById('filterSelectBanco').value;
            const filterMesEl = document.getElementById('filterMesBanco');
            const filterMes = filterMesEl ? filterMesEl.value : 'todos';

            const sig = contaSelecionadaId + '|' + filterMes + '|' + filter;
            if (sig !== _bancoSig) { _bancoSig = sig; _bancoAte = LIMITE_LISTA; }

            let filtered = appState.transactions.filter(t => t.contaId === contaSelecionadaId);
            if (filterMes !== 'todos') {
                const alvo = mesAnoNum(filterMes);
                filtered = filtered.filter(t => mesAnoNum(t.data) === alvo);
            }
            if (filter === 'pendentes') filtered = filtered.filter(t => !t.categoria);
            if (filter === 'debito') filtered = filtered.filter(t => t.debito > 0);
            if (filter === 'credito') filtered = filtered.filter(t => t.credito > 0);

            if (filtered.length === 0) {
                container.innerHTML = `<p class="text-center p-8 text-slate-400 text-sm">Nenhum registro.</p>`;
                return;
            }

            // Ordena por data desc com chave pré-calculada (evita criar Date a cada comparação)
            const linhas = filtered.map(t => ({ t, k: dataTransacaoISO(t.data) }));
            linhas.sort((a, b) => b.k.localeCompare(a.k));

            const total = linhas.length;
            const html = [];
            for (let { t } of linhas.slice(0, _bancoAte)) {
                const isDeb = t.debito > 0;
                html.push(linhaTransacaoHtml(t,
                    `<span class="text-sm text-slate-400 font-medium">${t.data || ''}</span>`,
                    isDeb ? 'text-rose-600' : 'text-emerald-600', 'banco', 'apagarLinhaBanco'));
            }
            if (total > _bancoAte) html.push(rodapePaginacao(_bancoAte, total, 'mostrarMaisBanco'));
            container.innerHTML = html.join('');
        }


        function renderTransactionsCartao() {
            const container = document.getElementById('transactionsContainerCartao');
            ativarSelectsPreguicosos('transactionsContainerCartao');
            safeRun(renderParcelamentosFuturos);
            const filter = document.getElementById('filterSelectCartao') ? document.getElementById('filterSelectCartao').value : 'todos';
            const filterMesEl = document.getElementById('filterMesCartao');
            const filterMes = filterMesEl ? filterMesEl.value : 'todos';

            const sig = filterMes + '|' + filter;
            if (sig !== _cartaoSig) { _cartaoSig = sig; _cartaoAte = LIMITE_LISTA; }

            const totalContainer = document.getElementById('totalizadorCartaoContainer');
            const totalValor = document.getElementById('totalizadorCartaoValor');
            const totalBruto = document.getElementById('totalizadorCartaoBruto');

            let filtered = appState.ccTransactions.filter(t => (t.cartaoId || null) === cartaoSelecionadoId);
            if (filter === 'pendentes') filtered = filtered.filter(t => !t.categoria);
            if (filterMes !== 'todos') {
                const alvo = mesAnoNum(filterMes);
                filtered = filtered.filter(t => mesAnoNum(t.data) === alvo);
            }

            if (totalContainer && totalValor && totalBruto) {
                if (filterMes !== 'todos') {
                    let calcLiquido = 0, calcBruto = 0;
                    for (let t of filtered) {
                        const d = Number(t.debito) || 0, c = Number(t.credito) || 0;
                        calcLiquido += d - c; calcBruto += d + c;
                    }
                    totalValor.innerText = formatCurrency(calcLiquido);
                    totalBruto.innerText = formatCurrency(calcBruto);
                    totalContainer.classList.remove('hidden');
                } else {
                    totalContainer.classList.add('hidden');
                }
            }

            if (filtered.length === 0) { container.innerHTML = `<p class="text-center p-8 text-slate-400">Nenhum registro.</p>`; return; }

            // Ordena por mês de vencimento (fatura) desc e, dentro da fatura, por data da
            // compra asc — chaves pré-calculadas uma única vez
            const linhas = filtered.map(t => ({ t, venc: mesAnoNum(t.data) || 0, compra: dataTransacaoISO(t.dataCompra || t.data) }));
            linhas.sort((a, b) => (b.venc - a.venc) || a.compra.localeCompare(b.compra));

            // Subtotais por fatura para os cabeçalhos de grupo
            const grupos = {};
            for (let { t, venc } of linhas) {
                if (!grupos[venc]) grupos[venc] = { qtd: 0, liquido: 0 };
                grupos[venc].qtd++;
                grupos[venc].liquido += (Number(t.debito) || 0) - (Number(t.credito) || 0);
            }

            const total = linhas.length;
            const html = [];
            let grupoAtual = null;
            for (let { t, venc } of linhas.slice(0, _cartaoAte)) {
                if (venc !== grupoAtual) {
                    grupoAtual = venc;
                    const g = grupos[venc];
                    const rotulo = venc ? `Fatura ${String(((venc - 1) % 12) + 1).padStart(2, '0')}/${Math.floor((venc - 1) / 12)}` : 'Sem vencimento';
                    html.push(`
                        <div class="flex justify-between items-center bg-slate-100 border-y border-slate-200 px-4 py-2">
                            <span class="text-xs font-bold text-slate-600 uppercase">💳 ${rotulo}</span>
                            <span class="text-xs font-bold text-slate-500">${g.qtd} lançamento${g.qtd > 1 ? 's' : ''} &bull; líquido <span class="text-amber-700">${formatCurrency(g.liquido)}</span></span>
                        </div>`);
                }
                const dtHtml = `<div class="text-sm"><span class="text-sm text-slate-600">${t.dataCompra || t.data || ''}</span>${t.dataCompra ? `<br><span class="text-[10px] text-slate-400">Venc: ${t.data || ''}</span>` : ''}</div>`;
                const isDeb = t.debito > 0;
                html.push(linhaTransacaoHtml(t, dtHtml, isDeb ? 'text-amber-600' : 'text-emerald-600', 'cartao', 'apagarLinhaCartao'));
            }
            if (total > _cartaoAte) html.push(rodapePaginacao(_cartaoAte, total, 'mostrarMaisCartao'));
            container.innerHTML = html.join('');
        }


        function apagarLinhaCartao(id) { if(confirm("Tem certeza que deseja apagar esta transação do cartão?")) { appState.ccTransactions = appState.ccTransactions.filter(t => t.id !== id); sincronizarParcelasCartao(); saveData(); } }


        // ===== Múltiplos cartões =====
        function renderCartoesUI() {
            const chips = document.getElementById('cartoes-chips');
            if (chips) {
                chips.innerHTML = (appState.cartoes || []).map(c => {
                    const ativo = c.id === cartaoSelecionadoId;
                    return `<button onclick="selecionarCartao('${c.id}')" class="px-3 py-1.5 rounded-full text-xs font-bold border transition ${ativo ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}">💳 ${escapeHtml(c.nome)}</button>`;
                }).join('') || '<span class="text-xs text-slate-400">Nenhum cartão.</span>';
            }
            const ativo = getCartaoAtivo();
            const nome = document.getElementById('cartao-nome'); if (nome && ativo) nome.value = ativo.nome;
            const dia = document.getElementById('cartao-dia-venc'); if (dia && ativo) dia.value = ativo.diaVencimento || '';
            // mostra, na importação, o dia de vencimento vindo do cadastro do cartão ativo
            const fatDiaInfo = document.getElementById('fatura-dia-info');
            if (fatDiaInfo) fatDiaInfo.innerText = ativo ? `dia ${ativo.diaVencimento || 10}` : '—';
        }

        function selecionarCartao(id) {
            if (!getCartaoById(id)) return;
            cartaoSelecionadoId = id;
            renderCartoesUI();
            updateFilterMesCartaoLight();
            renderTransactionsCartao();
        }

        function novoCartao() {
            const nome = (prompt("Nome do novo cartão:", "Novo cartão") || '').trim();
            if (!nome) return;
            const id = 'cartao_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            appState.cartoes.push({ id, nome, diaVencimento: 10 });
            garantirCategoria('despesas', nome);
            cartaoSelecionadoId = id;
            sincronizarParcelasCartao();
            saveData();
            renderCartoesUI(); updateFilterMesCartaoLight(); renderTransactionsCartao(); safeRun(renderCategoriesTab);
        }

        function salvarCartaoAtivo() {
            const ativo = getCartaoAtivo(); if (!ativo) return;
            const novoNome = (document.getElementById('cartao-nome')?.value || '').trim();
            const dia = parseInt(document.getElementById('cartao-dia-venc')?.value, 10);
            if (!novoNome) { alert("Informe um nome para o cartão."); return; }
            if (novoNome !== ativo.nome) {
                // renomear -> propaga na tabela de categorias e nos lançamentos
                if (appState.cartoes.some(c => c !== ativo && c.nome === novoNome)) { alert("Já existe um cartão com esse nome."); return; }
                renomearCategoria('despesas', ativo.nome, novoNome);
                ativo.nome = novoNome;
            }
            if (!isNaN(dia) && dia >= 1 && dia <= 31) ativo.diaVencimento = dia;
            sincronizarParcelasCartao();
            saveData();
            renderCartoesUI(); safeRun(renderCategoriesTab);
            alert("Cartão atualizado.");
        }

        function excluirCartao() {
            if ((appState.cartoes || []).length <= 1) { alert("É preciso manter ao menos um cartão."); return; }
            const ativo = getCartaoAtivo(); if (!ativo) return;
            const n = appState.ccTransactions.filter(t => (t.cartaoId || null) === ativo.id).length;
            if (!confirm(`Excluir o cartão "${ativo.nome}"?${n ? `\n\nOs ${n} lançamento(s) deste cartão também serão apagados.` : ''}`)) return;
            appState.ccTransactions = appState.ccTransactions.filter(t => (t.cartaoId || null) !== ativo.id);
            appState.cartoes = appState.cartoes.filter(c => c.id !== ativo.id);
            cartaoSelecionadoId = appState.cartoes[0].id;
            // remove também as previsões de parcelas geradas para o cartão excluído
            appState.futureTransactions = appState.futureTransactions.filter(f => !(f.origemCartaoId === ativo.id));
            sincronizarParcelasCartao();
            saveData();
            renderCartoesUI(); updateFilterMesCartaoLight(); renderTransactionsCartao();
        }


        function renderInvestimentos() {
            const select = document.getElementById('inv-select');
            if(!select) return;
            
            const currentSelection = select.value; 
            select.innerHTML = '<option value="novo">-- NOVO INVESTIMENTO --</option>'; 
            
            let totals = { BRL: 0, USD: 0, EUR: 0 }, totalAportesMes = 0;
            const filterMonth = document.getElementById('inv-month-filter')?.value || '';

            if (appState.investimentos && appState.investimentos.length > 0) {
                for (let inv of appState.investimentos) {
                    const opt = document.createElement('option'); opt.value = inv.id; opt.innerText = `${inv.nome} (${inv.banco})`; select.appendChild(opt);
                    
                    let saldoNoMes = 0;
                    let aporteNoMes = 0;

                    if (inv.historico && inv.historico.length > 0) {
                        if (filterMonth) {
                            const historicoFiltrado = inv.historico.filter(h => paraMesAno(h.data) <= filterMonth);
                            if (historicoFiltrado.length > 0) {
                                saldoNoMes = historicoFiltrado[historicoFiltrado.length - 1].saldoFinal || 0;
                            } else {
                                if (inv.data && inv.data.substring(0, 7) <= filterMonth) saldoNoMes = inv.valorInicial || inv.valor || 0;
                            }
                            const exatoMes = inv.historico.find(h => paraMesAno(h.data) === filterMonth);
                            if (exatoMes && exatoMes.aporte) aporteNoMes = exatoMes.aporte;
                        } else {
                            const ultimo = inv.historico[inv.historico.length-1];
                            saldoNoMes = ultimo.saldoFinal || 0;
                            if (ultimo.aporte) aporteNoMes = ultimo.aporte;
                        }
                    } else {
                        if (!filterMonth || (inv.data && inv.data.substring(0, 7) <= filterMonth)) {
                            saldoNoMes = inv.valor || 0;
                        }
                    }

                    if (!inv.ignorarPatrimonio) {
                        if(totals[inv.moeda] !== undefined) totals[inv.moeda] += saldoNoMes;
                        totalAportesMes += aporteNoMes;
                    }
                }
            }
            
            if([...select.options].some(o => o.value === currentSelection)) select.value = currentSelection;
            
            document.getElementById('total-brl').innerHTML = 'R$ ' + formatCurrencyNumber(totals.BRL);
            document.getElementById('total-usd').innerHTML = 'US$ ' + formatCurrencyNumber(totals.USD);
            document.getElementById('total-eur').innerHTML = '€ ' + formatCurrencyNumber(totals.EUR);
            document.getElementById('total-aportes').innerHTML = 'R$ ' + formatCurrencyNumber(totalAportesMes);

            // Patrimônio Líquido (BRL) = total BRL − saldo devedor das compras em Quitação a partir do mês
            const cardLiq = document.getElementById('card-patrimonio-liquido');
            if (cardLiq) {
                const divida = saldoDevedorQuitacaoDesde(filterMonth || '');
                if (divida > 0.005) {
                    const liquido = totals.BRL - divida;
                    const elLiq = document.getElementById('patrimonio-liquido');
                    elLiq.innerHTML = 'R$ ' + formatCurrencyNumber(liquido);
                    elLiq.className = 'text-2xl font-bold ' + (liquido >= 0 ? 'text-white' : 'text-rose-300');
                    document.getElementById('patrimonio-liquido-sub').innerText =
                        `Dívida em aberto (Quitação): − R$ ${formatCurrencyNumber(divida)}${filterMonth ? ' a partir de ' + filterMonth.split('-').reverse().join('/') : ''}`;
                    cardLiq.classList.remove('hidden');
                } else {
                    cardLiq.classList.add('hidden');
                }
            }

            if (currentSelection !== 'novo' && appState.investimentos.some(i => i.id === currentSelection)) {
                exibirDetalheInvestimento(currentSelection);
            } else {
                document.getElementById('investimentoHeader').classList.add('hidden');
                document.getElementById('investimentosListContainer').innerHTML = '<div class="text-center p-8 text-slate-400">Selecione um investimento na lista à esquerda</div>';
            }
        }


        function exibirDetalheInvestimento(id) {
            const inv = appState.investimentos.find(i => i.id === id);
            if (!inv) return;
            document.getElementById('investimentoHeader').classList.remove('hidden');
            document.getElementById('invHeaderNome').innerText = inv.nome;
            document.getElementById('invHeaderBanco').innerText = inv.banco;
            
            const hoje = new Date();
            const mesCorrente = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
            let ultimoSaldo = 0;
            
            if (inv.historico && inv.historico.length > 0) {
                const histPassado = inv.historico.filter(h => paraMesAno(h.data) <= mesCorrente);
                if (histPassado.length > 0) {
                    ultimoSaldo = histPassado[histPassado.length - 1].saldoFinal;
                } else {
                    ultimoSaldo = inv.valorInicial || inv.valor || 0;
                }
            } else {
                if (!inv.data || inv.data.substring(0, 7) <= mesCorrente) {
                    ultimoSaldo = inv.valor || 0;
                }
            }
            
            document.getElementById('invUltimoSaldo').innerHTML = `${inv.moeda === 'USD' ? 'US$' : (inv.moeda === 'EUR' ? '€' : 'R$')} ${formatCurrencyNumber(ultimoSaldo)}`;
            
            const container = document.getElementById('investimentosListContainer');
            
            if (!inv.historico || inv.historico.length === 0) {
                container.innerHTML = '<div class="text-center p-8 text-slate-500">Nenhum lançamento mensal registrado. Clique em "➕ Lançar Mês"</div>';
                return;
            }
            
            let html = `
            <table class="w-full text-sm text-left">
                <thead class="bg-slate-100 text-slate-600 font-bold sticky top-0">
                    <tr>
                        <th class="p-3">Data</th>
                        <th class="p-3 text-right">Saldo Ant.</th>
                        <th class="p-3 text-right text-sky-700">Aporte (+)</th>
                        <th class="p-3 text-right">Taxa a.a.</th>
                        <th class="p-3 text-right">Rend. (+)</th>
                        <th class="p-3 text-right">Resgate (-)</th>
                        <th class="p-3 text-right text-indigo-700">Saldo Final</th>
                        <th class="p-3 text-center">Ações</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">`;
                
            for (let linha of [...inv.historico].sort((a,b) => a.data.localeCompare(b.data))) {
                const partes = linha.data.split('-');
                const ano = partes[0], mes = partes[1];
                const dia = partes[2] || String(new Date(Number(ano), Number(mes), 0).getDate()).padStart(2,'0');
                html += `
                    <tr class="hover:bg-slate-50 transition">
                        <td class="p-3 font-semibold text-slate-700">${dia}/${mes}/${ano}</td>
                        <td class="p-3 text-right text-slate-600">R$ ${(linha.saldoAnterior || 0).toFixed(2)}</td>
                        <td class="p-3 text-right text-sky-600 font-bold">+ R$ ${(linha.aporte || 0).toFixed(2)}</td>
                        <td class="p-3 text-right text-slate-600">${(linha.taxaAnual || 0).toFixed(2)}%</td>
                        <td class="p-3 text-right text-emerald-600 font-medium">+ R$ ${(linha.rendimento || 0).toFixed(2)}</td>
                        <td class="p-3 text-right text-rose-600 font-medium">- R$ ${(linha.resgate || 0).toFixed(2)}</td>
                        <td class="p-3 text-right font-bold text-indigo-700">R$ ${(linha.saldoFinal || 0).toFixed(2)}</td>
                        <td class="p-3 text-center whitespace-nowrap">
                            <button onclick="editarLinha('${inv.id}','${linha.id}')" class="text-indigo-500 hover:bg-indigo-100 p-1.5 rounded transition" title="Editar este mês">✏️</button>
                            <button onclick="repetirLinha('${inv.id}','${linha.id}')" class="text-sky-500 hover:bg-sky-100 p-1.5 rounded ml-1 transition" title="Repetir (Gera meses seguintes)">🔁</button>
                            <button onclick="apagarLinha('${inv.id}','${linha.id}')" class="text-rose-500 hover:bg-rose-100 p-1.5 rounded ml-1 transition" title="Apagar este mês">🗑️</button>
                        </td>
                    </tr>`;
            }
            html += `</tbody></table>`;
            container.innerHTML = html;
        }


        function abrirModalNovoMes() {
            const selId = document.getElementById('inv-select').value;
            if (selId === 'novo') { alert("Selecione ou salve o investimento primeiro!"); return; }
            const inv = appState.investimentos.find(i => i.id === selId);
            if (!inv) return;
            
            editingLinhaMensalId = null;
            document.getElementById('modalTitle').innerText = "Adicionar Mês";
            
            let nextData = "";
            if(inv.historico && inv.historico.length > 0) {
                const last = inv.historico[inv.historico.length-1];
                let [y, m] = paraMesAno(last.data).split('-');
                let nM = parseInt(m) + 1;
                let nY = parseInt(y);
                if(nM > 12) { nM = 1; nY++; }
                nextData = ultimoDiaMes(`${nY}-${String(nM).padStart(2,'0')}`);
            } else {
                const today = new Date();
                nextData = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
            }

            document.getElementById('modalData').value = nextData;
            document.getElementById('modalAporte').value = "0";
            document.getElementById('modalTaxaAnual').value = "";
            document.getElementById('modalResgate').value = "0";
            
            let saldoAnterior = inv.historico?.length ? inv.historico[inv.historico.length-1].saldoFinal : (inv.valorInicial || inv.valor || 0);
            document.getElementById('modalSaldoAnterior').value = saldoAnterior.toFixed(2);
            document.getElementById('modalInvId').value = inv.id;
            document.getElementById('modalMensal').classList.remove('hidden');
            configurarCalculoModal();
        }


        function configurarCalculoModal() {
            const taxa = document.getElementById('modalTaxaAnual');
            const aporte = document.getElementById('modalAporte');
            const resgate = document.getElementById('modalResgate');
            const saldoAnt = document.getElementById('modalSaldoAnterior');
            
            const calc = () => {
                const s = parseFloat(saldoAnt.value) || 0;
                const a = parseFloat(aporte.value) || 0;
                const t = parseFloat(taxa.value) || 0;
                const r = parseFloat(resgate.value) || 0;
                
                const rend = s * (t / 100 / 12);
                document.getElementById('modalRendimento').value = rend.toFixed(2);
                document.getElementById('modalSaldoFinal').value = (s + a + rend - r).toFixed(2);
            };
            taxa.oninput = calc;
            aporte.oninput = calc;
            resgate.oninput = calc;
            saldoAnt.oninput = calc;
            calc();
        }


        function fecharModal() { document.getElementById('modalMensal').classList.add('hidden'); }


        function salvarLinhaMensal() {
            const invId = document.getElementById('modalInvId').value;
            const inv = appState.investimentos.find(i => i.id === invId);
            if (!inv) return;
            if (!inv.historico) inv.historico = [];
            
            const dataInformada = document.getElementById('modalData').value;
            if (!dataInformada) { alert("Informe a data!"); return; }
            const data = dataCompleta(dataInformada); // já vem "YYYY-MM-DD"; converte registros antigos "YYYY-MM"

            const saldoAnterior = parseFloat(document.getElementById('modalSaldoAnterior').value) || 0;
            const aporte = parseFloat(document.getElementById('modalAporte').value) || 0;
            const taxaAnual = parseFloat(document.getElementById('modalTaxaAnual').value) || 0;
            const resgate = parseFloat(document.getElementById('modalResgate').value) || 0;
            const rendimento = parseFloat(document.getElementById('modalRendimento').value) || 0;
            const saldoFinal = parseFloat(document.getElementById('modalSaldoFinal').value) || 0;

            if (editingLinhaMensalId) {
                const idx = inv.historico.findIndex(h => h.id === editingLinhaMensalId);
                if (idx === -1) return;
                if (inv.historico.some(h => h.data === data && h.id !== editingLinhaMensalId)) { alert("Já existe um lançamento nesta data!"); return; }
                inv.historico[idx] = { id: editingLinhaMensalId, data, saldoAnterior, aporte, taxaAnual, resgate, rendimento, saldoFinal };
            } else {
                if (inv.historico.some(h => h.data === data)) { alert("Já existe um lançamento nesta data!"); return; }
                const newId = 'linha_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                inv.historico.push({ id: newId, data, saldoAnterior, aporte, taxaAnual, resgate, rendimento, saldoFinal });
            }
            // Reordena por data (a data pode ter mudado na edição) e recalcula toda a cascata:
            // saldo anterior herdado do mês anterior e saldo final propagado para os posteriores.
            inv.historico.sort((a,b) => a.data.localeCompare(b.data));
            recalcularCascata(inv, 0);
            saveData();
            fecharModal();
            renderInvestimentos();
        }


        function editarLinha(invId, linhaId) {
            const inv = appState.investimentos.find(i => i.id === invId);
            if (!inv) return;
            const linha = inv.historico.find(h => h.id === linhaId);
            if (!linha) return;
            editingLinhaMensalId = linhaId;
            document.getElementById('modalTitle').innerText = "Editar Mês";
            document.getElementById('modalData').value = dataCompleta(linha.data);
            document.getElementById('modalSaldoAnterior').value = (linha.saldoAnterior || 0).toFixed(2);
            document.getElementById('modalAporte').value = linha.aporte || 0;
            document.getElementById('modalTaxaAnual').value = linha.taxaAnual;
            document.getElementById('modalResgate').value = linha.resgate || 0;
            document.getElementById('modalRendimento').value = (linha.rendimento || 0).toFixed(2);
            document.getElementById('modalSaldoFinal').value = linha.saldoFinal.toFixed(2);
            document.getElementById('modalInvId').value = invId;
            document.getElementById('modalMensal').classList.remove('hidden');
            configurarCalculoModal();
        }


        function repetirLinha(invId, linhaId) {
            const inv = appState.investimentos.find(i => i.id === invId);
            if (!inv) return;
            const original = inv.historico.find(h => h.id === linhaId);
            if (!original) return;
            const qtd = parseInt(prompt("Gerar lançamentos repetindo Aporte, Taxa e Resgate por quantos meses?", "1"));
            if (isNaN(qtd) || qtd <= 0) return;
            // Continua a série a partir do ÚLTIMO mês já existente, replicando o lançamento
            // clicado (aporte/taxa/resgate). Meses que já existirem são pulados, sem abortar.
            const ultimaLinha = [...inv.historico].sort((a,b) => a.data.localeCompare(b.data)).slice(-1)[0];
            let [ano, mes] = paraMesAno(ultimaLinha.data).split('-');
            let a = parseInt(ano), m = parseInt(mes);
            let geradas = 0;
            for (let i = 0; geradas < qtd; i++) {
                if (i > 600) break; // trava de segurança
                m++; if (m > 12) { m = 1; a++; }
                const novoMesAno = `${a}-${String(m).padStart(2,'0')}`;
                if (inv.historico.some(h => paraMesAno(h.data) === novoMesAno)) continue; // já existe, pula
                inv.historico.push({
                    id: 'linha_' + Date.now() + '_' + i,
                    data: ultimoDiaMes(novoMesAno),
                    saldoAnterior: 0,
                    aporte: original.aporte || 0,
                    taxaAnual: original.taxaAnual,
                    resgate: original.resgate || 0,
                    rendimento: 0,
                    saldoFinal: 0
                });
                geradas++;
            }
            inv.historico.sort((a,b) => a.data.localeCompare(b.data));
            const pos = inv.historico.findIndex(h => h.id === ultimaLinha.id);
            recalcularCascata(inv, Math.max(0, pos));
            saveData();
            renderInvestimentos();
        }


        function apagarLinha(invId, linhaId) {
            if (!confirm("Apagar este mês e recalcular os seguintes?")) return;
            const inv = appState.investimentos.find(i => i.id === invId);
            if (inv) {
                const idx = inv.historico.findIndex(h => h.id === linhaId);
                inv.historico = inv.historico.filter(h => h.id !== linhaId);
                if (inv.historico.length) recalcularCascata(inv, Math.max(0, idx-1));
                else inv.valor = inv.valorInicial || 0;
                saveData();
                renderInvestimentos();
            }
        }


        function salvarInvestimento() {
            const id = document.getElementById('inv-select').value;
            const nome = document.getElementById('inv-nome').value.trim();
            const banco = document.getElementById('inv-banco').value.trim();
            const moeda = document.getElementById('inv-moeda').value;
            const ignorarPatrimonio = document.getElementById('inv-ignorar-patrimonio').checked;
            const diasResgate = Math.min(Math.max(parseInt(document.getElementById('inv-dias-resgate').value, 10) || 0, 0), 365);

            if (!nome || !banco) { alert("Preencha nome e instituição!"); return; }
            if (id === 'novo') {
                const novoId = 'inv_' + Date.now();
                const filterMonth = document.getElementById('inv-month-filter')?.value || new Date().toISOString().split('T')[0].substring(0,7);
                appState.investimentos.push({ id: novoId, nome, banco, moeda, ignorarPatrimonio, diasResgate, valor: 0, valorInicial: 0, historico: [], data: filterMonth + "-01" });
                document.getElementById('inv-select').value = novoId;
            } else {
                const inv = appState.investimentos.find(i => i.id === id);
                if (inv) { inv.nome = nome; inv.banco = banco; inv.moeda = moeda; inv.ignorarPatrimonio = ignorarPatrimonio; inv.diasResgate = diasResgate; }
            }
            saveData();
        }


        function carregarInvestimento() {
            const id = document.getElementById('inv-select').value;
            if (id === 'novo') {
                document.getElementById('inv-nome').value = '';
                document.getElementById('inv-banco').value = '';
                document.getElementById('inv-ignorar-patrimonio').checked = false;
                document.getElementById('inv-dias-resgate').value = '';
                document.getElementById('inv-nome').disabled = false;
                document.getElementById('inv-banco').disabled = false;
                document.getElementById('investimentoHeader').classList.add('hidden');
                document.getElementById('investimentosListContainer').innerHTML = '<div class="text-center p-8 text-slate-400">Selecione um investimento na lista à esquerda</div>';
            } else {
                const inv = appState.investimentos.find(i => i.id === id);
                if (inv) {
                    document.getElementById('inv-nome').value = inv.nome;
                    document.getElementById('inv-banco').value = inv.banco;
                    document.getElementById('inv-moeda').value = inv.moeda;
                    document.getElementById('inv-ignorar-patrimonio').checked = inv.ignorarPatrimonio || false;
                    document.getElementById('inv-dias-resgate').value = inv.diasResgate || '';
                    exibirDetalheInvestimento(id);
                }
            }
        }


        function apagarInvestimentoAtual() {
            const id = document.getElementById('inv-select').value;
            if (id === 'novo') return;
            if(confirm('Apagar todo o registro desta Conta/Investimento e seu histórico mensal?')) { 
                appState.investimentos = appState.investimentos.filter(i => i.id !== id); 
                document.getElementById('inv-select').value = 'novo';
                carregarInvestimento();
                saveData(); 
            }
        }

        
        function toggleIgnorarPatrimonio() {
            const id = document.getElementById('inv-select').value;
            if (id !== 'novo') {
                const inv = appState.investimentos.find(i => i.id === id);
                if (inv) {
                    inv.ignorarPatrimonio = document.getElementById('inv-ignorar-patrimonio').checked;
                    saveData();
                }
            }
        }


        function atualizarLembreteBackup() {
            const banner = document.getElementById('banner-backup'); if (!banner) return;
            const texto = document.getElementById('banner-backup-texto');
            const temDados = (appState.transactions.length + appState.ccTransactions.length + appState.futureTransactions.length + (appState.investimentos || []).length) > 0;
            if (!temDados) { banner.classList.add('hidden'); return; }
            const agora = Date.now();
            if (appState.backupAdiadoAte && agora < new Date(appState.backupAdiadoAte).getTime()) { banner.classList.add('hidden'); return; }
            if (!appState.ultimoBackup) {
                if (texto) texto.innerText = "Você ainda não salvou nenhum backup dos seus dados.";
                banner.classList.remove('hidden');
                return;
            }
            const dias = Math.floor((agora - new Date(appState.ultimoBackup).getTime()) / 86400000);
            if (dias >= DIAS_LEMBRETE_BACKUP) {
                if (texto) texto.innerText = `Seu último backup foi há ${dias} dias.`;
                banner.classList.remove('hidden');
            } else {
                banner.classList.add('hidden');
            }
        }


        function adiarLembreteBackup() {
            appState.backupAdiadoAte = new Date(Date.now() + 7 * 86400000).toISOString();
            saveData();
        }


        function atualizarInfoUltimoBackup() {
            const el = document.getElementById('info-ultimo-backup'); if (!el) return;
            if (!appState.ultimoBackup) {
                el.innerText = "Nenhum backup salvo até agora.";
                el.className = "text-xs font-bold text-rose-600 mt-3";
            } else {
                const d = new Date(appState.ultimoBackup);
                el.innerText = `Último backup: ${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
                el.className = "text-xs font-bold text-emerald-700 mt-3";
            }
        }


        // ===== Backup automático em pasta (desktop) — UI =====

        function renderCardAutoBkp() {
            const sup = document.getElementById('autobkp-suporte');
            if (sup) sup.classList.toggle('hidden', fsaDisponivel());
            const pasta = document.getElementById('autobkp-pasta');
            if (pasta) pasta.innerText = (autoBkpCfg && autoBkpCfg.dirNome) ? autoBkpCfg.dirNome : 'nenhuma';
            const at = document.getElementById('autobkp-ativo'); if (at) at.checked = !!(autoBkpCfg && autoBkpCfg.ativo);
            const rt = document.getElementById('autobkp-restaurar'); if (rt) rt.checked = !!(autoBkpCfg && autoBkpCfg.restaurarAoAbrir);
            const st = document.getElementById('autobkp-status');
            if (st) {
                if (autoBkpCfg && autoBkpCfg.ultimoAutoBackupISO) {
                    const d = new Date(autoBkpCfg.ultimoAutoBackupISO);
                    st.innerText = `Último backup na pasta: ${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
                    st.className = 'text-xs font-bold text-emerald-700';
                } else { st.innerText = ''; }
            }
        }

        function lerCamposAutoBkp() {
            autoBkpCfg = autoBkpCfg || {};
            const at = document.getElementById('autobkp-ativo');
            const rt = document.getElementById('autobkp-restaurar');
            if (at) autoBkpCfg.ativo = at.checked;
            if (rt) autoBkpCfg.restaurarAoAbrir = rt.checked;
        }

        async function salvarConfigAutoBkp() {
            lerCamposAutoBkp();
            await salvarAutoBkpCfg();
            renderCardAutoBkp();
        }

        async function escolherPastaBackup() {
            if (!fsaDisponivel()) { alert("Este navegador não suporta escolher uma pasta fixa de backup. Use um navegador de desktop baseado no Chrome/Edge, ou o backup manual acima."); return; }
            try {
                const h = await window.showDirectoryPicker({ mode: 'readwrite' });
                autoBkpHandle = h;
                autoBkpCfg = autoBkpCfg || {};
                autoBkpCfg.dirNome = h.name;
                autoBkpCfg.dirHandle = h;
                if (autoBkpCfg.ativo === undefined) autoBkpCfg.ativo = true;
                if (autoBkpCfg.restaurarAoAbrir === undefined) autoBkpCfg.restaurarAoAbrir = true;
                lerCamposAutoBkp();
                await salvarAutoBkpCfg();
                const ok = await autoBackupSalvar(true);
                renderCardAutoBkp();
                const b = document.getElementById('banner-autobkp'); if (b) b.classList.add('hidden');
                alert(ok ? `Pasta "${h.name}" escolhida e backup inicial gravado.` : `Pasta "${h.name}" escolhida. Ative o backup automático para começar a gravar.`);
            } catch (e) { /* usuário cancelou o seletor */ }
        }

        async function autoBackupAgora() {
            if (!autoBkpHandle) { alert("Escolha uma pasta primeiro."); return; }
            const ok = await autoBackupSalvar(true);
            renderCardAutoBkp();
            alert(ok ? "Backup gravado na pasta." : "Não foi possível gravar. Verifique se você autorizou o acesso à pasta.");
        }

        function atualizarBannerAutoBkp() {
            const b = document.getElementById('banner-autobkp'); if (!b) return;
            if (autoBkpCfg && autoBkpCfg.ativo && autoBkpHandle) {
                const p = document.getElementById('banner-autobkp-pasta'); if (p) p.innerText = autoBkpCfg.dirNome || '';
                b.classList.remove('hidden');
            } else { b.classList.add('hidden'); }
        }

        async function sincronizarPastaBackup() {
            if (!(await verificarPermissaoPasta(true))) { alert("Não foi possível obter acesso à pasta."); return; }
            if (autoBkpCfg && autoBkpCfg.restaurarAoAbrir) await autoRestaurarSeMaisNovo(true);
            const b = document.getElementById('banner-autobkp'); if (b) b.classList.add('hidden');
            // permissão concedida nesta sessão → o auto-save silencioso passa a funcionar
            await autoBackupSalvar(true);
            renderCardAutoBkp();
        }


        // ===== Busca global =====

        function abrirBuscaGlobal() {
            const modal = document.getElementById('modal-busca'); if (!modal) return;
            modal.classList.remove('hidden');
            const input = document.getElementById('busca-global-input');
            if (input) { input.focus(); input.select(); }
            executarBuscaGlobal();
        }


        function fecharBuscaGlobal() {
            const modal = document.getElementById('modal-busca');
            if (modal) modal.classList.add('hidden');
        }


        function executarBuscaGlobal() {
            const input = document.getElementById('busca-global-input');
            const info = document.getElementById('busca-global-info');
            const cont = document.getElementById('busca-global-resultados');
            if (!input || !cont) return;
            const q = input.value.trim();
            if (q.length < 2) {
                cont.innerHTML = '';
                if (info) info.innerText = "Digite ao menos 2 caracteres. A busca cobre todas as contas correntes, o cartão e as previsões, em todos os meses.";
                return;
            }
            const qNorm = normalizarTextoBusca(q);
            let qValor = null;
            const somenteNumero = q.replace(/[R$\s]/g, '');
            if (/^-?[\d.,]+$/.test(somenteNumero)) {
                const vStr = somenteNumero.includes(',') ? somenteNumero.replace(/\./g, '').replace(',', '.') : somenteNumero;
                const n = Math.abs(parseFloat(vStr));
                if (!isNaN(n)) qValor = n;
            }
            const bateValor = (v) => qValor !== null && Math.abs(Math.abs(Number(v) || 0) - qValor) < 0.005;
            const bateTexto = (t) => (normalizarTextoBusca(t.descricao).includes(qNorm) || normalizarTextoBusca(t.categoria).includes(qNorm));

            const resultados = [];
            for (let t of appState.transactions) {
                if (bateTexto(t) || bateValor(t.credito) || bateValor(t.debito)) {
                    const conta = getContaById(t.contaId);
                    resultados.push({ origem: `🏦 ${conta ? conta.nome : 'Conta'}`, data: t.data, descricao: t.descricao, categoria: t.categoria, valor: (Number(t.credito) || 0) - (Number(t.debito) || 0) });
                }
            }
            for (let t of appState.ccTransactions) {
                if (bateTexto(t) || bateValor(t.credito) || bateValor(t.debito)) {
                    resultados.push({ origem: '💳 Cartão', data: t.data, descricao: t.descricao, categoria: t.categoria, valor: (Number(t.credito) || 0) - (Number(t.debito) || 0) });
                }
            }
            for (let f of appState.futureTransactions) {
                if (bateTexto(f) || bateValor(f.valor)) {
                    resultados.push({ origem: f.conciliado ? '📅 Previsão (efetivada)' : '📅 Previsão', data: f.data, descricao: f.descricao, categoria: f.categoria, valor: f.tipo === 'debito' ? -(Number(f.valor) || 0) : (Number(f.valor) || 0) });
                }
            }
            resultados.sort((a, b) => dataTransacaoISO(b.data).localeCompare(dataTransacaoISO(a.data)));

            const LIMITE = 150;
            const exibidos = resultados.slice(0, LIMITE);
            if (info) info.innerText = resultados.length === 0
                ? 'Nenhum lançamento encontrado.'
                : (resultados.length > LIMITE ? `Mostrando os ${LIMITE} mais recentes de ${resultados.length} resultados.` : `${resultados.length} resultado${resultados.length > 1 ? 's' : ''}.`);

            let html = '';
            for (let r of exibidos) {
                const cor = r.valor >= 0 ? 'text-emerald-600' : 'text-rose-600';
                html += `
                    <div class="py-2.5 flex justify-between items-center gap-3">
                        <div class="min-w-0">
                            <p class="text-sm font-medium text-slate-700 truncate">${escapeHtml(r.descricao)}</p>
                            <p class="text-xs text-slate-400">${r.origem} &bull; ${escapeHtml(r.data || '')} &bull; ${escapeHtml(r.categoria || 'Não Categorizado')}</p>
                        </div>
                        <span class="font-bold text-sm whitespace-nowrap ${cor}">${r.valor >= 0 ? '+' : '-'} ${formatCurrency(Math.abs(r.valor))}</span>
                    </div>`;
            }
            cont.innerHTML = html;
        }


        function renderCategoriesTab() {
            const desC = document.getElementById('list-cat-despesas');
            if(desC) {
                desC.innerHTML = '';
                for (let c of sortedCats(appState.categories.despesas)) {
                    const orc = Number((appState.orcamentos || {})[c]) || 0;
                    desC.innerHTML += `<li class="flex justify-between items-center gap-2 py-2">
                        <span class="text-slate-600 flex-1 min-w-0 truncate">${escapeHtml(c)}</span>
                        <input type="number" min="0" step="0.01" placeholder="Sem limite" value="${orc > 0 ? orc : ''}" onchange="salvarOrcamento('${c.replace(/'/g, "\\'")}', this.value)" class="w-28 text-sm border border-slate-200 rounded-md p-1.5 text-right outline-none focus:ring-1 focus:ring-indigo-500">
                        <button onclick="deleteCategory('despesas', '${c.replace(/'/g, "\\'")}')" class="text-rose-500 font-bold">&times;</button>
                    </li>`;
                }
            }
            const recC = document.getElementById('list-cat-receitas'); 
            if(recC) { 
                recC.innerHTML = ''; 
                for (let c of sortedCats(appState.categories.receitas)) { recC.innerHTML += `<li class="flex justify-between py-2"><span class="text-slate-600">${escapeHtml(c)}</span><button onclick="deleteCategory('receitas', '${c.replace(/'/g, "\\'")}')" class="text-rose-500 font-bold">&times;</button></li>`; }
            }
            safeRun(atualizarCategoriasRegra);
        }


        function addCategory(type) {
            const input = document.getElementById(type === 'despesas' ? 'new-cat-despesa' : 'new-cat-receita'); const val = input.value.trim();
            if(!appState.categories[type]) appState.categories[type] = [];
            if (val && !appState.categories[type].includes(val)) {
                appState.categories[type].push(val); input.value = ''; updateFutureCategoriesDropdown(); updatePrevSumDropdown(); saveData();
            }
        }

        
        function deleteCategory(type, cat) {
            if(!appState.categories[type]) return;
            appState.categories[type] = appState.categories[type].filter(c => c !== cat);
            if (type === 'despesas' && appState.orcamentos) delete appState.orcamentos[cat];
            updateFutureCategoriesDropdown(); updatePrevSumDropdown(); saveData();
        }


        // Define/remove o limite mensal de orçamento de uma categoria de despesa
        function salvarOrcamento(cat, valor) {
            if (!appState.orcamentos) appState.orcamentos = {};
            const v = parseFloat(valor);
            if (v > 0) appState.orcamentos[cat] = v;
            else delete appState.orcamentos[cat];
            saveData();
        }


        // ===== Regras de categorização editáveis =====
        function atualizarCategoriasRegra() {
            const tipo = document.getElementById('regra-tipo')?.value === 'receita' ? 'receitas' : 'despesas';
            const sel = document.getElementById('regra-categoria'); if (!sel) return;
            const atual = sel.value;
            const cats = (appState.categories[tipo] || []).slice().sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
            sel.innerHTML = cats.map(c => `<option value="${c.replace(/"/g, '&quot;')}">${escapeHtml(c)}</option>`).join('');
            if (cats.includes(atual)) sel.value = atual;
        }

        function renderRegrasCategoria() {
            atualizarCategoriasRegra();
            const box = document.getElementById('lista-regras'); if (!box) return;
            const regras = appState.regrasCategoria || [];
            if (!regras.length) { box.innerHTML = '<p class="text-xs text-slate-400">Nenhuma regra ainda. As importações seguem usando o histórico e as palavras-chave padrão.</p>'; return; }
            box.innerHTML = regras.map((r, i) => `
                <div class="flex items-center justify-between gap-2 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                    <span class="text-sm text-slate-700">contém <b>“${escapeHtml(r.texto)}”</b> → <span class="${r.tipo === 'receita' ? 'text-emerald-600' : 'text-rose-600'} font-semibold">${escapeHtml(r.categoria)}</span> <span class="text-[10px] text-slate-400">(${r.tipo === 'receita' ? 'receita' : 'despesa'})</span></span>
                    <button onclick="excluirRegraCategoria(${i})" title="Excluir regra" class="text-rose-500 hover:bg-rose-50 border rounded p-1 text-xs">🗑️</button>
                </div>`).join('');
        }

        function salvarRegraCategoria() {
            const texto = (document.getElementById('regra-texto')?.value || '').trim();
            const tipo = document.getElementById('regra-tipo')?.value === 'receita' ? 'receita' : 'despesa';
            const categoria = document.getElementById('regra-categoria')?.value || '';
            if (!texto) { alert("Digite o texto que a descrição deve conter (ex.: uber, ifood)."); return; }
            if (!categoria) { alert("Cadastre e escolha uma categoria para a regra (crie categorias acima, se preciso)."); return; }
            appState.regrasCategoria = appState.regrasCategoria || [];
            appState.regrasCategoria.push({ texto, tipo, categoria });
            const inp = document.getElementById('regra-texto'); if (inp) inp.value = '';
            saveData(); renderRegrasCategoria();
        }

        function excluirRegraCategoria(i) {
            if (!appState.regrasCategoria || !appState.regrasCategoria[i]) return;
            appState.regrasCategoria.splice(i, 1);
            saveData(); renderRegrasCategoria();
        }

        function aplicarRegrasExistentes() {
            let n = 0;
            const tryset = (t, isDeb) => { if (t.categoria) return; const c = findBestCategoryMatch(t.descricao, isDeb); if (c) { t.categoria = c; n++; } };
            for (const t of (appState.transactions || [])) tryset(t, (Number(t.debito) || 0) > 0);
            for (const t of (appState.ccTransactions || [])) tryset(t, (Number(t.debito) || 0) > 0);
            for (const t of (appState.futureTransactions || [])) { if (t.conciliado) continue; tryset(t, t.tipo === 'debito'); }
            saveData();
            renderRegrasCategoria();
            alert(n > 0 ? `${n} lançamento(s) sem categoria foram categorizados pelas regras/histórico.` : "Nenhum lançamento sem categoria foi identificado pelas regras.");
        }


        // ===== Calendário financeiro =====
        let calAno = null, calMes = null, calDiaSel = null;

        function mudarMesCalendario(delta) {
            calMes += delta;
            if (calMes < 0) { calMes = 11; calAno--; }
            else if (calMes > 11) { calMes = 0; calAno++; }
            calDiaSel = null;
            renderCalendario();
        }
        function irHojeCalendario() {
            const t = new Date(); calAno = t.getFullYear(); calMes = t.getMonth();
            calDiaSel = `${String(t.getDate()).padStart(2,'0')}/${String(t.getMonth()+1).padStart(2,'0')}/${t.getFullYear()}`;
            renderCalendario();
        }
        // Agrupa previsões pendentes por dia do mês exibido
        function _eventosPorDiaCalendario() {
            const mapa = {};
            const alvo = (calMes + 1) + '/' + calAno;
            for (const f of appState.futureTransactions) {
                if (f.conciliado) continue;
                const d = converterDataBRParaDate(f.data);
                if (d.getMonth() !== calMes || d.getFullYear() !== calAno) continue;
                const dia = d.getDate();
                if (!mapa[dia]) mapa[dia] = { entradas: 0, saidas: 0, itens: [] };
                if (f.tipo === 'debito') mapa[dia].saidas += Number(f.valor) || 0; else mapa[dia].entradas += Number(f.valor) || 0;
                mapa[dia].itens.push(f);
            }
            return mapa;
        }
        function renderCalendario() {
            if (calAno === null) { const t = new Date(); calAno = t.getFullYear(); calMes = t.getMonth(); }
            const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
            const tit = document.getElementById('cal-titulo'); if (tit) tit.innerText = `${meses[calMes]} ${calAno}`;
            const grade = document.getElementById('cal-grade'); if (!grade) return;
            const mapa = _eventosPorDiaCalendario();
            const hoje = new Date(); const ehHoje = (d) => hoje.getDate() === d && hoje.getMonth() === calMes && hoje.getFullYear() === calAno;
            const primeiroDiaSemana = new Date(calAno, calMes, 1).getDay();
            const diasNoMes = new Date(calAno, calMes + 1, 0).getDate();
            // Saldo projetado ao fim de cada dia (Caixa de Partida + previsões pendentes até o dia).
            // Dias com saldo negativo são pintados de vermelho.
            const saldoBaseCal = getSaldoAtualReal();
            const futsPendCal = appState.futureTransactions.filter(f => !f.conciliado).map(f => ({ t: converterDataBRParaDate(f.data).getTime(), deb: f.tipo === 'debito', v: Number(f.valor) || 0 }));
            const saldoNoDia = (d) => {
                const fim = new Date(calAno, calMes, d, 23, 59, 59).getTime();
                let s = saldoBaseCal;
                for (const f of futsPendCal) { if (f.t <= fim) s += f.deb ? -f.v : f.v; }
                return s;
            };
            let html = '';
            for (let i = 0; i < primeiroDiaSemana; i++) html += `<div></div>`;
            for (let d = 1; d <= diasNoMes; d++) {
                const ev = mapa[d];
                const dataBR = `${String(d).padStart(2,'0')}/${String(calMes+1).padStart(2,'0')}/${calAno}`;
                const sel = calDiaSel === dataBR;
                const saldo = saldoNoDia(d);
                const neg = saldo < -0.005;
                let base = neg ? 'bg-rose-100 border-rose-300' : (ehHoje(d) ? 'border-indigo-500 border-2' : 'border-slate-100');
                html += `
                    <button onclick="selecionarDiaCalendario('${dataBR}')" title="Saldo previsto: ${formatCurrency(saldo)}" class="min-h-[62px] text-left border ${base} ${sel ? 'ring-2 ring-indigo-400' : ''} rounded-lg p-1.5 hover:bg-slate-50 transition flex flex-col">
                        <span class="text-xs font-bold ${neg ? 'text-rose-700' : (ehHoje(d) ? 'text-indigo-600' : 'text-slate-500')}">${d}</span>
                        ${ev && ev.entradas ? `<span class="text-[10px] text-emerald-600 font-semibold leading-tight">+${formatCurrencyNumber(ev.entradas)}</span>` : ''}
                        ${ev && ev.saidas ? `<span class="text-[10px] text-rose-600 font-semibold leading-tight">-${formatCurrencyNumber(ev.saidas)}</span>` : ''}
                        ${neg ? `<span class="text-[9px] text-rose-700 font-bold leading-tight mt-auto">⚠ ${formatCurrencyNumber(saldo)}</span>` : ''}
                    </button>`;
            }
            grade.innerHTML = html;
            renderDiaCalendario();
        }
        function selecionarDiaCalendario(dataBR) { calDiaSel = dataBR; renderCalendario(); }
        function renderDiaCalendario() {
            const tit = document.getElementById('cal-dia-titulo');
            const lista = document.getElementById('cal-dia-lista');
            if (!lista) return;
            if (!calDiaSel) { tit.innerText = 'Selecione um dia'; lista.innerHTML = '<p class="text-slate-400 py-2">Clique num dia do calendário para ver os lançamentos previstos.</p>'; return; }
            tit.innerText = `Lançamentos previstos — ${calDiaSel}`;

            // Saldo projetado ATÉ o dia selecionado (Caixa de Partida + previsões pendentes até a data)
            const dSel = converterDataBRParaDate(calDiaSel);
            let saldoDia = getSaldoAtualReal();
            for (const f of appState.futureTransactions) {
                if (f.conciliado) continue;
                if (converterDataBRParaDate(f.data) <= dSel) { if (f.tipo === 'debito') saldoDia -= Number(f.valor) || 0; else saldoDia += Number(f.valor) || 0; }
            }
            const corSaldo = saldoDia >= 0 ? 'text-indigo-700' : 'text-rose-600';
            let html = `<div class="flex justify-between items-center bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 mb-3">
                            <span class="text-xs font-bold text-indigo-700 uppercase">Saldo previsto até ${calDiaSel}</span>
                            <span class="font-bold ${corSaldo} whitespace-nowrap">${formatCurrency(saldoDia)}</span>
                        </div>`;

            const itens = appState.futureTransactions.filter(f => !f.conciliado && f.data === calDiaSel)
                .sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'credito' ? -1 : 1));
            if (!itens.length) { html += '<p class="text-slate-400 py-2">Nada previsto neste dia.</p>'; lista.innerHTML = html; return; }
            for (const f of itens) {
                const isDeb = f.tipo === 'debito';
                html += `
                    <div class="flex justify-between items-center py-2">
                        <div>
                            <span class="text-slate-700 font-medium">${escapeHtml(f.descricao)}</span>
                            ${f.recorrenciaId ? '<span class="ml-1 text-[10px] bg-indigo-100 text-indigo-700 px-1 rounded font-bold">🔁</span>' : ''}
                            <span class="block text-[11px] text-slate-400">${escapeHtml(f.categoria || 'Sem categoria')}</span>
                        </div>
                        <span class="font-bold ${isDeb ? 'text-rose-600' : 'text-emerald-600'} whitespace-nowrap">${isDeb ? '-' : '+'} ${formatCurrency(f.valor)}</span>
                    </div>`;
            }
            lista.innerHTML = html;
        }

        // ===== Notificações de contas a vencer =====
        function atualizarBannerVencimentos() {
            const banner = document.getElementById('banner-vencimentos');
            const texto = document.getElementById('banner-vencimentos-texto');
            if (!banner) return;
            const venc = contasAVencer(3);
            if (!venc.length) { banner.classList.add('hidden'); return; }
            const total = venc.reduce((s, f) => s + (Number(f.valor) || 0), 0);
            const nomes = venc.slice(0, 3).map(f => `${escapeHtml(f.descricao)} (${f.data})`).join(', ');
            if (texto) texto.innerHTML = `<b>${venc.length}</b> ${venc.length > 1 ? 'contas vencem' : 'conta vence'} nos próximos 3 dias — total <b>${formatCurrency(total)}</b>: ${nomes}${venc.length > 3 ? '…' : ''}`;
            banner.classList.remove('hidden');
        }
        function notificarVencimentosSeAtivo() {
            if (!appState.notificarVencimentos) return;
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            const hojeStr = new Date().toISOString().split('T')[0];
            try { if (localStorage.getItem('ultimaNotifVenc') === hojeStr) return; } catch (e) {}
            const venc = contasAVencer(3);
            if (!venc.length) return;
            const total = venc.reduce((s, f) => s + (Number(f.valor) || 0), 0);
            try {
                new Notification('Contas a vencer', {
                    body: `${venc.length} ${venc.length > 1 ? 'contas somam' : 'conta de'} ${formatCurrency(total)} nos próximos 3 dias.`,
                    icon: './icon-192.png'
                });
                localStorage.setItem('ultimaNotifVenc', hojeStr);
            } catch (e) {}
        }
        function atualizarCardNotif() {
            const st = document.getElementById('notif-status');
            const btnOn = document.getElementById('btn-notif-ativar');
            const btnOff = document.getElementById('btn-notif-desativar');
            if (!st) return;
            const suportado = 'Notification' in window;
            if (!suportado) { st.innerText = 'Este navegador não suporta notificações do sistema. O banner no topo continua funcionando.'; if (btnOn) btnOn.classList.add('hidden'); return; }
            if (appState.notificarVencimentos && Notification.permission === 'granted') {
                st.innerHTML = '🔔 <b class="text-emerald-600">Notificações ativas</b> — você é avisado ao abrir o app.';
                if (btnOn) btnOn.classList.add('hidden'); if (btnOff) btnOff.classList.remove('hidden');
            } else {
                st.innerHTML = '🔕 <b class="text-slate-500">Notificações do sistema desligadas</b> (o banner no topo continua avisando).';
                if (btnOn) btnOn.classList.remove('hidden'); if (btnOff) btnOff.classList.add('hidden');
            }
        }
        async function ativarNotificacoesUI() {
            if (!('Notification' in window)) { alert("Este navegador não suporta notificações."); return; }
            let perm = Notification.permission;
            if (perm !== 'granted') perm = await Notification.requestPermission();
            if (perm !== 'granted') { alert("Permissão de notificação negada. Você pode liberar nas configurações do navegador."); atualizarCardNotif(); return; }
            appState.notificarVencimentos = true;
            saveData(); atualizarCardNotif(); notificarVencimentosSeAtivo();
            alert("Notificações ativadas. Você será avisado sobre contas a vencer ao abrir o app.");
        }
        function desativarNotificacoesUI() {
            appState.notificarVencimentos = false;
            saveData(); atualizarCardNotif();
        }

        window.onload = init;

        // ===== Proteção por senha (criptografia local) =====
        function mostrarTelaBloqueio() {
            const t = document.getElementById('tela-bloqueio');
            if (t) { t.classList.remove('hidden'); const i = document.getElementById('senha-desbloqueio'); if (i) { i.value = ''; i.focus(); } }
        }
        async function submeterDesbloqueio() {
            const input = document.getElementById('senha-desbloqueio');
            const erro = document.getElementById('erro-desbloqueio');
            const ok = await tentarDesbloquear(input ? input.value : '');
            if (!ok) { if (erro) erro.classList.remove('hidden'); if (input) { input.value = ''; input.focus(); } return; }
            const t = document.getElementById('tela-bloqueio'); if (t) t.classList.add('hidden');
            if (erro) erro.classList.add('hidden');
            await continuarInit();
        }

        // ===== Criação da senha na primeira abertura =====
        // Exibida quando ainda não há senha cadastrada. A criptografia é sempre ativa,
        // então aqui o usuário define a senha que passará a proteger tudo (dados + backups).
        function mostrarTelaCriarSenha() {
            const t = document.getElementById('tela-criar-senha');
            if (!t) { continuarInit(); return; }
            t.classList.remove('hidden');
            const i = document.getElementById('criar-senha-1'); if (i) { i.value = ''; i.focus(); }
            const j = document.getElementById('criar-senha-2'); if (j) j.value = '';
            const erro = document.getElementById('erro-criar-senha'); if (erro) erro.classList.add('hidden');
        }

        async function criarSenhaInicial() {
            if (!window.crypto || !crypto.subtle) { alert("Este navegador não suporta a criptografia necessária. Use um navegador atualizado."); return; }
            const i1 = document.getElementById('criar-senha-1');
            const i2 = document.getElementById('criar-senha-2');
            const erro = document.getElementById('erro-criar-senha');
            const s1 = i1 ? i1.value : '';
            const s2 = i2 ? i2.value : '';
            const mostrarErro = (msg) => { if (erro) { erro.innerText = msg; erro.classList.remove('hidden'); } };
            if (s1.length < 4) { mostrarErro("Use uma senha com pelo menos 4 caracteres."); return; }
            if (s1 !== s2) { mostrarErro("As senhas não conferem."); return; }
            try {
                await ativarCripto(s1);   // cifra os dados atuais e define a senha mestra na sessão
                const t = document.getElementById('tela-criar-senha'); if (t) t.classList.add('hidden');
                await continuarInit();
                alert("🔒 Senha criada! O app vai pedir esta senha toda vez que abrir e ela protege também seus backups.\n\n⚠️ ANOTE a senha em local seguro: se esquecê-la, NÃO há como recuperar seus dados.");
            } catch (e) { mostrarErro("Falha ao aplicar a senha. Tente novamente."); }
        }

        // ===== Senha do app na aba Config (única para tudo) =====
        function renderCardSenha() {
            const inp = document.getElementById('config-senha');
            if (inp && senhaSessao != null && document.activeElement !== inp) inp.value = senhaSessao;
        }

        function toggleMostrarSenhaConfig() {
            const inp = document.getElementById('config-senha');
            const chk = document.getElementById('config-senha-mostrar');
            if (inp && chk) inp.type = chk.checked ? 'text' : 'password';
        }

        async function salvarSenhaConfig() {
            if (!criptoAtivada || !chaveSessao) { alert("A senha ainda não está ativa."); return; }
            const inp = document.getElementById('config-senha');
            const s1 = inp ? inp.value : '';
            if (s1.length < 4) { alert("Use uma senha com pelo menos 4 caracteres."); return; }
            if (s1 === senhaSessao) { alert("Esta já é a senha atual."); return; }
            if (!confirm("Alterar a senha do app?\n\nA nova senha passará a valer para abrir o app e para todos os backups. Anote-a em local seguro.")) return;
            try {
                const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)));
                chaveSessao = await _deriveKey(s1, new Uint8Array(salt));
                criptoSalt = salt;
                senhaSessao = s1;   // atualiza a senha mestra usada nos backups
                await saveToDB();
                safeRun(renderCardAutoBkp);
                alert("Senha alterada. Ela também passa a valer para todos os backups.");
            } catch (e) { alert("Falha ao alterar a senha."); }
        }

        function resetarBancoDeDados() {
            if (confirm("ATENÇÃO: Tem certeza que deseja apagar TODOS os dados do IndexedDB? Esta ação não pode ser desfeita!")) {
                if (confirm("Você tem certeza ABSOLUTA? Todo o seu histórico financeiro será perdido.")) {
                    // limpa dados e vestígios cifrados; como a criptografia é sempre ativa,
                    // logo em seguida pedimos a criação de uma nova senha.
                    criptoAtivada = false; chaveSessao = null; criptoSalt = null; senhaSessao = null;
                    db.seguro.clear().catch(() => {});
                    db.config.delete('cripto').catch(() => {});
                    appState = { saldoInicial: 0, contas: [], cartoes: [], transactions: [], ccTransactions: [], futureTransactions: [], investimentos: [], categories: { despesas: ["Outros"], receitas: ["Outros"] }, orcamentos: {}, comprasParceladas: [], recorrencias: [], regrasCategoria: [], limiteDiasNegativos: 10, notificarVencimentos: false };
                    garantirContas(); garantirCartoes(); renderContasUI(); preencherFormConta(); renderCartoesUI();
                    alert("O banco de dados foi completamente zerado. Defina uma nova senha para continuar.");
                    mostrarTelaCriarSenha();
                }
            }
        }


        function apagarMesContaCorrente() {
            const conta = getContaById(contaSelecionadaId);
            if (!conta) { alert("Selecione uma Conta Corrente primeiro."); return; }
            const mesStr = prompt(`Digite o mês e ano que deseja apagar da conta "${conta.nome}" (Exemplo: 06/2026):`);
            if (!mesStr) return;
            if (!/^\d{2}\/\d{4}$/.test(mesStr)) { alert("Formato inválido. Use MM/AAAA."); return; }
            if (confirm(`Tem certeza que deseja apagar TODAS as transações do mês ${mesStr} da conta "${conta.nome}"?`)) {
                appState.transactions = appState.transactions.filter(t => {
                    if (t.contaId !== contaSelecionadaId) return true;
                    if(!t.data) return true; let mes, ano;
                    if (t.data.includes('/')) { const p = t.data.split('/'); mes = p[1]; ano = p[2]; }
                    else if (t.data.includes('-')) { const p = t.data.split('-'); mes = p[1]; ano = p[0]; }
                    return `${mes}/${ano}` !== mesStr;
                });
                saveData(); alert("Processo concluído.");
            }
        }


        function apagarLinhaBanco(id) { if(confirm("Tem certeza que deseja apagar esta transação?")) { appState.transactions = appState.transactions.filter(t => t.id !== id); saveData(); } }