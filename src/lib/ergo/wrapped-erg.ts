import { get } from "svelte/store";
import {
    WrappedErgManager,
    listWrappedErgBanks,
    type WrappedErgBankSummary,
} from "wrapped-erg";
import { explorer_uri } from "$lib/ergo/envs";
import { parseCollByteToHex, serializedToRendered } from "$lib/ergo/utils";

declare const ergo: any;

export const WRAPPED_ERG_OPTION_ID = "__wrapped_erg__";
const BALANCE_POLL_INTERVAL_MS = 1500;
const BALANCE_POLL_ATTEMPTS = 10;

type ExplorerAssetLike = {
    tokenId?: string;
    amount?: string | number | bigint;
};

type ExplorerBoxLike = {
    boxId?: string;
    value?: string | number | bigint;
    ergoTree?: string;
    assets?: ExplorerAssetLike[];
    additionalRegisters?: Record<
        string,
        | string
        | {
              renderedValue?: unknown;
              serializedValue?: string;
          }
        | undefined
    >;
    creationHeight?: number;
    transactionId?: string;
    index?: number;
};

function normalizeExplorerApiBase(base: string): string {
    const trimmed = base.replace(/\/+$/, "");
    return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

function toBigIntSafe(value: unknown): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(Math.trunc(value));
    if (typeof value === "string" && value.trim()) return BigInt(value.trim());
    return 0n;
}

function readCollByteRegisterHex(
    register:
        | string
        | {
              renderedValue?: unknown;
              serializedValue?: string;
          }
        | undefined,
): string | null {
    if (!register) return null;

    if (typeof register === "string") {
        return (
            parseCollByteToHex(serializedToRendered(register)) ??
            parseCollByteToHex(register)
        );
    }

    return (
        parseCollByteToHex(register.renderedValue) ??
        (typeof register.serializedValue === "string"
            ? parseCollByteToHex(serializedToRendered(register.serializedValue)) ??
              parseCollByteToHex(register.serializedValue)
            : null)
    );
}

export function getWrappedErgWalletAdapter() {
    if (typeof ergo === "undefined") {
        throw new Error("Wallet not connected.");
    }

    return {
        getUtxos: async () => (await ergo.get_utxos()) ?? [],
        getChangeAddress: async () => {
            const address = await ergo.get_change_address();
            if (!address) throw new Error("Could not get change address.");
            return address;
        },
        signTx: async (unsignedTx: unknown) => {
            const signed = await ergo.sign_tx(unsignedTx);
            if (!signed) throw new Error("The user canceled the signature.");
            return signed;
        },
    };
}

export function isWrappedErgBankBoxCandidate(
    box: ExplorerBoxLike | null | undefined,
    wergTokenId: string,
): boolean {
    if (!box?.ergoTree || !Array.isArray(box.assets) || box.assets.length !== 1) {
        return false;
    }

    const wergToken = box.assets[0]?.tokenId;
    const allowedWergTokenId = readCollByteRegisterHex(
        box.additionalRegisters?.R4,
    );
    if (!wergToken || wergToken !== wergTokenId || allowedWergTokenId !== wergTokenId) {
        return false;
    }

    const expectedTree = WrappedErgManager.compileBankContract();
    return expectedTree === box.ergoTree;
}

function bankFromBox(
    box: ExplorerBoxLike,
    wergTokenId: string,
): WrappedErgBankSummary {
    return {
        boxId: box.boxId ?? "",
        ergReserve: toBigIntSafe(box.value),
        wergReserve: toBigIntSafe(box.assets?.[0]?.amount),
        ergoTree: box.ergoTree ?? "",
        wergTokenId,
    };
}

export async function getValidWrappedErgBanks(): Promise<
    WrappedErgBankSummary[]
> {
    const banks = await listWrappedErgBanks();
    const expectedTree = WrappedErgManager.compileBankContract();

    return banks.filter(
        (bank) =>
            !!bank.wergTokenId &&
            (((bank as { ergoTree?: string }).ergoTree ?? expectedTree) ===
                expectedTree),
    );
}

export async function getDefaultWrappedErgBank(): Promise<WrappedErgBankSummary | null> {
    const banks = await getValidWrappedErgBanks();
    return banks[0] ?? null;
}

export async function resolveWrappedErgBankByTokenId(
    wergTokenId: string,
): Promise<WrappedErgBankSummary | null> {
    if (!wergTokenId) return null;

    try {
        const discoveredBanks = await getValidWrappedErgBanks();
        const discoveredMatch =
            discoveredBanks.find((bank) => bank.wergTokenId === wergTokenId) ??
            null;
        if (discoveredMatch) return discoveredMatch;
    } catch (error) {
        console.warn("Wrapped ERG bank discovery failed, using token fallback", error);
    }

    const apiBase = normalizeExplorerApiBase(get(explorer_uri));
    const response = await fetch(
        `${apiBase}/boxes/unspent/byTokenId/${wergTokenId}?limit=50&offset=0`,
    );
    if (!response.ok) {
        throw new Error("Could not resolve the Wrapped ERG bank from explorer.");
    }

    const data = await response.json();
    const items: ExplorerBoxLike[] = Array.isArray(data?.items) ? data.items : [];
    const bankBox = items.find((box) =>
        isWrappedErgBankBoxCandidate(box, wergTokenId),
    );

    return bankBox ? bankFromBox(bankBox, wergTokenId) : null;
}

export async function fetchWrappedErgBankBoxByTokenId(
    wergTokenId: string,
): Promise<ExplorerBoxLike | null> {
    if (!wergTokenId) return null;

    const apiBase = normalizeExplorerApiBase(get(explorer_uri));
    const response = await fetch(
        `${apiBase}/boxes/unspent/byTokenId/${wergTokenId}?limit=50&offset=0`,
    );
    if (!response.ok) {
        throw new Error("Could not fetch the Wrapped ERG bank box from explorer.");
    }

    const data = await response.json();
    const items: ExplorerBoxLike[] = Array.isArray(data?.items) ? data.items : [];
    return (
        items.find((box) => isWrappedErgBankBoxCandidate(box, wergTokenId)) ??
        null
    );
}

export async function getTokenBalance(tokenId: string): Promise<bigint> {
    if (typeof ergo === "undefined") {
        throw new Error("Wallet not connected.");
    }

    const balance = tokenId
        ? await ergo.get_balance(tokenId)
        : await ergo.get_balance();
    return toBigIntSafe(balance);
}

async function waitForTokenBalance(
    tokenId: string,
    minimumBalance: bigint,
): Promise<void> {
    for (let attempt = 0; attempt < BALANCE_POLL_ATTEMPTS; attempt += 1) {
        const current = await getTokenBalance(tokenId);
        if (current >= minimumBalance) return;

        await new Promise((resolve) =>
            setTimeout(resolve, BALANCE_POLL_INTERVAL_MS),
        );
    }

    throw new Error(
        "The wrap transaction was sent, but the new Wrapped ERG balance is not available yet. Please retry in a few seconds.",
    );
}

export async function ensureWrappedErgBalance(params: {
    wergTokenId: string;
    amountNeeded: bigint;
}): Promise<{
    bank: WrappedErgBankSummary;
    wrapped: boolean;
    wrapTxId?: string;
}> {
    const bank = await resolveWrappedErgBankByTokenId(params.wergTokenId);
    if (!bank) {
        throw new Error(
            "This competition uses Wrapped ERG, but its bank could not be resolved on-chain.",
        );
    }

    const currentBalance = await getTokenBalance(params.wergTokenId);
    if (currentBalance >= params.amountNeeded) {
        return { bank, wrapped: false };
    }

    const missingAmount = params.amountNeeded - currentBalance;
    const manager = new WrappedErgManager(
        getWrappedErgWalletAdapter(),
        bank.wergTokenId,
    );
    const wrapTxId = await manager.wrap(missingAmount);

    await waitForTokenBalance(params.wergTokenId, params.amountNeeded);

    return { bank, wrapped: true, wrapTxId };
}
