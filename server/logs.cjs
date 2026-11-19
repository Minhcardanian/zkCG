function startBlock() {
  const start = Number(process.env.SEMAPHORE_START_BLOCK || '0');
  if (!Number.isSafeInteger(start) || start < 0) throw new Error('Invalid SEMAPHORE_START_BLOCK');
  return start;
}
async function readLogs(provider, filter) {
  const latest = Number(BigInt(await provider.send('eth_blockNumber', [])));
  const logs = [];
  for (let from = startBlock(); from <= latest; from += 5000) {
    logs.push(...await provider.getLogs({ ...filter, fromBlock: from, toBlock: Math.min(from + 4999, latest) }));
  }
  return logs;
}
module.exports = { readLogs };
