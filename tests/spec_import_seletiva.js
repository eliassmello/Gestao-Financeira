// Importação Seletiva: mapeamento de colunas, os três formatos de valor
// (com sinal, colunas separadas e coluna C/D) e a deduplicação por ocorrência.
const { abrirApp, fechar, novoRelatorio } = require('./harness');

function planilha(page, aoa) {
  return page.evaluate((linhas) => {
    const ws = XLSX.utils.aoa_to_sheet(linhas);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'x');
    return Array.from(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })));
  }, aoa);
}
async function carregar(page, bytes) {
  await page.evaluate(async (arr) => {
    abrirImportSeletiva();
    const file = new File([new Uint8Array(arr)], 'ext.xlsx');
    const dt = new DataTransfer(); dt.items.add(file);
    const inp = document.getElementById('imp-sel-file'); inp.files = dt.files;
    await importSelEscolherArquivo(inp);
  }, bytes);
  await page.waitForTimeout(400);
}

async function run() {
  const ctx = await abrirApp();
  const { page } = ctx;
  const { ok, resumo } = novoRelatorio();
  try {
    await page.evaluate(async () => {
      await ensureXLSX();
      if (!appState.contas.length) garantirContas();
      contaSelecionadaId = appState.contas[0].id; appState.transactions = []; saveData();
    });

    // Formato coluna C/D (valor sem sinal)
    let bytes = await planilha(page, [
      ['Data', 'Histórico', 'Valor', 'C/D'],
      ['05/09/2026', 'SALARIO', '3.000,00', 'C'],
      ['06/09/2026', 'MERCADO', '150,00', 'D'],
      ['07/09/2026', 'TARIFA', '12,90', 'Débito'],
    ]);
    await carregar(page, bytes);
    const map = await page.evaluate(() => ({ valor: document.getElementById('imp-sel-col-valor').value, cd: document.getElementById('imp-sel-col-cd').value }));
    ok('auto-detecta Valor + C/D', map.valor === '2' && map.cd === '3', JSON.stringify(map));
    await page.evaluate(() => importSelImportar()); await page.waitForTimeout(300);
    let t = await page.evaluate(() => appState.transactions.map(x => ({ c: x.credito, d: x.debito, desc: x.descricao })));
    ok('C/D vira crédito/débito certo', t.some(x => x.c === 3000 && /SALARIO/.test(x.desc)) && t.some(x => x.d === 150) && t.some(x => x.d === 12.9), JSON.stringify(t));

    // Reimportar o mesmo arquivo não duplica
    await carregar(page, bytes);
    await page.evaluate(() => importSelImportar()); await page.waitForTimeout(300);
    ok('reimportar não duplica', (await page.evaluate(() => appState.transactions.length)) === 3);

    // Colunas separadas de Crédito/Débito, conta nova
    await page.evaluate(() => { appState.transactions = []; saveData(); });
    bytes = await planilha(page, [
      ['Data', 'Descrição', 'Crédito', 'Débito'],
      ['10/09/2026', 'PIX', '200,00', ''],
      ['11/09/2026', 'CONTA', '', '80,00'],
    ]);
    await carregar(page, bytes);
    await page.evaluate(() => importSelImportar()); await page.waitForTimeout(300);
    t = await page.evaluate(() => appState.transactions.map(x => ({ c: x.credito, d: x.debito })));
    ok('colunas separadas ok', t.some(x => x.c === 200) && t.some(x => x.d === 80), JSON.stringify(t));

    ok('sem erros de página', ctx.errs.length === 0, ctx.errs.slice(0, 4).join(' | '));
  } finally {
    await fechar(ctx);
  }
  return resumo();
}

module.exports = { run };
if (require.main === module) run().then(r => { console.log(`\n${r.pass}/${r.total} passaram`); process.exit(r.pass === r.total ? 0 : 1); });
