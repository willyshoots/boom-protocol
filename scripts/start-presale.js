const { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

const PROGRAM_ID = new PublicKey("GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn");

function getInstructionDiscriminator(name) {
  const preimage = `global:${name}`;
  const hash = crypto.createHash("sha256").update(preimage).digest();
  return hash.slice(0, 8);
}

// Encode: round_id (u64), cooldown_duration (i64), lottery_spots (u32), min_deposit (u64), max_deposit (u64)
function encodeStartPresaleArgs(roundId, cooldownSeconds, lotterySpots, minDeposit, maxDeposit) {
  const buffer = Buffer.alloc(8 + 8 + 4 + 8 + 8); // 36 bytes
  let offset = 0;
  
  buffer.writeBigUInt64LE(BigInt(roundId), offset); offset += 8;
  buffer.writeBigInt64LE(BigInt(cooldownSeconds), offset); offset += 8;
  buffer.writeUInt32LE(lotterySpots, offset); offset += 4;
  buffer.writeBigUInt64LE(BigInt(minDeposit), offset); offset += 8;
  buffer.writeBigUInt64LE(BigInt(maxDeposit), offset);
  
  return buffer;
}

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(
      os.homedir() + "/.config/solana/id.json", "utf-8"
    )))
  );
  
  console.log("Wallet:", walletKeypair.publicKey.toString());
  
  const ROUND_ID = 1;
  const COOLDOWN_MINUTES = 30;
  const LOTTERY_SPOTS = 10;
  const MIN_DEPOSIT_SOL = 0.1;
  const MAX_DEPOSIT_SOL = 10;
  
  // Find presale PDA
  const roundIdBuffer = Buffer.alloc(8);
  roundIdBuffer.writeBigUInt64LE(BigInt(ROUND_ID));
  
  const [presalePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("presale"), roundIdBuffer],
    PROGRAM_ID
  );
  console.log("Presale PDA:", presalePDA.toString());
  
  // Check if exists
  const info = await connection.getAccountInfo(presalePDA);
  if (info) {
    console.log("Presale round already exists!");
    return;
  }
  
  console.log("Starting presale round", ROUND_ID, "...");
  
  const discriminator = getInstructionDiscriminator("start_presale");
  const argsData = encodeStartPresaleArgs(
    ROUND_ID,
    COOLDOWN_MINUTES * 60, // seconds
    LOTTERY_SPOTS,
    MIN_DEPOSIT_SOL * 1_000_000_000, // lamports
    MAX_DEPOSIT_SOL * 1_000_000_000  // lamports
  );
  
  const data = Buffer.concat([discriminator, argsData]);
  console.log("Instruction data:", data.toString("hex"));
  
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: presalePDA, isSigner: false, isWritable: true },
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  
  const tx = new Transaction().add(ix);
  
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [walletKeypair], {
      commitment: "confirmed",
    });
    console.log("Presale started! Tx:", sig);
  } catch (e) {
    console.error("Error:", e.message);
    if (e.logs) {
      console.log("Logs:", e.logs);
    }
  }
}

main().catch(console.error);
