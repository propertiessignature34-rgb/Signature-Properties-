const { TransactionService } = require('../services/transactionService');

class TransactionController {
  constructor() {
    this.transactionService = new TransactionService();
  }

  async list() {
    const transactions = await this.transactionService.listTransactions();
    return { ok: true, data: transactions };
  }

  async create(ctx) {
    const transaction = await this.transactionService.createTransaction(ctx);
    return { ok: true, data: transaction };
  }
}

module.exports = { TransactionController };
