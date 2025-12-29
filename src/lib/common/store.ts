import { writable } from 'svelte/store';
import type { AnyGame as Game } from './game';
import { type ReputationProof, type TypeNFT } from 'reputation-system';

export const address = writable<string | null>(null);
export const network = writable<string | null>(null);
export const connected = writable<boolean>(false);
export const balance = writable<number | null>(null);
export const game_detail = writable<Game | null>(null);
export const judge_detail = writable<ReputationProof | null>(null);
export const timer = writable<{ countdownInterval: number, target: number }>({ countdownInterval: 0, target: 0 })
export const games = writable<{ data: Map<string, Game>, last_fetch: number }>({
    data: new Map(),
    last_fetch: 0
})
export const user_tokens = writable<Map<string, number>>(new Map());
export const types = writable<{ data: Map<string, TypeNFT>; last_fetch: number }>({
    data: new Map(),
    last_fetch: 0
});
export const reputation_proof = writable<ReputationProof | null>(null);
export const judges = writable<{ data: Map<string, ReputationProof>; last_fetch: number }>({
    data: new Map(),
    last_fetch: 0
})