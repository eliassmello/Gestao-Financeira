// Features novas: Tendência por categoria (gráfico) e Relatório em PDF,
// incluindo a paridade entre os totais do relatório e os KPIs do Dashboard.
const { abrirApp, fechar, novoRelatorio } = require('./harness');

async function run() {
  const ctx = await abrirApp();
  const { page } = ctx;
  const { ok, resumo } = novoRelatorio();
  try {
    // Semeia dados determinísticos: mês de referência 05/2026 + meses anteriores (tendência).
    await page.evaluate(() => {
      if (!appState.contas.length) garantirContas();
      const cid = appState.contas[0].id;
      contaSelecionadaId = cid;
      appState.categories.despesas = ['Mercado', 'Transporte', 'Outros'];
      appState.categories.receitas = ['Salário', 'Outros'];
      appState.ccTransactions = [];
      appState.transactions = [
        { id: 'a', data: '10/05/2026', debito: 200, credito: 0, categoria: 'Mercado', contaId: cid },
        { id: 'b', data: '15/05/2026', debito: 50, credito: 0, categoria: 'Transporte', contaId: cid },
        { id: 'c', data: '20/05/2026', debito: 0, credito: 3000, categoria: 'Salário', contaId: cid },
        { id: 'd', data: '10/04/2026', debito: 100, credito: 0, categoria: 'Mercado', contaId: cid },
        { id: 'e', data: '10/03/2026', debito: 150, credito: 0, categoria: 'Mercado', contaId: cid },
      ];
      saveData();
      document.getElementById('dash-month-filter').value = '2026-05';
      document.getElementById('dash-range-filter').value = '1';
      switchTab('dashboard');
      renderRelatorio();
    });
    await page.waitForFunction(() => typeof Chart !== 'undefined', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(700);

    // KPIs esperados
    const kpi = await page.evaluate(() => ({
      rec: document.getElementById('card-receitas-periodo').innerText,
      des: document.getElementById('card-despesas-periodo').innerText,
    }));
    ok('KPI entradas = 3000', /3\.000,00/.test(kpi.rec), kpi.rec);
    ok('KPI saídas = 250', /(^|[^\d])250,00/.test(kpi.des), kpi.des);

    // Feature 4: tendência
    const tend = await page.evaluate(() => {
      const sel = document.getElementById('tend-cat');
      return { n: sel.options.length, val: sel.value, nota: document.getElementById('tend-nota').textContent, w: (document.getElementById('chartTendencia') || {}).width || 0 };
    });
    ok('dropdown de categorias preenchido', tend.n === 3, JSON.stringify(tend));
    ok('gráfico de tendência desenhado', tend.w > 0, 'w=' + tend.w);
    ok('nota da tendência (Mercado total 450)', /450,00/.test(tend.nota), tend.nota);
    // troca de categoria não quebra
    await page.evaluate(() => { const s = document.getElementById('tend-cat'); s.value = 'Transporte'; _onTendCatChange(); });
    await page.waitForTimeout(200);
    ok('troca de categoria ok', /50,00/.test(await page.evaluate(() => document.getElementById('tend-nota').textContent)));

    // Feature 6: relatório PDF (stub do print) + paridade com os KPIs
    await page.evaluate(() => { window.print = () => { window.__printed = true; }; gerarRelatorioPdf(); });
    await page.waitForTimeout(200);
    const rep = await page.evaluate(() => ({ printed: !!window.__printed, html: document.getElementById('relatorio-print').innerText }));
    ok('window.print chamado', rep.printed);
    ok('relatório traz Entradas 3.000,00', /Entradas[\s\S]*3\.000,00/.test(rep.html), rep.html.slice(0, 120));
    ok('relatório traz Saídas 250,00', /Sa[íi]das[\s\S]*250,00/.test(rep.html));
    ok('relatório lista Mercado 200,00', /Mercado[\s\S]*200,00/.test(rep.html));
    ok('relatório com período 05/2026', /05\/2026/.test(rep.html), rep.html.slice(0, 80));

    ok('sem erros de página', ctx.errs.length === 0, ctx.errs.slice(0, 4).join(' | '));
  } finally {
    await fechar(ctx);
  }
  return resumo();
}

module.exports = { run };
if (require.main === module) run().then(r => { console.log(`\n${r.pass}/${r.total} passaram`); process.exit(r.pass === r.total ? 0 : 1); });
