// Quitação: o aviso (lembrete) de resgate deve incluir o VALOR a resgatar.
const { abrirApp, fechar, novoRelatorio } = require('./harness');

async function run() {
  const ctx = await abrirApp();
  const { page } = ctx;
  const { ok, resumo } = novoRelatorio();
  try {
    const r = await page.evaluate(() => {
      appState.investimentos = [{ id: 'inv1', nome: 'INFRA CDI 6', diasResgate: 30, historico: [{ id: 'h1', data: '2026-08-01', saldoAnterior: 0, aporte: 100000, taxaAnual: 12, resgate: 0, rendimento: 0, saldoFinal: 100000 }] }];
      appState.lembretesResgateSuprimidos = [];
      appState.futureTransactions = [
        { id: 'fres', data: '25/11/2026', tipo: 'credito', valor: 24077.74, investimentoId: 'inv1', descricao: 'Resgate p/ Compra (parc. 13/22) — INFRA CDI 6', categoria: '' },
      ];
      sincronizarLembretesResgate();
      const lemb = appState.futureTransactions.find(f => f.lembreteResgateDe === 'fres');
      return lemb ? { desc: lemb.descricao, valor: lemb.valor, data: lemb.data } : null;
    });
    ok('aviso de resgate foi criado', !!r, JSON.stringify(r));
    ok('aviso mostra o valor a resgatar (24.077,74)', !!r && /24\.077,74/.test(r.desc), r && r.desc);
    ok('aviso continua R$ 0 (não mexe no saldo)', !!r && r.valor === 0, r && String(r.valor));
    ok('aviso fica 30 dias antes (mês anterior, ~26/10)', !!r && /\/10\/2026$/.test(r.data), r && r.data);
    ok('sem erros de página', ctx.errs.length === 0, ctx.errs.slice(0, 4).join(' | '));
  } finally {
    await fechar(ctx);
  }
  return resumo();
}

module.exports = { run };
if (require.main === module) run().then(r => { console.log(`\n${r.pass}/${r.total} passaram`); process.exit(r.pass === r.total ? 0 : 1); });
