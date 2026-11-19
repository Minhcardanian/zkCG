import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Identity } from '@semaphore-protocol/core';
import { createIdentity, hasIdentity, unlockIdentity } from './identity';
import { audit, connect, connectAudit, register } from './chain';
import './style.css';

type Application = {id:string; commitment:string; reference:string; decision:string; synthetic_age:number; synthetic_jurisdiction:string; synthetic_screening_clear:boolean};
type Operation = {reference:string; id:string; application_id:string; kind:string; status:string; tx_hash:string|null; actor_wallet:string|null};
type Session = {token:string;address:string;role:'issuer'|'participant';chainId:string};
async function api(path:string, token='', init:RequestInit={}) {
  let response:Response;
  try { response=await fetch(path,{...init,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}}); }
  catch { throw new Error('Issuer service is unavailable. Check that the local API is running.'); }
  const body=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(body?.error || 'Issuer service is unavailable or returned an unexpected response.');
  if(body===null) throw new Error('Issuer service returned an unexpected response.');
  return body;
}
function App() {
  const [activeSection,setActiveSection]=useState(window.location.hash || '#overview');
  useEffect(()=>{const update=()=>setActiveSection(window.location.hash || '#overview');window.addEventListener('hashchange',update);return ()=>window.removeEventListener('hashchange',update)},[]);
  const [identity,setIdentity]=useState<Identity|null>(null), [password,setPassword]=useState(''), [address,setAddress]=useState(import.meta.env.VITE_GATE_ADDRESS || ''), [account,setAccount]=useState('');
  const [session,setSession]=useState<Session|null>(null);
  const token=session?.token || '';
  const [decisionFilter,setDecisionFilter]=useState('all');
  const [reference,setReference]=useState(''), [age,setAge]=useState('18'), [jurisdiction,setJurisdiction]=useState('VN'), [clear,setClear]=useState(true);
  const [auditResult,setAuditResult]=useState<{address:string; data:Awaited<ReturnType<typeof audit>>}|null>(null);
  const auditData=auditResult && auditResult.address===address ? auditResult.data : null;
  const [approvalCheck,setApprovalCheck]=useState<{commitment:string; address:string; approved:boolean}|null>(null);
  const [recoveryHash,setRecoveryHash]=useState('');
  const [apps,setApps]=useState<Application[]>([]), [ops,setOps]=useState<Operation[]>([]), [message,setMessage]=useState(''), [busy,setBusy]=useState(false);
  const navItems=[['#overview','Overview'],['#access','Account'],...(session?.role==='participant'?[['#identity','Private identity'],['#eligibility','Request eligibility'],['#registration','Register with a proof']]:[]),...(session?.role==='issuer'?[['#issuer','Issuer console']]:[]),['#audit','Public audit']];
  function navigationLinks(closeMenu=false) { return navItems.map(([href,label],index)=><React.Fragment key={href}>{index===0&&<div className="nav-label">WORKSPACE</div>}<a href={href} aria-current={activeSection===href?'location':undefined} onClick={closeMenu?e=>e.currentTarget.closest('details')?.removeAttribute('open'):undefined}>{label}</a></React.Fragment>); }
  function clearSession() { setSession(null);setIdentity(null);setAccount('');setApps([]);setOps([]);setApprovalCheck(null); }
  useEffect(()=>{
    if(!session||!window.ethereum)return;
    const wallet=window.ethereum as typeof window.ethereum & {on?:(event:string,listener:(value:unknown)=>void)=>void;removeListener?:(event:string,listener:(value:unknown)=>void)=>void};
    const invalidate=()=>{void api('/api/auth/logout',session.token,{method:'POST'}).catch(()=>{});clearSession();setMessage('Wallet changed. Sign in again.');};
    const accounts=(value:unknown)=>{if(!Array.isArray(value)||!value.some(a=>typeof a==='string'&&a.toLowerCase()===session.address.toLowerCase()))invalidate();};
    const chain=(value:unknown)=>{try{if(typeof value!=='string'||BigInt(value)!==BigInt(session.chainId))invalidate();}catch{invalidate();}};
    wallet.on?.('accountsChanged',accounts);wallet.on?.('chainChanged',chain);
    return ()=>{wallet.removeListener?.('accountsChanged',accounts);wallet.removeListener?.('chainChanged',chain)};
  },[session]);
  async function signIn() {
    const config=await api('/api/auth/config');
    if(address.toLowerCase()!==String(config.gateAddress).toLowerCase())throw new Error('Gate address does not match the issuer service.');
    const c=await connect(address);
    if((await c.provider.getNetwork()).chainId.toString()!==String(config.chainId))throw new Error('Wallet network does not match the issuer service.');
    const challenge=await api('/api/auth/challenge','',{method:'POST',body:JSON.stringify({address:c.account})});
    let signature:string;
    try { signature=await c.signer.signMessage(challenge.message); } catch { throw new Error('Wallet signature was not completed. Try signing in again.'); }
    const result=await api('/api/auth/verify','',{method:'POST',body:JSON.stringify({id:challenge.id,signature})});
    if(result.role!=='issuer'&&result.role!=='participant')throw new Error('Unexpected account role.');
    setSession({token:result.token,address:result.address,role:result.role,chainId:String(config.chainId)});setAccount(result.address);setMessage(`Signed in as ${result.role}.`);
  }
  async function run(fn:()=>Promise<void>) { setBusy(true);setMessage('');try{await fn()}catch(e){setMessage(e instanceof Error?e.message:'Unexpected error')}finally{setBusy(false)} }
  async function refresh() { const [a,o]=await Promise.all([api('/api/admin/applications',token),api('/api/admin/operations',token)]);setApps(a);setOps(o); }
  async function issuerAction(id:string, action:'approve'|'revoke') {
    let result;
    try { result=await api(`/api/admin/applications/${id}/${action}`,token,{method:'POST'}); }
    catch(error) { try { await refresh(); } catch { /* Keep the original submission error visible. */ } throw error; }
    const status=`${action==='approve'?'Approval':'Revocation'} ${result.status}: ${result.txHash}`;
    try { await refresh(); setMessage(status); }
    catch { setMessage(`${status}. Unable to refresh operations; load applications again before taking further action.`); }
  }
  return <div className="app-shell"><nav className="sidebar" aria-label="Workspace navigation"><a className="brand" href="#overview"><span className="brand-mark">ZK</span><span>Compliance <b>Gate</b><small>RESEARCH PROTOTYPE</small></span></a><div className="nav-links desktop-navigation">{navigationLinks()}</div><details className="mobile-navigation"><summary><span>Menu</span><strong>{navItems.find(([href])=>href===activeSection)?.[1] || 'Overview'}</strong><span aria-hidden="true">⌄</span></summary><div className="nav-links">{navigationLinks(true)}</div></details><div className="sidebar-note">Privacy-preserving<br/><strong>eligibility verification</strong></div></nav><main id="overview"><div className="topbar"><span>Workspace <span className="crumb">/</span> Overview</span><span className="badge"><span className="status-dot"/>Configured: {import.meta.env.VITE_CHAIN_ID === '11155111' ? 'Sepolia' : 'Local network'}</span></div><header><div><span className="eyebrow">COMPLIANCE WORKSPACE</span><h1>ZK Compliance Gate</h1><p>Register using a private proof of eligibility.</p></div></header>
  <section id="access"><div className="section-title"><span>00</span><div><h2>Account</h2><p>Sign in with your wallet.</p></div></div><div className="row"><label>Gate contract address<input value={address} disabled={!!session} onChange={e=>{setAddress(e.target.value);setApprovalCheck(null);setAuditResult(null)}} placeholder="0x…"/></label>{!session?<button disabled={busy||!address} onClick={()=>run(signIn)}>Sign in with wallet</button>:<button className="secondary" disabled={busy} onClick={()=>run(async()=>{try{await api('/api/auth/logout',token,{method:'POST'})}finally{clearSession()}setMessage('Signed out.')})}>Sign out</button>}</div>{session&&<p className="muted">{session.role==='issuer'?'Issuer':'Participant'} · {session.address}</p>}</section>
  {message && <div role="status" className="notice">{message}</div>}
  {session?.role==='participant' && <><div className="workflow" aria-label="Registration steps"><div className="workflow-intro"><span>PARTICIPANT WORKFLOW</span><strong>Three steps to register</strong></div><ol><li><a href="#identity"><span>01</span><b>Private identity</b><small>{identity ? 'Unlocked in this session' : hasIdentity() ? 'Unlock to continue' : 'Create on this device'}</small></a></li><li><a href="#eligibility"><span>02</span><b>Eligibility</b><small>Submit synthetic details</small></a></li><li><a href="#registration"><span>03</span><b>Registration</b><small>After issuer approval</small></a></li></ol></div>
  <section id="identity"><div className="section-title"><span>01</span><div><h2>Private identity</h2><p>Your identity stays on this device.</p></div></div>
  <div className="row"><label>Identity passphrase<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="off" placeholder="At least 12 characters"/></label><button disabled={busy} onClick={()=>run(async()=>{const id=hasIdentity()?await unlockIdentity(password):await createIdentity(password);setIdentity(id);setApprovalCheck(null);setPassword('');setMessage('Identity unlocked on this device.');})}>{hasIdentity()?'Unlock identity':'Create identity'}</button></div>
  {identity && <div className="detail"><b>Public commitment</b><code>{identity.commitment.toString()}</code></div>}</section>
  <section id="eligibility"><div className="section-title"><span>02</span><div><h2>Request eligibility</h2><p>Use synthetic details only.</p></div></div>
  <div className="grid"><label>Private reference<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Demo reference"/></label><label>Synthetic age<input type="number" value={age} onChange={e=>setAge(e.target.value)}/></label><label>Jurisdiction code<input value={jurisdiction} onChange={e=>setJurisdiction(e.target.value)} maxLength={2}/></label><label className="check"><input type="checkbox" checked={clear} onChange={e=>setClear(e.target.checked)}/> Synthetic screening clear</label></div>
  <p className="field-hint">{identity ? 'Identity unlocked.' : 'Unlock an identity to submit.'}</p>
  <button disabled={!identity||busy} onClick={()=>run(async()=>{if(!identity)return;const result=await api('/api/applications',token,{method:'POST',body:JSON.stringify({commitment:identity.commitment.toString(),reference,age:Number(age),jurisdiction,screeningClear:clear})});setMessage(`Application ${result.id}: ${result.decision}. Approval takes effect after the issuer transaction confirms.`)})}>Submit application</button></section>
  <section id="registration"><div className="section-title"><span>03</span><div><h2>Register with a proof</h2><p>Connect a wallet and generate your proof.</p></div></div>
  <div className="row"><button className="secondary" disabled={busy||!address} onClick={()=>run(async()=>{const c=await connect(address);setAccount(c.account);setMessage(`Wallet connected: ${c.account}`)})}>Connect wallet</button><button disabled={busy||!identity||!address} onClick={()=>run(async()=>{if(!identity)return;const c=await connect(address);if(c.account.toLowerCase()!==session.address.toLowerCase())throw new Error('Wallet account changed. Sign in again.');setAccount(c.account);const hash=await register(c.gate,c.semaphore,identity,c.account,setMessage);setMessage(`Registration confirmed: ${hash}`)})}>Generate proof &amp; register</button></div>{account&&<p className="muted">Last connected account: {account}</p>}<p className="field-hint">Requires confirmed approval and a connected wallet.</p><div className="approval-check"><button className="secondary" disabled={busy||!identity||!address} onClick={()=>run(async()=>{if(!identity)return;setApprovalCheck(null);const {gate}=await connectAudit(address);const approved=await gate.approved(identity.commitment);setApprovalCheck({commitment:identity.commitment.toString(),address,approved});})}>Check on-chain approval</button>{approvalCheck && identity && approvalCheck.commitment===identity.commitment.toString() && approvalCheck.address===address && <span role="status">{approvalCheck.approved ? 'Approved at the time of this check.' : 'Not currently approved at the time of this check.'}</span>}</div></section></>}
  {session?.role==='issuer' && <><div className="area-heading"><span>ISSUER &amp; AUDITOR</span><p>Manage approvals and inspect evidence.</p></div>
  <section id="issuer"><div className="section-title"><span>04</span><div><h2>Issuer console</h2><p>Review and manage applications.</p></div></div>
  <div className="row"><button className="secondary" disabled={busy} onClick={()=>run(refresh)}>Load applications</button></div>
  {apps.length>0&&<div className="table"><div className="table-toolbar"><label>Decision <select value={decisionFilter} onChange={e=>setDecisionFilter(e.target.value)}><option value="all">All</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label></div><table><thead><tr><th>Reference</th><th>Screening</th><th>Decision</th><th>Action</th></tr></thead><tbody>{apps.filter(a=>decisionFilter==='all'||a.decision===decisionFilter).map(a=><tr key={a.id}><td>{a.reference}</td><td>{a.synthetic_age} · {a.synthetic_jurisdiction} · {a.synthetic_screening_clear?'clear':'flagged'}</td><td>{a.decision}</td><td><button disabled={busy||a.decision!=='approved'} onClick={()=>run(()=>issuerAction(a.id,'approve'))}>Approve on chain</button> <button className="secondary" disabled={busy||a.decision!=='approved'} onClick={()=>run(()=>issuerAction(a.id,'revoke'))}>Revoke</button></td></tr>)}</tbody></table></div>}
  {ops.some(o=>!o.tx_hash && ['unknown','preparing'].includes(o.status)) && <label>Transaction hash for recovery<input value={recoveryHash} onChange={e=>setRecoveryHash(e.target.value)} placeholder="0x…"/></label>}
  {ops.length>0&&<div className="table"><h3>Chain operations</h3><table><thead><tr><th>Reference</th><th>Operation</th><th>Issuer</th><th>Status</th><th>Transaction</th><th></th></tr></thead><tbody>{ops.map(o=><tr key={o.id}><td>{o.reference}</td><td>{o.kind}</td><td><code>{o.actor_wallet||'Not recorded'}</code></td><td>{o.status}</td><td><code>{o.tx_hash||'No hash; investigate manually'}</code></td><td><button className="secondary" disabled={busy||!o.tx_hash} onClick={()=>run(async()=>{const result=await api(`/api/admin/operations/${o.id}/reconcile`,token,{method:'POST'});setMessage(`Operation ${result.status}`);await refresh()})}>Reconcile</button> {!o.tx_hash && ['unknown','preparing'].includes(o.status) && <button className="secondary" disabled={busy||!recoveryHash} onClick={()=>run(async()=>{await api(`/api/admin/operations/${o.id}/attach`,token,{method:'POST',body:JSON.stringify({txHash:recoveryHash})});setRecoveryHash('');setMessage('Transaction attached; reconcile its receipt.');await refresh()})}>Attach hash</button>}</td></tr>)}</tbody></table></div>}</section></>}
  <section id="audit"><div className="section-title"><span>05</span><div><h2>Public audit</h2><p>View public roots and events.</p></div></div>
  <button disabled={busy||!address} className="secondary" onClick={()=>run(async()=>{setAuditResult(null);const c=await connectAudit(address);setAuditResult({address,data:await audit(c.gate,c.semaphore)});})}>Load public evidence</button>
  {auditData && <><div className="detail"><b>Current root</b><code>{auditData.root}</code><p>{auditData.active} active members · {auditData.size} total leaf slots</p></div><div className="table"><table><thead><tr><th>Event</th><th>Public data</th><th>Block</th><th>Transaction</th></tr></thead><tbody>{auditData.events.map(e=><tr key={e.id}><td>{e.name}</td><td><code>{e.description}</code></td><td>{e.block}</td><td><code>{e.tx}</code></td></tr>)}</tbody></table></div></>}</section>
  <footer>Synthetic screening only; not certified KYC/AML. The issuer sees your sign-in wallet and application. Wallet activity is public. One-member groups offer no anonymity. Lost identities or passphrases cannot be recovered.</footer></main></div>
}
createRoot(document.getElementById('root')!).render(<App/>);
