// // Load environment variables from .env file
// import 'dotenv/config';

// // Import Stacks transaction utilities
// import pkg from '@stacks/transactions';
// const {
//     makeSTXTokenTransfer,        // Creates STX transfer transactions
//     broadcastTransaction,        // Sends transactions to the network
//     getAddressFromPrivateKey,    // Derives Stacks address from private key
//     TransactionVersion,          // Network version constants (mainnet/testnet)
//     estimateTransactionFeeWithFallback, // Estimates transaction fees
// } = pkg;

// // Import network configuration for mainnet
// import { StacksMainnet } from '@stacks/network';

// // Import wallet utilities for mnemonic-to-private-key conversion
// import { generateWallet } from '@stacks/wallet-sdk';
// // Import file system utilities to read wallets.json
// import { readFileSync, writeFileSync } from 'fs';
// // Import fetch for API calls
// import fetch from 'node-fetch';

// // Get configuration from environment variables
// const RECIPIENT = process.env.RECIPIENT_ADDRESS;       // Destination STX address
// const MEMO = process.env.TRANSFER_MEMO || '102687864'; // Transaction memo/note
// const API_KEY = process.env.HIRO_API_KEY;              // Hiro API key for rate limiting

// // Configure network with API key (using mainnet for production)
// const NETWORK = new StacksMainnet({
//     url: 'https://api.mainnet.hiro.so'
// });

// // Add API key to network configuration if available
// if (API_KEY) {
//     NETWORK.fetchFn = async (url, options = {}) => {
//         const headers = {
//             ...options.headers,
//             'Authorization': `Bearer ${API_KEY}`
//         };
//         return fetch(url, { ...options, headers });
//     };
// }

// // ✅ Utility: Delay function to avoid rate limits
// const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// // ✅ Utility: Safe Fetch with retry logic to handle rate limits
// async function safeFetch(url, options = {}, retries = 5) {
//     for (let i = 0; i < retries; i++) {
//         const res = await fetch(url, options);
//         if (res.status === 429) {  // Rate limit exceeded
//             console.log('⚠ Rate limit hit. Waiting 30s before retry...');
//             await delay(30000); // Wait 30 seconds
//             continue;
//         }
//         return res;
//     }
//     throw new Error('Rate limit exceeded after multiple retries');
// }

// // Read and parse wallets from wallets.json file
// const walletsData = JSON.parse(readFileSync('./walletsm.json', 'utf8'));
// console.log(`📁 Loaded ${walletsData.length} wallets from walletsm.json`);

// // Initialize reporting data structure
// const transferReport = {
//     timestamp: new Date().toISOString(),
//     recipient: process.env.RECIPIENT_ADDRESS,
//     memo: process.env.TRANSFER_MEMO || '102687864',
//     wallets: [],
//     summary: {}
// };

// /**
//  * Main function to send the maximum available STX balance
//  * This function will:
//  * 1. Get the sender's address from private key
//  * 2. Fetch current STX balance from the blockchain
//  * 3. Calculate maximum sendable amount (balance - transaction fees)
//  * 4. Create and broadcast the transaction
//  */
// async function sendStxFromWallet(walletData, walletIndex) {
//     console.log(`\n🚀 Processing wallet ${walletIndex + 1}/${walletsData.length}: ${walletData.name} (Owner: ${walletData.owner})`);

//     // Initialize wallet report data
//     const walletReport = {
//         name: walletData.name,
//         owner: walletData.owner,
//         address: '',
//         initialBalance: 0,
//         transferredAmount: 0,
//         transactionFee: 0,
//         txid: '',
//         status: 'failed',
//         error: null
//     };

//     // Generate wallet from mnemonic phrase (the privateKey field contains the mnemonic)
//     const wallet = await generateWallet({
//         secretKey: walletData.privateKey,  // The mnemonic phrase from wallets.json
//         password: ''                       // Empty password for simplicity
//     });

//     // Extract the private key from the first account in the wallet
//     const PRIVATE_KEY = wallet.accounts[0].stxPrivateKey;

//     // Derive the sender's Stacks address from the private key
//     const senderAddress = getAddressFromPrivateKey(PRIVATE_KEY, TransactionVersion.Mainnet);
//     walletReport.address = senderAddress;

//     // Display transaction details
//     console.log(`🔑 Sending from: ${senderAddress}`);
//     console.log(`📬 To: ${RECIPIENT}`);
//     console.log(`📝 Memo: ${MEMO}`);

//     // Fetch current STX balance from the Stacks blockchain API
//     console.log('🔍 Fetching balance...');
//     const headers = API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
//     const response = await safeFetch(`${NETWORK.coreApiUrl}/extended/v1/address/${senderAddress}/balances`, { headers });
//     const accountInfo = await response.json();

//     // Convert balance to BigInt for precise arithmetic (STX uses microSTX units)
//     const currentBalance = BigInt(accountInfo.stx.balance);
//     walletReport.initialBalance = Number(currentBalance);
//     console.log(`💰 Current balance: ${Number(currentBalance) / 1000000} STX`);

//     // Calculate dynamic transaction fee for maximum accuracy
//     console.log('🧮 Calculating exact transaction fee...');

//     // Create a temporary transaction to estimate fees
//     const tempTxOptions = {
//         recipient: RECIPIENT,
//         amount: '1000', // Temporary amount for fee estimation
//         senderKey: PRIVATE_KEY,
//         network: NETWORK,
//         memo: MEMO,
//     };

//     const tempTransaction = await makeSTXTokenTransfer(tempTxOptions);
//     const actualFee = await estimateTransactionFeeWithFallback(tempTransaction, NETWORK);
//     const estimatedFee = BigInt(actualFee);

//     walletReport.transactionFee = Number(estimatedFee);
//     console.log(`💸 Estimated transaction fee: ${Number(estimatedFee) / 1000000} STX`);

//     const maxSendableAmount = currentBalance - estimatedFee;
//     walletReport.transferredAmount = Number(maxSendableAmount);
//     console.log(`💸 Maximum sendable: ${Number(maxSendableAmount) / 1000000} STX`);

//     // Check if we have enough balance to cover the transaction fee
//     if (maxSendableAmount <= 0) {
//         console.error('🚨 Insufficient balance to cover transaction fees');
//         walletReport.error = 'Insufficient balance for transaction fees';
//         transferReport.wallets.push(walletReport);
//         return;
//     }

//     console.log(`💸 Sending maximum amount: ${Number(maxSendableAmount) / 1000000} STX`);

//     // Configure transaction parameters
//     const txOptions = {
//         recipient: RECIPIENT,                    // Destination STX address
//         amount: maxSendableAmount.toString(),    // Amount in microSTX (as string)
//         senderKey: PRIVATE_KEY,                  // Sender's private key for signing
//         network: NETWORK,                        // Network configuration (mainnet)
//         memo: MEMO,                             // Optional transaction memo
//     };

//     try {
//         // Create the STX transfer transaction
//         console.log('📝 Creating transaction...');
//         const transaction = await makeSTXTokenTransfer(txOptions);

//         // Broadcast the transaction to the Stacks network
//         console.log('📡 Broadcasting transaction...');
//         const broadcastResponse = await broadcastTransaction(transaction, NETWORK);

//         // Check if the transaction was successfully broadcast
//         if (broadcastResponse.error) {
//             console.error('🚨 Error broadcasting transaction:', broadcastResponse.error);
//             walletReport.error = broadcastResponse.error;
//         } else {
//             // Transaction successfully submitted to mempool
//             console.log(`✅ Transaction sent successfully! TXID: ${transaction.txid()}`);
//             console.log(`🔗 View on explorer: https://explorer.stacks.co/txid/${transaction.txid()}?chain=mainnet`);

//             walletReport.txid = transaction.txid();
//             walletReport.status = 'success';
//         }
//     } catch (error) {
//         console.error('🚨 Unexpected error:', error.message);
//         walletReport.error = error.message;
//     }

//     // Add wallet report to global report
//     transferReport.wallets.push(walletReport);
// }

// /**
//  * Main function to process all wallets from wallets.json
//  * This will loop through each wallet and send their maximum STX balance
//  */
// async function processAllWallets() {
//     console.log(`🎯 Starting auto-transfer process for ${walletsData.length} wallets`);
//     console.log(`📬 All funds will be sent to: ${RECIPIENT}`);
//     console.log(`📝 Transaction memo: ${MEMO}`);

//     // Process each wallet one by one
//     for (let i = 0; i < walletsData.length; i++) {
//         try {
//             await sendStxFromWallet(walletsData[i], i);

//             // ✅ Add delay to prevent rate limits
//             if (i < walletsData.length - 1) {
//                 console.log('⏳ Waiting 5 seconds before next wallet...');
//                 await delay(5000);
//             }
//         } catch (error) {
//             console.error(`❌ Failed to process wallet ${walletsData[i].name}:`, error.message);
//         }
//     }

//     console.log(`\n✅ Completed processing all ${walletsData.length} wallets!`);
// }

// /**
//  * Function to check balances of all wallets and sum totals
//  */
// async function checkWalletBalances() {
//     console.log(`\n🔎 Checking wallet balances and summing totals by owner...`);
//     let grandTotal = BigInt(0);

//     for (let i = 0; i < walletsData.length; i++) {
//         const walletData = walletsData[i];

//         // Generate wallet from mnemonic phrase
//         const wallet = await generateWallet({
//             secretKey: walletData.privateKey,
//             password: ''
//         });

//         const PRIVATE_KEY = wallet.accounts[0].stxPrivateKey;
//         const senderAddress = getAddressFromPrivateKey(PRIVATE_KEY, TransactionVersion.Mainnet);

//         // Fetch current STX balance with retry
//         const headers = API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
//         const response = await safeFetch(`${NETWORK.coreApiUrl}/extended/v1/address/${senderAddress}/balances`, { headers });
//         const accountInfo = await response.json();
//         const currentBalance = BigInt(accountInfo.stx.balance);
//         grandTotal += currentBalance;

//         console.log(`🧑 Wallet: ${walletData.name} | Balance: ${Number(currentBalance) / 1000000} STX`);

//         // ✅ Add small delay to avoid hitting rate limits
//         await delay(2000);
//     }

//     console.log(`\n💰 GRAND TOTAL BALANCE FOR ALL WALLETS: ${Number(grandTotal) / 1000000} STX`);
// }

// // ✅ Choose one function to run
// //processAllWallets();
// checkWalletBalances();


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

// Import network configuration for mainnet
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

// ✅ Utility: Delay function to avoid rate limits
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ✅ Utility: Safe Fetch with retry logic to handle rate limits
async function safeFetch(url, options = {}, retries = 5) {
    for (let i = 0; i < retries; i++) {
        const res = await fetch(url, options);
        if (res.status === 429) {  // Rate limit exceeded
            console.log('⚠ Rate limit hit. Waiting 30s before retry...');
            await delay(30000); // Wait 30 seconds
            continue;
        }
        return res;
    }
    throw new Error('Rate limit exceeded after multiple retries');
}

// Read and parse wallets from wallets.json file
const walletsData = JSON.parse(readFileSync('./walletsm.json', 'utf8'));
console.log(`📁 Loaded ${walletsData.length} wallets from walletsm.json`);

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

    // Validate mnemonic phrase
    if (!walletData.privateKey || walletData.privateKey.trim() === '') {
        console.error('🚨 Skipping wallet: Empty or invalid mnemonic phrase');
        walletReport.error = 'Empty or invalid mnemonic phrase';
        transferReport.wallets.push(walletReport);
        return;
    }

    let PRIVATE_KEY;
    try {
        // Generate wallet from mnemonic phrase (the privateKey field contains the mnemonic)
        const wallet = await generateWallet({
            secretKey: walletData.privateKey,  // The mnemonic phrase from wallets.json
            password: ''                       // Empty password for simplicity
        });

        // Extract the private key from the first account in the wallet
        PRIVATE_KEY = wallet.accounts[0].stxPrivateKey;
    } catch (error) {
        console.error('🚨 Invalid mnemonic phrase:', error.message);
        walletReport.error = `Invalid mnemonic phrase: ${error.message}`;
        transferReport.wallets.push(walletReport);
        return;
    }

    // Derive the sender's Stacks address from the private key
    const senderAddress = getAddressFromPrivateKey(PRIVATE_KEY, TransactionVersion.Mainnet);
    walletReport.address = senderAddress;

    // Display transaction details
    console.log(`🔑 Sending from: ${senderAddress}`);
    console.log(`📬 To: ${RECIPIENT}`);
    console.log(`📝 Memo: ${MEMO}`);

    // Fetch current STX balance from the Stacks blockchain API
    console.log('🔍 Fetching balance...');
    const headers = API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
    const response = await safeFetch(`${NETWORK.coreApiUrl}/extended/v1/address/${senderAddress}/balances`, { headers });
    const accountInfo = await response.json();

    // Convert balance to BigInt for precise arithmetic (STX uses microSTX units)
    const currentBalance = BigInt(accountInfo.stx.balance);
    walletReport.initialBalance = Number(currentBalance);
    console.log(`💰 Current balance: ${Number(currentBalance) / 1000000} STX`);

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
    console.log(`💸 Estimated transaction fee: ${Number(estimatedFee) / 1000000} STX`);

    const maxSendableAmount = currentBalance - estimatedFee;
    walletReport.transferredAmount = Number(maxSendableAmount);
    console.log(`💸 Maximum sendable: ${Number(maxSendableAmount) / 1000000} STX`);

    // Check if we have enough balance to cover the transaction fee
    if (maxSendableAmount <= 0) {
        console.error('🚨 Insufficient balance to cover transaction fees');
        walletReport.error = 'Insufficient balance for transaction fees';
        transferReport.wallets.push(walletReport);
        return;
    }

    console.log(`💸 Sending maximum amount: ${Number(maxSendableAmount) / 1000000} STX`);

    // Configure transaction parameters
    const txOptions = {
        recipient: RECIPIENT,                    // Destination STX address
        amount: maxSendableAmount.toString(),    // Amount in microSTX (as string)
        senderKey: PRIVATE_KEY,                  // Sender's private key for signing
        network: NETWORK,                        // Network configuration (mainnet)
        memo: MEMO,                             // Optional transaction memo
    };

    try {
        // Create the STX transfer transaction
        console.log('📝 Creating transaction...');
        const transaction = await makeSTXTokenTransfer(txOptions);

        // Broadcast the transaction to the Stacks network
        console.log('📡 Broadcasting transaction...');
        const broadcastResponse = await broadcastTransaction(transaction, NETWORK);

        // Check if the transaction was successfully broadcast
        if (broadcastResponse.error) {
            console.error('🚨 Error broadcasting transaction:', broadcastResponse.error);
            walletReport.error = broadcastResponse.error;
        } else {
            // Transaction successfully submitted to mempool
            console.log(`✅ Transaction sent successfully! TXID: ${transaction.txid()}`);
            console.log(`🔗 View on explorer: https://explorer.stacks.co/txid/${transaction.txid()}?chain=mainnet`);

            walletReport.txid = transaction.txid();
            walletReport.status = 'success';
        }
    } catch (error) {
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

            // ✅ Add delay to prevent rate limits
            if (i < walletsData.length - 1) {
                console.log('⏳ Waiting 5 seconds before next wallet...');
                await delay(5000);
            }
        } catch (error) {
            console.error(`❌ Failed to process wallet ${walletsData[i].name}:`, error.message);
        }
    }

    console.log(`\n✅ Completed processing all ${walletsData.length} wallets!`);
}

/**
 * Function to check balances of all wallets and sum totals
 */
async function checkWalletBalances() {
    console.log(`\n🔎 Checking wallet balances and summing totals by owner...`);
    let grandTotal = BigInt(0);

    for (let i = 0; i < walletsData.length; i++) {
        const walletData = walletsData[i];

        // Skip wallets with empty mnemonic phrases
        if (!walletData.privateKey || walletData.privateKey.trim() === '') {
            console.log(`⚠️ Skipping wallet ${walletData.name}: Empty mnemonic phrase`);
            continue;
        }

        try {
            // Generate wallet from mnemonic phrase
            const wallet = await generateWallet({
                secretKey: walletData.privateKey,
                password: ''
            });

            const PRIVATE_KEY = wallet.accounts[0].stxPrivateKey;
            const senderAddress = getAddressFromPrivateKey(PRIVATE_KEY, TransactionVersion.Mainnet);

            // Fetch current STX balance with retry
            const headers = API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
            const response = await safeFetch(`${NETWORK.coreApiUrl}/extended/v1/address/${senderAddress}/balances`, { headers });
            const accountInfo = await response.json();
            const currentBalance = BigInt(accountInfo.stx.balance);
            grandTotal += currentBalance;

            console.log(`🧑 Wallet: ${walletData.name} | Balance: ${Number(currentBalance) / 1000000} STX`);

            // ✅ Add small delay to avoid hitting rate limits
            await delay(2000);
        } catch (error) {
            console.error(`⚠️ Error processing wallet ${walletData.name}:`, error.message);
        }
    }

    console.log(`\n💰 GRAND TOTAL BALANCE FOR ALL WALLETS: ${Number(grandTotal) / 1000000} STX`);
}

// ✅ Choose one function to run
//processAllWallets();
checkWalletBalances();