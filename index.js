// Load environment variables from .env file
import 'dotenv/config';

// Import Stacks transaction utilities
import pkg from '@stacks/transactions';
const {
  makeSTXTokenTransfer,        // Creates STX transfer transactions
  broadcastTransaction,        // Sends transactions to the network
  getAddressFromPrivateKey,    // Derives Stacks address from private key
  TransactionVersion,          // Network version constants (mainnet/testnet)
  estimateTransactionFeeWithFallback, // Estimates transaction fees
} = pkg;

// Import network configuration for testnet
import { StacksTestnet } from '@stacks/network';
import { StacksMainnet } from '@stacks/network';

// Import wallet utilities for mnemonic-to-private-key conversion
import { generateWallet } from '@stacks/wallet-sdk';
// Import file system utilities to read wallets.json
import { readFileSync, writeFileSync } from 'fs';
// Import fetch for API calls
import fetch from 'node-fetch';

// Get configuration from environment variables
const RECIPIENT = process.env.RECIPIENT_ADDRESS;       // Destination STX address
const MEMO = process.env.TRANSFER_MEMO || '102687864'; // Transaction memo/note
const API_KEY = process.env.HIRO_API_KEY;              // Hiro API key for rate limiting

// Configure network with API key (using mainnet for production)
const NETWORK = new StacksMainnet({
  url: 'https://api.mainnet.hiro.so'
});

// Add API key to network configuration if available
if (API_KEY) {
  NETWORK.fetchFn = async (url, options = {}) => {
    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${API_KEY}`
    };
    return fetch(url, { ...options, headers });
  };
}

// Read and parse wallets from wallets.json file
const walletsData = JSON.parse(readFileSync('./wallets.json', 'utf8'));
console.log(`📁 Loaded ${walletsData.length} wallets from wallets.json`);

// Initialize reporting data structure
const transferReport = {
  timestamp: new Date().toISOString(),
  recipient: process.env.RECIPIENT_ADDRESS,
  memo: process.env.TRANSFER_MEMO || '102687864',
  wallets: [],
  summary: {}
};

/**
 * Main function to send the maximum available STX balance
 * This function will:
 * 1. Get the sender's address from private key
 * 2. Fetch current STX balance from the blockchain
 * 3. Calculate maximum sendable amount (balance - transaction fees)
 * 4. Create and broadcast the transaction
 */
async function sendStxFromWallet(walletData, walletIndex) {
  console.log(`\n🚀 Processing wallet ${walletIndex + 1}/${walletsData.length}: ${walletData.name} (Owner: ${walletData.owner})`);
  
  // Initialize wallet report data
  const walletReport = {
    name: walletData.name,
    owner: walletData.owner,
    address: '',
    initialBalance: 0,
    transferredAmount: 0,
    transactionFee: 0,
    txid: '',
    status: 'failed',
    error: null
  };
  
  // Generate wallet from mnemonic phrase (the privateKey field contains the mnemonic)
  const wallet = await generateWallet({
    secretKey: walletData.privateKey,  // The mnemonic phrase from wallets.json
    password: ''                       // Empty password for simplicity
  });

  // Extract the private key from the first account in the wallet
  const PRIVATE_KEY = wallet.accounts[0].stxPrivateKey;
  
  // Derive the sender's Stacks address from the private key
  // TransactionVersion.Mainnet ensures we're using mainnet addresses (SP...)
  const senderAddress = getAddressFromPrivateKey(PRIVATE_KEY, TransactionVersion.Mainnet);
  walletReport.address = senderAddress;

  // Display transaction details
  console.log(`🔑 Sending from: ${senderAddress}`);
  console.log(`📬 To: ${RECIPIENT}`);
  console.log(`📝 Memo: ${MEMO}`);

  // Fetch current STX balance from the Stacks blockchain API
  console.log('🔍 Fetching balance...');
  const headers = {};
  if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`;
  }
  
  const response = await fetch(`${NETWORK.coreApiUrl}/extended/v1/address/${senderAddress}/balances`, {
    headers: headers
  });
  const accountInfo = await response.json();
  
  // Convert balance to BigInt for precise arithmetic (STX uses microSTX units)
  // 1 STX = 1,000,000 microSTX
  const currentBalance = BigInt(accountInfo.stx.balance);
  walletReport.initialBalance = Number(currentBalance);
  console.log(`💰 Current balance: ${currentBalance} microSTX (${Number(currentBalance) / 1000000} STX)`);

  // Calculate dynamic transaction fee for maximum accuracy
  console.log('🧮 Calculating exact transaction fee...');
  
  // Create a temporary transaction to estimate fees
  const tempTxOptions = {
    recipient: RECIPIENT,
    amount: '1000', // Temporary amount for fee estimation
    senderKey: PRIVATE_KEY,
    network: NETWORK,
    memo: MEMO,
  };

  const tempTransaction = await makeSTXTokenTransfer(tempTxOptions);
  const actualFee = await estimateTransactionFeeWithFallback(tempTransaction, NETWORK);
  const estimatedFee = BigInt(actualFee);
  
  walletReport.transactionFee = Number(estimatedFee);
  console.log(`💰 Estimated transaction fee: ${estimatedFee} microSTX (${Number(estimatedFee) / 1000000} STX)`);
  
  const maxSendableAmount = currentBalance - estimatedFee;
  walletReport.transferredAmount = Number(maxSendableAmount);
  console.log(`💸 Maximum sendable: ${maxSendableAmount} microSTX (${Number(maxSendableAmount) / 1000000} STX)`);

  // Check if we have enough balance to cover the transaction fee
  if (maxSendableAmount <= 0) {
    console.error('🚨 Insufficient balance to cover transaction fees');
    walletReport.error = 'Insufficient balance for transaction fees';
    transferReport.wallets.push(walletReport);
    return;
  }

  console.log(`💸 Sending maximum amount: ${maxSendableAmount} microSTX`);

  // Configure transaction parameters
  const txOptions = {
    recipient: RECIPIENT,                    // Destination STX address
    amount: maxSendableAmount.toString(),    // Amount in microSTX (as string)
    senderKey: PRIVATE_KEY,                  // Sender's private key for signing
    network: NETWORK,                        // Network configuration (testnet/mainnet)
    memo: MEMO,                             // Optional transaction memo
  };

  try {
    // Create the STX transfer transaction
    // This generates a signed transaction ready for broadcast
    console.log('📝 Creating transaction...');
    const transaction = await makeSTXTokenTransfer(txOptions);
    
    // Broadcast the transaction to the Stacks network
    // This sends the transaction to miners for inclusion in a block
    console.log('📡 Broadcasting transaction...');
    const broadcastResponse = await broadcastTransaction(transaction, NETWORK);

    // Check if the transaction was successfully broadcast
    if (broadcastResponse.error) {
      console.error('🚨 Error broadcasting transaction:', broadcastResponse.error);
      console.error('🔍 Error details:', JSON.stringify(broadcastResponse, null, 2));
      
      walletReport.error = broadcastResponse.error;
      
      // Common errors:
      // - NotEnoughFunds: Insufficient balance for amount + fees
      // - InvalidNonce: Account nonce mismatch (try again)
      // - InvalidSignature: Private key doesn't match sender address
    } else {
      // Transaction successfully submitted to mempool
      console.log(`✅ Transaction sent successfully! TXID: ${transaction.txid()}`);
      console.log(`🔗 View on explorer: https://explorer.stacks.co/txid/${transaction.txid()}?chain=mainnet`);
      
      walletReport.txid = transaction.txid();
      walletReport.status = 'success';
    }
  } catch (error) {
    // Handle unexpected errors (network issues, invalid parameters, etc.)
    console.error('🚨 Unexpected error:', error.message);
    walletReport.error = error.message;
  }
  
  // Add wallet report to global report
  transferReport.wallets.push(walletReport);
}

/**
 * Main function to process all wallets from wallets.json
 * This will loop through each wallet and send their maximum STX balance
 */
async function processAllWallets() {
  console.log(`🎯 Starting auto-transfer process for ${walletsData.length} wallets`);
  console.log(`📬 All funds will be sent to: ${RECIPIENT}`);
  console.log(`📝 Transaction memo: ${MEMO}`);
  
  // Process each wallet one by one
  for (let i = 0; i < walletsData.length; i++) {
    try {
      await sendStxFromWallet(walletsData[i], i);
      
      // Add a small delay between transactions to avoid rate limiting
      if (i < walletsData.length - 1) {
        console.log('⏳ Waiting 2 seconds before next wallet...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (error) {
      console.error(`❌ Failed to process wallet ${walletsData[i].name}:`, error.message);
      // Continue with the next wallet even if one fails
    }
  }
  
  // Generate summary report grouped by owner
  console.log(`\n📊 Generating transfer report...`);
  
  const ownerSummary = {};
  let totalTransferred = 0;
  let totalFees = 0;
  
  // Group transfers by owner ID and calculate totals
  transferReport.wallets.forEach(wallet => {
    if (!ownerSummary[wallet.owner]) {
      ownerSummary[wallet.owner] = {
        ownerName: wallet.owner,
        totalInitialBalance: 0,
        totalTransferred: 0,
        totalFees: 0,
        walletCount: 0,
        successfulTransfers: 0,
        wallets: []
      };
    }
    
    const ownerData = ownerSummary[wallet.owner];
    ownerData.totalInitialBalance += wallet.initialBalance;
    ownerData.totalTransferred += wallet.transferredAmount;
    ownerData.totalFees += wallet.transactionFee;
    ownerData.walletCount++;
    if (wallet.status === 'success') ownerData.successfulTransfers++;
    ownerData.wallets.push(wallet);
    
    totalTransferred += wallet.transferredAmount;
    totalFees += wallet.transactionFee;
  });
  
  // Group transfers by person name (Michael, Prisilla, etc.)
  const nameSummary = {};
  transferReport.wallets.forEach(wallet => {
    if (!nameSummary[wallet.name]) {
      nameSummary[wallet.name] = {
        personName: wallet.name,
        totalInitialBalance: 0,
        totalTransferred: 0,
        totalFees: 0,
        walletCount: 0,
        successfulTransfers: 0,
        wallets: []
      };
    }
    
    const nameData = nameSummary[wallet.name];
    nameData.totalInitialBalance += wallet.initialBalance;
    nameData.totalTransferred += wallet.transferredAmount;
    nameData.totalFees += wallet.transactionFee;
    nameData.walletCount++;
    if (wallet.status === 'success') nameData.successfulTransfers++;
    nameData.wallets.push(wallet);
  });
  
  transferReport.summary = {
    totalWallets: walletsData.length,
    totalTransferred: totalTransferred,
    totalFees: totalFees,
    totalTransferredSTX: totalTransferred / 1000000,
    totalFeesSTX: totalFees / 1000000,
    ownerSummary: Object.values(ownerSummary),
    nameSummary: Object.values(nameSummary)
  };
  
  // Export report to file
  const reportFilename = `transfer-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(reportFilename, JSON.stringify(transferReport, null, 2));
  
  console.log(`\n📋 TRANSFER SUMMARY REPORT:`);
  console.log(`════════════════════════════════════════`);
  
  console.log(`\n💰 BY PERSON NAME:`);
  console.log(`────────────────────────────`);
  Object.values(nameSummary).forEach(person => {
    console.log(`\n🧑 ${person.personName}:`);
    console.log(`   💰 Total Initial Balance: ${person.totalInitialBalance / 1000000} STX`);
    console.log(`   📤 Total Transferred: ${person.totalTransferred / 1000000} STX`);
    console.log(`   💸 Total Fees: ${person.totalFees / 1000000} STX`);
    console.log(`   📊 Wallets: ${person.successfulTransfers}/${person.walletCount} successful`);
  });
  
  console.log(`\n\n📋 DETAILED BREAKDOWN BY OWNER ID:`);
  console.log(`────────────────────────────────────────`);
  Object.values(ownerSummary).forEach(owner => {
    console.log(`\n👤 Owner ID: ${owner.ownerName}`);
    console.log(`   💰 Total Initial Balance: ${owner.totalInitialBalance / 1000000} STX`);
    console.log(`   📤 Total Transferred: ${owner.totalTransferred / 1000000} STX`);
    console.log(`   💸 Total Fees: ${owner.totalFees / 1000000} STX`);
    console.log(`   📊 Wallets: ${owner.successfulTransfers}/${owner.walletCount} successful`);
    
    owner.wallets.forEach(wallet => {
      const status = wallet.status === 'success' ? '✅' : '❌';
      console.log(`     ${status} ${wallet.name}: ${wallet.transferredAmount / 1000000} STX (${wallet.address})`);
    });
  });
  
  console.log(`\n🎯 GRAND TOTAL:`);
  console.log(`   📤 Total Transferred: ${totalTransferred / 1000000} STX`);
  console.log(`   💸 Total Fees: ${totalFees / 1000000} STX`);
  console.log(`   📄 Report saved to: ${reportFilename}`);
  
  console.log(`\n✅ Completed processing all ${walletsData.length} wallets!`);
}

// Execute the main function
// This will automatically run when the script is executed with 'node index.js'
processAllWallets();
