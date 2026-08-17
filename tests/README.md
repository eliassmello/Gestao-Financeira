# Testes end-to-end — Gestão Financeira

Testes de fumaça e de regressão que abrem o app num Chromium headless
(Playwright), sem tocar em rede: um servidor estático local serve o repositório
e as bibliotecas de CDN (Chart.js, Dexie, SheetJS) são **substituídas pelas
cópias locais** de `node_modules`. Assim os testes rodam offline e determinísticos.

## Rodar

```bash
cd tests
npm install
npx playwright install chromium   # baixa o navegador (uma vez)
npm test
```

Cada spec imprime `N/N passaram` e o `run-all.js` some os resultados.
Código de saída != 0 se algum teste falhar (bom para CI).

## O que é coberto

- `spec_smoke.js` — abertura do app: CSS estático aplicado, Chart/xlsx/pdf
  carregam **sob demanda**, troca por todas as abas, controle de fonte
  (A− / A / A+) com persistência, modo escuro e import via lazy-load do xlsx.
- `spec_import_seletiva.js` — Importação Seletiva: mapeamento de colunas,
  formatos de valor (com sinal, colunas separadas, e coluna C/D) e a
  deduplicação por ocorrência (não duplica ao reimportar).

Novos specs: crie `spec_*.js` exportando `async function run()` que devolve
`{pass, total}` e o `run-all.js` o inclui automaticamente.
