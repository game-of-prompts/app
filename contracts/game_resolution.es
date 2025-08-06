{
  // === Constants ===
  // Período de tiempo adicional que los jueces tienen para votar si un candidato es invalidado.
  val JUDGE_PERIOD = 30L 
  
  // Hash de los scripts de las cajas de participación y del estado de penalización.
  val PARTICIPATION_SUBMITTED_SCRIPT_HASH = fromBase16("...") // Placeholder
  val PARTICIPATION_RESOLVED_SCRIPT_HASH = fromBase16("...")  // Placeholder
  val GAME_RESOLUTION_NO_CREATOR_SCRIPT_HASH = fromBase16("...") // Placeholder

  // === Register Definitions (GameBox in Resolution State) ===
  // R4: (Long, Int)       - (resolutionDeadline, resolvedCounter): Límite de bloque para finalizar la resolución y contador de participaciones resueltas.
  // R5: Coll[Byte]        - revealedSecretS: El secreto 'S' del juego, ya revelado.
  // R6: Coll[Long]        - numericalParameters: [deadline, creatorStake, participationFee].
  // R7: Coll[Byte]        - winnerCandidateCommitment: El 'commitmentC' de la caja de participación que es candidata a ganar.
  // R8: (Coll[Byte], Int) - creatorInfo: (gameCreatorPK, commissionPercentage).
  // R9: Coll[Byte]        - gameDetailsJsonHex: Detalles del juego.
  
  // === Value Extraction ===
  val resolutionParams = SELF.R4[(Long, Int)].get
  val resolutionDeadline = resolutionParams._1

  val creatorInfo = SELF.R8[(Coll[Byte], Int)].get
  val gameCreatorPK = creatorInfo._1

  val winnerCandidateCommitment = SELF.R7[Coll[Byte]].get
  val gameNft = SELF.tokens(0)

  val isBeforeResolutionDeadline = HEIGHT < resolutionDeadline
  val isAfterResolutionDeadline = HEIGHT >= resolutionDeadline

  // === ACTION 1: Participation Omitted (Dispute) ===
  // Alguien encuentra una participación con una puntuación más alta que la del candidato actual.
  // Esto puede llevar a una penalización donde la caja se recrea con el script 'game_resolution_no_creator.es'.
  val action1_participationOmitted = {
    // Esta acción solo puede ocurrir antes de que finalice el período de resolución.
    if (isBeforeResolutionDeadline && INPUTS.size > 1 && OUTPUTS.size > 1) {
      
      val submittedPBox = INPUTS(1) // La caja de participación que se afirma que fue omitida.
      val recreatedGameBox = OUTPUTS(0)

      // 1. Validar que la participación sometida es estructuralmente correcta.
      val isPBoxStructurallyValid = blake2b256(submittedPBox.propositionBytes) == PARTICIPATION_SUBMITTED_SCRIPT_HASH &&
                                    submittedPBox.R6[Coll[Byte]].get == gameNft._1
      
      // 2. Lógica para verificar que el nuevo participante tiene un score mayor.
      //    Esto implicaría usar DATA_INPUTS para acceder a la caja del candidato actual y comparar scores.
      //    val newScoreIsHigher = ... (lógica de comparación de scores)
      val newScoreIsHigher = true // Placeholder para la lógica de comparación.

      // 3. Validar la integridad de la caja del juego recreada.
      val newWinnerCommitment = submittedPBox.R5[Coll[Byte]].get // El nuevo candidato es la participación sometida.
      val gameBoxIsRecreatedCorrectly = {
          // La caja recreada debe actualizar el candidato en R7 y mantener los demás datos.
          recreatedGameBox.R7[Coll[Byte]].get == newWinnerCommitment &&
          recreatedGameBox.tokens(0)._1 == gameNft._1 &&
          recreatedGameBox.value >= SELF.value // Puede disminuir si hay penalización.
          // ... (más validaciones de integridad de R4, R5, R6, R8, R9)
      }

      // 4. Determinar si se aplica la penalización.
      //    Si el creador fue malicioso, la nueva caja usará el script de penalización.
      val isPenaltyApplied = blake2b256(recreatedGameBox.propositionBytes) == GAME_RESOLUTION_NO_CREATOR_SCRIPT_HASH
      
      // 5. La recompensa por encontrar la omisión debe ser pagada.
      //    EL stake del creador se pagará a quien agregue la ultima participacion omitida, la dirección de este
      val executorGetsReward = true // Placeholder para la lógica de recompensa.

      isPBoxStructurallyValid && newScoreIsHigher && gameBoxIsRecreatedCorrectly && (isPenaltyApplied || executorGetsReward)

    } else { false }
  }

  // === ACTION 2: Judges Invalidate Candidate ===
  // Un panel de jueces (multi-sig) vota para anular al candidato actual.
  val action2_judgesInvalidate = {
    if (isBeforeResolutionDeadline) {
      // 1. Validar la firma de los jueces.
      //    Esto se comprueba a través de una condición de firma, como un proveDlog o un contrato multi-sig.
      val isValidJudgeSignature = proveDlog(gameCreatorPK) // Placeholder: debería ser la clave de los jueces.

      val recreatedGameBox = OUTPUTS(0)
      
      // 2. El candidato invalidado devuelve sus fondos a la caja del juego.
      //    La caja del juego recreada debe tener un valor incrementado.
      val fundsReturnedToPool = recreatedGameBox.value > SELF.value

      // 3. Se reinicia el período de resolución para evaluar a un nuevo candidato.
      val deadlineIsExtended = recreatedGameBox.R4[(Long, Int)].get._1 >= resolutionDeadline + JUDGE_PERIOD

      // 4. El candidato en R7 debe ser limpiado o reemplazado.
      val candidateIsReset = recreatedGameBox.R7[Coll[Byte]].get.size == 0 // Ejemplo: se limpia R7.

      isValidJudgeSignature && fundsReturnedToPool && deadlineIsExtended && candidateIsReset

    } else { false }
  }

  // === ACTION 3: End Game (Finalization) ===
  // El período de resolución ha terminado y no hay más disputas. El candidato gana.
  val action3_endGame = {
    if (isAfterResolutionDeadline && OUTPUTS.size > 1) {
      val winnerOutput = OUTPUTS(0)
      val creatorOutput = OUTPUTS(1)
      
      // 1. Verificar que todas las participaciones resueltas se consumen en la transacción.
      //    val allParticipationsAreInputs = INPUTS.slice(1, INPUTS.size).forall(...)
      val allParticipationsAreInputs = true // Placeholder

      // 2. Lógica para calcular el premio total y la comisión del creador.
      val totalPrizePool = SELF.value // Simplificación.
      val creatorCommission = totalPrizePool / 10 // Ejemplo: comisión del 10%.
      val winnerPrize = totalPrizePool - creatorCommission

      // 3. Validar la salida del ganador.
      //    val winnerPK = ... (extraer PK del candidato a partir del commitment en R7 y los datos de las participaciones).
      val winnerGetsPrize = winnerOutput.value >= winnerPrize &&
                            // winnerOutput.propositionBytes == PK(winnerPK).propBytes && // Lógica real
                            winnerOutput.tokens.contains(gameNft)
      
      // 4. Validar la salida del creador.
      val creatorGetsStakeAndCommission = creatorOutput.value >= SELF.R6[Coll[Long]].get(1) + creatorCommission &&
                                          creatorOutput.propositionBytes == proveDlog(gameCreatorPK).propBytes
      
      allParticipationsAreInputs && winnerGetsPrize && creatorGetsStakeAndCommission
    
    } else { false }
  }

  // La caja se puede gastar si se cumple cualquiera de las tres condiciones.
  sigmaProp(action1_participationOmitted || action2_judgesInvalidate || action3_endGame)
}