const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { JsonRpcProvider, Wallet } = require('ethers');
const assert = require('node:assert/strict');
const gateAddress = '0xF4C449Bc9da8BBa02b0Bc8D9aD6d2f05E3271BAa';
const journal = 'deployments/sepolia-browser.jsonl';
const write = value => fs.appendFileSync(journal, JSON.stringify({time:new Date().toISOString(),...value})+'\n');
(async () => {
 throw Error('Historical browser test is incompatible with wallet sign-in; update it before any new Sepolia run');
 if (process.env.CONFIRM_SEPOLIA_BROWSER !== 'yes') throw Error('Explicit Sepolia browser-test authorization is required');
 const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
 if ((await provider.getNetwork()).chainId !== 11155111n) throw Error('Wrong network');
 const participant = new Wallet(fs.readFileSync('deployments/sepolia-browser.participant-key','utf8').trim(),provider);
 if (await provider.getBalance(participant.address) === 0n) throw Error('Test participant is unfunded');
 const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
 const page = await browser.newPage();
 const reference='sepolia-browser-'+randomUUID();
 page.on('pageerror', e=>console.error('Browser error:',e.message));
 await page.exposeBinding('testWalletRequest',async (_source,{method,params=[]})=>{
   if (method==='eth_accounts'||method==='eth_requestAccounts') return [participant.address];
   if (method==='eth_sendTransaction') {
     const tx=params[0];
     if (tx.to?.toLowerCase()!==gateAddress.toLowerCase() || tx.from?.toLowerCase()!==participant.address.toLowerCase()) throw Error('Unexpected transaction target');
     write({step:'browser-registration',status:'preparing',participant:participant.address});
     const sent=await participant.sendTransaction({to:tx.to,data:tx.data,value:tx.value||0});
     write({step:'browser-registration',status:'pending',hash:sent.hash});
     return sent.hash;
   }
   return provider.send(method,params);
 });
 await page.addInitScript(()=>{window.ethereum={isMetaMask:true,on(){},removeListener(){},request(args){return window.testWalletRequest(args)}}});
 try {
   write({step:'browser',status:'started',participant:participant.address,reference});
   await page.goto('http://127.0.0.1:5173/');
   await page.getByLabel('Identity passphrase').fill('test-only-passphrase-123');
   await page.getByRole('button',{name:'Create identity'}).click();
   await page.getByText('Identity unlocked on this device.').waitFor();
   await page.getByLabel('Private reference').fill(reference);
   await page.getByRole('button',{name:'Submit application'}).click();
   await page.getByText(/Application .* approved/).waitFor();
   await page.getByLabel('Admin token').fill(process.env.ADMIN_TOKEN);
   await page.getByRole('button',{name:'Load applications'}).click();
   const appRow=page.locator('tr').filter({hasText:reference}).first();
   await appRow.getByRole('button',{name:'Approve on chain'}).click();
   await page.getByText(/Approval pending/).waitFor({timeout:30000});
   const approvalRow=page.locator('tr').filter({hasText:reference}).filter({hasText:'pending'});
   await page.waitForTimeout(16000);
   await approvalRow.getByRole('button',{name:'Reconcile'}).click();
   await page.getByText('Operation confirmed').waitFor({timeout:30000});
   await page.getByLabel('Gate contract address').fill(gateAddress);
   await page.getByRole('button',{name:'Generate proof & register'}).click();
   await page.getByText(/Registration confirmed/).waitFor({timeout:180000});
   await page.evaluate(()=>{window.ethereum=undefined});
   await page.getByRole('button',{name:'Load public evidence'}).click();
   await page.getByText('Current root').waitFor({timeout:30000});
   assert(await page.getByText('Registered',{exact:true}).first().isVisible());
   await appRow.getByRole('button',{name:'Revoke',exact:true}).click();
   await page.getByText(/Revocation pending/).waitFor({timeout:30000});
   await page.waitForTimeout(16000);
   await page.locator('tr').filter({hasText:reference}).filter({hasText:'pending'}).getByRole('button',{name:'Reconcile'}).click();
   await page.getByText('Operation confirmed').waitFor({timeout:30000});
   write({step:'browser',status:'complete',participant:participant.address,reference});
   console.log('Sepolia browser application, approval, proof registration, audit and revocation completed.');
 } catch (error) { write({step:'browser',status:'interrupted',message:'Inspect database, journal and chain before retry'});throw error; }
 finally { await browser.close();provider.destroy(); }
})().catch(e=>{console.error(e.message);process.exit(1)});
