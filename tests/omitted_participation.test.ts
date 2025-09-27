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
import { bigintToLongByteArray } from "$lib/ergo/utils";
import { PARTICIPATION } from "$lib/ergo/reputation/types";

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

        // --- Initialize Actors ---
        originalResolver = mockChain.newParty("OriginalResolver");
        newResolver = mockChain.newParty("NewResolver");
        currentWinnerPlayer = mockChain.newParty("CurrentWinner");
        omittedPlayer = mockChain.newParty("OmittedPlayer");

        newResolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 3n });

        // --- Compile Contracts ---
        participationErgoTree = compile(PARTICIPATION_SOURCE);
        const participationHash = Buffer.from(blake2b256(participationErgoTree.bytes)).toString("hex");

        const resolutionSource = GAME_RESOLUTION_TEMPLATE
            .replace("`+PARTICIPATION_SCRIPT_HASH+`", participationHash)
            .replace("`+REPUTATION_PROOF_SCRIPT_HASH+`", "0".repeat(64))
            .replace("`+PARTICIPATION_TYPE_ID+`", PARTICIPATION)
            .replace("`+DEV_ADDR+`", DEV_ADDR_BASE58);
        gameResolutionErgoTree = compile(resolutionSource);

        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "ParticipationSubmitted");
    });

    afterEach(() => {
        mockChain.reset({clearParties: true});
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
                R8: SPair(SColl(SByte, originalResolver.key.publicKey), SLong(10n)).toHex(),
                R9: SPair(SColl(SByte, originalResolver.key.publicKey), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        participationContract.addUTxOs({
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            assets: [],
            creationHeight: mockChain.height - 10,
            additionalRegisters: {
                R4: SColl(SByte, currentWinnerPlayer.key.publicKey).toHex(),
                R5: SColl(SByte, winnerCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-winner")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-winner")).toHex(),
                R9: SColl(SLong, [winnerScore]).toHex()
            }
        });
        currentWinnerBox = participationContract.utxos.toArray()[0];

        participationContract.addUTxOs({
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            assets: [],
            creationHeight: omittedCreationHeight,
            additionalRegisters: {
                R4: SColl(SByte, omittedPlayer.key.publicKey).toHex(),
                R5: SColl(SByte, omittedCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-omitted")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-omitted")).toHex(),
                R9: SColl(SLong, [omittedScore]).toHex()
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
                        R8: SPair(SColl(SByte, newResolver.key.publicKey), SLong(10n)).toHex(),
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
});