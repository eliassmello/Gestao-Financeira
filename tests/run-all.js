// Roda todos os specs (spec_*.js) em sequência e soma os resultados.
// Sai com código != 0 se qualquer teste falhar (útil em CI).
const fs = require('fs');
const path = require('path');

(async () => {
  const specs = fs.readdirSync(__dirname).filter(f => /^spec_.*\.js$/.test(f)).sort();
  let pass = 0, total = 0, falhou = [];
  for (const spec of specs) {
    console.log(`\n========== ${spec} ==========`);
    try {
      const r = await require(path.join(__dirname, spec)).run();
      pass += r.pass; total += r.total;
      if (r.pass !== r.total) falhou.push(spec);
    } catch (e) {
      console.error('ERRO em', spec, e && e.message);
      falhou.push(spec);
    }
  }
  console.log(`\n================================`);
  console.log(`TOTAL: ${pass}/${total} passaram` + (falhou.length ? ` — falhas em: ${falhou.join(', ')}` : ''));
  process.exit(falhou.length ? 1 : 0);
})();
