import { base } from "$app/paths";
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import type { Amount, Box } from "@fleet-sdk/core";
import { getGameConstants } from "$lib/common/constants";
import type {
    AnyGame,
    AnyParticipation,
    GameActive,
    GameCancellation,
    GameFinalized,
    GameResolution,
    ParticipationConsumedReason,
    MalformedParticipationReason,
} from "$lib/common/game";
import { current_height } from "$lib/common/store";
import { DEV_COMMISSION_PERCENTAGE, DEV_SCRIPT } from "$lib/ergo/envs";
import type { CreateGoPGamePlatformParams, Platform } from "$lib/common/platform";
import type { ErgoPlatform } from "$lib/ergo/platform";
import {
    bigintToLongByteArray,
    hexToBytes,
    uint8ArrayToHex,
} from "$lib/ergo/utils";
import { get } from "svelte/store";

const DEV_GAME_ID_PREFIX = "dev-game-";
const DEFAULT_DEV_HEIGHT = 1_500_000;
let cachedDevReferenceHeight: number | null = null;
const DEFAULT_PLAYER_PK_HEX =
    "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

const DEV_IMAGES = [
    `${base}/img1.png`,
    `${base}/img2.png`,
    `${base}/img3.png`,
    `${base}/img4.jpg`,
];

type DevScenarioKey =
    | "strategy_upload"
    | "seed_lockdown"
    | "playing"
    | "awaiting_resolution"
    | "suspended"
    | "judging"
    | "ready_to_finalize"
    | "cancelled_locked"
    | "cancelled_draining"
    | "finalized"
    | "finalized_aurora"
    | "finalized_zenith"
    | "finalized_gauntlet";

interface DevCompetitionDefinition {
    key: DevScenarioKey;
    gameId: string;
    title: string;
    description: string;
    imageURL: string;
}

interface DevParticipationSeed {
    suffix: string;
    actualScore: bigint;
    scoreList?: bigint[];
    creationHeightOffset: number;
    solverIdCreationOffset: number;
    status: "Submitted" | "Malformed" | "Consumed";
    malformedReason?: MalformedParticipationReason;
    consumedReason?: ParticipationConsumedReason;
    wrongCommitment?: boolean;
}

class DevErgoPlatform implements Platform {
    id = "ergo-dev";
    main_token = "ERG";
    icon = "";
    time_per_block = 2 * 60 * 1000;

    constructor(private readonly mockedHeight: number) {}

    async get_current_height(): Promise<number> {
        current_height.set(this.mockedHeight);
        return this.mockedHeight;
    }

    async get_balance(): Promise<Map<string, number>> {
        return new Map();
    }

    async createGoPGame(_params: CreateGoPGamePlatformParams): Promise<string[] | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async submitScoreToGopGame(): Promise<string | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async resolveGame(): Promise<string | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async cancel_game(): Promise<string | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async drain_cancelled_game_stake(): Promise<string | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async endGame(): Promise<string | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async toEndGame(): Promise<string | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async toEndGameChained(): Promise<string[] | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async judgesInvalidateVote(): Promise<string | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async judgesInvalidateExecute(): Promise<string[] | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async judgesInvalidateUnavailableVote(): Promise<string | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async judgesInvalidateUnavailableExecute(): Promise<string | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async includeOmittedParticipations(): Promise<string | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async claimAfterCancellation(): Promise<string | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async reclaimAfterGrace(): Promise<string | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async acceptJudgeNomination(): Promise<string | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async contribute_to_ceremony(): Promise<string | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }

    async batchParticipations(): Promise<string | null> {
        throw new Error("Dev fixtures do not support on-chain actions.");
    }
}

export const DEV_COMPETITIONS: DevCompetitionDefinition[] = [
    {
        key: "strategy_upload",
        gameId: `${DEV_GAME_ID_PREFIX}strategy-upload`,
        title: "Snake Hyperlane Trials",
        description:
            "Classic arcade challenge inspired by Snake. The solver controls a growing agent in a constrained arena and is scored by survival time, path quality, and maximum length reached.",
        imageURL: DEV_IMAGES[0],
    },
    {
        key: "seed_lockdown",
        gameId: `${DEV_GAME_ID_PREFIX}seed-lockdown`,
        title: "Pac-Maze Lockdown",
        description:
            "Classic maze challenge inspired by Pac-Man. The solver must optimize routing under ghost pressure, balancing pellet collection, risk management, and sustained point generation.",
        imageURL: DEV_IMAGES[1],
    },
    {
        key: "playing",
        gameId: `${DEV_GAME_ID_PREFIX}playing`,
        title: "Voxel Frontier Ops",
        description:
            "Open-world voxel challenge where an autonomous solver gathers resources, crafts tools, and executes mission plans under constraints on time and material efficiency.",
        imageURL: DEV_IMAGES[2],
    },
    {
        key: "awaiting_resolution",
        gameId: `${DEV_GAME_ID_PREFIX}awaiting-resolution`,
        title: "Black Swan Trading Sim",
        description:
            "Financial trading simulation with historical and synthetic market shocks. Solvers run strategy bots scored by net return, drawdown control, and risk-adjusted performance.",
        imageURL: DEV_IMAGES[3],
    },
    {
        key: "suspended",
        gameId: `${DEV_GAME_ID_PREFIX}suspended`,
        title: "Proteome Fold Crisis",
        description:
            "Computational biology challenge where the solver predicts stable 3D protein conformations from amino-acid sequences using energy minimization and structural quality metrics.",
        imageURL: DEV_IMAGES[0],
    },
    {
        key: "judging",
        gameId: `${DEV_GAME_ID_PREFIX}judging`,
        title: "Code Golf Tribunal",
        description:
            "Code optimization challenge where the solver submits executable solutions for benchmark tasks, scored by correctness, runtime efficiency, and implementation compactness.",
        imageURL: DEV_IMAGES[1],
    },
    {
        key: "ready_to_finalize",
        gameId: `${DEV_GAME_ID_PREFIX}ready-to-finalize`,
        title: "NLP Command Relay",
        description:
            "Natural language interaction challenge where the solver interprets constrained instructions, extracts intent, and executes valid actions with strict output formatting.",
        imageURL: DEV_IMAGES[2],
    },
    {
        key: "cancelled_locked",
        gameId: `${DEV_GAME_ID_PREFIX}cancelled-locked`,
        title: "RTS Economy Collapse",
        description:
            "Strategy and resource-management game focused on base growth, tech progression, and unit timing. Scoring rewards objective speed, economic stability, and resource efficiency.",
        imageURL: DEV_IMAGES[3],
    },
    {
        key: "cancelled_draining",
        gameId: `${DEV_GAME_ID_PREFIX}cancelled-draining`,
        title: "SigmaUSD Stress Test",
        description:
            "Smart-contract trading challenge inspired by SigmaUSD dynamics, where solvers optimize mint/redeem timing and portfolio exposure against volatility and liquidity constraints.",
        imageURL: DEV_IMAGES[0],
    },
    {
        key: "finalized",
        gameId: `${DEV_GAME_ID_PREFIX}finalized`,
        title: "Arcade Legends Final",
        description:
            "Arcade championship scenario combining reflex control, route planning, and scoring consistency across multiple rounds of increasing difficulty.",
        imageURL: DEV_IMAGES[1],
    },
    {
        key: "finalized_aurora",
        gameId: `${DEV_GAME_ID_PREFIX}finalized-aurora`,
        title: "Protein Folding Grand Prix",
        description:
            "Scientific prediction challenge focused on low-energy protein folds and structural similarity to hidden references, emphasizing robust generalization across sequences.",
        imageURL: DEV_IMAGES[2],
    },
    {
        key: "finalized_zenith",
        gameId: `${DEV_GAME_ID_PREFIX}finalized-zenith`,
        title: "Quant Trader Open",
        description:
            "Quant trading arena where solver bots compete on return quality, downside control, and consistent benchmark outperformance across changing market regimes.",
        imageURL: DEV_IMAGES[3],
    },
    {
        key: "finalized_gauntlet",
        gameId: `${DEV_GAME_ID_PREFIX}finalized-gauntlet`,
        title: "Language Agent Masters",
        description:
            "Language-agent challenge that combines instruction following, information extraction, and tool-usable responses scored on precision, relevance, and task completion.",
        imageURL: DEV_IMAGES[0],
    },
];

function repeatHex(byteHex: string): string {
    return byteHex.repeat(32);
}

function mutateHexTail(hex: string): string {
    const tail = hex.endsWith("a") ? "b" : "a";
    return `${hex.slice(0, -1)}${tail}`;
}

function makeBox(params: {
    boxId: string;
    transactionId: string;
    creationHeight: number;
    value: bigint;
    ergoTree?: string;
    additionalRegisters?: Record<string, { renderedValue: any }>;
    assets?: Array<{ tokenId: string; amount: bigint }>;
}): Box<Amount> {
    return {
        boxId: params.boxId,
        transactionId: params.transactionId,
        index: 0,
        value: params.value,
        ergoTree: params.ergoTree ?? "dev-ergo-tree",
        creationHeight: params.creationHeight,
        assets:
            params.assets?.map((asset) => ({
                tokenId: asset.tokenId,
                amount: asset.amount,
            })) ?? [],
        additionalRegisters: params.additionalRegisters ?? {},
    } as Box<Amount>;
}

function makeGameContent(definition: DevCompetitionDefinition) {
    return {
        rawJsonString: JSON.stringify({
            title: definition.title,
            description: definition.description,
        }),
        title: definition.title,
        description: definition.description,
        serviceId: "",
        imageURL: definition.imageURL,
        soundtrackURL: `${base}/sound1.mp3`,
    };
}

function makeGameNftAsset(gameId: string) {
    return [{ tokenId: gameId, amount: 1n }];
}

function buildCommitment(params: {
    solverIdHex: string;
    seedHex: string;
    score: bigint;
    hashLogsHex: string;
    playerScriptHex: string;
    secretHex: string;
}): string {
    const solverIdBytes = hexToBytes(params.solverIdHex);
    const seedBytes = hexToBytes(params.seedHex);
    const hashLogsBytes = hexToBytes(params.hashLogsHex);
    const playerScriptBytes = hexToBytes(params.playerScriptHex);
    const secretBytes = hexToBytes(params.secretHex);

    if (
        !solverIdBytes ||
        !seedBytes ||
        !hashLogsBytes ||
        !playerScriptBytes ||
        !secretBytes
    ) {
        throw new Error("Failed to build dev commitment from hexadecimal data.");
    }

    const scoreBytes = bigintToLongByteArray(params.score);
    const combined = new Uint8Array(
        solverIdBytes.length +
            seedBytes.length +
            scoreBytes.length +
            hashLogsBytes.length +
            playerScriptBytes.length +
            secretBytes.length,
    );

    let offset = 0;
    combined.set(solverIdBytes, offset);
    offset += solverIdBytes.length;
    combined.set(seedBytes, offset);
    offset += seedBytes.length;
    combined.set(scoreBytes, offset);
    offset += scoreBytes.length;
    combined.set(hashLogsBytes, offset);
    offset += hashLogsBytes.length;
    combined.set(playerScriptBytes, offset);
    offset += playerScriptBytes.length;
    combined.set(secretBytes, offset);

    return uint8ArrayToHex(fleetBlake2b256(combined));
}

function getDefaultScoreList(actualScore: bigint): bigint[] {
    return [actualScore - 13n, actualScore, actualScore + 11n];
}

function buildDevParticipations(params: {
    definition: DevCompetitionDefinition;
    createdAt: number;
    deadlineBlock: number;
    seedHex: string;
    secretHex: string;
    seeds: DevParticipationSeed[];
}): AnyParticipation[] {
    return params.seeds.map((seed, index) => {
        const playerPkHex = DEFAULT_PLAYER_PK_HEX;
        const playerScriptHex = `0008cd${playerPkHex}`;
        const solverIdHex = repeatHex((0xa1 + index).toString(16));
        const hashLogsHex = repeatHex((0xb1 + index).toString(16));
        const scoreList = seed.scoreList ?? getDefaultScoreList(seed.actualScore);
        const solverIdCreationHeight =
            params.createdAt + seed.solverIdCreationOffset;
        const creationHeight = params.createdAt + seed.creationHeightOffset;

        let commitmentC_Hex = buildCommitment({
            solverIdHex,
            seedHex: params.seedHex,
            score: seed.actualScore,
            hashLogsHex,
            playerScriptHex,
            secretHex: params.secretHex,
        });

        if (seed.wrongCommitment) {
            commitmentC_Hex = mutateHexTail(commitmentC_Hex);
        }

        const box = makeBox({
            boxId: `dev-box-${params.definition.key}-participation-${seed.suffix}`,
            transactionId: `devtx_${params.definition.key}_participation_${seed.suffix}`,
            creationHeight,
            value: 450_000_000n,
            ergoTree: "dev-participation-ergo-tree",
            additionalRegisters: {
                R4: { renderedValue: playerScriptHex },
                R5: { renderedValue: commitmentC_Hex },
                R6: { renderedValue: params.definition.gameId },
                R7: { renderedValue: solverIdHex },
                R8: { renderedValue: hashLogsHex },
                R9: {
                    renderedValue: JSON.stringify(
                        scoreList.map((score) => score.toString()),
                    ),
                },
            },
        });

        const baseParticipation: any = {
            boxId: box.boxId,
            box,
            transactionId: box.transactionId,
            creationHeight,
            value: 450_000_000n,
            gameNftId: params.definition.gameId,
            playerPK_Hex: playerPkHex,
            playerScript_Hex: playerScriptHex,
            commitmentC_Hex,
            solverId_RawBytesHex: solverIdHex,
            solverId_String: solverIdHex,
            hashLogs_Hex: hashLogsHex,
            scoreList,
            reputationOpinions: [],
            solverIdBox: makeBox({
                boxId: `dev-solver-box-${params.definition.key}-${seed.suffix}`,
                transactionId: `devtx_${params.definition.key}_solver_${seed.suffix}`,
                creationHeight: solverIdCreationHeight,
                value: 1_000_000n,
                ergoTree: "dev-solver-ergo-tree",
                additionalRegisters: {
                    R4: { renderedValue: solverIdHex },
                },
            }),
            score: seed.actualScore,
        };

        if (seed.status === "Malformed") {
            return {
                ...baseParticipation,
                status: "Malformed" as const,
                spent: false,
                reason: seed.malformedReason ?? "unknown",
            };
        }

        if (seed.status === "Consumed") {
            return {
                ...baseParticipation,
                status: "Consumed" as const,
                spent: true,
                reason: seed.consumedReason ?? "unknown",
            };
        }

        return {
            ...baseParticipation,
            status: "Submitted" as const,
            spent: false,
        };
    });
}

function buildScenarioState(
    definition: DevCompetitionDefinition,
    referenceHeight: number,
): {
    game: AnyGame;
    history: AnyGame[];
    participations: AnyParticipation[];
} {
    const constants = getGameConstants();
    const platform = new DevErgoPlatform(
        referenceHeight,
    ) as unknown as ErgoPlatform;
    const seedHex = repeatHex(
        (0xc1 + DEV_COMPETITIONS.findIndex((item) => item.key === definition.key))
            .toString(16),
    );
    const secretHex = repeatHex(
        (0xd1 + DEV_COMPETITIONS.findIndex((item) => item.key === definition.key))
            .toString(16),
    );
    const createdAt = referenceHeight - 24;
    const resolverStakeAmount = 2_000_000_000n;
    const participationFeeAmount = 450_000_000n;
    const perJudgeCommission = 12_500n;
    const resolverCommission = 75_000;
    const devCommission = DEV_COMMISSION_PERCENTAGE * 10_000;
    const creatorSlashRatio = constants.COMMISSION_DENOMINATOR;
    const content = makeGameContent(definition);
    const judges = [
        `dev-judge-${definition.key}-01`,
        `dev-judge-${definition.key}-02`,
        `dev-judge-${definition.key}-03`,
    ];

    const makeActive = (params: {
        boxIdSuffix: string;
        creationHeight: number;
        value: bigint;
        deadlineBlock: number;
        ceremonyDeadline: number;
        seed: string;
        secretHash?: string;
    }): GameActive => ({
        platform,
        boxId: `dev-box-${definition.key}-${params.boxIdSuffix}`,
        box: makeBox({
            boxId: `dev-box-${definition.key}-${params.boxIdSuffix}`,
            transactionId: `devtx_${definition.key}_${params.boxIdSuffix}`,
            creationHeight: params.creationHeight,
            value: params.value,
            assets: makeGameNftAsset(definition.gameId),
        }),
        status: "Active",
        gameId: definition.gameId,
        resolverCommission,
        secretHash: params.secretHash ?? mutateHexTail(secretHex),
        seed: params.seed,
        ceremonyDeadline: params.ceremonyDeadline,
        judges,
        deadlineBlock: params.deadlineBlock,
        resolverStakeAmount,
        participationFeeAmount,
        participationTokenId: "",
        perJudgeCommission,
        timeWeight: 3n,
        content,
        value: params.value,
        reputationOpinions: [],
        reputation: 0,
        constants,
        createdAt,
        devScript: DEV_SCRIPT,
        devCommission,
        creatorSlashRatio,
    });

    const buildResolution = (params: {
        keySuffix: string;
        creationHeight: number;
        value: bigint;
        deadlineBlock: number;
        resolutionDeadline: number;
        winnerCandidateCommitment: string | null;
        isEndGame: boolean;
    }): GameResolution => ({
        platform,
        boxId: `dev-box-${definition.key}-${params.keySuffix}`,
        box: makeBox({
            boxId: `dev-box-${definition.key}-${params.keySuffix}`,
            transactionId: `devtx_${definition.key}_${params.keySuffix}`,
            creationHeight: params.creationHeight,
            value: params.value,
            assets: makeGameNftAsset(definition.gameId),
        }),
        status: "Resolution",
        gameId: definition.gameId,
        resolutionDeadline: params.resolutionDeadline,
        revealedS_Hex: secretHex,
        seed: seedHex,
        winnerCandidateCommitment: params.winnerCandidateCommitment,
        judges,
        deadlineBlock: params.deadlineBlock,
        resolverStakeAmount,
        participationFeeAmount,
        participationTokenId: "",
        perJudgeCommission,
        timeWeight: 3n,
        resolverPK_Hex: DEFAULT_PLAYER_PK_HEX,
        resolverScript_Hex: `0008cd${DEFAULT_PLAYER_PK_HEX}`,
        resolverCommission,
        devScript: DEV_SCRIPT,
        devCommission,
        creatorSlashRatio,
        content,
        value: params.value,
        reputationOpinions: [],
        reputation: 0,
        constants,
        isEndGame: params.isEndGame,
        createdAt,
    });

    const buildCancellation = (params: {
        keySuffix: string;
        creationHeight: number;
        value: bigint;
        deadlineBlock: number;
        unlockHeight: number;
    }): GameCancellation => ({
        platform,
        boxId: `dev-box-${definition.key}-${params.keySuffix}`,
        box: makeBox({
            boxId: `dev-box-${definition.key}-${params.keySuffix}`,
            transactionId: `devtx_${definition.key}_${params.keySuffix}`,
            creationHeight: params.creationHeight,
            value: params.value,
            assets: makeGameNftAsset(definition.gameId),
        }),
        status: "Cancelled_Draining",
        gameId: definition.gameId,
        unlockHeight: params.unlockHeight,
        revealedS_Hex: secretHex,
        portionToClaim: 700_000_000n,
        resolverStakeAmount,
        content,
        participationFeeAmount,
        participationTokenId: "",
        value: params.value,
        deadlineBlock: params.deadlineBlock,
        reputationOpinions: [],
        judges: [],
        reputation: 0,
        constants,
        createdAt,
        timeWeight: 3n,
    });

    const buildFinalized = (params: {
        keySuffix: string;
        creationHeight: number;
        value: bigint;
        deadlineBlock: number;
        judgeFinalizationBlock: number;
        winnerFinalizationDeadline: number;
        winnerCandidateCommitment: string | null;
    }): GameFinalized => ({
        platform,
        boxId: `dev-box-${definition.key}-${params.keySuffix}`,
        box: makeBox({
            boxId: `dev-box-${definition.key}-${params.keySuffix}`,
            transactionId: `devtx_${definition.key}_${params.keySuffix}`,
            creationHeight: params.creationHeight,
            value: params.value,
            assets: makeGameNftAsset(definition.gameId),
            ergoTree: "dev-finalized-holder-box",
        }),
        status: "Finalized",
        gameId: definition.gameId,
        content,
        value: params.value,
        participationFeeAmount,
        participationTokenId: "",
        reputationOpinions: [],
        judges,
        deadlineBlock: params.deadlineBlock,
        judgeFinalizationBlock: params.judgeFinalizationBlock,
        winnerFinalizationDeadline: params.winnerFinalizationDeadline,
        reputation: 0,
        constants,
        createdAt,
        seed: seedHex,
        revealedS_Hex: secretHex,
        winnerCandidateCommitment: params.winnerCandidateCommitment,
        resolverStakeAmount,
        perJudgeCommission,
        timeWeight: 3n,
        resolverPK_Hex: DEFAULT_PLAYER_PK_HEX,
        resolverScript_Hex: `0008cd${DEFAULT_PLAYER_PK_HEX}`,
        resolverCommission,
        devCommission,
    });

    switch (definition.key) {
        case "strategy_upload": {
            const current = makeActive({
                boxIdSuffix: "current",
                creationHeight: createdAt,
                value: 3_400_000_000n,
                deadlineBlock: referenceHeight + 18,
                ceremonyDeadline: referenceHeight + 6,
                seed: seedHex,
            });
            const participations = buildDevParticipations({
                definition,
                createdAt,
                deadlineBlock: current.deadlineBlock,
                seedHex,
                secretHex,
                seeds: [
                    {
                        suffix: "alpha",
                        actualScore: 62n,
                        creationHeightOffset: 1,
                        solverIdCreationOffset: 1,
                        status: "Submitted",
                    },
                    {
                        suffix: "beta",
                        actualScore: 74n,
                        creationHeightOffset: 2,
                        solverIdCreationOffset: 2,
                        status: "Submitted",
                    },
                    {
                        suffix: "gamma",
                        actualScore: 59n,
                        creationHeightOffset: 3,
                        solverIdCreationOffset: 3,
                        status: "Submitted",
                    },
                ],
            });
            return { game: current, history: [current], participations };
        }
        case "seed_lockdown": {
            const original = makeActive({
                boxIdSuffix: "created",
                creationHeight: createdAt,
                value: 3_200_000_000n,
                deadlineBlock: referenceHeight + 16,
                ceremonyDeadline: referenceHeight + 4,
                seed: repeatHex("c8"),
            });
            const current = makeActive({
                boxIdSuffix: "current",
                creationHeight: createdAt + 4,
                value: 3_650_000_000n,
                deadlineBlock: referenceHeight + 16,
                ceremonyDeadline: referenceHeight + 1,
                seed: seedHex,
            });
            const participations = buildDevParticipations({
                definition,
                createdAt,
                deadlineBlock: current.deadlineBlock,
                seedHex,
                secretHex,
                seeds: [
                    {
                        suffix: "alpha",
                        actualScore: 71n,
                        creationHeightOffset: 1,
                        solverIdCreationOffset: 1,
                        status: "Submitted",
                    },
                    {
                        suffix: "beta",
                        actualScore: 78n,
                        creationHeightOffset: 2,
                        solverIdCreationOffset: 2,
                        status: "Submitted",
                    },
                ],
            });
            return { game: current, history: [original, current], participations };
        }
        case "playing": {
            const original = makeActive({
                boxIdSuffix: "created",
                creationHeight: createdAt,
                value: 3_000_000_000n,
                deadlineBlock: referenceHeight + 12,
                ceremonyDeadline: referenceHeight + 3,
                seed: repeatHex("ca"),
            });
            const current = makeActive({
                boxIdSuffix: "current",
                creationHeight: createdAt + 6,
                value: 4_100_000_000n,
                deadlineBlock: referenceHeight + 12,
                ceremonyDeadline: referenceHeight - 1,
                seed: seedHex,
            });
            const participations = buildDevParticipations({
                definition,
                createdAt,
                deadlineBlock: current.deadlineBlock,
                seedHex,
                secretHex,
                seeds: [
                    {
                        suffix: "alpha",
                        actualScore: 88n,
                        creationHeightOffset: 7,
                        solverIdCreationOffset: 2,
                        status: "Submitted",
                    },
                    {
                        suffix: "beta",
                        actualScore: 81n,
                        creationHeightOffset: 8,
                        solverIdCreationOffset: 3,
                        status: "Submitted",
                    },
                    {
                        suffix: "gamma",
                        actualScore: 69n,
                        creationHeightOffset: 9,
                        solverIdCreationOffset: 4,
                        status: "Malformed",
                        malformedReason: "invalidsolver",
                    },
                ],
            });
            return { game: current, history: [original, current], participations };
        }
        case "awaiting_resolution": {
            const original = makeActive({
                boxIdSuffix: "created",
                creationHeight: createdAt,
                value: 3_500_000_000n,
                deadlineBlock: referenceHeight - 6,
                ceremonyDeadline: referenceHeight - 12,
                seed: repeatHex("cc"),
            });
            const current = makeActive({
                boxIdSuffix: "current",
                creationHeight: referenceHeight - 1,
                value: 4_250_000_000n,
                deadlineBlock: referenceHeight - 1,
                ceremonyDeadline: referenceHeight - 10,
                seed: seedHex,
            });
            const participations = buildDevParticipations({
                definition,
                createdAt,
                deadlineBlock: current.deadlineBlock,
                seedHex,
                secretHex,
                seeds: [
                    {
                        suffix: "alpha",
                        actualScore: 92n,
                        creationHeightOffset: 6,
                        solverIdCreationOffset: 2,
                        status: "Submitted",
                    },
                    {
                        suffix: "beta",
                        actualScore: 87n,
                        creationHeightOffset: 8,
                        solverIdCreationOffset: 3,
                        status: "Submitted",
                    },
                ],
            });
            return { game: current, history: [original, current], participations };
        }
        case "suspended": {
            const deadlineBlock =
                referenceHeight - constants.PARTICIPATION_GRACE_PERIOD - 3;
            const current = makeActive({
                boxIdSuffix: "current",
                creationHeight:
                    deadlineBlock + constants.PARTICIPATION_GRACE_PERIOD,
                value: 3_750_000_000n,
                deadlineBlock,
                ceremonyDeadline: deadlineBlock - 8,
                seed: seedHex,
            });
            const participations = buildDevParticipations({
                definition,
                createdAt,
                deadlineBlock: current.deadlineBlock,
                seedHex,
                secretHex,
                seeds: [
                    {
                        suffix: "alpha",
                        actualScore: 68n,
                        creationHeightOffset: 5,
                        solverIdCreationOffset: 1,
                        status: "Submitted",
                    },
                    {
                        suffix: "beta",
                        actualScore: 75n,
                        creationHeightOffset: 6,
                        solverIdCreationOffset: 2,
                        status: "Consumed",
                        consumedReason: "byparticipant",
                    },
                ],
            });
            return { game: current, history: [current], participations };
        }
        case "judging": {
            const active = makeActive({
                boxIdSuffix: "active",
                creationHeight: createdAt,
                value: 4_200_000_000n,
                deadlineBlock: referenceHeight - 7,
                ceremonyDeadline: referenceHeight - 14,
                seed: repeatHex("ce"),
            });
            const participations = buildDevParticipations({
                definition,
                createdAt,
                deadlineBlock: active.deadlineBlock,
                seedHex,
                secretHex,
                seeds: [
                    {
                        suffix: "alpha",
                        actualScore: 91n,
                        creationHeightOffset: 5,
                        solverIdCreationOffset: 2,
                        status: "Submitted",
                    },
                    {
                        suffix: "beta",
                        actualScore: 84n,
                        creationHeightOffset: 6,
                        solverIdCreationOffset: 3,
                        status: "Submitted",
                    },
                    {
                        suffix: "gamma",
                        actualScore: 77n,
                        creationHeightOffset: 6,
                        solverIdCreationOffset: 2,
                        status: "Malformed",
                        malformedReason: "wrongcommitment",
                        wrongCommitment: true,
                    },
                    {
                        suffix: "delta",
                        actualScore: 63n,
                        creationHeightOffset: 7,
                        solverIdCreationOffset: 4,
                        status: "Consumed",
                        consumedReason: "invalidated",
                    },
                ],
            });
            const winnerCandidateCommitment =
                participations[0]?.commitmentC_Hex ?? null;
            const current = buildResolution({
                keySuffix: "current",
                creationHeight: referenceHeight - 2,
                value: 4_950_000_000n,
                deadlineBlock: active.deadlineBlock,
                resolutionDeadline: referenceHeight + 9,
                winnerCandidateCommitment,
                isEndGame: false,
            });
            return { game: current, history: [active, current], participations };
        }
        case "ready_to_finalize": {
            const active = makeActive({
                boxIdSuffix: "active",
                creationHeight: createdAt,
                value: 4_100_000_000n,
                deadlineBlock: referenceHeight - 11,
                ceremonyDeadline: referenceHeight - 18,
                seed: repeatHex("cf"),
            });
            const participations = buildDevParticipations({
                definition,
                createdAt,
                deadlineBlock: active.deadlineBlock,
                seedHex,
                secretHex,
                seeds: [
                    {
                        suffix: "alpha",
                        actualScore: 97n,
                        creationHeightOffset: 5,
                        solverIdCreationOffset: 2,
                        status: "Submitted",
                    },
                    {
                        suffix: "beta",
                        actualScore: 79n,
                        creationHeightOffset: 6,
                        solverIdCreationOffset: 3,
                        status: "Consumed",
                        consumedReason: "batched",
                    },
                    {
                        suffix: "gamma",
                        actualScore: 82n,
                        creationHeightOffset: 7,
                        solverIdCreationOffset: 4,
                        status: "Consumed",
                        consumedReason: "unavailable",
                    },
                ],
            });
            const winnerCandidateCommitment =
                participations[0]?.commitmentC_Hex ?? null;
            const current = buildResolution({
                keySuffix: "current",
                creationHeight: referenceHeight - 1,
                value: 5_300_000_000n,
                deadlineBlock: active.deadlineBlock,
                resolutionDeadline: referenceHeight - 1,
                winnerCandidateCommitment,
                isEndGame: true,
            });
            return { game: current, history: [active, current], participations };
        }
        case "cancelled_locked": {
            const active = makeActive({
                boxIdSuffix: "active",
                creationHeight: createdAt,
                value: 3_300_000_000n,
                deadlineBlock: referenceHeight + 20,
                ceremonyDeadline: referenceHeight + 8,
                seed: repeatHex("da"),
            });
            const current = buildCancellation({
                keySuffix: "current",
                creationHeight: referenceHeight - 2,
                value: 2_750_000_000n,
                deadlineBlock: referenceHeight + 20,
                unlockHeight: referenceHeight + 12,
            });
            const participations = buildDevParticipations({
                definition,
                createdAt,
                deadlineBlock: active.deadlineBlock,
                seedHex,
                secretHex,
                seeds: [
                    {
                        suffix: "alpha",
                        actualScore: 73n,
                        creationHeightOffset: 4,
                        solverIdCreationOffset: 2,
                        status: "Submitted",
                    },
                    {
                        suffix: "beta",
                        actualScore: 65n,
                        creationHeightOffset: 5,
                        solverIdCreationOffset: 3,
                        status: "Consumed",
                        consumedReason: "cancelled",
                    },
                ],
            });
            return { game: current, history: [active, current], participations };
        }
        case "cancelled_draining": {
            const active = makeActive({
                boxIdSuffix: "active",
                creationHeight: createdAt,
                value: 3_450_000_000n,
                deadlineBlock: referenceHeight + 15,
                ceremonyDeadline: referenceHeight + 6,
                seed: repeatHex("db"),
            });
            const current = buildCancellation({
                keySuffix: "current",
                creationHeight: referenceHeight - 3,
                value: 2_100_000_000n,
                deadlineBlock: referenceHeight + 15,
                unlockHeight: referenceHeight - 2,
            });
            const participations = buildDevParticipations({
                definition,
                createdAt,
                deadlineBlock: active.deadlineBlock,
                seedHex,
                secretHex,
                seeds: [
                    {
                        suffix: "alpha",
                        actualScore: 70n,
                        creationHeightOffset: 4,
                        solverIdCreationOffset: 1,
                        status: "Submitted",
                    },
                    {
                        suffix: "beta",
                        actualScore: 66n,
                        creationHeightOffset: 5,
                        solverIdCreationOffset: 2,
                        status: "Consumed",
                        consumedReason: "cancelled",
                    },
                ],
            });
            return { game: current, history: [active, current], participations };
        }
        case "finalized":
        case "finalized_aurora":
        case "finalized_zenith":
        case "finalized_gauntlet": {
            const finalizedConfig: Record<
                "finalized" | "finalized_aurora" | "finalized_zenith" | "finalized_gauntlet",
                {
                    activeValue: bigint;
                    resolutionValue: bigint;
                    finalizedValue: bigint;
                    baseScore: bigint;
                }
            > = {
                finalized: {
                    activeValue: 4_000_000_000n,
                    resolutionValue: 5_600_000_000n,
                    finalizedValue: 2_250_000_000n,
                    baseScore: 101n,
                },
                finalized_aurora: {
                    activeValue: 4_250_000_000n,
                    resolutionValue: 5_950_000_000n,
                    finalizedValue: 2_480_000_000n,
                    baseScore: 109n,
                },
                finalized_zenith: {
                    activeValue: 3_900_000_000n,
                    resolutionValue: 5_450_000_000n,
                    finalizedValue: 2_180_000_000n,
                    baseScore: 104n,
                },
                finalized_gauntlet: {
                    activeValue: 4_100_000_000n,
                    resolutionValue: 5_720_000_000n,
                    finalizedValue: 2_360_000_000n,
                    baseScore: 112n,
                },
            };
            const config = finalizedConfig[
                definition.key as
                    | "finalized"
                    | "finalized_aurora"
                    | "finalized_zenith"
                    | "finalized_gauntlet"
            ];
            const active = makeActive({
                boxIdSuffix: "active",
                creationHeight: createdAt,
                value: config.activeValue,
                deadlineBlock: referenceHeight - 25,
                ceremonyDeadline: referenceHeight - 35,
                seed: repeatHex("dc"),
            });
            const resolutionParticipations = buildDevParticipations({
                definition,
                createdAt,
                deadlineBlock: active.deadlineBlock,
                seedHex,
                secretHex,
                seeds: [
                    {
                        suffix: "alpha",
                        actualScore: config.baseScore,
                        creationHeightOffset: 5,
                        solverIdCreationOffset: 2,
                        status: "Consumed",
                        consumedReason: "bywinner",
                    },
                    {
                        suffix: "beta",
                        actualScore: config.baseScore - 15n,
                        creationHeightOffset: 6,
                        solverIdCreationOffset: 3,
                        status: "Consumed",
                        consumedReason: "abandoned",
                    },
                    {
                        suffix: "gamma",
                        actualScore: config.baseScore - 21n,
                        creationHeightOffset: 7,
                        solverIdCreationOffset: 4,
                        status: "Consumed",
                        consumedReason: "invalidated",
                    },
                ],
            });
            const winnerCandidateCommitment =
                resolutionParticipations[0]?.commitmentC_Hex ?? null;
            const resolution = buildResolution({
                keySuffix: "resolution",
                creationHeight: referenceHeight - 18,
                value: config.resolutionValue,
                deadlineBlock: active.deadlineBlock,
                resolutionDeadline: referenceHeight - 12,
                winnerCandidateCommitment,
                isEndGame: true,
            });
            const current = buildFinalized({
                keySuffix: "current",
                creationHeight: referenceHeight - 8,
                value: config.finalizedValue,
                deadlineBlock: active.deadlineBlock,
                judgeFinalizationBlock: resolution.resolutionDeadline,
                winnerFinalizationDeadline:
                    resolution.resolutionDeadline +
                    constants.END_GAME_AUTH_GRACE_PERIOD,
                winnerCandidateCommitment,
            });
            return {
                game: current,
                history: [active, resolution, current],
                participations: resolutionParticipations,
            };
        }
    }

    throw new Error(`Unknown dev competition scenario: ${definition.key}`);
}

export function getDevReferenceHeight(): number {
    if (cachedDevReferenceHeight !== null) {
        return cachedDevReferenceHeight;
    }

    cachedDevReferenceHeight = get(current_height) ?? DEFAULT_DEV_HEIGHT;
    current_height.set(cachedDevReferenceHeight);
    return cachedDevReferenceHeight;
}

export function isDevCompetitionId(gameId: string): boolean {
    return gameId.startsWith(DEV_GAME_ID_PREFIX);
}

export function getDevCompetition(gameId: string): AnyGame | null {
    const definition = DEV_COMPETITIONS.find((item) => item.gameId === gameId);
    if (!definition) return null;
    return buildScenarioState(definition, getDevReferenceHeight()).game;
}

export function getDevCompetitionHistory(gameId: string): AnyGame[] {
    const definition = DEV_COMPETITIONS.find((item) => item.gameId === gameId);
    if (!definition) return [];
    return buildScenarioState(definition, getDevReferenceHeight()).history;
}

export function getDevCompetitionParticipations(gameId: string): AnyParticipation[] {
    const definition = DEV_COMPETITIONS.find((item) => item.gameId === gameId);
    if (!definition) return [];
    return buildScenarioState(definition, getDevReferenceHeight()).participations;
}

export function buildDevCompetitionsMap(): Map<string, AnyGame> {
    const referenceHeight = getDevReferenceHeight();
    return new Map(
        DEV_COMPETITIONS.map((definition) => {
            const { game } = buildScenarioState(definition, referenceHeight);
            return [definition.gameId, game] as const;
        }),
    );
}
