import { config } from '../config/index.js';
import logger from '../config/logger.js';

export interface ParsedSearchQuery {
  senderFilter?: string;
  senderDomainFilter?: string;
  dateFrom?: string;
  dateTo?: string;
  folderFilter?: string;
  importanceFilter?: 'high' | 'normal' | 'low';
  hasAttachments?: boolean;
  semanticQuery: string;
  originalQuery: string;
}

/**
 * Generate an embedding vector using Ollama's embedding API.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${config.ollamaUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaEmbedModel,
      prompt: text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama embedding failed (${response.status}): ${body.substring(0, 200)}`);
  }

  const data = (await response.json()) as { embedding: number[] };
  return data.embedding;
}

/**
 * Generate embeddings for a batch of texts sequentially.
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await generateEmbedding(text));
  }
  return results;
}

/**
 * Use the instruct model to parse a natural language search query
 * into structured filters + a semantic query for vector search.
 */
export async function parseSearchQuery(query: string): Promise<ParsedSearchQuery> {
  const today = new Date().toISOString().split('T')[0];

  const systemPrompt = `You are a search query parser for an email system. Extract structured filters from natural language queries.
Today's date is ${today}.

Return ONLY valid JSON with these optional fields:
- senderFilter: email address or name of sender (if mentioned)
- senderDomainFilter: domain like "gmail.com" (if mentioned)
- dateFrom: ISO date string (if date range mentioned, e.g. "last week" = 7 days ago)
- dateTo: ISO date string (if date range mentioned)
- folderFilter: folder name like "inbox", "sent", "drafts" (if mentioned)
- importanceFilter: "high", "normal", or "low" (if mentioned)
- hasAttachments: true/false (if mentioned)
- semanticQuery: the core meaning of what the user is looking for, stripped of filter-specific words. This is used for vector similarity search.

Examples:
Query: "emails from john about invoices"
{"senderFilter":"john","semanticQuery":"invoices"}

Query: "urgent messages with attachments from last week"
{"importanceFilter":"high","hasAttachments":true,"dateFrom":"${getDateDaysAgo(7)}","dateTo":"${today}","semanticQuery":"urgent messages"}

Query: "show me everything from sneha regarding project updates"
{"senderFilter":"sneha","semanticQuery":"project updates"}

Query: "unread newsletters"
{"semanticQuery":"newsletters"}`;

  try {
    const response = await fetch(`${config.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaInstructModel,
        prompt: `${systemPrompt}\n\nQuery: "${query}" /no_think`,
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 300,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama generate failed (${response.status}): ${body.substring(0, 200)}`);
    }

    const data = (await response.json()) as { response: string };
    const jsonStr = extractJson(data.response);
    const parsed = JSON.parse(jsonStr) as Partial<ParsedSearchQuery>;

    return {
      ...parsed,
      semanticQuery: parsed.semanticQuery || query,
      originalQuery: query,
    };
  } catch (err) {
    logger.warn('Failed to parse search query with LLM, falling back to raw query', {
      query,
      error: err instanceof Error ? err.message : String(err),
    });
    // Fallback: use the entire query as the semantic query
    return {
      semanticQuery: query,
      originalQuery: query,
    };
  }
}

/**
 * Check health of Ollama embedding and instruct models.
 */
export async function checkOllamaHealth(): Promise<{ embed: boolean; instruct: boolean }> {
  const result = { embed: false, instruct: false };

  try {
    const res = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const models = data.models?.map((m) => m.name) ?? [];
      result.embed = models.some((m) => m.startsWith(config.ollamaEmbedModel));
      result.instruct = models.some((m) => m.startsWith(config.ollamaInstructModel));
    }
  } catch {
    // Ollama unreachable
  }

  return result;
}

// --- Helpers ---

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0]!;
}

/**
 * Extract the first JSON object from a string that may contain surrounding text.
 */
function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON object found in response: ${text.substring(0, 200)}`);
  }
  return text.substring(start, end + 1);
}
