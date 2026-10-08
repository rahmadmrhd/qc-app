export interface RpcTransport {
  call(method: string, payloadJson: string, token: string): Promise<string>;
}
