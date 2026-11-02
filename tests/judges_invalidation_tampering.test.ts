import { beforeEach, describe, expect, it } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import { Box, OutputBuilder, RECOMMENDED_MIN_FEE_VALUE, TransactionBuilder } from "@fleet-sdk/core";
import { SBool, SByte, SColl, SInt, SLong, SPair } from "@fleet-sdk/serializer";
import { blake2b256, randomBytes } from "@fleet-sdk/crypto";
import { stringToBytes } from "@scure/base";
import { bigintToLongByteArray, generate_pk_proposition, hexToBytes } from "$lib/ergo/utils";
import { prependHexPrefix } from "$lib/utils";
import { getGopGameResolutionErgoTree, getGopParticipationErgoTree, getReputationProofErgoTree } from "$lib/ergo/contract";
import { DefaultGameConstants, getGameConstants, GAME_NFT_AMOUNT } from "$lib/common/constants";
import { DEV_SCRIPT, DEV_COMMISSION_PERCENTAGE } from "$lib/ergo/envs";

// Judge invalidation (game_resolution actions 2 and 3) needs no signer beyond the judges' votes,
// so whoever builds the transaction chooses the recreated game box. These cases check that the
// fields that aren't the builder's to choose are enforced by the contract.

const COMMISSION_DENOMINATOR = getGameConstants().COMMISSION_DENOMINATOR;
const CREATOR_SLASH_RATIO = BigInt(COMMISSION_DENOMINATOR);
const DEV_COMMISSION = BigInt(Math.round(DEV_COMMISSION_PERCENTAGE / 100 * COMMISSION_DENOMINATOR));
const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const JUDGE_PERIOD = BigInt(DefaultGameConstants.JUDGE_PERIOD + 10);

const seed = "a3f9b7e12c9d55ab8068e3ff22b7a19c34d8f1cbeaa1e9c0138b82f00d5ea712";
const gameNftId = "33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aa";
const secret = stringToBytes("utf8", "secret-for-tampering-test");

const invalidationModes = [
    { name: "invalidate", voteType: DefaultGameConstants.PARTICIPATION_TYPE_ID, penalizeResolver: true },
    { name: "unavailable", voteType: DefaultGameConstants.PARTICIPATION_UNAVAILABLE_TYPE_ID, penalizeResolver: false },
];

describe.each(invalidationModes)("Judge invalidation can't tamper with the game box - ($name)", (mode) => {
    const mockChain = new MockChain({ height: 800_000 });
    const currentHeight = 800_000;
    const resolutionDeadline = BigInt(currentHeight) + JUDGE_PERIOD;
    const numericalParams: bigint[] = [1n, 20n, 700_000n, 2_000_000_000n, 1_000_000n, 1n, 10n, DEV_COMMISSION, CREATOR_SLASH_RATIO, resolutionDeadline];

    const gameResolutionErgoTree = getGopGameResolutionErgoTree();
    const participationErgoTree = getGopParticipationErgoTree();
    const reputationProofErgoTree = getReputationProofErgoTree();

    let resolver: ReturnType<MockChain["newParty"]>;
    let gameResolutionContract: ReturnType<MockChain["newParty"]>;
    let participationContract: ReturnType<MockChain["newParty"]>;
    let gameResolutionBox: Box;
    let candidateBox: Box;
    let voteBoxes: Box[];
    let judges: Uint8Array[];

    // Game in resolution with one candidate and `voteCount` of `judgeCount` judges voting against it.
    const setupScenario = (judgeCount: number, voteCount: number) => {
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");
        const reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProof");

        resolver = mockChain.newParty("Resolver");
        resolver.addBalance({ nanoergs: 10_000_000_000n });
        const candidate = mockChain.newParty("Candidate");

        const logsHash = blake2b256(stringToBytes("utf8", "logs-candidate"));
        const candidateErgoTree = prependHexPrefix(candidate.address.getPublicKeys()[0]);
        const commitment = blake2b256(new Uint8Array([...stringToBytes("utf8", "solver-candidate"), ...hexToBytes(seed)!, ...bigintToLongByteArray(230n), ...logsHash, ...candidateErgoTree, ...secret]));

        const judgeTokenIds = Array.from({ length: judgeCount }, () => Buffer.from(randomBytes(32)).toString("hex"));
        judges = judgeTokenIds.map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: RECOMMENDED_MIN_FEE_VALUE,
            assets: [
                { tokenId: gameNftId, amount: GAME_NFT_AMOUNT },
                { tokenId: USD_BASE_TOKEN, amount: 2_000_000_000n }
            ],
            creationHeight: mockChain.height - 30,
            additionalRegisters: {
                R4: SInt(1).toHex(),
                R5: SColl(SByte, hexToBytes(seed)!).toHex(),
                R6: SPair(SColl(SByte, secret), SColl(SByte, commitment)).toHex(),
                R7: SColl(SColl(SByte), judges).toHex(),
                R8: SColl(SLong, numericalParams).toHex(),
                R9: SColl(SColl(SByte), [
                    stringToBytes("utf8", "{}"),
                    hexToBytes(USD_BASE_TOKEN)!,
                    hexToBytes(DEV_SCRIPT)!,
                    prependHexPrefix(resolver.address.getPublicKeys()[0], "0008cd")
                ]).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        participationContract.addUTxOs({
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: 700_000 - 30,
            assets: [{ tokenId: USD_BASE_TOKEN, amount: 1_000_000n }],
            additionalRegisters: {
                R4: SColl(SByte, candidateErgoTree).toHex(),
                R5: SColl(SByte, commitment).toHex(),
                R6: SColl(SByte, hexToBytes(gameNftId)!).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-candidate")).toHex(),
                R8: SColl(SByte, logsHash).toHex(),
                R9: SColl(SLong, [100n, 200n, 23n, 230n, 300n, 1000n, 2n, 3n, 10n, 2n]).toHex(),
            }
        });
        candidateBox = participationContract.utxos.toArray()[0];

        judgeTokenIds.slice(0, voteCount).forEach(tokenId => reputationProofContract.addUTxOs({
            creationHeight: mockChain.height - 10,
            ergoTree: reputationProofErgoTree.toHex(),
            value: 1_000_000n,
            assets: [{ tokenId, amount: 1n }],
            additionalRegisters: {
                R4: SColl(SByte, hexToBytes(mode.voteType)!).toHex(),
                R5: SColl(SByte, commitment).toHex(),
                R6: SBool(true).toHex(),
                R7: generate_pk_proposition("9fcwctfPQPkDfHgxBns5Uu3dwWpaoywhkpLEobLuztfQuV5mt3T"),
                R8: SBool(false).toHex(),
                R9: SColl(SByte, new Uint8Array(0)).toHex(),
            }
        }));
        voteBoxes = reputationProofContract.utxos.toArray();
    };

    // The invalidation tx as the honest off-chain code builds it, with optional tampered fields.
    const buildInvalidationTx = (overrides: { secret?: Uint8Array } = {}) => {
        const resolverPenalization = mode.penalizeResolver ? numericalParams[6] * CREATOR_SLASH_RATIO / BigInt(COMMISSION_DENOMINATOR) : 0n;
        const newNumericalParams = [...numericalParams];
        newNumericalParams[5] = numericalParams[5] + resolverPenalization;
        newNumericalParams[6] = numericalParams[6] - resolverPenalization;
        newNumericalParams[9] = BigInt(mockChain.height) + JUDGE_PERIOD;

        return new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, candidateBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(BigInt(gameResolutionBox.value) + BigInt(candidateBox.value), gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .addTokens(candidateBox.assets)
                    .setAdditionalRegisters({
                        R4: SInt(1).toHex(),
                        R5: SColl(SByte, hexToBytes(seed)!).toHex(),
                        R6: SPair(SColl(SByte, overrides.secret ?? secret), SColl(SByte, [])).toHex(),
                        R7: SColl(SColl(SByte), judges).toHex(),
                        R8: SColl(SLong, newNumericalParams).toHex(),
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            .withDataFrom(voteBoxes)
            .sendChangeTo(resolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();
    };

    beforeEach(() => {
        mockChain.reset({ clearParties: true });
        mockChain.jumpTo(currentHeight);
    });

    it("accepts the honest invalidation", () => {
        setupScenario(3, 2);

        expect(mockChain.execute(buildInvalidationTx(), { signers: [resolver as any], throw: false })).to.be.true;
        expect(participationContract.utxos.length).to.equal(0);
    });

    it("rejects replacing the revealed secret S", () => {
        setupScenario(3, 2);

        // With another S no participation could become candidate again and the resolver would end the game with no winner.
        const tx = buildInvalidationTx({ secret: randomBytes(32) });

        expect(mockChain.execute(tx, { signers: [resolver as any], throw: false })).to.be.false;
        expect(gameResolutionContract.utxos.toArray()[0].boxId).to.equal(gameResolutionBox.boxId);
        expect(participationContract.utxos.length).to.equal(1);
    });
});
