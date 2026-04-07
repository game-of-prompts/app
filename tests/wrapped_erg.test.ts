import { describe, expect, it } from "vitest";
import { SColl, SByte } from "@fleet-sdk/serializer";
import { WrappedErgManager } from "wrapped-erg";
import { isWrappedErgBankBoxCandidate } from "$lib/ergo/wrapped-erg";

describe("Wrapped ERG helper", () => {
    const wergTokenId =
        "22".repeat(32);

    it("accepts a bank box whose ergoTree matches the wrapped-erg contract", () => {
        const ergoTree = WrappedErgManager.compileBankContract();

        expect(
            isWrappedErgBankBoxCandidate(
                {
                    boxId: "box-id",
                    value: 1_000_000_000,
                    ergoTree,
                    assets: [
                        { tokenId: wergTokenId, amount: 1_000_000_000 },
                    ],
                    additionalRegisters: {
                        R4: {
                            renderedValue: wergTokenId,
                        },
                    },
                },
                wergTokenId,
            ),
        ).toBe(true);
    });

    it("rejects boxes whose R4 token does not match the bank token", () => {
        const ergoTree = WrappedErgManager.compileBankContract();

        expect(
            isWrappedErgBankBoxCandidate(
                {
                    ergoTree,
                    assets: [
                        { tokenId: wergTokenId, amount: 1_000_000_000 },
                    ],
                    additionalRegisters: {
                        R4: {
                            serializedValue: SColl(
                                SByte,
                                new Uint8Array(32).fill(0x33),
                            ).toHex(),
                        },
                    },
                },
                wergTokenId,
            ),
        ).toBe(false);
    });
});
