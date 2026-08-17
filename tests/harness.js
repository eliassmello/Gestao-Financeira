// Harness compartilhado dos testes e2e: sobe um servidor estático do repositório,
// substitui as libs de CDN pelas cópias locais (offline/determinístico) e abre o app
// já autenticado (modo admin + senha criada), pronto para o cenário do teste.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const NM = path.join(__dirname, 'node_modules');
// Caminho fixo do Chromium quando presente (ambiente local); em CI a variável vem
// vazia e o Playwright usa o navegador que ele mesmo instalou.
const CHROMIUM_PATH = process.env.CHROMIUM_PATH !== undefined ? process.env.CHROMIUM_PATH : '/opt/pw-browsers/chromium';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// Servidor estático do diretório raiz do app.
function iniciarServidor() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
      res.statusCode = 404; return res.end('not found');
    }
    res.setHeader('Content-Type', MIME[path.extname(fp)] || 'text/plain');
    fs.createReadStream(fp).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Intercepta as libs de CDN e devolve a cópia local de node_modules.
function rotearCdn(ctx) {
  return ctx.route(/cdn\.jsdelivr\.net|unpkg\.com|cdn\.tailwindcss\.com/, r => {
    const u = r.request().url();
    let f = null;
    if (u.includes('chart')) f = path.join(NM, 'chart.js/dist/chart.umd.js');
    else if (u.includes('dexie')) f = path.join(NM, 'dexie/dist/dexie.js');
    else if (u.includes('xlsx')) f = path.join(NM, 'xlsx/dist/xlsx.full.min.js');
    if (f && fs.existsSync(f)) {
      return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) });
    }
    return r.fulfill({ status: 200, contentType: 'application/javascript', body: '/**/' });
  });
}

// Abre o app já autenticado. Retorna { browser, server, page, errs, base }.
async function abrirApp() {
  const server = await iniciarServidor();
  const base = `http://127.0.0.1:${server.address().port}`;
  const launchOpts = {};
  if (CHROMIUM_PATH && fs.existsSync(CHROMIUM_PATH)) launchOpts.executablePath = CHROMIUM_PATH;
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await rotearCdn(ctx);
  await ctx.route(/\/cafe\.json/, r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ v: 1, salt: 'a', admin: '', usuarios: [] }),
  }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('' + e.message));
  page.on('dialog', d => d.accept());
  await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof appState !== 'undefined');
  await page.waitForTimeout(300);
  await page.evaluate(() => localStorage.setItem('_acessoAdmin', '1'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.fill('#criar-senha-1', 'abcd');
  await page.fill('#criar-senha-2', 'abcd');
  await page.click('#tela-criar-senha button');
  await page.waitForTimeout(500);
  return { browser, server, page, errs, base };
}

async function fechar(ctx) {
  try { await ctx.browser.close(); } catch (e) {}
  try { ctx.server.close(); } catch (e) {}
}

// Pequeno coletor de asserções para os specs.
function novoRelatorio() {
  const res = [];
  const ok = (nome, cond, extra = '') => {
    res.push(!!cond);
    console.log((cond ? '✅' : '❌'), nome, extra);
  };
  const resumo = () => ({ pass: res.filter(Boolean).length, total: res.length });
  return { ok, resumo };
}

module.exports = { abrirApp, fechar, novoRelatorio };
