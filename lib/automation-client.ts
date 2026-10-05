type Payload = Record<string, unknown>;
export type AutomationSnapshot = {
  done: boolean;
  brands: Array<{ id: string; automationStatus: string; automationError?: string | null }>;
};

export class AutomationRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

// Platform timeout pages, login redirects, and truncated bodies are not JSON.
// Never display their body or a browser's raw parsing/network exception.
export async function automationRequest(url: string, init: RequestInit = {}): Promise<Payload> {
  let response: Response;
  let payload: unknown;
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) abort();
  // Slightly longer than the route's 300-second Vercel limit.
  const timer = setTimeout(abort, 310_000);
  try {
    response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    if (response.redirected || response.status === 401 || response.status === 403) {
      throw new AutomationRequestError("Your session could not be verified. Sign in again, then reopen this report to resume progress checks.", false);
    }
    const body = await response.text();
    try { payload = JSON.parse(body); } catch { payload = null; }
  } catch (error) {
    if (init.signal?.aborted) throw error;
    if (error instanceof AutomationRequestError) throw error;
    throw new AutomationRequestError("The connection was interrupted. Checking existing report progress again shortly.", true);
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
  const valid = payload !== null && typeof payload === "object" && !Array.isArray(payload);
  if (!response.ok) {
    const retryable = [408, 429].includes(response.status) || response.status >= 500;
    const message = valid && typeof (payload as Payload).error === "string" ? (payload as Payload).error as string : "";
    throw new AutomationRequestError(retryable
      ? "The server is temporarily unavailable. Retrying progress checks; do not start another run."
      : message || `Unable to continue this request (HTTP ${response.status}). Reopen the report to check its status.`, retryable);
  }
  if (!valid) throw new AutomationRequestError("The server returned an incomplete response. Retrying progress checks shortly.", true);
  return payload as Payload;
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function monitorAutomation(url: string, options: {
  signal: AbortSignal;
  onSnapshot: (snapshot: AutomationSnapshot) => void;
  onRetry: (message: string) => void;
  // Injectable delay allows retry/abort regression tests without timers or network.
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}) {
  let failures = 0;
  const delay = options.delay ?? wait;
  while (!options.signal.aborted) {
    try {
      const payload = await automationRequest(url, { signal: options.signal });
      if (typeof payload.done !== "boolean" || !Array.isArray(payload.brands) ||
        !payload.brands.every(brand => brand && typeof brand.id === "string" && typeof brand.automationStatus === "string")) {
        throw new AutomationRequestError("Progress information was incomplete. Retrying shortly.", true);
      }
      failures = 0;
      options.onRetry("");
      options.onSnapshot(payload as AutomationSnapshot);
      if (payload.done) return;
    } catch (error) {
      if (options.signal.aborted) return;
      if (!(error instanceof AutomationRequestError) || !error.retryable) throw error;
      failures++;
      options.onRetry(error.message);
    }
    await delay(Math.min(30_000, 3_000 * 2 ** Math.min(failures, 4)), options.signal);
  }
}
