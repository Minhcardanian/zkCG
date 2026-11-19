const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  try {
    const page=await browser.newPage();
    await page.goto('http://127.0.0.1:5173/');
    await page.evaluate(async()=>{await caches.delete('zkcg-proving-4.13.0')});
    await page.route('https://snark-artifacts.pse.dev/**',route=>route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},body:'tampered artifact'}));
    const tampered=await page.evaluate(async()=>{const {withProvingArtifacts}=await import('/src/proving-artifacts.ts');try{await withProvingArtifacts(1,async()=>true);return 'accepted'}catch(e){return e.message}});
    assert.match(tampered,/integrity check failed/);
    await page.unroute('https://snark-artifacts.pse.dev/**');
    const first=await page.evaluate(async()=>{const {withProvingArtifacts}=await import('/src/proving-artifacts.ts');return withProvingArtifacts(1,async a=>a.wasm.startsWith('blob:')&&a.zkey.startsWith('blob:'))});
    assert.equal(first,true);
    await page.route('https://snark-artifacts.pse.dev/**',route=>route.abort('failed'));
    const cached=await page.evaluate(async()=>{
      const {withProvingArtifacts}=await import('/src/proving-artifacts.ts');
      const transformed=await (await fetch('/src/chain.ts')).text();
      const corePath=transformed.match(/from \"([^\"]*semaphore-protocol_core\.js[^\"]*)\"/)[1];
      const {Identity,Group,generateProof,verifyProof}=await import(corePath);
      const identity=new Identity(); const group=new Group([identity.commitment]);
      const proof=await withProvingArtifacts(1,artifacts=>generateProof(identity,group,1n,2n,1,artifacts));
      return verifyProof(proof);
    });
    assert.equal(cached,true);
    await page.evaluate(async()=>{const c=await caches.open('zkcg-proving-4.13.0');await c.put('https://snark-artifacts.pse.dev/semaphore/4.13.0/semaphore-1.wasm',new Response('tampered'))});
    const corrupted=await page.evaluate(async()=>{const {withProvingArtifacts}=await import('/src/proving-artifacts.ts');try{await withProvingArtifacts(1,async()=>true);return 'accepted'}catch(e){return e.message}});
    assert.notEqual(corrupted,'accepted');
    console.log('Tampered artifacts rejected; verified cache produces a valid proof offline and corrupted cache is not trusted.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
