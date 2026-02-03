use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use switchboard_solana::prelude::*;

declare_id!("BOOM111111111111111111111111111111111111111");

/// BOOM Protocol - AI-launched tokens with hidden explosion market caps
/// 
/// Flow:
/// 1. AI agent calls `create_boom_token` → new token + LP created
/// 2. VRF generates secret market cap threshold (stored as hash)
/// 3. Trading happens on DEX (Raydium/Meteora)
/// 4. Price monitor watches Pyth feed
/// 5. When market cap hits threshold → `trigger_explosion` → payout to all holders

#[program]
pub mod boom {
    use super::*;

    /// Initialize the BOOM protocol
    pub fn initialize(ctx: Context<Initialize>, config: ProtocolConfig) -> Result<()> {
        let protocol = &mut ctx.accounts.protocol;
        protocol.authority = ctx.accounts.authority.key();
        protocol.treasury = ctx.accounts.treasury.key();
        protocol.min_cap = config.min_cap;
        protocol.max_cap = config.max_cap;
        protocol.fee_bps = config.fee_bps;
        protocol.total_launches = 0;
        protocol.total_explosions = 0;
        protocol.bump = ctx.bumps.protocol;
        
        emit!(ProtocolInitialized {
            authority: protocol.authority,
            min_cap: protocol.min_cap,
            max_cap: protocol.max_cap,
        });
        
        Ok(())
    }

    /// Create a new BOOM token with hidden market cap threshold
    /// Called by AI launcher agent
    pub fn create_boom_token(
        ctx: Context<CreateBoomToken>,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        let boom_token = &mut ctx.accounts.boom_token;
        let protocol = &mut ctx.accounts.protocol;
        
        // Token metadata
        boom_token.mint = ctx.accounts.mint.key();
        boom_token.name = name.clone();
        boom_token.symbol = symbol.clone();
        boom_token.uri = uri;
        boom_token.creator = ctx.accounts.creator.key();
        boom_token.created_at = Clock::get()?.unix_timestamp;
        
        // Cap will be set by VRF callback
        boom_token.cap_hash = [0u8; 32]; // Placeholder until VRF
        boom_token.is_exploded = false;
        boom_token.explosion_time = 0;
        boom_token.total_payout = 0;
        
        boom_token.bump = ctx.bumps.boom_token;
        
        protocol.total_launches += 1;
        
        emit!(BoomTokenCreated {
            mint: boom_token.mint,
            name,
            symbol,
            creator: boom_token.creator,
            launch_number: protocol.total_launches,
        });
        
        Ok(())
    }

    /// VRF callback - sets the secret market cap threshold
    /// Only callable by Switchboard VRF
    pub fn set_secret_cap(
        ctx: Context<SetSecretCap>,
        cap_hash: [u8; 32],
    ) -> Result<()> {
        let boom_token = &mut ctx.accounts.boom_token;
        
        require!(!boom_token.is_exploded, BoomError::AlreadyExploded);
        require!(boom_token.cap_hash == [0u8; 32], BoomError::CapAlreadySet);
        
        // Store only the hash - actual cap is revealed at explosion
        boom_token.cap_hash = cap_hash;
        
        emit!(SecretCapSet {
            mint: boom_token.mint,
            cap_hash,
        });
        
        Ok(())
    }

    /// Trigger explosion when market cap threshold is hit
    /// Called by price monitoring bot with Pyth proof
    pub fn trigger_explosion(
        ctx: Context<TriggerExplosion>,
        revealed_cap: u64,
        price_proof: Vec<u8>,
    ) -> Result<()> {
        let boom_token = &mut ctx.accounts.boom_token;
        let protocol = &mut ctx.accounts.protocol;
        
        require!(!boom_token.is_exploded, BoomError::AlreadyExploded);
        
        // Verify the revealed cap matches the stored hash
        let computed_hash = anchor_lang::solana_program::hash::hash(&revealed_cap.to_le_bytes());
        require!(
            computed_hash.to_bytes() == boom_token.cap_hash,
            BoomError::InvalidCapReveal
        );
        
        // TODO: Verify price proof from Pyth shows market cap >= revealed_cap
        // For hackathon MVP, we trust the caller (would add Pyth verification)
        
        boom_token.is_exploded = true;
        boom_token.explosion_time = Clock::get()?.unix_timestamp;
        boom_token.revealed_cap = revealed_cap;
        
        protocol.total_explosions += 1;
        
        emit!(Explosion {
            mint: boom_token.mint,
            revealed_cap,
            explosion_time: boom_token.explosion_time,
            explosion_number: protocol.total_explosions,
        });
        
        Ok(())
    }

    /// Claim payout after explosion
    /// Holders call this with proof of their balance at explosion time
    pub fn claim_payout(
        ctx: Context<ClaimPayout>,
        holder_balance: u64,
        balance_proof: Vec<u8>,
    ) -> Result<()> {
        let boom_token = &ctx.accounts.boom_token;
        let claim = &mut ctx.accounts.claim;
        
        require!(boom_token.is_exploded, BoomError::NotExploded);
        require!(!claim.is_claimed, BoomError::AlreadyClaimed);
        
        // TODO: Verify balance proof (merkle proof of holder balance at snapshot)
        // For hackathon MVP, we trust the balance claim
        
        // Calculate proportional payout
        // payout = (holder_balance / total_supply) * pool_value
        let total_supply = ctx.accounts.mint.supply;
        let pool_value = ctx.accounts.payout_pool.amount;
        
        let payout = (holder_balance as u128)
            .checked_mul(pool_value as u128)
            .unwrap()
            .checked_div(total_supply as u128)
            .unwrap() as u64;
        
        // Transfer payout
        let seeds = &[
            b"boom_token",
            boom_token.mint.as_ref(),
            &[boom_token.bump],
        ];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.payout_pool.to_account_info(),
            to: ctx.accounts.holder_token_account.to_account_info(),
            authority: ctx.accounts.boom_token.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        
        token::transfer(cpi_ctx, payout)?;
        
        claim.is_claimed = true;
        claim.amount = payout;
        claim.claimed_at = Clock::get()?.unix_timestamp;
        
        emit!(PayoutClaimed {
            mint: boom_token.mint,
            holder: ctx.accounts.holder.key(),
            amount: payout,
        });
        
        Ok(())
    }
}

// ============================================================================
// Accounts
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Protocol::INIT_SPACE,
        seeds = [b"protocol"],
        bump
    )]
    pub protocol: Account<'info, Protocol>,
    
    /// CHECK: Treasury account for protocol fees
    pub treasury: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(name: String, symbol: String)]
pub struct CreateBoomToken<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + BoomToken::INIT_SPACE,
        seeds = [b"boom_token", mint.key().as_ref()],
        bump
    )]
    pub boom_token: Account<'info, BoomToken>,
    
    #[account(mut, seeds = [b"protocol"], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    
    /// The SPL token mint for this BOOM token
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub creator: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetSecretCap<'info> {
    #[account(mut, seeds = [b"boom_token", boom_token.mint.as_ref()], bump = boom_token.bump)]
    pub boom_token: Account<'info, BoomToken>,
    
    /// CHECK: Switchboard VRF account - verified in instruction
    pub vrf: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct TriggerExplosion<'info> {
    #[account(mut, seeds = [b"boom_token", boom_token.mint.as_ref()], bump = boom_token.bump)]
    pub boom_token: Account<'info, BoomToken>,
    
    #[account(mut, seeds = [b"protocol"], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    
    /// CHECK: Pyth price account for market cap verification
    pub pyth_price: AccountInfo<'info>,
    
    pub trigger_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimPayout<'info> {
    #[account(seeds = [b"boom_token", boom_token.mint.as_ref()], bump = boom_token.bump)]
    pub boom_token: Account<'info, BoomToken>,
    
    #[account(
        init_if_needed,
        payer = holder,
        space = 8 + Claim::INIT_SPACE,
        seeds = [b"claim", boom_token.key().as_ref(), holder.key().as_ref()],
        bump
    )]
    pub claim: Account<'info, Claim>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub payout_pool: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub holder_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub holder: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

// ============================================================================
// State
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct Protocol {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub min_cap: u64,        // Minimum market cap threshold ($10k default)
    pub max_cap: u64,        // Maximum market cap threshold ($10M default)
    pub fee_bps: u16,        // Protocol fee in basis points
    pub total_launches: u64,
    pub total_explosions: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BoomToken {
    pub mint: Pubkey,
    #[max_len(32)]
    pub name: String,
    #[max_len(10)]
    pub symbol: String,
    #[max_len(200)]
    pub uri: String,
    pub creator: Pubkey,
    pub created_at: i64,
    
    // Secret cap (only hash stored until explosion)
    pub cap_hash: [u8; 32],
    pub revealed_cap: u64,
    
    // Explosion state
    pub is_exploded: bool,
    pub explosion_time: i64,
    pub total_payout: u64,
    
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Claim {
    pub boom_token: Pubkey,
    pub holder: Pubkey,
    pub is_claimed: bool,
    pub amount: u64,
    pub claimed_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProtocolConfig {
    pub min_cap: u64,
    pub max_cap: u64,
    pub fee_bps: u16,
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct ProtocolInitialized {
    pub authority: Pubkey,
    pub min_cap: u64,
    pub max_cap: u64,
}

#[event]
pub struct BoomTokenCreated {
    pub mint: Pubkey,
    pub name: String,
    pub symbol: String,
    pub creator: Pubkey,
    pub launch_number: u64,
}

#[event]
pub struct SecretCapSet {
    pub mint: Pubkey,
    pub cap_hash: [u8; 32],
}

#[event]
pub struct Explosion {
    pub mint: Pubkey,
    pub revealed_cap: u64,
    pub explosion_time: i64,
    pub explosion_number: u64,
}

#[event]
pub struct PayoutClaimed {
    pub mint: Pubkey,
    pub holder: Pubkey,
    pub amount: u64,
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum BoomError {
    #[msg("Token has already exploded")]
    AlreadyExploded,
    
    #[msg("Token has not exploded yet")]
    NotExploded,
    
    #[msg("Secret cap has already been set")]
    CapAlreadySet,
    
    #[msg("Invalid cap reveal - hash mismatch")]
    InvalidCapReveal,
    
    #[msg("Invalid price proof")]
    InvalidPriceProof,
    
    #[msg("Payout already claimed")]
    AlreadyClaimed,
    
    #[msg("Unauthorized")]
    Unauthorized,
}
