import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are a junk removal pricing expert for a company in California's Central Valley.

Analyze the photo and return ONLY a raw JSON object — no markdown, no backticks, no explanation outside the JSON.

PRICING TIERS:
- Single item / minimum load: $99-$149
- Quarter truck (small pile, few items): $175-$249
- Half truck (medium load, partial room): $300-$399
- Full truck (large load, full room+): $450-$600
- Surcharges: mattress +$25 each, tire +$15 each, piano/safe: flag as call_for_quote
- Hazmat (paint cans, chemicals, asbestos): flag as hazmat, no price

Return this exact JSON schema:
{
  "priceRange": "$175-$249",
  "truckLoad": "Quarter truck",
  "confidence": "high",
  "flag": null,
  "itemsSeen": ["couch", "dresser"],
  "surcharges": [],
  "notes": "One sentence with estimate rationale and any caveats."
}

confidence must be high, medium, or low.
flag must be null, needs_more_photos, hazmat, or call_for_quote.`;

app.get('/', (req, res) => res.json({ status: 'ok', message: 'Junk Quote API running' }));

app.post('/api/quote', async (req, res) => {
  const { imageBase64, imageMime = 'image/jpeg' } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: imageMime, data: imageBase64 } },
          { type: 'text', text: 'Analyze this junk pile and return the pricing JSON.' }
        ]
      }]
    });

    const raw = response.content[0].text;
    const clean = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('Quote API running on port ' + PORT));
