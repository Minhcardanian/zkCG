type Receipt = { status: number } | null;
type SubmittedTransaction = { hash: string; wait: () => Promise<Receipt> };

export async function confirmRegistration(tx: SubmittedTransaction): Promise<string> {
  let receipt: Receipt;
  try { receipt = await tx.wait(); }
  catch (error) {
    const e = error as {code?: string; receipt?: {status?: number}};
    if (e.code === 'CALL_EXCEPTION' && e.receipt?.status === 0) {
      throw new Error(`Transaction failed: ${tx.hash}`);
    }
    throw new Error(`Confirmation unavailable for ${tx.hash}. Check wallet activity or the block explorer before retrying.`);
  }
  if (!receipt) throw new Error(`Confirmation unavailable for ${tx.hash}. Check wallet activity or the block explorer before retrying.`);
  if (receipt.status !== 1) throw new Error(`Transaction failed: ${tx.hash}`);
  return tx.hash;
}
