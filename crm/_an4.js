const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(60000);
  const base = 'https://signature-props.preview.emergentagent.com';
  async function goto(u){ for(let i=0;i<3;i++){ try{ await page.goto(u,{waitUntil:'domcontentloaded',timeout:45000}); return; }catch(e){ await page.waitForTimeout(1500);} } throw new Error('goto failed '+u); }
  await goto(base + '/login.html');
  await page.waitForTimeout(1500);
  await page.click('[data-testid="pin-input-0"]');
  await page.keyboard.type('1234', { delay: 90 });
  await page.waitForTimeout(4000);
  await goto(base + '/property-investment-analyzer?value=15000000&rent=76000');
  await page.waitForSelector('[data-testid="kpi-grid"]', { timeout: 45000 });
  await page.waitForTimeout(4000);
  const kpi = (await page.innerText('[data-testid="kpi-grid"]')).replace(/\s+/g,' ');
  console.log('gross 6.08% shown:', /6\.08%/.test(kpi));
  console.log('KPI head:', kpi.slice(0,160));
  const opts = await page.$$eval('#in-investor option', e=>e.length);
  console.log('investor options:', opts);
  if (opts>1){
    const idx = await page.$$eval('#in-investor option', els=>{const i=els.findIndex(o=>/Cr/.test(o.textContent));return i>0?i:1;});
    await page.selectOption('#in-investor', { index: idx });
    await page.waitForTimeout(700);
    console.log('budget-match:', (await page.innerText('[data-testid="budget-match"]')).replace(/\s+/g,' ').slice(0,160));
  }
  await page.screenshot({ path:'/tmp/analyzer.png', fullPage:false });
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
