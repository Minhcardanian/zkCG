const { chromium } = require('playwright');
const { ethers } = require('ethers');
const { Pool } = require('pg');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
(async () => {
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
 const page=await browser.newPage();
 const reference=`browser-demo-${randomUUID()}`;
 const gate=process.env.TEST_GATE_ADDRESS||'0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';
 const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5173/';
 const participantIndex=Number(process.env.TEST_PARTICIPANT_ACCOUNT_INDEX||'1');
 let completed=false, recoveryTxHash;
 page.on('pageerror',e=>console.error('Browser error:',e.message));
 await page.addInitScript(index=>{
   let id=0;window.__accountIndex=index;
   window.ethereum={isMetaMask:true,on(){},removeListener(){},async request({method,params}){
     if(method==='eth_requestAccounts')method='eth_accounts';
     const response=await fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params:params||[]})});
     const result=await response.json();if(result.error)throw Object.assign(new Error(result.error.message),result.error);
     return method==='eth_accounts'?result.result.slice(window.__accountIndex,window.__accountIndex+1):result.result;
   }};
 },participantIndex);
 async function signIn(index,role){
   await page.evaluate(index=>window.__accountIndex=index,index);
   await page.getByLabel('Gate contract address').fill(gate);
   await page.getByRole('button',{name:'Sign in with wallet'}).click();
   await page.getByText(`Signed in as ${role}.`).waitFor();
 }
 try {
  await page.goto(base,{waitUntil:'networkidle'});
  const receiptStates=await page.evaluate(async()=>{
    const {confirmRegistration}=await import('/src/transaction.ts');const hash='0x'+'ab'.repeat(32);const outcomes=[];
    for(const wait of [async()=>({status:1}),async()=>{throw {code:'CALL_EXCEPTION',receipt:{status:0}}},async()=>{throw Error('RPC unavailable')},async()=>null]){
      try{outcomes.push(await confirmRegistration({hash,wait}))}catch(error){outcomes.push(error.message)}
    }return {hash,outcomes};
  });
  assert.equal(receiptStates.outcomes[0],receiptStates.hash);
  assert.equal(receiptStates.outcomes[1],`Transaction failed: ${receiptStates.hash}`);
  for(const outcome of receiptStates.outcomes.slice(2))assert(outcome.includes(receiptStates.hash)&&outcome.includes('before retrying'));
  await signIn(participantIndex,'participant');
  assert.equal(await page.getByRole('heading',{name:'Issuer console'}).count(),0);
  await page.getByLabel('Identity passphrase').fill('prototype-passphrase-123');
  await page.getByRole('button',{name:'Create identity'}).click();await page.getByText('Identity unlocked on this device.').waitFor();
  const commitment=await page.locator('.detail code').first().innerText();
  const stored=await page.evaluate(()=>localStorage.getItem('zkcg.encryptedIdentity.v1'));
  assert(stored&&!stored.includes('prototype-passphrase-123')&&!stored.includes(commitment));
  await page.getByRole('button',{name:'Check on-chain approval'}).click();await page.getByText('Not currently approved at the time of this check.').waitFor();
  await page.getByLabel('Private reference').fill(reference);await page.getByRole('button',{name:'Submit application'}).click();await page.getByText(/Application .* approved/).waitFor();
  await page.getByRole('button',{name:'Sign out'}).click();await signIn(0,'issuer');
  assert.equal(await page.getByRole('heading',{name:'Request eligibility'}).count(),0);
  await page.getByRole('button',{name:'Load applications'}).click();
  const row=page.locator('tr').filter({hasText:reference}).first();await row.getByRole('button',{name:'Approve on chain'}).click();await page.getByText(/Approval pending/).waitFor();
  await page.locator('tr').filter({hasText:reference}).filter({hasText:'pending'}).first().getByRole('button',{name:'Reconcile'}).click();await page.getByText('Operation confirmed').waitFor();
  await page.getByRole('button',{name:'Sign out'}).click();await signIn(participantIndex,'participant');
  await page.getByLabel('Identity passphrase').fill('wrong-passphrase');await page.getByRole('button',{name:'Unlock identity'}).click();await page.getByText('Unable to unlock identity. Check your passphrase.').waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('zkcg.encryptedIdentity.v1')),stored);
  await page.getByLabel('Identity passphrase').fill('prototype-passphrase-123');await page.getByRole('button',{name:'Unlock identity'}).click();await page.getByText('Identity unlocked on this device.').waitFor();
  assert.equal(await page.locator('.detail code').first().innerText(),commitment);
  await page.getByRole('button',{name:'Check on-chain approval'}).click();await page.getByText('Approved at the time of this check.',{exact:true}).waitFor();
  await page.route('**/rpc',route=>route.abort('failed'));await page.getByRole('button',{name:'Connect wallet'}).click();await page.getByText('Wallet connection failed. Check your wallet and network, then try again.',{exact:true}).waitFor();await page.unroute('**/rpc');
  await page.getByRole('button',{name:'Generate proof & register'}).click();await page.getByText(/Registration confirmed/).waitFor({timeout:120000});
  const txHash=(await page.locator('.notice').innerText()).match(/0x[a-fA-F0-9]{64}/)?.[0];assert(txHash);
  const provider=new ethers.JsonRpcProvider('http://127.0.0.1:8545');const tx=await provider.getTransaction(txHash),receipt=await provider.getTransactionReceipt(txHash);
  const publicData=[tx.data,...receipt.logs.flatMap(log=>[log.data,...log.topics])].join('').toLowerCase();assert(!publicData.includes(Buffer.from(reference,'utf8').toString('hex').toLowerCase()));provider.destroy();
  await page.getByRole('button',{name:'Load public evidence'}).click();await page.getByText('Current root').waitFor();assert(await page.getByText('Registered',{exact:true}).first().isVisible());
  await page.getByRole('button',{name:'Sign out'}).click();await signIn(0,'issuer');await page.getByRole('button',{name:'Load applications'}).click();
  await page.locator('tr').filter({hasText:reference}).first().getByRole('button',{name:'Revoke',exact:true}).click();await page.getByText(/Revocation pending/).waitFor();
  const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL||'postgres://zkcg:local-dev-only@127.0.0.1:55432/zkcg'});
  try{const r=await pool.query("SELECT o.id,o.tx_hash FROM operations o JOIN applications a ON a.id=o.application_id WHERE a.reference=$1 AND o.kind='revocation'",[reference]);assert.equal(r.rowCount,1);recoveryTxHash=r.rows[0].tx_hash;await pool.query("UPDATE operations SET status='unknown',tx_hash=NULL WHERE id=$1",[r.rows[0].id]);}finally{await pool.end()}
  await page.getByRole('button',{name:'Load applications'}).click();await page.getByLabel('Transaction hash for recovery').fill(recoveryTxHash);
  await page.locator('tr').filter({hasText:reference}).filter({hasText:'unknown'}).getByRole('button',{name:'Attach hash'}).click();await page.getByText('Transaction attached; reconcile its receipt.').waitFor();
  await page.locator('tr').filter({hasText:reference}).filter({hasText:'pending'}).getByRole('button',{name:'Reconcile'}).click();await page.getByText('Operation confirmed').waitFor();
  await page.getByRole('button',{name:'Sign out'}).click();await signIn(participantIndex,'participant');await page.getByLabel('Identity passphrase').fill('prototype-passphrase-123');await page.getByRole('button',{name:'Unlock identity'}).click();await page.getByText('Identity unlocked on this device.').waitFor();await page.getByRole('button',{name:'Check on-chain approval'}).click();await page.getByText('Not currently approved at the time of this check.').waitFor();
  await page.getByRole('button',{name:'Sign out'}).click();completed=true;
  console.log('Wallet roles, identity, application, proof, audit, revocation and recovery passed.');
 } finally {
  await browser.close();
  if(completed){const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL||'postgres://zkcg:local-dev-only@127.0.0.1:55432/zkcg'});const client=await pool.connect();try{await client.query('BEGIN');await client.query('DELETE FROM operations WHERE application_id IN (SELECT id FROM applications WHERE reference=$1)',[reference]);await client.query('DELETE FROM applications WHERE reference=$1',[reference]);await client.query('COMMIT')}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();await pool.end()}}
  else{console.error(`Browser run incomplete; preserved synthetic records for reference ${reference}.`);if(recoveryTxHash)console.error(`Temporarily detached revocation hash: ${recoveryTxHash}`)}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
