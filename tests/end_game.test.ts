import { beforeEach, describe, expect, it } from "vitest";
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
  SBool,
  SByte,
  SColl,
  SInt,
  SLong,
  SPair
} from "@fleet-sdk/serializer";
import { blake2b256, randomBytes } from "@fleet-sdk/crypto";
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";
import { PARTICIPATION } from "$lib/ergo/reputation/types";
import { prependHexPrefix } from "$lib/utils";

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

const DIGITAL_PUBLIC_GOOD_SCRIPT = fs.readFileSync(path.join(contractsDir, "reputation_system", "digital_public_good.es"), "utf-8")
const digitalPublicGoodErgoTree = compile(DIGITAL_PUBLIC_GOOD_SCRIPT, { version: 1 });
const digital_public_good_script_hash = digitalPublicGoodErgoTree.toHex();
const REPUTATION_PROOF_SOURCE = fs.readFileSync(path.join(contractsDir, "reputation_system", "reputation_proof.es"), "utf-8").replace(/`\+DIGITAL_PUBLIC_GOOD_SCRIPT_HASH\+`/g, digital_public_good_script_hash);

const redeemScriptSource = `{
  // R4: Coll[Byte] - Blake2b256 hash of the final recipient's contract
  val recipientScriptHash = SELF.R4[Coll[Byte]].get

  // La transacción que gasta esta caja debe tener exactamente una salida.
  val singleOutput = OUTPUTS.size == 1

  // El hash del script del destinatario (OUTPUTS(0)) debe coincidir con el que guardamos en R4.
  val correctRecipient = blake2b256(OUTPUTS(0).propositionBytes) == recipientScriptHash

  sigmaProp(singleOutput && correctRecipient)
}`;
const redeemErgoTree = compile(redeemScriptSource);


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
    .replace("`+REDEEM_SCRIPT_HASH+`", uint8ArrayToHex(blake2b256(redeemErgoTree.toHex())))
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
            R8: SPair(SColl(SByte, prependHexPrefix(resolver.key.publicKey, "0008cd")), SLong(resolverCommissionPercent)).toHex(),
            R9: SPair(SColl(SByte, prependHexPrefix(creator.key.publicKey, "0008cd")),  SColl(SByte, stringToBytes('utf8', gameDetailsJson))).toHex()
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
                R4: SColl(SByte, prependHexPrefix(party.address.getPublicKeys()[0])).toHex(),
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
            R8: SPair(SColl(SByte, prependHexPrefix(resolver.key.publicKey, "0008cd")), SLong(resolverCommissionPercent)).toHex(),
            R9: SPair(SColl(SByte, prependHexPrefix(creator.key.publicKey, "0008cd")),  SColl(SByte, stringToBytes('utf8', gameDetailsJson))).toHex()
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
  

  it("Should fail if a non-winner (loser) tries to sign when a winner is declared", () => {
    // --- Arrange ---
    mockChain.jumpTo(resolutionDeadline);
    loser.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE }); // Fondos para la comisión
    
    const gameBox = gameResolutionContract.utxos.toArray()[0];
    const participationBoxes = participationContract.utxos;
    
    // --- Act ---
    const prizePool = participationBoxes.reduce((acc, p) => acc + p.value, 0n);
    const resolverCommission = (prizePool * BigInt(resolverCommissionPercent)) / 100n;
    const devCommission = (prizePool * 5n) / 100n;
    const winnerBasePrize = prizePool - resolverCommission - devCommission;
    
    const transaction = new TransactionBuilder(mockChain.height)
      .from([gameBox, ...participationBoxes.toArray(), ...loser.utxos.toArray()])
      .to([
        new OutputBuilder(winnerBasePrize, winner.address).addTokens([{ tokenId: gameNftId, amount: 1n }]),
        new OutputBuilder(creatorStake + resolverCommission, resolver.address),
        new OutputBuilder(devCommission, developer.address),
      ])
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(loser.address)
      .build();

    // --- Assert ---
    expect(mockChain.execute(transaction, { signers: [loser], throw: false })).to.be.false;
  });
  
  it("Should fail if the resolver tries to sign when a winner is declared", () => {
    // --- Arrange ---
    mockChain.jumpTo(resolutionDeadline);
    resolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });
    
    const gameBox = gameResolutionContract.utxos.toArray()[0];
    const participationBoxes = participationContract.utxos;
    
    // --- Act ---
    const prizePool = participationBoxes.reduce((acc, p) => acc + p.value, 0n);
    const resolverCommission = (prizePool * BigInt(resolverCommissionPercent)) / 100n;
    const devCommission = (prizePool * 5n) / 100n;
    const winnerBasePrize = prizePool - resolverCommission - devCommission;
    
    const transaction = new TransactionBuilder(mockChain.height)
      .from([gameBox, ...participationBoxes.toArray(), ...resolver.utxos.toArray()])
      .to([
        new OutputBuilder(winnerBasePrize, winner.address).addTokens([{ tokenId: gameNftId, amount: 1n }]),
        new OutputBuilder(creatorStake + resolverCommission, resolver.address),
        new OutputBuilder(devCommission, developer.address),
      ])
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(resolver.address)
      .build();

    // --- Assert ---
    expect(mockChain.execute(transaction, { signers: [resolver], throw: false })).to.be.false;
  });

  it("Should fail if a participant tries to sign when no winner is declared", () => {
    // --- Arrange ---
    // Reconfigurar para un escenario sin ganador
    gameResolutionContract.utxos.clear();
    const gameDetailsJson = JSON.stringify({ title: "Test Game", description: "This is a test game." });
    gameResolutionContract.addUTxOs({
        creationHeight: mockChain.height, value: creatorStake, ergoTree: gameResolutionErgoTree.toHex(),
        assets: [{ tokenId: gameNftId, amount: 1n }],
        additionalRegisters: {
            R4: SInt(1).toHex(), R5: SPair(SColl(SByte, "00".repeat(32)), SColl(SByte, [])).toHex(),
            R6: SColl(SColl(SByte), []).toHex(), R7: SColl(SLong, [BigInt(deadline), creatorStake, participationFee, BigInt(resolutionDeadline), 0n]).toHex(),
            R8: SPair(SColl(SByte, prependHexPrefix(resolver.key.publicKey, "0008cd")), SLong(resolverCommissionPercent)).toHex(), R9: SPair(SColl(SByte, creator.key.publicKey), SColl(SByte, stringToBytes('utf8', gameDetailsJson))).toHex()
        },
    });
    mockChain.jumpTo(resolutionDeadline);

    const gameBox = gameResolutionContract.utxos.toArray()[0];
    const participationBoxes = participationContract.utxos;

    // --- Act ---
    const prizePool = participationBoxes.reduce((acc, p) => acc + p.value, 0n);
    const devCommission = (prizePool * 5n) / 100n;
    const finalResolverPayout = creatorStake + prizePool - devCommission;

    const transaction = new TransactionBuilder(mockChain.height)
      .from([gameBox, ...participationBoxes.toArray(), ...winner.utxos.toArray()]) // 'winner' es solo un participante aquí
      .to([
        new OutputBuilder(finalResolverPayout, resolver.address).addTokens([{ tokenId: gameNftId, amount: 1n }]),
        new OutputBuilder(devCommission, developer.address),
      ])
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(winner.address)
      .build();

    // --- Assert ---
    // La transacción debe fallar porque 'winner' (un participante) no puede firmar.
    expect(mockChain.execute(transaction, { signers: [winner], throw: false })).to.be.false;
  });

  it("Should fail if the creator tries to sign when no winner is declared", () => {
    // --- Arrange ---
    // Reconfigurar para un escenario sin ganador
    gameResolutionContract.utxos.clear();
    const gameDetailsJson = JSON.stringify({ title: "Test Game", description: "This is a test game." });
    gameResolutionContract.addUTxOs({
        creationHeight: mockChain.height, value: creatorStake, ergoTree: gameResolutionErgoTree.toHex(),
        assets: [{ tokenId: gameNftId, amount: 1n }],
        additionalRegisters: {
            R4: SInt(1).toHex(), R5: SPair(SColl(SByte, "00".repeat(32)), SColl(SByte, [])).toHex(),
            R6: SColl(SColl(SByte), []).toHex(), R7: SColl(SLong, [BigInt(deadline), creatorStake, participationFee, BigInt(resolutionDeadline), 0n]).toHex(),
            R8: SPair(SColl(SByte, prependHexPrefix(resolver.key.publicKey, "0008cd")), SLong(resolverCommissionPercent)).toHex(), R9: SPair(SColl(SByte, creator.key.publicKey), SColl(SByte, stringToBytes('utf8', gameDetailsJson))).toHex()
        },
    });
    mockChain.jumpTo(resolutionDeadline);

    const gameBox = gameResolutionContract.utxos.toArray()[0];
    const participationBoxes = participationContract.utxos;

    // --- Act ---
    const prizePool = participationBoxes.reduce((acc, p) => acc + p.value, 0n);
    const devCommission = (prizePool * 5n) / 100n;
    const finalResolverPayout = creatorStake + prizePool - devCommission;

    const transaction = new TransactionBuilder(mockChain.height)
      .from([gameBox, ...participationBoxes.toArray(), ...creator.utxos.toArray()])
      .to([
        new OutputBuilder(finalResolverPayout, resolver.address).addTokens([{ tokenId: gameNftId, amount: 1n }]),
        new OutputBuilder(devCommission, developer.address),
      ])
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(creator.address)
      .build();

    // --- Assert ---
    expect(mockChain.execute(transaction, { signers: [creator], throw: false })).to.be.false;
  });

it("Should correctly distribute commissions to participating judges when finalizing the game", () => {
    // --- Arrange (Preparación del Escenario con Jueces) ---

    // 1. Crear actores y contratos. Es crucial añadir el contrato de `reputation_proof`
    //    para poder añadirle las cajas de los jueces.
    const judge1 = mockChain.newParty("Judge1");
    const judge2 = mockChain.newParty("Judge2");
    
    // Compilamos el ErgoTree de `reputation_proof` para poder añadirlo a la mockChain
    const reputationProofErgoTree = compile(REPUTATION_PROOF_SOURCE);
    const reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProofContract");

    // 2. Crear tokens de reputación y hashes de scripts para los jueces.
    const judge1ReputationTokenId = Buffer.from(randomBytes(32)).toString("hex");
    const judge2ReputationTokenId = Buffer.from(randomBytes(32)).toString("hex");
    const judge1ScriptHash = blake2b256(judge1.address.ergoTree);
    const judge2ScriptHash = blake2b256(judge2.address.ergoTree);

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
                R6: SPair(SBool(true), SLong(100n)).toHex(), // Votó 'true'
                R7: SColl(SByte, judge1ScriptHash).toHex(), // Hash de su script de pago
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
                R6: SPair(SBool(true), SLong(95n)).toHex(),
                R7: SColl(SByte, judge2ScriptHash).toHex(), // Hash de su script de pago
                R8: SBool(true).toHex(),
                R9: SColl(SByte, new Uint8Array(0)).toHex()
            }
        }
    );
    const [judge1ReputationBox/*, judge2ReputationBox*/] = reputationProofContract.utxos.toArray();

    // 4. Configurar la caja del juego para incluir a los jueces.
    gameResolutionContract.utxos.clear(); 
    const perJudgeCommissionPercent = 5n;
    const gameDetailsJson = JSON.stringify({ title: "Test Game", description: "This is a test game." });
    const judgesTokenIds = [judge1ReputationTokenId, /* judge2ReputationTokenId */].map(id => Buffer.from(id, "hex"));
    
    gameResolutionContract.addUTxOs({
        creationHeight: mockChain.height,
        value: creatorStake,
        ergoTree: gameResolutionErgoTree.toHex(),
        assets: [{ tokenId: gameNftId, amount: 1n }],
        additionalRegisters: {
            R4: SInt(1).toHex(),
            R5: SPair(SColl(SByte, "00".repeat(32)), SColl(SByte, winnerCommitment)).toHex(),
            R6: SColl(SColl(SByte), judgesTokenIds).toHex(),
            R7: SColl(SLong, [BigInt(deadline), creatorStake, participationFee, perJudgeCommissionPercent, BigInt(resolutionDeadline)]).toHex(),
            R8: SPair(SColl(SByte, prependHexPrefix(resolver.key.publicKey, "0008cd")), SLong(resolverCommissionPercent)).toHex(),
            R9: SPair(SColl(SByte, prependHexPrefix(creator.key.publicKey, "0008cd")),  SColl(SByte, stringToBytes('utf8', gameDetailsJson))).toHex()
        },
    });

    mockChain.jumpTo(resolutionDeadline);
    const gameBox = gameResolutionContract.utxos.toArray()[0];
    const participationBoxes = participationContract.utxos;

    // --- Act (Cálculos y Construcción de la Transacción) ---

    const prizePool = participationBoxes.reduce((acc, p) => acc + p.value, 0n);
    const resolverCommission = (prizePool * BigInt(resolverCommissionPercent)) / 100n;
    const devCommission = (prizePool * 5n) / 100n;
    const perJudgeCommission = (prizePool * BigInt(perJudgeCommissionPercent)) / 100n; // Renamed for clarity
    const judgeCount = BigInt(judgesTokenIds.length);
    const totalJudgeCommission = perJudgeCommission * judgeCount;

    // Dust constants (adjust to match script's MIN_ERG_BOX)
    const MIN_ERG_BOX = 1000000n; // Example; use your actual value

    // Dev forfeits
    const devForfeits = (devCommission < MIN_ERG_BOX && devCommission > 0n) ? devCommission : 0n;
    const finalDevPayout = devCommission - devForfeits;

    // Judges forfeits (forfeit ALL if per-judge is dust)
    const judgesForfeits = (perJudgeCommission < MIN_ERG_BOX && perJudgeCommission > 0n) ? totalJudgeCommission : 0n;
    const finalJudgesPayout = totalJudgeCommission - judgesForfeits;
    const perJudgePayout = (finalJudgesPayout > 0n) ? (finalJudgesPayout / judgeCount) : 0n; // Only used if not forfeited

    // Winner base (after dev/judge forfeits)
    const winnerBasePrize = prizePool - resolverCommission - finalJudgesPayout - finalDevPayout;

    // Additional winner/resolver dust handling
    const winnerGetsBasePrize = winnerBasePrize >= MIN_ERG_BOX;
    const intermediateWinnerPayout = winnerGetsBasePrize ? winnerBasePrize : 0n;
    const intermediateResolverPayout = winnerGetsBasePrize ? creatorStake + resolverCommission : creatorStake;

    // Resolver forfeits
    const resolverForfeits = (intermediateResolverPayout < MIN_ERG_BOX && intermediateResolverPayout > 0n) ? intermediateResolverPayout : 0n;
    const finalResolverPayout = intermediateResolverPayout - resolverForfeits;

    // Final winner gets base + resolver forfeits
    const finalWinnerPrize = intermediateWinnerPayout + resolverForfeits;

    console.log("Prize Pool:", prizePool);
    console.log("Resolver Commission:", resolverCommission, resolverCommissionPercent);
    console.log("Stake for Resolver:", creatorStake);
    console.log("Dev Commission:", devCommission, "5");
    console.log("Per Judge Commission:", perJudgeCommission, perJudgeCommissionPercent);
    console.log("---");

    console.log("Final Winner Prize:", finalWinnerPrize, finalWinnerPrize < MIN_ERG_BOX);
    console.log("Final Resolver Payout:", finalResolverPayout, finalResolverPayout < MIN_ERG_BOX);
    console.log("Final Dev Payout:", finalDevPayout, finalDevPayout < MIN_ERG_BOX);
    console.log("Final Judges Payout:", finalJudgesPayout, finalJudgesPayout < MIN_ERG_BOX);
    console.log("Per Judge Payout:", perJudgePayout, perJudgePayout < MIN_ERG_BOX);


    // Now build outputs conditionally (skip dust outputs)
    const outputs = [
      new OutputBuilder(finalWinnerPrize, winner.address).addTokens([{ tokenId: gameNftId, amount: 1n }]),
      new OutputBuilder(finalResolverPayout, resolver.address),
    ];

    if (finalDevPayout > 0n) {
      outputs.push(new OutputBuilder(finalDevPayout, developer.address));
    }

    if (finalJudgesPayout > 0n) {
      // Assuming one judge for simplicity; loop over judgesTokenIds if multiple
      outputs.push(
        new OutputBuilder(perJudgePayout, redeemErgoTree.toHex())
          .setAdditionalRegisters({ R4: SColl(SByte, judge1ScriptHash).toHex() })
      );
      // Add more for other judges if needed
    }

    const transaction = new TransactionBuilder(mockChain.height)
      .from([gameBox, ...participationBoxes.toArray(), ...winner.utxos.toArray()])
      .withDataFrom([judge1ReputationBox/*, judge2ReputationBox*/])
      .to(outputs)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(winner.address)
      .build();

    // --- Assert (Verificación) ---
    expect(mockChain.execute(transaction, { signers: [winner] })).to.be.true;

    // Verificamos los balances de todos, incluyendo los jueces
    expect(winner.balance.nanoergs).to.equal(finalWinnerPrize);
    expect(developer.balance.nanoergs).to.equal(finalDevPayout);
    expect(resolver.balance.nanoergs).to.equal(finalResolverPayout);
    expect(judge1.balance.nanoergs).to.equal(perJudgePayout); // No tenían balance inicial en este test
    expect(judge2.balance.nanoergs).to.equal(perJudgePayout);
    
    expect(gameResolutionContract.utxos.length).to.equal(0);
    expect(participationContract.utxos.length).to.equal(0);
  });

});
