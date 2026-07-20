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
        // Senha mestra em TEXTO, só na memória desta aba: capturada ao ligar/desbloquear
        // a proteção e reaproveitada em todos os backups (manual, automático e restauração),
        // para o usuário ter uma senha única. Nunca é gravada em lugar nenhum.
        let senhaSessao = null;


        let appState = {
            saldoInicial: 0,
            contas: [],
            cartoes: [],
            despesasCartao: [],
            lembretesResgateSuprimidos: [],
            informacoes: [],
            transactions: [],
            ccTransactions: [],
            futureTransactions: [],
            investimentos: [],
            categories: { despesas: [], receitas: [] },
            orcamentos: {},
            comprasParceladas: [],
            recorrencias: [],
            regrasCategoria: [],
            limiteDiasNegativos: 10,
            notificarVencimentos: false,
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

        let cartaoSelecionadoId = null;


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
            appState.recorrencias = appState.recorrencias || [];
            appState.regrasCategoria = appState.regrasCategoria || [];
            appState.cartoes = appState.cartoes || [];
            appState.despesasCartao = appState.despesasCartao || [];
            appState.lembretesResgateSuprimidos = appState.lembretesResgateSuprimidos || [];
            appState.informacoes = appState.informacoes || [];
            if (appState.notificarVencimentos === undefined) appState.notificarVencimentos = false;
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
                senhaSessao = senha;   // guarda a senha mestra (memória) p/ reuso nos backups
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
            senhaSessao = senha;   // senha mestra p/ reuso nos backups
        }

        // Desliga a proteção: grava o estado em texto puro e remove os vestígios cifrados.
        async function desativarCripto() {
            criptoAtivada = false;
            await saveToDB();                       // grava global + tabelas em texto puro
            await db.seguro.clear().catch(() => {});
            await db.config.delete('cripto').catch(() => {});
            chaveSessao = null; criptoSalt = null; senhaSessao = null;
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
                    garantirCartoes();
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
                    appState.recorrencias = confObj.recorrencias || [];
                    appState.regrasCategoria = confObj.regrasCategoria || [];
                    appState.notificarVencimentos = !!confObj.notificarVencimentos;
                    appState.limiteDiasNegativos = (confObj.limiteDiasNegativos !== undefined && confObj.limiteDiasNegativos !== null) ? confObj.limiteDiasNegativos : 10;
                    appState.ultimoBackup = confObj.ultimoBackup || null;
                    appState.backupAdiadoAte = confObj.backupAdiadoAte || null;
                    appState.contas = confObj.contas || [];
                    appState.cartoes = confObj.cartoes || [];
                    appState.despesasCartao = confObj.despesasCartao || [];
                    appState.lembretesResgateSuprimidos = confObj.lembretesResgateSuprimidos || [];
                    appState.informacoes = confObj.informacoes || [];
                    appState.transactions = tr || [];
                    appState.ccTransactions = cr || [];
                    appState.futureTransactions = pr || [];
                    appState.investimentos = inv || [];
                }
                garantirContas();
                garantirCartoes();
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
                    await db.config.put({ id: 'global', saldoInicial: appState.saldoInicial, categories: appState.categories, orcamentos: appState.orcamentos, comprasParceladas: appState.comprasParceladas, recorrencias: appState.recorrencias, regrasCategoria: appState.regrasCategoria, notificarVencimentos: appState.notificarVencimentos, limiteDiasNegativos: appState.limiteDiasNegativos, contas: appState.contas, cartoes: appState.cartoes, despesasCartao: appState.despesasCartao, lembretesResgateSuprimidos: appState.lembretesResgateSuprimidos, informacoes: appState.informacoes, ultimoBackup: appState.ultimoBackup, backupAdiadoAte: appState.backupAdiadoAte });
                    await db.transacoes.clear(); if(appState.transactions.length > 0) await db.transacoes.bulkPut(appState.transactions);
                    await db.cartao.clear(); if(appState.ccTransactions.length > 0) await db.cartao.bulkPut(appState.ccTransactions);
                    await db.previsoes.clear(); if(appState.futureTransactions.length > 0) await db.previsoes.bulkPut(appState.futureTransactions);
                    await db.investimentos.clear(); if(appState.investimentos.length > 0) await db.investimentos.bulkPut(appState.investimentos);
                });
            } catch(e) { console.error("Erro ao salvar no IndexedDB", e); }
        }

        
        function saveData() {
            _optsCache = {};
            safeRun(sincronizarLembretesResgate);   // mantém os lembretes de resgate em dia
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
                safeRun(agendarAutoBackup);
            }).catch(e => alert("Erro ao salvar no banco de dados."));
        }


        // ===== Lançamentos recorrentes (regras que geram previsões automaticamente) =====
        // Cada regra: { id, descricao, tipo, valor, categoria, freq('mensal'|'semanal'|'anual'),
        //   dia(1-31), diaSemana(0-6), mesAno(1-12), inicio('YYYY-MM-DD'), fim('YYYY-MM-DD'|null), ativo }
        // São materializadas como previsões (futureTransactions) com recorrenciaId, de hoje até
        // ~12 meses à frente. Recorrências já conciliadas (✔) são preservadas.
        const HORIZONTE_RECORRENCIA_MESES = 12;

        function _dataBRde(d) {
            return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        }
        // Datas de ocorrência de uma regra no intervalo [ini, fim] (objetos Date)
        function _ocorrenciasRecorrencia(rec, ini, fimH) {
            const out = [];
            const inicioRegra = rec.inicio ? new Date(dataCompleta(rec.inicio) + 'T00:00:00') : ini;
            const fimRegra = rec.fim ? new Date(dataCompleta(rec.fim) + 'T23:59:59') : fimH;
            const de = new Date(Math.max(ini.getTime(), inicioRegra.getTime()));
            const ate = new Date(Math.min(fimH.getTime(), fimRegra.getTime()));
            if (de > ate) return out;
            if (rec.freq === 'semanal') {
                const alvo = Number(rec.diaSemana) || 0;
                const c = new Date(de); c.setHours(0, 0, 0, 0);
                while (c.getDay() !== alvo) c.setDate(c.getDate() + 1);
                for (; c <= ate; c.setDate(c.getDate() + 7)) out.push(new Date(c));
            } else if (rec.freq === 'anual') {
                const dia = Math.min(31, Math.max(1, Number(rec.dia) || 1));
                const mes = Math.min(12, Math.max(1, Number(rec.mesAno) || 1));
                for (let y = de.getFullYear(); y <= ate.getFullYear(); y++) {
                    const ult = new Date(y, mes, 0).getDate();
                    const d = new Date(y, mes - 1, Math.min(dia, ult));
                    if (d >= de && d <= ate) out.push(d);
                }
            } else { // mensal (padrão)
                const dia = Math.min(31, Math.max(1, Number(rec.dia) || 1));
                let y = de.getFullYear(), m = de.getMonth();
                while (true) {
                    const ult = new Date(y, m + 1, 0).getDate();
                    const d = new Date(y, m, Math.min(dia, ult));
                    if (d > ate) break;
                    if (d >= de) out.push(d);
                    m++; if (m > 11) { m = 0; y++; }
                }
            }
            return out;
        }

        // (Re)gera as previsões das recorrências ativas, preservando as já conciliadas.
        // Retorna true se algo mudou (para persistir).
        function gerarLancamentosRecorrentes() {
            const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
            const fimH = new Date(hoje); fimH.setMonth(fimH.getMonth() + HORIZONTE_RECORRENCIA_MESES);
            const desejadas = {}; // id -> objeto previsão
            for (const rec of (appState.recorrencias || [])) {
                if (!rec.ativo) continue;
                const valor = Number(rec.valor) || 0;
                if (valor <= 0 || !rec.descricao) continue;
                for (const d of _ocorrenciasRecorrencia(rec, hoje, fimH)) {
                    const chave = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
                    const id = `rec_${rec.id}_${chave}`;
                    desejadas[id] = {
                        id, data: _dataBRde(d), tipo: rec.tipo, valor,
                        descricao: rec.descricao, categoria: rec.categoria || '',
                        investimentoId: '', recorrenciaId: rec.id
                    };
                }
            }
            let mudou = false;
            const idsRec = new Set();
            // Atualiza/insere as desejadas (mantendo conciliadas intactas)
            const porId = {};
            for (const f of appState.futureTransactions) if (f.id) porId[f.id] = f;
            for (const id in desejadas) {
                idsRec.add(id);
                const nova = desejadas[id];
                const existente = porId[id];
                if (!existente) { appState.futureTransactions.push(nova); mudou = true; }
                else if (!existente.conciliado) {
                    if (existente.valor !== nova.valor || existente.descricao !== nova.descricao || existente.categoria !== nova.categoria || existente.tipo !== nova.tipo) {
                        Object.assign(existente, nova); mudou = true;
                    }
                }
            }
            // Remove previsões recorrentes órfãs (regra apagada/alterada) que não foram conciliadas
            const antes = appState.futureTransactions.length;
            appState.futureTransactions = appState.futureTransactions.filter(f => {
                if (!f.recorrenciaId) return true;
                if (f.conciliado) return true;
                return idsRec.has(f.id);
            });
            if (appState.futureTransactions.length !== antes) mudou = true;
            return mudou;
        }

        // ===== Importação OFX (Open Financial Exchange) =====
        // Extrai os blocos <STMTTRN> (formato tolerante, sem exigir XML estrito).
        function parseOFX(texto) {
            const txns = [];
            const blocos = String(texto).split(/<STMTTRN>/i).slice(1);
            for (const b of blocos) {
                const tag = (t) => { const m = b.match(new RegExp('<' + t + '>([^<\\r\\n]*)', 'i')); return m ? m[1].trim() : ''; };
                const dt = tag('DTPOSTED').replace(/[^0-9]/g, '');
                if (dt.length < 8) continue;
                const dataBR = `${dt.slice(6, 8)}/${dt.slice(4, 6)}/${dt.slice(0, 4)}`;
                let amtStr = tag('TRNAMT').replace(/\s/g, '');
                if (amtStr.includes(',') && !amtStr.includes('.')) amtStr = amtStr.replace(',', '.');
                const amt = parseFloat(amtStr);
                if (isNaN(amt) || amt === 0) continue;
                const memo = (tag('MEMO') || tag('NAME') || 'Lançamento').replace(/&amp;/g, '&');
                txns.push({ data: dataBR, descricao: memo, credito: amt > 0 ? amt : 0, debito: amt < 0 ? Math.abs(amt) : 0, fitid: tag('FITID') });
            }
            return txns;
        }

        // ===== Contas a vencer (para banner/notificação) =====
        // Previsões de SAÍDA pendentes com vencimento entre hoje e hoje+dias.
        function contasAVencer(dias) {
            const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
            const limite = new Date(hoje); limite.setDate(limite.getDate() + (dias || 3));
            return (appState.futureTransactions || []).filter(f => {
                if (f.conciliado || f.tipo !== 'debito') return false;
                const d = converterDataBRParaDate(f.data); d.setHours(0, 0, 0, 0);
                return d >= hoje && d <= limite;
            }).sort((a, b) => converterDataBRParaDate(a.data) - converterDataBRParaDate(b.data));
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

            // 0) Regras definidas pelo usuário (prioridade máxima)
            const regras = appState.regrasCategoria || [];
            for (const r of regras) {
                if (!r || !r.texto || !r.categoria) continue;
                const regraEhDebito = (r.tipo !== 'receita');   // 'despesa' (ou ausente) => débito
                if (regraEhDebito !== !!isDebito) continue;
                if (desc.includes(String(r.texto).toLowerCase())) return r.categoria;
            }

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
        function processarConteudoCartao(content, e, dataVencimentoFatura, anoFaturaCartao, msgReconc) {
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
                // Deduplica por OCORRENCIA (multiset), nao por presenca: monta a contagem
                // do que JA existia antes desta importacao. Cada lancamento novo "consome"
                // uma ocorrencia existente identica (reimportacao da mesma fatura nao
                // duplica); esgotada a contagem, os iguais seguintes sao adicionados. Assim
                // uma fatura com o MESMO lancamento repetido de forma legitima (ex.: a mesma
                // assinatura em dois cartoes/portadores) importa todas as ocorrencias e
                // continua batendo com o total da fatura.
                const chaveDedup = (cartaoId, desc, dataCompra, valor) =>
                    `${cartaoId || ''}|${desc}|${dataCompra}|${(Math.round((Number(valor) || 0) * 100) / 100).toFixed(2)}`;
                const contagemExistente = new Map();
                for (const t of appState.ccTransactions) {
                    const mag = (Number(t.debito) || 0) + (Number(t.credito) || 0);
                    const k = chaveDedup(t.cartaoId || null, t.descricao, t.dataCompra, mag);
                    contagemExistente.set(k, (contagemExistente.get(k) || 0) + 1);
                }
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
                    
                    const cartaoAtivoId = getCartaoAtivo() ? getCartaoAtivo().id : cartaoSelecionadoId;
                    const kDedup = chaveDedup(cartaoAtivoId || null, descricaoFinal, dataOriginalCompraCompleta, valor);
                    const restante = contagemExistente.get(kDedup) || 0;
                    if (restante > 0) {
                        // Ja existe uma ocorrencia igual (reimportacao): consome e nao duplica.
                        contagemExistente.set(kDedup, restante - 1);
                    } else {
                        appState.ccTransactions.push({
                            id: realUniqueId, data: dataVencimentoReal, dataCompra: dataOriginalCompraCompleta,
                            descricao: descricaoFinal, credito: credito, debito: debito, categoria: finalCat || '', isDuplicate: false,
                            cartaoId: (getCartaoAtivo() ? getCartaoAtivo().id : (cartaoSelecionadoId || null))
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
                const sufixo = msgReconc || '';
                if (addedCount > 0) alert(`Foram importados ${addedCount} lançamentos do Cartão com sucesso.` + sufixo);
                else alert("Nenhum lançamento novo foi importado (já existem ou o arquivo está vazio)." + sufixo);

                sincronizarParcelasCartao();
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
                // Detecta o banco pelo conteudo: Caixa (CEF) tem layout proprio (secao
                // "Demonstrativo" com coluna Credito/Debito); caso contrario, Santander.
                const dataFallback = (dataVencimentoFatura || '').slice(0, 5); // "DD/MM"
                const ehCEF = detectarFaturaCEF(linhas);
                const resultado = ehCEF
                    ? converterPdfFaturaCEFParaCsv(linhas, dataFallback)
                    : converterPdfFaturaParaCsv(linhas);

                if (resultado.total === 0) {
                    alert("Nenhum lancamento foi encontrado no PDF. Verifique se e uma fatura Santander (secoes 'Despesas', 'Parcelamentos' e 'Pagamento e Demais Creditos') ou Caixa (secao 'Demonstrativo') no layout esperado.");
                    e.target.value = ''; return;
                }

                // Conferencia com o total declarado na fatura (Santander): compara a soma
                // dos lancamentos reconhecidos com o "Total Despesas/Debitos" do Resumo.
                // Avisa se houver diferenca (indicio de lancamento nao reconhecido).
                let msgReconc = '';
                if (!ehCEF) {
                    const resumo = extrairResumoFaturaSantander(linhas);
                    const fmt = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    if (resumo.despesas !== null) {
                        const diff = (resultado.somaDespesas || 0) - resumo.despesas;
                        if (Math.abs(diff) <= 0.02) {
                            msgReconc = `\n\n✅ Conferência OK: despesas reconhecidas ${fmt(resultado.somaDespesas)} conferem com o total da fatura (${fmt(resumo.despesas)}).`;
                            if (resumo.totalPagar !== null) msgReconc += `\nTotal a pagar da fatura: ${fmt(resumo.totalPagar)}.`;
                        } else {
                            msgReconc = `\n\n⚠️ Atenção: as despesas reconhecidas somam ${fmt(resultado.somaDespesas)}, mas a fatura declara ${fmt(resumo.despesas)} (diferença de ${fmt(Math.abs(diff))}). Pode haver lançamento não reconhecido — confira o PDF.`;
                        }
                    }
                }
                processarConteudoCartao(resultado.csv, e, dataVencimentoFatura, anoFaturaCartao, msgReconc);
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


        // Converte as linhas extraidas do PDF para o formato da rotina existente.
        //
        // Classifica CADA linha pela propria estrutura (data + valor), sem depender do
        // "modo" da secao — porque nas faturas com varios portadores as tabelas
        // continuam em outra coluna/pagina trazendo apenas o cabecalho repetido
        // ("Data Descricao Parcela R$ US$"), e marcos como "VALOR TOTAL", "JUROS E
        // CUSTO EFETIVO" ou o cabecalho do portador (XXXX XXXX) deixavam o modo preso
        // em "skip", fazendo o parser perder blocos inteiros de lancamentos.
        // Regras: uma linha vira lancamento se comeca com (indicador opcional) + data
        // DD/MM. O sinal do valor em R$ decide o tipo: negativo = Credito/estorno,
        // positivo = Despesa. O pagamento da fatura anterior (DEB AUTOM/PAGAMENTO) e
        // descartado. Lixo colado a direita (cabecalhos de outra coluna) e ignorado.
        // Retorna tambem a soma de despesas/creditos para conferencia com o total da fatura.
        function converterPdfFaturaParaCsv(linhas) {
            const V = '-?\\d{1,3}(?:\\.\\d{3})*,\\d{2}';
            // parcelada: [ind] DATA desc NN/NN R$ [US$] [lixo]
            const RE_PARC = new RegExp('^(?:\\d\\s+)?(\\d{2}/\\d{2})\\s+(.+?)\\s+(\\d{2}/\\d{2})\\s+(' + V + ')(?:\\s+' + V + ')?(?:\\s+\\D.*)?$');
            // avulsa: [ind] DATA desc R$ [US$] [lixo]
            const RE_AV = new RegExp('^(?:\\d\\s+)?(\\d{2}/\\d{2})\\s+(.+?)\\s+(' + V + ')(?:\\s+' + V + ')?(?:\\s+\\D.*)?$');
            const RE_IOF = new RegExp('^(?:\\d\\s+)?IOF DESPESA NO EXTERIOR\\s+(' + V + ')');

            let total = 0, ultimaData = null;
            let somaDespesas = 0, somaCreditos = 0;
            const saida = ['Tipo,Data,Descricao,Parcela,Valor'];

            const ehPagamentoFatura = (descNorm) =>
                descNorm.indexOf('DEB AUTOM') !== -1 || descNorm.indexOf('PAGAMENTO') !== -1;
            const emitir = (tipo, data, desc, parcela, valor) => {
                desc = String(desc).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
                saida.push([tipo, data, desc, parcela || '-', valor].join(','));
                total++;
            };

            for (const bruta of linhas) {
                const linhaLimpa = bruta.replace(/\s+/g, ' ').trim();
                const norm = normalizarTextoPdf(linhaLimpa);

                // IOF de despesa no exterior: linha sem data propria -> usa a data da compra anterior
                const mIof = norm.match(RE_IOF);
                if (mIof && ultimaData) {
                    const vIof = valorPdfParaDecimal(mIof[1]);
                    if (vIof && Math.abs(parseFloat(vIof)) > 0.005) {
                        const v = Math.abs(parseFloat(vIof));
                        emitir('Despesa', ultimaData, 'IOF DESPESA NO EXTERIOR', '-', v.toFixed(2));
                        somaDespesas += v;
                    }
                    continue;
                }

                // Parcelada tem prioridade (para capturar o campo NN/NN); senao, avulsa
                let m = linhaLimpa.match(RE_PARC), parcela = null, data, desc, valStr;
                if (m) { data = m[1]; desc = m[2]; parcela = m[3]; valStr = m[4]; }
                else { m = linhaLimpa.match(RE_AV); if (m) { data = m[1]; desc = m[2]; valStr = m[3]; } }
                if (!m) continue;

                const dec = valorPdfParaDecimal(valStr);
                if (dec === null) continue;
                const num = parseFloat(dec);
                ultimaData = data;
                if (Math.abs(num) < 0.005) continue; // 0,00 (ex.: anuidade zerada)

                const descNorm = normalizarTextoPdf(desc);
                if (num < 0) {
                    // Credito/estorno. O pagamento da fatura anterior nao e lancamento.
                    if (ehPagamentoFatura(descNorm)) continue;
                    emitir('Credito', data, desc, parcela, Math.abs(num).toFixed(2));
                    somaCreditos += Math.abs(num);
                } else {
                    emitir('Despesa', data, desc, parcela, num.toFixed(2));
                    somaDespesas += num;
                }
            }
            return { csv: saida.join('\n'), total: total, somaDespesas: somaDespesas, somaCreditos: somaCreditos };
        }


        // Le o bloco "Resumo da Fatura" do Santander para conferencia: total de
        // despesas/debitos (Brasil + Exterior), total de creditos e o total a pagar
        // (Saldo Desta Fatura). Retorna null nos campos nao encontrados.
        function extrairResumoFaturaSantander(linhas) {
            const V = '(\\d{1,3}(?:\\.\\d{3})*,\\d{2})';
            const pegar = (re) => {
                for (const l of linhas) {
                    const m = normalizarTextoPdf(l).match(re);
                    if (m) return parseFloat(valorPdfParaDecimal(m[1]));
                }
                return null;
            };
            const despBrasil = pegar(new RegExp('TOTAL DESPESAS/DEBITOS NO BRASIL\\s+' + V));
            const despExt = pegar(new RegExp('TOTAL DESPESAS/DEBITOS NO EXTERIOR\\s+' + V));
            const creditos = pegar(new RegExp('TOTAL DE CREDITOS\\s+' + V));
            const totalPagar = pegar(new RegExp('SALDO DESTA FATURA\\s+' + V));
            const despesas = (despBrasil === null && despExt === null) ? null : (despBrasil || 0) + (despExt || 0);
            return { despesas: despesas, creditos: creditos, totalPagar: totalPagar };
        }


        // Detecta se as linhas extraidas sao de uma fatura da Caixa (CEF), que tem
        // layout proprio: secao "Demonstrativo" com a coluna "Credito/Debito" (D/C
        // colado ao valor) em vez das secoes "Despesas/Parcelamentos" do Santander.
        function detectarFaturaCEF(linhas) {
            const txt = normalizarTextoPdf(linhas.join(' '));
            return txt.indexOf('CARTOES CAIXA') !== -1 ||
                   (txt.indexOf('DEMONSTRATIVO') !== -1 && txt.indexOf('CIDADE/PAIS') !== -1);
        }


        // Converte as linhas de uma fatura da CAIXA (CEF) para o mesmo formato
        // Tipo,Data,Descricao,Parcela,Valor consumido por processarConteudoCartao.
        // Cada lancamento traz o valor com sufixo D (debito=Despesa) ou C
        // (credito=Credito). Parcelamentos vem como "NN DE NN" no meio da linha e
        // as compras internacionais trazem dois valores (US$ e R$) — importamos so
        // o R$. A coluna Cidade/Pais fica junto da descricao (nao ha separador
        // confiavel no texto). Ruidos (fatura anterior, pagamento) sao descartados.
        function converterPdfFaturaCEFParaCsv(linhas, dataFallback) {
            const V = '\\d{1,3}(?:\\.\\d{3})*,\\d{2}'; // valor BR: 1.234,56
            const RE_NORMAL = new RegExp('^(\\d{2}/\\d{2})\\s+(.+?)\\s+(' + V + ')\\s*([DC])$');
            const RE_PARC = new RegExp('^(\\d{2}/\\d{2})\\s+(.+?)\\s+(\\d{2})\\s+DE\\s+(\\d{2})\\b.*?\\s(' + V + ')\\s*([DC])$');
            const RE_INTL = new RegExp('^(\\d{2}/\\d{2})\\s+(.+?)\\s+' + V + '\\s+(' + V + ')\\s*([DC])$');
            const RE_ANUID = new RegExp('^(ANUIDADE\\b.*?)(?:\\s+(\\d{2})\\s*/\\s*(\\d{2}))?\\s+(' + V + ')\\s*([DC])$', 'i');

            let modo = 'normal'; // 'normal' | 'parcelamento' | 'internacional'
            let total = 0;
            const saida = ['Tipo,Data,Descricao,Parcela,Valor'];

            const emitir = (tipo, data, desc, parcela, valor) => {
                desc = String(desc).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
                saida.push([tipo, data, desc, parcela || '-', valor].join(','));
                total++;
            };
            const ehRuido = (norm) => (
                norm.indexOf('FATURA ANTERIOR') !== -1 || norm.indexOf('OBRIGADO PELO PAGAMENTO') !== -1 ||
                norm.indexOf('TOTAL ') === 0 || norm === 'TOTAL' || norm.indexOf('VALOR TOTAL') === 0 ||
                norm.indexOf('SALDO') === 0 || norm.indexOf('DATA DESCRICAO') === 0 || norm.indexOf('DEMONSTRATIVO') === 0
            );

            for (const bruta of linhas) {
                const linha = bruta.replace(/\s+/g, ' ').trim();
                const norm = normalizarTextoPdf(linha);

                // Cabecalhos de secao definem o modo de parsing
                if (norm.indexOf('COMPRAS PARCELADAS') !== -1) { modo = 'parcelamento'; continue; }
                if (norm.indexOf('COMPRAS INTERNACIONAIS') !== -1) { modo = 'internacional'; continue; }
                if (norm.indexOf('COMPRAS') === 0 || norm.indexOf('COMPRAS (CARTAO') !== -1) { modo = 'normal'; continue; }
                if (/\(CARTAO\s+\d+\)/.test(norm)) { modo = 'normal'; } // novo portador

                // Anuidade: linha sem data propria -> usa a data de fallback (vencimento)
                if (norm.indexOf('ANUIDADE') === 0) {
                    const ma = linha.match(RE_ANUID);
                    if (ma) {
                        const v = valorPdfParaDecimal(ma[4]);
                        if (v && parseFloat(v) !== 0 && ma[5] === 'D' && dataFallback) {
                            const parc = (ma[2] && ma[3]) ? `${ma[2]}/${ma[3]}` : '';
                            emitir('Despesa', dataFallback, ma[1], parc, v);
                        }
                    }
                    continue;
                }

                if (ehRuido(norm)) continue;

                if (modo === 'parcelamento') {
                    const mp = linha.match(RE_PARC);
                    if (mp) {
                        const v = valorPdfParaDecimal(mp[5]);
                        if (v && parseFloat(v) !== 0) emitir('Despesa', mp[1], mp[2], `${mp[3]}/${mp[4]}`, v);
                        continue;
                    }
                    // parcelada sem "NN DE NN" reconhecivel -> cai no RE_NORMAL abaixo
                }

                if (modo === 'internacional') {
                    const mi = linha.match(RE_INTL); // dois valores: US$ (ignorado) e R$ (o ultimo)
                    if (mi) {
                        const v = valorPdfParaDecimal(mi[3]);
                        if (v && parseFloat(v) !== 0) emitir(mi[4] === 'C' ? 'Credito' : 'Despesa', mi[1], mi[2], '', v);
                        continue;
                    }
                    // IOF e demais linhas com um unico valor caem no RE_NORMAL abaixo
                }

                const m = linha.match(RE_NORMAL);
                if (!m) continue;
                const data = m[1];
                const desc = m[2];
                const v = valorPdfParaDecimal(m[3]);
                if (v === null || parseFloat(v) === 0) continue;
                if (m[4] === 'C') {
                    if (normalizarTextoPdf(desc).indexOf('PAGAMENTO') !== -1) continue;
                    emitir('Credito', data, desc, '', v);
                } else {
                    emitir('Despesa', data, desc, '', v);
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

        // Descrição "canônica" só para a chave de deduplicação de conta corrente: ignora
        // acentos, maiúsculas/minúsculas, pontuação, espaços repetidos, sufixos entre
        // colchetes (ex.: "[doc]") e o comprimento. Assim a MESMA transação importada por
        // caminhos diferentes (import padrão × Importação Seletiva) gera a MESMA chave e
        // não duplica. Não altera a descrição guardada — é usada apenas na comparação.
        function _normDescDedup(s) {
            return String(s == null ? '' : s)
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .toUpperCase()
                .replace(/\[[^\]]*\]/g, ' ')
                .replace(/[^A-Z0-9]+/g, ' ')
                .trim()
                .slice(0, 60);
        }
        // Chave única de dedup de conta corrente (usada pelos dois caminhos de importação).
        function chaveDedupContaCorrente(contaId, descricao, data, valor) {
            return `${contaId || ''}|${_normDescDedup(descricao)}|${data}|${(Math.round((Number(valor) || 0) * 100) / 100).toFixed(2)}`;
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
        function calcularParcelamentosFuturos(cartaoId) {
            const RE_PARC = /parc\w*\.?\s*(\d{1,3})\s*\/\s*(\d{1,3})/i;
            const compras = {};
            for (let t of appState.ccTransactions) {
                if (cartaoId && (t.cartaoId || null) !== cartaoId) continue;
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


        function _mesAnoDe(dataBR) { const p = String(dataBR || '').split('/'); return p.length === 3 ? `${p[2]}-${p[1]}` : ''; }

        // Despesas RECORRENTES do cartão (assinaturas, seguros etc. — não são parcelas):
        // repetem todo mês. Retorna { numMes(ano*12+mes) -> total } do mês atual até o
        // horizonte, para o cartão informado.
        function _despesasRecorrentesCartaoPorMes(cartaoId) {
            const totalMes = (appState.despesasCartao || [])
                .filter(d => d.cartaoId === cartaoId)
                .reduce((s, d) => s + (Number(d.valor) || 0), 0);
            const out = {};
            if (totalMes <= 0.005) return out;
            const hoje = new Date();
            const baseNum = hoje.getFullYear() * 12 + (hoje.getMonth() + 1);
            for (let i = 0; i <= HORIZONTE_RECORRENCIA_MESES; i++) out[baseNum + i] = totalMes;
            return out;
        }

        // Sincroniza as PARCELAS + DESPESAS RECORRENTES de TODOS os cartões na Previsão:
        // para cada cartão e cada mês futuro, cria uma saída com o total (parcelas do mês +
        // despesas recorrentes fixas), na data de vencimento do cartão (categoria = nome do
        // cartão). Esse total também é abatido do lançamento recorrente de mesmo nome.
        // Idempotente — regenera as previsões de cartão não conciliadas e preserva as já
        // conciliadas (efetivadas). Retorna true se algo mudou (para o chamador salvar).
        function sincronizarParcelasCartao() {
            const conciliadas = new Set(
                appState.futureTransactions
                    .filter(f => f.origemCartaoId && f.conciliado)
                    .map(f => `${f.origemCartaoId}|${_mesAnoDe(f.data)}`)
            );
            const desejadas = [];
            for (const cartao of (appState.cartoes || [])) {
                const porMes = calcularParcelamentosFuturos(cartao.id);
                const despMes = _despesasRecorrentesCartaoPorMes(cartao.id);
                const dia = Math.min(Math.max(parseInt(cartao.diaVencimento, 10) || 10, 1), 31);
                const meses = new Set([...Object.keys(porMes), ...Object.keys(despMes)]);
                for (const nStr of meses) {
                    const n = parseInt(nStr, 10);
                    const ano = Math.floor((n - 1) / 12), mes = ((n - 1) % 12) + 1;
                    const totalParc = (porMes[nStr] || []).reduce((s, p) => s + (Number(p.valor) || 0), 0);
                    const totalDesp = despMes[nStr] || 0;
                    const total = totalParc + totalDesp;
                    if (total <= 0.005) continue;
                    const ym = `${ano}-${String(mes).padStart(2, '0')}`;
                    if (conciliadas.has(`${cartao.id}|${ym}`)) continue;  // já efetivada: não regenera
                    const ultimoDia = new Date(ano, mes, 0).getDate();
                    const d = Math.min(dia, ultimoDia);
                    const dataBR = `${String(d).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
                    const temParc = totalParc > 0.005, temDesp = totalDesp > 0.005;
                    const rotulo = (temParc && temDesp) ? 'parcelas + recorrentes' : (temDesp ? 'recorrentes' : 'parcelas');
                    desejadas.push({
                        id: `cartao_${cartao.id}_${ano}${String(mes).padStart(2, '0')}`,
                        data: dataBR, tipo: 'debito', valor: Math.round(total * 100) / 100,
                        descricao: `Fatura ${cartao.nome} (${rotulo})`, categoria: cartao.nome,
                        investimentoId: '', origemCartaoId: cartao.id
                    });
                }
            }
            let mudou = false;
            const atuais = appState.futureTransactions.filter(f => f.origemCartaoId && !f.conciliado);
            const sig = (arr) => arr.map(f => `${f.origemCartaoId}|${f.data}|${f.valor}|${f.descricao}`).sort().join(';');
            if (sig(atuais) !== sig(desejadas)) {
                appState.futureTransactions = appState.futureTransactions
                    .filter(f => !(f.origemCartaoId && !f.conciliado))
                    .concat(desejadas);
                mudou = true;
            }

            // Desconto: o LANÇAMENTO RECORRENTE do cartão (categoria = nome do cartão),
            // que representa o pagamento da fatura, tem seu valor reduzido pelas PARCELAS
            // daquele mês. Assim as parcelas ficam visíveis e o total não conta em dobro
            // (recorrência mostra o "restante" da fatura). Idempotente: parte sempre do
            // valor-base da recorrência (rec.valor).
            const nomesCartao = new Set((appState.cartoes || []).map(c => c.nome));
            const parcPorNomeMes = {};
            for (const d of desejadas) {
                const ym = _mesAnoDe(d.data);
                parcPorNomeMes[`${d.categoria}|${ym}`] = (parcPorNomeMes[`${d.categoria}|${ym}`] || 0) + d.valor;
            }
            const jaReduzido = new Set();
            for (const f of appState.futureTransactions) {
                if (!f.recorrenciaId || f.conciliado || f.origemCartaoId) continue;
                if (!nomesCartao.has(f.categoria)) continue;
                const rec = appState.recorrencias.find(r => r.id === f.recorrenciaId);
                if (!rec) continue;
                const base = Number(rec.valor) || 0;
                const ym = _mesAnoDe(f.data);
                const chave = `${f.categoria}|${ym}`;
                let novo = base;
                if (!jaReduzido.has(chave)) {  // desconta as parcelas só na 1ª ocorrência do mês
                    jaReduzido.add(chave);
                    novo = Math.max(0, Math.round((base - (parcPorNomeMes[chave] || 0)) * 100) / 100);
                }
                if (Math.abs((Number(f.valor) || 0) - novo) > 0.005) { f.valor = novo; mudou = true; }
            }
            return mudou;
        }


        // Lembretes de resgate: para cada RESGATE previsto (Entrada refletida num
        // investimento) cujo investimento tem "diasResgate" > 0, cria uma linha de
        // lembrete na Previsão com valor R$ 0, "diasResgate" dias ANTES da data do
        // resgate — para lembrar de dar a ordem de desaplicação. Idempotente: regenera
        // os lembretes não conciliados e preserva os já conciliados.
        //
        // Dois casos param de gerar o lembrete (para ele não ficar na Previsão à toa):
        //  1) o usuário dispensou aquele aviso manualmente (apagou a linha) — a chave
        //     `investimentoId|dataDoResgate` fica em lembretesResgateSuprimidos;
        //  2) a data do RESGATE já passou (o resgate já ocorreu): o lembrete é inútil.
        function sincronizarLembretesResgate() {
            const suprimidos = new Set(appState.lembretesResgateSuprimidos || []);
            const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
            const desejados = [];
            for (const f of appState.futureTransactions) {
                if (f.lembreteResgateDe || f.conciliado) continue;
                if (!f.investimentoId || f.tipo !== 'credito') continue;  // resgate = Entrada refletida
                const inv = appState.investimentos.find(i => i.id === f.investimentoId);
                const dias = inv ? (parseInt(inv.diasResgate, 10) || 0) : 0;
                if (dias <= 0) continue;
                const chaveSup = `${f.investimentoId}|${f.data}`;
                if (suprimidos.has(chaveSup)) continue;              // dispensado manualmente
                const dResg = converterDataBRParaDate(f.data);
                if (dResg < hoje) continue;                          // resgate já ocorreu: sem necessidade
                const dLemb = new Date(dResg.getTime() - dias * 86400000);
                const dataBR = `${String(dLemb.getDate()).padStart(2, '0')}/${String(dLemb.getMonth() + 1).padStart(2, '0')}/${dLemb.getFullYear()}`;
                desejados.push({
                    id: `lembrete_${f.id}`, data: dataBR, tipo: 'credito', valor: 0,
                    descricao: `🔔 Ordem de resgate: ${inv.nome} — D+${dias} (resgate em ${f.data})`,
                    categoria: '', investimentoId: '', lembreteResgateDe: f.id, chaveSupLembrete: chaveSup
                });
            }
            const atuais = appState.futureTransactions.filter(f => f.lembreteResgateDe && !f.conciliado);
            const sig = (arr) => arr.map(f => `${f.lembreteResgateDe}|${f.data}|${f.descricao}`).sort().join(';');
            if (sig(atuais) === sig(desejados)) return false;
            appState.futureTransactions = appState.futureTransactions
                .filter(f => !(f.lembreteResgateDe && !f.conciliado))
                .concat(desejados);
            return true;
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


        // Saldo devedor em aberto das compras em Quitação a partir de um mês (YYYY-MM):
        // soma as parcelas projetadas restantes cujo vencimento cai naquele mês ou depois.
        // Sem mês informado, soma todas as parcelas restantes.
        function saldoDevedorQuitacaoDesde(mesAnoYYYYMM) {
            let total = 0;
            for (const compra of (appState.comprasParceladas || [])) {
                try {
                    if (!compra || !compra.mesPrimeira) continue;
                    const plano = planoDaCompra(compra);
                    if (!plano.restantes) continue;
                    const sim = simularQuitacao(plano);
                    for (const l of sim.linhas) {
                        const dataBR = dataParcelaQuitacao(compra.mesPrimeira, compra.dia, l.k);
                        const p = dataBR.split('/');
                        const ym = `${p[2]}-${p[1]}`;
                        if (!mesAnoYYYYMM || ym >= mesAnoYYYYMM) total += Number(l.parcela) || 0;
                    }
                } catch (e) { /* compra com dados incompletos: ignora */ }
            }
            return total;
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
            compra.categoria = catParcela;
            // Categoria específica do investimento processado (amarra com o Dashboard, que
            // trata "Aplicação em: X" / "Resgate de: X" como movimentação interna). Se o
            // investimento não for encontrado, cai numa categoria genérica.
            const catResgateDe = (invId) => {
                const inv = appState.investimentos.find(i => i.id === invId);
                return garantirCategoria('receitas', inv ? `Resgate de: ${inv.nome}` : 'Resgate Investimento');
            };
            const catAplicacaoEm = (invId) => {
                const inv = appState.investimentos.find(i => i.id === invId);
                return garantirCategoria('despesas', inv ? `Aplicação em: ${inv.nome}` : 'Aporte Investimento');
            };

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
                const cat = m.grupo === 'parcela' ? catParcela
                    : (m.grupo === 'resgate' ? catResgateDe(m.investimentoId) : catAplicacaoEm(m.investimentoId));
                const fut = {
                    id: m.id, data: m.data, tipo: m.tipo, valor: m.valor, descricao: m.descricao,
                    categoria: cat,
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


        // ===== Cartões (múltiplos) =====
        function getCartaoById(id) { return (appState.cartoes || []).find(c => c.id === id) || null; }
        function getCartaoAtivo() { return getCartaoById(cartaoSelecionadoId) || (appState.cartoes || [])[0] || null; }

        // Dia de vencimento mais comum entre as faturas já importadas (para o cartão migrado)
        function _diaVencimentoMaisComum() {
            const cont = {};
            for (const t of (appState.ccTransactions || [])) {
                const p = String(t.data || '').split('/');
                if (p.length === 3) { const d = parseInt(p[0], 10); if (d >= 1 && d <= 31) cont[d] = (cont[d] || 0) + 1; }
            }
            let best = null, bestN = 0;
            for (const d in cont) if (cont[d] > bestN) { best = parseInt(d, 10); bestN = cont[d]; }
            return best;
        }

        // Migração aditiva e segura: garante ao menos um cartão, marca "cartão atual" no
        // legado, atribui cartaoId a toda transação de cartão e deixa o nome do cartão
        // presente nas categorias de despesa (ajuda a sincronização das parcelas).
        function garantirCartoes() {
            if (!Array.isArray(appState.cartoes)) appState.cartoes = [];
            if (appState.cartoes.length === 0) {
                appState.cartoes.push({
                    id: 'cartao_atual',
                    nome: 'cartão atual',
                    diaVencimento: _diaVencimentoMaisComum() || 10
                });
            }
            const idPadrao = appState.cartoes[0].id;
            for (const t of (appState.ccTransactions || [])) {
                if (!t.cartaoId || !appState.cartoes.some(c => c.id === t.cartaoId)) t.cartaoId = idPadrao;
            }
            if (!cartaoSelecionadoId || !appState.cartoes.some(c => c.id === cartaoSelecionadoId)) {
                cartaoSelecionadoId = idPadrao;
            }
            for (const c of appState.cartoes) garantirCategoria('despesas', c.nome);
        }

        // Renomeia uma categoria propagando para lançamentos, orçamentos, recorrências e regras.
        function renomearCategoria(tipo, antigo, novo) {
            antigo = String(antigo || '').trim(); novo = String(novo || '').trim();
            if (!antigo || !novo || antigo === novo) return;
            if (!appState.categories[tipo]) appState.categories[tipo] = [];
            const arr = appState.categories[tipo];
            const i = arr.indexOf(antigo);
            if (i >= 0) { if (arr.includes(novo)) arr.splice(i, 1); else arr[i] = novo; }
            else if (!arr.includes(novo)) arr.push(novo);
            if (appState.orcamentos && appState.orcamentos[antigo] !== undefined) {
                appState.orcamentos[novo] = appState.orcamentos[antigo];
                delete appState.orcamentos[antigo];
            }
            const upd = (list) => { for (const t of (list || [])) if (t.categoria === antigo) t.categoria = novo; };
            upd(appState.transactions); upd(appState.ccTransactions); upd(appState.futureTransactions);
            for (const r of (appState.recorrencias || [])) if (r.categoria === antigo) r.categoria = novo;
            for (const rg of (appState.regrasCategoria || [])) if (rg.categoria === antigo) rg.categoria = novo;
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

        // ===== Controle de acesso (lista de usuários autorizados) =====
        // A lista publicada guarda apenas HASHES dos nomes (nunca o texto), então o
        // arquivo distribuído no repositório não revela quem são os usuários. O nome é
        // normalizado (sem acento, minúsculo, espaços colapsados) antes de virar hash,
        // para "João Silva" e "joao  silva" baterem igual.
        function _normalizeAcesso(txt) {
            return String(txt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .trim().toLowerCase().replace(/\s+/g, ' ');
        }
        function _hexToBytes(hex) {
            const s = String(hex || ''); const out = new Uint8Array(s.length / 2);
            for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
            return out;
        }
        function _bytesToHex(u8) {
            return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        // Hash lento (PBKDF2) do nome/senha com o salt do arquivo — mesmo algoritmo nos
        // dois lados (gerar a lista e conferir na entrada), senão os hashes não batem.
        async function _hashAcesso(texto, saltHex) {
            const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(_normalizeAcesso(texto)), "PBKDF2", false, ["deriveBits"]);
            const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: _hexToBytes(saltHex), iterations: 120000, hash: "SHA-256" }, km, 256);
            return _bytesToHex(new Uint8Array(bits));
        }
        // A senha do painel de administração não é normalizada (respeita maiúsculas/símbolos).
        async function _hashSenhaAdmin(senha, saltHex) {
            const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(senha || '')), "PBKDF2", false, ["deriveBits"]);
            const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: _hexToBytes(saltHex), iterations: 120000, hash: "SHA-256" }, km, 256);
            return _bytesToHex(new Uint8Array(bits));
        }
        async function _sha256hex(txt) {
            const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(txt || '')));
            return _bytesToHex(new Uint8Array(d));
        }
        function _saltAleatorioHex(n) { return _bytesToHex(crypto.getRandomValues(new Uint8Array(n || 16))); }

        // Nome do arquivo de acesso publicado no repositório (propositalmente discreto).
        const ARQUIVO_ACESSO = 'cafe.json';

        // Busca a lista publicada. Retorna o objeto { salt, admin, usuarios } ou null se
        // não conseguir carregar (offline/ausente) — o chamador decide o que fazer (o
        // portão é "à prova de falha fechada": sem lista, ninguém novo entra).
        async function carregarListaAcesso() {
            try {
                const resp = await fetch('./' + ARQUIVO_ACESSO + '?ts=' + Date.now(), { cache: 'no-store' });
                if (!resp.ok) return null;
                const j = await resp.json();
                if (!j || typeof j !== 'object' || !Array.isArray(j.usuarios)) return null;
                return j;
            } catch (e) { return null; }
        }

        // Os nomes em texto viajam CIFRADOS (AES-GCM) dentro do cafe.json, no campo "adm".
        // Só a senha de administrador decifra — o público continua vendo apenas os hashes.
        // Assim o admin recupera os nomes reais em qualquer máquina.
        async function _chaveAdmin(senha, saltHex) {
            const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(senha || '')), "PBKDF2", false, ["deriveKey"]);
            return crypto.subtle.deriveKey({ name: "PBKDF2", salt: _hexToBytes(saltHex), iterations: 150000, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        }
        async function cifrarNomesAdmin(nomes, senha, saltHex) {
            const key = await _chaveAdmin(senha, saltHex);
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const data = new TextEncoder().encode(JSON.stringify(nomes || []));
            const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
            return _bytesToHex(iv) + ':' + _bytesToHex(ct);
        }
        async function decifrarNomesAdmin(blob, senha, saltHex) {
            const parts = String(blob || '').split(':');
            if (parts.length !== 2) throw new Error('formato');
            const key = await _chaveAdmin(senha, saltHex);
            const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: _hexToBytes(parts[0]) }, key, _hexToBytes(parts[1]));
            const arr = JSON.parse(new TextDecoder().decode(new Uint8Array(pt)));
            return Array.isArray(arr) ? arr : [];
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
            // Se a proteção do app está ligada, reaproveita a senha mestra (sem perguntar).
            let senha = senhaSessao;
            if (!senha) {
                senha = prompt("Defina uma senha para o backup:");
                if (senha === null) return;
                if (senha.length < 4) { alert("Use uma senha com pelo menos 4 caracteres."); return; }
                if (prompt("Confirme a senha:") !== senha) { alert("As senhas não conferem."); return; }
            }
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
                const nome = `backup_financeiro_${new Date().toISOString().split('T')[0]}.pib`;
                // Se há pasta de backup configurada, grava o arquivo nela; senão, baixa pelo navegador.
                const salvouNaPasta = await _salvarBackupNaPastaSeConfig(out, nome);
                if (!salvouNaPasta) _baixarBackup(new Blob([out], { type: "application/octet-stream" }), nome);
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
            if (!appState.recorrencias) appState.recorrencias = [];
            if (!appState.regrasCategoria) appState.regrasCategoria = [];
            if (!appState.cartoes) appState.cartoes = [];
            if (!appState.despesasCartao) appState.despesasCartao = [];
            if (!appState.lembretesResgateSuprimidos) appState.lembretesResgateSuprimidos = [];
            if (!appState.informacoes) appState.informacoes = [];
            if (appState.limiteDiasNegativos === undefined || appState.limiteDiasNegativos === null) appState.limiteDiasNegativos = 10;
            if (!appState.contas) appState.contas = [];
            garantirContas();
            garantirCartoes();
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
                    const flag = buf[4], salt = buf.slice(5, 21), iv = buf.slice(21, 33), cipher = buf.slice(33);
                    const tentar = async (senha) => {
                        const key = await _deriveKey(senha, salt);
                        let plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher));
                        if (flag === 1) plain = await _gunzip(plain);
                        return JSON.parse(new TextDecoder().decode(plain));
                    };
                    // tenta a senha mestra do app primeiro; se falhar/não houver, pede ao usuário
                    if (senhaSessao) { try { imported = await tentar(senhaSessao); } catch (_) {} }
                    if (!imported) {
                        const senha = prompt("Senha do backup protegido:");
                        if (senha === null) { e.target.value = ''; return; }
                        try { imported = await tentar(senha); }
                        catch (_) { alert("Senha incorreta ou arquivo corrompido."); e.target.value = ''; return; }
                    }
                } else {
                    imported = JSON.parse(new TextDecoder().decode(buf));
                }
                _aplicarBackup(imported);
                alert("Backup restaurado com sucesso para o banco de dados interno (IndexedDB)!");
            } catch (err) { alert("Arquivo inválido ou erro ao restaurar o backup."); }
            e.target.value = '';
        }


        // ============================================================================
        // Backup automático em pasta local (File System Access API — desktop)
        // ----------------------------------------------------------------------------
        // Grava/le um arquivo de backup numa pasta escolhida pelo usuário. Recurso de
        // desktop Chromium (Chrome/Edge). As preferências (pasta, senha) são LOCAIS do
        // aparelho: ficam em db.config 'autobkp' e NUNCA entram no backup exportável
        // (que é apenas o appState). Por segurança, o navegador exige um clique por
        // sessão para (re)autorizar o acesso à pasta.
        // ============================================================================

        let autoBkpCfg = null;      // { ativo, restaurarAoAbrir, salvarSenha, senha, nomeArquivo, dirNome, dirHandle, ultimoAutoBackupISO }
        let autoBkpHandle = null;   // FileSystemDirectoryHandle da sessão
        let _autoBkpTimer = null;

        function fsaDisponivel() { return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'; }

        async function carregarAutoBkp() {
            try {
                const cfg = await db.config.get('autobkp');
                if (cfg) { autoBkpCfg = cfg; if (cfg.dirHandle) autoBkpHandle = cfg.dirHandle; }
            } catch (e) {}
            return autoBkpCfg;
        }

        async function salvarAutoBkpCfg() {
            if (!autoBkpCfg) return;
            const rec = {
                id: 'autobkp',
                ativo: !!autoBkpCfg.ativo,
                restaurarAoAbrir: !!autoBkpCfg.restaurarAoAbrir,
                salvarSenha: !!autoBkpCfg.salvarSenha,
                senha: autoBkpCfg.salvarSenha ? (autoBkpCfg.senha || '') : '',  // só persiste se o usuário pediu
                nomeArquivo: autoBkpCfg.nomeArquivo || '',
                dirNome: autoBkpCfg.dirNome || '',
                dirHandle: autoBkpHandle || autoBkpCfg.dirHandle || null,
                ultimoAutoBackupISO: autoBkpCfg.ultimoAutoBackupISO || null
            };
            try { await db.config.put(rec); }
            catch (e) { try { await db.config.put({ ...rec, dirHandle: null }); } catch (_) {} }
        }

        // Confere a permissão de escrita na pasta. pedir=true chama requestPermission
        // (só funciona dentro de um gesto do usuário — clique).
        async function verificarPermissaoPasta(pedir) {
            if (!autoBkpHandle) return false;
            const opts = { mode: 'readwrite' };
            try {
                if (typeof autoBkpHandle.queryPermission === 'function' &&
                    (await autoBkpHandle.queryPermission(opts)) === 'granted') return true;
                if (pedir && typeof autoBkpHandle.requestPermission === 'function' &&
                    (await autoBkpHandle.requestPermission(opts)) === 'granted') return true;
            } catch (e) {}
            return false;
        }

        // Monta os bytes do backup: com senha -> .pib protegido; sem senha -> .json
        async function _construirBackupBytes(senha) {
            appState.ultimoBackup = new Date().toISOString();
            appState.backupAdiadoAte = null;
            if (senha) {
                let payload = new TextEncoder().encode(JSON.stringify(appState));
                const flag = _temGzip ? 1 : 0;
                if (flag) payload = await _gzip(payload);
                const salt = crypto.getRandomValues(new Uint8Array(16));
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const key = await _deriveKey(senha, salt);
                const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload));
                const out = new Uint8Array(4 + 1 + 16 + 12 + cipher.length);
                out.set(new TextEncoder().encode('FIN1'), 0); out[4] = flag; out.set(salt, 5); out.set(iv, 21); out.set(cipher, 33);
                return out;
            }
            return new TextEncoder().encode(JSON.stringify(appState, null, 2));
        }

        // Decodifica bytes de backup (detecta .pib protegido pelo magic "FIN1")
        async function _decodificarBackupBytes(buf, senha) {
            const ehProtegido = buf.length > 33 && String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) === 'FIN1';
            if (ehProtegido) {
                const flag = buf[4], salt = buf.slice(5, 21), iv = buf.slice(21, 33), cipher = buf.slice(33);
                const key = await _deriveKey(senha || '', salt);
                let plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
                if (flag === 1) plain = await _gunzip(plain);
                return JSON.parse(new TextDecoder().decode(plain));
            }
            return JSON.parse(new TextDecoder().decode(buf));
        }

        // Senha usada nos backups: se a proteção do app está ligada, reaproveita a senha
        // mestra (memória) — senha única para tudo. Sem proteção, usa a senha do próprio
        // backup automático (opcional, gravada no aparelho).
        function _senhaAutoBkp() {
            if (criptoAtivada && senhaSessao) return senhaSessao;
            return (autoBkpCfg && autoBkpCfg.senha) ? autoBkpCfg.senha : '';
        }

        // Grava um backup manual na pasta configurada (se houver e for autorizada).
        // Retorna true se gravou na pasta; false para o chamador cair no download normal.
        async function _salvarBackupNaPastaSeConfig(bytes, nome) {
            if (!autoBkpHandle) return false;
            if (!(await verificarPermissaoPasta(true))) return false;
            try {
                const fh = await autoBkpHandle.getFileHandle(nome, { create: true });
                const w = await fh.createWritable();
                await w.write(bytes); await w.close();
                alert(`Backup salvo na pasta "${(autoBkpCfg && autoBkpCfg.dirNome) || 'de backup'}":\n${nome}`);
                return true;
            } catch (e) { return false; }
        }


        // Grava o backup na pasta configurada. interativo=true permite pedir permissão.
        async function autoBackupSalvar(interativo) {
            if (!autoBkpCfg || !autoBkpCfg.ativo || !autoBkpHandle) return false;
            if (!(await verificarPermissaoPasta(interativo))) return false;
            try {
                const senha = _senhaAutoBkp();
                const bytes = await _construirBackupBytes(senha);
                // extensão coerente com o conteúdo (muda se a senha passar a existir/some)
                const ext = senha ? '.pib' : '.json';
                let nome = autoBkpCfg.nomeArquivo;
                if (!nome || !nome.endsWith(ext)) nome = 'backup-financeiro-auto' + ext;
                const fh = await autoBkpHandle.getFileHandle(nome, { create: true });
                const w = await fh.createWritable();
                await w.write(bytes); await w.close();
                autoBkpCfg.nomeArquivo = nome;
                autoBkpCfg.ultimoAutoBackupISO = appState.ultimoBackup;
                await salvarAutoBkpCfg();
                await saveToDB();  // persiste o novo ultimoBackup no appState
                safeRun(atualizarInfoUltimoBackup);
                return true;
            } catch (e) { console.error('auto-backup falhou', e); return false; }
        }

        // Agenda um auto-backup (debounce) após alterações, se ativo e autorizado.
        function agendarAutoBackup() {
            if (!autoBkpCfg || !autoBkpCfg.ativo || !autoBkpHandle) return;
            if (_autoBkpTimer) clearTimeout(_autoBkpTimer);
            _autoBkpTimer = setTimeout(() => { safeRun(() => autoBackupSalvar(false)); }, 2500);
        }

        // Le o backup da pasta e, se for MAIS NOVO que os dados locais, oferece restaurar
        // (sempre com confirmação — nunca sobrescreve sem perguntar).
        async function autoRestaurarSeMaisNovo(interativo) {
            if (!autoBkpCfg || !autoBkpHandle || !autoBkpCfg.nomeArquivo) return;
            if (!(await verificarPermissaoPasta(interativo))) return;
            try {
                const fh = await autoBkpHandle.getFileHandle(autoBkpCfg.nomeArquivo, { create: false }).catch(() => null);
                if (!fh) return;
                const file = await fh.getFile();
                const buf = new Uint8Array(await file.arrayBuffer());
                let senha = _senhaAutoBkp();
                let imported;
                try { imported = await _decodificarBackupBytes(buf, senha); }
                catch (_) {
                    senha = prompt('Senha do backup na pasta:') || '';
                    try { imported = await _decodificarBackupBytes(buf, senha); }
                    catch (__) { alert('Não foi possível ler o backup da pasta (senha incorreta?).'); return; }
                }
                const tPasta = (imported && imported.ultimoBackup) ? new Date(imported.ultimoBackup).getTime() : 0;
                const tLocal = appState.ultimoBackup ? new Date(appState.ultimoBackup).getTime() : 0;
                if (tPasta > tLocal + 1000) {
                    const fmt = (iso) => iso ? new Date(iso).toLocaleString('pt-BR') : 'nunca';
                    if (confirm(`O backup na pasta é mais recente que os dados deste aparelho:\n\nPasta: ${fmt(imported.ultimoBackup)}\nEste aparelho: ${fmt(appState.ultimoBackup)}\n\nRestaurar os dados da pasta? Os dados atuais deste aparelho serão substituídos.`)) {
                        _aplicarBackup(imported);
                        alert('Dados restaurados a partir da pasta de backup.');
                    }
                }
            } catch (e) { console.error('auto-restore falhou', e); }
        }


        function generateColors(count, type) {
            const colors = [];
            for (let i = 0; i < count; i++) {
                const hue = type === 'despesa' ? (i * 20) % 360 : (140 + (i * 25)) % 360; 
                colors.push(`hsl(${hue}, ${60 + (i % 3) * 15}%, ${45 + (i % 4) * 10}%)`);
            }
            return colors;
        }