// Original kidOS sample content; no downloads or external assets.
export function starterFiles() {
  return {
    'index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My color lab</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <p class="eyebrow">MADE BY ME</p>
    <h1>My color lab</h1>
    <p>Pick a color. Make this little world your own.</p>
    <div id="swatch" aria-hidden="true"><span>★</span></div>
    <div class="colors" aria-label="Choose a color">
      <button data-color="#f4a340">Sunshine</button>
      <button data-color="#78bdba">Ocean</button>
      <button data-color="#bc98d5">Lavender</button>
      <button id="surprise">Surprise me!</button>
    </div>
    <p id="message" aria-live="polite">Your next idea starts with a color.</p>
    <p class="hint">Remix tip: edit the colors in script.js or the shape in style.css.</p>
  </main>
  <script src="script.js"></script>
</body>
</html>
`,
    'style.css': `/* Try changing the background, font, or border-radius! */
* { box-sizing: border-box; }
body { margin: 0; background: #f8f2e5; color: #30372f; font-family: system-ui, sans-serif; text-align: center; }
main { max-width: 620px; margin: auto; padding: 32px 20px; }
.eyebrow { font-size: 12px; font-weight: 800; letter-spacing: 3px; }
h1 { font-size: clamp(28px, 7vw, 48px); margin: 12px 0; }
#swatch { width: 170px; height: 170px; margin: 28px auto; display: grid; place-items: center; background: #f4a340; border: 3px solid #30372f; border-radius: 28px; box-shadow: 6px 6px 0 #30372f; transition: background 150ms; }
#swatch span { font-size: 86px; color: #fff9ea; }
.colors { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
button { min-height: 46px; padding: 10px 15px; background: #fffaf0; color: #30372f; border: 2px solid #30372f; border-radius: 6px; font: inherit; font-weight: 700; cursor: pointer; }
button:hover { background: #ebe5d8; }
button:focus-visible { outline: 3px solid #72529a; outline-offset: 4px; }
.hint { max-width: 420px; margin: 28px auto 0; font-size: 14px; line-height: 1.5; }
@media (prefers-reduced-motion: reduce) { #swatch { transition: none; } }
`,
    'script.js': `// Add your own favorite colors to this list.
const colors = ['#f4a340', '#78bdba', '#bc98d5', '#e7867b', '#a2bd72'];
const swatch = document.querySelector('#swatch');
const message = document.querySelector('#message');
let changes = 0;
function paint(color) {
  swatch.style.backgroundColor = color;
  changes += 1;
  message.textContent = 'Color ' + color + ' · ' + changes + (changes === 1 ? ' new idea!' : ' new ideas!');
}
document.querySelectorAll('[data-color]').forEach(button => {
  button.addEventListener('click', () => paint(button.dataset.color));
});
document.querySelector('#surprise').addEventListener('click', () => {
  paint(colors[Math.floor(Math.random() * colors.length)]);
});
`
  };
}
