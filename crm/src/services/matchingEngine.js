const { JsonRepository } = require('../data/repository');

const DEFAULT_SCORING = {
  transaction: 20,
  category: 15,
  propertyType: 15,
  budget: 20,
  location: 15,
  bhk: 10,
  area: 5
};

const MATCH_LEVELS = [
  { min: 90, label: 'Excellent' },
  { min: 75, label: 'Strong' },
  { min: 60, label: 'Possible' },
  { min: 40, label: 'Weak' },
  { min: 0, label: 'Poor' }
];

class MatchingEngine {
  constructor(scoringConfig = {}, repository = null) {
    this.repository = repository || new JsonRepository();
    this.scoringConfig = { ...DEFAULT_SCORING, ...scoringConfig };
    this.matchLevelThresholds = MATCH_LEVELS;
    this.algorithmVersion = 'matching-v1';
    this.minMatchScore = 60;
  }

  normalizeText(value) {
    return String(value || '').trim().toLowerCase();
  }

  toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = Number(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(normalized) ? normalized : null;
  }

  cloneList(list) {
    return Array.isArray(list) ? [...list] : [];
  }

  normalizePropertyType(value) {
    const normalized = this.normalizeText(value);
    const aliases = {
      flat: 'apartment',
      condo: 'apartment',
      apartment: 'apartment',
      villa: 'villa',
      house: 'house',
      office: 'office',
      showroom: 'showroom',
      shop: 'shop',
      plot: 'plot',
      land: 'land',
      warehouse: 'warehouse'
    };

    return aliases[normalized] || normalized;
  }

  normalizeCategory(value) {
    const normalized = this.normalizeText(value);
    const aliases = {
      residential: 'residential',
      commercial: 'commercial',
      land: 'land',
      industrial: 'industrial'
    };

    return aliases[normalized] || normalized;
  }

  normalizeTransactionType(value) {
    const normalized = this.normalizeText(value);
    if (!normalized) return null;
    if (['sale', 'sell', 'purchase', 'buy', 'bought'].includes(normalized)) return 'sale';
    if (['rent', 'rent out', 'lease', 'lease out', 'rental'].includes(normalized)) return 'rent';
    return normalized;
  }

  inferRequirementTransactionType(requirement) {
    const explicit = this.normalizeTransactionType(requirement.TransactionType || requirement.transactionType);
    if (explicit) return explicit;

    if (requirement.TransactionID) {
      const transaction = this.repository.list('Transactions').find((item) => item.TransactionID === requirement.TransactionID);
      if (transaction) {
        return this.normalizeTransactionType(transaction.Type || transaction.TransactionType || transaction.type);
      }
    }

    return this.normalizeTransactionType('purchase');
  }

  inferPropertyTransactionType(property) {
    const explicit = this.normalizeTransactionType(property.TransactionType || property.transactionType);
    if (explicit) return explicit;

    const status = this.normalizeText(property.Status || property.status);
    if (['available', 'shortlisted', 'negotiation', 'booked', 'sold'].includes(status)) {
      return 'sale';
    }

    if (['rent', 'rented', 'lease'].includes(status)) {
      return 'rent';
    }

    return null;
  }

  parseBhkRange(requirement) {
    const min = this.toNumber(requirement.BHKMin ?? requirement.bhkMin);
    const max = this.toNumber(requirement.BHKMax ?? requirement.bhkMax);
    if (min !== null || max !== null) {
      return { min: min ?? max, max: max ?? min };
    }

    const textSource = [requirement.SubCategory, requirement.PropertyType, requirement.SpecialNotes].filter(Boolean).join(' ');
    const rangeMatch = textSource.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*bhk/i);
    if (rangeMatch) {
      return { min: Number(rangeMatch[1]), max: Number(rangeMatch[2]) };
    }

    const exactMatch = textSource.match(/(\d+)\s*bhk/i);
    if (exactMatch) {
      const bhk = Number(exactMatch[1]);
      return { min: bhk, max: bhk };
    }

    return null;
  }

  parsePropertyBhk(property) {
    const direct = this.toNumber(property.BHK ?? property.bhk ?? property.Bedrooms ?? property.bedrooms);
    if (direct !== null) return direct;

    const textSource = [property.PropertyType, property.SubCategory, property.Project].filter(Boolean).join(' ');
    const exactMatch = textSource.match(/(\d+)\s*bhk/i);
    return exactMatch ? Number(exactMatch[1]) : null;
  }

  normalizeLocations(requirement) {
    return [requirement.Location1, requirement.Location2, requirement.Location3, requirement.City]
      .map((value) => this.normalizeText(value))
      .filter(Boolean);
  }

  normalizePropertyLocations(property) {
    return [property.Location, property.City, property.AreaName, property.Locality]
      .map((value) => this.normalizeText(value))
      .filter(Boolean);
  }

  resolveCityToken(value) {
    const normalized = this.normalizeText(value);
    if (!normalized) return null;

    const commaParts = normalized.split(',').map((part) => part.trim()).filter(Boolean);
    if (commaParts.length > 1) {
      return commaParts[commaParts.length - 1];
    }

    const tokens = normalized.split(/\s+/).filter(Boolean);
    return tokens[0] || normalized;
  }

  criterion(name, weight, status, score, detail, applicable = true) {
    return { name, weight, status, score, detail, applicable };
  }

  evaluateTransaction(requirementType, propertyType) {
    if (!requirementType || !propertyType) {
      return this.criterion('transaction', this.scoringConfig.transaction, 'unknown', 0, 'Transaction type unavailable', false);
    }

    const compatible = (requirementType === 'sale' && propertyType === 'sale') || (requirementType === 'rent' && propertyType === 'rent');
    return compatible
      ? this.criterion('transaction', this.scoringConfig.transaction, 'matched', 100, `Requirement ${requirementType} is compatible with property ${propertyType}`)
      : this.criterion('transaction', this.scoringConfig.transaction, 'failed', 0, `Requirement ${requirementType} is incompatible with property ${propertyType}`);
  }

  evaluateCategory(requirementCategory, propertyCategory) {
    if (!requirementCategory || !propertyCategory) {
      return this.criterion('category', this.scoringConfig.category, 'unknown', 0, 'Category unavailable', false);
    }

    const matched = this.normalizeCategory(requirementCategory) === this.normalizeCategory(propertyCategory);
    return matched
      ? this.criterion('category', this.scoringConfig.category, 'matched', 100, `Category ${requirementCategory} matches`)
      : this.criterion('category', this.scoringConfig.category, 'failed', 0, `Category ${requirementCategory} does not match ${propertyCategory}`);
  }

  evaluatePropertyType(requirementType, propertyType) {
    if (!requirementType || !propertyType) {
      return this.criterion('propertyType', this.scoringConfig.propertyType, 'unknown', 0, 'Property type unavailable', false);
    }

    const req = this.normalizePropertyType(requirementType);
    const prop = this.normalizePropertyType(propertyType);
    if (req === prop) {
      return this.criterion('propertyType', this.scoringConfig.propertyType, 'matched', 100, `Property type ${propertyType} matches`);
    }

    const aliasMatch = ['apartment', 'flat', 'condo'].includes(req) && ['apartment', 'flat', 'condo'].includes(prop);
    if (aliasMatch) {
      return this.criterion('propertyType', this.scoringConfig.propertyType, 'partial', 85, `Property type ${propertyType} is normalized to ${req}`);
    }

    return this.criterion('propertyType', this.scoringConfig.propertyType, 'failed', 0, `Property type ${propertyType} does not match ${requirementType}`);
  }

  evaluateBudget(requirement, property) {
    const min = this.toNumber(requirement.BudgetMin ?? requirement.budgetMin);
    const max = this.toNumber(requirement.BudgetMax ?? requirement.budgetMax);
    const price = this.toNumber(property.Price ?? property.price);

    if (min === null && max === null) {
      return this.criterion('budget', this.scoringConfig.budget, 'unknown', 0, 'Budget unavailable', false);
    }

    if (price === null) {
      return this.criterion('budget', this.scoringConfig.budget, 'unknown', 0, 'Property price unavailable', false);
    }

    const lower = min ?? max;
    const upper = max ?? min;

    if (price >= lower && price <= upper) {
      return this.criterion('budget', this.scoringConfig.budget, 'matched', 100, `Price ${price} is within requirement range`);
    }

    const lowerGap = lower > 0 ? Math.abs(price - lower) / lower : 1;
    const upperGap = upper > 0 ? Math.abs(price - upper) / upper : 1;
    const gap = Math.min(lowerGap, upperGap);
    if (gap <= 0.1) {
      return this.criterion('budget', this.scoringConfig.budget, 'partial', 65, `Price ${price} is slightly outside the requirement range`);
    }

    return this.criterion('budget', this.scoringConfig.budget, 'failed', 0, `Price ${price} is outside the requirement range`);
  }

  evaluateLocation(requirement, property) {
    const requirementLocations = this.normalizeLocations(requirement);
    const propertyLocations = this.normalizePropertyLocations(property);

    if (!requirementLocations.length || !propertyLocations.length) {
      return this.criterion('location', this.scoringConfig.location, 'unknown', 0, 'Location unavailable', false);
    }

    for (const reqLocation of requirementLocations) {
      for (const propLocation of propertyLocations) {
        if (reqLocation === propLocation) {
          return this.criterion('location', this.scoringConfig.location, 'matched', 100, `Exact location match: ${propLocation}`);
        }
      }
    }

    const requirementCities = requirementLocations.map((value) => this.resolveCityToken(value)).filter(Boolean);
    const propertyCities = propertyLocations.map((value) => this.resolveCityToken(value)).filter(Boolean);
    const cityMatch = requirementCities.find((reqCity) => propertyCities.includes(reqCity));
    if (cityMatch) {
      return this.criterion('location', this.scoringConfig.location, 'partial', 70, `City-level match: ${cityMatch}`);
    }

    const partialMatch = requirementLocations.find((reqLocation) => propertyLocations.some((propLocation) => propLocation.includes(reqLocation) || reqLocation.includes(propLocation)));
    if (partialMatch) {
      return this.criterion('location', this.scoringConfig.location, 'partial', 55, `Partial location overlap around ${partialMatch}`);
    }

    return this.criterion('location', this.scoringConfig.location, 'failed', 0, 'Location does not match');
  }

  evaluateBhk(requirement, property) {
    const range = this.parseBhkRange(requirement);
    const bhk = this.parsePropertyBhk(property);

    if (!range) {
      return this.criterion('bhk', this.scoringConfig.bhk, 'unknown', 0, 'BHK preference unavailable', false);
    }

    if (bhk === null) {
      return this.criterion('bhk', this.scoringConfig.bhk, 'unknown', 0, 'Property BHK unavailable', false);
    }

    if (bhk >= range.min && bhk <= range.max) {
      return this.criterion('bhk', this.scoringConfig.bhk, 'matched', 100, `Property BHK ${bhk} is within preferred range ${range.min}-${range.max}`);
    }

    if (bhk === range.min - 1 || bhk === range.max + 1) {
      return this.criterion('bhk', this.scoringConfig.bhk, 'partial', 50, `Property BHK ${bhk} is close to the preferred range ${range.min}-${range.max}`);
    }

    return this.criterion('bhk', this.scoringConfig.bhk, 'failed', 0, `Property BHK ${bhk} is outside the preferred range ${range.min}-${range.max}`);
  }

  evaluateArea(requirement, property) {
    const min = this.toNumber(requirement.AreaMin ?? requirement.areaMin);
    const max = this.toNumber(requirement.AreaMax ?? requirement.areaMax);
    const area = this.toNumber(property.Area ?? property.area);

    if (min === null && max === null) {
      return this.criterion('area', this.scoringConfig.area, 'unknown', 0, 'Area preference unavailable', false);
    }

    if (area === null) {
      return this.criterion('area', this.scoringConfig.area, 'unknown', 0, 'Property area unavailable', false);
    }

    const lower = min ?? max;
    const upper = max ?? min;

    if (area >= lower && area <= upper) {
      return this.criterion('area', this.scoringConfig.area, 'matched', 100, `Area ${area} is within preferred range`);
    }

    const lowerGap = lower > 0 ? Math.abs(area - lower) / lower : 1;
    const upperGap = upper > 0 ? Math.abs(area - upper) / upper : 1;
    const gap = Math.min(lowerGap, upperGap);
    if (gap <= 0.15) {
      return this.criterion('area', this.scoringConfig.area, 'partial', 60, `Area ${area} is close to the preferred range`);
    }

    return this.criterion('area', this.scoringConfig.area, 'failed', 0, `Area ${area} is outside the preferred range`);
  }

  normalizeRequirement(requirement) {
    return {
      ...requirement,
      TransactionType: this.inferRequirementTransactionType(requirement),
      normalizedCategory: this.normalizeCategory(requirement.Category || requirement.category),
      normalizedPropertyType: this.normalizePropertyType(requirement.PropertyType || requirement.propertyType),
      bhkRange: this.parseBhkRange(requirement),
      budgetRange: {
        min: this.toNumber(requirement.BudgetMin ?? requirement.budgetMin),
        max: this.toNumber(requirement.BudgetMax ?? requirement.budgetMax)
      }
    };
  }

  normalizeProperty(property) {
    return {
      ...property,
      TransactionType: this.inferPropertyTransactionType(property),
      normalizedCategory: this.normalizeCategory(property.Category || property.category),
      normalizedPropertyType: this.normalizePropertyType(property.PropertyType || property.propertyType),
      bhk: this.parsePropertyBhk(property),
      area: this.toNumber(property.Area ?? property.area),
      price: this.toNumber(property.Price ?? property.price)
    };
  }

  scoreCriterion(result) {
    const points = result.applicable ? (result.score / 100) * result.weight : 0;
    return { ...result, points: Math.round(points * 1000) / 1000 };
  }

  calculateMatch(requirement, property) {
    const normalizedRequirement = this.normalizeRequirement(requirement);
    const normalizedProperty = this.normalizeProperty(property);

    const breakdown = {
      transaction: this.scoreCriterion(this.evaluateTransaction(normalizedRequirement.TransactionType, normalizedProperty.TransactionType)),
      category: this.scoreCriterion(this.evaluateCategory(normalizedRequirement.Category || normalizedRequirement.category, normalizedProperty.Category || normalizedProperty.category)),
      propertyType: this.scoreCriterion(this.evaluatePropertyType(normalizedRequirement.PropertyType || normalizedRequirement.propertyType, normalizedProperty.PropertyType || normalizedProperty.propertyType)),
      budget: this.scoreCriterion(this.evaluateBudget(normalizedRequirement, normalizedProperty)),
      location: this.scoreCriterion(this.evaluateLocation(normalizedRequirement, normalizedProperty)),
      bhk: this.scoreCriterion(this.evaluateBhk(normalizedRequirement, normalizedProperty)),
      area: this.scoreCriterion(this.evaluateArea(normalizedRequirement, normalizedProperty))
    };

    const totalApplicableWeight = Object.values(breakdown).reduce((sum, item) => sum + (item.applicable ? item.weight : 0), 0);
    const totalPoints = Object.values(breakdown).reduce((sum, item) => sum + item.points, 0);
    const rawScore = totalApplicableWeight > 0 ? (totalPoints / totalApplicableWeight) * 100 : 0;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));
    const matchLevel = this.getMatchLevel(score);

    const matchedCriteria = [];
    const failedCriteria = [];
    const unknownCriteria = [];

    for (const [name, item] of Object.entries(breakdown)) {
      if (item.status === 'matched' || item.status === 'partial') {
        matchedCriteria.push(this.humanizeCriterion(name, item.detail));
      } else if (item.status === 'failed') {
        failedCriteria.push(this.humanizeCriterion(name, item.detail));
      } else {
        unknownCriteria.push(this.humanizeCriterion(name, item.detail));
      }
    }

    const scoreBreakdown = Object.fromEntries(Object.entries(breakdown).map(([name, item]) => [name, {
      status: item.status,
      score: item.score,
      weight: item.weight,
      points: item.points,
      applicable: item.applicable,
      detail: item.detail
    }]));

    return {
      score,
      level: matchLevel,
      matchLevel,
      matchedCriteria,
      failedCriteria,
      unknownCriteria,
      scoreBreakdown,
      explanation: this.generateExplanation({ score, matchLevel, matchedCriteria, failedCriteria, unknownCriteria })
    };
  }

  humanizeCriterion(name, detail) {
    const readable = {
      transaction: 'Transaction compatibility',
      category: 'Category',
      propertyType: 'Property type',
      budget: 'Budget',
      location: 'Location',
      bhk: 'BHK',
      area: 'Area'
    }[name] || name;

    return detail ? `${readable}: ${detail}` : readable;
  }

  getMatchLevel(score) {
    const level = this.matchLevelThresholds.find((item) => score >= item.min);
    return level ? level.label : 'Poor';
  }

  generateExplanation(result) {
    const matched = result.matchedCriteria.length ? result.matchedCriteria.join(', ') : 'None';
    const failed = result.failedCriteria.length ? result.failedCriteria.join(', ') : 'None';
    const unknown = result.unknownCriteria.length ? result.unknownCriteria.join(', ') : 'None';
    const intro = result.matchLevel === 'Excellent' || result.matchLevel === 'Strong' ? `${result.matchLevel} match` : `${result.matchLevel} match`;
    return `${intro}: matched ${matched}. Failed ${failed}. Unknown ${unknown}. Score ${result.score}/100.`;
  }

  isActiveInventoryProperty(property) {
    const status = this.normalizeText(property.Status || property.status);
    return !['inactive', 'withdrawn', 'expired', 'sold'].includes(status);
  }

  persistMatch(requirement, property, evaluation) {
    const existing = this.repository.findMatchByRequirementAndProperty(requirement.RequirementID, property.PropertyID);
    const payload = {
      RequirementID: requirement.RequirementID,
      PropertyID: property.PropertyID,
      LeadID: requirement.LeadID,
      Score: evaluation.score,
      MatchLevel: evaluation.matchLevel,
      MatchedCriteria: evaluation.matchedCriteria,
      FailedCriteria: evaluation.failedCriteria,
      UnknownCriteria: evaluation.unknownCriteria,
      ScoreBreakdown: evaluation.scoreBreakdown,
      Explanation: evaluation.explanation,
      Status: 'Active',
      AlgorithmVersion: this.algorithmVersion
    };

    if (existing) {
      return this.repository.updateMatch(existing.MatchID, payload);
    }

    return this.repository.createMatch(payload);
  }

  async runMatching(requirementId) {
    const requirement = this.repository.readRequirement(requirementId);
    if (!requirement) {
      return { ok: false, error: 'Requirement not found' };
    }

    const inventory = this.repository.list('Inventory').filter((property) => this.isActiveInventoryProperty(property));
    if (inventory.length === 0) {
      return {
        ok: true,
        data: { requirementId, leadId: requirement.LeadID, total: 0, matches: [], reason: 'No inventory available' }
      };
    }

    const matches = [];
    for (const property of inventory) {
      const evaluation = this.calculateMatch(requirement, property);
      if (evaluation.score >= this.minMatchScore) {
        matches.push(this.persistMatch(requirement, property, evaluation));
      }
    }

    matches.sort((a, b) => b.Score - a.Score);

    return {
      ok: true,
      data: {
        requirementId,
        leadId: requirement.LeadID,
        total: matches.length,
        reason: matches.length === 0 ? 'No compatible properties' : 'Matches found',
        matches
      }
    };
  }

  async getMatchesForRequirement(requirementId) {
    const requirement = this.repository.readRequirement(requirementId);
    if (!requirement) {
      return { ok: false, error: 'Requirement not found' };
    }

    const matches = this.repository.listMatches(requirementId);
    return {
      ok: true,
      data: {
        requirementId,
        leadId: requirement.LeadID,
        total: matches.length,
        matches
      }
    };
  }

  async getMatch(matchId) {
    const match = this.repository.getMatch(matchId);
    if (!match) {
      return { ok: false, error: 'Match not found' };
    }

    return { ok: true, data: match };
  }

  async listAllMatches() {
    return { ok: true, data: this.repository.listMatches() };
  }
}

module.exports = { MatchingEngine };
