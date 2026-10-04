import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';

// This checks completed server HTML in a DOM simulator. It does not render CSS,
// run the app in a browser, measure contrast, or replace manual keyboard testing.
const files = process.argv.slice(2);
const snapshots = files.length ? files : readdirSync('.smoke').filter(name => name.endsWith('.html')).map(name => `.smoke/${name}`);
let failures = 0;
for (const file of snapshots) {
  const dom = new JSDOM(readFileSync(file, 'utf8'), { url: 'http://localhost:3200', runScripts: 'outside-only', pretendToBeVisual: true });
  const { document } = dom.window;
  // Resolve React's streamed server segments without running application scripts.
  for (const segment of document.querySelectorAll('[hidden][id^="S:"]')) {
    const suffix = segment.id.slice(2);
    const placeholder = document.getElementById(`P:${suffix}`);
    const boundary = document.getElementById(`B:${suffix}`);
    if (placeholder) placeholder.replaceWith(...segment.childNodes);
    else if (boundary) {
      while (boundary.nextSibling && !(boundary.nextSibling.nodeType === 8 && boundary.nextSibling.textContent === '/$')) boundary.nextSibling.remove();
      boundary.replaceWith(...segment.childNodes);
    }
    segment.remove();
  }
  document.querySelectorAll('script, nextjs-portal').forEach(node => node.remove());
  dom.window.eval(axe.source);
  const result = await dom.window.axe.run(document, { rules: { 'color-contrast': { enabled: false } } });
  const serious = result.violations.filter(item => ['serious', 'critical'].includes(item.impact));
  failures += serious.length;
  console.log(`${file}: ${serious.length} serious/critical violations (${result.violations.length} total; CSS contrast excluded)`);
  for (const violation of result.violations) console.log(`  ${violation.impact}: ${violation.id} ${violation.nodes.map(node => node.target.join(' ')).join(', ')}`);
  dom.window.close();
}
if (failures) process.exitCode = 1;
