// Pramuat Node (NODE_OPTIONS=--require <berkas ini>) untuk jaringan yang DNS-nya membajak *.workers.dev.
// Hanya untuk proses ini: nama *.workers.dev diselesaikan lewat DNS-over-HTTPS Cloudflare (IP asli);
// nama lain memakai resolver sistem. Tidak mengubah pengaturan sistem.
const dns = require('node:dns');
const https = require('node:https');

const cache = new Map();
const original = dns.lookup;

function doh(host, cb) {
  if (cache.has(host)) return cb(null, cache.get(host));
  https
    .get(
      `https://1.1.1.1/dns-query?name=${encodeURIComponent(host)}&type=A`,
      { headers: { accept: 'application/dns-json' }, servername: 'cloudflare-dns.com' },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try {
            const ips = (JSON.parse(body).Answer || [])
              .filter((a) => a.type === 1)
              .map((a) => a.data);
            if (ips.length === 0) return cb(new Error(`DoH: tidak ada A untuk ${host}`));
            cache.set(host, ips);
            cb(null, ips);
          } catch (e) {
            cb(e);
          }
        });
      },
    )
    .on('error', cb);
}

dns.lookup = function lookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (typeof options === 'number') options = { family: options };
  if (typeof hostname === 'string' && hostname.endsWith('.workers.dev')) {
    return doh(hostname, (err, ips) => {
      if (err) return callback(err);
      if (options && options.all)
        return callback(
          null,
          ips.map((address) => ({ address, family: 4 })),
        );
      return callback(null, ips[0], 4);
    });
  }
  return original.call(dns, hostname, options, callback);
};
