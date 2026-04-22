const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));

// Initialize Firebase Admin SDK with placeholder config
// In production, load from environment variable or service account file
const firebaseConfig = {
  // Placeholder — load from process.env.FIREBASE_CONFIG or firestore credentials
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID || 'trashapp-dev',
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || 'key123',
  private_key: (process.env.FIREBASE_PRIVATE_KEY || 'placeholder').replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL || 'firebase-adminsdk@trashapp-dev.iam.gserviceaccount.com',
  client_id: process.env.FIREBASE_CLIENT_ID || '123456789',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
};

// Only initialize Firebase if valid credentials are provided
if (process.env.FIREBASE_PROJECT_ID) {
  admin.initializeApp({
    credential: admin.credential.cert(firebaseConfig),
  });
}

// ===========================
// PRICING CONFIGURATION
// ===========================
const PRICING = {
  minimumJob: 175,
  basePricePerYard: 85,
  loadSizes: [
    { yards: 1,  price: 175 },
    { yards: 2,  price: 275 },
    { yards: 3,  price: 375 },
    { yards: 6,  price: 575 },
    { yards: 9,  price: 775 },
    { yards: 12, price: 950 },
  ],
  materialMultipliers: {
    general_household:   1.00,
    furniture:           1.15,
    appliances:          1.35,
    yard_waste:          0.95,
    construction_debris: 1.55,
    heavy_materials:     1.75,
    concrete:            1.75,
    mattresses:          1.30,
    ewaste:              1.20,
    recyclable_metal:    0.85,
    mixed:               1.10,
  },
  laborSurcharges: {
    stairs_per_flight:   45,
    long_carry:          35,
    disassembly:         55,
    hoarding:            150,
    elevator:            25,
  },
  dumpSurcharges: {
    tires:               15,
    appliances:          25,
    mattresses:          30,
    hazmat:              75,
    environmental_fee:   16,
    fuel_surcharge:      10,
  },
  urgencyFees: {
    standard:            0,
    same_day:            75,
    after_hours:         100,
    emergency:           150,
  },
  travel: {
    includedMiles:       10,
    feePerMile:          3.50,
  },
  confidence: {
    highThreshold:         0.80,
    mediumThreshold:       0.60,
    manualReviewThreshold: 0.45,
    highExpansion:         0.08,
    mediumExpansion:       0.18,
    lowExpansion:          0.30,
  },
  multiLocation: {
    efficiencyDiscount:  0.10,
  },
  floorMargin:           0.40,
  targetMargin:          0.65,
};

// ===========================
// AI CLASSIFICATION (MOCK/PLACEHOLDER)
// ===========================
/**
 * Mock AI classification function.
 * In production, replace the body with actual OpenAI GPT-4V API call.
 *
 * @param {Array<string>} base64Images - Array of base64-encoded images
 * @param {string} imageMime - MIME type (e.g., 'image/jpeg')
 * @param {string} address - Optional address for context
 * @returns {Object} Classification with estimated_cubic_yards, materials, confidence, item_flags, dump_items, items_spotted, notes
 */
async function classifyImagesAI(base64Images, imageMime = 'image/jpeg', address = '') {
  // PLACEHOLDER: This should be replaced with actual OpenAI GPT-4V API call
  // Real implementation would look like:
  // const response = await openai.vision.create({
  //   model: 'gpt-4-vision-preview',
  //   messages: [{
  //     role: 'user',
  //     content: [
  //       { type: 'text', text: 'Classify the junk in these images...' },
  //       ...base64Images.map(img => ({
  //         type: 'image_url',
  //         image_url: { url: `data:${imageMime};base64,${img}` }
  //       }))
  //     ]
  //   }]
  // });

  // For now, return realistic mock classification data
  // The structure matches what GPT-4V would return
  const mockResponse = {
    estimated_cubic_yards: 2.5,
    materials: ['furniture', 'general_household'],
    confidence: 0.85,
    item_flags: {
      longCarry: false,
      disassembly: true,
      hoarding: false,
      elevator: false,
    },
    dump_items: {
      mattresses: 1,
      appliances: 0,
      tires: 0,
      hazmat: 0,
    },
    items_spotted: [
      'couch',
      'bed frame',
      'nightstand',
      'boxes of household items',
    ],
    notes: 'Second-floor bedroom clearance. Some disassembly required for bed frame.',
  };

  return mockResponse;
}

// ===========================
// PRICING CALCULATION FUNCTIONS
// ===========================

/**
 * Calculate a single-location quote based on classified items
 * @param {Object} input - Classification output + optional overrides
 * @returns {Object} Quote result
 */
function calculateQuote(input) {
  const {
    cubicYards,
    materials = ['general_household'],
    laborFlags = {},
    dumpItems = {},
    urgency = 'standard',
    distanceMiles = 0,
    confidence = 1.0,
    stairFlights = 0,
  } = input;

  if (confidence < PRICING.confidence.manualReviewThreshold) {
    return {
      status: 'manual_review',
      message: 'Photos unclear — manual review recommended before quoting.',
      priceRange: null,
    };
  }

  const sorted = [...PRICING.loadSizes].sort((a,b) => a.yards - b.yards);
  let basePrice = sorted[sorted.length - 1].price;
  for (const tier of sorted) {
    if (cubicYards <= tier.yards) { basePrice = tier.price; break; }
  }

  const multiplier = Math.max(
    ...materials.map(m => PRICING.materialMultipliers[m] || 1.00)
  );
  let total = basePrice * multiplier;

  if (stairFlights > 0) total += stairFlights * PRICING.laborSurcharges.stairs_per_flight;
  if (laborFlags.longCarry)   total += PRICING.laborSurcharges.long_carry;
  if (laborFlags.disassembly) total += PRICING.laborSurcharges.disassembly;
  if (laborFlags.hoarding)    total += PRICING.laborSurcharges.hoarding;
  if (laborFlags.elevator)    total += PRICING.laborSurcharges.elevator;

  total += (dumpItems.tires      || 0) * PRICING.dumpSurcharges.tires;
  total += (dumpItems.appliances || 0) * PRICING.dumpSurcharges.appliances;
  total += (dumpItems.mattresses || 0) * PRICING.dumpSurcharges.mattresses;
  total += (dumpItems.hazmat     || 0) * PRICING.dumpSurcharges.hazmat;
  if (Object.keys(dumpItems).length > 0) {
    total += PRICING.dumpSurcharges.environmental_fee;
    total += PRICING.dumpSurcharges.fuel_surcharge;
  }

  const extraMiles = Math.max(0, distanceMiles - PRICING.travel.includedMiles);
  total += extraMiles * PRICING.travel.feePerMile;
  total += PRICING.urgencyFees[urgency] || 0;
  total = Math.max(total, PRICING.minimumJob);

  const negotiationFloor = Math.ceil(total / (1 - PRICING.floorMargin));

  let expansion = PRICING.confidence.highExpansion;
  if (confidence < PRICING.confidence.mediumThreshold) {
    expansion = PRICING.confidence.lowExpansion;
  } else if (confidence < PRICING.confidence.highThreshold) {
    expansion = PRICING.confidence.mediumExpansion;
  }

  const rawLow  = Math.ceil(total * (1 - expansion / 2) / 5) * 5;
  const high = Math.ceil(total * (1 + expansion / 2) / 5) * 5;
  // Enforce minimum floor on range low-end so it never dips below minimumJob
  const low = Math.max(rawLow, PRICING.minimumJob);

  const crewCost  = (2.0 + 0.75) * 60;
  const dumpCost  = 35;
  const truckCost = 22;
  const totalCost = crewCost + dumpCost + truckCost;
  const margin    = (total - totalCost) / total;

  return {
    status: 'quoted',
    priceRange: `$${low}–$${high}`,
    midpoint: total,
    negotiationFloor,
    confidenceLevel: confidence >= PRICING.confidence.highThreshold ? 'high' :
                     confidence >= PRICING.confidence.mediumThreshold ? 'medium' : 'low',
    estimatedMargin: `${Math.round(margin * 100)}%`,
    breakdown: {
      basePrice:            Math.round(basePrice),
      materialAdjustment:   Math.round(basePrice * multiplier - basePrice),
      laborSurcharges:      Math.round(stairFlights * PRICING.laborSurcharges.stairs_per_flight),
      travelFee:            Math.round(extraMiles * PRICING.travel.feePerMile),
      urgencyFee:           PRICING.urgencyFees[urgency] || 0,
    },
  };
}

/**
 * Calculate a multi-location quote with efficiency discounts
 * @param {Array} locations - Array of { label, photos, input }
 * @param {string} urgency - Urgency level
 * @param {number} distanceMiles - Total distance
 * @returns {Object} Combined quote result
 */
function calculateMultiLocationQuote(locations, urgency = 'standard', distanceMiles = 0) {
  const locationQuotes = locations.map((loc, index) => ({
    label:  loc.label || `Area ${index + 1}`,
    quote:  calculateQuote({ ...loc.input, urgency: 'standard', distanceMiles: 0 }),
    photos: loc.photos.length,
  }));

  const extraMiles = Math.max(0, distanceMiles - PRICING.travel.includedMiles);
  const travelFee  = extraMiles * PRICING.travel.feePerMile;
  const urgencyFee = PRICING.urgencyFees[urgency] || 0;

  let combinedTotal = 0;
  locationQuotes.forEach((lq, index) => {
    if (lq.quote.status === 'manual_review') return;
    const subtotal = lq.quote.midpoint;
    combinedTotal += index === 0
      ? subtotal
      : subtotal * (1 - PRICING.multiLocation.efficiencyDiscount);
  });

  combinedTotal += travelFee + urgencyFee;
  combinedTotal  = Math.max(combinedTotal, PRICING.minimumJob);

  const negotiationFloor = Math.ceil(combinedTotal / (1 - PRICING.floorMargin));

  const confidenceScores = locationQuotes
    .filter(lq => lq.quote.status !== 'manual_review')
    .map(lq =>
      lq.quote.confidenceLevel === 'high'   ? 0.90 :
      lq.quote.confidenceLevel === 'medium' ? 0.70 : 0.50
    );
  const lowestConfidence = confidenceScores.length
    ? Math.min(...confidenceScores)
    : 0.50;

  const expansion =
    lowestConfidence >= 0.80 ? PRICING.confidence.highExpansion :
    lowestConfidence >= 0.60 ? PRICING.confidence.mediumExpansion :
                               PRICING.confidence.lowExpansion;

  const rawLow  = Math.ceil(combinedTotal * (1 - expansion / 2) / 5) * 5;
  const high = Math.ceil(combinedTotal * (1 + expansion / 2) / 5) * 5;
  // Enforce minimum floor on range low-end so it never dips below minimumJob
  const low = Math.max(rawLow, PRICING.minimumJob);

  const hasManualReview = locationQuotes.some(lq => lq.quote.status === 'manual_review');

  return {
    status:              hasManualReview ? 'partial_manual_review' : 'quoted',
    locationCount:       locations.length,
    locationBreakdown:   locationQuotes,
    combinedRange:       `$${low}–$${high}`,
    combinedMidpoint:    combinedTotal,
    negotiationFloor,
    travelFee:           Math.round(travelFee),
    urgencyFee,
    multiLocationDiscount: `10% applied to ${locations.length - 1} additional area(s)`,
    overallConfidence:   lowestConfidence >= 0.80 ? 'high' :
                         lowestConfidence >= 0.60 ? 'medium' : 'low',
    note: 'Travel fee charged once. Crew efficiency discount applied to additional areas.',
    manualReviewAreas:   locationQuotes
      .filter(lq => lq.quote.status === 'manual_review')
      .map(lq => lq.label),
  };
}

// ===========================
// HELPER: Convert cubic yards to truck load description
// ===========================
function yardsTruckLoad(cubicYards) {
  if (cubicYards <= 1) return 'Minimum load';
  if (cubicYards <= 2) return 'Quarter truck';
  if (cubicYards <= 3) return 'Quarter truck';
  if (cubicYards <= 6) return 'Half truck';
  if (cubicYards <= 9) return 'Three-quarter truck';
  if (cubicYards <= 12) return 'Full truck';
  return 'Full truck+';
}

// ===========================
// HELPER: Build surcharges array from quote data
// ===========================
function buildSurchargesArray(quoteInput, pricing) {
  const surcharges = [];

  if (quoteInput.stairFlights && quoteInput.stairFlights > 0) {
    surcharges.push(`Stairs (${quoteInput.stairFlights} flights): $${quoteInput.stairFlights * pricing.laborSurcharges.stairs_per_flight}`);
  }
  if (quoteInput.laborFlags?.longCarry) {
    surcharges.push(`Long carry: $${pricing.laborSurcharges.long_carry}`);
  }
  if (quoteInput.laborFlags?.disassembly) {
    surcharges.push(`Disassembly: $${pricing.laborSurcharges.disassembly}`);
  }
  if (quoteInput.laborFlags?.hoarding) {
    surcharges.push(`Hoarding cleanup: $${pricing.laborSurcharges.hoarding}`);
  }
  if (quoteInput.laborFlags?.elevator) {
    surcharges.push(`Elevator: $${pricing.laborSurcharges.elevator}`);
  }

  if (quoteInput.dumpItems?.tires > 0) {
    surcharges.push(`Tires (${quoteInput.dumpItems.tires}): $${quoteInput.dumpItems.tires * pricing.dumpSurcharges.tires}`);
  }
  if (quoteInput.dumpItems?.appliances > 0) {
    surcharges.push(`Appliances (${quoteInput.dumpItems.appliances}): $${quoteInput.dumpItems.appliances * pricing.dumpSurcharges.appliances}`);
  }
  if (quoteInput.dumpItems?.mattresses > 0) {
    surcharges.push(`Mattresses (${quoteInput.dumpItems.mattresses}): $${quoteInput.dumpItems.mattresses * pricing.dumpSurcharges.mattresses}`);
  }
  if (quoteInput.dumpItems?.hazmat > 0) {
    surcharges.push(`Hazmat items (${quoteInput.dumpItems.hazmat}): $${quoteInput.dumpItems.hazmat * pricing.dumpSurcharges.hazmat}`);
  }

  return surcharges;
}

// ===========================
// HELPER: Format quote for frontend compatibility
// ===========================
function formatQuoteForFrontend(quoteEngine, classification, input) {
  if (quoteEngine.status === 'manual_review') {
    return {
      status: 'manual_review',
      message: quoteEngine.message,
      priceRange: null,
      confidence: 'low',
      itemsSeen: classification.items_spotted || [],
      truckLoad: null,
      notes: classification.notes || 'Awaiting manual review',
      surcharges: [],
      laborCost: 0,
      dumpFee: 0,
      surchargeTotal: 0,
      crewSize: 0,
      estimatedHours: 0,
      negotiationFloor: null,
    };
  }

  const basePrice = quoteEngine.breakdown?.basePrice || 0;
  const laborSurcharges = quoteEngine.breakdown?.laborSurcharges || 0;
  const dumpFee = quoteEngine.breakdown?.dumpSurcharges || 0;
  const travelFee = quoteEngine.breakdown?.travelFee || 0;

  const surchargesArray = buildSurchargesArray(input, PRICING);
  const surchargeTotal = laborSurcharges + dumpFee + travelFee;

  // Extract price range as low and high
  const priceRangeMatch = quoteEngine.priceRange?.match(/\$(\d+)–\$(\d+)/);
  const lowPrice = priceRangeMatch ? parseInt(priceRangeMatch[1]) : 0;
  const highPrice = priceRangeMatch ? parseInt(priceRangeMatch[2]) : 0;

  // Estimate crew size (typically 2-3 people for junk removal)
  const crewSize = input.cubicYards <= 3 ? 2 : 3;

  // Estimate hours (typically 2-4 hours depending on size and complexity)
  const estimatedHours = input.cubicYards <= 2 ? 2 : input.cubicYards <= 6 ? 3 : 4;

  return {
    status: 'quoted',
    priceRange: quoteEngine.priceRange,
    confidence: quoteEngine.confidenceLevel,
    itemsSeen: classification.items_spotted || [],
    truckLoad: yardsTruckLoad(input.cubicYards),
    notes: classification.notes || 'Ready for scheduling',
    surcharges: surchargesArray,
    laborCost: laborSurcharges,
    dumpFee: dumpFee,
    surchargeTotal: surchargeTotal,
    crewSize: crewSize,
    estimatedHours: estimatedHours,
    negotiationFloor: quoteEngine.negotiationFloor,
    midpoint: quoteEngine.midpoint,
    breakdown: quoteEngine.breakdown,
  };
}

// ===========================
// ROUTES
// ===========================

/**
 * POST /api/quote
 * Single-location junk removal quote
 */
app.post('/api/quote', async (req, res) => {
  try {
    const { images, imageMime = 'image/jpeg', address = '' } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({
        error: 'Missing or invalid images array',
      });
    }

    // Step 1: Classify images using AI
    const classification = await classifyImagesAI(images, imageMime, address);

    // Step 2: Prepare input for pricing engine
    const quoteInput = {
      cubicYards: classification.estimated_cubic_yards || 2.0,
      materials: classification.materials || ['general_household'],
      laborFlags: classification.item_flags || {},
      dumpItems: classification.dump_items || {},
      urgency: 'standard',
      distanceMiles: 0,
      confidence: classification.confidence || 0.85,
      stairFlights: 0,
    };

    // Step 3: Calculate quote
    const quoteEngine = calculateQuote(quoteInput);

    // Step 4: Check if manual review needed
    if (quoteEngine.status === 'manual_review') {
      // Write to Firestore if Firebase is initialized
      if (admin.apps.length > 0) {
        try {
          await admin.firestore().collection('manual_review').add({
            timestamp: new Date(),
            confidence: classification.confidence,
            classification: classification,
            images_count: images.length,
            address: address,
            status: 'pending_review',
          });
        } catch (firestoreError) {
          console.warn('Firestore write failed (check credentials):', firestoreError.message);
        }
      }
    }

    // Step 5: Format for frontend compatibility
    const formattedQuote = formatQuoteForFrontend(quoteEngine, classification, quoteInput);

    res.json(formattedQuote);
  } catch (error) {
    console.error('Quote error:', error);
    res.status(500).json({
      error: 'Failed to generate quote',
      details: error.message,
    });
  }
});

/**
 * POST /api/quote/multi
 * Multi-location junk removal quote with efficiency discounts
 */
app.post('/api/quote/multi', async (req, res) => {
  try {
    const { locations, urgency = 'standard', distanceMiles = 0 } = req.body;

    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      return res.status(400).json({
        error: 'Missing or invalid locations array',
      });
    }

    // Step 1: Classify images for each location
    const processedLocations = [];
    for (let i = 0; i < locations.length; i++) {
      const loc = locations[i];
      const classification = await classifyImagesAI(
        loc.photos || [],
        'image/jpeg',
        loc.address || ''
      );

      const quoteInput = {
        cubicYards: classification.estimated_cubic_yards || 2.0,
        materials: classification.materials || ['general_household'],
        laborFlags: classification.item_flags || {},
        dumpItems: classification.dump_items || {},
        urgency: 'standard',
        distanceMiles: 0,
        confidence: classification.confidence || 0.85,
        stairFlights: 0,
      };

      processedLocations.push({
        label: loc.label || `Area ${i + 1}`,
        photos: loc.photos || [],
        input: quoteInput,
        classification: classification,
      });

      // If confidence is low, write to Firestore
      if (classification.confidence < PRICING.confidence.manualReviewThreshold && admin.apps.length > 0) {
        try {
          await admin.firestore().collection('manual_review').add({
            timestamp: new Date(),
            location_label: loc.label || `Area ${i + 1}`,
            confidence: classification.confidence,
            classification: classification,
            images_count: (loc.photos || []).length,
            address: loc.address || '',
            status: 'pending_review',
          });
        } catch (firestoreError) {
          console.warn('Firestore write failed:', firestoreError.message);
        }
      }
    }

    // Step 2: Calculate multi-location quote
    const multiQuote = calculateMultiLocationQuote(processedLocations, urgency, distanceMiles);

    // Step 3: Format response for frontend
    const response = {
      status: multiQuote.status,
      locationCount: multiQuote.locationCount,
      combinedRange: multiQuote.combinedRange,
      combinedMidpoint: multiQuote.combinedMidpoint,
      overallConfidence: multiQuote.overallConfidence,
      travelFee: multiQuote.travelFee,
      urgencyFee: multiQuote.urgencyFee,
      negotiationFloor: multiQuote.negotiationFloor,
      multiLocationDiscount: multiQuote.multiLocationDiscount,
      note: multiQuote.note,
      locations: processedLocations.map((loc, idx) => {
        const locationQuote = multiQuote.locationBreakdown[idx];
        return {
          label: loc.label,
          quote: formatQuoteForFrontend(locationQuote.quote, loc.classification, loc.input),
          photos: loc.photos.length,
        };
      }),
      manualReviewAreas: multiQuote.manualReviewAreas,
    };

    res.json(response);
  } catch (error) {
    console.error('Multi-location quote error:', error);
    res.status(500).json({
      error: 'Failed to generate multi-location quote',
      details: error.message,
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'TrashApp Pricing API',
  });
});

/**
 * Format a duration in seconds as "Hh Mm Ss".
 */
function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

/**
 * GET /mastermind/health
 * Public HTTPS proxy health check for the Mastermind dashboard.
 * The admin console pings this instead of the owner PC at
 * http://localhost:3000/health to avoid HTTPS->HTTP mixed-content
 * blocking when admin.trashappjunkremoval.com runs the health check.
 */
app.get('/mastermind/health', (req, res) => {
  const uptime = process.uptime();
  res.json({
    status: 'ok',
    service: 'mastermind',
    uptime_seconds: Math.floor(uptime),
    uptime_human: formatUptime(uptime),
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.9.6',
  });
});

/**
 * GET /
 * Root endpoint with service info
 */
app.get('/', (req, res) => {
  res.json({
    service: 'TrashApp Junk Removal Pricing API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      mastermindHealth: 'GET /mastermind/health',
      quote: 'POST /api/quote',
      multiQuote: 'POST /api/quote/multi',
    },
  });
});

// ===========================
// SERVER INITIALIZATION
// ===========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`TrashApp Pricing API running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
