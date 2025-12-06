import { beforeEach, describe, expect, it } from "vitest";
import { KeyedMockChainParty, MockChain, NonKeyedMockChainParty } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
  ErgoTree,
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  SAFE_MIN_BOX_VALUE,
  TransactionBuilder
} from "@fleet-sdk/core";
import {
  SBool,
  SByte,
  SColl,
  SInt,
  SLong,
  SPair
} from "@fleet-sdk/serializer";
import { blake2b256, randomBytes } from "@fleet-sdk/crypto";
import { stringToBytes } from "@scure/base";
import { prependHexPrefix } from "$lib/utils";
import { bigintToLongByteArray, hexToBytes } from "$lib/ergo/utils";
import { DefaultGameConstants } from "$lib/common/constants";
import { getGopGameResolutionErgoTree, getGopParticipationErgoTree, getReputationProofErgoTree } from "$lib/ergo/contract";

// --- Suite de Pruebas ---

const ERG_BASE_TOKEN = "ERG";
const ERG_BASE_TOKEN_NAME = "ERG";
const USD_BASE_TOKEN = "11".repeat(32);
const USD_BASE_TOKEN_NAME = "USD";

const baseModes = [
  { name: "ERG Mode", token: ERG_BASE_TOKEN, tokenName: ERG_BASE_TOKEN_NAME },
  { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

describe.each(baseModes)("Game Finalization (end_game) - (%s)", (mode) => {
  const mockChain = new MockChain({ height: 800_000 });

  const devErgoTree = DefaultGameConstants.DEV_SCRIPT;
  const gameResolutionErgoTree: ErgoTree = getGopGameResolutionErgoTree();
  const participationErgoTree: ErgoTree = getGopParticipationErgoTree();
  const reputationProofErgoTree: ErgoTree = getReputationProofErgoTree();


  let resolver: KeyedMockChainParty;
  let creator: KeyedMockChainParty;
  let winner: KeyedMockChainParty;
  let loser: KeyedMockChainParty;
  let developer: NonKeyedMockChainParty;

  // --- Constantes del Juego para la Prueba ---
  const deadline = 800_050;
  const resolutionDeadline = mockChain.height + 100;
  const creatorStake = 2_000_000n;
  const participationFee = 100_000_000n;
  const resolverCommissionPercent = 10;
  const seed = "a3f9b7e12c9d55ab8068e3ff22b7a19c34d8f1cbeaa1e9c0138b82f00d5ea712";


  // --- Variables para el Estado de la Prueba ---
  let gameNftId: string;
  let secret: Uint8Array;
  let winnerCommitment: string
  let loserCommitment: string;

  let gameResolutionContract: NonKeyedMockChainParty;
  let participationContract: NonKeyedMockChainParty;


  const createCommitment = (solverId: string, score: bigint, logs: Uint8Array, ergotree: Uint8Array, secret: Uint8Array): Uint8Array => {
    return blake2b256(new Uint8Array([...stringToBytes("utf8", solverId), ...hexToBytes(seed), ...bigintToLongByteArray(score), ...logs, ...ergotree, ...secret]));
  };

  const createParticipation = (
    ergotree: Uint8Array,
    commitment: string,
    solverId: string,
    hashLogs: Uint8Array,
    scoreList: bigint[]
  ) => {
    const assets = mode.token === ERG_BASE_TOKEN
      ? []
      : [{ tokenId: mode.token, amount: participationFee }];

    const value = mode.token === ERG_BASE_TOKEN
      ? participationFee
      : RECOMMENDED_MIN_FEE_VALUE;

    participationContract.addUTxOs({
      creationHeight: mockChain.height,
      value: value,
      ergoTree: participationErgoTree.toHex(),
      assets: assets,
      additionalRegisters: {
        R4: SColl(SByte, ergotree).toHex(),
        R5: SColl(SByte, commitment).toHex(),
        R6: SColl(SByte, gameNftId).toHex(),
        R7: SColl(SByte, Buffer.from(solverId, "utf8").toString("hex")).toHex(),
        R8: SColl(SByte, hashLogs).toHex(),
        R9: SColl(SLong, scoreList).toHex(),
      },
    });
  };

  beforeEach(() => {
    mockChain.reset({ clearParties: true });
    mockChain.jumpTo(800_000);

    // --- Partes Involucradas ---
    resolver = mockChain.newParty("Resolver");
    creator = mockChain.newParty("GameCreator");
    winner = mockChain.newParty("Winner");
    loser = mockChain.newParty("Loser");
    developer = mockChain.addParty(devErgoTree, "Developer");

    // --- Partes de Contrato en la MockChain ---
    gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolutionContract");
    participationContract = mockChain.addParty(participationErgoTree.toHex(), "ParticipationContract");

    // Asignar fondos a las partes para crear cajas y pagar tasas
    if (mode.token !== ERG_BASE_TOKEN) {
      creator.addBalance({
        tokens: [{ tokenId: mode.token, amount: creatorStake * 2n }],
        nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n
      });
      winner.addBalance({
        tokens: [{ tokenId: mode.token, amount: participationFee * 2n }],
        nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n
      });
    } else {
      creator.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });
      winner.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });
    }

    // Crear y distribuir el Game NFT
    gameNftId = "c94a63ec4e9ae8700c671a908bd2121d4c049cec75a40f1309e09ab59d0bbc71";

    secret = stringToBytes("utf8", "game-secret")


    // 1. Crear las cajas de participación (ganador y perdedor)

    const winnerSolverId = "player-alpha-7";
    const winnerTrueScore = 9500n;
    const winnerLogs = "Log del juego del ganador.";

    const winnerHashLogsBytes = blake2b256(stringToBytes("utf8", winnerLogs));

    const winnerScoreList = [1200n, 5000n, 9500n, 12000n];

    const winer_ergotree = prependHexPrefix(winner.address.getPublicKeys()[0])

    const winnerCommitmentBytes = createCommitment(winnerSolverId, winnerTrueScore, winnerHashLogsBytes, winer_ergotree, secret);
    winnerCommitment = Buffer.from(winnerCommitmentBytes).toString("hex");

    createParticipation(
      winer_ergotree,
      winnerCommitment,
      winnerSolverId,
      winnerHashLogsBytes,
      winnerScoreList
    );

    const loserSolverId = "player-beta-3";
    const loserTrueScore = 2100n;
    const loserLogs = "Log del juego para el perdedor: error en nivel 1.";

    const loserHashLogsBytes = blake2b256(stringToBytes("utf8", loserLogs));

    const loserScoreList = [500n, 1100n, 2100n, 3000n];

    const loser_ergotree = prependHexPrefix(loser.address.getPublicKeys()[0]);

    const loserCommitmentBytes = createCommitment(loserSolverId, loserTrueScore, loserHashLogsBytes, loser_ergotree, secret);
    loserCommitment = Buffer.from(loserCommitmentBytes).toString("hex");

    createParticipation(
      loser_ergotree,
      loserCommitment,
      loserSolverId,
      loserHashLogsBytes,
      loserScoreList
    );


    // 2. Crear la caja del juego en estado de resolución
    const gameDetailsJson = JSON.stringify({ title: "Test Game", description: "This is a test game." });

    const gameAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: creatorStake }] : [])
    ];

    const gameBoxValue = mode.token === ERG_BASE_TOKEN ? creatorStake : RECOMMENDED_MIN_FEE_VALUE;

    gameResolutionContract.addUTxOs({
      creationHeight: mockChain.height,
      value: gameBoxValue,
      ergoTree: gameResolutionErgoTree.toHex(),
      assets: gameAssets,
      additionalRegisters: {
        // Estado igual
        R4: SInt(1).toHex(),

        R5: SColl(SByte, hexToBytes(seed) || new Uint8Array(0)).toHex(),

        // (revealedSecretS, winnerCandidateCommitment)
        R6: SPair(SColl(SByte, secret), SColl(SByte, winnerCommitment)).toHex(),

        // participatingJudges (vacío)
        R7: SColl(SColl(SByte), []).toHex(),

        R8: SColl(SLong, [
          BigInt(deadline),
          creatorStake,
          participationFee,
          0n,                                       // perJudgeComissionPercentage
          BigInt(resolverCommissionPercent),        // creatorComissionPercentage
          BigInt(resolutionDeadline)
        ]).toHex(),

        // gameProvenance: [Detalles del juego, TokenId (si aplica), Script del resolvedor]
        R9: SColl(SColl(SByte), [
          stringToBytes('utf8', gameDetailsJson),                   // detalles del juego
          mode.token !== ERG_BASE_TOKEN ? (hexToBytes(mode.token) || new Uint8Array(0)) : new Uint8Array(0), // token id
          prependHexPrefix(resolver.key.publicKey, "0008cd")        // script del resolvedor
        ]).toHex()
      }
    });

  });

  it("Should successfully finalize the game and distribute funds correctly", () => {
    // --- Arrange ---
    mockChain.jumpTo(resolutionDeadline);
    const gameBox = gameResolutionContract.utxos.toArray()[0];
    const participationBoxes = participationContract.utxos;

    // --- Act ---
    const prizePool = participationBoxes.reduce((acc, p) => {
      if (mode.token === ERG_BASE_TOKEN) {
        return acc + p.value;
      } else {
        return acc + (p.assets.find(a => a.tokenId === mode.token)?.amount || 0n);
      }
    }, 0n);

    const resolverCommission = (prizePool * BigInt(resolverCommissionPercent)) / 100n;
    const devCommission = (prizePool * 5n) / 100n;
    const winnerBasePrize = prizePool - resolverCommission - devCommission;

    const finalWinnerPrize = winnerBasePrize;
    const finalResolverPayout = creatorStake + resolverCommission;
    const finalDevPayout = devCommission;

    const winnerAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: finalWinnerPrize }] : [])
    ];

    const resolverAssets = mode.token !== ERG_BASE_TOKEN
      ? [{ tokenId: mode.token, amount: finalResolverPayout }]
      : [];

    const devAssets = mode.token !== ERG_BASE_TOKEN
      ? [{ tokenId: mode.token, amount: finalDevPayout }]
      : [];

    const transaction = new TransactionBuilder(mockChain.height)
      .from([gameBox, ...participationBoxes.toArray(), ...winner.utxos.toArray()])
      .to([
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalWinnerPrize : RECOMMENDED_MIN_FEE_VALUE, winner.address).addTokens(winnerAssets),
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalResolverPayout : 2000000n, resolver.address).addTokens(resolverAssets),
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalDevPayout : RECOMMENDED_MIN_FEE_VALUE, developer.address).addTokens(devAssets),
      ])
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(winner.address)
      .build();

    // --- Assert ---
    expect(mockChain.execute(transaction, { signers: [winner] })).to.be.true;

    // Asertar el balance del ganador
    if (mode.token === ERG_BASE_TOKEN) {
      expect(winner.balance.nanoergs).to.equal(finalWinnerPrize);
      expect(developer.balance.nanoergs).to.equal(finalDevPayout);
      expect(resolver.balance.nanoergs).to.equal(finalResolverPayout);
    } else {
      const winnerTokenBalance = winner.balance.tokens.find(t => t.tokenId === mode.token)?.amount || 0n;
      expect(winnerTokenBalance).to.equal(finalWinnerPrize + 200_000_000n);

      const devTokenBalance = developer.balance.tokens.find(t => t.tokenId === mode.token)?.amount || 0n;
      expect(devTokenBalance).to.equal(finalDevPayout);

      const resolverTokenBalance = resolver.balance.tokens.find(t => t.tokenId === mode.token)?.amount || 0n;
      expect(resolverTokenBalance).to.equal(finalResolverPayout);
    }

    expect(creator.balance.nanoergs).to.equal(mode.token === ERG_BASE_TOKEN ? RECOMMENDED_MIN_FEE_VALUE : RECOMMENDED_MIN_FEE_VALUE * 10n);

    expect(winner.balance.tokens.find(t => t.tokenId === gameNftId)).toBeDefined();

    expect(gameResolutionContract.utxos.length).to.equal(0);
    expect(participationContract.utxos.length).to.equal(0);
  });

  it("Should successfully finalize the game and distribute funds correctly with a complex Script winner", () => {
    // --- Arrange ---
    // 1. Crear un contrato dummy para el ganador y un 'facilitador' que firmará la tx
    const dummyWinnerScript = compile("sigmaProp(true)"); // Un script que cualquiera puede gastar
    const winnerContract = mockChain.addParty(dummyWinnerScript.toHex(), "WinnerContract");
    const facilitator = mockChain.newParty("Facilitator");
    facilitator.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n });

    // 2. Crear una caja "prueba" que pertenece al contrato ganador. Gastar esta caja es la autorización.
    winnerContract.addUTxOs({
      creationHeight: mockChain.height,
      value: SAFE_MIN_BOX_VALUE,
      ergoTree: dummyWinnerScript.toHex(),
      assets: [],
      additionalRegisters: {},
    });
    const winnerProofBox = winnerContract.utxos.toArray()[0];

    participationContract.utxos.clear();

    const winnerSolverId = "player-alpha-7";
    const winnerTrueScore = 9500n;
    const winnerLogs = "Log del juego para el ganador: nivel 1 superado, nivel 2 superado.";

    const winnerHashLogsBytes = blake2b256(stringToBytes("utf8", winnerLogs));

    const winnerScoreList = [1200n, 5000n, 9500n, 12000n];

    const winnerCommitmentBytes = createCommitment(winnerSolverId, winnerTrueScore, winnerHashLogsBytes, dummyWinnerScript.bytes, secret);
    winnerCommitment = Buffer.from(winnerCommitmentBytes).toString("hex");

    const participationValue = mode.token === ERG_BASE_TOKEN ? participationFee : RECOMMENDED_MIN_FEE_VALUE;
    const participationAssets = mode.token === ERG_BASE_TOKEN ? [] : [{ tokenId: mode.token, amount: participationFee }];

    participationContract.addUTxOs({
      creationHeight: mockChain.height,
      value: participationValue,
      ergoTree: participationErgoTree.toHex(),
      assets: participationAssets,
      additionalRegisters: {
        R4: SColl(SByte, dummyWinnerScript.bytes).toHex(),
        R5: SColl(SByte, winnerCommitment).toHex(),
        R6: SColl(SByte, gameNftId).toHex(),
        R7: SColl(SByte, Buffer.from(winnerSolverId, "utf8").toString("hex")).toHex(),
        R8: SColl(SByte, winnerHashLogsBytes).toHex(),
        R9: SColl(SLong, winnerScoreList).toHex(),
      },
    });


    // Other participants
    participationContract.addUTxOs({
      creationHeight: mockChain.height,
      value: participationValue,
      ergoTree: participationErgoTree.toHex(),
      assets: participationAssets,
      additionalRegisters: {
        R4: SColl(SByte, dummyWinnerScript.bytes).toHex(),
        R5: SColl(SByte, "ab".repeat(32)).toHex(),
        R6: SColl(SByte, gameNftId).toHex(),
        R7: SColl(SByte, Buffer.from(winnerSolverId, "utf8").toString("hex")).toHex(),
        R8: SColl(SByte, winnerHashLogsBytes).toHex(),
        R9: SColl(SLong, winnerScoreList).toHex(),
      },
    });

    participationContract.addUTxOs({
      creationHeight: mockChain.height,
      value: participationValue,
      ergoTree: participationErgoTree.toHex(),
      assets: participationAssets,
      additionalRegisters: {
        R4: SColl(SByte, dummyWinnerScript.bytes).toHex(),
        R5: SColl(SByte, "cd".repeat(32)).toHex(),
        R6: SColl(SByte, gameNftId).toHex(),
        R7: SColl(SByte, Buffer.from(winnerSolverId, "utf8").toString("hex")).toHex(),
        R8: SColl(SByte, winnerHashLogsBytes).toHex(),
        R9: SColl(SLong, winnerScoreList).toHex(),
      },
    });

    mockChain.jumpTo(resolutionDeadline + 1);

    gameResolutionContract.utxos.clear();

    const gameDetailsJson = JSON.stringify({ title: "Test Game", description: "This is a test game." });

    const gameAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: creatorStake }] : [])
    ];
    const gameBoxValue = mode.token === ERG_BASE_TOKEN ? creatorStake : RECOMMENDED_MIN_FEE_VALUE;

    gameResolutionContract.addUTxOs({
      creationHeight: mockChain.height,
      value: gameBoxValue,
      ergoTree: gameResolutionErgoTree.toHex(),
      assets: gameAssets,
      additionalRegisters: {
        R4: SInt(1).toHex(),

        R5: SColl(SByte, hexToBytes(seed) || new Uint8Array(0)).toHex(),

        R6: SPair(
          SColl(SByte, secret),
          SColl(SByte, winnerCommitment)
        ).toHex(),

        R7: SColl(SColl(SByte), []).toHex(),

        R8: SColl(SLong, [
          BigInt(deadline),
          creatorStake,
          participationFee,
          0n,        // perJudgeComissionPercentage
          BigInt(resolverCommissionPercent), // creatorComissionPercentage
          BigInt(resolutionDeadline)
        ]).toHex(),

        // gameProvenance:
        R9: SColl(SColl(SByte), [
          stringToBytes('utf8', gameDetailsJson),                  // Detalles del juego
          mode.token !== ERG_BASE_TOKEN ? (hexToBytes(mode.token) || new Uint8Array(0)) : new Uint8Array(0),
          prependHexPrefix(resolver.key.publicKey, "0008cd")      // Script del resolvedor
        ]).toHex()
      },
    });

    const gameBox = gameResolutionContract.utxos.toArray()[0];
    const finalParticipationBoxes = participationContract.utxos.toArray();

    // --- Act ---
    const prizePool = finalParticipationBoxes.reduce((acc, p) => {
      if (mode.token === ERG_BASE_TOKEN) {
        return acc + p.value;
      } else {
        return acc + (p.assets.find(a => a.tokenId === mode.token)?.amount || 0n);
      }
    }, 0n);

    const resolverCommission = (prizePool * BigInt(resolverCommissionPercent)) / 100n;
    const devCommission = (prizePool * 5n) / 100n;
    const winnerBasePrize = prizePool - resolverCommission - devCommission;

    const finalWinnerPrize = winnerBasePrize;
    const finalResolverPayout = creatorStake + resolverCommission;
    const finalDevPayout = devCommission;

    const winnerAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: finalWinnerPrize }] : [])
    ];

    const resolverAssets = mode.token !== ERG_BASE_TOKEN
      ? [{ tokenId: mode.token, amount: finalResolverPayout }]
      : [];

    const devAssets = mode.token !== ERG_BASE_TOKEN
      ? [{ tokenId: mode.token, amount: finalDevPayout }]
      : [];

    const transaction = new TransactionBuilder(mockChain.height)
      // Se incluye la caja 'winnerProofBox' como entrada para probar la autorización
      .from([gameBox, ...finalParticipationBoxes, winnerProofBox, ...facilitator.utxos.toArray()])
      .to([
        // El premio se envía a la dirección del contrato ganador
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalWinnerPrize : 2000000n, winnerContract.address).addTokens(winnerAssets),
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalResolverPayout : 2000000n, resolver.address).addTokens(resolverAssets),
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalDevPayout : 2000000n, developer.address).addTokens(devAssets),
      ])
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(facilitator.address) // El cambio va al firmante (facilitator)
      .build();

    // --- Assert ---
    // El 'facilitator' firma la transacción, pero la validez la da el gasto de 'winnerProofBox'
    expect(mockChain.execute(transaction, { signers: [facilitator] })).to.be.true;

    // El contrato ganador recibe el premio. Su balance inicial de SAFE_MIN_BOX_VALUE fue gastado.
    if (mode.token === ERG_BASE_TOKEN) {
      expect(winnerContract.balance.nanoergs).to.equal(finalWinnerPrize);
      expect(developer.balance.nanoergs).to.equal(finalDevPayout);
      expect(resolver.balance.nanoergs).to.equal(finalResolverPayout);
    } else {
      const winnerTokenBalance = winnerContract.balance.tokens.find(t => t.tokenId === mode.token)?.amount || 0n;
      expect(winnerTokenBalance).to.equal(finalWinnerPrize);

      const devTokenBalance = developer.balance.tokens.find(t => t.tokenId === mode.token)?.amount || 0n;
      expect(devTokenBalance).to.equal(finalDevPayout);

      const resolverTokenBalance = resolver.balance.tokens.find(t => t.tokenId === mode.token)?.amount || 0n;
      expect(resolverTokenBalance).to.equal(finalResolverPayout);
    }

    expect(winnerContract.balance.tokens.find(t => t.tokenId === gameNftId)).toBeDefined();

    expect(gameResolutionContract.utxos.length).to.equal(0);
    expect(participationContract.utxos.length).to.equal(0);
  });

  it("Should successfully finalize the game and distribute funds correctly with only a complex Script winner (unique participation)", () => {
    // --- Arrange ---
    // 1. Crear un contrato dummy para el ganador y un 'facilitador' que firmará la tx
    const dummyWinnerScript = compile("sigmaProp(true)"); // Un script que cualquiera puede gastar
    const winnerContract = mockChain.addParty(dummyWinnerScript.toHex(), "WinnerContract");
    const facilitator = mockChain.newParty("Facilitator");
    facilitator.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n });

    // 2. Crear una caja "prueba" que pertenece al contrato ganador. Gastar esta caja es la autorización.
    winnerContract.addUTxOs({
      creationHeight: mockChain.height,
      value: SAFE_MIN_BOX_VALUE,
      ergoTree: dummyWinnerScript.toHex(),
      assets: [],
      additionalRegisters: {},
    });
    const winnerProofBox = winnerContract.utxos.toArray()[0];

    participationContract.utxos.clear();

    const winnerSolverId = "player-alpha-7";
    const winnerTrueScore = 9500n;
    const winnerLogs = "Log del juego para el ganador: nivel 1 superado, nivel 2 superado.";

    const winnerHashLogsBytes = blake2b256(stringToBytes("utf8", winnerLogs));

    const winnerScoreList = [1200n, 5000n, 9500n, 12000n];

    const winnerCommitmentBytes = createCommitment(winnerSolverId, winnerTrueScore, winnerHashLogsBytes, dummyWinnerScript.bytes, secret);
    winnerCommitment = Buffer.from(winnerCommitmentBytes).toString("hex");

    const participationValue = mode.token === ERG_BASE_TOKEN ? participationFee : RECOMMENDED_MIN_FEE_VALUE;
    const participationAssets = mode.token === ERG_BASE_TOKEN ? [] : [{ tokenId: mode.token, amount: participationFee }];

    participationContract.addUTxOs({
      creationHeight: mockChain.height,
      value: participationValue,
      ergoTree: participationErgoTree.toHex(),
      assets: participationAssets,
      additionalRegisters: {
        R4: SColl(SByte, dummyWinnerScript.bytes).toHex(),
        R5: SColl(SByte, winnerCommitment).toHex(),
        R6: SColl(SByte, gameNftId).toHex(),
        R7: SColl(SByte, Buffer.from(winnerSolverId, "utf8").toString("hex")).toHex(),
        R8: SColl(SByte, winnerHashLogsBytes).toHex(),
        R9: SColl(SLong, winnerScoreList).toHex(),
      },
    });

    mockChain.jumpTo(resolutionDeadline + 1);

    gameResolutionContract.utxos.clear();

    const gameDetailsJson = JSON.stringify({ title: "Test Game", description: "This is a test game." });

    const gameAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: creatorStake }] : [])
    ];
    const gameBoxValue = mode.token === ERG_BASE_TOKEN ? creatorStake : RECOMMENDED_MIN_FEE_VALUE;

    gameResolutionContract.addUTxOs({
      creationHeight: mockChain.height,
      value: gameBoxValue,
      ergoTree: gameResolutionErgoTree.toHex(),
      assets: gameAssets,
      additionalRegisters: {
        R4: SInt(1).toHex(),

        R5: SColl(SByte, hexToBytes(seed) || new Uint8Array(0)).toHex(),

        R6: SPair(
          SColl(SByte, secret),
          SColl(SByte, winnerCommitment)
        ).toHex(),

        R7: SColl(SColl(SByte), []).toHex(),

        R8: SColl(SLong, [
          BigInt(deadline),
          creatorStake,
          participationFee,
          0n,        // perJudgeComissionPercentage
          BigInt(resolverCommissionPercent), // creatorComissionPercentage
          BigInt(resolutionDeadline)
        ]).toHex(),

        // gameProvenance:
        R9: SColl(SColl(SByte), [
          stringToBytes('utf8', gameDetailsJson),                  // Detalles del juego
          mode.token !== ERG_BASE_TOKEN ? (hexToBytes(mode.token) || new Uint8Array(0)) : new Uint8Array(0),
          prependHexPrefix(resolver.key.publicKey, "0008cd")      // Script del resolvedor
        ]).toHex()
      },
    });

    const gameBox = gameResolutionContract.utxos.toArray()[0];
    const finalParticipationBoxes = participationContract.utxos.toArray();

    // --- Act ---
    const prizePool = finalParticipationBoxes.reduce((acc, p) => {
      if (mode.token === ERG_BASE_TOKEN) {
        return acc + p.value;
      } else {
        return acc + (p.assets.find(a => a.tokenId === mode.token)?.amount || 0n);
      }
    }, 0n);


    let resolverCommission = (prizePool * BigInt(resolverCommissionPercent)) / 100n;
    let devCommission = (prizePool * 5n) / 100n;
    let winnerBasePrize = prizePool - resolverCommission - devCommission;

    if (winnerBasePrize < participationFee) { 
      resolverCommission = 0n;
      devCommission = 0n;
      winnerBasePrize = prizePool;
    }

    const finalWinnerPrize = winnerBasePrize;
    const finalResolverPayout = creatorStake + resolverCommission;
    const finalDevPayout = devCommission;

    const winnerAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: finalWinnerPrize }] : [])
    ];

    const resolverAssets = mode.token !== ERG_BASE_TOKEN
      ? [{ tokenId: mode.token, amount: finalResolverPayout }]
      : [];

    const devAssets = mode.token !== ERG_BASE_TOKEN
      ? [{ tokenId: mode.token, amount: finalDevPayout }]
      : [];

    const transaction = new TransactionBuilder(mockChain.height)
      // Se incluye la caja 'winnerProofBox' como entrada para probar la autorización
      .from([gameBox, ...finalParticipationBoxes, winnerProofBox, ...facilitator.utxos.toArray()])
      .to([
        // El premio se envía a la dirección del contrato ganador
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalWinnerPrize : 2000000n, winnerContract.address).addTokens(winnerAssets),
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalResolverPayout : 2000000n, resolver.address).addTokens(resolverAssets),
        ...(finalDevPayout > 0n ? [new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalDevPayout : 2000000n, developer.address).addTokens(devAssets)] : []),
      ])
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(facilitator.address) // El cambio va al firmante (facilitator)
      .build();

    // --- Assert ---
    // El 'facilitator' firma la transacción, pero la validez la da el gasto de 'winnerProofBox'
    expect(mockChain.execute(transaction, { signers: [facilitator] })).to.be.true;

    // El contrato ganador recibe el premio. Su balance inicial de SAFE_MIN_BOX_VALUE fue gastado.
    if (mode.token === ERG_BASE_TOKEN) {
      expect(winnerContract.balance.nanoergs).to.equal(finalWinnerPrize);
      expect(developer.balance.nanoergs).to.equal(finalDevPayout);
      expect(resolver.balance.nanoergs).to.equal(finalResolverPayout);
    } else {
      const winnerTokenBalance = winnerContract.balance.tokens.find(t => t.tokenId === mode.token)?.amount || 0n;
      expect(winnerTokenBalance).to.equal(finalWinnerPrize);

      const devTokenBalance = developer.balance.tokens.find(t => t.tokenId === mode.token)?.amount || 0n;
      expect(devTokenBalance).to.equal(finalDevPayout);

      const resolverTokenBalance = resolver.balance.tokens.find(t => t.tokenId === mode.token)?.amount || 0n;
      expect(resolverTokenBalance).to.equal(finalResolverPayout);
    }

    expect(winnerContract.balance.tokens.find(t => t.tokenId === gameNftId)).toBeDefined();

    expect(gameResolutionContract.utxos.length).to.equal(0);
    expect(participationContract.utxos.length).to.equal(0);
  });

  it("Should fail finalize the game and distribute funds with only a complex Script winner  (unique participation) but sending comissions to resolver and developer", () => {
    // --- Arrange ---
    // 1. Crear un contrato dummy para el ganador y un 'facilitador' que firmará la tx
    const dummyWinnerScript = compile("sigmaProp(true)"); // Un script que cualquiera puede gastar
    const winnerContract = mockChain.addParty(dummyWinnerScript.toHex(), "WinnerContract");
    const facilitator = mockChain.newParty("Facilitator");
    facilitator.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n });

    // 2. Crear una caja "prueba" que pertenece al contrato ganador. Gastar esta caja es la autorización.
    winnerContract.addUTxOs({
      creationHeight: mockChain.height,
      value: SAFE_MIN_BOX_VALUE,
      ergoTree: dummyWinnerScript.toHex(),
      assets: [],
      additionalRegisters: {},
    });
    const winnerProofBox = winnerContract.utxos.toArray()[0];

    participationContract.utxos.clear();

    const winnerSolverId = "player-alpha-7";
    const winnerTrueScore = 9500n;
    const winnerLogs = "Log del juego para el ganador: nivel 1 superado, nivel 2 superado.";

    const winnerHashLogsBytes = blake2b256(stringToBytes("utf8", winnerLogs));

    const winnerScoreList = [1200n, 5000n, 9500n, 12000n];

    const winnerCommitmentBytes = createCommitment(winnerSolverId, winnerTrueScore, winnerHashLogsBytes, dummyWinnerScript.bytes, secret);
    winnerCommitment = Buffer.from(winnerCommitmentBytes).toString("hex");

    const participationValue = mode.token === ERG_BASE_TOKEN ? participationFee : RECOMMENDED_MIN_FEE_VALUE;
    const participationAssets = mode.token === ERG_BASE_TOKEN ? [] : [{ tokenId: mode.token, amount: participationFee }];

    participationContract.addUTxOs({
      creationHeight: mockChain.height,
      value: participationValue,
      ergoTree: participationErgoTree.toHex(),
      assets: participationAssets,
      additionalRegisters: {
        R4: SColl(SByte, dummyWinnerScript.bytes).toHex(),
        R5: SColl(SByte, winnerCommitment).toHex(),
        R6: SColl(SByte, gameNftId).toHex(),
        R7: SColl(SByte, Buffer.from(winnerSolverId, "utf8").toString("hex")).toHex(),
        R8: SColl(SByte, winnerHashLogsBytes).toHex(),
        R9: SColl(SLong, winnerScoreList).toHex(),
      },
    });

    mockChain.jumpTo(resolutionDeadline + 1);

    gameResolutionContract.utxos.clear();

    const gameDetailsJson = JSON.stringify({ title: "Test Game", description: "This is a test game." });

    const gameAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: creatorStake }] : [])
    ];
    const gameBoxValue = mode.token === ERG_BASE_TOKEN ? creatorStake : RECOMMENDED_MIN_FEE_VALUE;

    gameResolutionContract.addUTxOs({
      creationHeight: mockChain.height,
      value: gameBoxValue,
      ergoTree: gameResolutionErgoTree.toHex(),
      assets: gameAssets,
      additionalRegisters: {
        R4: SInt(1).toHex(),

        R5: SColl(SByte, hexToBytes(seed) || new Uint8Array(0)).toHex(),

        R6: SPair(
          SColl(SByte, secret),
          SColl(SByte, winnerCommitment)
        ).toHex(),

        // participatingJudges (vacío)
        R7: SColl(SColl(SByte), []).toHex(),

        // numericalParameters:
        R8: SColl(SLong, [
          BigInt(deadline),
          creatorStake,
          participationFee,
          0n,        // perJudgeComissionPercentage
          BigInt(resolverCommissionPercent),        // creatorComissionPercentage
          BigInt(resolutionDeadline)
        ]).toHex(),

        R9: SColl(SColl(SByte), [
          stringToBytes('utf8', gameDetailsJson),             // Detalles del juego
          mode.token !== ERG_BASE_TOKEN ? (hexToBytes(mode.token) || new Uint8Array(0)) : new Uint8Array(0),
          prependHexPrefix(resolver.key.publicKey, "0008cd") // Script del resolvedor
        ]).toHex()
      },
    });

    const gameBox = gameResolutionContract.utxos.toArray()[0];
    const finalParticipationBoxes = participationContract.utxos.toArray();

    // --- Act ---
    const prizePool = finalParticipationBoxes.reduce((acc, p) => {
      if (mode.token === ERG_BASE_TOKEN) {
        return acc + p.value;
      } else {
        return acc + (p.assets.find(a => a.tokenId === mode.token)?.amount || 0n);
      }
    }, 0n);

    const resolverCommission = (prizePool * BigInt(resolverCommissionPercent)) / 100n;
    const devCommission = (prizePool * 5n) / 100n;
    const winnerBasePrize = prizePool - resolverCommission - devCommission;

    const finalWinnerPrize = winnerBasePrize;
    const finalResolverPayout = creatorStake + resolverCommission;
    const finalDevPayout = devCommission;

    const winnerAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: finalWinnerPrize }] : [])
    ];

    const resolverAssets = mode.token !== ERG_BASE_TOKEN
      ? [{ tokenId: mode.token, amount: finalResolverPayout }]
      : [];

    const devAssets = mode.token !== ERG_BASE_TOKEN
      ? [{ tokenId: mode.token, amount: finalDevPayout }]
      : [];

    const transaction = new TransactionBuilder(mockChain.height)
      // Se incluye la caja 'winnerProofBox' como entrada para probar la autorización
      .from([gameBox, ...finalParticipationBoxes, winnerProofBox, ...facilitator.utxos.toArray()])
      .to([
        // El premio se envía a la dirección del contrato ganador
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalWinnerPrize : 2000000n, winnerContract.address).addTokens(winnerAssets),
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalResolverPayout : 2000000n, resolver.address).addTokens(resolverAssets),
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalDevPayout : RECOMMENDED_MIN_FEE_VALUE, developer.address).addTokens(devAssets),
      ])
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(facilitator.address) // El cambio va al firmante (facilitator)
      .build();

    // --- Assert ---
    expect(mockChain.execute(transaction, { signers: [facilitator], throw: false })).to.be.false;
  });


  it("Should correctly distribute commissions to participating judges when finalizing the game", () => {
    // --- Arrange (Preparación del Escenario con Jueces) ---

    // 1. Crear actores y contratos. Es crucial añadir el contrato de `reputation_proof`
    //    para poder añadirle las cajas de los jueces.
    const judge1 = mockChain.newParty("Judge1");
    const judge2 = mockChain.newParty("Judge2");

    // Compilamos el ErgoTree de `reputation_proof` para poder añadirlo a la mockChain
    const reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProofContract");

    // 2. Crear tokens de reputación y hashes de scripts para los jueces.
    const judge1ReputationTokenId = Buffer.from(randomBytes(32)).toString("hex");
    const judge2ReputationTokenId = Buffer.from(randomBytes(32)).toString("hex");
    const judge1Script = prependHexPrefix(judge1.address.getPublicKeys()[0]);
    const judge2Script = prependHexPrefix(judge2.address.getPublicKeys()[0]);


    // 3. Crear las cajas de reputación de los jueces AÑADIÉNDOLAS AL ESTADO de la mockChain.
    //    Este es el cambio clave. Estas cajas ahora existen "en la cadena" antes de la Tx.
    const dummyTypeNftId = "f6819e0b7cf99c8c7872b62f4985b8d900c6150925d01eb279787517a848b6d8";
    reputationProofContract.addUTxOs(
      { // Voto del Juez 1
        creationHeight: mockChain.height - 10,
        ergoTree: reputationProofErgoTree.toHex(),
        value: RECOMMENDED_MIN_FEE_VALUE,
        assets: [{ tokenId: judge1ReputationTokenId, amount: 1n }],
        additionalRegisters: {
          R4: SColl(SByte, stringToBytes("hex", dummyTypeNftId)).toHex(),
          R5: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(), // Vinculada al juego
          R6: SBool(true).toHex(), // Votó 'true'
          R7: SColl(SByte, judge1Script).toHex(), // Hash de su script de pago
          R8: SBool(true).toHex(),
          R9: SColl(SByte, new Uint8Array(0)).toHex()
        }
      });

    reputationProofContract.addUTxOs(
      { // Voto del Juez 2
        creationHeight: mockChain.height - 10,
        ergoTree: reputationProofErgoTree.toHex(),
        value: RECOMMENDED_MIN_FEE_VALUE,
        assets: [{ tokenId: judge2ReputationTokenId, amount: 1n }],
        additionalRegisters: {
          R4: SColl(SByte, stringToBytes("hex", dummyTypeNftId)).toHex(),
          R5: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
          R6: SBool(true).toHex(),
          R7: SColl(SByte, judge2Script).toHex(), // Hash de su script de pago
          R8: SBool(true).toHex(),
          R9: SColl(SByte, new Uint8Array(0)).toHex()
        }
      }
    );
    const [judge1ReputationBox, judge2ReputationBox] = reputationProofContract.utxos.toArray();

    // 4. Configurar la caja del juego para incluir a los jueces.
    gameResolutionContract.utxos.clear();
    const perJudgeCommissionPercent = 5n;
    const gameDetailsJson = JSON.stringify({ title: "Test Game", description: "This is a test game." });
    const judgesTokenIds = [judge1ReputationTokenId, judge2ReputationTokenId].map(id => Buffer.from(id, "hex"));

    gameResolutionContract.addUTxOs({
      creationHeight: mockChain.height,
      value: creatorStake,
      ergoTree: gameResolutionErgoTree.toHex(),
      assets: [{ tokenId: gameNftId, amount: 1n }],
      additionalRegisters: {
        // Estado del juego
        R4: SInt(1).toHex(),

        R5: SColl(SByte, hexToBytes(seed) || new Uint8Array(0)).toHex(),

        // (revealedSecretS, winnerCandidateCommitment)
        R6: SPair(
          SColl(SByte, secret),
          SColl(SByte, winnerCommitment)
        ).toHex(),

        // participatingJudges (lista de tokens de reputación de los jueces)
        R7: SColl(SColl(SByte), judgesTokenIds).toHex(),

        // numericalParameters: [deadline, creatorStake, participationFee, perJudgeCommissionPercent, creatorComissionPercentage, resolutionDeadline]
        R8: SColl(SLong, [
          BigInt(deadline),              // deadline
          creatorStake,                  // creator stake
          participationFee,              // participation fee
          perJudgeCommissionPercent,     // per-judge commission
          BigInt(resolverCommissionPercent),                            // creatorComissionPercentage
          BigInt(resolutionDeadline)     // resolution deadline
        ]).toHex(),

        // gameProvenance (R9) corregido: Coll[Coll[Byte]] con elementos planos
        R9: SColl(SColl(SByte), [
          stringToBytes('utf8', gameDetailsJson),             // detalles del juego
          "",
          prependHexPrefix(resolver.key.publicKey, "0008cd") // script resolvedor
        ]).toHex()
      },
    });


    mockChain.jumpTo(resolutionDeadline);
    const gameBox = gameResolutionContract.utxos.toArray()[0];
    const participationBoxes = participationContract.utxos;

    // --- Act (Cálculos y Construcción de la Transacción) ---

    const prizePool = participationBoxes.reduce((acc, p) => {
      if (mode.token === ERG_BASE_TOKEN) {
        return acc + p.value;
      } else {
        return acc + (p.assets.find(a => a.tokenId === mode.token)?.amount || 0n);
      }
    }, 0n);
    const resolverCommission = (prizePool * BigInt(resolverCommissionPercent)) / 100n;
    const devCommission = (prizePool * 5n) / 100n;
    const judgeCount = BigInt(judgesTokenIds.length);

    // Dust constants (adjust to match script's MIN_ERG_BOX)
    const MIN_ERG_BOX = 1000000n; // Example; use your actual value
    const dustThreshold = mode.token === ERG_BASE_TOKEN ? MIN_ERG_BOX : 0n;

    // Dev forfeits
    const devForfeits = (devCommission < dustThreshold && devCommission > 0n) ? devCommission : 0n;
    const finalDevPayout = devCommission - devForfeits;

    // Fix: perJudgeCommissionPercent is PER JUDGE.
    const totalJudgeCommission = (prizePool * perJudgeCommissionPercent * BigInt(judgeCount)) / 100n;
    const perJudgeCommission = totalJudgeCommission / judgeCount;

    // Judges forfeits (forfeit ALL if per-judge is dust)
    const judgesForfeits = (perJudgeCommission < dustThreshold && perJudgeCommission > 0n) ? totalJudgeCommission : 0n;
    const finalJudgesPayout = totalJudgeCommission - judgesForfeits;
    const perJudgePayout = (finalJudgesPayout > 0n) ? (finalJudgesPayout / judgeCount) : 0n; // Only used if not forfeited

    // Winner base (after dev/judge forfeits)
    const winnerBasePrize = prizePool - resolverCommission - finalJudgesPayout - finalDevPayout;

    // Additional winner/resolver dust handling
    const winnerGetsBasePrize = winnerBasePrize >= dustThreshold;
    const intermediateWinnerPayout = winnerGetsBasePrize ? winnerBasePrize : 0n;
    const intermediateResolverPayout = winnerGetsBasePrize ? creatorStake + resolverCommission : creatorStake;

    // Resolver forfeits
    const resolverForfeits = (intermediateResolverPayout < dustThreshold && intermediateResolverPayout > 0n) ? intermediateResolverPayout : 0n;
    const finalResolverPayout = intermediateResolverPayout - resolverForfeits;

    // Final winner gets base + resolver forfeits
    const finalWinnerPrize = intermediateWinnerPayout + resolverForfeits;

    // Now build outputs conditionally (skip dust outputs)
    // Now build outputs conditionally (skip dust outputs)
    const outputs = [
      new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalWinnerPrize : RECOMMENDED_MIN_FEE_VALUE, winner.address)
        .addTokens([
          { tokenId: gameNftId, amount: 1n },
          ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: finalWinnerPrize }] : [])
        ]),
      new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalResolverPayout : RECOMMENDED_MIN_FEE_VALUE, resolver.address)
        .addTokens(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: finalResolverPayout }] : []),
    ];

    if (finalDevPayout > 0n) {
      outputs.push(
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalDevPayout : RECOMMENDED_MIN_FEE_VALUE, developer.address)
          .addTokens(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: finalDevPayout }] : [])
      );
    }

    if (finalJudgesPayout > 0n) {
      // Assuming one judge for simplicity; loop over judgesTokenIds if multiple
      outputs.push(
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? perJudgePayout : RECOMMENDED_MIN_FEE_VALUE, judge1.address)
          .addTokens(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: perJudgePayout }] : [])
      );
      outputs.push(
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? perJudgePayout : RECOMMENDED_MIN_FEE_VALUE, judge2.address)
          .addTokens(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: perJudgePayout }] : [])
      );
    }

    const transaction = new TransactionBuilder(mockChain.height)
      .from([gameBox, ...participationBoxes.toArray(), ...winner.utxos.toArray()])
      .withDataFrom([judge1ReputationBox, judge2ReputationBox])
      .to(outputs)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(winner.address)
      .build();



    // --- Assert (Verificación) ---
    expect(mockChain.execute(transaction, { signers: [winner] })).to.be.true;

    // Verificamos los balances de todos, incluyendo los jueces
    if (mode.token === ERG_BASE_TOKEN) {
      expect(winner.balance.nanoergs).to.equal(finalWinnerPrize); // + initial - fee - fee
      expect(developer.balance.nanoergs).to.equal(finalDevPayout);
      expect(resolver.balance.nanoergs).to.equal(finalResolverPayout);
    } else {
      const winnerTokenBalance = winner.balance.tokens.find(t => t.tokenId === mode.token)?.amount || 0n;
      expect(winnerTokenBalance).to.equal(finalWinnerPrize + 200_000_000n); // + initial

      const devTokenBalance = developer.balance.tokens.find(t => t.tokenId === mode.token)?.amount || 0n;
      expect(devTokenBalance).to.equal(finalDevPayout);

      const resolverTokenBalance = resolver.balance.tokens.find(t => t.tokenId === mode.token)?.amount || 0n;
      expect(resolverTokenBalance).to.equal(finalResolverPayout);
    }

    expect(gameResolutionContract.utxos.length).to.equal(0);
    expect(participationContract.utxos.length).to.equal(0);
  });

});
