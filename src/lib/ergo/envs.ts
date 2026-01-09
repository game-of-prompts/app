
import { writable } from 'svelte/store';

export const network_id: "mainnet" | "testnet" = "mainnet";

export const default_explorer_uri = (network_id == "mainnet") ? "https://api.ergoplatform.com" : "https://api-testnet.ergoplatform.com";
export const default_web_explorer_uri_tx = (network_id == "mainnet") ? "https://sigmaspace.io/en/transaction/" : "https://testnet.ergoplatform.com/transactions/";
export const default_web_explorer_uri_addr = (network_id == "mainnet") ? "https://sigmaspace.io/en/address/" : "https://testnet.ergoplatform.com/addresses/";
export const default_web_explorer_uri_tkn = (network_id == "mainnet") ? "https://sigmaspace.io/en/token/" : "https://testnet.ergoplatform.com/tokens/";

export const explorer_uri = writable<string>(default_explorer_uri);
export const web_explorer_uri_tx = writable<string>(default_web_explorer_uri_tx);
export const web_explorer_uri_addr = writable<string>(default_web_explorer_uri_addr);
export const web_explorer_uri_tkn = writable<string>(default_web_explorer_uri_tkn);
export const REPUTATION_PROOF_TOTAL_SUPPLY = 100_000_000;
export const CACHE_DURATION_MS = 10000; // 10 seconds
export const isDevMode = writable<boolean>(false);