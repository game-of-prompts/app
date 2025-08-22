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
    SInt
} from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";
import { bigintToLongByteArray, hexToBytes } from "$lib/ergo/utils";

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

    const game_deadline = 700_700n;

    let gameResolutionBox: Box;
    let currentWinnerBox: Box;
    let omittedParticipantBox: Box;
    
    // Commitments accesibles globalmente en el test
    let winnerCommitment: Uint8Array;
    let omittedCommitment: Uint8Array;

    beforeEach(() => {
        mockChain = new MockChain({ height: 800_000 });

        // --- Initialize Actors ---
        originalResolver = mockChain.newParty("OriginalResolver");
        newResolver = mockChain.newParty("NewResolver");
        currentWinnerPlayer = mockChain.newParty("CurrentWinner");
        omittedPlayer = mockChain.newParty("OmittedPlayer");

        newResolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 3n }); // Add more balance for multiple tests

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

    // Setup function to initialize the state for each test scenario
    const setupScenario = (winnerScore: bigint, omittedScore: bigint, omittedCreationHeight: number = 600_000) => {
        // Asignar a las variables globales
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
                R8: SPair(SColl(SByte, originalResolver.key.publicKey), SLong(BigInt(10))).toHex(),
                R9: SPair(SColl(SByte, originalResolver.key.publicKey), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

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

        participationSubmittedContract.addUTxOs({
            ergoTree: participationSubmittedErgoTree.toHex(),
            assets: [],
            value: 1_000_000n,
            creationHeight: omittedCreationHeight,  // Configurable creation height
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

        mockChain.newBlocks(10); 
    };

    it("should include an omitted participant who becomes the new winner", () => {
        // Omitted player has a higher score (1200 > 1000)
        setupScenario(1000n, 1200n);

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];
        
        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, omittedParticipantBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex(), // New winner's commitment
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(), // Participant count increments
                        R8: SPair(SColl(SByte, newResolver.key.publicKey), SLong(BigInt(10))).toHex(), // New resolver
                        R9: gameResolutionBox.additionalRegisters.R9
                    }),
                new OutputBuilder(omittedParticipantBox.value, participationResolvedErgoTree)
                    .setAdditionalRegisters(omittedParticipantBox.additionalRegisters) // Box becomes resolved
            ])
            .withDataFrom([currentWinnerBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(tx, { signers: [newResolver] });
        expect(executionResult).to.be.true;

        const newGameBox = gameResolutionContract.utxos.toArray()[0];
        // Assert new winner is the omitted participant
        expect(newGameBox.additionalRegisters.R5).to.equal(SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex());
        // Assert participant count is updated
        expect(newGameBox.additionalRegisters.R7).to.equal(SColl(SLong, updatedNumericalParams).toHex());
        // Assert resolver is updated
        expect(newGameBox.additionalRegisters.R8).to.contain(Buffer.from(newResolver.key.publicKey).toString("hex"));
    });

    it("should include an omitted participant who is not the new winner", () => {
        // Omitted player has a lower score (800 < 1000)
        setupScenario(1000n, 800n);

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];
        
        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, omittedParticipantBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: gameResolutionBox.additionalRegisters.R5, // Winner remains the same
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(), // Participant count still increments
                        R8: SPair(SColl(SByte, newResolver.key.publicKey), SLong(BigInt(10))).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    }),
                new OutputBuilder(omittedParticipantBox.value, participationResolvedErgoTree)
                    .setAdditionalRegisters(omittedParticipantBox.additionalRegisters) // Box becomes resolved
            ])
            .withDataFrom([currentWinnerBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(tx, { signers: [newResolver] });
        expect(executionResult).to.be.true;

        const newGameBox = gameResolutionContract.utxos.toArray()[0];
        // Assert winner has NOT changed
        expect(newGameBox.additionalRegisters.R5).to.equal(gameResolutionBox.additionalRegisters.R5);
        // Assert participant count is updated
        expect(newGameBox.additionalRegisters.R7).to.equal(SColl(SLong, updatedNumericalParams).toHex());
        // Assert a new resolved box for the omitted participant was created
        expect(participationResolvedContract.utxos.toArray()).to.have.length(2);
    });

    it("should fail if include an omitted participant who is not the new winner, but set it as the current winner", () => {
        // Omitted player has a lower score (800 < 1000)
        setupScenario(1000n, 800n);

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];
        
        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, omittedParticipantBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex(), // New winner's commitment
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(), // Participant count still increments
                        R8: SPair(SColl(SByte, newResolver.key.publicKey), SLong(BigInt(10))).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    }),
                new OutputBuilder(omittedParticipantBox.value, participationResolvedErgoTree)
                    .setAdditionalRegisters(omittedParticipantBox.additionalRegisters) // Box becomes resolved
            ])
            .withDataFrom([currentWinnerBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(tx, { signers: [newResolver], throw: false });
        expect(executionResult).to.be.false;
    });

    it("should fail if the omitted participation was submitted after the game deadline", () => {
        // Setup with omitted participant box created after the game deadline
        const lateCreationHeight = Number(game_deadline) + 1;
        setupScenario(1000n, 1200n, lateCreationHeight);

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];
        
        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, omittedParticipantBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(),
                        R8: SPair(SColl(SByte, newResolver.key.publicKey), SLong(BigInt(10))).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    }),
                new OutputBuilder(omittedParticipantBox.value, participationResolvedErgoTree)
                    .setAdditionalRegisters(omittedParticipantBox.additionalRegisters)
            ])
            .withDataFrom([currentWinnerBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        // The contract should prevent this transaction from being valid
        const executionResult = mockChain.execute(tx, { signers: [newResolver], throw: false });
        expect(executionResult).to.be.false;
    });

    it("should fail if the omitted participation was submitted during the game deadline", () => {
        // Setup with omitted participant box created during the game deadline
        const lateCreationHeight = Number(game_deadline);
        setupScenario(1000n, 1200n, lateCreationHeight);

        const updatedNumericalParams: bigint[] = [game_deadline, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];
        
        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, omittedParticipantBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex(),
                        R6: gameResolutionBox.additionalRegisters.R6,
                        R7: SColl(SLong, updatedNumericalParams).toHex(),
                        R8: SPair(SColl(SByte, newResolver.key.publicKey), SLong(BigInt(10))).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    }),
                new OutputBuilder(omittedParticipantBox.value, participationResolvedErgoTree)
                    .setAdditionalRegisters(omittedParticipantBox.additionalRegisters)
            ])
            .withDataFrom([currentWinnerBox])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        // The contract should prevent this transaction from being valid
        const executionResult = mockChain.execute(tx, { signers: [newResolver], throw: false });
        expect(executionResult).to.be.false;
    });
});
