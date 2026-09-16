/**
 * Smart Match V2
 */

const TRANSACTION_ALIAS = {
  Buy: ['Sale', 'Purchase', 'Buy'],
  Purchase: ['Sale', 'Purchase', 'Buy'],
  Sale: ['Sale', 'Purchase', 'Buy'],
  Sell: ['Sale', 'Purchase', 'Buy'],
  Rent: ['Rent', 'Lease', 'Rent + Sale'],
  'Give on Rent': ['Rent', 'Lease', 'Rent + Sale'],
  'Rent Out': ['Rent', 'Lease', 'Rent + Sale'],
  Lease: ['Lease', 'Rent', 'Rent + Sale'],
  'Give on Lease': ['Lease', 'Rent', 'Rent + Sale'],
  'Lease Out': ['Lease', 'Rent', 'Rent + Sale']
};

const WEIGHTS = {
  transaction: 18,
  category: 15,
  propertyType: 12,
  location: 14,
  budget: 12,
  area: 10,
  must: 10,
  specific: 6,
  preferred: 2,
  flexible: 1
};

const PRIORITY_WEIGHT = { MUST_HAVE: WEIGHTS.must, PREFERRED: WEIGHTS.preferred, FLEXIBLE: WEIGHTS.flexible };
const CORE_PRIORITY_FIELDS = new Set(['TransactionType', 'Category', 'SubCategory', 'PropertyType', 'Location1', 'Location2', 'Location3', 'BudgetMin', 'BudgetMax', 'AreaMin', 'AreaMax']);

class SmartMatchService {
  constructor(repository) { this.repository = repository; }

  _fieldEntry(obj, key) {
    if (!obj?.Fields) return null;
    return obj.Fields[key] ?? obj.Fields[key?.charAt(0).toLowerCase() + key.slice(1)] ?? null;
  }

  _val(obj, key) {
    if (!obj) return null;
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
    const lower = key?.charAt(0).toLowerCase() + key.slice(1);
    if (obj[lower] !== undefined && obj[lower] !== null && obj[lower] !== '') return obj[lower];
    const entry = this._fieldEntry(obj, key);
    if (entry?.state === 'KNOWN') return entry.value ?? null;
    if (entry && Object.prototype.hasOwnProperty.call(entry, 'value')) return entry.value ?? null;
    return null;
  }

  _normText(value) {
    return String(value || '').trim().toLowerCase();
  }

  _truthy(value) {
    if (value === true) return true;
    if (value === false || value == null || value === '') return false;
    return ['yes', 'true', '1', 'required', 'available', 'included'].includes(this._normText(value));
  }

  _number(...values) {
    for (const value of values) {
      if (value === undefined || value === null || value === '') continue;
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  _array(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'string') return value.split(',').map((part) => part.trim()).filter(Boolean);
    return value == null ? [] : [value];
  }

  _propertyLocations(prop) {
    return [
      this._val(prop, 'Location1'),
      this._val(prop, 'Location2'),
      this._val(prop, 'Location3'),
      this._val(prop, 'Location'),
      this._val(prop, 'Area'),
      this._val(prop, 'Locality'),
      this._val(prop, 'City')
    ].filter(Boolean).map((value) => this._normText(value));
  }

  _normalizeSubCategory(value) {
    const norm = this._normText(value);
    if (['apartment', 'flat'].includes(norm)) return 'flat';
    if (['warehouse', 'godown'].includes(norm)) return 'warehouse';
    if (['villa', 'bungalow'].includes(norm)) return 'villa';
    return norm;
  }

  _areaRequirement(requirement) {
    const pairs = [
      { key: 'required', min: this._number(this._val(requirement, 'RequiredAreaMin')), max: this._number(this._val(requirement, 'RequiredAreaMax')), label: 'Required area' },
      { key: 'carpet', min: this._number(this._val(requirement, 'CarpetAreaMin'), this._val(requirement, 'AreaMin')), max: this._number(this._val(requirement, 'CarpetAreaMax'), this._val(requirement, 'AreaMax')), label: 'Carpet area' },
      { key: 'builtUp', min: this._number(this._val(requirement, 'BuiltUpAreaMin')), max: this._number(this._val(requirement, 'BuiltUpAreaMax')), label: 'Built-up area' },
      { key: 'plot', min: this._number(this._val(requirement, 'PlotAreaMin')), max: this._number(this._val(requirement, 'PlotAreaMax')), label: 'Plot area' },
      { key: 'open', min: this._number(this._val(requirement, 'OpenAreaMin')), max: this._number(this._val(requirement, 'OpenAreaMax')), label: 'Open area' }
    ];
    return pairs.filter((pair) => pair.min != null || pair.max != null);
  }

  _areaProperty(prop, key) {
    const map = {
      required: this._number(this._val(prop, 'RequiredArea'), this._val(prop, 'Area'), this._val(prop, 'CarpetArea'), this._val(prop, 'BuiltUpArea')),
      carpet: this._number(this._val(prop, 'CarpetArea'), this._val(prop, 'CarpetAreaComm'), this._val(prop, 'Area')),
      builtUp: this._number(this._val(prop, 'BuiltUpArea'), this._val(prop, 'BuiltupArea'), this._val(prop, 'SuperBuiltupArea'), this._val(prop, 'Area')),
      plot: this._number(this._val(prop, 'PlotArea'), this._val(prop, 'LandArea'), this._val(prop, 'Area')),
      open: this._number(this._val(prop, 'OpenArea'), this._val(prop, 'YardArea'))
    };
    return map[key] ?? null;
  }

  _scoreRange(min, max, actual) {
    if (actual == null || (min == null && max == null)) return { ratio: null, note: 'Missing comparable value' };
    if (min != null && max != null && actual >= min && actual <= max) return { ratio: 1, note: `${actual} within range` };
    if (min != null && actual < min) {
      const gap = (min - actual) / Math.max(min, 1);
      if (gap <= 0.15) return { ratio: 0.6, note: `${actual} slightly below range` };
      return { ratio: 0, note: `${actual} below range` };
    }
    if (max != null && actual > max) {
      const gap = (actual - max) / Math.max(max, 1);
      if (gap <= 0.15) return { ratio: 0.6, note: `${actual} slightly above range` };
      return { ratio: 0, note: `${actual} above range` };
    }
    return { ratio: 1, note: `${actual} acceptable` };
  }

  _compareField(requirement, prop, key) {
    const reqValue = this._val(requirement, key);
    if (reqValue == null || reqValue === '') return null;
    const propValue = this._val(prop, key);
    if (propValue == null || propValue === '') return { matched: false, ratio: 0, note: `${key} missing in inventory` };

    if (typeof reqValue === 'boolean' || typeof propValue === 'boolean') {
      const matched = this._truthy(reqValue) ? this._truthy(propValue) : true;
      return { matched, ratio: matched ? 1 : 0, note: matched ? `${key} supported` : `${key} not supported` };
    }

    const reqNum = this._number(reqValue);
    const propNum = this._number(propValue);
    if (reqNum != null && propNum != null) {
      if (propNum >= reqNum) return { matched: true, ratio: 1, note: `${key} ${propNum} meets ${reqNum}` };
      if (propNum >= reqNum * 0.85) return { matched: false, ratio: 0.5, note: `${key} ${propNum} is close to ${reqNum}` };
      return { matched: false, ratio: 0, note: `${key} ${propNum} below ${reqNum}` };
    }

    const reqSet = new Set(this._array(reqValue).map((value) => this._normText(value)));
    const propSet = new Set(this._array(propValue).map((value) => this._normText(value)));
    const matched = [...reqSet].some((value) => propSet.has(value));
    return { matched, ratio: matched ? 1 : 0, note: matched ? `${key} matches` : `${key} mismatch` };
  }

  _scorePriorityFields(requirement, prop) {
    const breakdown = [];
    let weighted = 0;
    let totalWeight = 0;
    let mustMismatch = false;

    Object.entries(requirement.Fields || {}).forEach(([key, entry]) => {
      if (!entry || entry.state !== 'KNOWN' || !entry.priority || CORE_PRIORITY_FIELDS.has(key)) return;
      const compare = this._compareField(requirement, prop, key);
      if (!compare) return;
      const weight = PRIORITY_WEIGHT[entry.priority] || 0;
      totalWeight += weight;
      weighted += weight * compare.ratio;
      if (entry.priority === 'MUST_HAVE' && compare.ratio < 1) mustMismatch = true;
      breakdown.push({
        k: `priority:${key}`,
        v: Math.round(weight * compare.ratio * 100) / 100,
        note: `${entry.priority.replace('_', ' ')} — ${compare.note}`,
        priority: entry.priority,
        matched: compare.ratio >= 1
      });
    });

    return { score: totalWeight ? (weighted / totalWeight) * (WEIGHTS.must + WEIGHTS.preferred + WEIGHTS.flexible) : 0, breakdown, mustMismatch };
  }

  _scoreSpecific(requirement, prop) {
    const sub = this._normalizeSubCategory(this._val(requirement, 'SubCategory') || this._val(requirement, 'PropertyType'));
    const keysByType = {
      office: ['SeatingCapacity', 'CabinCount', 'ConferenceRoomCount', 'MeetingRoomCount', 'ParkingCarCount', 'ParkingBikeCount', 'Furnishing', 'PowerBackupRequired', 'InternetFiberRequired', 'Lift', 'WashroomCount'],
      shop: ['FrontageFeet', 'DepthFeet', 'GroundFloorRequired', 'MainRoadRequired', 'CornerUnitRequired', 'DisplayWindowRequired', 'FootfallPreference', 'LoadingUnloadingRequired', 'CeilingHeightFeet', 'WashroomCount'],
      warehouse: ['BuiltUpAreaMin', 'OpenAreaMin', 'ClearHeightFeet', 'LoadingDockRequired', 'ContainerMovementRequired', 'TruckAccessRequired', 'RoadWidthFeet', 'CraneRequired', 'PowerLoadKVA', 'ParkingYardRequired'],
      flat: ['BHKMin', 'Bathrooms', 'Balcony', 'Furnishing', 'ParkingCount', 'Facing', 'TotalFloors'],
      villa: ['BHKMin', 'BuiltUpAreaMin', 'PlotAreaMin', 'GardenRequired', 'ParkingCount', 'ServantRoomRequired', 'TerraceRequired', 'PoolRequired'],
      'residential plot': ['PlotAreaMin', 'FrontageFeet', 'DepthFeet', 'RoadWidthFeet', 'CornerPlot', 'TPScheme', 'Zone', 'FSI'],
      'commercial plot': ['PlotAreaMin', 'FrontageFeet', 'DepthFeet', 'RoadWidthFeet', 'CornerPlot', 'TPScheme', 'Zone', 'FSI'],
      'agricultural land': ['PlotAreaMin', 'FrontageFeet', 'DepthFeet', 'RoadWidthFeet', 'HighwayTouch', 'TitleClear'],
      factory: ['BuiltUpAreaMin', 'OpenAreaMin', 'PlotAreaMin', 'PowerLoadKVA', 'TransformerRequired', 'CraneRequired', 'LoadingDockRequired', 'ContainerMovementRequired', 'RoadWidthFeet', 'FireNOC', 'OfficeRequired', 'LabourAccommodationRequired'],
      'industrial plot': ['PlotAreaMin', 'RoadWidthFeet', 'PowerLoadKVA', 'TransformerRequired', 'ContainerMovementRequired']
    };

    const keys = keysByType[sub] || [];
    const checks = keys.map((key) => this._compareField(requirement, prop, key)).filter(Boolean);
    if (!checks.length) return { score: 0, breakdown: [] };

    const ratio = checks.reduce((sum, check) => sum + check.ratio, 0) / checks.length;
    return {
      score: ratio * WEIGHTS.specific,
      breakdown: checks.map((check, index) => ({ k: `specific:${keys[index]}`, v: Math.round((check.ratio * WEIGHTS.specific / checks.length) * 100) / 100, note: check.note }))
    };
  }

  match(requirement, options = {}) {
    if (!requirement) return { ok: false, error: 'Requirement not found' };
    const db = this.repository.read();
    const inventory = (db.Inventory || []).filter((row) => !row._deleted && !['Sold', 'Rented'].includes(row.ListingStatus));

    const reqTxn = this._val(requirement, 'TransactionType');
    const reqCat = this._val(requirement, 'Category');
    const reqSub = this._normalizeSubCategory(this._val(requirement, 'SubCategory') || this._val(requirement, 'PropertyType'));
    const allowedListings = new Set(TRANSACTION_ALIAS[reqTxn] || [reqTxn]);
    const reqBudgetMin = this._number(this._val(requirement, 'BudgetMin'));
    const reqBudgetMax = this._number(this._val(requirement, 'BudgetMax'));
    const reqLocs = [this._val(requirement, 'Location1'), this._val(requirement, 'Location2'), this._val(requirement, 'Location3')].filter(Boolean).map((value) => this._normText(value));
    const reqAreas = this._areaRequirement(requirement);

    const results = [];
    for (const prop of inventory) {
      if (reqCat && this._normText(this._val(prop, 'Category')) !== this._normText(reqCat)) continue;
      const propSub = this._normalizeSubCategory(this._val(prop, 'SubCategory') || this._val(prop, 'PropertyType'));
      if (reqSub && propSub && propSub !== reqSub) continue;
      if (reqTxn && this._val(prop, 'ListingFor') && !allowedListings.has(this._val(prop, 'ListingFor'))) continue;

      const breakdown = [];
      let score = 0;

      score += WEIGHTS.transaction;
      breakdown.push({ k: 'transaction', v: WEIGHTS.transaction, note: `${reqTxn || 'Any'} transaction compatible ✓` });

      if (reqCat) {
        score += WEIGHTS.category;
        breakdown.push({ k: 'category', v: WEIGHTS.category, note: `${reqCat} ✓` });
      }
      if (reqSub && propSub === reqSub) {
        score += WEIGHTS.propertyType;
        breakdown.push({ k: 'propertyType', v: WEIGHTS.propertyType, note: `${this._val(requirement, 'SubCategory') || this._val(requirement, 'PropertyType')} ✓` });
      }

      const propLocs = this._propertyLocations(prop);
      if (reqLocs.length) {
        const overlap = propLocs.filter((value) => reqLocs.includes(value));
        if (overlap.length) {
          score += WEIGHTS.location;
          breakdown.push({ k: 'location', v: WEIGHTS.location, note: `Location ${overlap[0]} ✓` });
        } else if (propLocs.some((value) => reqLocs.some((req) => value.includes(req) || req.includes(value)))) {
          score += WEIGHTS.location * 0.5;
          breakdown.push({ k: 'location', v: WEIGHTS.location * 0.5, note: 'Nearby location match' });
        } else {
          breakdown.push({ k: 'location', v: 0, note: 'Location mismatch' });
        }
      }

      const propPrice = this._number(this._val(prop, 'AskingPrice'), this._val(prop, 'Price'), this._val(prop, 'ExpectedRent'), this._val(prop, 'Rent'), this._val(prop, 'MonthlyRent'));
      if (propPrice != null && (reqBudgetMin != null || reqBudgetMax != null)) {
        const budget = this._scoreRange(reqBudgetMin, reqBudgetMax, propPrice);
        score += (budget.ratio || 0) * WEIGHTS.budget;
        breakdown.push({ k: 'budget', v: (budget.ratio || 0) * WEIGHTS.budget, note: `${budget.note} (${_fmtInr(propPrice)})` });
      }

      if (reqAreas.length) {
        let bestArea = 0;
        let bestNote = 'No comparable area';
        reqAreas.forEach((areaReq) => {
          const propArea = this._areaProperty(prop, areaReq.key);
          const areaScore = this._scoreRange(areaReq.min, areaReq.max, propArea);
          if ((areaScore.ratio || 0) > bestArea) {
            bestArea = areaScore.ratio || 0;
            bestNote = `${areaReq.label}: ${areaScore.note}`;
          }
        });
        score += bestArea * WEIGHTS.area;
        breakdown.push({ k: 'area', v: bestArea * WEIGHTS.area, note: bestNote });
      }

      const priority = this._scorePriorityFields(requirement, prop);
      score += priority.score;
      breakdown.push(...priority.breakdown);
      if (priority.mustMismatch) score *= 0.7;

      const specifics = this._scoreSpecific(requirement, prop);
      score += specifics.score;
      breakdown.push(...specifics.breakdown);

      const rounded = Math.max(0, Math.min(100, Math.round(score)));
      const level = rounded >= 85 ? 'Strong' : rounded >= 65 ? 'Possible' : rounded >= 45 ? 'Weak' : 'No Match';
      results.push({
        PropertyID: this._val(prop, 'PropertyID'),
        Title: this._val(prop, 'Title') || this._val(prop, 'Project') || this._val(prop, 'PropertyType'),
        Category: this._val(prop, 'Category'),
        SubCategory: this._val(prop, 'SubCategory') || this._val(prop, 'PropertyType'),
        ListingFor: this._val(prop, 'ListingFor'),
        InventorySource: this._val(prop, 'InventorySource'),
        Location1: this._val(prop, 'Location1') || this._val(prop, 'Location'),
        SocietyName: this._val(prop, 'SocietyName') || this._val(prop, 'Project'),
        AskingPrice: propPrice,
        BHK: this._val(prop, 'BHK'),
        CarpetArea: this._number(this._val(prop, 'CarpetArea'), this._val(prop, 'Area')),
        Photos: this._val(prop, 'Photos') || [],
        OwnerName: this._val(prop, 'OwnerName'),
        BrokerName: this._val(prop, 'BrokerName'),
        BuilderName: this._val(prop, 'BuilderName'),
        ExclusiveWithMe: !!this._val(prop, 'ExclusiveWithMe'),
        Score: rounded,
        MatchLevel: level,
        Breakdown: breakdown
      });
    }

    results.sort((a, b) => b.Score - a.Score);
    const minScore = options.minScore == null ? 40 : options.minScore;
    const filtered = results.filter((item) => item.Score >= minScore);
    return {
      ok: true,
      data: {
        requirementId: requirement.RequirementID,
        leadId: requirement.LeadID,
        criteria: { reqTxn, reqCat, reqSub, reqLocs, reqBudgetMin, reqBudgetMax, reqAreas },
        total: filtered.length,
        scanned: inventory.length,
        matches: filtered.slice(0, options.limit || 20)
      }
    };
  }

  matchByRequirementId(requirementId, options = {}) {
    const db = this.repository.read();
    const requirement = (db.Requirements || []).find((row) => row.RequirementID === requirementId);
    if (!requirement) return { ok: false, error: 'Requirement not found' };
    return this.match(requirement, options);
  }
}

function _fmtInr(n) {
  if (!n) return '—';
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(1) + ' L';
  return '₹' + n.toLocaleString('en-IN');
}

module.exports = { SmartMatchService };
