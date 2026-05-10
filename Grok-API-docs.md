Official xAI API Documentation Sources
All information below comes directly from xAI's official developer documentation (as of the latest available content in May 2026).

Main docs hub: https://docs.x.ai/
Quickstart (includes Node.js examples): https://docs.x.ai/developers/quickstart
Grok 4.3 model page: https://docs.x.ai/developers/models/grok-4.3
Models & pricing overview: https://docs.x.ai/developers/models
Introduction & account setup: https://docs.x.ai/developers/introduction
API console (for keys): https://console.x.ai/ (sign in required)

xAI's API is OpenAI-compatible (and also works with Vercel AI SDK) and uses the base URL https://api.x.ai/v1. Grok 4.3 is the current flagship model for text/chat use cases.
1. Getting API Access (Account + API Key)

Create a free xAI account: https://accounts.x.ai/sign-up?redirect=cloud-console
Go to the xAI Console → API Keys page: https://console.x.ai/team/default/api-keys
Click Create API key, name it, and copy it.
Store it securely (e.g., as environment variable XAI_API_KEY).

Important notes:

API access is separate from X Premium/Grok on X.com or the mobile apps.
Billing is pay-as-you-go through xAI (not tied to your X subscription).

2. Grok 4.3 Model Details

Model name: grok-4.3 (aliases: grok-4.3-latest, grok-latest)
Context window: 1,000,000 tokens
Capabilities:
Strongest agentic tool calling with minimal hallucinations
Configurable reasoning (none / low / medium / high)
Function calling / tool use
Structured outputs
Vision (image understanding)
Non-reasoning mode supported

Pricing (Chat API):
Input: $1.25 / 1M tokens
Cached input: $0.20 / 1M tokens
Output: $2.50 / 1M tokens
Higher rates apply for requests exceeding 200K context window (see docs for tiered pricing).

Regions: us-east-1, eu-west-1
Rate limits (default): 1,800 requests/minute, 10M tokens/minute (can request increases).
Recommended for all chat/coding/agentic use cases.

Note on model retirement: Older models (e.g., grok-4, grok-4-1-fast) will be retired on May 15, 2026. Migrate to Grok 4.3.
3. Accessing Grok 4.3 from Node.js
xAI provides two easy options for Node.js:
Option A: Official recommendation – OpenAI SDK (drop-in compatible)
Bashnpm install openai
JavaScriptimport OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config(); // or use process.env directly

const client = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: 'https://api.x.ai/v1',
});

const response = await client.responses.create({
  model: 'grok-4.3',
  input: [
    { role: 'system', content: 'You are Grok, a highly intelligent, helpful AI assistant.' },
    { role: 'user', content: 'What is the meaning of life, the universe, and everything?' },
  ],
});

console.log(response.output_text);
Option B: Vercel AI SDK (@ai-sdk/xai) – more modern streaming & tools support
Bashnpm install ai @ai-sdk/xai zod
JavaScriptimport { createXai } from '@ai-sdk/xai';
import { generateText } from 'ai';

const xai = createXai({
  apiKey: process.env.XAI_API_KEY,
});

const { text } = await generateText({
  model: xai.responses('grok-4.3'),
  system: 'You are Grok, a highly intelligent, helpful AI assistant.',
  prompt: 'What is the meaning of life, the universe, and everything?',
});

console.log(text);
Raw curl equivalent (for reference):
Bashcurl https://api.x.ai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-4.3",
    "input": [
      {"role": "system", "content": "You are Grok..."},
      {"role": "user", "content": "Your prompt here"}
    ]
  }'
Key differences from classic OpenAI:

Endpoint: /v1/responses (not /v1/chat/completions)
Field: input (array of messages) instead of messages
Response field: output_text instead of choices[0].message.content

Additional Features You Can Use with Grok 4.3 in Node.js

Streaming: Supported in both SDKs (see xAI docs → Streaming guide).
Vision (images): Pass input_image / image URLs in the content array.
Tool calling / function calling: Fully supported (see Tool Use guide).
Structured outputs: Enforce JSON schema responses.
Multi-turn chat: Maintain conversation history in the input array.

Full Official Documentation Links (Recommended Reading Order)

Quickstart (Node.js + Python + curl examples): https://docs.x.ai/developers/quickstart
Grok 4.3 model card: https://docs.x.ai/developers/models/grok-4.3
All models & pricing: https://docs.x.ai/developers/models
Text generation / advanced features: https://docs.x.ai/developers/model-capabilities/text (reasoning, tools, structured outputs, streaming, etc.)
Image understanding: https://docs.x.ai/developers/model-capabilities/images/understanding

You now have everything needed to start calling Grok 4.3 from Node.js today.
For the absolute latest changes, always check https://docs.x.ai/ (docs are updated regularly). If you need rate-limit increases or enterprise support, use the form linked in the Grok 4.3 model page.
Happy building! 🚀