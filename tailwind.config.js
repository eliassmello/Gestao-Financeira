/** Config do Tailwind para gerar o CSS estático (css/tailwind.css).
 *  Rebuild:  npx tailwindcss@3 -i css/input.css -o css/tailwind.css --minify
 *  O dark mode do app é feito por CSS próprio (.dark ...) no index.html, não pelo
 *  variant `dark:` do Tailwind — por isso não há darkMode aqui. */
module.exports = {
  content: ['./index.html', './js/**/*.js'],
  theme: { extend: {} },
  plugins: [],
};
