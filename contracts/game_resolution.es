{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  val JUDGE_PERIOD = 30L 
  val PARTICIPATION_SUBMITTED_SCRIPT_HASH = fromBase16("...") 
  val PARTICIPATION_RESOLVED_SCRIPT_HASH = fromBase16("...")
  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd")

  // =================================================================
  // === DEFINICIONES DE REGISTROS (ESTADO DE RESOLUCIÓN FINAL)
  // =================================================================

  // R4: (Long, Int)                - (resolutionDeadline, resolvedCounter): Límite de bloque y contador.
  // R5: Coll[Byte]                 - revealedSecretS: El secreto 'S' del juego.
  // R6: Coll[Long]                 - numericalParameters: [deadline, creatorStake, participationFee].
  // R7: Coll[Byte]                 - winnerCandidateCommitment: El 'commitmentC' del candidato a ganador.
  // R8: (Coll[Byte], Int)          - resolvedorInfo: (Clave pública del "Resolvedor", % de comisión). El Resolvedor es quien recibe el stake y la comisión.
  // R9: (Coll[Byte], Coll[Byte])   - gameProvenance: (Clave pública del CREADOR ORIGINAL, Detalles del juego en JSON/Hex). R9._1 es inmutable.

  // =================================================================
  // === EXTRACCIÓN DE VALORES
  // =================================================================

  val resolutionDeadline = SELF.R4[(Long, Int)].get._1

  val resolvedorInfo = SELF.R8[(Coll[Byte], Int)].get
  val resolvedorPK = resolvedorInfo._1
  val commissionPercentage = resolvedorInfo._2

  val creatorStake = SELF.R6[Coll[Long]].get(1)
  
  val gameNft = SELF.tokens(0)
  val gameNftId = gameNft._1

  val isBeforeResolutionDeadline = HEIGHT < resolutionDeadline
  val isAfterResolutionDeadline = HEIGHT >= resolutionDeadline

  // =================================================================
  // === ACCIONES DE GASTO
  // =================================================================

  // ### Acción 1: Incluir Participación Omitida
  // Permite a un usuario incluir una participación que fue omitida en la transición inicial.
  // Si la nueva participación tiene un score mayor, se convierte en el nuevo candidato.
  // En cualquier caso, el ejecutor se convierte en el nuevo "Resolvedor".
  val action1_includeOmittedParticipation = {
    // La acción sigue necesitando ocurrir antes de la fecha límite de resolución.
    // Ahora también requiere un dataInput para el candidato actual.
    if (isBeforeResolutionDeadline && INPUTS.size > 1 && OUTPUTS.size > 1 && CONTEXT.dataInputs.size > 0) {
      val submittedPBox = INPUTS(1)         // La participación omitida que se va a incluir.
      val recreatedGameBox = OUTPUTS(0)     // La caja del juego recreada.
      val currentCandidateBox = CONTEXT.dataInputs(0) // El candidato actual, para comparar scores.

      // 1. VERIFICACIONES INICIALES
      // a) La participación sometida debe ser una caja 'participation_submitted.es' válida para este juego.
      val pBoxIsValid = blake2b256(submittedPBox.propositionBytes) == PARTICIPATION_SUBMITTED_SCRIPT_HASH &&
                        submittedPBox.R6[Coll[Byte]].get == gameNftId

      // b) El dataInput debe ser la caja del candidato a ganador actual.
      val candidateDataInputIsValid = currentCandidateBox.R5[Coll[Byte]].get == SELF.R7[Coll[Byte]].get &&
                                      blake2b256(currentCandidateBox.propositionBytes) == PARTICIPATION_RESOLVED_SCRIPT_HASH &&
                                      currentCandidateBox.R6[Coll[Byte]].get == gameNftId

      if (pBoxIsValid && candidateDataInputIsValid) {
        val revealedS = SELF.R5[Coll[Byte]].get
        
        // 2. CÁLCULO DE SCORES
        // a) Score de la nueva participación.
        val newScore = submittedPBox.R9[Coll[Long]].get.fold((-1L, false), { (acc, score) =>
          if (acc._2) { acc } else {
            val testCommitment = blake2b256(submittedPBox.R7[Coll[Byte]].get ++ longToByteArray(score) ++ submittedPBox.R8[Coll[Byte]].get ++ revealedS)
            if (testCommitment == submittedPBox.R5[Coll[Byte]].get) { (score, true) } else { acc }
          }
        })._1
        
        // b) Score del candidato actual.
        val currentScore = currentCandidateBox.R9[Coll[Long]].get.fold((-1L, false), { (acc, score) =>
          if (acc._2) { acc } else {
            val testCommitment = blake2b256(currentCandidateBox.R7[Coll[Byte]].get ++ longToByteArray(score) ++ currentCandidateBox.R8[Coll[Byte]].get ++ revealedS)
            if (testCommitment == currentCandidateBox.R5[Coll[Byte]].get) { (score, true) } else { acc }
          }
        })._1

        // 3. LÓGICA CONDICIONAL Y DE RECREACIÓN
        // a) Determinar el nuevo candidato para R7. Solo cambia si el nuevo score es estrictamente mayor.
        val newWinnerCandidateCommitment = if (newScore > currentScore) {
          submittedPBox.R5[Coll[Byte]].get
        } else {
          SELF.R7[Coll[Byte]].get
        }

        // b) El ejecutor siempre se convierte en el nuevo Resolvedor.
        val executorPK = OUTPUTS(1).propositionBytes.slice(4, 37) // Asumimos que la salida 1 es del ejecutor.

        // c) Validar la caja del juego recreada.
        val gameBoxIsRecreatedCorrectly = {
          recreatedGameBox.propositionBytes == SELF.propositionBytes &&
          recreatedGameBox.R7[Coll[Byte]].get == newWinnerCandidateCommitment && // R7 se establece condicionalmente.
          recreatedGameBox.R8[(Coll[Byte], Int)].get._1 == executorPK &&       // R8 siempre se actualiza.
          recreatedGameBox.R9[(Coll[Byte], Coll[Byte])].get == SELF.R9[(Coll[Byte], Coll[Byte])].get // R9 (creador original) nunca cambia.
        }
        
        // d) Validar que la participación omitida se recrea como 'participation_resolved.es'.
        val participationIsRecreated = OUTPUTS.exists { outBox =>
          blake2b256(outBox.propositionBytes) == PARTICIPATION_RESOLVED_SCRIPT_HASH &&
          outBox.value == submittedPBox.value &&
          outBox.R4[Coll[Byte]].get == submittedPBox.R4[Coll[Byte]].get &&
          outBox.R5[Coll[Byte]].get == submittedPBox.R5[Coll[Byte]].get
        }
        
        gameBoxIsRecreatedCorrectly && participationIsRecreated
      } else { false }
    } else { false }
  }

  // ### Acción 2: Invalidación por Jueces
  // Un panel de jueces anula al candidato actual. La lógica no cambia.
  val action2_judgesInvalidate = {
    if (isBeforeResolutionDeadline) {
      val isValidJudgeSignature = true // Placeholder para una validación real de multi-firma.
      val recreatedGameBox = OUTPUTS(0)
      val invalidatedCandidateBox = INPUTS(1)
      
      val fundsReturnedToPool = recreatedGameBox.value >= SELF.value + invalidatedCandidateBox.value
      val deadlineIsExtended = recreatedGameBox.R4[(Long, Int)].get._1 >= resolutionDeadline + JUDGE_PERIOD
      val candidateIsReset = recreatedGameBox.R7[Coll[Byte]].get.size == 0

      isValidJudgeSignature && fundsReturnedToPool && deadlineIsExtended && candidateIsReset
    } else { false }
  }

  // ### Acción 3: Finalización del Juego
  // Finaliza el juego y paga al ganador y al "Resolvedor" actual (que puede ser el creador o un cazarrecompensas).
  val action3_endGame = {
    if (isAfterResolutionDeadline && OUTPUTS.size > 1) {
      val winnerOutput = OUTPUTS(0)
      val resolvedorOutput = OUTPUTS(1)
      
      val prizePool = SELF.value - creatorStake
      val resolvedorCommissionAmount = prizePool * commissionPercentage / 100
      val winnerPrize = prizePool - resolvedorCommissionAmount

      // Encontrar la caja del ganador en las entradas para obtener su clave pública.
      val winnerCandidateCommitment = SELF.R7[Coll[Byte]].get
      val winnerBoxOption = INPUTS.find({ (box: Box) => box.R5[Coll[Byte]].get == winnerCandidateCommitment })
      val winnerPK = winnerBoxOption.get.R4[Coll[Byte]].get
      val winnerAddressBytes = P2PK_ERGOTREE_PREFIX ++ winnerPK
      
      val winnerGetsPrize = winnerOutput.value >= winnerPrize &&
                            winnerOutput.propositionBytes == winnerAddressBytes &&
                            winnerOutput.tokens.contains(gameNft)
      
      // El pago va al "Resolvedor" actual, cuya PK está en R8.
      val resolvedorGetsPaid = resolvedorOutput.value >= creatorStake + resolvedorCommissionAmount &&
                               resolvedorOutput.propositionBytes == (P2PK_ERGOTREE_PREFIX ++ resolvedorPK)
      
      winnerGetsPrize && resolvedorGetsPaid
    } else { false }
  }

  sigmaProp(action1_includeOmittedParticipation || action2_judgesInvalidate || action3_endGame)
}