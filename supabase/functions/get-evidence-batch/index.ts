import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type Json = Record<string, unknown>;

type Evidence = {
  uuid: string;
  source?: string | null;
  excerpt?: string | null;
  date?: string | null;
  _additional?: {
    creationTimeUnix?: number;
    lastUpdateTimeUnix?: number;
  };
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WEAVIATE_BATCH_SIZE = 100;

function makeRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function normalizeWeaviateUrl(url: string): string {
  let trimmed = url.trim();

  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    trimmed = `https://${trimmed}`;
  }

  return trimmed.replace(/\/+$/, "");
}

function jsonResponse(status: number, body: Json): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function gqlEscape(value: string): string {
  return JSON.stringify(value);
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function buildWhere(ids: string[]): string {
  const operands = ids.map((id) => `
    {
      path: ["uuid"],
      operator: Equal,
      valueText: ${gqlEscape(id)}
    }
  `);

  return `{
    operator: Or,
    operands: [${operands.join(",")}]
  }`;
}

function buildQuery(ids: string[]): string {
  return `
{
  Get {
    Evidence(
      where: ${buildWhere(ids)}
    ) {
      uuid
      source
      excerpt
      date
      _additional {
        creationTimeUnix
        lastUpdateTimeUnix
      }
    }
  }
}
`.trim();
}

async function fetchWeaviate(query: string, url: string, apiKey: string) {
  const graphqlUrl = `${url}/v1/graphql`;

  const res = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query }),
  });

  const text = await res.text();

  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    throw new Error(`Weaviate HTTP ${res.status}: ${text}`);
  }

  if ((json as any)?.errors) {
    throw new Error(`Weaviate GraphQL error: ${JSON.stringify((json as any).errors)}`);
  }

  return json;
}

function parseEvidence(result: any): Evidence[] {
  return result?.data?.Get?.Evidence ?? [];
}

async function fetchAllEvidenceByIds(
  ids: string[],
  url: string,
  apiKey: string,
): Promise<Evidence[]> {
  const uniqueIds = [...new Set(ids)];
  const idChunks = chunkArray(uniqueIds, WEAVIATE_BATCH_SIZE);
  const evidenceById = new Map<string, Evidence>();

  for (const idChunk of idChunks) {
    const query = buildQuery(idChunk);
    const result = await fetchWeaviate(query, url, apiKey);
    const batchEvidence = parseEvidence(result);

    for (const item of batchEvidence) {
      if (item?.uuid) {
        evidenceById.set(item.uuid, item);
      }
    }
  }

  return uniqueIds
    .map((id) => evidenceById.get(id))
    .filter((item): item is Evidence => item !== undefined);
}

serve(async (req: Request) => {
  const requestId = makeRequestId();

  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse(405, { error: "Use POST only", request_id: requestId });
    }

    const body = await req.json();
    const ids = body?.ids;

    if (!Array.isArray(ids)) {
      return jsonResponse(400, {
        error: "ids must be an array",
        request_id: requestId,
      });
    }

    const validIds = ids.filter((id) => typeof id === "string" && id.length > 0);

    if (validIds.length === 0) {
      return jsonResponse(200, {
        evidence: [],
        requested_count: 0,
        found_count: 0,
        request_id: requestId,
      });
    }

    const rawUrl = Deno.env.get("WEAVIATE_URL") ?? "";
    const apiKey = Deno.env.get("WEAVIATE_APIKEY") ?? "";

    if (!rawUrl || !apiKey) {
      return jsonResponse(500, {
        error: "Missing WEAVIATE_URL or WEAVIATE_APIKEY",
        request_id: requestId,
      });
    }

    const weaviateUrl = normalizeWeaviateUrl(rawUrl);
    const evidence = await fetchAllEvidenceByIds(validIds, weaviateUrl, apiKey);

    return jsonResponse(200, {
      evidence,
      requested_count: validIds.length,
      found_count: evidence.length,
      request_id: requestId,
    });
  } catch (err) {
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : String(err),
      request_id: requestId,
    });
  }
});
