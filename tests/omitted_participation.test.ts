import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
    Box,
    OutputBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder
} from "@fleet-sdk/core";
import {
    SByte,
    SColl,
    SLong,
    SPair,
    SInt,
    SGroupElement
} from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";
import { bigintToLongByteArray } from "$lib/ergo/utils";
import { PARTICIPATION } from "$lib/ergo/reputation/types";
import { prependHexPrefix } from "$lib/utils";

// --- Utility and Constants Setup ---
const contractsDir = path.resolve(__dirname, "..", "contracts");
const GAME_RESOLUTION_TEMPLATE = fs.readFileSync(path.join(contractsDir, "game_resolution.es"), "utf-8");
const PARTICIPATION_SOURCE = fs.readFileSync(path.join(contractsDir, "participation.es"), "utf-8");
const DEV_ADDR_BASE58 = "9ejNy2qoifmzfCiDtEiyugthuXMriNNPhNKzzwjPtHnrK3esvbD";

// Helper to create a commitment hash
const createCommitment = (solverId: string, score: bigint, logs: string, secret: Uint8Array): Uint8Array => {
    return blake2b256(new Uint8Array([...stringToBytes("utf8", solverId), ...bigintToLongByteArray(score), ...stringToBytes("utf8", logs), ...secret]));
};

describe("Omitted Participation Inclusion (updated rules)", () => {
    let mockChain: MockChain;

    // --- Actors ---
    let originalResolver: ReturnType<MockChain["newParty"]>;
    let newResolver: ReturnType<MockChain["newParty"]>;
    let currentWinnerPlayer: ReturnType<MockChain["newParty"]>;
    let omittedPlayer: ReturnType<MockChain["newParty"]>;

    // --- Contracts & Parties ---
    let gameResolutionContract: ReturnType<MockChain["addParty"]>;
    let participationContract: ReturnType<MockChain["addParty"]>;
    
    // --- Contract ErgoTrees ---
    let gameResolutionErgoTree: ReturnType<typeof compile>;
    let participationErgoTree: ReturnType<typeof compile>;

    // --- Game State Variables ---
    const resolutionDeadline = 800_200;
    const gameNftId = "22ccdd22ccdd22ccdd22ccdd22ccdd22ccdd22ccdd22ccdd22ccdd22ccdd22";
    const secret = stringToBytes("utf8", "shared-secret-for-omitted-test");
    const game_deadline = 700_700n;

    let gameResolutionBox: Box;
    let currentWinnerBox: Box;
    let omittedParticipantBox: Box;
    
    let winnerCommitment: Uint8Array;
    let omittedCommitment: Uint8Array;

    beforeEach(() => {
        mockChain = new MockChain({ height: 800_000 });

        originalResolver = mockChain.newParty("OriginalResolver");
        newResolver = mockChain.newParty("NewResolver");
        currentWinnerPlayer = mockChain.newParty("CurrentWinner");
        omittedPlayer = mockChain.newParty("OmittedPlayer");

        newResolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 3n });

        participationErgoTree = compile(PARTICIPATION_SOURCE);
        const participationHash = Buffer.from(blake2b256(participationErgoTree.bytes)).toString("hex");

        const resolutionSource = GAME_RESOLUTION_TEMPLATE
            .replace("`+PARTICIPATION_SCRIPT_HASH+`", participationHash)
            .replace("`+REPUTATION_PROOF_SCRIPT_HASH+`", "0".repeat(64))
            .replace("`+PARTICIPATION_TYPE_ID+`", PARTICIPATION)
            .replace("`+DEV_ADDR+`", DEV_ADDR_BASE58);

        gameResolutionErgoTree = compile(resolutionSource);

        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");
    });

    afterEach(() => {
        mockChain.reset({ clearParties: true });
    });

    const setupScenario = (winnerScore: bigint, omittedScore: bigint, omittedCreationHeight: number = 600_000) => {
        winnerCommitment = createCommitment("solver-winner", winnerScore, "logs-winner", secret);
        omittedCommitment = createCommitment("solver-omitted", omittedScore, "logs-omitted", secret);

        const numericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 1n];

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 10,
            additionalRegisters: {
                R4: SInt(1).toHex(),
                R5: SPair(SColl(SByte, secret), SColl(SByte, winnerCommitment)).toHex(),
                R6: SColl(SColl(SByte), []).toHex(),
                R7: SColl(SLong, numericalParams).toHex(),
                R8: SPair(SColl(SByte, prependHexPrefix(originalResolver.key.publicKey, "0008cd")), SLong(10n)).toHex(),
                R9: SPair(SColl(SByte, prependHexPrefix(originalResolver.key.publicKey, "0008cd")), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        participationContract.addUTxOs({
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: 600_000,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte,  currentWinnerPlayer.address.getPublicKeys()[0]).toHex(),
                R5: SColl(SByte, winnerCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-winner")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-winner")).toHex(),
                R9: SColl(SLong, [winnerScore]).toHex(),
            }
        });
        currentWinnerBox = participationContract.utxos.toArray()[0];

        participationContract.addUTxOs({
            ergoTree: participationErgoTree.toHex(),
            assets: [],
            value: 1_000_000n,
            creationHeight: omittedCreationHeight,
            additionalRegisters: {
                R4: SColl(SByte,  omittedPlayer.address.getPublicKeys()[0]).toHex(),
                R5: SColl(SByte, omittedCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-omitted")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-omitted")).toHex(),
                R9: SColl(SLong, [omittedScore]).toHex(),
            }
        });
        omittedParticipantBox = participationContract.utxos.toArray()[1];

        mockChain.newBlocks(10);
    };

    it("should include an omitted participant who becomes the new winner", () => {
        setupScenario(1000n, 1200n);

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(),
                        R8: SPair(SColl(SByte, prependHexPrefix(newResolver.key.publicKey, "0008cd")), SLong(10n)).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            .withDataFrom([currentWinnerBox, omittedParticipantBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const result = mockChain.execute(tx, { signers: [newResolver] });
        expect(result).to.be.true;

        const newGameBox = gameResolutionContract.utxos.toArray()[0];
        expect(newGameBox.additionalRegisters.R5).to.equal(SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex());
        expect(newGameBox.additionalRegisters.R7).to.equal(SColl(SLong, updatedNumericalParams).toHex());
        expect(newGameBox.additionalRegisters.R8).to.contain(Buffer.from(newResolver.key.publicKey).toString("hex"));
    });

    it("should fail with an omitted participant who is not the new winner", () => {
        setupScenario(1000n, 800n);

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(),
                        R8: SPair(SColl(SByte, prependHexPrefix(newResolver.key.publicKey, "0008cd")), SLong(10n)).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            .withDataFrom([currentWinnerBox, omittedParticipantBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const result = mockChain.execute(tx, { signers: [newResolver], throw: false });
        expect(result).to.be.false;
    });

    it("should fail if the omitted participation was submitted after the game deadline", () => {
        const lateCreationHeight = Number(game_deadline) + 1;
        setupScenario(1000n, 1200n, lateCreationHeight);

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(),
                        R8: SPair(SColl(SByte, prependHexPrefix(newResolver.key.publicKey, "0008cd")), SLong(10n)).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            .withDataFrom([currentWinnerBox, omittedParticipantBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const result = mockChain.execute(tx, { signers: [newResolver], throw: false });
        expect(result).to.be.false;
    });

    it("should set the omitted participant as the winner when there is no current winner", () => {
        omittedCommitment = createCommitment("solver-omitted", 1000n, "logs-omitted", secret);

        const initialNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 0n];

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 10,
            additionalRegisters: {
                R4: SInt(1).toHex(),
                R5: SPair(SColl(SByte, secret), SColl(SByte, [])).toHex(),
                R6: SColl(SColl(SByte), []).toHex(),
                R7: SColl(SLong, initialNumericalParams).toHex(),
                R8: SPair(SColl(SByte, prependHexPrefix(originalResolver.key.publicKey, "0008cd")), SLong(10n)).toHex(),
                R9: SPair(SColl(SByte, prependHexPrefix(originalResolver.key.publicKey, "0008cd")), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        participationContract.addUTxOs({
            ergoTree: participationErgoTree.toHex(),
            assets: [],
            value: 1_000_000n,
            creationHeight: 600_000,
            additionalRegisters: {
                R4: SColl(SByte,  omittedPlayer.address.getPublicKeys()[0]).toHex(),
                R5: SColl(SByte, omittedCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-omitted")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-omitted")).toHex(),
                R9: SColl(SLong, [1000n]).toHex(),
            }
        });
        omittedParticipantBox = participationContract.utxos.toArray()[0];

        mockChain.newBlocks(10);

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 1n];

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(),
                        R8: SPair(SColl(SByte, prependHexPrefix(newResolver.key.publicKey, "0008cd")), SLong(10n)).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            .withDataFrom([omittedParticipantBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const result = mockChain.execute(tx, { signers: [newResolver] });
        expect(result).to.be.true;

        const newGameBox = gameResolutionContract.utxos.toArray()[0];
        expect(newGameBox.additionalRegisters.R5).to.equal(SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex());
        expect(newGameBox.additionalRegisters.R7).to.equal(SColl(SLong, updatedNumericalParams).toHex());
        expect(newGameBox.additionalRegisters.R8).to.contain(Buffer.from(newResolver.key.publicKey).toString("hex"));
    });

    it("should include an omitted participant that has the same score as the current winner (but was submitted earlier)", () => {
        // Setup with same scores (1000n) but omitted participant created earlier
        const earlierCreationHeight = 500_000; // Earlier than the default 600_000
        setupScenario(1000n, 1000n, earlierCreationHeight);

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(),
                        R8: SPair(SColl(SByte, prependHexPrefix(newResolver.key.publicKey, "0008cd")), SLong(10n)).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            .withDataFrom([currentWinnerBox, omittedParticipantBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const result = mockChain.execute(tx, { signers: [newResolver] });
        expect(result).to.be.true;

        const newGameBox = gameResolutionContract.utxos.toArray()[0];
        expect(newGameBox.additionalRegisters.R5).to.equal(SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex());
        expect(newGameBox.additionalRegisters.R7).to.equal(SColl(SLong, updatedNumericalParams).toHex());
        expect(newGameBox.additionalRegisters.R8).to.contain(Buffer.from(newResolver.key.publicKey).toString("hex"));
    });

    it("should fail if an omitted participant has the same score as the current winner but was submitted later", () => {
        // Setup with same scores (1000n) but omitted participant created later
        const laterCreationHeight = 650_000; // Later than the default 600_000 used for currentWinnerBox
        setupScenario(1000n, 1000n, laterCreationHeight);

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(),
                        R8: SPair(SColl(SByte, prependHexPrefix(newResolver.key.publicKey, "0008cd")), SLong(10n)).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            .withDataFrom([currentWinnerBox, omittedParticipantBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const result = mockChain.execute(tx, { signers: [newResolver], throw: false });
        expect(result).to.be.false;
    });

    it("should fail if the omitted participant has a commitment created with a fake secret", () => {
        // Create a fake secret and use it to create a fake commitment
        const fakeSecret = stringToBytes("utf8", "fake-secret-for-cheating");
        const fakeCommitment = createCommitment("solver-omitted", 1200n, "logs-omitted", fakeSecret);

        // Setup the current winner normally
        winnerCommitment = createCommitment("solver-winner", 1000n, "logs-winner", secret);

        const numericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 1n];

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 10,
            additionalRegisters: {
                R4: SInt(1).toHex(),
                R5: SPair(SColl(SByte, secret), SColl(SByte, winnerCommitment)).toHex(),
                R6: SColl(SColl(SByte), []).toHex(),
                R7: SColl(SLong, numericalParams).toHex(),
                R8: SPair(SColl(SByte, originalResolver.key.publicKey), SLong(10n)).toHex(),
                R9: SPair(SColl(SByte, originalResolver.key.publicKey), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        participationContract.addUTxOs({
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 10,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte,  currentWinnerPlayer.address.getPublicKeys()[0]).toHex(),
                R5: SColl(SByte, winnerCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-winner")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-winner")).toHex(),
                R9: SColl(SLong, [1000n]).toHex(),
            }
        });
        currentWinnerBox = participationContract.utxos.toArray()[0];

        // Create the omitted participant box with the fake commitment
        participationContract.addUTxOs({
            ergoTree: participationErgoTree.toHex(),
            assets: [],
            value: 1_000_000n,
            creationHeight: 600_000,
            additionalRegisters: {
                R4: SColl(SByte,  omittedPlayer.address.getPublicKeys()[0]).toHex(),
                R5: SColl(SByte, fakeCommitment).toHex(), // Using fake commitment here
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-omitted")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-omitted")).toHex(),
                R9: SColl(SLong, [1200n]).toHex(),
            }
        });
        omittedParticipantBox = participationContract.utxos.toArray()[1];

        mockChain.newBlocks(10);

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, fakeCommitment)).toHex(), // Using the real secret but fake commitment
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(),
                        R8: SPair(SColl(SByte, prependHexPrefix(newResolver.key.publicKey, "0008cd")), SLong(10n)).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            .withDataFrom([currentWinnerBox, omittedParticipantBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const result = mockChain.execute(tx, { signers: [newResolver], throw: false });
        expect(result).to.be.false;
    });

    it("should fail if the secret revealed does not match the commitment of the omitted participant", () => {
        setupScenario(1000n, 1200n);

        // Use a different secret that won't match the omitted participant's commitment
        const wrongSecret = stringToBytes("utf8", "wrong-secret-for-omitted-test");
        
        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, wrongSecret), SColl(SByte, omittedCommitment)).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(),
                        R8: SPair(SColl(SByte, prependHexPrefix(newResolver.key.publicKey, "0008cd")), SLong(10n)).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            .withDataFrom([currentWinnerBox, omittedParticipantBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const result = mockChain.execute(tx, { signers: [newResolver], throw: false });
        expect(result).to.be.false;
    });

    it("should fail if the omitted participant has incorrect gameNftId", () => {
        setupScenario(1000n, 1200n);

        // Create a new omitted participant box with wrong gameNftId
        const wrongGameNftId = "33ddee33ddee33ddee33ddee33ddee33ddee33ddee33ddee33ddee33ddee33";
        
        participationContract.addUTxOs({
            ergoTree: participationErgoTree.toHex(),
            assets: [],
            value: 1_000_000n,
            creationHeight: 600_000,
            additionalRegisters: {
                R4: SColl(SByte,  omittedPlayer.address.getPublicKeys()[0]).toHex(),
                R5: SColl(SByte, omittedCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", wrongGameNftId)).toHex(), // Wrong gameNftId
                R7: SColl(SByte, stringToBytes("utf8", "solver-omitted")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-omitted")).toHex(),
                R9: SColl(SLong, [1200n]).toHex(),
            }
        });
        const wrongGameParticipantBox = participationContract.utxos.toArray()[2]; // Third box

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(),
                        R8: SPair(SColl(SByte, prependHexPrefix(newResolver.key.publicKey, "0008cd")), SLong(10n)).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            .withDataFrom([currentWinnerBox, wrongGameParticipantBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const result = mockChain.execute(tx, { signers: [newResolver], throw: false });
        expect(result).to.be.false;
    });

    it("should fail if omitted participant's commitment doesn't match its stored data", () => {
        setupScenario(1000n, 1200n);

        // Create a commitment that doesn't match the stored data
        const inconsistentCommitment = createCommitment("different-solver", 1200n, "logs-omitted", secret);

        // Create omitted participant with inconsistent data
        participationContract.addUTxOs({
            ergoTree: participationErgoTree.toHex(),
            assets: [],
            value: 1_000_000n,
            creationHeight: 600_000,
            additionalRegisters: {
                R4: SColl(SByte,  omittedPlayer.address.getPublicKeys()[0]).toHex(),
                R5: SColl(SByte, inconsistentCommitment).toHex(), // Doesn't match the solver name below
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-omitted")).toHex(), // Different from commitment
                R8: SColl(SByte, stringToBytes("utf8", "logs-omitted")).toHex(),
                R9: SColl(SLong, [1200n]).toHex(),
            }
        });
        const inconsistentParticipantBox = participationContract.utxos.toArray()[2];

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, inconsistentCommitment)).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(),
                        R8: SPair(SColl(SByte, prependHexPrefix(newResolver.key.publicKey, "0008cd")), SLong(10n)).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            .withDataFrom([currentWinnerBox, inconsistentParticipantBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const result = mockChain.execute(tx, { signers: [newResolver], throw: false });
        expect(result).to.be.false;
    });

    it("should fail if trying to include omitted participant after resolution deadline", () => {
        setupScenario(1000n, 1200n);

        // Move chain past the resolution deadline
        mockChain.newBlocks(300); // Now at 800_310, past the deadline of 800_200

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(),
                        R8: SPair(SColl(SByte, prependHexPrefix(newResolver.key.publicKey, "0008cd")), SLong(10n)).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            .withDataFrom([currentWinnerBox, omittedParticipantBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const result = mockChain.execute(tx, { signers: [newResolver], throw: false });
        expect(result).to.be.false;
    });

    it("should handle omitted participant with zero score correctly", () => {
        setupScenario(1000n, 0n); // Current winner: 1000, Omitted: 0

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(),
                        R8: SPair(SColl(SByte, prependHexPrefix(newResolver.key.publicKey, "0008cd")), SLong(10n)).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            .withDataFrom([currentWinnerBox, omittedParticipantBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        // Should fail because omitted participant has lower score
        const result = mockChain.execute(tx, { signers: [newResolver], throw: false });
        expect(result).to.be.false;
    });

    it("should pass if the omitted participant has 10 scores", () => {
        setupScenario(1000n, 1200n);
        
        participationContract.addUTxOs({
            ergoTree: participationErgoTree.toHex(),
            assets: [],
            value: 1_000_000n,
            creationHeight: 600_000,
            additionalRegisters: {
                R4: SColl(SByte,  omittedPlayer.address.getPublicKeys()[0]).toHex(),
                R5: SColl(SByte, omittedCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(), // Wrong gameNftId
                R7: SColl(SByte, stringToBytes("utf8", "solver-omitted")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-omitted")).toHex(),
                R9: SColl(SLong, [1200n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]).toHex(),
            }
        });
        const wrongGameParticipantBox = participationContract.utxos.toArray()[2]; // Third box

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(),
                        R8: SPair(SColl(SByte, prependHexPrefix(newResolver.key.publicKey, "0008cd")), SLong(10n)).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            .withDataFrom([currentWinnerBox, wrongGameParticipantBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const result = mockChain.execute(tx, { signers: [newResolver] });
        expect(result).to.be.true;
    });

    it("should fail if the omitted participant has more than 10 scores", () => {
        setupScenario(1000n, 1200n);
        
        participationContract.addUTxOs({
            ergoTree: participationErgoTree.toHex(),
            assets: [],
            value: 1_000_000n,
            creationHeight: 600_000,
            additionalRegisters: {
                R4: SColl(SByte,  omittedPlayer.address.getPublicKeys()[0]).toHex(),
                R5: SColl(SByte, omittedCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(), // Wrong gameNftId
                R7: SColl(SByte, stringToBytes("utf8", "solver-omitted")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-omitted")).toHex(),
                R9: SColl(SLong, [1200n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n]).toHex(),
            }
        });
        const wrongGameParticipantBox = participationContract.utxos.toArray()[2]; // Third box

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(),
                        R8: SPair(SColl(SByte, prependHexPrefix(newResolver.key.publicKey, "0008cd")), SLong(10n)).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            .withDataFrom([currentWinnerBox, wrongGameParticipantBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const result = mockChain.execute(tx, { signers: [newResolver], throw: false });
        expect(result).to.be.false;
    });

});
