use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
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
        let computed_hash = hash(&revealed_cap.to_le_bytes());
        require!(computed_hash.to_bytes() == boom_token.cap_hash, BoomError::InvalidCapReveal);
        boom_token.is_exploded = true;
        boom_token.explosion_time = Clock::get()?.unix_timestamp;
        boom_token.revealed_cap = revealed_cap;
        protocol.total_explosions += 1;
        Ok(())
    }

    // ==================== PRESALE SYSTEM ====================

    /// Start a new presale round
    pub fn start_presale(
        ctx: Context<StartPresale>,
        round_id: u64,
        cooldown_duration: i64,
        lottery_spots: u32,
        min_deposit: u64,
        max_deposit: u64,
    ) -> Result<()> {
        let presale = &mut ctx.accounts.presale_round;
        let clock = Clock::get()?;

        presale.authority = ctx.accounts.authority.key();
        presale.round_id = round_id;
        presale.start_time = clock.unix_timestamp;
        presale.end_time = clock.unix_timestamp + cooldown_duration;
        presale.lottery_spots = lottery_spots;
        presale.min_deposit = min_deposit;
        presale.max_deposit = max_deposit;
        presale.total_deposited = 0;
        presale.total_depositors = 0;
        presale.is_finalized = false;
        presale.bump = *ctx.bumps.get("presale_round").unwrap();

        emit!(PresaleStarted {
            round_id,
            end_time: presale.end_time,
            lottery_spots,
            min_deposit,
            max_deposit,
        });

        Ok(())
    }

    /// User deposits SOL into presale
    pub fn deposit_presale(ctx: Context<DepositPresale>, amount: u64) -> Result<()> {
        let clock = Clock::get()?;

        // Read presale state first (immutable)
        let round_id = ctx.accounts.presale_round.round_id;
        let end_time = ctx.accounts.presale_round.end_time;
        let min_deposit = ctx.accounts.presale_round.min_deposit;
        let max_deposit = ctx.accounts.presale_round.max_deposit;
        let is_finalized = ctx.accounts.presale_round.is_finalized;

        // Validate presale is active
        require!(!is_finalized, BoomError::PresaleFinalized);
        require!(clock.unix_timestamp < end_time, BoomError::PresaleEnded);
        require!(amount >= min_deposit, BoomError::DepositTooSmall);
        require!(amount <= max_deposit, BoomError::DepositTooLarge);

        // Check if this is a new deposit or additional
        let is_new_depositor = ctx.accounts.user_deposit.amount == 0;
        let new_total = ctx.accounts.user_deposit.amount.checked_add(amount).ok_or(BoomError::Overflow)?;
        require!(new_total <= max_deposit, BoomError::DepositTooLarge);

        // Transfer SOL to presale PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.presale_round.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, amount)?;

        // Update user deposit
        let user_deposit = &mut ctx.accounts.user_deposit;
        user_deposit.depositor = ctx.accounts.depositor.key();
        user_deposit.round_id = round_id;
        user_deposit.amount = new_total;
        user_deposit.deposit_time = clock.unix_timestamp;
        user_deposit.is_winner = false;
        user_deposit.claimed = false;
        user_deposit.bump = *ctx.bumps.get("user_deposit").unwrap();

        // Update presale stats
        let presale = &mut ctx.accounts.presale_round;
        presale.total_deposited = presale.total_deposited.checked_add(amount).ok_or(BoomError::Overflow)?;
        if is_new_depositor {
            presale.total_depositors += 1;
        }

        emit!(DepositMade {
            round_id,
            depositor: ctx.accounts.depositor.key(),
            amount,
            total_amount: new_total,
        });

        Ok(())
    }

    /// End presale and run lottery (hackathon-safe pseudo-randomness)
    pub fn end_presale_and_lottery(
        ctx: Context<EndPresaleAndLottery>,
        winner_indexes: Vec<u32>,
    ) -> Result<()> {
        let presale = &mut ctx.accounts.presale_round;
        let clock = Clock::get()?;

        // Validate
        require!(!presale.is_finalized, BoomError::PresaleFinalized);
        require!(clock.unix_timestamp >= presale.end_time, BoomError::PresaleNotEnded);
        require!(
            winner_indexes.len() <= presale.lottery_spots as usize,
            BoomError::TooManyWinners
        );

        presale.is_finalized = true;

        // Note: In production, use Switchboard VRF or similar
        // For hackathon, authority provides winner indexes based on off-chain randomness
        // using recent slot hash: Clock::get()?.slot combined with depositor list

        emit!(PresaleFinalized {
            round_id: presale.round_id,
            total_deposited: presale.total_deposited,
            total_depositors: presale.total_depositors,
            winners_count: winner_indexes.len() as u32,
        });

        Ok(())
    }

    /// Mark a user as winner (called by authority after lottery)
    pub fn mark_winner(ctx: Context<MarkWinner>) -> Result<()> {
        let user_deposit = &mut ctx.accounts.user_deposit;
        let presale = &ctx.accounts.presale_round;

        require!(presale.is_finalized, BoomError::PresaleNotFinalized);
        require!(!user_deposit.is_winner, BoomError::AlreadyWinner);

        user_deposit.is_winner = true;

        emit!(WinnerMarked {
            round_id: presale.round_id,
            winner: user_deposit.depositor,
            amount: user_deposit.amount,
        });

        Ok(())
    }

    /// Non-winners claim refund
    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        let user_deposit = &mut ctx.accounts.user_deposit;
        let presale = &ctx.accounts.presale_round;

        require!(presale.is_finalized, BoomError::PresaleNotFinalized);
        require!(!user_deposit.is_winner, BoomError::WinnerCannotRefund);
        require!(!user_deposit.claimed, BoomError::AlreadyClaimed);
        require!(user_deposit.amount > 0, BoomError::NothingToRefund);

        let refund_amount = user_deposit.amount;
        user_deposit.claimed = true;

        // Transfer SOL from presale PDA back to user
        let presale_info = ctx.accounts.presale_round.to_account_info();
        let depositor_info = ctx.accounts.depositor.to_account_info();

        **presale_info.try_borrow_mut_lamports()? -= refund_amount;
        **depositor_info.try_borrow_mut_lamports()? += refund_amount;

        emit!(RefundClaimed {
            round_id: presale.round_id,
            depositor: ctx.accounts.depositor.key(),
            amount: refund_amount,
        });

        Ok(())
    }

    /// Winners claim their allocation (marks as claimed for manual token distribution)
    pub fn claim_winner_tokens(ctx: Context<ClaimWinnerTokens>) -> Result<()> {
        let user_deposit = &mut ctx.accounts.user_deposit;
        let presale = &ctx.accounts.presale_round;

        require!(presale.is_finalized, BoomError::PresaleNotFinalized);
        require!(user_deposit.is_winner, BoomError::NotAWinner);
        require!(!user_deposit.claimed, BoomError::AlreadyClaimed);

        user_deposit.claimed = true;

        emit!(WinnerClaimed {
            round_id: presale.round_id,
            winner: ctx.accounts.winner.key(),
            deposit_amount: user_deposit.amount,
        });

        Ok(())
    }
}

// ==================== EXISTING ACCOUNT CONTEXTS ====================

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

// ==================== PRESALE ACCOUNT CONTEXTS ====================

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct StartPresale<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + PresaleRound::INIT_SPACE,
        seeds = [b"presale", round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub presale_round: Account<'info, PresaleRound>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositPresale<'info> {
    #[account(
        mut,
        seeds = [b"presale", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump
    )]
    pub presale_round: Account<'info, PresaleRound>,
    #[account(
        init_if_needed,
        payer = depositor,
        space = 8 + UserDeposit::INIT_SPACE,
        seeds = [b"deposit", presale_round.round_id.to_le_bytes().as_ref(), depositor.key().as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EndPresaleAndLottery<'info> {
    #[account(
        mut,
        seeds = [b"presale", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump,
        has_one = authority
    )]
    pub presale_round: Account<'info, PresaleRound>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct MarkWinner<'info> {
    #[account(
        seeds = [b"presale", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump,
        has_one = authority
    )]
    pub presale_round: Account<'info, PresaleRound>,
    #[account(
        mut,
        seeds = [b"deposit", presale_round.round_id.to_le_bytes().as_ref(), user_deposit.depositor.as_ref()],
        bump = user_deposit.bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(
        mut,
        seeds = [b"presale", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump
    )]
    pub presale_round: Account<'info, PresaleRound>,
    #[account(
        mut,
        seeds = [b"deposit", presale_round.round_id.to_le_bytes().as_ref(), depositor.key().as_ref()],
        bump = user_deposit.bump,
        has_one = depositor
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    #[account(mut)]
    pub depositor: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimWinnerTokens<'info> {
    #[account(
        seeds = [b"presale", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump
    )]
    pub presale_round: Account<'info, PresaleRound>,
    #[account(
        mut,
        seeds = [b"deposit", presale_round.round_id.to_le_bytes().as_ref(), winner.key().as_ref()],
        bump = user_deposit.bump,
        has_one = depositor @ BoomError::NotAWinner
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    /// CHECK: Validated via has_one
    pub depositor: UncheckedAccount<'info>,
    pub winner: Signer<'info>,
}

// ==================== EXISTING ACCOUNTS ====================

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

// ==================== PRESALE ACCOUNTS ====================

#[account]
#[derive(InitSpace)]
pub struct PresaleRound {
    pub authority: Pubkey,          // 32
    pub round_id: u64,              // 8
    pub start_time: i64,            // 8
    pub end_time: i64,              // 8
    pub lottery_spots: u32,         // 4
    pub min_deposit: u64,           // 8
    pub max_deposit: u64,           // 8
    pub total_deposited: u64,       // 8
    pub total_depositors: u32,      // 4
    pub is_finalized: bool,         // 1
    pub bump: u8,                   // 1
}

#[account]
#[derive(InitSpace)]
pub struct UserDeposit {
    pub depositor: Pubkey,          // 32
    pub round_id: u64,              // 8
    pub amount: u64,                // 8
    pub deposit_time: i64,          // 8
    pub is_winner: bool,            // 1
    pub claimed: bool,              // 1
    pub bump: u8,                   // 1
}

// ==================== CONFIG ====================

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProtocolConfig {
    pub min_cap: u64,
    pub max_cap: u64,
    pub fee_bps: u16,
}

// ==================== EVENTS ====================

#[event]
pub struct PresaleStarted {
    pub round_id: u64,
    pub end_time: i64,
    pub lottery_spots: u32,
    pub min_deposit: u64,
    pub max_deposit: u64,
}

#[event]
pub struct DepositMade {
    pub round_id: u64,
    pub depositor: Pubkey,
    pub amount: u64,
    pub total_amount: u64,
}

#[event]
pub struct PresaleFinalized {
    pub round_id: u64,
    pub total_deposited: u64,
    pub total_depositors: u32,
    pub winners_count: u32,
}

#[event]
pub struct WinnerMarked {
    pub round_id: u64,
    pub winner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct RefundClaimed {
    pub round_id: u64,
    pub depositor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct WinnerClaimed {
    pub round_id: u64,
    pub winner: Pubkey,
    pub deposit_amount: u64,
}

// ==================== ERRORS ====================

#[error_code]
pub enum BoomError {
    #[msg("Token has already exploded")]
    AlreadyExploded,
    #[msg("Secret cap has already been set")]
    CapAlreadySet,
    #[msg("Invalid cap reveal - hash mismatch")]
    InvalidCapReveal,
    // Presale errors
    #[msg("Presale has been finalized")]
    PresaleFinalized,
    #[msg("Presale has not been finalized yet")]
    PresaleNotFinalized,
    #[msg("Presale period has ended")]
    PresaleEnded,
    #[msg("Presale period has not ended yet")]
    PresaleNotEnded,
    #[msg("Deposit amount is below minimum")]
    DepositTooSmall,
    #[msg("Deposit amount exceeds maximum")]
    DepositTooLarge,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Too many winners specified")]
    TooManyWinners,
    #[msg("User is already marked as winner")]
    AlreadyWinner,
    #[msg("Winners cannot claim refund")]
    WinnerCannotRefund,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Nothing to refund")]
    NothingToRefund,
    #[msg("Not a lottery winner")]
    NotAWinner,
}
