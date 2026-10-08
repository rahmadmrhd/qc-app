interface GasRunner {
  withSuccessHandler(handler: (value: unknown) => void): GasRunner;
  withFailureHandler(handler: (error: Error) => void): GasRunner;
  api(method: string, payloadJson: string, token: string): void;
}

interface GasLocation {
  hash: string;
  parameter: Record<string, string>;
  parameters: Record<string, string[]>;
}

interface GasScript {
  run: GasRunner;
  history: {
    replace(state: unknown, params: Record<string, string>, hash: string): void;
    push(state: unknown, params: Record<string, string>, hash: string): void;
  };
  url: { getLocation(callback: (location: GasLocation) => void): void };
}

interface Window {
  google?: { script?: GasScript };
  __BOOT__?: import('@shared/rpc').BootData;
}
