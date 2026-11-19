const crypto = require('node:crypto');
const { ethers } = require('ethers');
const { z } = require('zod');

function createAuth({pool, issuerAddresses, chainId, gateAddress}) {
  const issuers = new Set(issuerAddresses.map(address => ethers.getAddress(address).toLowerCase()));
  const challengeInput = z.object({address:z.string().refine(ethers.isAddress)}).strict();
  const verifyInput = z.object({id:z.string().uuid(),signature:z.string().max(512)}).strict();
  const roleFor = address => issuers.has(address.toLowerCase()) ? 'issuer' : 'participant';
  const hash = token => crypto.createHash('sha256').update(token).digest('hex');
  async function challenge(req,res,next) {
    try {
      const parsed=challengeInput.safeParse(req.body);
      if(!parsed.success) return res.status(400).json({error:'Invalid wallet address'});
      const address=ethers.getAddress(parsed.data.address), id=crypto.randomUUID();
      const origin=`${req.protocol}://${req.get('host')}`;
      const expires=new Date(Date.now()+5*60*1000);
      const message=`ZK Compliance Gate sign-in\nOrigin: ${origin}\nWallet: ${address}\nChain ID: ${chainId}\nNonce: ${crypto.randomBytes(32).toString('hex')}\nExpires: ${expires.toISOString()}`;
      await pool.query('INSERT INTO auth_challenges(id,wallet_address,origin,message,expires_at) VALUES($1,$2,$3,$4,$5)',[id,address.toLowerCase(),origin,message,expires]);
      res.json({id,message});
    } catch(e){next(e)}
  }
  async function verify(req,res,next) {
    try {
      const parsed=verifyInput.safeParse(req.body);
      if(!parsed.success) return res.status(400).json({error:'Invalid sign-in request'});
      const {rows}=await pool.query('SELECT * FROM auth_challenges WHERE id=$1',[parsed.data.id]);
      const c=rows[0];
      if(!c || c.used_at || c.expires_at<=new Date() || c.origin!==`${req.protocol}://${req.get('host')}`) return res.status(401).json({error:'Sign-in challenge expired or invalid'});
      let recovered;
      try { recovered=ethers.verifyMessage(c.message,parsed.data.signature).toLowerCase(); } catch { return res.status(401).json({error:'Invalid wallet signature'}); }
      if(recovered!==c.wallet_address) return res.status(401).json({error:'Invalid wallet signature'});
      const used=await pool.query('UPDATE auth_challenges SET used_at=now() WHERE id=$1 AND used_at IS NULL AND expires_at>now() RETURNING id',[c.id]);
      if(!used.rowCount) return res.status(401).json({error:'Sign-in challenge expired or invalid'});
      const token=crypto.randomBytes(32).toString('base64url');
      const expires=new Date(Date.now()+8*60*60*1000);
      await pool.query('INSERT INTO auth_sessions(token_hash,wallet_address,expires_at) VALUES($1,$2,$3)',[hash(token),c.wallet_address,expires]);
      res.json({token,address:ethers.getAddress(c.wallet_address),role:roleFor(c.wallet_address),expiresAt:expires.toISOString()});
    } catch(e){next(e)}
  }
  async function authenticate(req,res,next) {
    try {
      const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization')||'');
      if(!match) return res.status(401).json({error:'Sign in with your wallet'});
      const {rows}=await pool.query('SELECT wallet_address FROM auth_sessions WHERE token_hash=$1 AND expires_at>now()',[hash(match[1])]);
      if(!rows.length) return res.status(401).json({error:'Session expired or invalid'});
      req.user={address:rows[0].wallet_address,role:roleFor(rows[0].wallet_address),tokenHash:hash(match[1])};
      next();
    } catch(e){next(e)}
  }
  function requireRole(role) { return (req,res,next)=>req.user.role===role ? next() : res.status(403).json({error:'Insufficient role'}); }
  async function logout(req,res,next) { try {await pool.query('DELETE FROM auth_sessions WHERE token_hash=$1',[req.user.tokenHash]);res.json({ok:true})}catch(e){next(e)} }
  return {challenge,verify,authenticate,requireRole,logout,config:(_req,res)=>res.json({chainId,gateAddress})};
}
module.exports={createAuth};
