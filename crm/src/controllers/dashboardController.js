const { DashboardService } = require('../services/dashboardService');

class DashboardController {
  constructor(repository = null) {
    this.dashboardService = new DashboardService(repository);
  }

  async summary() {
    const summary = await this.dashboardService.getDashboardSummary();
    return { data: summary, ok: true };
  }
}

module.exports = { DashboardController };
