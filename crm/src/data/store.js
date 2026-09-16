const { modelSchema, formRegistry } = require('./schema');

const starterSeed = {
  users: [],
  leads: [],
  transactions: [],
  requirements: [],
  inventory: [],
  roles: [],
  settings: null,
  masters: []
};

const dataStore = {
  ...starterSeed,
  metadata: {
    schema: modelSchema,
    formRegistry
  }
};

module.exports = {
  dataStore,
  starterSeed
};
