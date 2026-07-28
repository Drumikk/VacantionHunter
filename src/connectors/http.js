export class HttpError extends Error {
  constructor(message, { status, code, retryAfterMs = null, host, requestId = null } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.host = host;
    this.requestId = requestId;
  }
}

function retryAfterMs(response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

async function responseError(response, url) {
  const host = new URL(url).hostname;
  const contentType = response.headers.get("content-type") || "";
  const requestId = response.headers.get("x-request-id");
  const server = response.headers.get("server") || "";
  const challenged = response.headers.get("cf-mitigated") === "challenge" || /cloudflare/i.test(server) && contentType.includes("text/html");
  let code = challenged ? "cloudflare_challenge" : `http_${response.status}`;
  if (contentType.includes("json")) {
    try {
      const payload = await response.json();
      code = payload?.errors?.[0]?.type || payload?.errors?.[0]?.value || code;
    } catch { /* an invalid error body should not hide the HTTP status */ }
  }
  return new HttpError(`HTTP ${response.status} (${code}) from ${host}`, {
    status: response.status,
    code,
    retryAfterMs: retryAfterMs(response),
    host,
    requestId,
  });
}

export async function fetchJson(url, { timeoutMs = 8_000, headers = {}, retries = 1, fetchImpl = fetch, userAgent = "VacationHunter/0.1" } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": userAgent, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Math.min(2_000, Number(response.headers.get("retry-after") || 0) * 1_000 || 250 * (attempt + 1));
        if (attempt < retries) { await new Promise((resolve) => setTimeout(resolve, retryAfter)); continue; }
      }
      if (!response.ok) throw await responseError(response, url);
      return await response.json();
    } catch (error) {
      lastError = error;
      const retryable = !(error instanceof HttpError) || error.status === 429 || error.status >= 500;
      if (attempt < retries && retryable) {
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      } else {
        break;
      }
    }
  }
  throw lastError;
}
