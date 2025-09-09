import { writable } from 'svelte/store';
import type { AnyGame as Game } from './game';
import { type ReputationProof, type TypeNFT } from '$lib/ergo/reputation/objects';

export const address = writable<string|null>(null);
export const network = writable<string|null>(null);
export const connected = writable<boolean>(false);
export const balance = writable<number|null>(null);
export const game_detail = writable<Game|null>(null);
export const timer = writable<{countdownInterval: number, target: number}>({countdownInterval: 0, target: 0})
export const games = writable<Map<string, Game>>(new Map());
export const user_tokens = writable<Map<string, number>>(new Map());
export const types = writable<Map<string, TypeNFT>>(new Map());
export const reputation_proof = writable<ReputationProof|null>(null);