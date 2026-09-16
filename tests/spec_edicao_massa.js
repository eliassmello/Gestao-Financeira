// Edição em massa (Config): seleção por filtros + ação (categoria/valor/descrição)
// com pré-visualização e aplicação. Cobre Conta Corrente e Cartão.
const { abrirApp, fechar, novoRelatorio } = require('./harness');

async function run() {
  const ctx = await abrirApp();
  const { page } = ctx;
  const { ok, resumo } = novoRelatorio();
  const setv = (id, v) => page.evaluate(([i, val]) => { document.getElementById(i).value = val; }, [id, v]);
  try {
    await page.evaluate(() => {
      if (!appState.contas.length) garantirContas();
      const cid = appState.contas[0].id;
      appState.categories.despesas = ['Transporte', 'Outros'];
      appState.categories.receitas = ['Salário'];
      appState.transactions = [
        { id: 'b1', data: '05/09/2026', descricao: 'UBER TRIP 123', contaId: cid, debito: 20, credito: 0, categoria: '' },
        { id: 'b2', data: '06/09/2026', descricao: 'UBER EATS', contaId: cid, debito: 50, credito: 0, categoria: '' },
        { id: 'b3', data: '07/09/2026', descricao: 'SALARIO', contaId: cid, debito: 0, credito: 3000, categoria: 'Salário' },
      ];
      appState.ccTransactions = [
        { id: 'c1', data: '05/09/2026', descricao: 'NETFLIX', cartaoId: 'k1', debito: 55, credito: 0, categoria: '' },
      ];
      saveData(); switchTab('config');
    });

    // (1) categoria: UBER → Transporte
    await setv('me-escopo', 'banco'); await setv('me-desc', 'UBER'); await setv('me-acao', 'categoria'); await setv('me-nova-cat', 'Transporte');
    await page.evaluate(() => edicaoMassaPreview());
    ok('preview: 2 selecionados, 2 mudam', /2 selecionado\(s\) · 2 vão mudar/.test(await page.evaluate(() => document.getElementById('me-preview').innerText)));
    await page.evaluate(() => edicaoMassaAplicar());
    let r = await page.evaluate(() => appState.transactions.map(t => t.id + ':' + (t.categoria || '')));
    ok('categoria aplicada só nos UBER', r.includes('b1:Transporte') && r.includes('b2:Transporte') && r.includes('b3:Salário'), JSON.stringify(r));

    // (2) valor: UBER +10%
    await setv('me-acao', 'valor'); await setv('me-op', 'mult'); await setv('me-op-valor', '10');
    await page.evaluate(() => edicaoMassaAplicar());
    r = await page.evaluate(() => appState.transactions.filter(t => /UBER/.test(t.descricao)).map(t => t.debito));
    ok('valor +10% aplicado (20→22, 50→55)', r.includes(22) && r.includes(55), JSON.stringify(r));
    ok('salário (fora do filtro) intacto', (await page.evaluate(() => appState.transactions.find(t => t.id === 'b3').credito)) === 3000);

    // (3) descrição: localizar UBER → Uber
    await setv('me-acao', 'descricao'); await setv('me-loc', 'UBER'); await setv('me-sub', 'Uber');
    await page.evaluate(() => edicaoMassaAplicar());
    r = await page.evaluate(() => appState.transactions.map(t => t.descricao));
    ok('descrição substituída', r.includes('Uber TRIP 123') && r.includes('Uber EATS') && !r.some(d => /UBER/.test(d)), JSON.stringify(r));

    // (4) escopo Cartão: categoria
    await setv('me-escopo', 'cartao'); await setv('me-desc', 'NETFLIX'); await setv('me-acao', 'categoria'); await setv('me-nova-cat', 'Outros');
    await page.evaluate(() => edicaoMassaAplicar());
    ok('cartão: categoria aplicada', (await page.evaluate(() => appState.ccTransactions.find(t => t.id === 'c1').categoria)) === 'Outros');

    // (5) filtro que não casa nada
    await setv('me-desc', 'ZZZNADA');
    await page.evaluate(() => edicaoMassaPreview());
    ok('sem correspondência mostra aviso', /Nenhum lançamento casou/.test(await page.evaluate(() => document.getElementById('me-preview').innerText)));

    ok('sem erros de página', ctx.errs.length === 0, ctx.errs.slice(0, 4).join(' | '));
  } finally {
    await fechar(ctx);
  }
  return resumo();
}

module.exports = { run };
if (require.main === module) run().then(r => { console.log(`\n${r.pass}/${r.total} passaram`); process.exit(r.pass === r.total ? 0 : 1); });
