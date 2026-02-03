use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{Protocol, BoomToken, BoomError};

/// Presale module for BOOM Protocol
/// 
/// During cooldown between tokens:
/// 1. Users deposit SOL/USDC to presale pool
/// 2. Deposits fund the next token's LP
/// 3. Random lottery selects winners who get early buy-in
/// 4. Non-winners are refunded

#[account]
#[derive(InitSpace)]
pub struct Presale {
    /// The protocol this presale belongs to
    pub protocol: Pubkey,
    
    /// Sequential round number
    pub round: u64,
    
    /// Total amount deposited
    pub total_deposited: u64,
    
    /// Number of depositors
    pub depositor_count: u32,
    
    /// Presale status
    pub status: PresaleStatus,
    
    /// When presale opened
    pub opened_at: i64,
    
    /// When presale closes (cooldown ends)
    pub closes_at: i64,
    
    /// VRF result for lottery (set after close)
    pub lottery_seed: [u8; 32],
    
    /// Number of winners to select
    pub winner_count: u32,
    
    /// Amount each winner gets to buy
    pub winner_allocation: u64,
    
    /// The token mint this presale is for (set after lottery)
    pub token_mint: Pubkey,
    
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PresaleStatus {
    /// Accepting deposits
    Open,
    /// Deposits closed, awaiting lottery
    Closed,
    /// Lottery complete, winners can claim
    LotteryComplete,
    /// Round finished, refunds available
    Finalized,
}

#[account]
#[derive(InitSpace)]
pub struct PresaleDeposit {
    /// The presale round
    pub presale: Pubkey,
    
    /// Depositor's wallet
    pub depositor: Pubkey,
    
    /// Amount deposited
    pub amount: u64,
    
    /// Position in deposit order (used for lottery)
    pub position: u32,
    
    /// Whether this deposit won the lottery
    pub is_winner: bool,
    
    /// Whether early buy-in has been claimed (winners only)
    pub claimed_allocation: bool,
    
    /// Whether refund has been claimed (non-winners only)
    pub claimed_refund: bool,
    
    /// Deposit timestamp
    pub deposited_at: i64,
    
    pub bump: u8,
}

// ============================================================================
// Instructions
// ============================================================================

#[derive(Accounts)]
pub struct OpenPresale<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Presale::INIT_SPACE,
        seeds = [b"presale", protocol.key().as_ref(), &(protocol.total_launches + 1).to_le_bytes()],
        bump
    )]
    pub presale: Account<'info, Presale>,
    
    #[account(mut, seeds = [b"protocol"], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositPresale<'info> {
    #[account(
        mut,
        seeds = [b"presale", presale.protocol.as_ref(), &presale.round.to_le_bytes()],
        bump = presale.bump,
        constraint = presale.status == PresaleStatus::Open @ BoomError::PresaleNotOpen
    )]
    pub presale: Account<'info, Presale>,
    
    #[account(
        init,
        payer = depositor,
        space = 8 + PresaleDeposit::INIT_SPACE,
        seeds = [b"deposit", presale.key().as_ref(), depositor.key().as_ref()],
        bump
    )]
    pub deposit: Account<'info, PresaleDeposit>,
    
    /// Presale vault to hold deposits
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    
    /// Depositor's token account
    #[account(mut)]
    pub depositor_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub depositor: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClosePresale<'info> {
    #[account(
        mut,
        seeds = [b"presale", presale.protocol.as_ref(), &presale.round.to_le_bytes()],
        bump = presale.bump,
        constraint = presale.status == PresaleStatus::Open @ BoomError::PresaleNotOpen
    )]
    pub presale: Account<'info, Presale>,
    
    pub authority: Signer<'info>,
}

// Note: RunLottery is now handled by the VRF module (RequestLotteryVrf + ConsumeLotteryVrf)

#[derive(Accounts)]
pub struct ClaimAllocation<'info> {
    #[account(
        seeds = [b"presale", presale.protocol.as_ref(), &presale.round.to_le_bytes()],
        bump = presale.bump,
        constraint = presale.status == PresaleStatus::LotteryComplete @ BoomError::LotteryNotComplete
    )]
    pub presale: Account<'info, Presale>,
    
    #[account(
        mut,
        seeds = [b"deposit", presale.key().as_ref(), depositor.key().as_ref()],
        bump = deposit.bump,
        constraint = deposit.is_winner @ BoomError::NotWinner,
        constraint = !deposit.claimed_allocation @ BoomError::AlreadyClaimed
    )]
    pub deposit: Account<'info, PresaleDeposit>,
    
    #[account(mut)]
    pub depositor: Signer<'info>,
    
    // Token accounts for early buy-in would go here
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(
        seeds = [b"presale", presale.protocol.as_ref(), &presale.round.to_le_bytes()],
        bump = presale.bump,
        constraint = presale.status == PresaleStatus::Finalized @ BoomError::PresaleNotFinalized
    )]
    pub presale: Account<'info, Presale>,
    
    #[account(
        mut,
        seeds = [b"deposit", presale.key().as_ref(), depositor.key().as_ref()],
        bump = deposit.bump,
        constraint = !deposit.is_winner @ BoomError::WinnerCannotRefund,
        constraint = !deposit.claimed_refund @ BoomError::AlreadyClaimed
    )]
    pub deposit: Account<'info, PresaleDeposit>,
    
    /// Presale vault
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    
    /// Depositor's token account for refund
    #[account(mut)]
    pub depositor_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub depositor: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

// ============================================================================
// Instruction Handlers
// ============================================================================

pub fn open_presale(ctx: Context<OpenPresale>, cooldown_seconds: i64, winner_count: u32, winner_allocation: u64) -> Result<()> {
    let presale = &mut ctx.accounts.presale;
    let protocol = &ctx.accounts.protocol;
    let clock = Clock::get()?;
    
    presale.protocol = protocol.key();
    presale.round = protocol.total_launches + 1;
    presale.total_deposited = 0;
    presale.depositor_count = 0;
    presale.status = PresaleStatus::Open;
    presale.opened_at = clock.unix_timestamp;
    presale.closes_at = clock.unix_timestamp + cooldown_seconds;
    presale.lottery_seed = [0u8; 32];
    presale.winner_count = winner_count;
    presale.winner_allocation = winner_allocation;
    presale.token_mint = Pubkey::default();
    presale.bump = ctx.bumps.presale;
    
    emit!(PresaleOpened {
        round: presale.round,
        closes_at: presale.closes_at,
        winner_count,
        winner_allocation,
    });
    
    Ok(())
}

pub fn deposit_presale(ctx: Context<DepositPresale>, amount: u64) -> Result<()> {
    let presale = &mut ctx.accounts.presale;
    let deposit = &mut ctx.accounts.deposit;
    let clock = Clock::get()?;
    
    // Check presale is still open
    require!(clock.unix_timestamp < presale.closes_at, BoomError::PresaleClosed);
    
    // Transfer tokens to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.depositor_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.depositor.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;
    
    // Record deposit
    deposit.presale = presale.key();
    deposit.depositor = ctx.accounts.depositor.key();
    deposit.amount = amount;
    deposit.position = presale.depositor_count;
    deposit.is_winner = false;
    deposit.claimed_allocation = false;
    deposit.claimed_refund = false;
    deposit.deposited_at = clock.unix_timestamp;
    deposit.bump = ctx.bumps.deposit;
    
    presale.total_deposited += amount;
    presale.depositor_count += 1;
    
    emit!(PresaleDeposited {
        round: presale.round,
        depositor: deposit.depositor,
        amount,
        position: deposit.position,
        total_deposited: presale.total_deposited,
    });
    
    Ok(())
}

pub fn close_presale(ctx: Context<ClosePresale>) -> Result<()> {
    let presale = &mut ctx.accounts.presale;
    let clock = Clock::get()?;
    
    // Can close early by authority or automatically after closes_at
    require!(
        clock.unix_timestamp >= presale.closes_at,
        BoomError::PresaleNotEnded
    );
    
    presale.status = PresaleStatus::Closed;
    
    emit!(PresaleClosed {
        round: presale.round,
        total_deposited: presale.total_deposited,
        depositor_count: presale.depositor_count,
    });
    
    Ok(())
}

// Note: run_lottery is now handled by the VRF module (request_lottery_vrf + consume_lottery_vrf)
// The VRF module sets presale.lottery_seed and presale.status = LotteryComplete

pub fn claim_allocation(ctx: Context<ClaimAllocation>) -> Result<()> {
    let deposit = &mut ctx.accounts.deposit;
    let presale = &ctx.accounts.presale;
    
    // Mark as claimed
    deposit.claimed_allocation = true;
    
    // TODO: Execute early buy-in at launch price
    // This would mint/transfer tokens to the winner
    
    emit!(AllocationClaimed {
        round: presale.round,
        depositor: deposit.depositor,
        allocation: presale.winner_allocation,
    });
    
    Ok(())
}

pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
    let deposit = &mut ctx.accounts.deposit;
    let presale = &ctx.accounts.presale;
    
    // Transfer refund from vault
    let seeds = &[
        b"presale",
        presale.protocol.as_ref(),
        &presale.round.to_le_bytes(),
        &[presale.bump],
    ];
    let signer = &[&seeds[..]];
    
    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.depositor_token_account.to_account_info(),
        authority: ctx.accounts.presale.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    
    token::transfer(cpi_ctx, deposit.amount)?;
    
    deposit.claimed_refund = true;
    
    emit!(RefundClaimed {
        round: presale.round,
        depositor: deposit.depositor,
        amount: deposit.amount,
    });
    
    Ok(())
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct PresaleOpened {
    pub round: u64,
    pub closes_at: i64,
    pub winner_count: u32,
    pub winner_allocation: u64,
}

#[event]
pub struct PresaleDeposited {
    pub round: u64,
    pub depositor: Pubkey,
    pub amount: u64,
    pub position: u32,
    pub total_deposited: u64,
}

#[event]
pub struct PresaleClosed {
    pub round: u64,
    pub total_deposited: u64,
    pub depositor_count: u32,
}

// Note: LotteryComplete event is now in vrf.rs as LotteryVrfConsumed

#[event]
pub struct AllocationClaimed {
    pub round: u64,
    pub depositor: Pubkey,
    pub allocation: u64,
}

#[event]
pub struct RefundClaimed {
    pub round: u64,
    pub depositor: Pubkey,
    pub amount: u64,
}
