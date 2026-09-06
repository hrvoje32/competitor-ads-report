export type CreativeSource = "GOOGLE" | "META";

export type CreativeCaptureRequest = {
  source: CreativeSource;
  url: string;
};

export interface CreativeBrowser {
  capture(request: CreativeCaptureRequest): Promise<Buffer>;
  close(): Promise<void>;
}
