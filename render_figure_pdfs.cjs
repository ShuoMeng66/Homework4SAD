// Print local PlantUML SVGs as vector PDFs with embedded browser fonts.
const fs = require('fs');
const path = require('path');
const {chromium} = require('playwright');
async function main() {
  const [sourceDir, outputDir] = process.argv.slice(2);
  if (!sourceDir || !outputDir) throw new Error('Expected SVG directory and PDF output directory.');
  const browser = await chromium.launch({headless:true, channel:'chrome'});
  try {
    for (const file of fs.readdirSync(sourceDir).filter(x=>/^\d\d_.*\.svg$/.test(x)).sort()) {
      const svg = fs.readFileSync(path.join(sourceDir,file),'utf8');
      const match = svg.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/);
      if(!match) throw new Error('No SVG viewBox: '+file);
      const width=Number(match[3]),height=Number(match[4]);
      const page=await browser.newPage();
      await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0;padding:0;width:${width}px;height:${height}px}svg{display:block;width:${width}px;height:${height}px}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${svg.replace(/<\?xml[^>]*>/,'')}</body></html>`);
      await page.evaluate(()=>document.fonts.ready);
      const pdf=path.join(outputDir,file.replace(/\.svg$/,'.pdf'));
      await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:true,margin:{top:0,bottom:0,left:0,right:0}});
      await page.close();
      console.log(file.replace('.svg','.pdf')+' '+width+'x'+height);
    }
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exit(1)});
