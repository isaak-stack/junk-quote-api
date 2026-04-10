import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Force JSON Content-Type on ALL responses
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are a junk removal pricing expert for a company serving Fresno and the Central Valley, CA.

You will receive one or more photos of a junk pile. Analyze ALL photos together to estimate total volume.

LOCAL MARKET RATES (Fresno/Central Valley, 2025-2026):
- Competitors: Junk King Fresno, 1-800-GOT-JUNK, LoadUp — avg $150-$600 depending on load
- Our pricing is competitive but slightly below franchise rates to win local market share

PRICING TIERS (based on truck volume):
- Single item / minimum: $175
- Quarter truck (1-3 items, small pile): $175-$249
- Half truck (medium load, partial room): $299-$399
- Three-quarter truck (large load, most of a room): $399-$499
- Full truck (entire room+, maximum load): $499-$650

SURCHARGES (add to base price):
- Mattress: +$30 each (disposal fee)
- Tire: +$20 each (disposal fee)
- TV/monitor: +$25 each (e-waste fee)
- Piano or safe: flag as call_for_quote
- Hazmat (paint, chemicals, asbestos): flag as hazmat, no quote

LABOR ESTIMATE:
- Base crew: 2 people
- Rate: $17.50/hr per person
- Quarter truck: ~1 hr labor = $35
- Half truck: ~1.5 hrs = $52.50
- Three-quarter truck: ~2 hrs = $70
- Full truck: ~2.5 hrs = $87.50

DUMP FEES (Fresno Sanitary Landfill / Recology estimates):
- Quarter truck: ~$30
- Half truck: ~$50
- Three-quarter truck: ~$65
- Full truck: ~$80

Return ONLY this raw JSON object, no markdown, no backticks:
{
  "priceRange": "$299-$399",
  "truckLoad": "Half truck",
  "truckPercent": 50,
  "confidence": "high",
  "flag": null,
  "itemsSeen": ["couch", "dresser", "bags"],
  "surcharges": [],
  "surchargeTotal": 0,
  "laborCost": 52.50,
  "dumpFee": 50,
  "estimatedHours": 1.5,
  "crewSize": 2,
  "notes": "One sentence assessment of the pile and any caveats."
}

confidence: high, medium, or low
flag: null, needs_more_photos, hazmat, or call_for_quote
truckPercent: integer 0-100 representing how full the truck will be`;

// Auto-detect MIME type from base64 header signatures
function detectMime(b64) {
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('R0lGO')) return 'image/gif';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

app.get('/', (req, res) => res.json({ status: 'ok' }));
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.post('/api/quote', async (req, res) => {
  const { images, imageMime } = req.body;

  if (!images || !images.length) {
    return res.status(400).json({ error: 'No images provided' });
  }

  try {
    const imageContent = images.map(b64 => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: detectMime(b64),
        data: b64
      }
    }));

    imageContent.push({
      type: 'text',
      text: images.length > 1
        ? `Analyze all ${images.length} photos together as one junk pile and return the pricing JSON.`
        : 'Analyze this junk pile and return the pricing JSON.'
    });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: SYSTEM,
      messages: [{ role: 'user', content: imageContent }]
    });

    const raw = response.content[0].text;
    const clean = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      console.error('JSON parse failed. Raw AI response:', raw);
      return res.status(502).json({
        error: 'AI returned invalid JSON',
        raw: raw.substring(0, 500)
      });
    }

    // Enforce $175 minimum floor on priceRange
    const MINIMUM_JOB = 175;
    if (parsed.priceRange) {
      const rangeMatch = parsed.priceRange.match(/\$(\d+)/g);
      if (rangeMatch && rangeMatch.length >= 2) {
        const lo = Math.max(parseInt(rangeMatch[0].slice(1)), MINIMUM_JOB);
        const hi = Math.max(parseInt(rangeMatch[1].slice(1)), MINIMUM_JOB);
        parsed.priceRange = '$' + lo + '-$' + hi;
      }
    }
    // Add negotiationFloor (40% below midpoint)
    if (parsed.priceRange) {
      const nums = parsed.priceRange.match(/\$(\d+)/g);
      if (nums && nums.length >= 2) {
        const mid = Math.round((parseInt(nums[0].slice(1)) + parseInt(nums[1].slice(1))) / 2);
        parsed.negotiationFloor = Math.round(mid * 0.60);
      }
    }
    res.json(parsed);
  } catch (err) {
    console.error('Quote API error:', err?.status, err?.message);

    if (err?.status) {
      return res.status(err.status >= 500 ? 502 : err.status).json({
        error: err.message || 'Anthropic API error',
        type: err?.error?.type || 'api_error'
      });
    }

    res.status(500).json({
      error: err.message || 'Internal server error',
      type: 'server_error'
    });
  }
});

// Multi-location quote endpoint
app.post('/api/quote/multi', async (req, res) => {
  const { locations } = req.body;

  if (!locations || !Array.isArray(locations) || locations.length === 0) {
    return res.status(400).json({ error: 'No locations provided' });
  }

  try {
    const results = [];
    for (const loc of locations) {
      const photos = loc.photos || [];
      if (!photos.length) {
        results.push({ label: loc.label || 'Unknown', error: 'No photos for this area' });
        continue;
      }

      const imageContent = photos.map(b64 => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: detectMime(b64),
          data: b64
        }
      }));

      imageContent.push({
        type: 'text',
        text: photos.length > 1
          ? `Analyze all ${photos.length} photos together as one junk pile area labeled "${loc.label || 'Area'}" and return the pricing JSON.`
          : `Analyze this junk pile area labeled "${loc.label || 'Area'}" and return the pricing JSON.`
      });

      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: SYSTEM,
        messages: [{ role: 'user', content: imageContent }]
      });

      const raw = response.content[0].text;
      const clean = raw.replace(/```json|```/g, '').trim();

      try {
        results.push({ label: loc.label || `Area ${results.length + 1}`, quote: JSON.parse(clean) });
      } catch (parseErr) {
        results.push({ label: loc.label || `Area ${results.length + 1}`, error: 'AI returned invalid JSON', raw: raw.substring(0, 300) });
      }
    }

    res.json({ status: 'quoted', locations: results });
  } catch (err) {
    console.error('Multi-quote error:', err?.status, err?.message);
    res.status(err?.status || 500).json({
      error: err.message || 'Multi-location quote failed',
      type: err?.error?.type || 'server_error'
    });
  }
});

// Dispatch endpoint placeholder
app.post('/api/dispatch/new-job', async (req, res) => {
  const job = req.body;
  console.log('Dispatch request received:', job.jobId, job.address);
  res.json({ status: 'received', jobId: job.jobId, message: 'Job queued for dispatch' });
});

// 404 handler — always JSON
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Global error handler — catches express.json() parse errors and everything else
// This MUST return JSON, never HTML
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    type: 'unhandled_error'
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log('Quote API running on port ' + PORT));
