import { beforeEach, describe, expect, it } from "vitest";
import { KeyedMockChainParty, MockChain, NonKeyedMockChainParty } from "@fleet-sdk/mock-chain";
import {
    ErgoTree,
    OutputBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder
} from "@fleet-sdk/core";
import {
    SByte,
    SColl,
    SInt,
    SLong,
    SPair
} from "@fleet-sdk/serializer";
import { randomBytes } from "@fleet-sdk/crypto";
import { stringToBytes } from "@scure/base";
import { prependHexPrefix } from "$lib/utils";
import { hexToBytes } from "$lib/ergo/utils";
import {
    getGopParticipationErgoTree,
    getGopParticipationBatchErgoTree,
    getGopGameResolutionErgoTree
} from "$lib/ergo/contract";
import { DefaultGameConstants } from "$lib/common/constants";

const ERG_BASE_TOKEN = "";
const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD"; // Added to support the new tokenName property in baseModes

const baseModes = [
    { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

describe.each(baseModes)("Participation Batching - (%s)", (mode) => {
    const mockChain = new MockChain({ height: 800_000 });

    const participationErgoTree: ErgoTree = getGopParticipationErgoTree();
    const batchErgoTree: ErgoTree = getGopParticipationBatchErgoTree();
    const gameResolutionErgoTree: ErgoTree = getGopGameResolutionErgoTree();

    let resolver: KeyedMockChainParty;
    let creator: KeyedMockChainParty;
    let player1: KeyedMockChainParty;
    let player2: KeyedMockChainParty;

    const gameNftId = "c94a63ec4e9ae8700c671a908bd2121d4c049cec75a40f1309e09ab59d0bbc71";
    const participationFee = 100_000_000n;
    const seed = "a3f9b7e12c9d55ab8068e3ff22b7a19c34d8f1cbeaa1e9c0138b82f00d5ea712";
    const secret = stringToBytes("utf8", "game-secret");

    let participationContract: NonKeyedMockChainParty;
    let batchContract: NonKeyedMockChainParty;
    let gameResolutionContract: NonKeyedMockChainParty;

    beforeEach(() => {
        mockChain.reset({ clearParties: true });
        resolver = mockChain.newParty("Resolver");
        resolver.addBalance({
            nanoergs: 10_000_000_000n,
            tokens: mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: 1000000000n }] : []
        });
        creator = mockChain.newParty("Creator");
        player1 = mockChain.newParty("Player1");
        player2 = mockChain.newParty("Player2");

        participationContract = mockChain.addParty(participationErgoTree.toHex(), "ParticipationContract");
        batchContract = mockChain.addParty(batchErgoTree.toHex(), "BatchContract");
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolutionContract");

        // Setup Game Box in Resolution state
        const gameAssets = [
            { tokenId: gameNftId, amount: 1n },
            ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: 1000000n }] : [])
        ];
        const gameBoxValue = mode.token === ERG_BASE_TOKEN ? 1000000n : RECOMMENDED_MIN_FEE_VALUE;

        gameResolutionContract.addUTxOs({
            creationHeight: mockChain.height,
            value: gameBoxValue,
            ergoTree: gameResolutionErgoTree.toHex(),
            assets: gameAssets,
            additionalRegisters: {
                R4: SInt(1).toHex(), // Resolution state
                R5: SColl(SByte, hexToBytes(seed) || new Uint8Array(0)).toHex(),
                R6: SPair(SColl(SByte, secret), SColl(SByte, new Uint8Array(32))).toHex(), // No winner candidate yet
                R7: SColl(SColl(SByte), []).toHex(),
                R8: SColl(SLong, [1n, 20n, BigInt(mockChain.height + 500), 2_000_000_000n, participationFee, 10000n, 200000n, BigInt(mockChain.height + 1000)]).toHex(),
                R9: SColl(SColl(SByte), [
                    stringToBytes('utf8', "{}"),
                    mode.token !== ERG_BASE_TOKEN ? (hexToBytes(mode.token) || new Uint8Array(0)) : new Uint8Array(0),
                    prependHexPrefix(resolver.address.getPublicKeys()[0], "0008cd")
                ]).toHex()
            }
        });
    });

    const createParticipationBox = (player: KeyedMockChainParty, amount: bigint) => {
        const assets = mode.token === ERG_BASE_TOKEN ? [] : [{ tokenId: mode.token, amount }];
        const value = mode.token === ERG_BASE_TOKEN ? amount : RECOMMENDED_MIN_FEE_VALUE;
        const playerPK = prependHexPrefix(player.address.getPublicKeys()[0], "0008cd");

        participationContract.addUTxOs({
            value,
            assets,
            ergoTree: participationErgoTree.toHex(),
            creationHeight: mockChain.height,
            additionalRegisters: {
                R4: SColl(SByte, playerPK).toHex(),
                R5: SColl(SByte, randomBytes(32)).toHex(),
                R6: SColl(SByte, gameNftId).toHex(),
                R7: SColl(SByte, randomBytes(32)).toHex(),
                R8: SColl(SByte, randomBytes(32)).toHex(),
                R9: SColl(SLong, [100n]).toHex(),
            }
        });
    };

    const createBatchBox = (amount: bigint) => {
        const assets = mode.token === ERG_BASE_TOKEN ? [] : [{ tokenId: mode.token, amount }];
        const value = mode.token === ERG_BASE_TOKEN ? amount : RECOMMENDED_MIN_FEE_VALUE;

        batchContract.addUTxOs({
            value,
            assets,
            ergoTree: batchErgoTree.toHex(),
            creationHeight: mockChain.height,
            additionalRegisters: {
                R4: SColl(SByte, []).toHex(),
                R5: SColl(SByte, []).toHex(),
                R6: SColl(SByte, gameNftId).toHex(),
            }
        });
    };

    it("Should aggregate two participations into one batch (authorized by resolver)", () => {
        createParticipationBox(player1, participationFee);
        createParticipationBox(player2, participationFee);

        const gameBox = gameResolutionContract.utxos.toArray()[0];
        const pBoxes = participationContract.utxos.toArray();

        const totalAmount = participationFee * 2n;
        const outputAssets = mode.token === ERG_BASE_TOKEN ? [] : [{ tokenId: mode.token, amount: totalAmount }];
        const outputValue = mode.token === ERG_BASE_TOKEN ? totalAmount : RECOMMENDED_MIN_FEE_VALUE;

        const tx = new TransactionBuilder(mockChain.height)
            .from([...pBoxes, ...resolver.utxos.toArray()])
            .withDataFrom([gameBox])
            .to([
                new OutputBuilder(outputValue, batchContract.address)
                    .addTokens(outputAssets)
                    .setAdditionalRegisters({
                        R4: SColl(SByte, []).toHex(),
                        R5: SColl(SByte, []).toHex(),
                        R6: SColl(SByte, gameNftId).toHex()
                    })
            ])
            .sendChangeTo(resolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        expect(mockChain.execute(tx, { signers: [resolver as any] })).to.be.true;
        expect(batchContract.utxos.length).toBe(1);
        expect(participationContract.utxos.length).toBe(0);
    });

    it("Should aggregate a batch and a participation into a new batch", () => {
        createBatchBox(participationFee);
        createParticipationBox(player1, participationFee);

        const gameBox = gameResolutionContract.utxos.toArray()[0];
        const bBox = batchContract.utxos.toArray()[0];
        const pBox = participationContract.utxos.toArray()[0];

        const totalAmount = participationFee * 2n;
        const outputAssets = mode.token === ERG_BASE_TOKEN ? [] : [{ tokenId: mode.token, amount: totalAmount }];
        const outputValue = mode.token === ERG_BASE_TOKEN ? totalAmount : RECOMMENDED_MIN_FEE_VALUE;

        const tx = new TransactionBuilder(mockChain.height)
            .from([bBox, pBox, ...resolver.utxos.toArray()])
            .withDataFrom([gameBox])
            .to([
                new OutputBuilder(outputValue, batchContract.address)
                    .addTokens(outputAssets)
                    .setAdditionalRegisters({
                        R4: SColl(SByte, []).toHex(),
                        R5: SColl(SByte, []).toHex(),
                        R6: SColl(SByte, gameNftId).toHex()
                    })
            ])
            .sendChangeTo(resolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        expect(mockChain.execute(tx, { signers: [resolver as any] })).to.be.true;
        expect(batchContract.utxos.length).toBe(1);
        expect(participationContract.utxos.length).toBe(0);
    });

    it("Should fail if there are two output batches", () => {
        createParticipationBox(player1, participationFee);
        createParticipationBox(player2, participationFee);

        const gameBox = gameResolutionContract.utxos.toArray()[0];
        const pBoxes = participationContract.utxos.toArray();

        const tx = new TransactionBuilder(mockChain.height)
            .from([...pBoxes, ...resolver.utxos.toArray()])
            .withDataFrom([gameBox])
            .to([
                new OutputBuilder(participationFee, batchContract.address)
                    .setAdditionalRegisters({
                        R4: SColl(SByte, []).toHex(),
                        R5: SColl(SByte, []).toHex(),
                        R6: SColl(SByte, gameNftId).toHex()
                    }),
                new OutputBuilder(participationFee, batchContract.address)
                    .setAdditionalRegisters({
                        R4: SColl(SByte, []).toHex(),
                        R5: SColl(SByte, []).toHex(),
                        R6: SColl(SByte, gameNftId).toHex()
                    })
            ])
            .sendChangeTo(resolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        expect(() => mockChain.execute(tx, { signers: [resolver as any] })).to.throw();
    });

    it("Should fail if output value is less than input value", () => {
        createParticipationBox(player1, participationFee);
        createParticipationBox(player2, participationFee);

        const gameBox = gameResolutionContract.utxos.toArray()[0];
        const pBoxes = participationContract.utxos.toArray();

        const insufficientAmount = participationFee; // Should be 2 * participationFee
        const outputAssets = mode.token === ERG_BASE_TOKEN ? [] : [{ tokenId: mode.token, amount: insufficientAmount }];
        const outputValue = mode.token === ERG_BASE_TOKEN ? insufficientAmount : RECOMMENDED_MIN_FEE_VALUE;

        const tx = new TransactionBuilder(mockChain.height)
            .from([...pBoxes, ...resolver.utxos.toArray()])
            .withDataFrom([gameBox])
            .to([
                new OutputBuilder(outputValue, batchContract.address)
                    .addTokens(outputAssets)
                    .setAdditionalRegisters({
                        R4: SColl(SByte, []).toHex(),
                        R5: SColl(SByte, []).toHex(),
                        R6: SColl(SByte, gameNftId).toHex()
                    })
            ])
            .sendChangeTo(resolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        expect(() => mockChain.execute(tx, { signers: [resolver as any] })).to.throw();
    });
});
