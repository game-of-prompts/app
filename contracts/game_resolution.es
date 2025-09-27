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
  val PARTICIPATION_TYPE_ID = fromBase16("`+PARTICIPATION_TYPE_ID+`")


  // =================================================================
  // === DEFINICIONES DE REGISTROS
  // =================================================================

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

        val votesIntegrity = judgeVotes.forall( { (voteBox: Box) =>
          
          val allJudgesParticipate = participatingJudges.exists({ (pJudge: Coll[Byte]) => pJudge == voteBox.tokens(0)._1 })
          val isGoProofType = voteBox.R4[Coll[Byte]].get == PARTICIPATION_TYPE_ID
          val correctVoteTargetCommitment = voteBox.R5[Coll[Byte]].get == winnerCandidateCommitment
          
          allJudgesParticipate && isGoProofType && correctVoteTargetCommitment
        })

        allVotesAreUnique && votesIntegrity
      }

      val recreatedGameBoxes = OUTPUTS.filter({(b:Box) => b.propositionBytes == SELF.propositionBytes})
      
      if (votesAreValid && recreatedGameBoxes.size == 1) {
        
        val recreatedGameBox = recreatedGameBoxes(0)
        val participantInputs = CONTEXT.dataInputs.filter({(b:Box) => blake2b256(b.propositionBytes) == PARTICIPATION_RESOLVED_SCRIPT_HASH})
        val invalidatedCandidateBox = INPUTS.filter({(b:Box) => blake2b256(b.propositionBytes) == PARTICIPATION_RESOLVED_SCRIPT_HASH && b.R5[Coll[Byte]].get == winnerCandidateCommitment})(0)

        val initialFoldState = (-1L, Coll[Byte]()) // (maxScore, nextCandidateCommitment)
        // TODO Check
        // todo filter participantInputs with:  ¿?
        //   -  val correctParticipationFee = pBox.value >= participationFee
        //   -  val pBox.creationHeight <= game.resolutionDeadline
        // New deadline should be HEIGHT + JUDGE_PERIOD, not resolutionDeadline + JUDGE_PERIOD
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
    // La condición principal no cambia: solo se puede finalizar después del deadline.
    if (isAfterResolutionDeadline && OUTPUTS.size > 0) {

      // Valores comunes para ambos casos (con y sin ganador)
      val participations = INPUTS.filter({ (box: Box) => blake2b265(box.propositionBytes) == PARTICIPATION_RESOLVED_SCRIPT_HASH })
      val prizePool = participations.fold(0L, { (acc: Long, pBox: Box) => acc + pBox.value })
      
      // Se asume que el commitment del ganador está en R5 como una Opción.
      // Si no hay ganador, R5[Option[Coll[Byte]]] estará vacío (None).
      val winnerCandidateCommitmentOpt = SELF.R5[Option[Coll[Byte]]].get

      // --- MEJORA 3: Manejar el caso CON y SIN ganador ---
      if (winnerCandidateCommitmentOpt.isDefined) {
        // --- CASO 1: HAY UN GANADOR DECLARADO ---
        val winnerCandidateCommitment = winnerCandidateCommitmentOpt.get

        // --- MEJORA 1: Verificación segura del input del ganador ---
        val winnerBoxes = participations.filter({ (box: Box) => box.R5[Coll[Byte]].get == winnerCandidateCommitment })

        // Solo continuamos si se encuentra exactamente una caja de participación para el ganador.
        if (winnerBoxes.size > 0) {  // Maybe there are more than one box with the same commitment, but at least one. (it's secure because the commitment includes the public key)
          val winnerBoxInput = winnerBoxes(0)
          val winnerPK = winnerBoxInput.R4[Coll[Byte]].get

          // La lógica de cálculo de pagos es la misma que la original.
          val resolverCommission = prizePool * commissionPercentage / 100L
          val devCommission = prizePool * DEV_COMMISSION_PERCENTAGE / 100L
          val winnerBasePrize = prizePool - resolverCommission - devCommission

          val winnerGetsBasePrize = winnerBasePrize >= MIN_ERG_BOX

          val intermediateDevPayout = if (winnerGetsBasePrize) { devCommission } else { 0L }
          val intermediateResolverPayout = if (winnerGetsBasePrize) { creatorStake + resolverCommission } else { creatorStake }
          val intermediateWinnerPayout = if (winnerGetsBasePrize) { winnerBasePrize } else { prizePool + creatorStake }

          val devForfeits = if (intermediateDevPayout < MIN_ERG_BOX && intermediateDevPayout > 0L) { intermediateDevPayout } else { 0L }
          val resolverForfeits = if (intermediateResolverPayout < MIN_ERG_BOX && intermediateResolverPayout > 0L) { intermediateResolverPayout } else { 0L }

          val finalDevPayout = intermediateDevPayout - devForfeits
          val finalResolverPayout = intermediateResolverPayout - resolverForfeits
          val finalWinnerPrize = intermediateWinnerPayout + devForfeits + resolverForfeits

          // --- MEJORA 2: Validación flexible de la salida del ganador ---
          // Se usa `OUTPUTS.exists` en lugar de `OUTPUTS(0)` para no depender del orden.
          val winnerGetsPaid = OUTPUTS.exists({ (b: Box) =>
              b.value >= finalWinnerPrize &&
              b.propositionBytes == (P2PK_ERGOTREE_PREFIX ++ winnerPK) &&
              b.tokens.size == 1 && // Buena práctica: asegurar que solo está el NFT
              b.tokens(0)._1 == gameNftId
          })

          val resolverGetsPaid = if (finalResolverPayout > 0L) {
              OUTPUTS.exists({(b:Box) => b.value >= finalResolverPayout && b.propositionBytes == (P2PK_ERGOTREE_PREFIX ++ resolverPK)})
          } else { true }
          
          val devGetsPaid = if (finalDevPayout > 0L) {
              OUTPUTS.exists({(b:Box) => b.value >= finalDevPayout && b.propositionBytes == DEV_ADDR.propBytes})
          } else { true }

          winnerGetsPaid && resolverGetsPaid && devGetsPaid
        } else {
          // Si no se encuentra la caja del ganador, la transacción es inválida.
          false
        }
      } else {
        // --- CASO 2: NO HAY GANADOR DECLARADO ---
        // El resolutor reclama el stake del creador y el pozo de premios, pagando la comisión del dev.
        val totalValue = prizePool + creatorStake
        val devCommission = prizePool * DEV_COMMISSION_PERCENTAGE / 100L

        // Lógica de polvo para la comisión del desarrollador.
        val devForfeits = if (devCommission < MIN_ERG_BOX && devCommission > 0L) { devCommission } else { 0L }
        val finalDevPayout = devCommission - devForfeits
        
        // El resolutor se lleva todo lo demás.
        val finalResolverPayout = totalValue - finalDevPayout

        // Verificación de las salidas para el caso sin ganador.
        val resolverGetsPaid = OUTPUTS.exists({ (b: Box) =>
            b.value >= finalResolverPayout &&
            b.propositionBytes == (P2PK_ERGOTREE_PREFIX ++ resolverPK) &&
            b.tokens.size == 1 && // El resolutor recibe el NFT
            b.tokens(0)._1 == gameNftId
        })
        
        val devGetsPaid = if (finalDevPayout > 0L) {
            OUTPUTS.exists({(b:Box) => b.value >= finalDevPayout && b.propositionBytes == DEV_ADDR.propBytes})
        } else { true }
        
        // No debe haber más salidas (excepto la del cambio, que el script no valida).
        resolverGetsPaid && devGetsPaid
      }
    } else {
      false
    }
  }

  val game_in_resolution = gameState == 1
  val actions = action1_includeOmittedParticipation || action2_judgesInvalidate || action3_endGame
  sigmaProp(game_in_resolution && actions)
}