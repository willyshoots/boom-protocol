import { Connection, PublicKey } from "@solana/web3.js";

const BOOM_PROGRAM_ID = new PublicKey("GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  console.log("Searching for existing pools...\n");
  
  for (let roundId = 1; roundId <= 20; roundId++) {
    const roundIdBytes = Buffer.alloc(8);
    roundIdBytes.writeBigUInt64LE(BigInt(roundId));
    
    const [poolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), roundIdBytes],
      BOOM_PROGRAM_ID
    );
    
    const info = await connection.getAccountInfo(poolPda);
    if (info) {
      console.log(`Round ${roundId}: Pool exists at ${poolPda.toBase58()}`);
      
      // Parse basic pool data
      const data = info.data;
      const mint = new PublicKey(data.slice(16, 48));
      const solReserve = data.readBigUInt64LE(80);
      const tokenReserve = data.readBigUInt64LE(88);
      
      console.log(`  Mint: ${mint.toBase58()}`);
      console.log(`  SOL Reserve: ${Number(solReserve) / 1e9} SOL`);
      console.log(`  Token Reserve: ${tokenReserve}`);
      console.log();
    }
  }
}

main().catch(console.error);
