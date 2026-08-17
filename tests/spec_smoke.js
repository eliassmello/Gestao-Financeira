// Fumaça: abertura do app, CSS estático, carregamento sob demanda das libs,
// troca de abas, controle de fonte, modo escuro e import via lazy-load do xlsx.
const { abrirApp, fechar, novoRelatorio } = require('./harness');

async function run() {
  const ctx = await abrirApp();
  const { page, errs } = ctx;
  const { ok, resumo } = novoRelatorio();
  try {
    // CSS estático aplicado (header indigo-600) e tipografia
    const hb = await page.evaluate(() => getComputedStyle(document.querySelector('header')).backgroundColor);
    ok('CSS estático aplicado (header indigo)', hb === 'rgb(79, 70, 229)', hb);
    const tnum = await page.evaluate(() => getComputedStyle(document.body).fontVariantNumeric);
    ok('tabular-nums no body', /tabular-nums/.test(tnum), tnum);

    // Libs pesadas NÃO carregam no start
    const scripts = await page.evaluate(() => [...document.scripts].map(s => s.src));
    ok('sem cdn.tailwindcss.com', !scripts.some(s => s.includes('cdn.tailwindcss.com')));
    ok('xlsx não carregado no start', (await page.evaluate(() => typeof XLSX)) === 'undefined');
    ok('pdfjs não carregado no start', (await page.evaluate(() => typeof pdfjsLib)) === 'undefined');

    // Chart carrega sob demanda e desenha
    await page.waitForFunction(() => typeof Chart !== 'undefined', { timeout: 8000 }).catch(() => {});
    ok('Chart carregado sob demanda', (await page.evaluate(() => typeof Chart)) === 'function');
    await page.waitForTimeout(600);
    ok('gráfico desenhado no dashboard', await page.evaluate(() => { const c = document.getElementById('chartEvolucao'); return !!c && c.width > 0; }));

    // Todas as abas trocam sem erro
    for (const t of ['previsao', 'extrato', 'cartao', 'investimentos', 'quitacao', 'calendario', 'informacoes', 'calculos', 'config', 'dashboard']) {
      await page.evaluate(tb => switchTab(tb), t); await page.waitForTimeout(100);
    }
    ok('troca por todas as abas ok', await page.evaluate(() => !!document.querySelector('.tab-content:not(.hidden)')));

    // Controle de fonte
    await page.evaluate(() => switchTab('config')); await page.waitForTimeout(100);
    const base = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    await page.evaluate(() => ajustarFonte(1)); await page.waitForTimeout(100);
    const maior = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    ok('A+ aumenta a fonte', parseFloat(maior) > parseFloat(base), `${base} -> ${maior}`);
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(300);
    ok('escala reaplicada no reload', parseFloat(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs-user'))) > 1);
    await page.evaluate(() => ajustarFonte(0)); await page.waitForTimeout(80);
    ok('A volta ao padrão', (await page.evaluate(() => localStorage.getItem('app_fontscale'))) === '1');

    // Modo escuro
    await page.evaluate(() => toggleTema()); await page.waitForTimeout(100);
    ok('dark mode ativa classe', await page.evaluate(() => document.documentElement.classList.contains('dark')));
    ok('dark aplica fundo escuro', (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(15, 23, 42)');
    await page.evaluate(() => toggleTema()); await page.waitForTimeout(80);

    // xlsx lazy + import seletiva
    await page.evaluate(() => { if (!appState.contas.length) garantirContas(); contaSelecionadaId = appState.contas[0].id; appState.transactions = []; saveData(); });
    await page.evaluate(async () => {
      await ensureXLSX();
      const aoa = [['Data', 'Histórico', 'Valor'], ['05/09/2026', 'TESTE', '100,00']];
      const ws = XLSX.utils.aoa_to_sheet(aoa); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'x');
      const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
      abrirImportSeletiva();
      const file = new File([bytes], 'e.xlsx'); const dt = new DataTransfer(); dt.items.add(file);
      const inp = document.getElementById('imp-sel-file'); inp.files = dt.files; await importSelEscolherArquivo(inp);
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => importSelImportar()); await page.waitForTimeout(300);
    ok('xlsx lazy + import seletiva ok', (await page.evaluate(() => appState.transactions.length)) === 1);

    ok('sem erros de página', errs.length === 0, errs.slice(0, 4).join(' | '));
  } finally {
    await fechar(ctx);
  }
  return resumo();
}

module.exports = { run };
if (require.main === module) run().then(r => { console.log(`\n${r.pass}/${r.total} passaram`); process.exit(r.pass === r.total ? 0 : 1); });
