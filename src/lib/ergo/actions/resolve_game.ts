import {
    OutputBuilder,
    TransactionBuilder,
    ErgoAddress,
    type Box,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    type InputBox,
    type Amount
} from '@fleet-sdk/core';
import { SColl, SByte } from '@fleet-sdk/serializer';
import { bigintToLongByteArray, hexToBytes, parseBox, parseCollByteToHex, parseIntFromHex, parseLongColl, uint8ArrayToHex } from '$lib/ergo/utils';
import { type Game, type Participation } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto"; // Para el hashing

// Ya no se necesita WinnerDataFromModal si el ganador se determina 100% on-chain
// y no hay desempate manual por PK vía data_input.

export async function resolve_game(
    game: Game, 
    secretS_hex: string
): Promise<string | null> {

    console.log("Attempting to resolve game (on-chain winner determination):", game.boxId);
    console.log("Revealed Secret S (first 10 chars):", secretS_hex.substring(0,10)+"...");

    // --- 1. Extraer y Preparar Datos Necesarios del objeto 'game' ---
    const gameBoxToSpend: Box<Amount> = game.box;
    if (!gameBoxToSpend) throw new Error("GameBox data is missing from game object.");

    const gameCreatorPK_Hex_from_R4 = game.gameCreatorPK_Hex;
    if (!gameCreatorPK_Hex_from_R4) throw new Error("Could not get gameCreatorPK_Hex from game object");

    const numericalParamsRaw = game.box.additionalRegisters.R7!.renderedValue;
    let parsedR7Array: any[] | null = null;
    if (typeof numericalParamsRaw === 'string') {
        try { parsedR7Array = JSON.parse(numericalParamsRaw); } catch (e) { console.warn("R7 JSON.parse failed:", e); }
    } else if (Array.isArray(numericalParamsRaw)) { parsedR7Array = numericalParamsRaw; }
    const parsedNumericalParams = parseLongColl(parsedR7Array);
    if (!parsedNumericalParams || parsedNumericalParams.length < 3) throw new Error(`Could not parse R7 from gameBox ${game.boxId}.`);
    const [_deadline, creatorStakeNanoErg, participationFeeNanoErgFromGBox] = parsedNumericalParams; // participationFee para validación de PBox

    const commissionPercentageRaw = game.box.additionalRegisters.R8!.renderedValue;
    const commissionPercentage = parseIntFromHex(commissionPercentageRaw);
    if (commissionPercentage === null) throw new Error(`Could not parse commissionPercentage from gameBox ${game.boxId} R8`);

    const gameNftAsset = game.box.assets[0];
    if (!gameNftAsset) throw new Error(`GameBox ${game.boxId} is missing Game NFT.`);
    const gameNftId = gameNftAsset.tokenId;

    const secretS_bytes = hexToBytes(secretS_hex);
    if (!secretS_bytes) throw new Error("Invalid secretS_hex format.");

    const creatorP2PKAddressBytes = hexToBytes(gameCreatorPK_Hex_from_R4);
    if(!creatorP2PKAddressBytes) throw new Error("Failed to convert creator PK Hex to Bytes");
    const creatorAddressString = ErgoAddress.fromPublicKey(creatorP2PKAddressBytes).toString();
    
    const changeAddressString = await ergo.get_change_address();
    if (!changeAddressString) throw new Error("Failed to get change address from wallet.");

    // ParticipationBox Inputs
    if (!game.participations || !Array.isArray(game.participations)) {
        throw new Error("Game object is missing 'participations' array or it's invalid.");
    }
    const participationBoxInputs: Box<Amount>[] = game.participations.map(p => {
        if (!p.box) throw new Error(`Participation object for boxId ${p.boxId || 'unknown'} is missing 'box' data.`);
        return p.box;
    });

    // --- 2. Determinar Ganador y Puntuación Válida Off-chain (Simulando Lógica On-chain) ---
    // Esto es necesario para construir los outputs correctamente.
    // El script on-chain realizará la misma validación.
    let maxScore = -1n; // Usar BigInt para scores
    let winnerPK_Hex: string | null = null;
    // Podríamos necesitar guardar solverId y hashLogs del ganador si el output del ganador los necesita
    // o si hay un log/evento off-chain que se quiera generar.
    // Por ahora, el script on-chain los tiene y los usa para validar el NFT al ganador.

    let validProcessedParticipationBoxes: Box<Amount>[] = [];
    let totalPrizePoolNanoErg = 0n;

    for (const pBox of participationBoxInputs) {
        // Validaciones básicas de la PBox (NFT, fee, script hash - esta última no la podemos hacer aquí fácilmente sin el R6 de GameBox)
        // Asumimos que fetchActiveGoPGames ya hizo un filtrado básico o que el script on-chain lo hará.
        // La validación crucial aquí es encontrar la puntuación verdadera.

        if (pBox.creationHeight < gameBoxToSpend.creationHeight) {
            console.log("Avoid add participation created after deadline.")
            continue;
        }

        const pBox_R4_playerPK_Hex = parseCollByteToHex(pBox.additionalRegisters.R4?.renderedValue);
        const pBox_R5_commitmentCHex = parseCollByteToHex(pBox.additionalRegisters.R5?.renderedValue);
        const pBox_R7_solverIdHex = parseCollByteToHex(pBox.additionalRegisters.R7?.renderedValue); // Hex de Coll[Byte] UTF-8
        const pBox_R8_hashLogsHex = parseCollByteToHex(pBox.additionalRegisters.R8?.renderedValue);
        
        const r9ScoreListRaw = pBox.additionalRegisters.R9?.renderedValue;
        let r9ParsedArray: any[] | null = null;
        if (typeof r9ScoreListRaw === 'string') {
            try { r9ParsedArray = JSON.parse(r9ScoreListRaw); } catch (e) { /* ignore */ }
        } else if (Array.isArray(r9ScoreListRaw)) { r9ParsedArray = r9ScoreListRaw; }
        const pBox_scoreList = parseLongColl(r9ParsedArray);

        if (!pBox_R4_playerPK_Hex || !pBox_R5_commitmentCHex || !pBox_R7_solverIdHex || !pBox_R8_hashLogsHex || !pBox_scoreList) {
            console.warn(`Skipping PBox ${pBox.boxId} due to missing/invalid essential registers for score verification.`);
            continue;
        }

        const pBoxCommitment_bytes = hexToBytes(pBox_R5_commitmentCHex);
        const pBoxSolverId_bytes = hexToBytes(pBox_R7_solverIdHex); // Estos son los bytes de SColl(SByte, utf8), no los utf8 puros
                                                                    // Para el hash, necesitamos los bytes UTF-8 puros.
                                                                    // Re-evaluación: R7 y R8 en PBox son Coll[Byte] de los datos crudos.
                                                                    // El script on-chain usa estos directamente.
        const pBoxSolverId_directBytes = hexToBytes(pBox.additionalRegisters.R7!.renderedValue); // Asumiendo renderedValue es hex de los bytes directos
        const pBoxHashLogs_directBytes = hexToBytes(pBox.additionalRegisters.R8!.renderedValue);


        if (!pBoxCommitment_bytes || !pBoxSolverId_directBytes || !pBoxHashLogs_directBytes) {
             console.warn(`Skipping PBox ${pBox.boxId} due to byte conversion error for R5, R7 or R8.`);
             continue;
        }
        
        let actualScoreForThisPBox = -1n;
        let scoreValidated = false;

        for (const scoreAttempt of pBox_scoreList) {
            const scoreAttempt_bytes = bigintToLongByteArray(scoreAttempt);
            const dataToHash = new Uint8Array([
                ...pBoxSolverId_directBytes, 
                ...scoreAttempt_bytes, 
                ...pBoxHashLogs_directBytes, 
                ...secretS_bytes
            ]);
            const testCommitmentBytes = fleetBlake2b256(dataToHash);

            if (uint8ArrayToHex(testCommitmentBytes) === pBox_R5_commitmentCHex) {
                actualScoreForThisPBox = scoreAttempt;
                scoreValidated = true;
                break; 
            }
        }

        if (scoreValidated) {
            validProcessedParticipationBoxes.push(parseBox(pBox)); // Solo añadir si la puntuación fue validada
            totalPrizePoolNanoErg += BigInt(pBox.value);
            if (actualScoreForThisPBox > maxScore) {
                maxScore = actualScoreForThisPBox;
                winnerPK_Hex = pBox_R4_playerPK_Hex;
            }
            // TODO: Implementar lógica de desempate si actualScoreForThisPBox == maxScore (ej. por creationHeight)
        } else {
            console.warn(`PBox ${pBox.boxId} - No score in list validated against commitment.`);
        }
    }

    if (winnerPK_Hex === null && validProcessedParticipationBoxes.length > 0) {
        // Si hubo participaciones válidas pero ninguna puntuación validó (o todas fueron -1 y maxScore no cambió)
        // O si todas las puntuaciones fueron negativas y maxScore sigue -1.
        // Esto indica un problema o que ningún participante es "válido" para ganar.
        // Para el MVP, si no hay un ganador claro con > -1, la resolución podría fallar o necesitar manejo especial.
        // Por ahora, si no hay ganador, podríamos no poder construir la TX de forma que el script la valide.
        // El script on-chain también haría esta determinación. Si no encuentra ganador, la TX fallará.
        console.warn("No winning participant found with a valid positive score after processing all PBoxes.");
        // Podríamos decidir no proceder o lanzar un error aquí.
        // Si continuamos, y winnerPK_Hex es null, la creación de winnerAddress fallará.
        if (totalPrizePoolNanoErg > 0) {
             console.warn("Prize pool exists but no winner determined. This scenario needs defined handling.");
        }
        // Para que la TX se pueda construir, necesitamos una PK para el output del ganador.
        // Si no hay ganador, el script on-chain no debería permitir que se creen los outputs de premio.
        // Esto significa que esta función off-chain debe reflejar esa lógica: si no hay ganador, no crear la TX de premio.
        // En un caso real, si no hay ganador, el pozo podría ir al creador o a un fondo de la comunidad,
        // o las participation fees podrían ser reclamables. Esto depende del diseño completo de Action 3.
        // El script `game.es` actual se detendría si `foundAWinningCandidate` es false.
        throw new Error("No valid winner could be determined on-chain simulation. Cannot proceed with resolution.");
    }
    if (winnerPK_Hex === null && validProcessedParticipationBoxes.length === 0 && totalPrizePoolNanoErg === 0n){
        console.log("No valid participations found. Resolving to return stake to creator only.");
        // En este caso, solo se devuelve el stake al creador y el NFT.
        // No hay premio, no hay comisión.
    }

    const creatorCommissionAmount = (totalPrizePoolNanoErg * BigInt(commissionPercentage)) / 100n;
    const finalWinnerPrizeNanoErg = totalPrizePoolNanoErg - creatorCommissionAmount;

    // --- 3. Preparar OUTPUTS ---
    let winnerOutputBuilder: OutputBuilder | null = null;
    if (winnerPK_Hex) { // Solo crear output de ganador si hay un ganador
        const winnerPkBytes = hexToBytes(winnerPK_Hex);
        if (!winnerPkBytes) throw new Error("Invalid winner PK hex for output construction.");
        const winnerAddress = ErgoAddress.fromPublicKey(winnerPkBytes);

        winnerOutputBuilder = new OutputBuilder(
            finalWinnerPrizeNanoErg > 0n ? finalWinnerPrizeNanoErg : SAFE_MIN_BOX_VALUE,
            winnerAddress.toString()
        ).addTokens([{ tokenId: gameNftId, amount: 1n }]); // TODO add image and description with the score and number of participants.
    } else if (totalPrizePoolNanoErg > 0n) {
        // Hay un pozo de premios pero no se determinó un ganador (ej. todas las PBox fallaron la validación de score)
        // Esta situación es problemática. El script on-chain probablemente no permitiría esto.
        // El pozo debería ir a algún lado. Por ahora, lanzaremos un error si esto ocurre.
        throw new Error("Prize pool exists but no winner was determined. Resolution logic needs to handle this.");
    }


    // El creador recupera su stake original + su comisión.
    // El valor de sRevealBoxCandidate (si la hay y se usa) debe ser devuelto.
    // Por ahora, sRevealBoxCandidate no se incluye como input específico para S-reveal,
    // el creador firma la TX al gastar gameBoxToSpend.
    // Si el creador usa una de sus cajas para cubrir fees, el cambio se le devuelve.
    let creatorFinalPayout = creatorStakeNanoErg + creatorCommissionAmount;
    // Si no hay ganador y había pozo, ¿qué pasa con el pozo? El script on-chain lo definirá.
    // Asumamos que si no hay ganador, el pozo NO va al creador a menos que el script lo especifique.
    // El script actual SÍ asigna el pozo (después de comisión) a un ganador. Si no hay ganador, la TX fallará on-chain.
    // Por ahora, si winnerPK_Hex es null, el pozo "desaparece" en esta lógica off-chain, lo cual no es bueno.
    // Si no hay ganador y hay pozo, la tx debe construirse de manera que el script on-chain aún pueda validarla.
    // Esto usualmente significa que el pozo se devuelve al creador o a otra dirección predefinida.
    // El script `game.es` actual fallará si `foundAWinningCandidate` es false y `totalPrizePool > 0`.

    if (winnerPK_Hex === null && totalPrizePoolNanoErg > 0n) {
        // Si no hay ganador, el pozo (después de la comisión del creador sobre ese pozo) debería ir al creador.
        // Esto es una asunción de diseño si el script no lo maneja explícitamente para "quemarlo" o enviarlo a otro lado.
        console.warn("No winner determined, but prize pool exists. Assuming remaining prize pool (after commission) goes to creator.");
        creatorFinalPayout += finalWinnerPrizeNanoErg; // El "premio del ganador" que no fue a nadie, vuelve al creador
    }


    const creatorOutput = new OutputBuilder(
        creatorFinalPayout,
        creatorAddressString 
    );
    // Añadir el secreto S revelado al R4 del output del creador
    creatorOutput.setAdditionalRegisters({ R4: SColl(SByte, secretS_bytes).toHex() });
    // Si el ganador no recibió el NFT (porque no hubo ganador), el creador lo recupera.
    if (!winnerOutputBuilder) {
        creatorOutput.addTokens([{ tokenId: gameNftId, amount: 1n }]);  // TODO add image and description with the score and number of participants.
    }


    // --- 4. Preparar Pool de Inputs para .from() ---
    // Los inputs son la gameBox y las participationBoxes que fueron válidas y procesadas.
    // El creador también puede necesitar añadir cajas para cubrir la comisión de tx.
    const inputsForTx: Box<Amount>[] = [
        parseBox(gameBoxToSpend),
        ...validProcessedParticipationBoxes
    ];

    const currentWalletUtxos: InputBox[] = await ergo.get_utxos();
    const distinctWalletUtxosForPool = currentWalletUtxos.filter(
        utxo => !inputsForTx.find(sci => sci.boxId === utxo.boxId)
    );
    const inputPoolForBuilder: Box<Amount>[] = [...inputsForTx, ...distinctWalletUtxosForPool];

    // --- 5. Construir la Transacción ---
    const currentHeight = await ergo.get_current_height(); 
    const builder = new TransactionBuilder(currentHeight)
        .from(inputPoolForBuilder);

    // Añadir outputs
    if (winnerOutputBuilder) {
        builder.to(winnerOutputBuilder); // Añadir output del ganador si existe
        builder.to(creatorOutput);       // Luego el del creador
    } else {
        // Si no hay ganador, solo hay output del creador (que incluye el pozo si así se diseñó)
        builder.to(creatorOutput);
    }
        
    builder.sendChangeTo(changeAddressString) 
           .payFee(RECOMMENDED_MIN_FEE_VALUE);

    const unsignedTransaction = await builder.build();
    const eip12UnsignedTransaction = await unsignedTransaction.toEIP12Object();
    
    // --- 6. Firmar y Enviar ---
    const signedTransaction = await ergo.sign_tx(eip12UnsignedTransaction);
    if (!signedTransaction) throw new Error("Transaction signing was cancelled or failed.");

    const transactionId = await ergo.submit_tx(signedTransaction);
    if (!transactionId) throw new Error("Failed to submit game resolution transaction.");

    console.log(`Game resolved successfully. Transaction ID: ${transactionId}`);
    return transactionId;
}