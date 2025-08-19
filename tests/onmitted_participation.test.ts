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
    SInt // <-- Importar SInt
} from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";
import { bigintToLongByteArray } from "$lib/ergo/utils";

// --- Utility and Constants Setup ---
const contractsDir = path.resolve(__dirname, "..", "contracts");
const GAME_RESOLUTION_TEMPLATE = fs.readFileSync(path.join(contractsDir, "game_resolution.es"), "utf-8");
const PARTICIPATION_SUBMITTED_TEMPLATE = fs.readFileSync(path.join(contractsDir, "participation_submited.es"), "utf-8");
const PARTICIPATION_RESOLVED_SOURCE = fs.readFileSync(path.join(contractsDir, "participation_resolved.es"), "utf-8");
const DEV_ADDR_BASE58 = "9ejNy2qoifmzfCiDtEiyugthuXMriNNPhNKzzwjPtHnrK3esvbD";

// Helper to create a commitment hash
const createCommitment = (solverId: string, score: bigint, logs: string, secret: Uint8Array): Uint8Array => {
    return blake2b256(new Uint8Array([...stringToBytes("utf8", solverId), ...bigintToLongByteArray(score), ...stringToBytes("utf8", logs), ...secret]));
};

describe("Omitted Participation Inclusion", () => {
    let mockChain: MockChain;

    // --- Actors ---
    let originalResolver: ReturnType<MockChain["newParty"]>;
    let newResolver: ReturnType<MockChain["newParty"]>;
    let currentWinnerPlayer: ReturnType<MockChain["newParty"]>;
    let omittedPlayer: ReturnType<MockChain["newParty"]>;

    // --- Contracts & Parties ---
    let gameResolutionContract: ReturnType<MockChain["newParty"]>;
    let participationSubmittedContract: ReturnType<MockChain["newParty"]>;
    let participationResolvedContract: ReturnType<MockChain["newParty"]>;
    
    // --- Contract ErgoTrees ---
    let gameResolutionErgoTree: ReturnType<typeof compile>;
    let participationSubmittedErgoTree: ReturnType<typeof compile>;
    let participationResolvedErgoTree: ReturnType<typeof compile>;

    // --- Game State Variables ---
    const resolutionDeadline = 800_200;
    const gameNftId = "22ccdd22ccdd22ccdd22ccdd22ccdd22ccdd22ccdd22ccdd22ccdd22ccdd22";
    const secret = stringToBytes("utf8", "shared-secret-for-omitted-test");

    let gameResolutionBox: Box;
    let currentWinnerBox: Box; // The already resolved box
    let omittedParticipantBox: Box; // The submitted box to be included

    beforeEach(() => {
        mockChain = new MockChain({ height: 800_000 });

        // --- Initialize Actors ---
        originalResolver = mockChain.newParty("OriginalResolver");
        newResolver = mockChain.newParty("NewResolver");
        currentWinnerPlayer = mockChain.newParty("CurrentWinner");
        omittedPlayer = mockChain.newParty("OmittedPlayer");

        newResolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

        // --- Compile Contracts ---
        participationResolvedErgoTree = compile(PARTICIPATION_RESOLVED_SOURCE);
        const resolvedHash = Buffer.from(blake2b256(participationResolvedErgoTree.bytes)).toString("hex");
        
        const submittedSource = PARTICIPATION_SUBMITTED_TEMPLATE.replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", resolvedHash);
        participationSubmittedErgoTree = compile(submittedSource);
        const submittedHash = Buffer.from(blake2b256(participationSubmittedErgoTree.bytes)).toString("hex");

        const resolutionSource = GAME_RESOLUTION_TEMPLATE
            .replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", resolvedHash)
            .replace("`+PARTICIPATION_SUBMITTED_SCRIPT_HASH+`", submittedHash)
            .replace("`+DEV_ADDR+`", DEV_ADDR_BASE58);
        gameResolutionErgoTree = compile(resolutionSource);

        // --- Add Contract Parties to MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationSubmittedContract = mockChain.addParty(participationSubmittedErgoTree.toHex(), "ParticipationSubmitted");
        participationResolvedContract = mockChain.addParty(participationResolvedErgoTree.toHex(), "ParticipationResolved");
    });

    // Helper function to set up the scenario, allowing scores to be varied
    const setupScenario = (winnerScore: bigint, omittedScore: bigint) => {
        const winnerCommitment = createCommitment("solver-winner", winnerScore, "logs-winner", secret);
        const omittedCommitment = createCommitment("solver-omitted", omittedScore, "logs-omitted", secret);

        // 1. Create the GameResolution box
        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 10,
            additionalRegisters: {
                R4: SPair(SLong(BigInt(resolutionDeadline)), SInt(1)).toHex(), // 1 participant resolved
                R5: SPair(SColl(SByte, secret), SColl(SByte, winnerCommitment)).toHex(),
                R6: SColl(SColl(SByte), []).toHex(),
                R7: SColl(SLong, [800_100n, 2_000_000_000n, 1_000_000n]).toHex(),
                R8: SPair(SColl(SByte, originalResolver.key.publicKey), SLong(BigInt(10))).toHex(),
                R9: SPair(SColl(SByte, originalResolver.key.publicKey), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        // 2. Create the already-resolved box for the current winner (this will be the dataInput)
        participationResolvedContract.addUTxOs({
            ergoTree: participationResolvedErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 10,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, currentWinnerPlayer.key.publicKey).toHex(),
                R5: SColl(SByte, winnerCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-winner")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-winner")).toHex(),
                R9: SColl(SLong, [winnerScore]).toHex(),
            }
        });
        currentWinnerBox = participationResolvedContract.utxos.toArray()[0];

        // 3. Create the submitted (omitted) box
        participationSubmittedContract.addUTxOs({
            ergoTree: participationSubmittedErgoTree.toHex(),
            assets: [],
            value: 1_000_000n,
            creationHeight: mockChain.height - 5,
            additionalRegisters: {
                R4: SColl(SByte, omittedPlayer.key.publicKey).toHex(),
                R5: SColl(SByte, omittedCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-omitted")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-omitted")).toHex(),
                R9: SColl(SLong, [omittedScore]).toHex(),
            }
        });
        omittedParticipantBox = participationSubmittedContract.utxos.toArray()[0];

        mockChain.newBlocks(mockChain.height + 10); // Advance the chain height to ensure all boxes are valid, must be lower than the resolution deadline
    };

    it("should include an omitted participant who becomes the new winner", () => {
        setupScenario(1000n, 1200n); // Omitted player has a higher score

        const newWinnerCommitment = omittedParticipantBox.additionalRegisters.R5;

        if (!newWinnerCommitment) {
            throw new Error("New winner commitment is undefined");
        }
        
        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, omittedParticipantBox, ...newResolver.utxos.toArray()])
            .to([
                // Recreated Game Box
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: SPair(SLong(BigInt(resolutionDeadline)), SInt(2)).toHex(),
                        R5: SPair(SColl(SByte, secret), SColl(SByte, stringToBytes("hex", newWinnerCommitment.substring(4)))).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: gameResolutionBox.additionalRegisters.R7,
                        R8: SPair(SColl(SByte, newResolver.key.publicKey), SLong(BigInt(10))).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    }),
                // Newly Resolved Participant Box
                new OutputBuilder(omittedParticipantBox.value, participationResolvedErgoTree)
                    .setAdditionalRegisters(omittedParticipantBox.additionalRegisters)
            ])
            .withDataFrom([currentWinnerBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(tx, { signers: [newResolver] });
        expect(executionResult).to.be.true;

        const newGameBox = gameResolutionContract.utxos.toArray()[0];
        // Assert that the winner candidate has been updated to the omitted player's commitment
        expect(newGameBox.additionalRegisters.R5).to.equal(SPair(SColl(SByte, secret), SColl(SByte, stringToBytes("hex", newWinnerCommitment!.substring(4)))).toHex());
        // Assert the resolver has been updated
        expect(newGameBox.additionalRegisters.R8).to.contain(Buffer.from(newResolver.key.publicKey).toString("hex"));
    });

    it("should include an omitted participant with a lower score (winner unchanged)", () => {
        setupScenario(1500n, 900n); // Omitted player has a lower score

        const currentWinnerCommitment = currentWinnerBox.additionalRegisters.R5;

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, omittedParticipantBox, ...newResolver.utxos.toArray()])
            .to([
                // Recreated Game Box
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: SPair(SLong(BigInt(resolutionDeadline)), SInt(2)).toHex(),
                        R5: SPair(SColl(SByte, secret), SColl(SByte, stringToBytes("hex", currentWinnerCommitment!.substring(4)))).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: gameResolutionBox.additionalRegisters.R7,
                        // FIX: Use SInt here as well for the recreated box
                        R8: SPair(SColl(SByte, newResolver.key.publicKey), SInt(10)).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    }),
                // Newly Resolved Participant Box
                new OutputBuilder(omittedParticipantBox.value, participationResolvedErgoTree)
                    .setAdditionalRegisters(omittedParticipantBox.additionalRegisters)
            ])
            .withDataFrom([currentWinnerBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(tx, { signers: [newResolver] });
        expect(executionResult).to.be.true;

        const newGameBox = gameResolutionContract.utxos.toArray()[0];
        // Assert that the winner candidate remains the same
        expect(newGameBox.additionalRegisters.R5).to.equal(gameResolutionBox.additionalRegisters.R5);
        // Assert the resolver has been updated
        expect(newGameBox.additionalRegisters.R8).to.contain(Buffer.from(newResolver.key.publicKey).toString("hex"));
    });

    it("should fail if attempted after the resolution deadline", () => {
        setupScenario(1000n, 1200n);
        mockChain.jumpTo(resolutionDeadline + 1);

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, omittedParticipantBox, ...newResolver.utxos.toArray()])
            .withDataFrom([currentWinnerBox])
            .to([new OutputBuilder(1_000_000n, newResolver.address)])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(tx, { signers: [newResolver], throw: false });
        expect(executionResult).to.be.false;
    });
});