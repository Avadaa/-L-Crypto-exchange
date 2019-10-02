const nodeEth = require('node-eth-address');
const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider("https://mainnet.infura.io/v3/0d86b1f81dba4e6c999d80d8ae860ec0"));
const db = require('../dbQueries');
const Tx = require('ethereumjs-tx');

const ethConfig = require('../../config/ethereum');

const coldWalletAddress = '0x18dbB4B44a5a65eeABf44372C22c4cc708dfb16F';

module.exports = {

    getAddress: (pw) => {
        return nodeEth.getDefaultAddress(pw);
    },

    getBalance: (address) => {
        return web3.fromWei(web3.eth.getBalance(address).toString(), 'ether');
    },

    sendCustomAddress: async (userId, toAddress, amount) => {
        // To deal with pending transactions, only allow a withdraws every two minutes.
        // Withdraw hash and TIME is inserted into a database table, and the timestamp is fetched every time the function is called.
        let withdraws = await db.query(`SELECT * FROM withdraws WHERE "userId" = '${userId}'`);
        let cooldownPlusOne = ethConfig.cooldown + 1;
        let timeDifference = withdraws.length > 0 ? new Date() - Date.parse(withdraws[withdraws.length - 1].date) : cooldownPlusOne;

        if (timeDifference > ethConfig.cooldown) {

            let pkQuery = "SELECT * FROM coldwallet";
            let coldWalletPk = (await db.query(pkQuery))[0].pk;

            let amountWei = web3.toWei(amount, 'ether');
            let gasLimit = ethConfig.gasLimit;
            let gWei = ethConfig.gwei;
            let pk = Buffer.from(coldWalletPk.slice(2, coldWalletPk.length), 'hex');

            let rawTx = {
                nonce: web3.toHex(web3.eth.getTransactionCount(coldWalletAddress)),
                gasPrice: web3.toHex(web3.toWei(gWei, 'gwei')),
                gasLimit: web3.toHex(gasLimit),
                to: toAddress,
                value: web3.toHex(amountWei),
                data: '0x7f7465737432000000000000000000000000000000000000000000000000000000600057'
            }

            try {
                let tx = new Tx.Transaction(rawTx);
                tx.sign(pk);
                let serializedTx = tx.serialize();

                web3.eth.sendRawTransaction('0x' + serializedTx.toString('hex'), async (err, hash) => {
                    if (!err) {

                        let updateBalanceQuery = `UPDATE users SET "balanceETH" = "balanceETH" - ${amount} WHERE "id" = ${userId}`;
                        await db.query(updateBalanceQuery);

                        console.log('User ' + userId + ' has withdrawn ' + amount + ' ETH');

                        await db.query(`INSERT INTO withdraws("userId", "hash", "date", "amount") VALUES('${userId}', '${hash}', '${new Date}', ${amount})`);

                        return null;
                    }
                    else {
                        console.log(err)
                        return 'An error has occured. Please verify your inputs.';

                    }
                });
            }
            catch (error) {
                return 'An error has occured. Please verify your inputs.';
            }


        }
        else
            return 'You can request a withdraw every two minutes. Please wait before sending a new request.';
    },

    sendToColdWallet: async (userId, fromPk, fromAddress, balance) => {

        // To deal with pending transactions, only allow a deposit every two minutes.
        // Deposit hash and TIME is inserted into a database table, and the timestamp is fetched every time the function is called.
        let deposits = await db.query(`SELECT * FROM deposits WHERE "userId" = '${userId}'`);
        let cooldownPlusOne = ethConfig.cooldown + 1;
        let timeDifference = deposits.length > 0 ? new Date() - Date.parse(deposits[deposits.length - 1].date) : cooldownPlusOne;

        if (timeDifference > ethConfig.cooldown) {

            let balanceWei = web3.toWei(balance, 'ether');
            let gasLimit = ethConfig.gasLimit;
            let gWei = ethConfig.gwei;
            let pk = Buffer.from(fromPk.slice(2, fromPk.length), 'hex');


            let rawTx = {
                nonce: web3.toHex(web3.eth.getTransactionCount(fromAddress)),
                gasPrice: web3.toHex(web3.toWei(gWei, 'gwei')),
                gasLimit: web3.toHex(gasLimit),
                to: coldWalletAddress,
                // All available balance in the wallet (balance - max gas fees)
                value: web3.toHex(balanceWei - gasLimit * web3.toWei(gWei, 'gwei')),
                data: '0x7f7465737432000000000000000000000000000000000000000000000000000000600057'
            }

            try {
                let tx = new Tx.Transaction(rawTx);
                tx.sign(pk);
                let serializedTx = tx.serialize();


                web3.eth.sendRawTransaction('0x' + serializedTx.toString('hex'), async (err, hash) => {
                    if (!err) {

                        let amount = web3.fromWei(balanceWei - gasLimit * web3.toWei(gWei, 'gwei'), 'ether');
                        let updateBalanceQuery = `UPDATE users SET "balanceETH" = "balanceETH" + ${amount} WHERE "id" = ${userId}`;
                        db.query(updateBalanceQuery);

                        console.log('User ' + userId + ' has deposited ' + amount + ' ETH');

                        await db.query(`INSERT INTO deposits("userId", "hash", "date", "amount") VALUES('${userId}', '${hash}', '${new Date}', ${amount})`);

                        return true;
                    }
                    else {
                        console.log(err)
                        return err;
                    }
                });
            }
            catch (error) {
                console.log("An error occured during a deposit: " + error);
                return error;
            }

        }




    }


};