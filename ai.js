```javascript
'use strict';

const catalog = require('./catalog');

const GEMINI_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';

class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

function buildResponseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      recommendations: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: {
              type: 'STRING',
              enum: catalog.listIds()
            },
            name: {
              type: 'STRING'
            },
            location: {
              type: 'STRING'
            },
            description: {
              type: 'STRING'
            },
            durationDays: {
              type: 'INTEGER'
            },
            pricePerTraveller: {
              type: 'STRING'
            },
            currency: {
              type: 'STRING'
            },
            demonstration: {
              type: 'BOOLEAN'
            },
            reason: {
              type: 'STRING'
            }
          },
          required: [
            'id',
            'name',
            'location',
            'description',
            'durationDays',
            'pricePerTraveller',
            'currency',
            'demonstration',
            'reason'
          ],
          propertyOrdering: [
            'id',
            'name',
            'location',
            'description',
            'durationDays',
            'pricePerTraveller',
            'currency',
            'demonstration',
            'reason'
          ]
        }
      },
      model: {
        type: 'STRING'
      }
    },
    required: ['recommendations', 'model'],
    propertyOrdering: ['recommendations', 'model']
  };
}

function buildPrompt() {
  const items = catalog.list().map((item) => ({
    id: item.id,
    name: item.name,
    location: item.location,
    description: item.description,
    durationDays: item.durationDays,
    pricePerTraveller: item.pricePerTraveller,
    currency: item.currency,
    demonstration: item.demonstration
  }));

  return [
    'You are the Daylite Digital travel discovery assistant.',
    'Recommend only experiences from the controlled demonstration catalogue below.',
    'Do not invent destinations, experiences, prices, currencies, durations, inventory, or reservations.',
    'The server is the source of truth for commercial values.',
    'Return the catalogue item IDs that best match the traveller request.',
    '',
    'CONTROLLED CATALOGUE:',
    JSON.stringify(items, null, 2)
  ].join('\n');
}

async function recommend(query, options = {}) {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  const model = options.model || process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

  if (!apiKey) {
    throw new AppError(
      'Gemini API key is not configured.',
      500,
      'AI_NOT_CONFIGURED'
    );
  }

  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new AppError(
      'Please describe the travel experience you want.',
      400,
      'INVALID_QUERY'
    );
  }

  const url =
    `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`;

  const body = {
    systemInstruction: {
      parts: [
        {
          text: buildPrompt()
        }
      ]
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: query.trim()
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: buildResponseSchema()
    }
  };

  let response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw new AppError(
      'The AI assistant is temporarily unavailable. Please try again.',
      502,
      'AI_UNAVAILABLE'
    );
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');

    console.error('Gemini API error:', response.status, errorText);

    throw new AppError(
      'The AI assistant is temporarily unavailable. Please try again.',
      502,
      'AI_UNAVAILABLE'
    );
  }

  let data;

  try {
    data = await response.json();
  } catch (error) {
    throw new AppError(
      'The AI assistant returned an invalid response.',
      502,
      'AI_INVALID_RESPONSE'
    );
  }

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim();

  if (!text) {
    throw new AppError(
      'The AI assistant returned no recommendations.',
      502,
      'AI_EMPTY_RESPONSE'
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.error('Gemini JSON parse error:', error, text);

    throw new AppError(
      'The AI assistant returned an invalid recommendation format.',
      502,
      'AI_INVALID_JSON'
    );
  }

  const recommendations = Array.isArray(parsed.recommendations)
    ? parsed.recommendations
    : [];

  const validIds = new Set(catalog.listIds());

  const cleanedRecommendations = recommendations
    .filter((item) => item && validIds.has(item.id))
    .map((item) => {
      const source = catalog.get(item.id);

      return {
        id: source.id,
        name: source.name,
        location: source.location,
        description: source.description,
        durationDays: source.durationDays,
        pricePerTraveller: source.pricePerTraveller,
        currency: source.currency,
        demonstration: source.demonstration,
        reason: item.reason || 'This experience matches your request.'
      };
    });

  return {
    recommendations: cleanedRecommendations,
    model
  };
}

module.exports = {
  recommend,
  AppError
};
```

### Important

Your **`.env` stays separate** and contains your local credentials.

Your **`ai.js` contains JavaScript only**.

So GitHub should show:

```text
ai.js
├── const catalog = require('./catalog');
├── Gemini API logic
├── response schema
└── recommend()
```

**NOT**:

```text
ai.js
├── GEMINI_API_KEY=...
├── PAYPAL_CLIENT_ID=...
└── PORT=3000
```

Paste the code above into the GitHub `ai.js` editor, then commit that `ai.js` change. **Do not put the `.env` contents into GitHub.**
