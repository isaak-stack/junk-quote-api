import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are a junk removal pricing expert for a company serving Fresno and the Central Valley, CA.

You will receive one or more photos of a junk pile. Analyze ALL photos together to estimate total volume.

LOCAL MARKET RATES (Fresno/Central Valley, 2025-2026):
- Competitors: Junk King Fresno, 1-800-GOT-JUNK, LoadUp — avg $150-$600 depending on load
- Our pricing is competitive but slightly below franchise rates to win local market share

PRICING TIERS (based on truck volume):
- Single item / minimum: $99-$149
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

app.get('/', (req, res) => res.json({ status: 'ok' }));

app.post('/api/quote', async (req, res) => {
  const { images, imageMime = 'image/jpeg' } = req.body;

  if (!images || !images.length) {
    return res.status(400).json({ error: 'No images provided' });
  }

  try {
    const imageContent = images.map(b64 => ({
      type: 'image',
      source: { type: 'base64', media_type: imageMime, data: b64 }
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
    res.json(JSON.parse(clean));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log('Quote API running on port ' + PORT));
