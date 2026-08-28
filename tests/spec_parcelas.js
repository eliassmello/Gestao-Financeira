// Regressão: parcelamentos futuros do cartão não devem DUPLICAR nem reprojetar
// parcelas já pagas quando as parcelas da MESMA compra têm centavos diferentes
// entre faturas (a dedup agrupa por descrição + total, sem o valor).
const { abrirApp, fechar, novoRelatorio } = require('./harness');

const H = () => { const d = new Date(); return d.getFullYear() * 12 + (d.getMonth() + 1); };
const venc = n => { const y = Math.floor((n - 1) / 12), m = ((n - 1) % 12) + 1; return `10/${String(m).padStart(2, '0')}/${y}`; };

async function porMes(page, ccTransactions) {
  return page.evaluate((txs) => {
    appState.cartoes = [{ id: 'c1', nome: 'Nubank', diaVencimento: 10 }];
    appState.ccTransactions = txs;
    const pm = calcularParcelamentosFuturos('c1');
    const out = {};
    Object.keys(pm).map(Number).sort((a, b) => a - b).forEach(n => { out[n] = pm[n].map(p => `${p.parcela}/${p.total}`); });
    return out;
  }, ccTransactions);
}

async function run() {
  const ctx = await abrirApp();
  const { page } = ctx;
  const { ok, resumo } = novoRelatorio();
  try {
    const h = await page.evaluate(H);

    // A) mesma compra, parcelas com centavos diferentes em faturas de meses distintos
    let pm = await porMes(page, [
      { id: 't1', cartaoId: 'c1', data: venc(h - 1), descricao: 'GELADEIRA (Parc. 01/03)', debito: 333.34, credito: 0 },
      { id: 't2', cartaoId: 'c1', data: venc(h), descricao: 'GELADEIRA (Parc. 02/03)', debito: 333.33, credito: 0 },
    ]);
    const todas = Object.values(pm).flat();
    ok('sem duplicar a 3/3', todas.filter(x => x === '3/3').length === 1, JSON.stringify(pm));
    ok('não reprojeta a parcela já paga (2/3)', !todas.includes('2/3'), JSON.stringify(pm));
    ok('mês corrente sem parcela já faturada', !(pm[h] || []).length, JSON.stringify(pm[h] || []));
    ok('3/3 fica no mês seguinte', (pm[h + 1] || []).includes('3/3'), JSON.stringify(pm[h + 1] || []));

    // B) compra nova única (1/10): projeta 2..10, sem duplicar
    pm = await porMes(page, [
      { id: 'b1', cartaoId: 'c1', data: venc(h), descricao: 'TV (Parc. 01/10)', debito: 500, credito: 0 },
    ]);
    const seq = Object.keys(pm).map(Number).sort((a, b) => a - b).map(n => (pm[n] || [])).flat();
    ok('projeta 2..10 (9 parcelas)', seq.length === 9 && seq[0] === '2/10' && seq[8] === '10/10', JSON.stringify(seq));

    // C) duas compras DIFERENTES não são fundidas
    pm = await porMes(page, [
      { id: 'c1a', cartaoId: 'c1', data: venc(h), descricao: 'NOTEBOOK (Parc. 01/04)', debito: 250, credito: 0 },
      { id: 'c2a', cartaoId: 'c1', data: venc(h), descricao: 'CELULAR (Parc. 01/04)', debito: 300, credito: 0 },
    ]);
    const desc = await page.evaluate(() => {
      const pm2 = calcularParcelamentosFuturos('c1');
      return Object.values(pm2).flat().map(p => p.desc);
    });
    ok('compras diferentes mantidas separadas', desc.some(d => /NOTEBOOK/i.test(d)) && desc.some(d => /CELULAR/i.test(d)), JSON.stringify([...new Set(desc)]));

    ok('sem erros de página', ctx.errs.length === 0, ctx.errs.slice(0, 4).join(' | '));
  } finally {
    await fechar(ctx);
  }
  return resumo();
}

module.exports = { run };
if (require.main === module) run().then(r => { console.log(`\n${r.pass}/${r.total} passaram`); process.exit(r.pass === r.total ? 0 : 1); });
