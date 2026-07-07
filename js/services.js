// ============================================================================
// services.js — modelo de dados, IndexedDB, cálculos, importação e backup
// Gerado a partir do script único do index.html (mesmo escopo global; funções
// continuam acessíveis pelos handlers onclick do HTML).
// ============================================================================



        // Configuração do IndexedDB usando Dexie.js
        const db = new Dexie("AppFinancas_DB");

        db.version(1).stores({
            transacoes: 'id, data',
            cartao: 'id, data',
            previsoes: 'id, data',
            investimentos: 'id',
            config: 'id'
        });
        // v2: store "seguro" guarda o estado inteiro cifrado quando a proteção por senha
        // está ligada (o resto das tabelas fica vazio; nada de texto puro no IndexedDB).
        db.version(2).stores({
            transacoes: 'id, data',
            cartao: 'id, data',
            previsoes: 'id, data',
            investimentos: 'id',
            config: 'id',
            seguro: 'id'
        });

        // Criptografia local (opcional): chave derivada da senha, mantida só na memória
        // desta aba enquanto o app está aberto.
        let chaveSessao = null;      // CryptoKey da sessão (null = bloqueado/sem proteção)
        let criptoAtivada = false;   // proteção por senha ligada?
        let criptoSalt = null;       // salt (array de bytes) do PBKDF2, guardado no meta


        let appState = {
            saldoInicial: 0,
            contas: [],
            transactions: [],
            ccTransactions: [],
            futureTransactions: [],
            investimentos: [],
            categories: { despesas: [], receitas: [] },
            orcamentos: {},
            comprasParceladas: [],
            limiteDiasNegativos: 10,
            ultimoBackup: null,
            backupAdiadoAte: null
        };


        let expenseChartInstance = null;

        let incomeChartInstance = null;

        let evolucaoChartInstance = null;

        let editingFutureId = null;

        let cachedSaldoAtual = null;

        let debounceTimers = {};

        
        let investimentoSelecionadoId = null;

        let editingLinhaMensalId = null;

        let contaSelecionadaId = null;


        function debounce(key, fn, delay = 300) {
            if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
            debounceTimers[key] = setTimeout(() => {
                fn();
                delete debounceTimers[key];
            }, delay);
        }


        function safeRun(fn) { try { fn(); } catch(e) { console.error("Erro protegido em", fn.name, e); } }


        // Garante que todos os campos esperados existam no appState (após decifrar ou restaurar backup)
        function _defaultsAppState() {
            if (typeof appState.saldoInicial !== 'number') appState.saldoInicial = Number(appState.saldoInicial) || 0;
            appState.contas = appState.contas || [];
            appState.transactions = appState.transactions || [];
            appState.ccTransactions = appState.ccTransactions || [];
            appState.futureTransactions = appState.futureTransactions || [];
            appState.investimentos = appState.investimentos || [];
            appState.categories = appState.categories || { despesas: [], receitas: [] };
            appState.orcamentos = appState.orcamentos || {};
            appState.comprasParceladas = appState.comprasParceladas || [];
            if (appState.limiteDiasNegativos === undefined || appState.limiteDiasNegativos === null) appState.limiteDiasNegativos = 10;
            if (appState.ultimoBackup === undefined) appState.ultimoBackup = null;
            if (appState.backupAdiadoAte === undefined) appState.backupAdiadoAte = null;
        }

        // Cifra o appState inteiro em um bloco { iv, cipher, flag(gzip) }
        async function _cifrarEstado(key) {
            let payload = new TextEncoder().encode(JSON.stringify(appState));
            const flag = _temGzip ? 1 : 0;
            if (flag) payload = await _gzip(payload);
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload));
            return { iv: Array.from(iv), cipher: Array.from(cipher), flag };
        }
        async function _decifrarEstado(key, blob) {
            let plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(blob.iv) }, key, new Uint8Array(blob.cipher)));
            if (blob.flag) plain = await _gunzip(plain);
            return JSON.parse(new TextDecoder().decode(plain));
        }

        // Tenta desbloquear com a senha: só retorna true se decifrar de verdade
        // (o próprio AES-GCM valida a senha). Deixa a chave na sessão em caso de sucesso.
        async function tentarDesbloquear(senha) {
            try {
                const meta = await db.config.get('cripto');
                if (!meta || !meta.enabled) return false;
                const key = await _deriveKey(senha, new Uint8Array(meta.salt));
                const blob = await db.seguro.get('blob');
                if (blob) await _decifrarEstado(key, blob); // lança se a senha estiver errada
                chaveSessao = key; criptoSalt = meta.salt; criptoAtivada = true;
                return true;
            } catch (e) { return false; }
        }

        // Liga a proteção: cifra o estado atual e apaga o texto puro — tudo numa
        // transação atômica; só marca a proteção como ativa após gravar com sucesso.
        async function ativarCripto(senha) {
            const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)));
            const key = await _deriveKey(senha, new Uint8Array(salt));
            const blob = await _cifrarEstado(key);
            await db.transaction('rw', db.transacoes, db.cartao, db.previsoes, db.investimentos, db.config, db.seguro, async () => {
                await db.seguro.put({ id: 'blob', ...blob });
                await db.config.put({ id: 'cripto', enabled: true, salt });
                await db.config.delete('global');
                await db.transacoes.clear(); await db.cartao.clear(); await db.previsoes.clear(); await db.investimentos.clear();
            });
            chaveSessao = key; criptoSalt = salt; criptoAtivada = true;
        }

        // Desliga a proteção: grava o estado em texto puro e remove os vestígios cifrados.
        async function desativarCripto() {
            criptoAtivada = false;
            await saveToDB();                       // grava global + tabelas em texto puro
            await db.seguro.clear().catch(() => {});
            await db.config.delete('cripto').catch(() => {});
            chaveSessao = null; criptoSalt = null;
        }

        async function loadDataFromDB() {
            try {
                const meta = await db.config.get('cripto').catch(() => null);
                if (meta && meta.enabled) {
                    criptoAtivada = true; criptoSalt = meta.salt;
                    if (!chaveSessao) return;       // ainda bloqueado; init() mostra a tela de senha
                    const blob = await db.seguro.get('blob');
                    if (blob) { appState = await _decifrarEstado(chaveSessao, blob); }
                    _defaultsAppState();
                    garantirContas();
                    return;
                }
                const count = await db.config.count();
                if (count === 0) {
                    const savedData = localStorage.getItem('controle_financeiro_dados');
                    if (savedData) {
                        const parsed = JSON.parse(savedData);
                        appState = {...appState, ...parsed};
                        await saveToDB();
                    }
                } else {
                    const cfg = await db.config.toArray();
                    const tr = await db.transacoes.toArray();
                    const cr = await db.cartao.toArray();
                    const pr = await db.previsoes.toArray();
                    const inv = await db.investimentos.toArray();

                    const confObj = cfg.find(c => c.id === 'global') || {};

                    appState.saldoInicial = Number(confObj.saldoInicial) || 0;
                    appState.categories = confObj.categories || { despesas: [], receitas: [] };
                    appState.orcamentos = confObj.orcamentos || {};
                    appState.comprasParceladas = confObj.comprasParceladas || [];
                    appState.limiteDiasNegativos = (confObj.limiteDiasNegativos !== undefined && confObj.limiteDiasNegativos !== null) ? confObj.limiteDiasNegativos : 10;
                    appState.ultimoBackup = confObj.ultimoBackup || null;
                    appState.backupAdiadoAte = confObj.backupAdiadoAte || null;
                    appState.contas = confObj.contas || [];
                    appState.transactions = tr || [];
                    appState.ccTransactions = cr || [];
                    appState.futureTransactions = pr || [];
                    appState.investimentos = inv || [];
                }
                garantirContas();
            } catch(e) { console.error("Erro ao carregar banco IndexedDB", e); }
        }


        async function saveToDB() {
            try {
                // Modo protegido: grava só o bloco cifrado e mantém as tabelas vazias
                if (criptoAtivada && chaveSessao) {
                    const blob = await _cifrarEstado(chaveSessao);
                    await db.transaction('rw', db.transacoes, db.cartao, db.previsoes, db.investimentos, db.config, db.seguro, async () => {
                        await db.seguro.put({ id: 'blob', ...blob });
                        await db.config.put({ id: 'cripto', enabled: true, salt: criptoSalt });
                        await db.config.delete('global');
                        await db.transacoes.clear(); await db.cartao.clear(); await db.previsoes.clear(); await db.investimentos.clear();
                    });
                    return;
                }
                // Modo padrão (texto puro) — inalterado
                await db.transaction('rw', db.transacoes, db.cartao, db.previsoes, db.investimentos, db.config, async () => {
                    await db.config.put({ id: 'global', saldoInicial: appState.saldoInicial, categories: appState.categories, orcamentos: appState.orcamentos, comprasParceladas: appState.comprasParceladas, limiteDiasNegativos: appState.limiteDiasNegativos, contas: appState.contas, ultimoBackup: appState.ultimoBackup, backupAdiadoAte: appState.backupAdiadoAte });
                    await db.transacoes.clear(); if(appState.transactions.length > 0) await db.transacoes.bulkPut(appState.transactions);
                    await db.cartao.clear(); if(appState.ccTransactions.length > 0) await db.cartao.bulkPut(appState.ccTransactions);
                    await db.previsoes.clear(); if(appState.futureTransactions.length > 0) await db.previsoes.bulkPut(appState.futureTransactions);
                    await db.investimentos.clear(); if(appState.investimentos.length > 0) await db.investimentos.bulkPut(appState.investimentos);
                });
            } catch(e) { console.error("Erro ao salvar no IndexedDB", e); }
        }

        
        function saveData() {
            _optsCache = {};
            saveToDB().then(() => {
                cachedSaldoAtual = null;
                updateSaldoDisplay();
                const activeTab = document.querySelector('.tab-content:not(.hidden)')?.id;
                if (activeTab === 'tab-dashboard') renderRelatorio();
                else if (activeTab === 'tab-previsao') renderPrevisao();
                else if (activeTab === 'tab-extrato') renderTransactionsBanco();
                else if (activeTab === 'tab-cartao') renderTransactionsCartao();
                else if (activeTab === 'tab-investimentos') renderInvestimentos();
                else if (activeTab === 'tab-quitacao') renderQuitacao();
                else if (activeTab === 'tab-config') renderCategoriesTab();
                safeRun(atualizarLembreteBackup);
                safeRun(atualizarInfoUltimoBackup);
            }).catch(e => alert("Erro ao salvar no banco de dados."));
        }


        // Retorna uma cópia da lista de categorias em ordem alfabética (pt-BR, ignora acentos/maiúsculas)
        function sortedCats(arr) {
            return [...(arr || [])].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' }));
        }


        // Normaliza descrição para comparação: minúsculas, sem acentos, sem números/pontuação
        function normalizeDesc(s) {
            return String(s || '').toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/\d+/g, ' ')
                .replace(/[^a-z ]/g, ' ')
                .replace(/\s+/g, ' ').trim();
        }


        function findBestCategoryMatch(descricao, isDebito) {
            if(!descricao) return '';
            const desc = String(descricao).toLowerCase();
            const cats = (isDebito ? appState.categories.despesas : appState.categories.receitas) || [];

            // 1) Aprende com o histórico: reutiliza a categoria mais frequente de descrições parecidas já categorizadas
            const alvo = normalizeDesc(descricao);
            if (alvo.length >= 4) {
                const contagem = {};
                const historico = [...(appState.transactions || []), ...(appState.ccTransactions || [])];
                for (let t of historico) {
                    if (!t.categoria) continue;
                    if (((Number(t.debito) || 0) > 0) !== !!isDebito) continue;
                    if (!cats.includes(t.categoria)) continue;
                    const descHist = normalizeDesc(t.descricao);
                    if (descHist.length < 4) continue;
                    if (descHist === alvo || descHist.includes(alvo) || alvo.includes(descHist)) {
                        contagem[t.categoria] = (contagem[t.categoria] || 0) + 1;
                    }
                }
                let melhor = '', melhorN = 0;
                for (let c in contagem) { if (contagem[c] > melhorN) { melhor = c; melhorN = contagem[c]; } }
                if (melhor) return melhor;
            }

            // 2) Palavras-chave comuns na descrição
            const commonKeywords = {
                'mercado': 'Supermercado', 'atakadao': 'Supermercado', 'hiperideal': 'Supermercado', 'assai': 'Supermercado',
                'drogaria': 'Farmácia', 'drogasil': 'Farmácia', 'pague menos': 'Farmácia', 'farmacia': 'Farmácia', 'farmácia': 'Farmácia',
                'restaurante': 'Restaurante', 'ifood': 'Restaurante', 'uber': 'Diversos', 'posto': 'Combustivel',
                'combust': 'Combustivel', 'gasolina': 'Combustivel', 'padaria': 'Padaria',
                'energia': 'Energia', 'coelba': 'Energia', 'embasa': 'Água', 'condominio': 'Condomínio', 'condomínio': 'Condomínio',
                'telefone': 'Telefone', 'vivo': 'Telefone', 'claro': 'Telefone', 'tim s': 'Telefone',
                'salario': 'Salário', 'salário': 'Salário',
                'amazon': 'Contas Internet', 'netflix': 'Contas Internet', 'google': 'Contas Internet', 'seguro': 'Seguros'
            };
            for (let key in commonKeywords) {
                if (desc.includes(key)) {
                    let mapped = commonKeywords[key];
                    let matchedCat = cats.find(c => String(c).toLowerCase().includes(mapped.toLowerCase()));
                    if (matchedCat) return matchedCat;
                }
            }
            for (let cat of cats) {
                if (desc.includes(String(cat).toLowerCase()) || String(cat).toLowerCase().includes(desc)) return cat;
            }
            return '';
        }


        // ===== Rotina de importacao do Cartao (mesma logica original, agora reutilizavel) =====
        function processarConteudoCartao(content, e, dataVencimentoFatura, anoFaturaCartao) {
            try {
                const lines = content.split(/\r?\n/);
                let headerIndex = -1;
                for (let i = 0; i < Math.min(5, lines.length); i++) {
                    if (lines[i].includes('Tipo') && lines[i].includes('Data') && lines[i].includes('Descricao')) { headerIndex = i; break; }
                }
                if (headerIndex === -1) {
                    alert("Arquivo não reconhecido. Verifique se o formato está correto."); e.target.value = ''; return;
                }
                
                let addedCount = 0;
                for (let i = headerIndex + 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    const parts = line.split(',');
                    if (parts.length < 5) continue;
                    
                    const tipo = parts[0].trim();
                    const dataRaw = parts[1].trim();
                    const descricao = parts[2].trim();
                    const parcelas = parts[3].trim();
                    const valorRaw = parts[4].trim();
                    
                    if (!dataRaw.match(/^\d{2}\/\d{2}$/)) continue;
                    if (valorRaw === '0' || valorRaw === '0.00' || valorRaw === '0,00') continue;
                    
                    const anoParaOriginal = anoFaturaCartao;
                    const dataOriginalCompraCompleta = `${dataRaw}/${anoParaOriginal}`;
                    const dataVencimentoReal = dataVencimentoFatura;
                    
                    let descricaoFinal = descricao;
                    if (parcelas && parcelas !== '-' && parcelas !== '') { descricaoFinal += ` (Parc. ${parcelas})`; }
                    
                    const parseValue = (val) => {
                        if (!val || val === '-') return 0;
                        if (typeof val === 'number') return Math.abs(val);
                        let clean = String(val).replace(/\s/g, '').replace('R$', '').trim();
                        clean = clean.replace(',', '.');
                        const num = parseFloat(clean);
                        return isNaN(num) ? 0 : num;
                    };
                    const valor = parseValue(valorRaw);
                    if (valor === 0) continue;
                    
                    let credito = 0, debito = 0;
                    const tipoLower = tipo.toLowerCase();
                    if (tipoLower === 'credito') credito = valor;
                    else if (tipoLower === 'despesa' || tipoLower === 'debito') debito = valor;
                    else debito = valor;
                    
                    let finalCat = findBestCategoryMatch(descricaoFinal, debito > 0);
                    if (finalCat) {
                        const tipoCat = debito > 0 ? 'despesas' : 'receitas';
                        if (!appState.categories[tipoCat]) appState.categories[tipoCat] = [];
                        if (!appState.categories[tipoCat].includes(finalCat)) appState.categories[tipoCat].push(finalCat);
                    }
                    
                    const realUniqueId = 'cc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9) + '_' + i;
                    
                    const exists = appState.ccTransactions.some(t => 
                        t.descricao === descricaoFinal && t.dataCompra === dataOriginalCompraCompleta && Math.abs((t.debito || t.credito) - valor) < 0.01
                    );
                    if (!exists) {
                        appState.ccTransactions.push({ 
                            id: realUniqueId, data: dataVencimentoReal, dataCompra: dataOriginalCompraCompleta, 
                            descricao: descricaoFinal, credito: credito, debito: debito, categoria: finalCat || '', isDuplicate: false 
                        });
                        addedCount++;
                    }
                }
                
                appState.ccTransactions.sort((a, b) => {
                    if (!a.data || !b.data) return 0;
                    const d1 = a.data.split('/'); const d2 = b.data.split('/');
                    return new Date(d2[2], d2[1] - 1, d2[0]) - new Date(d1[2], d1[1] - 1, d1[0]);
                });
                updateFilterMesCartaoLight();
                
                updateFutureCategoriesDropdown(); updatePrevSumDropdown();
                if (addedCount > 0) alert(`Foram importados ${addedCount} lançamentos do Cartão com sucesso.`);
                else alert("Nenhum lançamento foi importado. Eles já existem ou o arquivo está vazio.");
                
                e.target.value = ''; saveData();
            } catch (err) { alert("Erro ao processar o arquivo: " + err.message); e.target.value = ''; }
        }


        // ===== Importacao de Fatura em PDF (Cartao) =====
        // Le o PDF no navegador (pdf.js), extrai as secoes "Despesas",
        // "Parcelamentos" e "Pagamento e Demais Creditos", converte para o
        // formato Tipo,Data,Descricao,Parcela,Valor e entrega a MESMA rotina
        // de importacao acima. Nos parcelamentos, o numero da parcela (ex.
        // 12/12) vai no campo Parcela e a rotina o anexa a descricao.
        async function importarPdfFaturaCartao(file, e, dataVencimentoFatura, anoFaturaCartao) {
            try {
                if (typeof pdfjsLib === 'undefined') {
                    alert("A biblioteca de leitura de PDF nao foi carregada. Verifique sua conexao com a internet e recarregue a pagina.");
                    e.target.value = ''; return;
                }
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

                const linhas = await extrairLinhasPdf(file);
                const resultado = converterPdfFaturaParaCsv(linhas);

                if (resultado.total === 0) {
                    alert("Nenhum lancamento foi encontrado no PDF. Verifique se e uma fatura Santander no layout esperado (secoes 'Despesas', 'Parcelamentos' e 'Pagamento e Demais Creditos').");
                    e.target.value = ''; return;
                }
                processarConteudoCartao(resultado.csv, e, dataVencimentoFatura, anoFaturaCartao);
            } catch (err) {
                alert("Erro ao ler o PDF: " + err.message);
                e.target.value = '';
            }
        }


        // Extrai o texto do PDF linha a linha, respeitando o layout de 2 colunas
        async function extrairLinhasPdf(file) {
            const buf = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
            const linhas = [];
            for (let p = 1; p <= pdf.numPages; p++) {
                const page = await pdf.getPage(p);
                const viewport = page.getViewport({ scale: 1 });
                const midX = viewport.width / 2;
                const tc = await page.getTextContent();
                const itens = tc.items
                    .filter(it => it.str && it.str.trim() !== '')
                    .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0 }));

                // separa em coluna esquerda e direita (layout da fatura)
                const colunas = [itens.filter(it => it.x < midX), itens.filter(it => it.x >= midX)];
                for (const col of colunas) {
                    col.sort((a, b) => (b.y - a.y) || (a.x - b.x));
                    const grupos = [];
                    let atual = null;
                    for (const it of col) {
                        if (atual && Math.abs(atual.y - it.y) <= 3) { atual.itens.push(it); }
                        else { atual = { y: it.y, itens: [it] }; grupos.push(atual); }
                    }
                    for (const g of grupos) {
                        g.itens.sort((a, b) => a.x - b.x);
                        let texto = '';
                        let fimAnterior = null;
                        for (const it of g.itens) {
                            if (fimAnterior !== null && (it.x - fimAnterior) > 1.5) texto += ' ';
                            texto += it.str;
                            fimAnterior = it.x + it.w;
                        }
                        texto = texto.replace(/\s+/g, ' ').trim();
                        if (texto) linhas.push(texto);
                    }
                }
            }
            return linhas;
        }


        function normalizarTextoPdf(t) {
            return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
        }


        function valorPdfParaDecimal(v) {
            // "1.344,76" -> "1344.76"
            const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
            return isNaN(n) ? null : n.toFixed(2);
        }


        // Converte as linhas extraidas do PDF para o formato da rotina existente
        function converterPdfFaturaParaCsv(linhas) {
            // Despesa avulsa: (opcional indicador "1 "/"2 "/"3 ") + data DD/MM + descricao + valor R$ (+ valor US$ opcional)
            const RE_TRANSACAO = /^(?:\d\s+)?(\d{2}\/\d{2})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})(?:\s+-?\d{1,3}(?:\.\d{3})*,\d{2})?$/;
            // Parcelamento: idem, porem com o campo Parcela (NN/NN) entre a descricao e o valor
            const RE_PARCELAMENTO = /^(?:\d\s+)?(\d{2}\/\d{2})\s+(.+?)\s+(\d{2}\/\d{2})\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})$/;
            const RE_IOF = /^(?:\d\s+)?IOF DESPESA NO EXTERIOR\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})$/;

            let modo = 'skip'; // 'despesa' | 'credito' | 'parcelamento' | 'skip'
            let ultimaData = null;
            let total = 0;
            const saida = ['Tipo,Data,Descricao,Parcela,Valor'];

            for (const bruta of linhas) {
                const linhaLimpa = bruta.replace(/\s+/g, ' ').trim();
                const norm = normalizarTextoPdf(linhaLimpa);

                // Cabecalhos de secao
                if (norm === 'PAGAMENTO E DEMAIS CREDITOS') { modo = 'credito'; continue; }
                if (norm === 'PARCELAMENTOS') { modo = 'parcelamento'; continue; }
                if (norm === 'DESPESAS') { modo = 'despesa'; continue; }
                if (norm.startsWith('RESUMO DA FATURA') || norm.startsWith('SALDO TOTAL CONSOLIDADO') || norm.startsWith('JUROS E CUSTO EFETIVO')) { modo = 'skip'; continue; }
                if (norm.indexOf('XXXX XXXX') !== -1) { modo = 'skip'; continue; } // cabecalho de portador: aguarda proxima secao
                if (modo === 'skip') continue;
                if (norm.startsWith('VALOR TOTAL')) { modo = 'skip'; continue; }
                if (norm.startsWith('COTACAO DOLAR')) continue;

                // Parcelamentos: parcela (NN/NN) vai no campo Parcela; sao lancados como Despesa
                if (modo === 'parcelamento') {
                    const mp = linhaLimpa.match(RE_PARCELAMENTO);
                    if (!mp) continue;
                    const dataP = mp[1];
                    const descP = mp[2].replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
                    const parcelaP = mp[3];
                    const valorP = valorPdfParaDecimal(mp[4]);
                    if (valorP === null) continue;
                    const valorNumP = parseFloat(valorP);
                    if (valorNumP === 0) continue;
                    saida.push(['Despesa', dataP, descP, parcelaP, Math.abs(valorNumP).toFixed(2)].join(','));
                    total++;
                    continue;
                }

                // IOF de despesa no exterior: linha sem data propria -> usa a data da compra anterior
                const mIof = norm.match(RE_IOF);
                if (mIof && modo === 'despesa' && ultimaData) {
                    const vIof = valorPdfParaDecimal(mIof[1]);
                    if (vIof && parseFloat(vIof) !== 0) {
                        saida.push(['Despesa', ultimaData, 'IOF DESPESA NO EXTERIOR', '-', vIof].join(','));
                        total++;
                    }
                    continue;
                }

                const m = linhaLimpa.match(RE_TRANSACAO);
                if (!m) continue;

                const data = m[1];
                const descricao = m[2].replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
                const valorDec = valorPdfParaDecimal(m[3]);
                if (valorDec === null) continue;
                const valorNum = parseFloat(valorDec);
                if (valorNum === 0) continue;

                if (modo === 'credito') {
                    const descNorm = normalizarTextoPdf(descricao);
                    // pagamento da fatura anterior nao e importado como lancamento
                    if (descNorm.indexOf('DEB AUTOM') !== -1 || descNorm.indexOf('PAGAMENTO') !== -1) { continue; }
                    saida.push(['Credito', data, descricao, '-', Math.abs(valorNum).toFixed(2)].join(','));
                    total++;
                } else if (modo === 'despesa') {
                    saida.push(['Despesa', data, descricao, '-', Math.abs(valorNum).toFixed(2)].join(','));
                    ultimaData = data;
                    total++;
                }
            }
            return { csv: saida.join('\n'), total: total };
        }


        function formatCurrency(v) { return isNaN(Number(v)) ? "R$ 0,00" : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

        function formatCurrencyNumber(v) { return isNaN(Number(v)) ? "0,00" : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

        function converterDataBRParaDate(dataBR) { if(!dataBR) return new Date(); const p = dataBR.split('/'); return new Date(p[2], p[1]-1, p[0]); }


        // Converte "YYYY-MM" para "YYYY-MM-DD" usando o último dia daquele mês
        function ultimoDiaMes(mesAno) {
            if(!mesAno) return mesAno;
            const [y, m] = mesAno.split('-').map(Number);
            const last = new Date(y, m, 0).getDate();
            return `${y}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
        }


        // Extrai "YYYY-MM" de uma string "YYYY-MM-DD" (ou já "YYYY-MM")
        function paraMesAno(dataStr) { return dataStr ? dataStr.substring(0,7) : dataStr; }



        // Converte "DD/MM/YYYY" para "YYYY-MM-DD"
        function dataBRParaISO(dataBR) { const p = dataBR.split('/'); return `${p[2]}-${p[1]}-${p[0]}`; }


        // Garante uma data completa "YYYY-MM-DD" (compatibilidade com registros antigos "YYYY-MM")
        function dataCompleta(d) { return (d && d.length === 7) ? ultimoDiaMes(d) : d; }


        // Diferença em dias entre duas datas "YYYY-MM-DD" (d2 - d1)
        function diffDias(d1, d2) {
            const a = new Date(dataCompleta(d1) + 'T00:00:00');
            const b = new Date(dataCompleta(d2) + 'T00:00:00');
            return Math.round((b - a) / 86400000);
        }

        // Número sequencial do mês (ano*12 + mês) de uma data em qualquer formato usado no app
        // ("DD/MM/YYYY", "MM/YYYY", "YYYY-MM-DD", "YYYY-MM" ou "DD-MM-YYYY"); null se inválida
        function mesAnoNum(dataStr) {
            if (!dataStr) return null;
            let m, y;
            if (dataStr.includes('/')) {
                const p = dataStr.split('/');
                if (p.length === 3) { m = parseInt(p[1], 10); y = parseInt(p[2], 10); }
                else if (p.length === 2) { m = parseInt(p[0], 10); y = parseInt(p[1], 10); }
            } else if (dataStr.includes('-')) {
                const p = dataStr.split('-');
                if (p.length >= 2) {
                    if (p[0].length === 4) { y = parseInt(p[0], 10); m = parseInt(p[1], 10); }
                    else { y = parseInt(p[2], 10); m = parseInt(p[1], 10); }
                }
            }
            return (!m || !y) ? null : y * 12 + m;
        }


        function getSaldoAtualReal() {
            if (cachedSaldoAtual !== null) return cachedSaldoAtual;
            let total = 0;
            // Soma o saldo inicial de cada conta marcada para refletir + suas transações
            for (let c of (appState.contas || [])) {
                if (c.incluirDashboard === false) continue;
                total += Number(c.saldoInicial) || 0;
            }
            for (let t of appState.transactions) {
                if (!contaIncluida(t.contaId)) continue;
                total += (Number(t.credito)||0) - (Number(t.debito)||0);
            }
            cachedSaldoAtual = total;
            return cachedSaldoAtual;
        }


        // Marca, no cronograma, o dia em que a conta atinge o limite de dias com saldo
        // negativo (cheque especial) DENTRO DE UM MESMO MÊS. Percorre a projeção dia a
        // dia a partir de hoje (ou da 1ª linha, se anterior): o saldo de cada dia é o
        // saldo após o último lançamento até aquele dia. Ao completar o limite de dias
        // negativos num mês, associa o alerta à linha daquele dia; se não houver
        // lançamento no dia exato, à linha anterior disponível. Retorna { idLinha: [alertas] }.
        function calcularAlertasChequeEspecial(futs, caixaPartida) {
            const LIMITE = Math.max(1, parseInt(appState.limiteDiasNegativos) || 10);
            const marcados = {};
            if (!futs.length) return marcados;
            const linhas = [];
            let saldo = caixaPartida;
            for (const f of futs) {
                saldo += (f.tipo === 'debito' ? -1 : 1) * (Number(f.valor) || 0);
                linhas.push({ id: f.id, date: converterDataBRParaDate(f.data), saldoApos: saldo });
            }
            const msDia = 86400000;
            const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
            const inicio = new Date(Math.min(linhas[0].date.getTime(), hoje.getTime())); inicio.setHours(0, 0, 0, 0);
            const fim = linhas[linhas.length - 1].date;
            const contador = {}; const jaMarcado = {};
            let idx = 0, saldoAtual = caixaPartida;
            for (let t = inicio.getTime(); t <= fim.getTime(); t += msDia) {
                while (idx < linhas.length && linhas[idx].date.getTime() <= t) { saldoAtual = linhas[idx].saldoApos; idx++; }
                if (saldoAtual < -0.005) {
                    const dia = new Date(t);
                    const ym = `${dia.getFullYear()}-${dia.getMonth()}`;
                    contador[ym] = (contador[ym] || 0) + 1;
                    if (contador[ym] === LIMITE && !jaMarcado[ym]) {
                        jaMarcado[ym] = true;
                        let alvo = null;
                        for (let j = linhas.length - 1; j >= 0; j--) { if (linhas[j].date.getTime() <= t) { alvo = linhas[j]; break; } }
                        if (alvo) {
                            const diaStr = `${String(dia.getDate()).padStart(2, '0')}/${String(dia.getMonth() + 1).padStart(2, '0')}/${dia.getFullYear()}`;
                            const mesStr = `${String(dia.getMonth() + 1).padStart(2, '0')}/${dia.getFullYear()}`;
                            (marcados[alvo.id] = marcados[alvo.id] || []).push({ dia: diaStr, mes: mesStr, limite: LIMITE, exato: alvo.date.getTime() === dia.getTime() });
                        }
                    }
                }
            }
            return marcados;
        }


        function escapeHtml(str) {
            if (!str) return '';
            return str.replace(/[&<>]/g, function(m) {
                if (m === '&') return '&amp;'; if (m === '<') return '&lt;'; if (m === '>') return '&gt;'; return m;
            });
        }


        // Se o lançamento pertence a uma compra parcelada efetivada, regenera os meses
        // ainda não realizados (a Projeção mês a mês passa a refletir a conciliação).
        function sincronizarCompraApos(item) {
            if (!item || !item.compraId) return;
            const compra = appState.comprasParceladas.find(c => c.id === item.compraId);
            if (!compra || compra.status !== 'efetivada') return;
            aplicarLancamentosCompra(compra);
            updateFutureCategoriesDropdown(); updatePrevSumDropdown();
        }


        // Diferença normalizada: positiva = melhor que o previsto
        // (despesa: gastou menos; receita: recebeu mais)
        function diferencaConciliacao(f) {
            const prev = Number(f.valor) || 0, real = Number(f.realizado) || 0;
            return f.tipo === 'debito' ? prev - real : real - prev;
        }


        // ===== Parcelamentos futuros do cartão =====

        // Varre as faturas importadas em busca de lançamentos parcelados ("Parc. N/M") e
        // projeta as parcelas restantes. Compras repetidas em faturas consecutivas
        // (ex.: 3/12 em junho e 4/12 em julho) são deduplicadas pela descrição + total
        // de parcelas + valor, mantendo a ocorrência mais recente.
        function calcularParcelamentosFuturos() {
            const RE_PARC = /parc\w*\.?\s*(\d{1,3})\s*\/\s*(\d{1,3})/i;
            const compras = {};
            for (let t of appState.ccTransactions) {
                const val = Number(t.debito) || 0;
                if (val <= 0) continue;
                const m = String(t.descricao || '').match(RE_PARC);
                if (!m) continue;
                const atual = parseInt(m[1], 10), total = parseInt(m[2], 10);
                if (!atual || !total || atual > total || total < 2) continue;
                const baseNum = mesAnoNum(t.data);
                if (baseNum === null) continue;
                const descBase = String(t.descricao).replace(RE_PARC, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
                const key = normalizeDesc(descBase) + '|' + total + '|' + val.toFixed(2);
                const ex = compras[key];
                if (!ex || baseNum > ex.baseNum || (baseNum === ex.baseNum && atual > ex.atual)) {
                    compras[key] = { descBase, atual, total, valor: val, baseNum };
                }
            }
            const hoje = new Date();
            const hojeNum = hoje.getFullYear() * 12 + (hoje.getMonth() + 1);
            const porMes = {};
            for (let k in compras) {
                const c = compras[k];
                for (let i = 1; i <= c.total - c.atual; i++) {
                    const n = c.baseNum + i;
                    if (n < hojeNum) continue;
                    if (!porMes[n]) porMes[n] = [];
                    porMes[n].push({ desc: c.descBase, parcela: c.atual + i, total: c.total, valor: c.valor });
                }
            }
            return porMes;
        }


        // ===== Quitação de Compras Parceladas =====

        let compraQuitacaoId = null;

        let quitacaoChartInstance = null;


        function taxaMensalEquivalente(taxaAA) { return Math.pow(1 + (Number(taxaAA) || 0) / 100, 1 / 12) - 1; }


        function saldoAtualInvestimento(inv) {
            if (inv && inv.historico && inv.historico.length) return inv.historico[inv.historico.length - 1].saldoFinal || 0;
            return inv ? (inv.valorInicial || inv.valor || 0) : 0;
        }


        // Última taxa anual lançada no histórico do investimento (tabela de Investimentos)
        function taxaInvestimentoAtual(inv) {
            if (inv && inv.historico && inv.historico.length) return Number(inv.historico[inv.historico.length - 1].taxaAnual) || 0;
            return 0;
        }


        // Compatibilidade: compras antigas tinham um único investimentoId/taxa/saldo
        function normalizarFontesCompra(c) {
            if (!c.fontes) {
                c.fontes = c.investimentoId
                    ? [{ investimentoId: c.investimentoId, taxa: Number(c.taxaRendimento) || 0, saldo: Number(c.saldoInicial) || 0 }]
                    : [];
            }
            return c.fontes;
        }


        // Projeção mês a mês com MÚLTIPLAS fontes na ordem definida (opcionais): cada
        // investimento rende à sua própria taxa; a parcela corrigida é resgatada do 1º
        // com saldo e, se ele esgotar no meio do mês, o restante vem do seguinte. O
        // aporte entra na fonte ativa. Correção (p.taxasMes) e aporte (p.aportesMes) são
        // por mês (chaveados pelo nº absoluto da parcela); na falta, usam o padrão.
        // p.realizados (k → valor realmente pago) trava o mês: a parcela vira o valor
        // realizado e os meses seguintes se corrigem a partir dele (linha.locked=true).
        function simularQuitacao(p) {
            const fontes = p.fontes || [];
            const taxas = fontes.map(f => taxaMensalEquivalente(f.taxa));
            const saldos = fontes.map(f => Number(f.saldo) || 0);
            const realizados = p.realizados || {};
            const aportesMes = p.aportesMes || {};
            const linhas = [];
            let quita = true, quebraEm = null, totalParcelas = 0;
            let prevParcela = 0;
            for (let k = 0; k < p.restantes; k++) {
                const nAbs = (p.pagas || 0) + k + 1;
                let taxaCorrecao = p.taxaIndexador;
                if (p.taxasMes && p.taxasMes[nAbs] !== undefined) taxaCorrecao = p.taxasMes[nAbs];
                const projetada = (k === 0) ? (Number(p.valorParcela) || 0) : prevParcela * (1 + taxaMensalEquivalente(taxaCorrecao));
                const locked = realizados[k] !== undefined;
                const parcela = locked ? (Number(realizados[k]) || 0) : projetada;
                prevParcela = parcela;

                const aporte = (aportesMes[nAbs] !== undefined) ? (Number(aportesMes[nAbs]) || 0) : (Number(p.aporte) || 0);

                let rendimento = 0;
                for (let fi = 0; fi < saldos.length; fi++) {
                    if (saldos[fi] > 0) { const r = saldos[fi] * taxas[fi]; saldos[fi] += r; rendimento += r; }
                }
                let aporteFonte = saldos.findIndex(s => s > 0);
                if (aporteFonte === -1) aporteFonte = saldos.length - 1;
                if (aporte > 0 && saldos.length) saldos[aporteFonte] += aporte;

                let restante = parcela;
                const resgates = [];
                for (let fi = 0; fi < saldos.length && restante > 0.004; fi++) {
                    if (saldos[fi] <= 0) continue;
                    const usa = Math.min(saldos[fi], restante);
                    saldos[fi] -= usa; restante -= usa;
                    resgates.push({ fi, valor: usa });
                }
                let falta = 0;
                if (restante > 0.004) {
                    falta = restante;
                    if (quita) { quita = false; quebraEm = k; }
                    if (saldos.length) saldos[saldos.length - 1] -= restante;
                }
                totalParcelas += parcela;
                linhas.push({ k, nAbs, parcela, taxaCorrecao, locked, rendimento, aporte, aporteFonte, resgates, falta, saldos: saldos.slice(), saldoTotal: saldos.reduce((a, b) => a + b, 0) });
            }
            return { linhas, quita, quebraEm, sobraFinal: linhas.length ? linhas[linhas.length - 1].saldoTotal : saldos.reduce((a, b) => a + b, 0), totalParcelas };
        }


        // Menor aporte mensal que mantém as fontes ≥ 0 até a última parcela
        function aporteMinimoQuitacao(p) {
            if (!(p.fontes || []).length) return 0;
            if (simularQuitacao({ ...p, aporte: 0 }).quita) return 0;
            const somaInicial = p.fontes.reduce((a, f) => a + (Number(f.saldo) || 0), 0);
            let lo = 0;
            let hi = p.valorParcela * Math.pow(1 + taxaMensalEquivalente(p.taxaIndexador), p.restantes) + Math.max(0, -somaInicial);
            for (let it = 0; it < 60; it++) {
                const mid = (lo + hi) / 2;
                if (simularQuitacao({ ...p, aporte: mid }).quita) hi = mid; else lo = mid;
            }
            return Math.ceil(hi * 100) / 100;
        }


        // ----- Gerenciamento das fontes no formulário -----
        let fontesQuitacao = [];

        let taxasMesQuitacao = {};

        let aportesMesQuitacao = {};


        // Identifica o nº k da parcela e o grupo (parcela/resgate/aporte) de um
        // lançamento gerado por uma compra — usa os campos gravados ou, para dados
        // antigos, extrai do id (fut_<compra>_p<k> / _r<k>_<seq> / _a<k>_<seq>).
        function futParcelaK(f) {
            if (f.parcelaK !== undefined && f.parcelaK !== null) return f.parcelaK;
            const m = String(f.id || '').match(/_[pra](\d+)/);
            return m ? parseInt(m[1], 10) : -1;
        }

        function futGrupoCompra(f) {
            if (f.grupoCompra) return f.grupoCompra;
            const id = String(f.id || '');
            if (/_p\d+$/.test(id)) return 'parcela';
            if (/_r\d+_/.test(id)) return 'resgate';
            if (/_a\d+_/.test(id)) return 'aporte';
            return '';
        }

        // Meses (k) já conciliados na Previsão → valor realizado da parcela
        function realizadosDaCompra(compra) {
            const r = {};
            for (const f of appState.futureTransactions) {
                if (f.compraId === compra.id && futGrupoCompra(f) === 'parcela' && f.conciliado) {
                    const v = Number(f.realizado);
                    r[futParcelaK(f)] = isNaN(v) ? (Number(f.valor) || 0) : v;
                }
            }
            return r;
        }

        // Entrada da simulação a partir da compra salva (usada quando efetivada)
        function planoDaCompra(compra) {
            return {
                nome: compra.nome, valorParcela: Number(compra.valorParcela) || 0,
                total: compra.total, pagas: compra.pagas,
                restantes: Math.max(0, (Number(compra.total) || 0) - (Number(compra.pagas) || 0)),
                taxaIndexador: Number(compra.taxaIndexador) || 0,
                mesPrimeira: compra.mesPrimeira, dia: compra.dia,
                fontes: (compra.fontes || []).map(f => ({ ...f })),
                taxasMes: compra.taxasMes || {}, aportesMes: compra.aportesMes || {},
                aporte: Number(compra.aporte) || 0, categoria: compra.categoria,
                realizados: realizadosDaCompra(compra)
            };
        }


        // Data BR do vencimento da k-ésima parcela restante (k = 0 é a próxima)
        function dataParcelaQuitacao(mesPrimeira, dia, k) {
            const [y, m] = mesPrimeira.split('-').map(Number);
            const alvoMes = m - 1 + k;
            const ultimo = new Date(y, alvoMes + 1, 0).getDate();
            const d = new Date(y, alvoMes, Math.min(dia, ultimo));
            return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        }


        function nomeCurtoInvestimento(investimentoId) {
            const inv = appState.investimentos.find(x => x.id === investimentoId);
            return inv ? inv.nome : '(removido)';
        }


        function garantirCategoria(tipo, nome) {
            if (!appState.categories[tipo]) appState.categories[tipo] = [];
            if (!appState.categories[tipo].includes(nome)) appState.categories[tipo].push(nome);
            return nome;
        }


        // Efetivar: para cada parcela restante gera na Previsão um PAR de lançamentos —
        // Entrada "Resgate p/ ..." com reflexo (saque no investimento) + Saída da parcela —
        // e, se houver aporte mensal, uma Saída com reflexo de Aporte. Assim o saldo
        // projetado da conta fica correto (resgate entra, parcela sai) e o histórico do
        // investimento recebe os saques/aportes com recálculo em cascata.
        // Monta os movimentos LÍQUIDOS de investimento de cada mês: aporte e resgate do
        // MESMO investimento na MESMA data são compensados entre si e só a diferença é
        // lançada (um resgate líquido ou um aporte líquido), evitando movimentação
        // bancária desnecessária. A parcela (Saída da conta) é sempre lançada à parte.
        function montarMovimentosCompra(compra, sim) {
            const movimentos = [];
            for (const l of sim.linhas) {
                const dataBR = dataParcelaQuitacao(compra.mesPrimeira, compra.dia, l.k);
                const nParc = `${compra.pagas + l.k + 1}/${compra.total}`;

                const porInv = {};
                for (const r of l.resgates) {
                    const invId = compra.fontes[r.fi].investimentoId;
                    if (!porInv[invId]) porInv[invId] = { resgate: 0, aporte: 0 };
                    porInv[invId].resgate += r.valor;
                }
                if (l.aporte > 0.005 && compra.fontes.length) {
                    const invId = (compra.fontes[l.aporteFonte] || compra.fontes[0]).investimentoId;
                    if (!porInv[invId]) porInv[invId] = { resgate: 0, aporte: 0 };
                    porInv[invId].aporte += l.aporte;
                }

                let seq = 0;
                for (const invId in porInv) {
                    const m = porInv[invId];
                    const liquido = Math.round((m.resgate - m.aporte) * 100) / 100;
                    seq++;
                    if (Math.abs(liquido) < 0.005) continue; // aporte e resgate se anulam: nenhum movimento
                    const compensado = m.resgate > 0.004 && m.aporte > 0.004;
                    if (liquido > 0) {
                        movimentos.push({
                            id: `fut_${compra.id}_r${l.k}_${seq}`, k: l.k, data: dataBR, tipo: 'credito', valor: liquido,
                            descricao: `Resgate p/ ${compra.nome} (parc. ${nParc})${compensado ? ' (líq. do aporte)' : ''} — ${nomeCurtoInvestimento(invId)}`,
                            grupo: 'resgate', investimentoId: invId
                        });
                    } else {
                        movimentos.push({
                            id: `fut_${compra.id}_a${l.k}_${seq}`, k: l.k, data: dataBR, tipo: 'debito', valor: -liquido,
                            descricao: `Aporte p/ ${compra.nome}${compensado ? ' (líq. do resgate)' : ''} — ${nomeCurtoInvestimento(invId)}`,
                            grupo: 'aporte', investimentoId: invId
                        });
                    }
                }

                movimentos.push({
                    id: `fut_${compra.id}_p${l.k}`, k: l.k, data: dataBR, tipo: 'debito', valor: Math.round(l.parcela * 100) / 100,
                    descricao: `${compra.nome} (parcela ${nParc})`, grupo: 'parcela', investimentoId: ''
                });
            }
            return movimentos;
        }


        // (Re)gera os lançamentos da compra na Previsão/Investimento a partir da projeção
        // atual, PRESERVANDO os meses já travados (parcela conciliada com ✔): estes ficam
        // intactos e os demais são recriados. Usada tanto na efetivação (nada travado →
        // cria tudo) quanto a cada edição de correção/aporte ou conciliação na Previsão.
        function aplicarLancamentosCompra(compra) {
            normalizarFontesCompra(compra);
            const catParcela = (compra.categoria && compra.categoria !== '__nova__')
                ? garantirCategoria('despesas', compra.categoria)
                : garantirCategoria('despesas', compra.nome);
            const catResgate = garantirCategoria('receitas', 'Resgate Investimento');
            const catAporte = garantirCategoria('despesas', 'Aporte Investimento');
            compra.categoria = catParcela;

            // Mês travado = tem qualquer lançamento já conciliado na Previsão (parcela,
            // resgate ou aporte). O mês inteiro é preservado e não é regenerado.
            const travados = new Set();
            for (const f of appState.futureTransactions) {
                if (f.compraId === compra.id && f.conciliado) travados.add(futParcelaK(f));
            }

            const sim = simularQuitacao(planoDaCompra(compra));
            const movimentos = montarMovimentosCompra(compra, sim);

            // remove os lançamentos NÃO travados desta compra (revertendo reflexo)
            const manter = [];
            for (const f of appState.futureTransactions) {
                if (f.compraId === compra.id && !travados.has(futParcelaK(f))) {
                    if (f.investimentoId) reverterReflexoInvestimento(f);
                } else {
                    manter.push(f);
                }
            }
            appState.futureTransactions = manter;

            let criados = 0;
            for (const m of movimentos) {
                if (travados.has(m.k)) continue;
                const fut = {
                    id: m.id, data: m.data, tipo: m.tipo, valor: m.valor, descricao: m.descricao,
                    categoria: m.grupo === 'parcela' ? catParcela : (m.grupo === 'resgate' ? catResgate : catAporte),
                    investimentoId: m.investimentoId, compraId: compra.id, parcelaK: m.k, grupoCompra: m.grupo
                };
                if (fut.investimentoId) aplicarReflexoInvestimento(fut);
                appState.futureTransactions.push(fut);
                criados++;
            }
            return { criados, movimentos, sim, travados: travados.size };
        }


        // ====== CONTAS CORRENTES (múltiplas) ======
        function getContaById(id) { return (appState.contas || []).find(c => c.id === id) || null; }


        function contaIncluida(contaId) {
            const c = getContaById(contaId);
            if (!c) return false; // transação órfã não soma (evita inconsistências)
            return c.incluirDashboard !== false;
        }


        function garantirContas() {
            if (!Array.isArray(appState.contas)) appState.contas = [];
            // Cria a conta principal na 1ª execução, herdando o saldo inicial antigo
            if (appState.contas.length === 0) {
                appState.contas.push({
                    id: 'conta_principal',
                    nome: 'Conta Principal',
                    saldoInicial: Number(appState.saldoInicial) || 0,
                    incluirDashboard: true
                });
            }
            // Migra transações antigas sem conta para a primeira conta
            const idsValidos = new Set(appState.contas.map(c => c.id));
            const principalId = appState.contas[0].id;
            for (let t of (appState.transactions || [])) {
                if (!t.contaId || !idsValidos.has(t.contaId)) t.contaId = principalId;
            }
            if (!contaSelecionadaId || !idsValidos.has(contaSelecionadaId)) contaSelecionadaId = principalId;
        }


        function getSaldoConta(contaId) {
            const c = getContaById(contaId);
            if (!c) return 0;
            let total = Number(c.saldoInicial) || 0;
            for (let t of appState.transactions) {
                if (t.contaId === contaId) total += (Number(t.credito)||0) - (Number(t.debito)||0);
            }
            return total;
        }


        function dataTransacaoISO(d) {
            if (!d) return '';
            let dd, mm, yyyy;
            if (d.includes('/')) {
                const p = d.split('/');
                if (p.length === 3) { dd = p[0]; mm = p[1]; yyyy = p[2]; }
                else if (p.length === 2) { dd = '01'; mm = p[0]; yyyy = p[1]; }
            } else if (d.includes('-')) {
                const p = d.split('-');
                if (p[0] && p[0].length === 4) { yyyy = p[0]; mm = p[1]; dd = p[2] || '01'; }
                else { dd = p[0]; mm = p[1]; yyyy = p[2]; }
            }
            if (!yyyy || !mm) return '';
            return `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd || '01').padStart(2,'0')}`;
        }


        function exportarExtratoExcel() {
            const conta = getContaById(contaSelecionadaId);
            if (!conta) { alert("Selecione uma conta corrente."); return; }
            if (typeof XLSX === 'undefined') { alert("Biblioteca de Excel não carregada."); return; }
            const ini = document.getElementById('export-data-ini').value;
            const fim = document.getElementById('export-data-fim').value;
            const linhas = appState.transactions
                .filter(t => t.contaId === contaSelecionadaId)
                .filter(t => {
                    const iso = dataTransacaoISO(t.data);
                    if (!iso) return false;
                    if (ini && iso < ini) return false;
                    if (fim && iso > fim) return false;
                    return true;
                })
                .sort((a,b) => dataTransacaoISO(a.data).localeCompare(dataTransacaoISO(b.data)));
            if (linhas.length === 0) { alert("Nenhuma transação no período selecionado para esta conta."); return; }
            let totEnt = 0, totSai = 0;
            const dados = linhas.map(t => {
                const ent = Number(t.credito) || 0;
                const sai = Number(t.debito) || 0;
                totEnt += ent; totSai += sai;
                return { Conta: conta.nome, Data: t.data || '', 'Descrição': t.descricao || '', Categoria: t.categoria || '', 'Entrada (R$)': ent, 'Saída (R$)': sai };
            });
            dados.push({ Conta: '', Data: '', 'Descrição': 'TOTAL', Categoria: '', 'Entrada (R$)': totEnt, 'Saída (R$)': totSai });
            const ws = XLSX.utils.json_to_sheet(dados);
            ws['!cols'] = [{wch:18},{wch:12},{wch:40},{wch:22},{wch:14},{wch:14}];
            const wb = XLSX.utils.book_new();
            const aba = (conta.nome.replace(/[\\\/\?\*\[\]:]/g, '-').substring(0,31)) || 'Extrato';
            XLSX.utils.book_append_sheet(wb, ws, aba);
            const nomeArq = `extrato_${conta.nome.replace(/[^\w\-]+/g,'_')}_${ini||'inicio'}_a_${fim||'fim'}.xlsx`;
            XLSX.writeFile(wb, nomeArq);
        }


        // ===== Selects de categoria "preguiçosos" =====
        // As listas de Conta Corrente e Cartão podem ter milhares de linhas; repetir as
        // dezenas de <option> de categorias em cada linha multiplica o HTML por ~20x e
        // deixa a troca de aba lenta. Cada select nasce só com a opção atual e a lista
        // completa é montada (com cache) no primeiro clique/foco, por delegação de evento.
        let _optsCache = {};


        // ========== INVESTIMENTOS COM CAMPO DE APORTE ==========
        function recalcularCascata(investimento, inicio) {
            const DIAS_ANO = 365;
            for (let i = inicio; i < investimento.historico.length; i++) {
                const linha = investimento.historico[i];
                let saldoAnterior = (i === 0) ? (investimento.valorInicial || 0) : investimento.historico[i-1].saldoFinal;
                if (i === 0 && linha.saldoAnterior !== undefined && linha.saldoAnterior !== null && linha.saldoAnterior !== 0) {
                    saldoAnterior = linha.saldoAnterior;
                }
                let rendimento;
                if (i === 0) {
                    rendimento = linha.rendimentoDiario ? 0 : saldoAnterior * ((linha.taxaAnual || 0) / 100 / 12);
                } else {
                    const dias = Math.max(0, diffDias(investimento.historico[i-1].data, linha.data));
                    const taxaDiaria = (linha.taxaAnual || 0) / 100 / DIAS_ANO;
                    rendimento = saldoAnterior * taxaDiaria * dias;
                }
                const aporte = linha.aporte || 0;
                const resgate = linha.resgate || 0;
                const saldoFinal = saldoAnterior + aporte + rendimento - resgate;
                linha.saldoAnterior = saldoAnterior;
                linha.rendimento = rendimento;
                linha.saldoFinal = saldoFinal;
            }
            if (investimento.historico.length) investimento.valor = investimento.historico[investimento.historico.length-1].saldoFinal;
        }


        // ====== REFLEXO: Previsão -> Investimento ======
        // Saída (debito) na previsão  = Aporte no investimento
        // Entrada (credito) na previsão = Resgate no investimento
        function aplicarReflexoInvestimento(fut) {
            if (!fut || !fut.investimentoId) return;
            const inv = appState.investimentos.find(i => i.id === fut.investimentoId);
            if (!inv) return;
            if (!inv.historico) inv.historico = [];

            const dataAlvo = dataBRParaISO(fut.data);       // "YYYY-MM-DD" (mesmo dia da previsão)
            const tipo = fut.tipo === 'debito' ? 'aporte' : 'resgate';
            const valor = Number(fut.valor) || 0;

            let linha = inv.historico.find(h => h.data === dataAlvo);
            let linhaCriada = false;

            if (!linha) {
                // Última linha existente ANTES da data alvo: define saldo anterior e taxa anual herdada
                const anteriores = inv.historico
                    .filter(h => h.data < dataAlvo)
                    .sort((a,b) => a.data.localeCompare(b.data));
                const prev = anteriores[anteriores.length - 1];
                const saldoAnterior = prev ? prev.saldoFinal : (inv.valorInicial || inv.valor || 0);
                const taxaAnual = prev ? (prev.taxaAnual || 0) : 0;
                linha = {
                    id: 'linha_' + Date.now() + '_' + Math.random().toString(36).substr(2,6),
                    data: dataAlvo, saldoAnterior, aporte: 0, taxaAnual,
                    resgate: 0, rendimento: 0, saldoFinal: saldoAnterior,
                    _autoReflexo: true, rendimentoDiario: true
                };
                inv.historico.push(linha);
                inv.historico.sort((a,b) => a.data.localeCompare(b.data));
                linhaCriada = true;
            }

            if (tipo === 'aporte') linha.aporte = (linha.aporte || 0) + valor;
            else linha.resgate = (linha.resgate || 0) + valor;

            fut.reflexo = { invId: inv.id, dataAlvo, tipo, valor, linhaId: linha.id, linhaCriada };

            const pos = inv.historico.findIndex(h => h.id === linha.id);
            recalcularCascata(inv, linhaCriada ? Math.max(0, pos - 1) : pos);
        }


        function reverterReflexoInvestimento(fut) {
            if (!fut || !fut.reflexo) return;
            const r = fut.reflexo;
            const inv = appState.investimentos.find(i => i.id === r.invId);
            if (inv && inv.historico) {
                let linha = inv.historico.find(h => h.id === r.linhaId)
                         || inv.historico.find(h => h.data === (r.dataAlvo || r.mesAno));
                if (linha) {
                    if (r.tipo === 'aporte') linha.aporte = (linha.aporte || 0) - r.valor;
                    else linha.resgate = (linha.resgate || 0) - r.valor;
                    if (Math.abs(linha.aporte || 0) < 0.005) linha.aporte = 0;
                    if (Math.abs(linha.resgate || 0) < 0.005) linha.resgate = 0;

                    const idx = inv.historico.findIndex(h => h.id === linha.id);
                    if (linha._autoReflexo && (linha.aporte || 0) === 0 && (linha.resgate || 0) === 0) {
                        inv.historico = inv.historico.filter(h => h.id !== linha.id);
                        if (inv.historico.length) recalcularCascata(inv, Math.max(0, idx - 1));
                        else inv.valor = inv.valorInicial || 0;
                    } else {
                        recalcularCascata(inv, Math.max(0, idx));
                    }
                }
            }
            delete fut.reflexo;
        }


        // ===== Backup: helpers de compressão (gzip) e criptografia (AES-GCM + PBKDF2) =====
        function _baixarBackup(blob, nome) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = nome;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        }

        const _temGzip = typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

        async function _gzip(u8) { const cs = new CompressionStream("gzip"); const w = cs.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(cs.readable).arrayBuffer()); }

        async function _gunzip(u8) { const ds = new DecompressionStream("gzip"); const w = ds.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }

        async function _deriveKey(senha, salt) {
            const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveKey"]);
            return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        }


        function exportData() {
            appState.ultimoBackup = new Date().toISOString();
            appState.backupAdiadoAte = null;
            const dataStr = JSON.stringify(appState, null, 2);
            _baixarBackup(new Blob([dataStr], { type: "application/json" }), `backup_financeiro_${new Date().toISOString().split('T')[0]}.json`);
            saveData();
        }


        // Exportar protegido (.pib): magic "FIN1" + flag(1) + salt(16) + iv(12) + ciphertext
        async function exportDataProtegido() {
            if (!window.crypto || !crypto.subtle) { alert("Criptografia indisponível neste navegador. Use o backup .json simples."); return; }
            const senha = prompt("Defina uma senha para o backup:");
            if (senha === null) return;
            if (senha.length < 4) { alert("Use uma senha com pelo menos 4 caracteres."); return; }
            if (prompt("Confirme a senha:") !== senha) { alert("As senhas não conferem."); return; }
            try {
                appState.ultimoBackup = new Date().toISOString();
                appState.backupAdiadoAte = null;
                let payload = new TextEncoder().encode(JSON.stringify(appState));
                const flag = _temGzip ? 1 : 0;
                if (flag) payload = await _gzip(payload);
                const salt = crypto.getRandomValues(new Uint8Array(16));
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const key = await _deriveKey(senha, salt);
                const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload));
                const magic = new TextEncoder().encode("FIN1");
                const out = new Uint8Array(4 + 1 + 16 + 12 + cipher.length);
                out.set(magic, 0); out[4] = flag; out.set(salt, 5); out.set(iv, 21); out.set(cipher, 33);
                _baixarBackup(new Blob([out], { type: "application/octet-stream" }), `backup_financeiro_${new Date().toISOString().split('T')[0]}.pib`);
                saveData();
            } catch (err) { alert("Falha ao gerar o backup protegido."); }
        }


        // ===== Lembrete de backup =====

        const DIAS_LEMBRETE_BACKUP = 30;


        // Normaliza texto para busca: minúsculas e sem acentos (mantém números)
        function normalizarTextoBusca(s) {
            return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        }


        function _aplicarBackup(imported) {
            if (!imported || typeof imported !== "object" || Array.isArray(imported)) throw new Error("formato");
            appState = imported;
            if (!appState.saldoInicial) appState.saldoInicial = 0;
            if (!appState.ccTransactions) appState.ccTransactions = [];
            if (!appState.investimentos) appState.investimentos = [];
            if (!appState.categories) appState.categories = { despesas: [], receitas: [] };
            if (!appState.orcamentos) appState.orcamentos = {};
            if (!appState.comprasParceladas) appState.comprasParceladas = [];
            if (appState.limiteDiasNegativos === undefined || appState.limiteDiasNegativos === null) appState.limiteDiasNegativos = 10;
            if (!appState.contas) appState.contas = [];
            garantirContas();
            const elSi = document.getElementById('input-saldo-inicial');
            if (elSi) elSi.value = Number(appState.saldoInicial || 0).toFixed(2);
            renderContasUI(); preencherFormConta();
            saveData();
        }


        // Importar — detecta automaticamente .json simples ou .pib protegido
        async function importData(e) {
            const file = e.target.files[0]; if (!file) return;
            try {
                const buf = new Uint8Array(await file.arrayBuffer());
                const ehProtegido = buf.length > 33 && String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) === "FIN1";
                let imported;
                if (ehProtegido) {
                    if (!window.crypto || !crypto.subtle) throw new Error("cripto");
                    const senha = prompt("Senha do backup protegido:");
                    if (senha === null) { e.target.value = ''; return; }
                    const flag = buf[4], salt = buf.slice(5, 21), iv = buf.slice(21, 33), cipher = buf.slice(33);
                    const key = await _deriveKey(senha, salt);
                    let plain;
                    try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher)); }
                    catch (_) { alert("Senha incorreta ou arquivo corrompido."); e.target.value = ''; return; }
                    if (flag === 1) plain = await _gunzip(plain);
                    imported = JSON.parse(new TextDecoder().decode(plain));
                } else {
                    imported = JSON.parse(new TextDecoder().decode(buf));
                }
                _aplicarBackup(imported);
                alert("Backup restaurado com sucesso para o banco de dados interno (IndexedDB)!");
            } catch (err) { alert("Arquivo inválido ou erro ao restaurar o backup."); }
            e.target.value = '';
        }


        function generateColors(count, type) {
            const colors = [];
            for (let i = 0; i < count; i++) {
                const hue = type === 'despesa' ? (i * 20) % 360 : (140 + (i * 25)) % 360; 
                colors.push(`hsl(${hue}, ${60 + (i % 3) * 15}%, ${45 + (i % 4) * 10}%)`);
            }
            return colors;
        }