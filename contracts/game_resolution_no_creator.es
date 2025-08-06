{
  // === Constants ===
  val JUDGE_PERIOD = 30L
  val PARTICIPATION_RESOLVED_SCRIPT_HASH = fromBase16("...") // Placeholder

  // === Register Definitions (GameBox in Penalty State - REVISED) ===
  // R4: (Long, Int)       - (resolutionDeadline, resolvedCounter): Límite de bloque y contador.
  // R5: Coll[Byte]        - revealedSecretS: El secreto 'S' del juego.
  // R6: Coll[Long]        - numericalParameters: [deadline, creatorStake, participationFee].
  // R7: Coll[Byte]        - winnerCandidateCommitment: El 'commitmentC' del candidato a ganador.
  // R8: (Coll[Byte], Int) - penaltyInfo: (lastRevealerPK, commissionPercentage). La PK es de la última persona que desveló una omisión.
  // R9: Coll[Byte]        - gameDetailsJsonHex: Detalles del juego.
  
  // === Value Extraction ===
  val resolutionDeadline = SELF.R4[(Long, Int)].get._1
  
  val penaltyInfo = SELF.R8[(Coll[Byte], Int)].get
  val lastRevealerPK = penaltyInfo._1
  val commissionPercentage = penaltyInfo._2

  val creatorStakeAtRisk = SELF.R6[Coll[Long]].get(1)
  val gameNft = SELF.tokens(0)

  val isBeforeResolutionDeadline = HEIGHT < resolutionDeadline
  val isAfterResolutionDeadline = HEIGHT >= resolutionDeadline

  // =================================================================
  // === ACCIONES DE GASTO
  // =================================================================

  // ### Acción 1: Disputa (Participation Omitted)
  // Alguien desvela una participación omitida con mayor puntuación. Esta acción ahora actualiza quién es el 'lastRevealer'.
  val action1_dispute = {
    if (isBeforeResolutionDeadline && INPUTS.size > 1 && OUTPUTS.size > 1) {
      
      val submittedPBox = INPUTS(1)
      val recreatedGameBox = OUTPUTS(0)
      
      // La PK del ejecutor (quien realiza la transacción de disputa) se convierte en el nuevo 'lastRevealer'.
      // Esta PK se extraería de una salida de la transacción que se paga a sí mismo.
      val executorPK = OUTPUTS(1).R4[Coll[Byte]].get // Asumiendo que OUTPUTS(1) es la recompensa/cambio del ejecutor.

      // 1. Placeholder para la lógica que verifica que el nuevo score es mayor.
      val newScoreIsHigher = true 

      // 2. Validar que la caja del juego se recrea correctamente.
      val gameBoxIsRecreatedCorrectly = {
          blake2b256(recreatedGameBox.propositionBytes) == blake2b256(SELF.propositionBytes) &&
          recreatedGameBox.R7[Coll[Byte]].get == submittedPBox.R5[Coll[Byte]].get && // Se actualiza el candidato.
          recreatedGameBox.R8[(Coll[Byte], Int)].get._1 == executorPK && // ¡Importante! Se actualiza el último revelador.
          recreatedGameBox.R8[(Coll[Byte], Int)].get._2 == commissionPercentage // La comisión se mantiene.
      }
      newScoreIsHigher && gameBoxIsRecreatedCorrectly
    } else { false }
  }

  // ### Acción 2: Jueces Invalidan Candidato
  // Un panel de jueces anula al candidato actual. La lógica es similar a la versión anterior.
  val action2_judgesInvalidate = {
    if (isBeforeResolutionDeadline) {
      val isValidJudgeSignature = true // Placeholder para la lógica de validación de firmas de jueces.
      val recreatedGameBox = OUTPUTS(0)
      val fundsReturnedToPool = recreatedGameBox.value > SELF.value
      val deadlineIsExtended = recreatedGameBox.R4[(Long, Int)].get._1 >= resolutionDeadline + JUDGE_PERIOD
      isValidJudgeSignature && fundsReturnedToPool && deadlineIsExtended
    } else { false }
  }

  // ### Acción 3: Finalizar Juego (Distribución con Penalización)
  // El período de resolución termina. Se distribuyen los fondos según las reglas de penalización.
  val action3_finalize = {
    if (isAfterResolutionDeadline) {
      
      val participantInputs = INPUTS.slice(1, INPUTS.size)
      val numParticipants = participantInputs.size
      
      // 1. Calcular el valor total del premio y la comisión.
      val totalPrizePool = participantInputs.fold(0L, { (acc: Long, box: Box) => acc + box.value })
      val totalCommission = totalPrizePool * commissionPercentage / 100
      
      // 2. Validar la salida de recompensa para el último revelador.
      //    El stake del creador va para la persona que desveló la última omisión.
      val rewardOutput = OUTPUTS(0) // Asumimos que la primera salida es la recompensa.
      val stakeGoesToRevealer = rewardOutput.value >= creatorStakeAtRisk &&
                                rewardOutput.propositionBytes == proveDlog(lastRevealerPK).propBytes
      
      // 3. Validar la salida del ganador.
      val winnerOutput = OUTPUTS(1) // Asumimos que la segunda salida es la del ganador.
      val winnerGetsPrize = winnerOutput.tokens.contains(gameNft) &&
                            winnerOutput.value >= totalPrizePool // El ganador se lleva el bote principal.
                            // La validación del P2PK del ganador se haría aquí.
      
      // 4. Validar la redistribución de la comisión.
      //    La comisión se reparte a partes iguales entre todos los participantes (incluido el ganador).
      val commissionPerParticipant = totalCommission / numParticipants
      val commissionIsRedistributed = {
        // Se debe verificar que existen salidas que devuelven a cada participante su parte de la comisión.
        // Esto es complejo de modelar genéricamente, pero la lógica sería:
        // Para cada `p` en `participantInputs`, debe existir una `o` en `OUTPUTS` tal que:
        //   o.propositionBytes == p.R4[Coll[Byte]].get (la PK del participante)
        //   o.value >= commissionPerParticipant
        true // Placeholder para esta lógica de validación.
      }
      
      stakeGoesToRevealer && winnerGetsPrize && commissionIsRedistributed

    } else { false }
  }

  // La caja se puede gastar si se cumple cualquiera de las tres condiciones.
  sigmaProp(action1_dispute || action2_judgesInvalidate || action3_finalize)
}