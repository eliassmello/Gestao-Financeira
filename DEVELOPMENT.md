# Desenvolvimento — Gestão Financeira

App PWA de arquivo único (sem framework/bundler): HTML + JS puro + Tailwind.
GitHub Pages serve os arquivos como estão. Este documento cobre o que **não** é
óbvio ao abrir o código.

## Estrutura

| Arquivo | Papel |
|---|---|
| `index.html` | Markup de todas as abas + CSS próprio (tema escuro, tipografia, virtualização). |
| `js/services.js` | Modelo de dados, IndexedDB (Dexie), cálculos, importação/backup, loaders de libs. |
| `js/ui.js` | Renderização das telas, eventos e helpers de UI. |
| `css/tailwind.css` | **Gerado** — Tailwind pré-compilado (ver abaixo). Não editar à mão. |
| `sw.js` | Service worker (cache offline). |
| `tests/` | Testes e2e (Playwright). Ver `tests/README.md`. |

`services.js` e `ui.js` compartilham o mesmo escopo global (foram extraídos de um
`<script>` único); por isso as funções chamadas por `onclick=` no HTML são globais.

## CSS do Tailwind (estático)

O app **não** usa o CDN de desenvolvimento do Tailwind (que recompilava tudo no
navegador a cada abertura). O CSS é pré-compilado uma vez:

```bash
npx tailwindcss@3 -i css/input.css -o css/tailwind.css --minify
```

`tailwind.config.js` aponta o `content` para `index.html` e `js/**/*.js`. **Sempre
que adicionar/alterar classes** Tailwind no HTML ou nos templates de `ui.js`,
regenere o CSS e faça commit do `css/tailwind.css` atualizado. O tema escuro é
feito por CSS próprio (`.dark ...` no `index.html`), não pelo variant `dark:`.

## Carregamento sob demanda de libs

Para acelerar a abertura, as bibliotecas pesadas **não** entram no `<head>`. São
baixadas só quando usadas, via `ensureXLSX()`, `ensurePDF()` e `ensureChart()`
(em `services.js`). Só o Dexie (necessário no start) e o `css/tailwind.css` são
carregados diretamente. Versões ficam **fixas** na constante `_LIBS`.

Ao mexer nessas versões, atualize também `sw.js` (`CACHE_NAME` e a URL do Dexie) e
o `<script>` do Dexie no `index.html`.

## Service worker / cache

Ao publicar mudanças em `index.html`, `js/*` ou `css/*`, **incremente
`CACHE_NAME`** em `sw.js` (ex.: `financas-pwa-v69` → `v70`) para que os
dispositivos peguem a versão nova. A "casca" leve é pré-cacheada; Chart/xlsx/pdf
são cacheados no primeiro uso online (cache-on-the-fly no handler de `fetch`).

## Testes

```bash
cd tests && npm install && npx playwright install chromium && npm test
```

Rodam offline (servidor local + libs de CDN substituídas pelas cópias locais).
CI: `.github/workflows/tests.yml` roda a suíte em cada push/PR.
