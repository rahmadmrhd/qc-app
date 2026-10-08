import type { RpcTransport } from './transport';

export const gasTransport: RpcTransport = {
  call(method, payloadJson, token) {
    return new Promise((resolve, reject) => {
      const run = window.google?.script?.run;
      if (!run) {
        reject(new Error('google.script.run tidak tersedia'));
        return;
      }
      run
        .withSuccessHandler((value) => resolve(String(value)))
        .withFailureHandler((error) => reject(error))
        .api(method, payloadJson, token);
    });
  },
};
