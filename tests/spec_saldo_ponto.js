// Conta Corrente: ícone 💰 que mostra o saldo da conta "naquele ponto" (âncora no
// saldo atual, recuando até logo após o lançamento clicado). Ignora filtros da lista.
const { abrirApp, fechar, novoRelatorio } = require('./harness');

async function run() {
  const ctx = await abrirApp();
  const { page } = ctx;
  const { ok, resumo } = novoRelatorio();
  try {
    await page.evaluate(() => {
      appState.contas = [{ id: 'cc1', nome: 'Teste', saldoInicial: 100, incluirDashboard: true }];
      contaSelecionadaId = 'cc1';
      appState.transactions = [
        { id: 't1', data: '01/01/2020', descricao: 'A', contaId: 'cc1', credito: 50, debito: 0, categoria: '' },
        { id: 't2', data: '05/01/2020', descricao: 'B', contaId: 'cc1', credito: 0, debito: 30, categoria: '' },
        { id: 't3', data: '10/01/2020', descricao: 'C', contaId: 'cc1', credito: 200, debito: 0, categoria: '' },
      ];
      saveData(); switchTab('extrato'); renderTransactionsBanco();
    });
    await page.waitForTimeout(250); // deixa o render (debounced do switchTab) assentar

    const norm = s => s.replace(/[  ]/g, ' ');
    const txt = async id => norm(await page.evaluate(i => (document.getElementById('saldo-ponto-' + i) || {}).textContent || '', id));
    const fc = async v => norm(await page.evaluate(x => formatCurrency(x), v));

    // saldo inicial 100: após t1=150, após t2=120, após t3=320 (=saldo atual da conta)
    ok('ícone 💰 presente nas linhas do banco', await page.evaluate(() => document.getElementById('transactionsContainerBanco').innerHTML.includes('mostrarSaldoNoPonto(')));

    await page.evaluate(() => mostrarSaldoNoPonto('t2'));
    ok('saldo após t2 = 120,00', (await txt('t2')).includes(await fc(120)), await txt('t2'));

    await page.evaluate(() => mostrarSaldoNoPonto('t1'));
    ok('saldo após t1 = 150,00', (await txt('t1')).includes(await fc(150)), await txt('t1'));

    await page.evaluate(() => mostrarSaldoNoPonto('t3'));
    ok('saldo após t3 = saldo atual da conta (320,00)', (await txt('t3')).includes(await fc(320)), await txt('t3'));
    ok('t3 bate com getSaldoConta', (await txt('t3')).includes(norm(await page.evaluate(() => formatCurrency(getSaldoConta('cc1'))))));

    // toggle: segundo clique esconde
    await page.evaluate(() => mostrarSaldoNoPonto('t2'));
    ok('segundo clique esconde (toggle)', await page.evaluate(() => document.getElementById('saldo-ponto-t2').classList.contains('hidden')));

    // ignora filtro de mês: filtra só janeiro? todos são jan; testa filtro "credito" e confere t2 ainda correto
    await page.evaluate(() => { document.getElementById('filterSelectBanco').value = 'credito'; renderTransactionsBanco(); });
    await page.waitForTimeout(150);
    await page.evaluate(() => mostrarSaldoNoPonto('t3'));
    ok('com filtro ativo, saldo ainda usa todos os lançamentos (t3=320)', (await txt('t3')).includes(await fc(320)), await txt('t3'));

    // cartão NÃO deve ter o ícone
    ok('cartão sem ícone de saldo', await page.evaluate(() => {
      const html = linhaTransacaoHtml({ id: 'x', data: '01/01/2020', descricao: 'z', debito: 10, credito: 0 },
        '<span></span>', 'text-rose-600', 'cartao', 'apagarLinhaCartao');
      return !html.includes('mostrarSaldoNoPonto(');
    }));

    ok('sem erros de página', ctx.errs.length === 0, ctx.errs.slice(0, 4).join(' | '));
  } finally {
    await fechar(ctx);
  }
  return resumo();
}

module.exports = { run };
if (require.main === module) run().then(r => { console.log(`\n${r.pass}/${r.total} passaram`); process.exit(r.pass === r.total ? 0 : 1); });
