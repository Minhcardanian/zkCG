const fs = require('node:fs');
const { chromium } = require('playwright');
const escape = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
async function main() {
  const source = fs.readFileSync('docs/TECHNICAL-REPORT-DRAFT.md','utf8');
  const sections = source.split(/\n\n+/).slice(2);
  const body = sections.map(section=>{
    if (section.startsWith('## ')) return `<h2>${escape(section.slice(3).trim())}</h2>`;
    const text = escape(section.trim()).replace(/`([^`]+)`/g,'<span class="code">$1</span>').replace(/\n/g,' ');
    return `<p>${text}</p>`;
  }).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: letter; margin: 0.65in 0.62in 0.7in; }
    body { margin:0; font-family:"Liberation Serif","DejaVu Serif",serif; font-size:10pt; line-height:1.2; color:#000; }
    header { text-align:center; margin-bottom:17pt; }
    h1 { font-size:19pt; line-height:1.1; font-weight:normal; margin:0 0 10pt; }
    .author { font-size:10pt; line-height:1.25; margin:0; text-align:center; }
    .columns { column-count:2; column-gap:0.25in; column-fill:auto; }
    h2 { font-size:9.5pt; text-transform:uppercase; text-align:center; font-weight:normal; break-after:avoid; margin:9pt 0 4pt; }
    p { margin:0 0 5pt; text-align:justify; hyphens:auto; orphans:3; widows:3; overflow-wrap:anywhere; }
    .code { font-family:monospace; font-size:8pt; }
    </style></head><body><header><h1>ZK Compliance Gate: A Privacy-Preserving<br>Eligibility Gateway for Ethereum dApps</h1><p class="author">Bùi Quang Minh<br>Vietnamese-German University<br>61CSE325 · Winter Semester 2026</p></header><main class="columns">${body}</main></body></html>`;
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  try {
    const page=await browser.newPage();
    await page.setContent(html,{waitUntil:'load'});
    await page.pdf({path:'docs/TECHNICAL-REPORT-IEEE-STYLE.pdf',printBackground:true,preferCSSPageSize:true});
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
