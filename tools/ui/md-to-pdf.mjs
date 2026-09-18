// 마크다운 문서를 인쇄용 PDF로 만든다. tools/md-to-pdf.sh가 컨테이너 안에서 실행한다.
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import puppeteer from 'puppeteer-core';

const input = process.env.INPUT;
const output = process.env.OUTPUT;
const docTitle = process.env.DOC_TITLE || path.basename(input, '.md');

const md = fs.readFileSync(input, 'utf8');
marked.setOptions({ gfm: true, breaks: false });
const body = marked.parse(md);

const css = `
  @page { size: A4; margin: 16mm 14mm 18mm; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:"Noto Sans CJK KR","Noto Sans KR",sans-serif;
         font-size:10.2pt; line-height:1.65; color:#1d2524; word-break:keep-all; }
  h1 { font-size:20pt; letter-spacing:-.5pt; margin:0 0 4pt; padding-bottom:8pt;
       border-bottom:2.5pt solid #087f79; color:#0b3b36; }
  h2 { font-size:14pt; margin:22pt 0 8pt; padding:6pt 10pt; background:#eef6f2;
       border-left:4pt solid #087f79; color:#0b3b36; break-after:avoid; break-inside:avoid; }
  h3 { font-size:11.5pt; margin:15pt 0 6pt; color:#14564e; break-after:avoid; }
  p { margin:6pt 0; }
  ul,ol { margin:6pt 0; padding-left:18pt; }
  li { margin:3pt 0; }
  strong { color:#0b3b36; }
  hr { border:0; border-top:1px solid #dfe6e3; margin:18pt 0; }
  code { font-family:"DejaVu Sans Mono",monospace; font-size:8.8pt;
         background:#f1f5f3; padding:1pt 3pt; border-radius:3px; color:#0f4f47; }
  pre { background:#f7faf9; border:1px solid #dfe6e3; border-left:3pt solid #9dc9bd;
        border-radius:4px; padding:9pt 11pt; margin:8pt 0; overflow:hidden;
        break-inside:avoid; white-space:pre-wrap; word-break:break-all; }
  pre code { background:none; padding:0; font-size:8.4pt; line-height:1.5; color:#233a36; }
  table { width:100%; border-collapse:collapse; margin:8pt 0; font-size:9.2pt;
          break-inside:avoid; }
  th,td { border:1px solid #d7e0dd; padding:5pt 7pt; text-align:left; vertical-align:top; }
  th { background:#eef6f2; color:#0b3b36; font-weight:700; }
  tbody tr:nth-child(even) { background:#fafcfb; }
  blockquote { margin:9pt 0; padding:8pt 12pt; background:#fffdf3;
               border-left:3pt solid #e0b84a; color:#5a4a1d; break-inside:avoid; }
  blockquote p { margin:3pt 0; }
  h2, h3 { page-break-after:avoid; }
`;

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>${docTitle}</title><style>${css}</style></head><body>${body}</body></html>`;

const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium-browser',
  args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.pdf({
  path: output, format: 'A4', printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: `<div style="font-size:7pt;color:#8a9793;width:100%;padding:0 14mm;">${docTitle}</div>`,
  footerTemplate: '<div style="font-size:7pt;color:#8a9793;width:100%;padding:0 14mm;text-align:right;">'
    + '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  margin: { top: '18mm', right: '14mm', bottom: '18mm', left: '14mm' }
});
await browser.close();
const kb = Math.round(fs.statSync(output).size / 1024);
console.log(`PDF 생성: ${output} (${kb} KB)`);
