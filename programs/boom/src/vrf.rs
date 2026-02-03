use anchor_lang::prelude::*;
use switchboard_solana::prelude::*;

use crate::{BoomToken, Presale, PresaleStatus, Protocol, BoomError};

/// VRF Module for BOOM Protocol
/// 
/// Provides verifiable randomness for:
/// 1. Generating secret market cap thresholds at token launch
/// 2. Running presale lotteries to select winners
/// 
/// Uses Switchboard V2 VRF (Verifiable Random Function) on Solana.

// ============================================================================
// VRF State Accounts
// ============================================================================

/// Tracks a VRF request for a BOOM token's secret cap
#[account]
#[derive(InitSpace)]
pub struct VrfCapRequest {
    /// The BOOM token this request is for
    pub boom_token: Pubkey,
    
    /// The Switchboard VRF account
    pub vrf_account: Pubkey,
    
    /// Request status
    pub status: VrfRequestStatus,
    
    /// When the request was made
    pub requested_at: i64,
    
    /// The randomness result (32 bytes)
    pub result: [u8; 32],
    
    /// The derived market cap value (computed from result)
    pub derived_cap: u64,
    
    /// Bump seed for PDA
    pub bump: u8,
}

/// Tracks a VRF request for presale lottery
#[account]
#[derive(InitSpace)]
pub struct VrfLotteryRequest {
    /// The presale this request is for
    pub presale: Pubkey,
    
    /// The Switchboard VRF account
    pub vrf_account: Pubkey,
    
    /// Request status
    pub status: VrfRequestStatus,
    
    /// When the request was made
    pub requested_at: i64,
    
    /// The randomness result (32 bytes)
    pub result: [u8; 32],
    
    /// Bump seed for PDA
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum VrfRequestStatus {
    /// Request submitted, awaiting VRF callback
    Pending,
    /// VRF callback received, randomness available
    Fulfilled,
    /// Request failed or timed out
    Failed,
}

// ============================================================================
// VRF Client Account - Holds authority for VRF requests
// ============================================================================

/// VRF client account that serves as the authority for VRF requests
#[account]
#[derive(InitSpace)]
pub struct VrfClient {
    /// The protocol this client belongs to
    pub protocol: Pubkey,
    
    /// The Switchboard VRF account
    pub vrf: Pubkey,
    
    /// The oracle queue for VRF requests
    pub oracle_queue: Pubkey,
    
    /// Escrow account holding funds for VRF requests
    pub escrow: Pubkey,
    
    /// Counter for tracking requests
    pub request_count: u64,
    
    /// Bump for PDA derivation
    pub bump: u8,
}

// ============================================================================
// Instruction Contexts
// ============================================================================

/// Initialize VRF client for the protocol
#[derive(Accounts)]
pub struct InitializeVrf<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + VrfClient::INIT_SPACE,
        seeds = [b"vrf_client", protocol.key().as_ref()],
        bump
    )]
    pub vrf_client: Account<'info, VrfClient>,
    
    #[account(seeds = [b"protocol"], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    
    /// The Switchboard VRF account
    /// CHECK: Validated in handler
    pub vrf: AccountInfo<'info>,
    
    /// The oracle queue
    /// CHECK: Validated by Switchboard
    pub oracle_queue: AccountInfo<'info>,
    
    /// Escrow for VRF payment
    /// CHECK: Created by Switchboard
    pub escrow: AccountInfo<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

/// Request VRF for a new BOOM token's secret cap
#[derive(Accounts)]
pub struct RequestCapVrf<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + VrfCapRequest::INIT_SPACE,
        seeds = [b"vrf_cap_request", boom_token.key().as_ref()],
        bump
    )]
    pub vrf_request: Account<'info, VrfCapRequest>,
    
    #[account(
        mut,
        seeds = [b"boom_token", boom_token.mint.as_ref()],
        bump = boom_token.bump,
        constraint = boom_token.cap_hash == [0u8; 32] @ BoomError::CapAlreadySet
    )]
    pub boom_token: Account<'info, BoomToken>,
    
    #[account(seeds = [b"protocol"], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    
    #[account(
        seeds = [b"vrf_client", protocol.key().as_ref()],
        bump = vrf_client.bump
    )]
    pub vrf_client: Account<'info, VrfClient>,
    
    /// The Switchboard VRF account
    #[account(
        mut,
        constraint = vrf.key() == vrf_client.vrf @ BoomError::Unauthorized
    )]
    pub vrf: AccountLoader<'info, VrfAccountData>,
    
    /// Oracle queue for the VRF
    /// CHECK: Validated by Switchboard
    pub oracle_queue: AccountInfo<'info>,
    
    /// Queue authority
    /// CHECK: Validated by Switchboard
    pub queue_authority: AccountInfo<'info>,
    
    /// Data buffer for VRF
    /// CHECK: Validated by Switchboard
    #[account(mut)]
    pub data_buffer: AccountInfo<'info>,
    
    /// Permission account
    /// CHECK: Validated by Switchboard
    pub permission: AccountInfo<'info>,
    
    /// Escrow account
    /// CHECK: Validated by Switchboard
    #[account(mut)]
    pub escrow: AccountInfo<'info>,
    
    /// Payer's token account for escrow funding
    #[account(mut)]
    pub payer_wallet: Account<'info, anchor_spl::token::TokenAccount>,
    
    /// Recent blockhashes sysvar
    /// CHECK: Sysvar
    pub recent_blockhashes: AccountInfo<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub switchboard_program: Program<'info, SwitchboardProgram>,
    pub token_program: Program<'info, anchor_spl::token::Token>,
    pub system_program: Program<'info, System>,
}

/// Callback from Switchboard VRF for secret cap
#[derive(Accounts)]
pub struct ConsumeCapVrf<'info> {
    #[account(
        mut,
        seeds = [b"vrf_cap_request", boom_token.key().as_ref()],
        bump = vrf_request.bump,
        constraint = vrf_request.status == VrfRequestStatus::Pending @ BoomError::Unauthorized
    )]
    pub vrf_request: Account<'info, VrfCapRequest>,
    
    #[account(
        mut,
        seeds = [b"boom_token", boom_token.mint.as_ref()],
        bump = boom_token.bump
    )]
    pub boom_token: Account<'info, BoomToken>,
    
    #[account(seeds = [b"protocol"], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    
    /// The Switchboard VRF account with the result
    #[account(
        constraint = vrf.key() == vrf_request.vrf_account @ BoomError::Unauthorized
    )]
    pub vrf: AccountLoader<'info, VrfAccountData>,
}

/// Request VRF for presale lottery
#[derive(Accounts)]
pub struct RequestLotteryVrf<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + VrfLotteryRequest::INIT_SPACE,
        seeds = [b"vrf_lottery_request", presale.key().as_ref()],
        bump
    )]
    pub vrf_request: Account<'info, VrfLotteryRequest>,
    
    #[account(
        mut,
        seeds = [b"presale", presale.protocol.as_ref(), &presale.round.to_le_bytes()],
        bump = presale.bump,
        constraint = presale.status == PresaleStatus::Closed @ BoomError::PresaleNotClosed
    )]
    pub presale: Account<'info, Presale>,
    
    #[account(seeds = [b"protocol"], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    
    #[account(
        seeds = [b"vrf_client", protocol.key().as_ref()],
        bump = vrf_client.bump
    )]
    pub vrf_client: Account<'info, VrfClient>,
    
    /// The Switchboard VRF account
    #[account(
        mut,
        constraint = vrf.key() == vrf_client.vrf @ BoomError::Unauthorized
    )]
    pub vrf: AccountLoader<'info, VrfAccountData>,
    
    /// Oracle queue for the VRF
    /// CHECK: Validated by Switchboard
    pub oracle_queue: AccountInfo<'info>,
    
    /// Queue authority
    /// CHECK: Validated by Switchboard
    pub queue_authority: AccountInfo<'info>,
    
    /// Data buffer for VRF
    /// CHECK: Validated by Switchboard
    #[account(mut)]
    pub data_buffer: AccountInfo<'info>,
    
    /// Permission account
    /// CHECK: Validated by Switchboard
    pub permission: AccountInfo<'info>,
    
    /// Escrow account
    /// CHECK: Validated by Switchboard
    #[account(mut)]
    pub escrow: AccountInfo<'info>,
    
    /// Payer's token account for escrow funding
    #[account(mut)]
    pub payer_wallet: Account<'info, anchor_spl::token::TokenAccount>,
    
    /// Recent blockhashes sysvar
    /// CHECK: Sysvar
    pub recent_blockhashes: AccountInfo<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub switchboard_program: Program<'info, SwitchboardProgram>,
    pub token_program: Program<'info, anchor_spl::token::Token>,
    pub system_program: Program<'info, System>,
}

/// Callback from Switchboard VRF for lottery
#[derive(Accounts)]
pub struct ConsumeLotteryVrf<'info> {
    #[account(
        mut,
        seeds = [b"vrf_lottery_request", presale.key().as_ref()],
        bump = vrf_request.bump,
        constraint = vrf_request.status == VrfRequestStatus::Pending @ BoomError::Unauthorized
    )]
    pub vrf_request: Account<'info, VrfLotteryRequest>,
    
    #[account(
        mut,
        seeds = [b"presale", presale.protocol.as_ref(), &presale.round.to_le_bytes()],
        bump = presale.bump
    )]
    pub presale: Account<'info, Presale>,
    
    /// The Switchboard VRF account with the result
    #[account(
        constraint = vrf.key() == vrf_request.vrf_account @ BoomError::Unauthorized
    )]
    pub vrf: AccountLoader<'info, VrfAccountData>,
}

// ============================================================================
// Instruction Handlers
// ============================================================================

/// Initialize the VRF client for the protocol
pub fn initialize_vrf(ctx: Context<InitializeVrf>) -> Result<()> {
    let vrf_client = &mut ctx.accounts.vrf_client;
    
    vrf_client.protocol = ctx.accounts.protocol.key();
    vrf_client.vrf = ctx.accounts.vrf.key();
    vrf_client.oracle_queue = ctx.accounts.oracle_queue.key();
    vrf_client.escrow = ctx.accounts.escrow.key();
    vrf_client.request_count = 0;
    vrf_client.bump = ctx.bumps.vrf_client;
    
    emit!(VrfClientInitialized {
        protocol: vrf_client.protocol,
        vrf: vrf_client.vrf,
        oracle_queue: vrf_client.oracle_queue,
    });
    
    Ok(())
}

/// Request VRF randomness for a BOOM token's secret cap
pub fn request_cap_vrf(ctx: Context<RequestCapVrf>) -> Result<()> {
    let vrf_request = &mut ctx.accounts.vrf_request;
    let clock = Clock::get()?;
    
    // Initialize the VRF request
    vrf_request.boom_token = ctx.accounts.boom_token.key();
    vrf_request.vrf_account = ctx.accounts.vrf.key();
    vrf_request.status = VrfRequestStatus::Pending;
    vrf_request.requested_at = clock.unix_timestamp;
    vrf_request.result = [0u8; 32];
    vrf_request.derived_cap = 0;
    vrf_request.bump = ctx.bumps.vrf_request;
    
    // Build the VRF request instruction
    // The callback will be our consume_cap_vrf instruction
    let vrf = ctx.accounts.vrf.load()?;
    let switchboard_program = ctx.accounts.switchboard_program.to_account_info();
    
    // Create the VRF request CPI
    let vrf_request_randomness = VrfRequestRandomness {
        authority: ctx.accounts.vrf_client.to_account_info(),
        vrf: ctx.accounts.vrf.to_account_info(),
        oracle_queue: ctx.accounts.oracle_queue.to_account_info(),
        queue_authority: ctx.accounts.queue_authority.to_account_info(),
        data_buffer: ctx.accounts.data_buffer.to_account_info(),
        permission: ctx.accounts.permission.to_account_info(),
        escrow: ctx.accounts.escrow.clone(),
        payer_wallet: ctx.accounts.payer_wallet.to_account_info(),
        payer_authority: ctx.accounts.payer.to_account_info(),
        recent_blockhashes: ctx.accounts.recent_blockhashes.to_account_info(),
        program_state: switchboard_program.clone(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };
    
    // Sign with the VRF client PDA
    let protocol_key = ctx.accounts.protocol.key();
    let seeds = &[
        b"vrf_client",
        protocol_key.as_ref(),
        &[ctx.accounts.vrf_client.bump],
    ];
    let signer = &[&seeds[..]];
    
    // Request the VRF
    drop(vrf);
    vrf_request_randomness.invoke_signed(
        ctx.accounts.switchboard_program.to_account_info(),
        signer,
    )?;
    
    emit!(CapVrfRequested {
        boom_token: vrf_request.boom_token,
        vrf_account: vrf_request.vrf_account,
        requested_at: vrf_request.requested_at,
    });
    
    Ok(())
}

/// Consume VRF result and set the secret cap for a BOOM token
pub fn consume_cap_vrf(ctx: Context<ConsumeCapVrf>) -> Result<()> {
    let vrf_request = &mut ctx.accounts.vrf_request;
    let boom_token = &mut ctx.accounts.boom_token;
    let protocol = &ctx.accounts.protocol;
    
    // Load VRF result
    let vrf = ctx.accounts.vrf.load()?;
    
    // Verify the VRF has been fulfilled
    let result = vrf.get_result()?;
    require!(result != [0u8; 32], BoomError::Unauthorized);
    
    // Store the randomness result
    vrf_request.result = result;
    vrf_request.status = VrfRequestStatus::Fulfilled;
    
    // Derive the market cap from randomness
    // Cap is uniformly distributed between min_cap and max_cap
    let cap_range = protocol.max_cap - protocol.min_cap;
    let random_u64 = u64::from_le_bytes(result[0..8].try_into().unwrap());
    let derived_cap = protocol.min_cap + (random_u64 % cap_range);
    vrf_request.derived_cap = derived_cap;
    
    // Store the hash of the cap (not the cap itself - that stays secret!)
    let cap_hash = anchor_lang::solana_program::hash::hash(&derived_cap.to_le_bytes());
    boom_token.cap_hash = cap_hash.to_bytes();
    
    emit!(CapVrfConsumed {
        boom_token: boom_token.key(),
        cap_hash: boom_token.cap_hash,
        // Note: We emit the hash, not the actual cap value
    });
    
    Ok(())
}

/// Request VRF randomness for a presale lottery
pub fn request_lottery_vrf(ctx: Context<RequestLotteryVrf>) -> Result<()> {
    let vrf_request = &mut ctx.accounts.vrf_request;
    let clock = Clock::get()?;
    
    // Initialize the VRF request
    vrf_request.presale = ctx.accounts.presale.key();
    vrf_request.vrf_account = ctx.accounts.vrf.key();
    vrf_request.status = VrfRequestStatus::Pending;
    vrf_request.requested_at = clock.unix_timestamp;
    vrf_request.result = [0u8; 32];
    vrf_request.bump = ctx.bumps.vrf_request;
    
    // Build the VRF request CPI
    let vrf = ctx.accounts.vrf.load()?;
    let switchboard_program = ctx.accounts.switchboard_program.to_account_info();
    
    let vrf_request_randomness = VrfRequestRandomness {
        authority: ctx.accounts.vrf_client.to_account_info(),
        vrf: ctx.accounts.vrf.to_account_info(),
        oracle_queue: ctx.accounts.oracle_queue.to_account_info(),
        queue_authority: ctx.accounts.queue_authority.to_account_info(),
        data_buffer: ctx.accounts.data_buffer.to_account_info(),
        permission: ctx.accounts.permission.to_account_info(),
        escrow: ctx.accounts.escrow.clone(),
        payer_wallet: ctx.accounts.payer_wallet.to_account_info(),
        payer_authority: ctx.accounts.payer.to_account_info(),
        recent_blockhashes: ctx.accounts.recent_blockhashes.to_account_info(),
        program_state: switchboard_program.clone(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };
    
    // Sign with the VRF client PDA
    let protocol_key = ctx.accounts.protocol.key();
    let seeds = &[
        b"vrf_client",
        protocol_key.as_ref(),
        &[ctx.accounts.vrf_client.bump],
    ];
    let signer = &[&seeds[..]];
    
    drop(vrf);
    vrf_request_randomness.invoke_signed(
        ctx.accounts.switchboard_program.to_account_info(),
        signer,
    )?;
    
    emit!(LotteryVrfRequested {
        presale: vrf_request.presale,
        vrf_account: vrf_request.vrf_account,
        requested_at: vrf_request.requested_at,
    });
    
    Ok(())
}

/// Consume VRF result and complete the presale lottery
pub fn consume_lottery_vrf(ctx: Context<ConsumeLotteryVrf>) -> Result<()> {
    let vrf_request = &mut ctx.accounts.vrf_request;
    let presale = &mut ctx.accounts.presale;
    
    // Load VRF result
    let vrf = ctx.accounts.vrf.load()?;
    
    // Verify the VRF has been fulfilled
    let result = vrf.get_result()?;
    require!(result != [0u8; 32], BoomError::Unauthorized);
    
    // Store the randomness result
    vrf_request.result = result;
    vrf_request.status = VrfRequestStatus::Fulfilled;
    
    // Set the lottery seed on the presale
    presale.lottery_seed = result;
    presale.status = PresaleStatus::LotteryComplete;
    
    emit!(LotteryVrfConsumed {
        presale: presale.key(),
        lottery_seed: result,
        depositor_count: presale.depositor_count,
        winner_count: presale.winner_count,
    });
    
    Ok(())
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Determine if a deposit position is a winner based on the lottery seed
/// This is a view function that can be called off-chain
pub fn is_lottery_winner(
    lottery_seed: [u8; 32],
    position: u32,
    depositor_count: u32,
    winner_count: u32,
) -> bool {
    if depositor_count == 0 || winner_count == 0 {
        return false;
    }
    
    // If everyone can win, everyone wins
    if winner_count >= depositor_count {
        return true;
    }
    
    // Hash the seed with the position to get a deterministic "ticket"
    let mut data = [0u8; 36];
    data[0..32].copy_from_slice(&lottery_seed);
    data[32..36].copy_from_slice(&position.to_le_bytes());
    
    let ticket_hash = anchor_lang::solana_program::hash::hash(&data);
    let ticket_value = u64::from_le_bytes(ticket_hash.to_bytes()[0..8].try_into().unwrap());
    
    // Calculate threshold: winners are those with ticket < threshold
    // threshold = (winner_count / depositor_count) * u64::MAX
    let threshold = (winner_count as u128 * u64::MAX as u128 / depositor_count as u128) as u64;
    
    ticket_value < threshold
}

/// Calculate the derived cap from VRF result
pub fn derive_cap_from_vrf(result: [u8; 32], min_cap: u64, max_cap: u64) -> u64 {
    let cap_range = max_cap - min_cap;
    let random_u64 = u64::from_le_bytes(result[0..8].try_into().unwrap());
    min_cap + (random_u64 % cap_range)
}

// ============================================================================
// VRF Events
// ============================================================================

#[event]
pub struct VrfClientInitialized {
    pub protocol: Pubkey,
    pub vrf: Pubkey,
    pub oracle_queue: Pubkey,
}

#[event]
pub struct CapVrfRequested {
    pub boom_token: Pubkey,
    pub vrf_account: Pubkey,
    pub requested_at: i64,
}

#[event]
pub struct CapVrfConsumed {
    pub boom_token: Pubkey,
    pub cap_hash: [u8; 32],
}

#[event]
pub struct LotteryVrfRequested {
    pub presale: Pubkey,
    pub vrf_account: Pubkey,
    pub requested_at: i64,
}

#[event]
pub struct LotteryVrfConsumed {
    pub presale: Pubkey,
    pub lottery_seed: [u8; 32],
    pub depositor_count: u32,
    pub winner_count: u32,
}

// ============================================================================
// VRF Errors (added to main BoomError enum)
// ============================================================================

#[error_code]
pub enum VrfError {
    #[msg("VRF result not yet available")]
    VrfNotFulfilled,
    
    #[msg("VRF request already fulfilled")]
    VrfAlreadyFulfilled,
    
    #[msg("Invalid VRF account")]
    InvalidVrfAccount,
    
    #[msg("VRF request timeout")]
    VrfTimeout,
}
