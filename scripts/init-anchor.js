const { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

const PROGRAM_ID = new PublicKey("GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn");

// Helper to create Anchor instruction discriminator
function getInstructionDiscriminator(name) {
  const preimage = `global:${name}`;
  const hash = crypto.createHash("sha256").update(preimage).digest();
  return hash.slice(0, 8);
}

// Encode ProtocolConfig: { min_cap: u64, max_cap: u64, fee_bps: u16 }
function encodeProtocolConfig(minCap, maxCap, feeBps) {
  const buffer = Buffer.alloc(18); // 8 + 8 + 2
  buffer.writeBigUInt64LE(BigInt(minCap), 0);
  buffer.writeBigUInt64LE(BigInt(maxCap), 8);
  buffer.writeUInt16LE(feeBps, 16);
  return buffer;
}

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
    return;
  }
  
  console.log("Initializing protocol...");
  
  // Build instruction data
  const discriminator = getInstructionDiscriminator("initialize");
  const configData = encodeProtocolConfig(
    1_000_000_000,      // min_cap: 1 SOL (in lamports)
    100_000_000_000_000, // max_cap: 100k SOL (in lamports)
    50                   // fee_bps: 0.5%
  );
  
  const data = Buffer.concat([discriminator, configData]);
  console.log("Instruction data:", data.toString("hex"));
  
  // Build instruction
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: protocolPDA, isSigner: false, isWritable: true },
      { pubkey: walletKeypair.publicKey, isSigner: false, isWritable: false }, // treasury
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },   // authority
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  
  // Send transaction
  const tx = new Transaction().add(ix);
  
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [walletKeypair], {
      commitment: "confirmed",
    });
    console.log("Protocol initialized! Tx:", sig);
  } catch (e) {
    console.error("Error:", e.message);
    if (e.logs) {
      console.log("Logs:", e.logs);
    }
  }
}

main().catch(console.error);
