/** One way to call the outside world: a time limit, a size limit, and an error that says which source failed. */
export class SourceError extends Error {
  constructor(
    public source: string,
    message: string,
    public status?: number,
  ) {
    super(`${source}: ${message}`);
  }
}

const AGENT = "ProcurementIntelligence/0.1 (+market research for purchasing; one page per supplier)";

export async function httpGet(source: string, url: string, init: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number; method?: string; body?: string } = {}): Promise<{ text: string; contentType: string; url: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, { method: init.method ?? "GET", body: init.body, headers: { "user-agent": AGENT, accept: "*/*", ...init.headers }, signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new SourceError(source, `HTTP ${res.status}`, res.status);
    const buffer = await res.arrayBuffer();
    const bytes = init.maxBytes && buffer.byteLength > init.maxBytes ? buffer.slice(0, init.maxBytes) : buffer;
    return { text: new TextDecoder("utf-8").decode(bytes), contentType: res.headers.get("content-type") ?? "", url: res.url || url };
  } catch (err) {
    if (err instanceof SourceError) throw err;
    throw new SourceError(source, (err as Error).name === "AbortError" ? "no answer in time" : ((err as Error).message ?? "request failed"));
  } finally {
    clearTimeout(timer);
  }
}
