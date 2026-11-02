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
import { DefaultGameConstants, ENDING_GAME_STATE, GAME_NFT_AMOUNT, GAME_TROPHY_AMOUNT, getGameConstants } from "$lib/common/constants";
import { DEV_COMMISSION_PERCENTAGE, DEV_SCRIPT } from "$lib/ergo/envs";

const COMMISSION_DENOMINATOR = getGameConstants().COMMISSION_DENOMINATOR;
import { getGopGameResolutionErgoTree, getGopParticipationErgoTree, getReputationProofErgoTree, getGopJudgesPaidErgoTree, getGopJudgesPaidErgoTreeHex, getGopParticipationBatchErgoTree, getGopEndGameErgoTree } from "$lib/ergo/contract";

// --- Suite de Pruebas ---

const ERG_BASE_TOKEN = "";
const ERG_BASE_TOKEN_NAME = "ERG";
const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD";

const CREATOR_SLASH_RATIO = BigInt(COMMISSION_DENOMINATOR);

const baseModes = [
  { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

describe.each(baseModes)("End game security - (%s)", (mode) => {
  const mockChain = new MockChain({ height: 800_000 });

  const devErgoTree = DEV_SCRIPT;
  const gameResolutionErgoTree: ErgoTree = getGopGameResolutionErgoTree();
  const participationErgoTree: ErgoTree = getGopParticipationErgoTree();
  const participationBatchErgoTree: ErgoTree = getGopParticipationBatchErgoTree();
  const endGameErgoTree: ErgoTree = getGopEndGameErgoTree();
  const reputationProofErgoTree: ErgoTree = getReputationProofErgoTree();


  let resolver: KeyedMockChainParty;
  let creator: KeyedMockChainParty;
  let winner: KeyedMockChainParty;
  let loser: KeyedMockChainParty;
  let developer: NonKeyedMockChainParty;

  // --- Constantes del Juego para la Prueba ---
  const deadline = 800_050;
  const resolutionDeadline = mockChain.height + 100;
  const resolverStake = 2_000_000n;
  const participationFee = 100_000_000n;
  const resolverCommissionPercent = 100000;
  const seed = "a3f9b7e12c9d55ab8068e3ff22b7a19c34d8f1cbeaa1e9c0138b82f00d5ea712";


  // --- Variables para el Estado de la Prueba ---
  let gameNftId: string;
  let secret: Uint8Array;
  let winnerCommitment: string
  let loserCommitment: string;

  let gameResolutionContract: NonKeyedMockChainParty;
  let participationContract: NonKeyedMockChainParty;
  let participationBatchContract: NonKeyedMockChainParty;
  let endGameContract: NonKeyedMockChainParty;


  const createCommitment = (solverId: string, score: bigint, logs: Uint8Array, ergotree: Uint8Array, secret: Uint8Array): Uint8Array => {
    return blake2b256(new Uint8Array([...stringToBytes("utf8", solverId), ...(hexToBytes(seed) || []), ...bigintToLongByteArray(score), ...logs, ...ergotree, ...secret]));
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
        R6: SColl(SByte, hexToBytes(gameNftId)!).toHex(),
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
    participationBatchContract = mockChain.addParty(participationBatchErgoTree.toHex(), "ParticipationBatchContract");
    endGameContract = mockChain.addParty(endGameErgoTree.toHex(), "EndGameContract");

    // Asignar fondos a las partes para crear cajas y pagar tasas
    if (mode.token !== ERG_BASE_TOKEN) {
      creator.addBalance({
        tokens: [{ tokenId: mode.token, amount: resolverStake * 2n }],
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
      { tokenId: gameNftId, amount: GAME_NFT_AMOUNT },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: resolverStake }] : [])
    ];

    const gameBoxValue = mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE;

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
          1n, 20n,
          BigInt(deadline),
          resolverStake,
          participationFee,
          0n,                                       // perJudgeCommissionPercentage
          BigInt(resolverCommissionPercent),        // resolverCommissionPercentage
          BigInt(Math.round(DEV_COMMISSION_PERCENTAGE / 100 * COMMISSION_DENOMINATOR)),
          CREATOR_SLASH_RATIO,
          BigInt(resolutionDeadline)
        ]).toHex(),

        // gameProvenance: [Detalles del juego, TokenId (si aplica), Dev Script, Script del resolvedor]
        R9: SColl(SColl(SByte), [
          stringToBytes('utf8', gameDetailsJson),                   // detalles del juego
          mode.token !== ERG_BASE_TOKEN ? (hexToBytes(mode.token) || new Uint8Array(0)) : new Uint8Array(0), // token id
          hexToBytes(DEV_SCRIPT)!,                                  // dev script
          prependHexPrefix(resolver.key.publicKey, "0008cd")        // script del resolvedor
        ]).toHex()
      }
    });

  });

  const toEndGameOutput = (gameBox: any) =>
    new OutputBuilder(gameBox.value, endGameErgoTree.toHex())
      .addTokens(gameBox.assets)
      .setAdditionalRegisters({ ...gameBox.additionalRegisters, R4: SInt(ENDING_GAME_STATE).toHex() });

  const participationTokens = () => participationContract.utxos.toArray()
    .reduce((acc, p) => acc + (p.assets.find(a => a.tokenId === mode.token)?.amount || 0n), 0n);

  // Simulates the trophy left in the winner's wallet after a legitimate end_game:
  // a box under the winner's own key holding the game NFT and game-like registers.
  const addForgedGameBox = (state: number, nftUnits: bigint) => {
    const gameBox = gameResolutionContract.utxos.toArray()[0];
    const r8 = SColl(SLong, [1n, 20n, BigInt(deadline), resolverStake, participationFee, 0n, 0n, 0n, 0n, 0n]).toHex();
    winner.addUTxOs({
      creationHeight: mockChain.height,
      value: SAFE_MIN_BOX_VALUE,
      ergoTree: winner.address.ergoTree,
      assets: [{ tokenId: gameNftId, amount: nftUnits }],
      additionalRegisters: {
        R4: SInt(state).toHex(),
        R5: gameBox.additionalRegisters.R5,
        R6: SPair(SColl(SByte, secret), SColl(SByte, new Uint8Array(0))).toHex(),
        R7: SColl(SColl(SByte), []).toHex(),
        R8: r8,
        R9: SColl(SColl(SByte), [
          new Uint8Array(0),
          hexToBytes(mode.token)!,
          hexToBytes(DEV_SCRIPT)!,
          hexToBytes(winner.address.ergoTree)!
        ]).toHex()
      }
    });
    return winner.utxos.toArray().find(b => b.assets.some(a => a.tokenId === gameNftId))!;
  };

  it("control: anyone can move the game box to end_game without touching participations", () => {
    mockChain.jumpTo(resolutionDeadline);
    const attacker = mockChain.newParty("Attacker");
    attacker.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n });
    const gameBox = gameResolutionContract.utxos.toArray()[0];

    const tx = new TransactionBuilder(mockChain.height)
      .from([gameBox, ...attacker.utxos.toArray()], { ensureInclusion: true })
      .to(toEndGameOutput(gameBox))
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(attacker.address)
      .build();

    expect(mockChain.execute(tx, { signers: [attacker] })).to.be.true;
  });

  it("the end_game box must be created in the ending state", () => {
    mockChain.jumpTo(resolutionDeadline);
    const gameBox = gameResolutionContract.utxos.toArray()[0];

    const tx = new TransactionBuilder(mockChain.height)
      .from([gameBox, ...winner.utxos.toArray()], { ensureInclusion: true })
      .to(new OutputBuilder(gameBox.value, endGameErgoTree.toHex())
        .addTokens(gameBox.assets)
        .setAdditionalRegisters(gameBox.additionalRegisters))
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(winner.address)
      .build();

    expect(mockChain.execute(tx, { signers: [winner], throw: false })).to.be.false;
  });

  it("an outsider cannot drain participations in the to_end_game transaction", () => {
    mockChain.jumpTo(resolutionDeadline);
    const attacker = mockChain.newParty("Attacker");
    attacker.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n });
    const gameBox = gameResolutionContract.utxos.toArray()[0];
    const stolen = participationTokens();

    const tx = new TransactionBuilder(mockChain.height)
      .from([gameBox, ...participationContract.utxos.toArray(), ...attacker.utxos.toArray()], { ensureInclusion: true })
      .to([
        toEndGameOutput(gameBox),
        new OutputBuilder(SAFE_MIN_BOX_VALUE, attacker.address).addTokens([{ tokenId: mode.token, amount: stolen }])
      ])
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(attacker.address)
      .build();

    expect(mockChain.execute(tx, { signers: [attacker], throw: false })).to.be.false;
    expect(participationContract.utxos.length).to.equal(2);
  });

  it("the trophy holder cannot forge a game box to spend leftover participations", () => {
    mockChain.jumpTo(resolutionDeadline);
    const forged = addForgedGameBox(ENDING_GAME_STATE, GAME_TROPHY_AMOUNT);
    const leftovers = participationContract.utxos.toArray();

    const tx = new TransactionBuilder(mockChain.height)
      .from([forged, ...leftovers, ...winner.utxos.toArray().filter(b => b.boxId !== forged.boxId)], { ensureInclusion: true })
      .to(new OutputBuilder(SAFE_MIN_BOX_VALUE, winner.address).addTokens([{ tokenId: mode.token, amount: participationTokens() }]))
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(winner.address)
      .build();

    expect(mockChain.execute(tx, { signers: [winner], throw: false })).to.be.false;
    expect(participationContract.utxos.length).to.equal(2);
  });

  const endTheGame = (burnSecondUnit: boolean) => {
    mockChain.jumpTo(resolutionDeadline);
    const gameBox = gameResolutionContract.utxos.toArray()[0];
    const toEndGameTx = new TransactionBuilder(mockChain.height)
      .from([gameBox, ...winner.utxos.toArray()], { ensureInclusion: true })
      .to(toEndGameOutput(gameBox))
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(winner.address)
      .build();
    expect(mockChain.execute(toEndGameTx, { signers: [winner] })).to.be.true;

    const endGameBox = endGameContract.utxos.toArray()[0];
    const prizePool = participationTokens();
    const resolverCommission = (prizePool * BigInt(resolverCommissionPercent)) / BigInt(COMMISSION_DENOMINATOR);
    const devCommission = (prizePool * BigInt(Math.round(DEV_COMMISSION_PERCENTAGE / 100 * COMMISSION_DENOMINATOR))) / BigInt(COMMISSION_DENOMINATOR);
    const nftUnitsToWinner = burnSecondUnit ? GAME_TROPHY_AMOUNT : GAME_NFT_AMOUNT;

    let builder = new TransactionBuilder(mockChain.height)
      .from([endGameBox, ...participationContract.utxos.toArray(), ...winner.utxos.toArray()], { ensureInclusion: true });
    if (burnSecondUnit) builder = builder.burnTokens({ tokenId: gameNftId, amount: GAME_NFT_AMOUNT - GAME_TROPHY_AMOUNT });

    const tx = builder
      .to([
        new OutputBuilder(RECOMMENDED_MIN_FEE_VALUE, winner.address).addTokens([
          { tokenId: gameNftId, amount: nftUnitsToWinner },
          { tokenId: mode.token, amount: prizePool - resolverCommission - devCommission }
        ]),
        new OutputBuilder(2000000n, resolver.address).addTokens([{ tokenId: mode.token, amount: resolverStake + resolverCommission }]),
        new OutputBuilder(RECOMMENDED_MIN_FEE_VALUE, developer.address).addTokens([{ tokenId: mode.token, amount: devCommission }]),
      ])
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(winner.address)
      .build();

    return mockChain.execute(tx, { signers: [winner], throw: false });
  };

  it("the payout leaves a single trophy and burns the other NFT unit", () => {
    expect(endTheGame(true)).to.be.true;

    const winnerNft = winner.balance.tokens.find(t => t.tokenId === gameNftId)?.amount ?? 0n;
    expect(winnerNft).to.equal(GAME_TROPHY_AMOUNT);
    expect(participationContract.utxos.length).to.equal(0);
  });

  it("the payout cannot hand out both NFT units", () => {
    expect(endTheGame(false)).to.be.false;
    expect(endGameContract.utxos.length).to.equal(1);
  });

  it("the trophy holder cannot use a forged game box as data input to batch participations into their wallet", () => {
    mockChain.jumpTo(resolutionDeadline - 10);
    const forged = addForgedGameBox(1, GAME_TROPHY_AMOUNT);
    const leftovers = participationContract.utxos.toArray();

    const tx = new TransactionBuilder(mockChain.height)
      .from([...leftovers, ...winner.utxos.toArray().filter(b => b.boxId !== forged.boxId)], { ensureInclusion: true })
      .withDataFrom([forged])
      .to(new OutputBuilder(SAFE_MIN_BOX_VALUE, winner.address)
        .addTokens([{ tokenId: mode.token, amount: participationTokens() }])
        .setAdditionalRegisters({
          R4: SColl(SByte, new Uint8Array(0)).toHex(),
          R5: SColl(SByte, new Uint8Array(0)).toHex(),
          R6: SColl(SByte, gameNftId).toHex()
        }))
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(winner.address)
      .build();

    expect(mockChain.execute(tx, { signers: [winner], throw: false })).to.be.false;
    expect(participationContract.utxos.length).to.equal(2);
  });
});
