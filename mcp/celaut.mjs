/**
 * Celaut runtime glue for server-http.mjs: reads the instance's `__config__`
 * (celaut.ConfigurationFile, binary protobuf) and wires what the node resolved
 * for the networks declared in .service/service.json.
 *
 * Why this exists: a Celaut guest gets ADDRESSES, not name resolution. The node
 * resolves each hostname tag (api.ergoplatform.com, raw.githubusercontent.com)
 * itself, opens exactly those IPs in the guest firewall and lists them under
 * `network_resolution`; nothing inside the VM answers DNS (nodo
 * docs/NETWORKS.md §1). So fetch() would fail at getaddrinfo() before reaching
 * the allowed address. installCelautNetwork() answers dns.lookup for those names
 * from `network_resolution` instead — TLS still uses the hostname for SNI and
 * certificate checks, so nothing about the HTTPS calls changes.
 *
 * It also takes the Ergo node REST address from the `pow:ergo` resolution (slot
 * tagged `ergo-rest`) as the default GOP_NODE_URI, which the seed signer submits
 * transactions to.
 *
 * Outside a Celaut instance (no `__config__`) it does nothing and normal DNS is
 * used. Under `nodo ggconf` the file is written to the repo root, which is also
 * looked up.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
import net from 'node:net';

/** nodo src/manager/pow_networks.py REST_SLOT_TAG. */
const ERGO_REST_SLOT_TAG = 'ergo-rest';
const POW_ERGO_TAG = 'pow:ergo';

// ── Minimal protobuf reader (only the ConfigurationFile fields used here) ───
//
// celaut.proto field numbers:
//   ConfigurationFile { network_resolution = 3 }
//   NetworkResolution { repeated string tags = 1; repeated Instance peer_instances = 2 }
//   Instance          { Service.Api api = 1; repeated Uri_Slot uri_slot = 2 }
//   Service.Api       { repeated Slot slot = 1 }
//   Slot              { int32 port = 1; repeated Protocol protocol_stack = 3 }
//   Protocol          { repeated string tags = 1 }
//   Uri_Slot          { int32 internal_port = 1; repeated Uri uri = 2 }
//   Uri               { string ip = 1; int32 port = 2 }

function* fields(buf) {
  let pos = 0;
  const varint = () => {
    let result = 0;
    let scale = 1;
    for (;;) {
      if (pos >= buf.length) throw new Error('truncated varint in __config__');
      const byte = buf[pos++];
      result += (byte & 0x7f) * scale;
      if (!(byte & 0x80)) return result;
      scale *= 128;
    }
  };
  while (pos < buf.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) yield { field, value: varint() };
    else if (wire === 2) {
      const len = varint();
      if (pos + len > buf.length) throw new Error('truncated field in __config__');
      yield { field, value: buf.subarray(pos, pos + len) };
      pos += len;
    } else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else throw new Error(`unsupported protobuf wire type ${wire} in __config__`);
  }
}

const text = (b) => Buffer.from(b).toString('utf8');

function decode(buf, spec) {
  const out = {};
  for (const [name, [, repeated]] of Object.entries(spec)) out[name] = repeated ? [] : undefined;
  for (const { field, value } of fields(buf)) {
    const entry = Object.entries(spec).find(([, [n]]) => n === field);
    if (!entry) continue;
    const [name, [, repeated, read]] = entry;
    const v = read(value);
    if (repeated) out[name].push(v);
    else out[name] = v;
  }
  return out;
}

const int = (v) => (typeof v === 'number' ? v : 0);
const uri = (b) => decode(b, { ip: [1, false, text], port: [2, false, int] });
const uriSlot = (b) => decode(b, { internalPort: [1, false, int], uris: [2, true, uri] });
const protocol = (b) => decode(b, { tags: [1, true, text] });
const slot = (b) => decode(b, { port: [1, false, int], protocolStack: [3, true, protocol] });
const api = (b) => decode(b, { slots: [1, true, slot] });
const instance = (b) => decode(b, { api: [1, false, api], uriSlots: [2, true, uriSlot] });
const resolution = (b) => decode(b, { tags: [1, true, text], peers: [2, true, instance] });

/** `network_resolution` of a serialized celaut.ConfigurationFile. */
export function readNetworkResolution(buf) {
  return decode(buf, { networkResolution: [3, true, resolution] }).networkResolution;
}

// ── What the service uses from it ───────────────────────────────────────────

/** Same test nodo applies to call a tag a hostname: lowercase with a dot. */
const isHostnameTag = (tag) => tag === tag.toLowerCase() && tag.includes('.') && !tag.includes(':');

/** hostname → IPs granted for it, from every hostname-tagged resolution. */
export function hostAddresses(resolutions) {
  const hosts = new Map();
  for (const r of resolutions) {
    const ips = [...new Set(r.peers.flatMap((p) => p.uriSlots.flatMap((s) => s.uris.map((u) => u.ip))))]
      .filter((ip) => net.isIP(ip));
    if (!ips.length) continue;
    for (const tag of r.tags.filter(isHostnameTag)) hosts.set(tag, ips);
  }
  return hosts;
}

/** `http://ip:port` of every Ergo node REST slot in the `pow:ergo` resolution. */
export function ergoRestUris(resolutions) {
  const uris = [];
  for (const r of resolutions.filter((r) => r.tags.includes(POW_ERGO_TAG))) {
    for (const peer of r.peers) {
      const restPorts = new Set((peer.api?.slots ?? [])
        .filter((s) => s.protocolStack.some((p) => p.tags.includes(ERGO_REST_SLOT_TAG)))
        .map((s) => s.port));
      for (const s of peer.uriSlots.filter((s) => restPorts.has(s.internalPort))) {
        for (const u of s.uris) uris.push(`http://${net.isIPv6(u.ip) ? `[${u.ip}]` : u.ip}:${u.port}`);
      }
    }
  }
  return uris;
}

function overrideLookup(hosts) {
  const original = dns.lookup;
  dns.lookup = function lookup(hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    const ips = hosts.get(String(hostname).toLowerCase());
    if (!ips) return original.call(dns, hostname, options, callback);
    const opts = typeof options === 'number' ? { family: options } : options || {};
    const family = opts.family === 'IPv4' ? 4 : opts.family === 'IPv6' ? 6 : opts.family || 0;
    const answers = ips.map((address) => ({ address, family: net.isIP(address) }))
      .filter((a) => !family || a.family === family);
    process.nextTick(() => {
      if (!answers.length) {
        const err = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
        err.code = 'ENOTFOUND';
        return callback(err);
      }
      if (opts.all) return callback(null, answers);
      callback(null, answers[0].address, answers[0].family);
    });
  };
}

function findConfig() {
  // Instance: /__config__. `nodo ggconf <repo>`: <repo>/__config__.
  const candidates = [process.env.CELAUT_CONFIG, '/__config__', fileURLToPath(new URL('../__config__', import.meta.url))];
  return candidates.find((p) => p && existsSync(p));
}

/**
 * Wire this process to the networks in `__config__`. Returns a summary for the
 * health endpoint, or null when not running as a Celaut instance.
 */
export function installCelautNetwork() {
  const path = findConfig();
  if (!path) return null;
  const resolutions = readNetworkResolution(readFileSync(path));
  const hosts = hostAddresses(resolutions);
  if (hosts.size) overrideLookup(hosts);
  const ergoNodes = ergoRestUris(resolutions);
  if (!process.env.GOP_NODE_URI && ergoNodes.length) process.env.GOP_NODE_URI = ergoNodes[0];
  return {
    config: path,
    hosts: Object.fromEntries(hosts),
    ergoNodes,
    nodeUri: process.env.GOP_NODE_URI || null
  };
}
