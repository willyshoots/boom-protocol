const { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const fs = require("fs");
const os = require("os");
const BN = require("bn.js");

const PROGRAM_ID = new PublicKey("GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  // Load wallet
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(
      os.homedir() + "/.config/solana/id.json", "utf-8"
    )))
  );
  
  console.log("Wallet:", walletKeypair.publicKey.toString());
  
  // Find protocol PDA
  const [protocolPDA, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol")],
    PROGRAM_ID
  );
  console.log("Protocol PDA:", protocolPDA.toString());
  
  // Check if exists
  const info = await connection.getAccountInfo(protocolPDA);
  if (info) {
    console.log("Protocol already initialized!");
    console.log("Account size:", info.data.length, "bytes");
    return;
  }
  
  console.log("Protocol NOT initialized.");
  console.log("\nTo initialize, you need to call the 'initialize' instruction.");
  console.log("This requires proper Anchor instruction encoding.");
  console.log("\nFor now, click 'Check Protocol' in the admin panel to verify.");
}

main().catch(console.error);
