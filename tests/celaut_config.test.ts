import { afterEach, describe, expect, it } from 'vitest';
import dns from 'node:dns';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore — plain ESM module of the MCP service
import { readNetworkResolution, hostAddresses, ergoRestUris, installCelautNetwork } from '../mcp/celaut.mjs';

// Minimal protobuf writer for the celaut.ConfigurationFile fields celaut.mjs reads.
const varint = (n: number) => {
    const out: number[] = [];
    while (n > 127) { out.push((n % 128) | 128); n = Math.floor(n / 128); }
    out.push(n);
    return Buffer.from(out);
};
const num = (field: number, n: number) => Buffer.concat([varint(field * 8), varint(n)]);
const bytes = (field: number, b: Buffer) => Buffer.concat([varint(field * 8 + 2), varint(b.length), b]);
const str = (field: number, s: string) => bytes(field, Buffer.from(s, 'utf8'));
const msg = (...parts: Buffer[]) => Buffer.concat(parts);

const uri = (ip: string, port: number) => msg(str(1, ip), num(2, port));
const uriSlot = (internalPort: number, ...uris: Buffer[]) => msg(num(1, internalPort), ...uris.map((u) => bytes(2, u)));
const slot = (port: number, tag: string) => msg(num(1, port), bytes(2, str(1, 'tcp')), bytes(3, str(1, tag)));
const instance = (slots: Buffer[], uriSlots: Buffer[]) =>
    msg(bytes(1, msg(...slots.map((s) => bytes(1, s)))), ...uriSlots.map((u) => bytes(2, u)));
const resolution = (tags: string[], ...peers: Buffer[]) => msg(...tags.map((t) => str(1, t)), ...peers.map((p) => bytes(2, p)));

const config = msg(
    // gateway (field 1) is skipped by the reader.
    bytes(1, instance([slot(8090, 'gateway')], [uriSlot(8090, uri('192.168.1.1', 8090))])),
    bytes(3, resolution(['api.ergoplatform.com'],
        instance([], [uriSlot(1, uri('104.21.55.206', 443), uri('172.67.172.201', 443))]))),
    bytes(3, resolution(['pow:ergo'],
        instance([slot(9030, 'ergo-p2p'), slot(9053, 'ergo-rest')],
            [uriSlot(9030, uri('203.0.113.7', 9030)), uriSlot(9053, uri('203.0.113.7', 9053))]),
        // A peer narrowed to its P2P slot contributes no REST uri.
        instance([slot(9030, 'ergo-p2p')], [uriSlot(9030, uri('198.51.100.2', 9030))]))),
    bytes(3, resolution(['ipv4', 'public']))
);

describe('Celaut __config__ reader', () => {
    const originalLookup = dns.lookup;
    afterEach(() => {
        dns.lookup = originalLookup;
        delete process.env.CELAUT_CONFIG;
        delete process.env.GOP_NODE_URI;
    });

    it('decodes network_resolution', () => {
        const resolutions = readNetworkResolution(config);
        expect(resolutions.map((r: any) => r.tags)).toEqual([['api.ergoplatform.com'], ['pow:ergo'], ['ipv4', 'public']]);
        expect(resolutions[1].peers).toHaveLength(2);
    });

    it('maps hostname tags to their granted IPs and ignores non-hostname tags', () => {
        const hosts = hostAddresses(readNetworkResolution(config));
        expect(Object.fromEntries(hosts)).toEqual({ 'api.ergoplatform.com': ['104.21.55.206', '172.67.172.201'] });
    });

    it('takes only the ergo-rest slots of pow:ergo peers', () => {
        expect(ergoRestUris(readNetworkResolution(config))).toEqual(['http://203.0.113.7:9053']);
    });

    it('answers dns.lookup for granted hosts and defaults GOP_NODE_URI', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gop-celaut-'));
        process.env.CELAUT_CONFIG = join(dir, '__config__');
        writeFileSync(process.env.CELAUT_CONFIG, config);

        const summary = installCelautNetwork();
        expect(summary?.nodeUri).toBe('http://203.0.113.7:9053');
        expect(process.env.GOP_NODE_URI).toBe('http://203.0.113.7:9053');

        const one = await new Promise((resolve, reject) =>
            dns.lookup('api.ergoplatform.com', (err, address, family) => (err ? reject(err) : resolve([address, family]))));
        expect(one).toEqual(['104.21.55.206', 4]);
        const all = await new Promise((resolve, reject) =>
            dns.lookup('api.ergoplatform.com', { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))));
        expect(all).toEqual([{ address: '104.21.55.206', family: 4 }, { address: '172.67.172.201', family: 4 }]);
        const v6 = await new Promise((resolve) =>
            dns.lookup('api.ergoplatform.com', { family: 6 }, (err) => resolve(err && (err as any).code)));
        expect(v6).toBe('ENOTFOUND');
    });

    it('keeps an explicit GOP_NODE_URI', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gop-celaut-'));
        process.env.CELAUT_CONFIG = join(dir, '__config__');
        writeFileSync(process.env.CELAUT_CONFIG, config);
        process.env.GOP_NODE_URI = 'http://127.0.0.1:9053';
        installCelautNetwork();
        expect(process.env.GOP_NODE_URI).toBe('http://127.0.0.1:9053');
    });
});
