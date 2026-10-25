export interface RpcTransport {
  /** Mengirim satu RPC dan mengembalikan badan balasan (amplop `{ ok, data | error }`) sebagai teks. */
  call(method: string, payloadJson: string): Promise<string>;
}
