// Verify presentation colors without external font or network dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, 'www/terminal-scene.css'), 'utf8');
const color = name => {
  const match = css.match(new RegExp('--terminal-' + name + ':(#[0-9a-f]{6})', 'i'));
  assert.ok(match, name);
  return match[1];
};
const luminance = hex => hex.slice(1).match(/../g).map(v => parseInt(v,16)/255)
  .map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4)
  .reduce((sum,v,i) => sum + v*[.2126,.7152,.0722][i],0);
const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
const results = [];
for (const name of ['text','secondary','success','alert','error','hash']) {
  const ratio = contrast(color(name), color('bg'));
  assert.ok(ratio >= 7, `${name}: ${ratio}`);
  results.push(`${name} ${ratio.toFixed(1)}:1`);
}
for (const background of ['#172735','#101d28','#10212e']) assert.ok(contrast(color('text'),background)>=7);
assert.ok(contrast('#d5dfeb','#10212e')>=7, 'input placeholder');
assert.match(css,/--terminal-font:Consolas/);
assert.doesNotMatch(css,/@import|https?:\/\//);
assert.match(css,/\.shoot-mode \.terminal-output\{font-size:22px\}/);
console.log('PASS: white presentation palette, 7:1 minimum contrast, local coding font; '+results.join(', '));
