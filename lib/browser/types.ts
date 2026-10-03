export type CreativeSource = "GOOGLE" | "META";

export type CreativeCaptureRequest = {
  source: CreativeSource;
  url: string;
  diagnosticFullPage?: boolean;
};

export type CaptureMethod = "CREATIVE" | "PAGE_FALLBACK";

export type SelectorDiagnostic = {
  selector: string;
  matches: number;
  visibleCandidates: Array<{ index: number; width: number; height: number; accepted: boolean }>;
  inspectionFailed?: boolean;
};

export type CaptureDiagnostics = {
  source: CreativeSource;
  finalUrl: string;
  title: string;
  selectors: SelectorDiagnostic[];
  reason?: string;
};

export type CreativeCaptureResult = {
  image: Buffer;
  contentType: "image/webp" | "image/png";
  method: CaptureMethod;
  diagnostics: CaptureDiagnostics;
  diagnosticFullPage?: Buffer;
};

export interface CreativeBrowser {
  capture(request: CreativeCaptureRequest): Promise<CreativeCaptureResult>;
  close(): Promise<void>;
}
