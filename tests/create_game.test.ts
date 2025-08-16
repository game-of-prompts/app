import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
  ErgoAddress as Address,
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  TransactionBuilder
} from "@fleet-sdk/core";
import {
  SByte,
  SColl,
  SLong,
  SPair
} from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";

/**
 * Función de utilidad para convertir un Uint8Array a una cadena hexadecimal.
 * Esta función es necesaria para comparar los hashes de los scripts y los
 * valores de los registros, que se manejan como cadenas hexadecimales.
 */
function uint8ArrayToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

// --- Constantes y Carga de Archivos ---

// Dirección del desarrollador para la comisión, requerida por el contrato `game_resolution`.
const DEV_ADDR_BASE58 = "9ejNy2qoifmzfCiDtEiyugthuXMriNNPhNKzzwjPtHnrK3esvbD";

// Se resuelve la ruta al directorio de contratos para cargar los archivos de código fuente.
const contractsDir = path.resolve(__dirname, "..", "contracts");

// Carga del código fuente de cada contrato ErgoScript.
// Se leen como texto plano para poder reemplazar los placeholders antes de la compilación.
const GAME_ACTIVE_TEMPLATE = fs.readFileSync(
  path.join(contractsDir, "game_active.es"),
  "utf-8"
);
const GAME_RESOLUTION_TEMPLATE = fs.readFileSync(
  path.join(contractsDir, "game_resolution.es"),
  "utf-8"
);
// NOTA: El contrato de cancelación no fue proporcionado. Se crea un mock simple
// que siempre falla, para permitir la compilación del contrato `game_active`.
const GAME_CANCELLATION_SOURCE = "{ sigmaProp(false) }"; 
const PARTICIPATION_SUBMITTED_TEMPLATE = fs.readFileSync(
  path.join(contractsDir, "participation_submited.es"),
  "utf-8"
);
const PARTICIPATION_RESOLVED_SOURCE = fs.readFileSync(
  path.join(contractsDir, "participation_resolved.es"),
  "utf-8"
);


// --- Suite de Pruebas ---

describe("Game Creation (create_game)", () => {
  // `mockChain` simula una blockchain de Ergo, permitiendo ejecutar transacciones
  // y verificar sus resultados sin necesidad de una red real.
  let mockChain: MockChain;

  // --- Partes Involucradas ---
  // Se define un 'creator' que será el actor principal en la creación del juego.
  let creator: ReturnType<MockChain["newParty"]>;

  // --- Contratos Compilados ---
  // Estas variables almacenarán los ErgoTrees compilados de nuestros contratos.
  // La compilación se realiza una sola vez para toda la suite de pruebas.
  let gameActiveErgoTree: ReturnType<typeof compile>;
  
  // Se inicializa la cadena y los actores antes de cada test.
  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });
    creator = mockChain.newParty("GameCreator");

    // Se asignan fondos al creador para que pueda crear la caja del juego y pagar la tasa de transacción.
    // Es crucial que tenga un balance superior al stake del juego + la tasa.
    creator.addBalance({ nanoergs: 10_000_000_000n }); // 10 ERG
  });

  // --- Compilación Dinámica de Contratos ---
  // Los contratos de ErgoScript a menudo dependen unos de otros.
  // El contrato `game_active` necesita conocer el hash de otros contratos a los que puede transicionar.
  // Por lo tanto, compilamos en orden de dependencia, inyectando los hashes necesarios.

  // 1. `participation_resolved`: No tiene dependencias.
  const participationResolvedErgoTree = compile(PARTICIPATION_RESOLVED_SOURCE);
  const participationResolvedScriptHash = uint8ArrayToHex(blake2b256(participationResolvedErgoTree.bytes));

  // 2. `participation_submited`: Depende del hash de `participation_resolved`.
  const participationSubmittedSource = PARTICIPATION_SUBMITTED_TEMPLATE
    .replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", participationResolvedScriptHash);
  const participationSubmittedErgoTree = compile(participationSubmittedSource);
  const participationSubmittedScriptHash = uint8ArrayToHex(blake2b256(participationSubmittedErgoTree.bytes));
  
  // 3. `game_cancellation`: Mock sin dependencias.
  const gameCancellationErgoTree = compile(GAME_CANCELLATION_SOURCE);
  const gameCancellationScriptHash = uint8ArrayToHex(blake2b256(gameCancellationErgoTree.bytes));
  
  // 4. `game_resolution`: Depende de los hashes de participación.
  const gameResolutionSource = GAME_RESOLUTION_TEMPLATE
    .replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", participationResolvedScriptHash)
    .replace("`+PARTICIPATION_SUBMITTED_SCRIPT_HASH+`", participationSubmittedScriptHash)
    .replace("`+DEV_ADDR+`", DEV_ADDR_BASE58);
  const gameResolutionErgoTree = compile(gameResolutionSource);
  const gameResolutionScriptHash = uint8ArrayToHex(blake2b256(gameResolutionErgoTree.bytes));

  // 5. `game_active`: Es el contrato principal y depende de todos los demás.
  const gameActiveSource = GAME_ACTIVE_TEMPLATE
    .replace("`+GAME_RESOLUTION_SCRIPT_HASH+`", gameResolutionScriptHash)
    .replace("`+GAME_CANCELLATION_SCRIPT_HASH+`", gameCancellationScriptHash)
    .replace("`+PARTICIPATION_SUBMITED_SCRIPT_HASH+`", participationSubmittedScriptHash)
    .replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", participationResolvedScriptHash); // Dependencia añadida para completitud.
  
  gameActiveErgoTree = compile(gameActiveSource);
  
  // Se añade una "parte" a la mockchain que representa la dirección del contrato `game_active`.
  // Esto nos permite consultar fácilmente las UTXOs que pertenecen a este contrato.
  const gameActiveContract = mockChain.addParty(gameActiveErgoTree.toHex(), "GameActiveContract");

  it("Should successfully create a new game box", () => {
    // --- 1. Arrange (Preparación) ---

    // Parámetros del juego que se va a crear.
    const deadlineBlock = mockChain.height + 200;
    const creatorStake = 2_000_000_000n; // 2 ERG
    const participationFee = 1_000_000n; // 0.001 ERG
    const commissionPercentage = 10;
    const gameDetailsJson = JSON.stringify({ title: "New Test Game", desc: "A test." });

    // El secreto 'S' y su hash. El hash se almacena on-chain, el secreto se revela después.
    const secret = stringToBytes("utf8", "super-secret-phrase");
    const hashedSecret = blake2b256(secret);

    // Se obtiene una UTXO del creador para usar como entrada.
    // En Ergo, el ID del primer input de la transacción se usa para determinar el ID de los tokens minteados.
    const inputUTXO = creator.utxos.toArray()[0];
    const gameNftId = inputUTXO.boxId;

    // Se extrae la clave pública en bytes del creador, necesaria para el registro R4.
    const creatorPkBytes = creator.address.getPublicKeys()[0];

    // --- 2. Act (Actuación) ---

    // Se construye la caja de salida que representará el juego activo.
    const gameBoxOutput = new OutputBuilder(
        creatorStake,
        gameActiveErgoTree
    )
    // Se mintea el Game NFT. Es un token único que identifica al juego.
    .mintToken({
        amount: 1n, // Solo se crea uno.
        name: "Game NFT"
    })
    // Se establecen los registros adicionales con la información del juego,
    // siguiendo la especificación del contrato `game_active.es`.
    .setAdditionalRegisters({
        // R4: (Clave pública del creador, Porcentaje de comisión)
        R4: SPair(SColl(SByte, creatorPkBytes), SLong(BigInt(commissionPercentage))).toHex(),
        // R5: Hash del secreto 'S'
        R5: SColl(SByte, hashedSecret).toHex(),
        // R6: Jueces invitados (vacío en este test)
        R6: SColl(SColl(SByte), []).toHex(),
        // R7: [deadline, stake del creador, tarifa de participación]
        R7: SColl(SLong, [BigInt(deadlineBlock), creatorStake, participationFee]).toHex(),
        // R8: Detalles del juego en formato JSON (convertido a bytes)
        R8: SColl(SByte, stringToBytes("utf8", gameDetailsJson)).toHex()
    });

    // Se construye la transacción.
    const transaction = new TransactionBuilder(mockChain.height)
      .from(inputUTXO) // Se usa la UTXO del creador.
      .to(gameBoxOutput) // Se crea la caja del juego.
      .sendChangeTo(creator.address) // El cambio vuelve al creador.
      .payFee(RECOMMENDED_MIN_FEE_VALUE) // Se paga la tasa de minería.
      .build();

    // Se ejecuta la transacción en la mockchain. El creador debe firmarla.
    const executionResult = mockChain.execute(transaction, { signers: [creator] });
    
    // --- 3. Assert (Verificación) ---

    // La transacción debería haberse ejecutado con éxito.
    expect(executionResult).to.be.true;

    // Debería existir una única UTXO en la dirección del contrato del juego.
    expect(gameActiveContract.utxos.length).to.equal(1);
    
    // Se obtiene la caja creada para verificar sus propiedades.
    const createdGameBox = gameActiveContract.utxos.toArray()[0];

    // El valor en nanoERGs de la caja debe ser igual al stake del creador.
    expect(createdGameBox.value).to.equal(creatorStake);
    // El ID del token minteado (Game NFT) debe coincidir con el ID de la caja de entrada.
    expect(createdGameBox.assets[0].tokenId).to.equal(gameNftId);
    // La cantidad del NFT debe ser 1.
    expect(createdGameBox.assets[0].amount).to.equal(1n);

    // Se verifica que cada registro contenga la información correcta y serializada.
    // Esta es la parte más importante para asegurar la compatibilidad con el contrato.
    expect(createdGameBox.additionalRegisters.R4).to.equal(gameBoxOutput.additionalRegisters.R4);
    expect(createdGameBox.additionalRegisters.R5).to.equal(gameBoxOutput.additionalRegisters.R5);
    expect(createdGameBox.additionalRegisters.R6).to.equal(gameBoxOutput.additionalRegisters.R6);
    expect(createdGameBox.additionalRegisters.R7).to.equal(gameBoxOutput.additionalRegisters.R7);
    expect(createdGameBox.additionalRegisters.R8).to.equal(gameBoxOutput.additionalRegisters.R8);
  });
});