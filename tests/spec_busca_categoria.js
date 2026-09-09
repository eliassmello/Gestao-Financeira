// Busca global: combobox de categoria por linha. Permite editar/definir a
// categoria direto no resultado (sem navegar); clicar no resto da linha navega.
const { abrirApp, fechar, novoRelatorio } = require('./harness');

async function run() {
  const ctx = await abrirApp();
  const { page } = ctx;
  const { ok, resumo } = novoRelatorio();
  try {
    await page.evaluate(() => {
      if (!appState.contas.length) garantirContas();
      contaSelecionadaId = appState.contas[0].id;
      appState.categories.despesas = ['Mercado', 'Transporte', 'Outros'];
      appState.categories.receitas = ['Salário', 'Outros'];
      appState.transactions = [{ id: 'tb1', data: '10/05/2026', descricao: 'MERCADO XYZ', contaId: appState.contas[0].id, credito: 0, debito: 150, categoria: '' }];
      appState.futureTransactions = [{ id: 'fp1', data: '20/05/2026', descricao: 'CONTA DE LUZ', tipo: 'debito', valor: 200, categoria: '' }];
      appState.ccTransactions = [];
      saveData();
      abrirBuscaGlobal();
    });

    // Busca "MERCADO" → combobox presente
    await page.evaluate(() => { document.getElementById('busca-global-input').value = 'MERCADO'; executarBuscaGlobal(); });
    await page.waitForTimeout(100);
    ok('combobox de categoria na linha', await page.evaluate(() => !!document.querySelector('#busca-global-resultados select.cat-select')));

    // Define categoria pelo combobox → grava no lançamento e NÃO navega (modal segue aberto)
    const res1 = await page.evaluate(() => {
      const sel = document.querySelector('#busca-global-resultados select.cat-select');
      prepararSelectCategoria(sel);
      sel.value = 'Mercado';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const t = appState.transactions.find(x => x.id === 'tb1');
      return { cat: t ? t.categoria : null, modalAberto: !document.getElementById('modal-busca').classList.contains('hidden') };
    });
    ok('categoria gravada no lançamento (banco)', res1.cat === 'Mercado', JSON.stringify(res1));
    ok('editar no combobox NÃO navega (modal aberto)', res1.modalAberto === true);

    // Mesma coisa numa PREVISÃO
    const res2 = await page.evaluate(() => {
      document.getElementById('busca-global-input').value = 'LUZ'; executarBuscaGlobal();
      const sel = document.querySelector('#busca-global-resultados select.cat-select');
      prepararSelectCategoria(sel);
      sel.value = 'Transporte';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const f = appState.futureTransactions.find(x => x.id === 'fp1');
      return { cat: f ? f.categoria : null };
    });
    ok('categoria gravada na previsão', res2.cat === 'Transporte', JSON.stringify(res2));

    // Clicar no RESTO da linha (descrição) navega e fecha a busca
    const res3 = await page.evaluate(() => {
      document.getElementById('busca-global-input').value = 'MERCADO'; executarBuscaGlobal();
      const linha = document.querySelector('#busca-global-resultados > div[role="button"]');
      const desc = linha.querySelector('p');
      desc.click();               // clique no texto (fora do combobox) → navega
      return {
        modalFechado: document.getElementById('modal-busca').classList.contains('hidden'),
        abaExtrato: !document.getElementById('tab-extrato').classList.contains('hidden'),
      };
    });
    await page.waitForTimeout(100);
    ok('clicar na linha navega (abre Conta Corrente)', res3.abaExtrato === true, JSON.stringify(res3));
    ok('clicar na linha fecha a busca', res3.modalFechado === true, JSON.stringify(res3));

    ok('sem erros de página', ctx.errs.length === 0, ctx.errs.slice(0, 4).join(' | '));
  } finally {
    await fechar(ctx);
  }
  return resumo();
}

module.exports = { run };
if (require.main === module) run().then(r => { console.log(`\n${r.pass}/${r.total} passaram`); process.exit(r.pass === r.total ? 0 : 1); });
