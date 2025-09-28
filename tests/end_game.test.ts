import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
  ErgoAddress as Address,
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  SAFE_MIN_BOX_VALUE,
  TransactionBuilder
} from "@fleet-sdk/core";
import {
  SByte,
  SColl,
  SGroupElement,
  SInt,
  SLong,
  SPair
} from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";
import { PARTICIPATION } from "$lib/ergo/reputation/types";

/**
 * Función de utilidad para convertir un Uint8Array a una cadena hexadecimal.
 */
function uint8ArrayToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

// --- Constantes y Carga de Archivos ---

const DEV_ADDR_BASE58 = "9ejNy2qoifmzfCiDtEiyugthuXMriNNPhNKzzwjPtHnrK3esvbD";

const contractsDir = path.resolve(__dirname, "..", "contracts");

const PARTICIPATION_SOURCE = fs.readFileSync(
  path.join(contractsDir, "participation.es"),
  "utf-8"
);

const GAME_RESOLUTION_TEMPLATE = fs.readFileSync(
  path.join(contractsDir, "game_resolution.es"),
  "utf-8"
);

// --- Suite de Pruebas ---

describe("Game Finalization (end_game)", () => {
  const mockChain = new MockChain({ height: 800_000 });

  const devErgoTree = Address.fromBase58(DEV_ADDR_BASE58).ergoTree;

  let resolver: ReturnType<MockChain["newParty"]>;
  let creator: ReturnType<MockChain["newParty"]>;
  let winner: ReturnType<MockChain["newParty"]>;
  let loser: ReturnType<MockChain["newParty"]>;
  let developer: ReturnType<MockChain["addParty"]>;

  // --- Constantes del Juego para la Prueba ---
  const deadline = 800_050;
  const resolutionDeadline = mockChain.height + 100;
  const creatorStake = 2_000_000n;
  const participationFee = 100_000_000n;
  const resolverCommissionPercent = 10;

  // --- Compilación Dinámica de Contratos ---
  const pparticipationErgoTree = compile(PARTICIPATION_SOURCE);
  const pparticipationScriptHash = uint8ArrayToHex(blake2b256(pparticipationErgoTree.bytes));
  
  const gameResolutionSourceWithHash = GAME_RESOLUTION_TEMPLATE
    .replace("`+PARTICIPATION_SCRIPT_HASH+`", pparticipationScriptHash)
    .replace("`+REPUTATION_PROOF_SCRIPT_HASH+`", "0".repeat(64)) // No se usa en este script
    .replace("`+PARTICIPATION_TYPE_ID+`", PARTICIPATION)
    .replace("`+DEV_ADDR+`", DEV_ADDR_BASE58);
    
  const gameResolutionErgoTree = compile(gameResolutionSourceWithHash);
  
  // --- Variables para el Estado de la Prueba ---
  let gameNftId: string;
  const winnerCommitment = "a1".repeat(32);
  const loserCommitment = "b2".repeat(32);

  let gameResolutionContract: ReturnType<MockChain["newParty"]>;
  let participationContract: ReturnType<MockChain["newParty"]>;

  beforeEach(() => {
    mockChain.reset({clearParties: true});
    mockChain.jumpTo(800_000);

    // --- Partes Involucradas ---
    resolver = mockChain.newParty("Resolver");
    creator = mockChain.newParty("GameCreator");
    winner = mockChain.newParty("Winner");
    loser = mockChain.newParty("Loser");
    developer = mockChain.addParty(devErgoTree, "Developer");

    // --- Partes de Contrato en la MockChain ---
    gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolutionContract");
    participationContract = mockChain.addParty(pparticipationErgoTree.toHex(), "ParticipationContract");

    // Asignar fondos a las partes para crear cajas y pagar tasas
    creator.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });
    winner.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

    // Crear y distribuir el Game NFT
    gameNftId = "c94a63ec4e9ae8700c671a908bd2121d4c049cec75a40f1309e09ab59d0bbc71";

    const gameDetailsJson = JSON.stringify({ title: "Test Game", description: "This is a test game." });
    
    // 1. Crear la caja del juego en estado de resolución
    gameResolutionContract.addUTxOs({
        creationHeight: mockChain.height,
        value: creatorStake,
        ergoTree: gameResolutionErgoTree.toHex(),
        assets: [{ tokenId: gameNftId, amount: 1n }],
        additionalRegisters: {
            R4: SInt(1).toHex(), // Estado: Resolución
            R5: SPair(SColl(SByte, "00".repeat(32)), SColl(SByte, winnerCommitment)).toHex(),
            R6: SColl(SColl(SByte), []).toHex(),
            R7: SColl(SLong, [BigInt(deadline), creatorStake, participationFee, BigInt(resolutionDeadline), 0n]).toHex(),
            R8: SPair(SColl(SByte, resolver.key.publicKey), SLong(resolverCommissionPercent)).toHex(),
            R9: SPair(SColl(SByte, creator.key.publicKey),  SColl(SByte, stringToBytes('utf8', gameDetailsJson))).toHex()
        },
    });
    
    // 2. Crear las cajas de participación (ganador y perdedor)
    const createParticipation = (party: any, commitment: string) => {
        participationContract.addUTxOs({
            creationHeight: mockChain.height,
            value: participationFee,
            ergoTree: pparticipationErgoTree.toHex(),
            assets: [],
            additionalRegisters: {
                R4: SGroupElement(party.address.getPublicKeys()[0]).toHex(),
                R5: SColl(SByte, commitment).toHex(),
                R6: SColl(SByte, gameNftId).toHex(),
                R7: SColl(SByte, "c3".repeat(32)).toHex(),
                R8: SColl(SByte, "d4".repeat(32)).toHex(),
                R9: SColl(SLong, [100n]).toHex(),
            },
        });
    };
    createParticipation(winner, winnerCommitment);
    createParticipation(loser, loserCommitment);
  });

  it("Should successfully finalize the game and distribute funds correctly", () => {
    // --- Arrange ---
    mockChain.jumpTo(resolutionDeadline);
    const gameBox = gameResolutionContract.utxos.toArray()[0];
    const participationBoxes = participationContract.utxos;
    
    // --- Act ---
    const prizePool = participationBoxes.reduce((acc, p) => acc + p.value, 0n);
    const resolverCommission = (prizePool * BigInt(resolverCommissionPercent)) / 100n;
    const devCommission = (prizePool * 5n) / 100n;
    const winnerBasePrize = prizePool - resolverCommission - devCommission;
    
    const finalWinnerPrize = winnerBasePrize;
    const finalResolverPayout = creatorStake + resolverCommission;
    const finalDevPayout = devCommission;

    const transaction = new TransactionBuilder(mockChain.height)
      .from([gameBox, ...participationBoxes.toArray(), ...winner.utxos.toArray()])
      .to([
        new OutputBuilder(finalWinnerPrize, winner.address).addTokens([{ tokenId: gameNftId, amount: 1n }]),
        new OutputBuilder(finalResolverPayout, resolver.address),
        new OutputBuilder(finalDevPayout, developer.address),
      ])
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(resolver.address)
      .build();

    // --- Assert ---
    expect(mockChain.execute(transaction, { signers: [winner] })).to.be.true;

    console.log("Winner Balance:", winner.balance.nanoergs);
    console.log("Final Winner Prize:", finalWinnerPrize);

    expect(winner.balance.nanoergs).to.equal(finalWinnerPrize);
    expect(developer.balance.nanoergs).to.equal(finalDevPayout);
    expect(creator.balance.nanoergs).to.equal(RECOMMENDED_MIN_FEE_VALUE);
    expect(resolver.balance.nanoergs).to.equal(finalResolverPayout);
    
    expect(winner.balance.tokens[0].tokenId).to.equal(gameNftId);

    expect(gameResolutionContract.utxos.length).to.equal(0);
    expect(participationContract.utxos.length).to.equal(0);
  });

  it("Should fail if the resolution deadline has not been reached", () => {
    // --- Arrange ---
    expect(mockChain.height).to.be.below(resolutionDeadline);
    const gameBox = gameResolutionContract.utxos.toArray()[0];

    // --- Act ---
    const transaction = new TransactionBuilder(mockChain.height)
      .from([gameBox, ...winner.utxos.toArray()])
      .to(new OutputBuilder(SAFE_MIN_BOX_VALUE, winner.address))
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(resolver.address)
      .build();

    // --- Assert ---
    expect(mockChain.execute(transaction, { signers: [winner], throw: false })).to.be.false;

    expect(winner.balance.nanoergs).to.equal(RECOMMENDED_MIN_FEE_VALUE);
    expect(gameResolutionContract.utxos.length).to.equal(1);
  });

  it("Should distribute funds to resolver and dev when there is no winner", () => {
    // --- Arrange ---
    // Limpiar la caja del juego creada en beforeEach para crear una nueva para este test
    gameResolutionContract.utxos.clear();
    
    const gameDetailsJson = JSON.stringify({ title: "Test Game", description: "This is a test game." });
    
    // Crear una nueva caja de juego con un 'winner commitment' vacío
    gameResolutionContract.addUTxOs({
        creationHeight: mockChain.height,
        value: creatorStake,
        ergoTree: gameResolutionErgoTree.toHex(),
        assets: [{ tokenId: gameNftId, amount: 1n }],
        additionalRegisters: {
            R4: SInt(1).toHex(), // Estado: Resolución
            R5: SPair(SColl(SByte, "00".repeat(32)), SColl(SByte, [])).toHex(), // Sin ganador
            R6: SColl(SColl(SByte), []).toHex(),
            R7: SColl(SLong, [BigInt(deadline), creatorStake, participationFee, BigInt(resolutionDeadline), 0n]).toHex(),
            R8: SPair(SColl(SByte, resolver.key.publicKey), SLong(resolverCommissionPercent)).toHex(),
            R9: SPair(SColl(SByte, creator.key.publicKey),  SColl(SByte, stringToBytes('utf8', gameDetailsJson))).toHex()
        },
    });

    // Añadir fondos al resolver para que pueda firmar y pagar la comisión
    resolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });
    
    mockChain.jumpTo(resolutionDeadline);

    const gameBox = gameResolutionContract.utxos.toArray()[0];
    const participationBoxes = participationContract.utxos;

    // --- Act ---
    const prizePool = participationBoxes.reduce((acc, p) => acc + p.value, 0n);
    const devCommission = (prizePool * 5n) / 100n;
    
    // Si no hay ganador, el pozo de premios y el stake van al resolver
    const finalResolverPayout = creatorStake + prizePool - devCommission;
    const finalDevPayout = devCommission;

    const transaction = new TransactionBuilder(mockChain.height)
      .from([gameBox, ...participationBoxes.toArray(), ...resolver.utxos.toArray()])
      .to([
        // El NFT y los fondos van al resolver
        new OutputBuilder(finalResolverPayout, resolver.address).addTokens([{ tokenId: gameNftId, amount: 1n }]),
        new OutputBuilder(finalDevPayout, developer.address),
      ])
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(resolver.address) // El cambio va al firmante, el resolver
      .build();

    // --- Assert ---
    expect(mockChain.execute(transaction, { signers: [resolver] })).to.be.true;
    
    // Verificar los balances finales
    expect(developer.balance.nanoergs).to.equal(finalDevPayout);
    expect(resolver.balance.nanoergs).to.equal(finalResolverPayout);

    // Los balances de los jugadores no deberían cambiar (excepto por las comisiones si tuvieran)
    expect(creator.balance.nanoergs).to.equal(RECOMMENDED_MIN_FEE_VALUE);
    expect(winner.balance.nanoergs).to.equal(RECOMMENDED_MIN_FEE_VALUE);
    expect(loser.balance.nanoergs).to.equal(0n); // El perdedor no tenía fondos iniciales
    
    // Verificar que el resolver recibió el NFT
    expect(resolver.balance.tokens[0].tokenId).to.equal(gameNftId);
    
    // Verificar que las cajas de contrato se han consumido
    expect(gameResolutionContract.utxos.length).to.equal(0);
    expect(participationContract.utxos.length).to.equal(0);
  });
  
});
