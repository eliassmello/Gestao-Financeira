// Parcelamentos futuros do cartão: reconstrução pelo VENCIMENTO.
// Cobre: (a) dedup por descrição+total (sem duplicar / sem reprojetar parcela paga),
// (b) fatura que vence no mês seguinte aparece, (c) parcela já vencida some,
// (d) parcela que vence hoje aparece no mês corrente, (e) Previsão sem contar em
// dobro com a recorrência da fatura, (f) compras distintas não se fundem.
const { abrirApp, fechar, novoRelatorio } = require('./harness');

const brToday = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };

async function pm(page, txs, cartoes) {
  return page.evaluate((a) => {
    appState.cartoes = a.cartoes || [{ id: 'c1', nome: 'Nubank', diaVencimento: 10 }];
    appState.ccTransactions = a.txs;
    const p = calcularParcelamentosFuturos('c1');
    const out = {};
    Object.keys(p).map(Number).sort((x, y) => x - y).forEach(n => { out[n] = p[n].map(z => `${z.parcela}/${z.total}`); });
    return out;
  }, { txs, cartoes });
}

async function run() {
  const ctx = await abrirApp();
  const { page } = ctx;
  const { ok, resumo } = novoRelatorio();
  try {
    const H = await page.evaluate(() => { const d = new Date(); return d.getFullYear() * 12 + (d.getMonth() + 1); });
    const proxVenc = await page.evaluate(() => { const d = new Date(); const n = d.getFullYear() * 12 + (d.getMonth() + 1) + 1; const y = Math.floor((n - 1) / 12), m = ((n - 1) % 12) + 1; return `10/${String(m).padStart(2, '0')}/${y}`; });
    const today = await page.evaluate(brToday);

    // (a) dedup — mesma compra 6x, centavos diferentes, importada em faturas de meses
    // PASSADOS (independe do dia de hoje): parcelas 1..4 estão claramente vencidas.
    const vencN = await page.evaluate((d) => { const n = new Date().getFullYear() * 12 + (new Date().getMonth() + 1) + d; const y = Math.floor((n - 1) / 12), m = ((n - 1) % 12) + 1; return `10/${String(m).padStart(2, '0')}/${y}`; }, -2);
    const vencN1 = await page.evaluate((d) => { const n = new Date().getFullYear() * 12 + (new Date().getMonth() + 1) + d; const y = Math.floor((n - 1) / 12), m = ((n - 1) % 12) + 1; return `10/${String(m).padStart(2, '0')}/${y}`; }, -1);
    let p = await pm(page, [
      { id: 'a1', cartaoId: 'c1', data: vencN, descricao: 'GELADEIRA (Parc. 02/06)', debito: 333.34, credito: 0 },
      { id: 'a2', cartaoId: 'c1', data: vencN1, descricao: 'GELADEIRA (Parc. 04/06)', debito: 333.33, credito: 0 },
    ]);
    const flat = Object.values(p).flat();
    ok('(a) sem duplicar (cada parcela 1x)', new Set(flat).size === flat.length, JSON.stringify(p));
    ok('(a) parcelas já vencidas (1..4) não reaparecem', !flat.some(x => ['1/6', '2/6', '3/6', '4/6'].includes(x)), JSON.stringify(flat));
    ok('(a) parcela futura 6/6 aparece', flat.includes('6/6'), JSON.stringify(flat));

    // (b) fatura vence mês seguinte → parcela aparece no mês seguinte
    p = await pm(page, [{ id: 'b1', cartaoId: 'c1', data: proxVenc, descricao: 'TV (Parc. 01/10)', debito: 500, credito: 0 }]);
    ok('(b) mês seguinte mostra 1/10', (p[H + 1] || []).includes('1/10'), JSON.stringify(p[H + 1] || []));
    ok('(b) mês corrente vazio (vence dia 10 do mês que vem)', !(p[H] || []).length, JSON.stringify(p[H] || []));

    // (c) parcela já vencida (mês passado) some
    ok('(c) nada em meses passados', !Object.keys(await pm(page, [{ id: 'c1x', cartaoId: 'c1', data: vencN1, descricao: 'RADIO (Parc. 05/06)', debito: 50, credito: 0 }])).map(Number).some(n => n < H), 'ok');

    // (d) parcela que vence HOJE aparece no mês corrente
    p = await pm(page, [{ id: 'd1', cartaoId: 'c1', data: today, descricao: 'CAMA (Parc. 02/05)', debito: 120, credito: 0 }]);
    ok('(d) vence hoje → aparece no mês corrente', (p[H] || []).includes('2/5'), JSON.stringify(p[H] || []));

    // (e) Previsão: não conta em dobro com a recorrência da fatura
    const dob = await page.evaluate((pv) => {
      appState.cartoes = [{ id: 'c1', nome: 'Nubank', diaVencimento: 10 }];
      appState.despesasCartao = [];
      appState.ccTransactions = [
        { id: 'e1', cartaoId: 'c1', data: pv, descricao: 'TV (Parc. 01/10)', debito: 500, credito: 0 },
        { id: 'e2', cartaoId: 'c1', data: pv, descricao: 'SOFA (Parc. 04/06)', debito: 200, credito: 0 },
      ];
      appState.recorrencias = [{ id: 'r1', nome: 'Fatura Nubank', valor: 1000, categoria: 'Nubank', tipo: 'debito' }];
      const ym = pv.split('/'); const dataRec = pv;
      appState.futureTransactions = [{ id: 'ft1', recorrenciaId: 'r1', categoria: 'Nubank', data: dataRec, valor: 1000, tipo: 'debito', conciliado: false }];
      sincronizarParcelasCartao();
      const nApos1 = appState.futureTransactions.filter(f => f.origemCartaoId === 'c1').length;
      sincronizarParcelasCartao();
      const nApos2 = appState.futureTransactions.filter(f => f.origemCartaoId === 'c1').length;
      // total do mês (mesma data pv): parcelas (origemCartaoId) + recorrência reduzida
      const doMes = appState.futureTransactions.filter(f => f.data === dataRec);
      const total = doMes.reduce((s, f) => s + (Number(f.valor) || 0), 0);
      return { total, idempotente: nApos1 === nApos2 };
    }, proxVenc);
    ok('(e) total do mês = base 1000 (sem dobrar)', Math.abs(dob.total - 1000) < 0.01, 'total=' + dob.total);
    ok('(e) sincronizar idempotente', dob.idempotente);

    // (f) compras distintas não se fundem
    const desc = await page.evaluate((pv) => {
      appState.cartoes = [{ id: 'c1', nome: 'Nubank', diaVencimento: 10 }];
      appState.ccTransactions = [
        { id: 'f1', cartaoId: 'c1', data: pv, descricao: 'NOTEBOOK (Parc. 01/04)', debito: 250, credito: 0 },
        { id: 'f2', cartaoId: 'c1', data: pv, descricao: 'CELULAR (Parc. 01/04)', debito: 300, credito: 0 },
      ];
      return [...new Set(Object.values(calcularParcelamentosFuturos('c1')).flat().map(p => p.desc))];
    }, proxVenc);
    ok('(f) compras diferentes separadas', desc.some(d => /NOTEBOOK/i.test(d)) && desc.some(d => /CELULAR/i.test(d)), JSON.stringify(desc));

    ok('sem erros de página', ctx.errs.length === 0, ctx.errs.slice(0, 4).join(' | '));
  } finally {
    await fechar(ctx);
  }
  return resumo();
}

module.exports = { run };
if (require.main === module) run().then(r => { console.log(`\n${r.pass}/${r.total} passaram`); process.exit(r.pass === r.total ? 0 : 1); });
