// Quitação (visual): quando uma fonte é resgatada, a célula mostra também o
// "(de X)" = saldo disponível ANTES de pagar (sobra + resgate), esclarecendo
// que a fonte cobriu a parcela sozinha mesmo quando a sobra é menor que o resgate.
const { abrirApp, fechar, novoRelatorio } = require('./harness');

async function run() {
  const ctx = await abrirApp();
  const { page } = ctx;
  const { ok, resumo } = novoRelatorio();
  try {
    const html = await page.evaluate(() => {
      appState.investimentos = [{ id: 'i1', nome: 'CRESCIMENTO MEGA' }, { id: 'i2', nome: 'INFRA CDI' }];
      appState.comprasParceladas = [{
        id: 'cp1', status: 'efetivada', nome: 'Compra X', valorParcela: 65870.74, total: 22, pagas: 11,
        taxaIndexador: 0, mesPrimeira: '2026-10', dia: 25, aporte: 0,
        fontes: [{ investimentoId: 'i1', taxa: 0, saldo: 92862.51 }, { investimentoId: 'i2', taxa: 0, saldo: 113648.53 }],
        taxasMes: {}, aportesMes: {},
      }];
      compraQuitacaoId = 'cp1';
      switchTab('quitacao');
      renderSimulacaoQuitacao();
      return document.getElementById('quitacao-tabela').innerHTML;
    });
    ok('mostra o resgate (65.870,74)', /65\.870,74/.test(html), 'resgate ausente');
    ok('mostra "(de ...92.862,51)" — disponível antes de pagar', /\(de[^)]*92\.862,51\)/.test(html), 'disp ausente');
    ok('mostra a sobra (26.991,77)', /26\.991,77/.test(html), 'sobra ausente');
    ok('sem erros de página', ctx.errs.length === 0, ctx.errs.slice(0, 4).join(' | '));
  } finally {
    await fechar(ctx);
  }
  return resumo();
}

module.exports = { run };
if (require.main === module) run().then(r => { console.log(`\n${r.pass}/${r.total} passaram`); process.exit(r.pass === r.total ? 0 : 1); });
