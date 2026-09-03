// Importação do Extrato Consolidado Santander (PDF): valida o PARSER
// (_santProcessarLinhas) com linhas sintéticas e a INTEGRAÇÃO
// (importarExtratoSantander) com a extração de PDF stubada.
const { abrirApp, fechar, novoRelatorio } = require('./harness');

const A = [
  'EXTRATO CONSOLIDADO INTELIGENTE', 'fevereiro/2026', 'Movimentacao',
  'Data Descricao Documento Movimento (R$) Saldo (R$)',
  'SALDO EM 31/01 1.000,00',
  '05/02 PAGAMENTO BOLETO 123 395,00- 605,00',
  '10/02 DEPOSITO PIX 500,00 1.105,00',
  '15/02 APLICACAO CONTAMAX 200,00- 905,00',
  'SALDO EM 28/02 905,00', 'Saldos por Periodo',
];
const B = [
  'janeiro/2026', 'Movimentacao', 'Data Descricao Documento Movimento (R$) Saldo (R$)',
  '28/12 COMPRA DEZ 50,00- 950,00',
  '05/01 TRANSFERENCIA PARA 300,00- 650,00', 'FULANO DE TAL',
  '10/01 SALARIO 2.000,00 2.650,00', 'Saldos por Periodo',
];

async function run() {
  const ctx = await abrirApp();
  const { page } = ctx;
  const { ok, resumo } = novoRelatorio();
  try {
    // ---- Parser: layout A ----
    let r = await page.evaluate(a => _santProcessarLinhas(a, false), A);
    ok('A: 3 lançamentos', r.rows.length === 3, JSON.stringify(r.rows.map(x => x.valor)));
    ok('A: sinais certos (-395,+500,-200)', r.rows[0].valor === -395 && r.rows[1].valor === 500 && r.rows[2].valor === -200, JSON.stringify(r.rows.map(x => x.valor)));
    ok('A: doc e descrição', r.rows[0].doc === '123' && r.rows[0].desc === 'PAGAMENTO BOLETO', JSON.stringify(r.rows[0]));
    ok('A: data com ano', r.rows[0].data === '05/02/2026', r.rows[0].data);
    ok('A: saldo confere', r.info.ok && Math.abs(r.info.saldo_ini - 1000) < 0.01 && Math.abs(r.info.saldo_fim - 905) < 0.01, JSON.stringify(r.info));

    // ---- Parser: linha de SALDO NÃO vira lançamento (bug do saldo somado 2x) ----
    // Só UM "SALDO EM" (com ANO) → cai no layout B; a linha de saldo deve ser ignorada.
    const Bsaldo = [
      'janeiro/2026', 'Movimentacao', 'Data Descricao Documento Movimento (R$) Saldo (R$)',
      'SALDO EM 31/12/2025 1.000,00',
      '05/01 COMPRA 100,00- 900,00',
      '10/01 SALARIO 2.000,00 2.900,00', 'Saldos por Periodo',
    ];
    let rs = await page.evaluate(a => _santProcessarLinhas(a, false), Bsaldo);
    ok('SALDO não é importado como lançamento', rs.rows.length === 2 && !rs.rows.some(x => Math.abs(x.valor) === 1000), JSON.stringify(rs.rows.map(x => x.valor)));
    ok('saldo inicial derivado do 1º saldo corrente (1000)', Math.abs(rs.info.saldo_ini - 1000) < 0.01 && rs.info.ok, JSON.stringify(rs.info));

    // ---- Parser: "SALDO EM" COM ANO é detectado (layout A) e não entra como linha ----
    const Ayear = [
      'EXTRATO CONSOLIDADO INTELIGENTE', 'fevereiro/2026', 'Movimentacao',
      'Data Descricao Documento Movimento (R$) Saldo (R$)',
      'SALDO EM 31/01/2026 1.000,00',
      '05/02 PAGAMENTO 395,00- 605,00',
      '10/02 DEPOSITO 500,00 1.105,00',
      'SALDO EM 28/02/2026 1.105,00', 'Saldos por Periodo',
    ];
    let ry = await page.evaluate(a => _santProcessarLinhas(a, false), Ayear);
    ok('SALDO EM com ano → layout A, 2 lançamentos', ry.info.layout === 'A' && ry.rows.length === 2, JSON.stringify({ l: ry.info.layout, n: ry.rows.length }));
    ok('SALDO EM com ano: saldo confere e não vira linha', ry.info.ok && !ry.rows.some(x => Math.abs(x.valor) === 1000 || Math.abs(x.valor) === 1105), JSON.stringify(ry.info));

    // ---- Parser: sem aplicações ----
    let r2 = await page.evaluate(a => _santProcessarLinhas(a, true), A);
    ok('A/semAplic: oculta CONTAMAX (2 linhas, 1 suprimido)', r2.rows.length === 2 && r2.info.suprimidos === 1, JSON.stringify({ n: r2.rows.length, s: r2.info.suprimidos }));
    ok('A/semAplic: balanço ainda usa tudo (ok)', r2.info.ok, JSON.stringify(r2.info));

    // ---- Parser: discrepância ----
    const Abad = A.map(l => l.startsWith('10/02') ? '10/02 DEPOSITO PIX 500,00 1.106,00' : l);
    let r3 = await page.evaluate(a => _santProcessarLinhas(a, false), Abad);
    // saldo corrente intermediário inconsistente: a cadeia acusa (ok=false), mesmo com os extremos batendo
    ok('A: discrepância detectada (cadeia de saldos)', r3.info.ok === false, JSON.stringify({ ok: r3.info.ok, diff: r3.info.diff }));

    // ---- Parser: layout B (saldo derivado, continuação, virada de ano) ----
    let rb = await page.evaluate(a => _santProcessarLinhas(a, false), B);
    ok('B: 3 lançamentos', rb.rows.length === 3, JSON.stringify(rb.rows.map(x => x.data + ' ' + x.valor)));
    ok('B: virada de ano (28/12/2025)', rb.rows[0].data === '28/12/2025', rb.rows[0].data);
    ok('B: continuação juntou descrição', /FULANO DE TAL/.test(rb.rows[1].desc), rb.rows[1].desc);
    ok('B: saldo inicial derivado = 1000', rb.info.saldo_ini_derivado && Math.abs(rb.info.saldo_ini - 1000) < 0.01, JSON.stringify(rb.info));
    ok('B: saldo confere', rb.info.ok, JSON.stringify(rb.info));

    // ---- Integração: importarExtratoSantander (extração de PDF stubada) ----
    const imp = await page.evaluate(async (linhasA) => {
      if (!appState.contas.length) garantirContas();
      contaSelecionadaId = appState.contas[0].id; appState.transactions = []; saveData();
      window.ensurePDF = async () => true;              // não precisa baixar o pdf.js
      window._santExtrairLinhas = async () => linhasA;  // devolve as linhas do "PDF"
      const inp = document.getElementById('fileInputSantander');
      const dt = new DataTransfer(); dt.items.add(new File(['x'], 'extrato-fev.pdf', { type: 'application/pdf' }));
      inp.files = dt.files;
      await importarExtratoSantander(inp);
      const t1 = appState.transactions.length;
      // reimporta o mesmo → dedup
      const dt2 = new DataTransfer(); dt2.items.add(new File(['x'], 'extrato-fev.pdf', { type: 'application/pdf' }));
      inp.files = dt2.files;
      await importarExtratoSantander(inp);
      return { t1, t2: appState.transactions.length, resumo: document.getElementById('santander-resultado').innerText };
    }, A);
    ok('Integração: importou 3 lançamentos', imp.t1 === 3, 't1=' + imp.t1);
    ok('Integração: reimportar não duplica', imp.t2 === 3, 't2=' + imp.t2);
    ok('Integração: resumo mostra "saldo confere"', /saldo confere/.test(imp.resumo), imp.resumo.slice(0, 80));

    ok('sem erros de página', ctx.errs.length === 0, ctx.errs.slice(0, 4).join(' | '));
  } finally {
    await fechar(ctx);
  }
  return resumo();
}

module.exports = { run };
if (require.main === module) run().then(r => { console.log(`\n${r.pass}/${r.total} passaram`); process.exit(r.pass === r.total ? 0 : 1); });
