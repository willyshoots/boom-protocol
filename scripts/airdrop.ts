import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
async function main() {
  try {
    const sig = await conn.requestAirdrop(new PublicKey('Hg34SBqTGk5VuJBQHihe8VxsXCmeA4B7fcBuU4Ahz956'), 1 * LAMPORTS_PER_SOL);
    console.log('Airdrop tx:', sig);
    await conn.confirmTransaction(sig);
    console.log('Confirmed!');
  } catch(e: any) {
    console.error('Error:', e.message?.slice(0, 200));
  }
  const bal = await conn.getBalance(new PublicKey('Hg34SBqTGk5VuJBQHihe8VxsXCmeA4B7fcBuU4Ahz956'));
  console.log('Balance:', bal / LAMPORTS_PER_SOL, 'SOL');
}
main();
