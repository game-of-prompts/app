{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  val JUDGE_PERIOD = 30L 
  val DEV_ADDR = PK("`+DEV_ADDR+`")
  val DEV_COMMISSION_PERCENTAGE = 5L
  val PARTICIPATION_SCRIPT_HASH = fromBase16("`+PARTICIPATION_SCRIPT_HASH+`") 
  val REPUTATION_PROOF_SCRIPT_HASH = fromBase16("`+REPUTATION_PROOF_SCRIPT_HASH+`")
  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd")
  val MIN_ERG_BOX = 1000000L
  val PARTICIPATION_TYPE_ID = fromBase16("`+PARTICIPATION_TYPE_ID+`")
  val MAX_SCORE_LIST = 10


  // =================================================================
  // === DEFINICIONES DE REGISTROS
  // =================================================================

  // R4: Integer                    - Game state (0: Active, 1: Resolved, 2: Cancelled).
  // R5: (Coll[Byte], Coll[Byte])   - (revealedSecretS, winnerCandidateCommitment): El secreto y el candidato a ganador.
  // R6: Coll[Coll[Byte]]           - participatingJudges: Lista de IDs de tokens de reputación de los jueces.
  // R7: Coll[Long]                 - numericalParams: [originalDeadline, creatorStake, participationFee, perJudgeComissionPercentage, resolutionDeadline].
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
  val perJudgeComissionPercentage = numericalParams(3)
  val resolutionDeadline = numericalParams(4)

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

  // ### Acción 1: Incluir Participación Omitida (Versión Corregida y Mejorada)
  val action1_includeOmittedParticipation = {
    // Verificaciones iniciales de la estructura de la transacción
    if (isBeforeResolutionDeadline && INPUTS.size > 1 && OUTPUTS.size > 1) {
      
      val omittedWinnerBoxes = CONTEXT.dataInputs.filter({ 
              (box: Box) => 
                blake2b256(box.propositionBytes) == PARTICIPATION_SCRIPT_HASH && 
                box.R6[Coll[Byte]].get == gameNftId &&
                box.R5[Coll[Byte]].get != winnerCandidateCommitment
            })
      
      if (omittedWinnerBoxes.size == 1) {

        val omittedWinnerBox = omittedWinnerBoxes(0)
        val recreatedGameBox = OUTPUTS(0)

        // Se verifica que la caja de participación enviada sea válida para este juego
        val omittedBoxIsValid = blake2b256(omittedWinnerBox.propositionBytes) == PARTICIPATION_SCRIPT_HASH &&
                                omittedWinnerBox.R6[Coll[Byte]].get == gameNftId &&
                                omittedWinnerBox.creationInfo._1 < deadline &&
                                omittedWinnerBox.value >= participationFee &&
                                omittedWinnerBox.R9[Coll[Long]].get.size <= MAX_SCORE_LIST

        if (omittedBoxIsValid) {
          // Se calcula el puntaje de la nueva participación revelando el secreto
          val newScore = omittedWinnerBox.R9[Coll[Long]].get.fold((-1L, false), { (acc: (Long, Boolean), score: Long) =>
            if (acc._2) { acc } else {
              val testCommitment = blake2b256(omittedWinnerBox.R7[Coll[Byte]].get ++ longToByteArray(score) ++ omittedWinnerBox.R8[Coll[Byte]].get ++ revealedS)
              if (testCommitment == omittedWinnerBox.R5[Coll[Byte]].get) { (score, true) } else { acc }
            }
          })._1

          // Solo continuamos si el puntaje se pudo validar (es decir, no es -1)
          val newScoreIsValid = newScore != -1L

          if (newScoreIsValid) {
            
            val newWinnerCandidate = if (winnerCandidateCommitment == Coll[Byte]()) {
              // CASO 1: No hay un candidato a ganador actual.
              // La caja presentada se convierte en el nuevo candidato. No se necesita dataInput.
              omittedWinnerBox.R5[Coll[Byte]].get
            } else {
              // CASO 2: Ya existe un candidato a ganador.
              // Se busca la caja del candidato actual en los dataInputs.
              val currentCandidateBoxes = CONTEXT.dataInputs.filter({
                (b:Box) => 
                  blake2b256(b.propositionBytes) == PARTICIPATION_SCRIPT_HASH && 
                  b.R5[Coll[Byte]].get == winnerCandidateCommitment &&
                  b.R6[Coll[Byte]].get == gameNftId
              })
              
              if (currentCandidateBoxes.size == 1) {
                val currentCandidateBox = currentCandidateBoxes(0)
                
                // Se calcula el puntaje del candidato actual de forma segura
                val currentScore = currentCandidateBox.R9[Coll[Long]].get.fold((-1L, false), { (acc: (Long, Boolean), score: Long) =>
                  if (acc._2) { acc } else {
                    val testCommitment = blake2b256(currentCandidateBox.R7[Coll[Byte]].get ++ longToByteArray(score) ++ currentCandidateBox.R8[Coll[Byte]].get ++ revealedS)
                    if (testCommitment == currentCandidateBox.R5[Coll[Byte]].get) { (score, true) } else { acc }
                  }
                })._1

                // Se determina el nuevo ganador comparando puntajes y alturas de bloque
                if (newScore > currentScore || (newScore == currentScore && omittedWinnerBox.creationInfo._1 < currentCandidateBox.creationInfo._1)) {
                  omittedWinnerBox.R5[Coll[Byte]].get // El nuevo es mejor
                } else {
                  Coll[Byte]() // El actual sigue siendo el mejor
                }
              } else {
                // Si hay un compromiso pero no se provee la caja en dataInputs (o hay más de una), la transacción es inválida.
                Coll[Byte]()
              }
            }

            if (newWinnerCandidate != Coll[Byte]() && newWinnerCandidate != winnerCandidateCommitment) {

              // Verificación de la recreación de la caja del juego
              val gameBoxIsRecreatedCorrectly = {
                recreatedGameBox.propositionBytes == SELF.propositionBytes &&
                recreatedGameBox.R4[Int].get == gameState &&
                recreatedGameBox.tokens.size == 1 &&
                recreatedGameBox.tokens(0)._1 == gameNftId &&
                recreatedGameBox.R5[(Coll[Byte], Coll[Byte])].get == (revealedS, newWinnerCandidate) &&  // Se actualiza el candidato
                recreatedGameBox.R6[Coll[Coll[Byte]]].get == participatingJudges &&
                recreatedGameBox.R7[Coll[Long]].get(0) == deadline &&
                recreatedGameBox.R7[Coll[Long]].get(1) == creatorStake &&
                recreatedGameBox.R7[Coll[Long]].get(2) == participationFee &&
                recreatedGameBox.R7[Coll[Long]].get(3) == perJudgeComissionPercentage &&
                recreatedGameBox.R7[Coll[Long]].get(4) == resolutionDeadline &&
                recreatedGameBox.R8[(Coll[Byte], Long)].get._2 == commissionPercentage &&
                recreatedGameBox.R9[(Coll[Byte], Coll[Byte])].get == SELF.R9[(Coll[Byte], Coll[Byte])].get
              }
              
              gameBoxIsRecreatedCorrectly && newScoreIsValid
              
            } else { false }
          } else { false }
        } else { false }
      } else { false }
    } else { false }
  }

  // ### Acción 2: Invalidación por Jueces
  val action2_judgesInvalidate = {
    if (isBeforeResolutionDeadline && CONTEXT.dataInputs.size > 0) {
      
      val judgeVotes = CONTEXT.dataInputs.filter({
        (b:Box) => 
          blake2b256(b.propositionBytes) == REPUTATION_PROOF_SCRIPT_HASH &&
          box.tokens.size > 0 &&
          box.R4[Coll[Byte]].get == PARTICIPATION_TYPE_ID &&
          box.R5[Coll[Byte]].get == winnerCandidateCommitment &&
          box.R6[Boolean].get && // Is locked
          box.R8[Boolean].get == false && // Negative vote, invalidates winner candidate
          participatingJudges.exists({(tokenId: Coll[Byte]) => tokenId == box.tokens(0)._1})  // Is nominated
      })

      // Reputation proof does not show repeated boxes (of the same R4-R5 pair), so this point must be ensured.
      val allVotesAreUnique = judgeVotes.map({(box: Box) => box.tokens(0)._1}).indices.forall { (i: Int) =>
            !(judgeVoteTokens.slice(i + 1, judgeVoteTokens.size).exists({ (otherToken: Coll[Byte]) =>
                otherToken == judgeVoteTokens(i)
            }))
        }

      val hasRequiredVotes = {
        val requiredVotes =
          if (participatingJudges.size == 0) 0
          else participatingJudges.size / 2 + 1

        judgeVotes.size >= requiredVotes
      }

      val votesAreValid = allVotesAreUnique && hasRequiredVotes

      val recreatedGameBoxes = OUTPUTS.filter({(b:Box) => b.propositionBytes == SELF.propositionBytes})
      
      if (votesAreValid && recreatedGameBoxes.size == 1) {
        val recreatedGameBox = recreatedGameBoxes(0)

        val newCandidateCommitment = recreatedGameBox.R5[(Coll[Byte], Coll[Byte])].get._2
        val winnerCandidateValid = if (newCandidateCommitment == Coll[Byte]()) { true } 
          else {
            val winnerCandidateBoxes = CONTEXT.dataInputs.filter({ 
              (box: Box) => 
                blake2b256(box.propositionBytes) == PARTICIPATION_SCRIPT_HASH && 
                box.R6[Coll[Byte]].get == gameNftId &&
                box.R5[Coll[Byte]].get == newCandidateCommitment
            })

            if (winnerCandidateBoxes.size == 1) {
              val winnerCandidateBox = winnerCandidateBoxes(0)

              val pBoxScoreList = winnerCandidateBox.R9[Coll[Long]].get
              val pBoxCommitment = winnerCandidateBox.R5[Coll[Byte]].get
              val pBoxSolverId = winnerCandidateBox.R7[Coll[Byte]].get
              val pBoxLogsHash = winnerCandidateBox.R8[Coll[Byte]].get

              val validScoreExists = pBoxScoreList.fold(false, { (scoreAcc: Boolean, score: Long) =>
                if (scoreAcc) { scoreAcc } else {
                  val testCommitment = blake2b256(pBoxSolverId ++ longToByteArray(score) ++ pBoxLogsHash ++ revealedS)
                  if (testCommitment == pBoxCommitment) { true } else { scoreAcc }
                }
              })

              val correctParticipationFee = winnerCandidateBox.value >= participationFee
              val createdBeforeDeadline = winnerCandidateBox.creationInfo._1 < deadline

              validScoreExists && correctParticipationFee && createdBeforeDeadline && pBoxScoreList.size <= MAX_SCORE_LIST
            }
            else { false }
          }
          
        val invalidatedCandidateBoxes = INPUTS.filter({(b:Box) => blake2b256(b.propositionBytes) == PARTICIPATION_SCRIPT_HASH && b.R5[Coll[Byte]].get == winnerCandidateCommitment})
        
        if (winnerCandidateValid && invalidatedCandidateBoxes.size == 1) {
          val invalidatedCandidateBox = invalidatedCandidateBoxes(0)

          val fundsReturnedToPool = recreatedGameBox.value >= SELF.value + invalidatedCandidateBox.value
          val deadlineIsExtended = recreatedGameBox.R7[Coll[Long]].get(4) >= HEIGHT + JUDGE_PERIOD
          val gameStateIsPreserved = recreatedGameBox.R4[Int].get == gameState && gameState == 1
          
          fundsReturnedToPool && deadlineIsExtended && gameStateIsPreserved
        } else { false }
      } else { false }
    } else { false }
  }

  // ### Acción 3: Finalización del Juego
  val action3_endGame = {
    // La condición principal no cambia: solo se puede finalizar después del deadline.
    if (isAfterResolutionDeadline && OUTPUTS.size > 0) {

      // Requerimos autorización explícita: si hay candidato a ganador, debe firmar el ganador (clave en participationBox.R4),
      // si NO hay candidato, debe firmar el resolver.
      val authorizedToEnd: SigmaProp = {
        if (winnerCandidateCommitment != Coll[Byte]()) {
          // Hay candidato a ganador: requerimos que la transacción esté firmada por la clave pública del ganador
          val winnerBoxes = INPUTS.filter({ (box: Box) => 
              blake2b256(box.propositionBytes) == PARTICIPATION_SCRIPT_HASH && 
              box.R5[Coll[Byte]].get == winnerCandidateCommitment 
          })
          if (winnerBoxes.size > 0) {
            val winnerPK = winnerBoxes(0).R4[Coll[Byte]].get
            val prefix = winnerPK.slice(0, 3)
            val addr_content = winnerPK.slice(3, winnerPK.size)

            val isP2PK = prefix == P2PK_ERGOTREE_PREFIX
            if (isP2PK) {
              proveDlog(decodePoint(addr_content))
            }
            else {
              sigmaProp(INPUTS.exists({ (box: Box) => box.propositionBytes == winnerPK }))
            }
          } else {
            // Si no se encuentra la caja del ganador, la autorización falla
            sigmaProp(false)
          }
        } else {
          // No hay candidato: requerimos que la transacción esté firmada por la clave del creador
          val prefix = resolverPK.slice(0, 3)
          val addr_content = resolverPK.slice(3, resolverPK.size)

          val isP2PK = prefix == P2PK_ERGOTREE_PREFIX
          if (isP2PK) {
            proveDlog(decodePoint(addr_content))
          }
          else {
            sigmaProp(INPUTS.exists({ (box: Box) => box.propositionBytes == resolverPK }))
          }
        }
      }

      // --- Valores y cálculos comunes para AMBOS CASOS (con y sin ganador) ---
      val participations = INPUTS.filter({ 
              (box: Box) => 
                blake2b256(box.propositionBytes) == PARTICIPATION_SCRIPT_HASH && 
                box.R6[Coll[Byte]].get == gameNftId
            })

      val prizePool = participations.fold(0L, { (acc: Long, pBox: Box) => acc + pBox.value })
      val judge_amount = participatingJudges.size

      // --- LÓGICA DE PAGO A JUECES Y DEV ---
      // Esta lógica ahora se aplica tanto si hay ganador como si no.
      val perJudgeComission = prizePool * perJudgeComissionPercentage / 100L
      val devCommission = prizePool * DEV_COMMISSION_PERCENTAGE / 100L

      // 1. Calcular payout final para el DEV (manejando polvo)
      val devForfeits = if (devCommission < MIN_ERG_BOX && devCommission > 0L) { devCommission } else { 0L }
      val finalDevPayout = devCommission - devForfeits
      
      // 2. Calcular payout final para los JUECES (manejando polvo)
      val totalJudgeComission = perJudgeComission * judge_amount
      val judgesForfeits = if (perJudgeComission < MIN_ERG_BOX && perJudgeComission > 0L) { totalJudgeComission } else { 0L } // Si el pago por juez es polvo, se pierde TODA la comisión.
      val finalJudgesPayout = totalJudgeComission - judgesForfeits
      
      // 3. Verificación de que el DEV recibe su pago
      val devGetsPaid = if (finalDevPayout > 0L) {
          OUTPUTS.exists({(b:Box) => b.value >= finalDevPayout && b.propositionBytes == DEV_ADDR.propBytes})
      } else { true }
      
      // 4. Verificación de que los JUECES reciben su pago
      val judgesGetsPaid = if (finalJudgesPayout > 0L) {

          // Get some of the judge boxes, take into account that can be any of them.
          val judgesScripts = CONTEXT.dataInputs
            .filter({(box: Box) =>
              blake2b256(box.propositionBytes) == REPUTATION_PROOF_SCRIPT_HASH && 
              box.tokens.size > 0 &&
              participatingJudges.exists({(tokenId: Coll[Byte]) => tokenId == box.tokens(0)._1})
            })
            .map({(box: Box) => box.R7[Coll[Byte]].get})

          // Comprobar que todos los jueces que participaron tienen una salida a su dirección P2S
          judgesScripts.forall({
              (judgeAddress: Coll[Byte]) => 
                OUTPUTS.exists({
                  (b:Box) => b.propositionBytes == judgeAddress &&
                             b.value >= perJudgeComission
                  })
            })

          // No es necesario comprobar unicidad, ni en el conjunto de scripts, ni en los outputs, ya que se asegura de que todos reciben como minimo su parte y el monto total deberá cuadrar.
      } else { true }


      // --- Manejar el caso CON y SIN ganador ---
      if (winnerCandidateCommitment != Coll[Byte]()) {
        // --- CASO 1: HAY UN GANADOR DECLARADO ---
        val winnerBoxes = participations.filter({ (box: Box) => box.R5[Coll[Byte]].get == winnerCandidateCommitment })

        if (winnerBoxes.size == 1) {
          val winnerBox = winnerBoxes(0)

          val validWinner = {
            val pBoxScoreList = winnerBox.R9[Coll[Long]].get
            val pBoxCommitment = winnerBox.R5[Coll[Byte]].get
            val pBoxSolverId = winnerBox.R7[Coll[Byte]].get
            val pBoxLogsHash = winnerBox.R8[Coll[Byte]].get

            val validScoreExists = pBoxScoreList.fold(false, { (scoreAcc: Boolean, score: Long) =>
              if (scoreAcc) { scoreAcc } else {
                val testCommitment = blake2b256(pBoxSolverId ++ longToByteArray(score) ++ pBoxLogsHash ++ revealedS)
                if (testCommitment == pBoxCommitment) { true } else { scoreAcc }
              }
            })

            val correctParticipationFee = winnerBox.value >= participationFee
            val createdBeforeDeadline = winnerBox.creationInfo._1 < deadline

            validScoreExists && correctParticipationFee && createdBeforeDeadline && pBoxScoreList.size <= MAX_SCORE_LIST
          }

          if (validWinner) {
            val winnerPK = winnerBox.R4[Coll[Byte]].get
            val resolverCommission = prizePool * commissionPercentage / 100L
            
            // El premio se calcula restando los payouts finales (que ya consideran el polvo)
            val finalWinnerPrize = prizePool - resolverCommission - finalJudgesPayout - finalDevPayout

            if (finalWinnerPrize >= MIN_ERG_BOX) {

              // Verificación de la salida del ganador
              val winnerGetsPaid = OUTPUTS.exists({ (b: Box) =>
                  b.value >= finalWinnerPrize &&
                  b.propositionBytes == winnerPK && // Usamos la clave extraída de la caja de participación
                  b.tokens.size == 1 &&
                  b.tokens(0)._1 == gameNftId
              })

              val finalResolverPayout = creatorStake + resolverCommission  // We know creator_stake > MIN_ERG_BOX.
              val resolverGetsPaid = OUTPUTS.exists({ (b:Box) => 
                  b.value >= finalResolverPayout && 
                  b.propositionBytes == resolverPK
              })
              
              authorizedToEnd && sigmaProp(winnerGetsPaid && resolverGetsPaid && devGetsPaid && judgesGetsPaid)
            } 
            else {
              // On this scenario (winner_prize < MIN_ERG_BOX) the winner price is sent to the resolver.
              val finalResolverPayout = creatorStake + resolverCommission + finalWinnerPrize
              val resolverGetsPaid = OUTPUTS.exists({ (b:Box) => 
                  b.value >= finalResolverPayout && 
                  b.propositionBytes == resolverPK
              })
              
              authorizedToEnd && sigmaProp(resolverGetsPaid && devGetsPaid && judgesGetsPaid)
            }
          } else {
            sigmaProp(false)
          }
          
        } else {
          sigmaProp(false)
        }
      } else {
        // --- CASO 2: NO HAY GANADOR DECLARADO ---

        // El resolutor reclama el stake del creador y el pozo de premios.
        val totalValue = prizePool + creatorStake
        
        // Las comisiones de dev y jueces ya se han calculado y validado fuera.
        // El resolutor se lleva todo lo demás.
        val finalResolverPayout = totalValue - finalDevPayout - finalJudgesPayout

        val resolverGetsPaid = OUTPUTS.exists({ (b: Box) =>
            b.value >= finalResolverPayout &&
            b.propositionBytes == resolverPK &&
            b.tokens.size == 1 && // El resolutor recibe el NFT
            b.tokens(0)._1 == gameNftId
        })
        
        // La condición final ya incluye las validaciones movidas fuera.
        authorizedToEnd && sigmaProp(resolverGetsPaid && devGetsPaid && judgesGetsPaid)
      }
    } else {
      sigmaProp(false)
    }
  }

  val game_in_resolution = sigmaProp(gameState == 1)
  val actions = sigmaProp(action1_includeOmittedParticipation) || sigmaProp(action2_judgesInvalidate) || action3_endGame
  game_in_resolution && actions
}
