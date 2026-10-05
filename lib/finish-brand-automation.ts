import { NO_USABLE_EVIDENCE } from "@/lib/automation-result";

type Services = {
  advance: (id: string) => Promise<{ readyForAnalysis: boolean; done: boolean }>;
  claim: (id: string) => Promise<boolean>;
  select: (id: string) => Promise<{ analysis: number }>;
  generate: (id: string) => Promise<Response>;
  ready: (id: string) => Promise<unknown>;
  skipped: (id: string) => Promise<unknown>;
  failed: (id: string, error: unknown) => Promise<unknown>;
};

export async function finishBrandAutomation(id: string, services: Services) {
  try {
    const collection = await services.advance(id);
    if (!collection.readyForAnalysis || collection.done) return;
    if (!await services.claim(id)) return;
    const selection = await services.select(id);
    if (!selection.analysis) {
      await services.skipped(id);
      return;
    }
    const response = await services.generate(id);
    const payload = await response.json() as { error?: string; code?: string };
    if (!response.ok && payload.code === NO_USABLE_EVIDENCE) {
      await services.skipped(id);
      return;
    }
    if (!response.ok) throw new Error(payload.error || "OpenAI generation failed.");
    await services.ready(id);
  } catch (error) {
    await services.failed(id, error);
  }
}
