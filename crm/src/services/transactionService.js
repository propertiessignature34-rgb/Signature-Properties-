const { dataStore } = require('../data/store');

class TransactionService {
  async listTransactions() {
    return dataStore.transactions;
  }

  async createTransaction(payload) {
    const transaction = {
      TransactionID: `TXN-${Date.now()}`,
      LeadID: payload.leadId,
      Type: payload.type,
      Status: 'Draft',
      UpdatedAt: new Date().toISOString()
    };

    dataStore.transactions.push(transaction);
    return transaction;
  }
}

module.exports = { TransactionService };
