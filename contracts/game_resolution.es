{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  val JUDGE_PERIOD = 30L 
  val DEV_ADDR = PK("`+DEV_ADDR+`")
  val DEV_COMMISSION_PERCENTAGE = 5L
  val PARTICIPATION_SUBMITTED_SCRIPT_HASH = fromBase16("`+PARTICIPATION_SUBMITTED_SCRIPT_HASH+`") 
  val PARTICIPATION_RESOLVED_SCRIPT_HASH = fromBase16("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`")
  val REPUTATION_PROOF_SCRIPT_HASH = fromBase16("`+REPUTATION_PROOF_SCRIPT_HASH+`")
  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd")
  val MIN_ERG_BOX = 1000000L
  val PARTICIPATION_TYPE_ID = fromBase16("f6819e0b7cf99c8c7872b62f4985b8d900c6150925d01eb279787517a848b6d8")


  // =================================================================
  // === DEFINICIONES DE REGISTROS
  // =================================================================
  
  // -- OLD --
  // R4: (Long, Int)                - (resolutionDeadline, resolvedCounter): Límite de bloque y contador.
  // R5: (Coll[Byte], Coll[Byte])   - (revealedSecretS, winnerCandidateCommitment): El secreto y el candidato a ganador.
  // R6: Coll[Coll[Byte]]           - participatingJudges: Lista de IDs de tokens de reputación de los jueces.
  // R7: Coll[Long]                 - numericalParams: [deadline, creatorStake, participationFee].
  // R8: (Coll[Byte], Long)          - resolverInfo: (Clave pública del "Resolvedor", % de comisión).
  // R9: (Coll[Byte], Coll[Byte])   - gameProvenance: (Clave pública del CREADOR ORIGINAL, Detalles del juego en JSON/Hex).

  // -- NEW --
  // R4: Integer                    - Game state (0: Active, 1: Resolved, 2: Cancelled).
  // R5: (Coll[Byte], Coll[Byte])   - (revealedSecretS, winnerCandidateCommitment): El secreto y el candidato a ganador.
  // R6: Coll[Coll[Byte]]           - participatingJudges: Lista de IDs de tokens de reputación de los jueces.
  // R7: Coll[Long]                 - numericalParams: [deadline, creatorStake, participationFee, resolutionDeadline, resolvedCounter].
  // R8: (Coll[Byte], Long)         - resolverInfo: (Clave pública del "Resolvedor", % de comisión).
  // R9: (Coll[Byte], Coll[Byte])   - gameProvenance: (Clave pública del CREADOR ORIGINAL, Detalles del juego en JSON/Hex).

  // =================================================================
  // === EXTRACCIÓN DE VALORES
  // =================================================================

  val gameState = SELF.R4[Int].get

  val r5Tuple = SELF.R5[(Coll[Byte], Coll[Byte])].get
  val revealedS = r5Tuple._1
  val winnerCandidateCommitment = r5Tuple._2
  
  val participatingJudges = SELF.R6[Coll[Coll[Byte]]].get
  val numericalParams = SELF.R7[Coll[Long]].get
  val deadline = numericalParams(0)
  val creatorStake = numericalParams(1)
  val participationFee = numericalParams(2)
  val resolutionDeadline = numericalParams(3)
  val resolvedCounter = numericalParams(4)

  val resolverInfo = SELF.R8[(Coll[Byte], Long)].get
  val resolverPK = resolverInfo._1
  val commissionPercentage = resolverInfo._2
  
  val gameNft = SELF.tokens(0)
  val gameNftId = gameNft._1

  val isAfterResolutionDeadline = HEIGHT >= resolutionDeadline
  val isBeforeResolutionDeadline = HEIGHT < resolutionDeadline

  // =================================================================
  // === ACCIONES DE GASTO
  // =================================================================

  // ### Acción 1: Incluir Participación Omitida
  val action1_includeOmittedParticipation = {
    if (isBeforeResolutionDeadline && INPUTS.size > 1 && OUTPUTS.size > 1 && CONTEXT.dataInputs.size > 0) {
      val submittedPBox = INPUTS(1)
      val recreatedGameBox = OUTPUTS(0)
      val currentCandidateBox = CONTEXT.dataInputs(0)

      val pBoxIsValid = blake2b256(submittedPBox.propositionBytes) == PARTICIPATION_SUBMITTED_SCRIPT_HASH &&
                        submittedPBox.R6[Coll[Byte]].get == gameNftId // No se comprueba que fuera creada antes de la resolución, ya que se presupone que lo cubre la acción 2 del script de participación enviada.

      val candidateDataInputIsValid = currentCandidateBox.R5[Coll[Byte]].get == winnerCandidateCommitment &&
                                      blake2b256(currentCandidateBox.propositionBytes) == PARTICIPATION_RESOLVED_SCRIPT_HASH &&
                                      currentCandidateBox.R6[Coll[Byte]].get == gameNftId

      if (pBoxIsValid && candidateDataInputIsValid) {
        
        val newScore = submittedPBox.R9[Coll[Long]].get.fold((-1L, false), { (acc: (Long, Boolean), score: Long) =>
          if (acc._2) { acc } else {
            val testCommitment = blake2b256(submittedPBox.R7[Coll[Byte]].get ++ longToByteArray(score) ++ submittedPBox.R8[Coll[Byte]].get ++ revealedS)
            if (testCommitment == submittedPBox.R5[Coll[Byte]].get) { (score, true) } else { acc }
          }
        })._1
        
        val currentScore = currentCandidateBox.R9[Coll[Long]].get.fold((-1L, false), { (acc: (Long, Boolean), score: Long) =>
          if (acc._2) { acc } else {
            val testCommitment = blake2b256(currentCandidateBox.R7[Coll[Byte]].get ++ longToByteArray(score) ++ currentCandidateBox.R8[Coll[Byte]].get ++ revealedS)
            if (testCommitment == currentCandidateBox.R5[Coll[Byte]].get) { (score, true) } else { acc }
          }
        })._1

        val newWinnerCandidate = if (
            newScore > currentScore ||   // If the new score is higher than the current one
            newScore == currentScore && submittedPBox.creationInfo._1 < currentCandidateBox.creationInfo._1  // Or if the scores are equal but the new one is from an earlier block
          ) {
          submittedPBox.R5[Coll[Byte]].get
        } 
        else {
          winnerCandidateCommitment
        }

        val gameBoxIsRecreatedCorrectly = {
          recreatedGameBox.propositionBytes == SELF.propositionBytes &&
          recreatedGameBox.R4[Int].get == gameState &&
          recreatedGameBox.tokens.size == 1 &&
          recreatedGameBox.tokens(0)._1 == gameNftId &&
          recreatedGameBox.R5[(Coll[Byte], Coll[Byte])].get == (revealedS, newWinnerCandidate) &&  // Maintain the revealed secret and update the winner candidate
          recreatedGameBox.R6[Coll[Coll[Byte]]].get == participatingJudges &&  // The participating judges remain the same
          recreatedGameBox.R7[Coll[Long]].get(0) == deadline &&  // The game deadline remains the same
          recreatedGameBox.R7[Coll[Long]].get(1) == creatorStake &&  // The creator's stake remains the same
          recreatedGameBox.R7[Coll[Long]].get(2) == participationFee &&  // The participation fee remains the same
          recreatedGameBox.R7[Coll[Long]].get(3) == resolutionDeadline && // The resolution deadline remains the same
          recreatedGameBox.R7[Coll[Long]].get(4) == resolvedCounter + 1 && // The resolved counter remains the same
          recreatedGameBox.R8[(Coll[Byte], Long)].get._2 == commissionPercentage &&  // The resolver's commission percentage remains the same
          recreatedGameBox.R9[(Coll[Byte], Coll[Byte])].get == SELF.R9[(Coll[Byte], Coll[Byte])].get  // The game provenance remains the same
        }
        
        val participationIsRecreated = OUTPUTS.exists( { (outBox: Box) =>
          blake2b256(outBox.propositionBytes) == PARTICIPATION_RESOLVED_SCRIPT_HASH &&
          outBox.value == submittedPBox.value &&
          outBox.R4[Coll[Byte]].get == submittedPBox.R4[Coll[Byte]].get &&
          outBox.R5[Coll[Byte]].get == submittedPBox.R5[Coll[Byte]].get &&
          outBox.R6[Coll[Byte]].get == submittedPBox.R6[Coll[Byte]].get &&
          outBox.R7[Coll[Byte]].get == submittedPBox.R7[Coll[Byte]].get &&
          outBox.R8[Coll[Byte]].get == submittedPBox.R8[Coll[Byte]].get &&
          outBox.R9[Coll[Long]].get == submittedPBox.R9[Coll[Long]].get
        })
        
        gameBoxIsRecreatedCorrectly && participationIsRecreated
      } else { false }
    } else { false }
  }

  // ### Acción 2: Invalidación por Jueces
  val action2_judgesInvalidate = {
    if (isBeforeResolutionDeadline && CONTEXT.dataInputs.size > 0) {
      val judgeVotes = CONTEXT.dataInputs.filter({(b:Box) => blake2b256(b.propositionBytes) == REPUTATION_PROOF_SCRIPT_HASH})
      val requiredVotes =
        if (participatingJudges.size == 0) 0
        else participatingJudges.size / 2 + 1

      val votesAreValid = if (judgeVotes.size < requiredVotes) { false } else {
        val judgeVoteTokens = judgeVotes.map({(box: Box) => box.tokens(0)._1})
        
        val allVotesAreUnique = judgeVoteTokens.indices.forall { (i: Int) =>
            !(judgeVoteTokens.slice(i + 1, judgeVoteTokens.size).exists({ (otherToken: Coll[Byte]) =>
                otherToken == judgeVoteTokens(i)
            }))
        }

        allVotesAreUnique && judgeVotes.forall( { (voteBox: Box) =>
          val judgeTokenId = voteBox.tokens(0)._1
          val isGoProofType = voteBox.R4[Coll[Byte]].get == PARTICIPATION_TYPE_ID
          val voteTargetCommitment = voteBox.R5[Coll[Byte]].get
          val allJudgesParticipate = participatingJudges.exists({ (pJudge: Coll[Byte]) => pJudge == judgeTokenId })
          allJudgesParticipate && isGoProofType && voteTargetCommitment == winnerCandidateCommitment
        })
      }
      
      if (votesAreValid) {
        val recreatedGameBox = OUTPUTS(0)
        val participantInputs = CONTEXT.dataInputs.filter({(b:Box) => blake2b256(b.propositionBytes) == PARTICIPATION_RESOLVED_SCRIPT_HASH})
        val invalidatedCandidateBox = INPUTS.filter({(b:Box) => blake2b256(b.propositionBytes) == PARTICIPATION_RESOLVED_SCRIPT_HASH && b.R5[Coll[Byte]].get == winnerCandidateCommitment})(0)

        val initialFoldState = (-1L, Coll[Byte]()) // (maxScore, nextCandidateCommitment)
        val foldResult = participantInputs.fold(initialFoldState, { (acc: (Long, Coll[Byte]), pBox: Box) =>
            if (pBox.R5[Coll[Byte]].get != winnerCandidateCommitment) {  // In case is duplicated, ignore the invalidated candidate box
                val scoreCheckResult = pBox.R9[Coll[Long]].get.fold((-1L, false), { (scoreAcc: (Long, Boolean), score: Long) =>
                    if (scoreAcc._2) { scoreAcc } else {
                        val testCommitment = blake2b256(pBox.R7[Coll[Byte]].get ++ longToByteArray(score) ++ pBox.R8[Coll[Byte]].get ++ revealedS)
                        if (testCommitment == pBox.R5[Coll[Byte]].get) { (score, true) } else { scoreAcc }
                    }
                })
                val actualScore = scoreCheckResult._1
                if (actualScore > acc._1) { (actualScore, pBox.R5[Coll[Byte]].get) } else { acc }
            } else { acc }
        })
        val nextCandidateCommitment = foldResult._2

        val fundsReturnedToPool = recreatedGameBox.value >= SELF.value + invalidatedCandidateBox.value
        val deadlineIsExtended = recreatedGameBox.R7[Coll[Long]].get(3) >= resolutionDeadline + JUDGE_PERIOD
        val resolvedCounterIsDecreased = recreatedGameBox.R7[Coll[Long]].get(4) == resolvedCounter - 1
        val candidateIsReset = recreatedGameBox.R5[(Coll[Byte], Coll[Byte])].get._2 == nextCandidateCommitment
        val gameStateIsPreserved = recreatedGameBox.R4[Int].get == gameState && gameState == 1
        
        fundsReturnedToPool && deadlineIsExtended && resolvedCounterIsDecreased && candidateIsReset && gameStateIsPreserved
      } else { false }
    } else { false }
  }

  // ### Acción 3: Finalización del Juego
  val action3_endGame = {
    if (isAfterResolutionDeadline && OUTPUTS.size > 0) {
      // 1. Calcular los componentes base del pago

      val participations = INPUTS.filter({ (box: Box) => blake2b256(box.propositionBytes) == PARTICIPATION_RESOLVED_SCRIPT_HASH })

      val prizePool = participations.fold(0L, { (acc: Long, pBox: Box) => acc + pBox.value })

      val resolverCommission = prizePool * commissionPercentage / 100L
      val devCommission = prizePool * DEV_COMMISSION_PERCENTAGE / 100L
      val winnerBasePrize = prizePool - resolverCommission - devCommission

      // 2. Determinar los pagos intermedios según si el premio del ganador es "polvo"
      val winnerGetsBasePrize = winnerBasePrize >= MIN_ERG_BOX

      val intermediateDevPayout = if (winnerGetsBasePrize) { devCommission } else { 0L }
      val intermediateResolverPayout = if (winnerGetsBasePrize) { creatorStake + resolverCommission } else { creatorStake }
      val intermediateWinnerPayout = if (winnerGetsBasePrize) { winnerBasePrize } else { winnerBasePrize + resolverCommission + devCommission }

      // 3. Calcular qué cantidades se confiscan por ser "polvo" y redistribuirlas al ganador
      val devForfeits = if (intermediateDevPayout < MIN_ERG_BOX && intermediateDevPayout > 0L) { intermediateDevPayout } else { 0L }
      val resolverForfeits = if (intermediateResolverPayout < MIN_ERG_BOX && intermediateResolverPayout > 0L) { intermediateResolverPayout } else { 0L }

      val finalDevPayout = intermediateDevPayout - devForfeits
      val finalResolverPayout = intermediateResolverPayout - resolverForfeits
      val finalWinnerPrize = intermediateWinnerPayout + devForfeits + resolverForfeits

      // 4. Validar las salidas de la transacción
      val winnerBoxInput = participations.filter({ (box: Box) => box.R5[Coll[Byte]].get == winnerCandidateCommitment })(0)
      val winnerPK = winnerBoxInput.R4[Coll[Byte]].get

      // Por convención, la salida del ganador (que siempre recibe el NFT) debe ser la primera.
      val winnerOutput = OUTPUTS(0)
      val winnerGetsPaid = winnerOutput.value >= finalWinnerPrize &&
                           winnerOutput.propositionBytes == (P2PK_ERGOTREE_PREFIX ++ winnerPK) &&
                           winnerOutput.tokens(0)._1 == gameNftId
      
      // NOTA: Si `finalWinnerPrize` resulta ser menor que MIN_ERG_BOX, la creación de `winnerOutput` fallará a nivel de protocolo, lo cual es el comportamiento esperado para bloquear fondos insuficientes. No debería jamás alcanzarse este punto ya como mínimo cuanta con los fondos totales de una caja de participación.

      val resolverGetsPaid = if (finalResolverPayout > 0L) {
          OUTPUTS.exists({(b:Box) => b.value >= finalResolverPayout && b.propositionBytes == (P2PK_ERGOTREE_PREFIX ++ resolverPK)})
      } else { true }
      
      val devGetsPaid = if (finalDevPayout > 0L) {
          OUTPUTS.exists({(b:Box) => b.value >= finalDevPayout && b.propositionBytes == DEV_ADDR.propBytes})
      } else { true }

      // TODO Check participation resolved counter.

      winnerGetsPaid && resolverGetsPaid && devGetsPaid
    } else { false }
  }

  val game_in_resolution = gameState == 1
  val actions = action1_includeOmittedParticipation || action2_judgesInvalidate || action3_endGame
  sigmaProp(game_in_resolution && actions)
}