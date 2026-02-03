use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

declare_id!("ibGDrayoCDogt4o3jdqc3VNjjkELTLCyAg51fBgg8cV");

#[program]
pub mod boom {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, config: ProtocolConfig) -> Result<()> {
        let protocol = &mut ctx.accounts.protocol;
        protocol.authority = ctx.accounts.authority.key();
        protocol.treasury = ctx.accounts.treasury.key();
        protocol.min_cap = config.min_cap;
        protocol.max_cap = config.max_cap;
        protocol.fee_bps = config.fee_bps;
        protocol.total_launches = 0;
        protocol.total_explosions = 0;
        protocol.bump = *ctx.bumps.get("protocol").unwrap();
        Ok(())
    }

    pub fn create_boom_token(ctx: Context<CreateBoomToken>, name: [u8; 32], symbol: [u8; 8]) -> Result<()> {
        let boom_token = &mut ctx.accounts.boom_token;
        let protocol = &mut ctx.accounts.protocol;
        boom_token.mint = ctx.accounts.mint.key();
        boom_token.name = name;
        boom_token.symbol = symbol;
        boom_token.creator = ctx.accounts.creator.key();
        boom_token.created_at = Clock::get()?.unix_timestamp;
        boom_token.cap_hash = [0u8; 32];
        boom_token.is_exploded = false;
        boom_token.bump = *ctx.bumps.get("boom_token").unwrap();
        protocol.total_launches += 1;
        Ok(())
    }

    pub fn set_secret_cap(ctx: Context<SetSecretCap>, cap_hash: [u8; 32]) -> Result<()> {
        let boom_token = &mut ctx.accounts.boom_token;
        require!(!boom_token.is_exploded, BoomError::AlreadyExploded);
        require!(boom_token.cap_hash == [0u8; 32], BoomError::CapAlreadySet);
        boom_token.cap_hash = cap_hash;
        Ok(())
    }

    pub fn trigger_explosion(ctx: Context<TriggerExplosion>, revealed_cap: u64) -> Result<()> {
        let boom_token = &mut ctx.accounts.boom_token;
        let protocol = &mut ctx.accounts.protocol;
        require!(!boom_token.is_exploded, BoomError::AlreadyExploded);
        let computed_hash = anchor_lang::solana_program::hash::hash(&revealed_cap.to_le_bytes());
        require!(computed_hash.to_bytes() == boom_token.cap_hash, BoomError::InvalidCapReveal);
        boom_token.is_exploded = true;
        boom_token.explosion_time = Clock::get()?.unix_timestamp;
        boom_token.revealed_cap = revealed_cap;
        protocol.total_explosions += 1;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 99, seeds = [b"protocol"], bump)]
    pub protocol: Account<'info, Protocol>,
    /// CHECK: Treasury
    pub treasury: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateBoomToken<'info> {
    #[account(init, payer = creator, space = 8 + 170, seeds = [b"boom_token", mint.key().as_ref()], bump)]
    pub boom_token: Account<'info, BoomToken>,
    #[account(mut, seeds = [b"protocol"], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
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
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TriggerExplosion<'info> {
    #[account(mut, seeds = [b"boom_token", boom_token.mint.as_ref()], bump = boom_token.bump)]
    pub boom_token: Account<'info, BoomToken>,
    #[account(mut, seeds = [b"protocol"], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    pub trigger_authority: Signer<'info>,
}

#[account]
pub struct Protocol {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub min_cap: u64,
    pub max_cap: u64,
    pub fee_bps: u16,
    pub total_launches: u64,
    pub total_explosions: u64,
    pub bump: u8,
}

#[account]
pub struct BoomToken {
    pub mint: Pubkey,
    pub name: [u8; 32],
    pub symbol: [u8; 8],
    pub creator: Pubkey,
    pub created_at: i64,
    pub cap_hash: [u8; 32],
    pub revealed_cap: u64,
    pub is_exploded: bool,
    pub explosion_time: i64,
    pub total_payout: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProtocolConfig {
    pub min_cap: u64,
    pub max_cap: u64,
    pub fee_bps: u16,
}

#[error_code]
pub enum BoomError {
    #[msg("Token has already exploded")]
    AlreadyExploded,
    #[msg("Secret cap has already been set")]
    CapAlreadySet,
    #[msg("Invalid cap reveal - hash mismatch")]
    InvalidCapReveal,
}
