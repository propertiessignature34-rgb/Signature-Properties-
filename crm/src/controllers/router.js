const { DashboardController } = require('./dashboardController');
const { LeadController } = require('./leadController');
const { TransactionController } = require('./transactionController');
const { RequirementController } = require('./requirementController');
const { MatchingController } = require('./matchingController');
const { BrokerController } = require('./brokerController');
const { SiteVisitController } = require('./siteVisitController');

class ApiRouter {
  constructor(repository = null) {
    this.routes = {
      dashboard: new DashboardController(repository),
      leads: new LeadController(repository),
      transactions: new TransactionController(),
      requirements: new RequirementController(repository),
      matching: new MatchingController(repository),
      brokers: new BrokerController(),
      siteVisits: new SiteVisitController(repository)
    };
  }

  async route(name, handler, ctx = {}) {
    const controller = this.routes[name];
    if (!controller) {
      throw new Error(`Controller not found for api: ${name}`);
    }

    if (typeof controller[handler] !== 'function') {
      throw new Error(`Handler not found for api: ${name}.${handler}`);
    }

    return controller[handler](ctx);
  }
}

module.exports = { ApiRouter };
