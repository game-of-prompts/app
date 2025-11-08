{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  // Hashes de los scripts a los que esta caja puede transicionar.
  // Estos valores deben ser reemplazados por los hashes reales de los scripts compilados.
  val GAME_RESOLUTION_SCRIPT_HASH = fromBase16("`+GAME_RESOLUTION_SCRIPT_HASH+`") 
  val GAME_CANCELLATION_SCRIPT_HASH = fromBase16("`+GAME_CANCELLATION_SCRIPT_HASH+`")
  
  // Hash del script de las participaciones.
  val PARTICIPATION_SCRIPT_HASH = fromBase16("`+PARTICIPATION_SCRIPT_HASH+`")

  val REPUTATION_PROOF_SCRIPT_HASH = fromBase16("`+REPUTATION_PROOF_SCRIPT_HASH+`")
  val ACCEPT_GAME_INVITATION_TYPE_ID = fromBase16("`+ACCEPT_GAME_INVITATION_TYPE_ID+`");

  // Constantes para la acción de cancelación.
  val STAKE_DENOMINATOR    = `+STAKE_DENOMINATOR+`L
  val COOLDOWN_IN_BLOCKS   = `+COOLDOWN_IN_BLOCKS+`L
  val JUDGE_PERIOD         = `+JUDGE_PERIOD+`L
  val MAX_SCORE_LIST       = `+MAX_SCORE_LIST+`L
  val OPEN_CEREMONY_BLOCKS = `+OPEN_CEREMONY_BLOCKS+`L

  val MIN_BOX_VALUE       = 1000000L

  // =================================================================
  // === DEFINICIONES DE REGISTROS (ESTADO ACTIVO)
  // =================================================================

  // R4: Integer            - Game state (0: Active, 1: Resolved, 2: Cancelled).
  // R5: (Coll[Byte], Long) - seed: (Seed, Ceremony deadline).
  // R6: Coll[Byte]         - secretHash: Hash del secreto 'S' (blake2b256(S)).
  // R7: Coll[Coll[Byte]]   - invitedJudgesReputationProofs
  // R8: Coll[Long]         - numericalParameters: [deadline, creatorStake, participationFee, perJudgeComissionPercentage, creatorComissionPercentage].
  // R9: Coll[Coll[Byte]]   - gameProvenance: [gameDetailsJsonHex, ParticipationTokenID]


  // Note: The game seed that must be used to reproduce the random scenario for all participants is first added by the creator, and the action3_open_ceremony allows anyone to add entropy to it making updated_seed = blake2b256(old_seed ++ INPUTS(0).id).

  // =================================================================
  // === EXTRACCIÓN DE VALORES
  // =================================================================

  val gameState = SELF.R4[Int].get
  
  // R5: (Seed, Ceremony deadline)
  val seedInfo = SELF.R5[(Coll[Byte], Long)].get
  val gameSeed = seedInfo._1
  val ceremonyDeadline = seedInfo._2

  // R6: Hash del secreto 'S'
  val secretHash = SELF.R6[Coll[Byte]].get
  
  // R7: Jueces invitados
  val invitedJudges = SELF.R7[Coll[Coll[Byte]]].get

  // R8: [deadline, creatorStake, participationFee, perJudgeComissionPercentage, creatorComissionPercentage]
  val numericalParams = SELF.R8[Coll[Long]].get
  val deadline = numericalParams(0)
  val creatorStake = numericalParams(1)
  val participationFee = numericalParams(2)
  val perJudgeComissionPercentage = numericalParams(3)
  val creatorComissionPercentage = numericalParams(4)

  // R9: [gameDetailsJsonHex, ParticipationTokenID]
  val gameProvenance = SELF.R9[Coll[Coll[Byte]]].get
  val gameDetailsJsonHex = gameProvenance(0)
  val participationTokenId = gameProvenance(1)
  
  val gameNft = SELF.tokens(0)
  val gameNftId = gameNft._1

  val isAfterDeadline = HEIGHT >= deadline
  val isBeforeDeadline = HEIGHT < deadline

  // =================================================================
  // === ACCIÓN 1: TRANSICIÓN A RESOLUCIÓN
  // =================================================================
  // Se ejecuta después de la fecha límite para iniciar la fase de resolución.
  // Consume esta caja y todas las participaciones, y lee las pruebas de los jueces como dataInputs.

  val action1_transitionToResolution = {
    if (isAfterDeadline) {
      val resolutionBoxes = OUTPUTS.filter({ (box: Box) => 
        blake2b256(box.propositionBytes) == GAME_RESOLUTION_SCRIPT_HASH 
      })
      
      if (resolutionBoxes.size == 1) {
        val resolutionBox = resolutionBoxes(0)
        
        // La estructura de la nueva caja de resolución es (Coll[Byte], Coll[Byte])
        val r6Tuple = resolutionBox.R6[(Coll[Byte], Coll[Byte])].get
        val revealedS = r6Tuple._1
        val winnerCandidateCommitment = r6Tuple._2

        val sIsCorrectlyRevealed = blake2b256(revealedS) == secretHash
        val transitionsToResolutionScript = blake2b256(resolutionBox.propositionBytes) == GAME_RESOLUTION_SCRIPT_HASH
        
        val winnerCandidateValid = if (winnerCandidateCommitment == Coll[Byte]()) { true } 
          else {
            val winnerCandidateBoxes = CONTEXT.dataInputs.filter({ 
              (box: Box) => 
                blake2b256(box.propositionBytes) == PARTICIPATION_SCRIPT_HASH && 
                box.R6[Coll[Byte]].get == gameNftId &&
                box.R5[Coll[Byte]].get == winnerCandidateCommitment
            })

            if (winnerCandidateBoxes.size == 1) {
              val winnerCandidateBox = winnerCandidateBoxes(0)

              val pBoxErgotree = winnerCandidateBox.R4[Coll[Byte]].get
              val pBoxScoreList = winnerCandidateBox.R9[Coll[Long]].get
              val pBoxCommitment = winnerCandidateBox.R5[Coll[Byte]].get
              val pBoxSolverId = winnerCandidateBox.R7[Coll[Byte]].get
              val pBoxLogsHash = winnerCandidateBox.R8[Coll[Byte]].get

              val validScoreExists = pBoxScoreList.fold(false, { (scoreAcc: Boolean, score: Long) =>
                if (scoreAcc) { scoreAcc } else {
                  val testCommitment = blake2b256(pBoxSolverId ++ gameSeed ++ longToByteArray(score) ++ pBoxLogsHash ++ pBoxErgotree ++ revealedS)
                  if (testCommitment == pBoxCommitment) { true } else { scoreAcc }
                }
              })

              val correctParticipationFee = if (participationTokenId == Coll[Byte]()) {
                  winnerCandidateBox.value >= participationFee
                } else {
                  winnerCandidateBox.tokens.exists { (pair: (Coll[Byte], Long)) => 
                      pair._1 == participationTokenId &&
                      pair._2 >= participationFee
                  }
                }
              val createdBeforeDeadline = winnerCandidateBox.creationInfo._1 < deadline

              validScoreExists && correctParticipationFee && createdBeforeDeadline && pBoxScoreList.size <= MAX_SCORE_LIST
            }
            else { false }
          }

        if (sIsCorrectlyRevealed && transitionsToResolutionScript && winnerCandidateValid) {
          
          // --- Judge validation ---          
          val judgeProofDataInputs = CONTEXT.dataInputs
            .filter({(box: Box) =>
              blake2b256(box.propositionBytes) == REPUTATION_PROOF_SCRIPT_HASH && 
              box.tokens.size > 0 &&
              box.R4[Coll[Byte]].get == ACCEPT_GAME_INVITATION_TYPE_ID &&
              box.R5[Coll[Byte]].get == gameNftId &&
              box.R6[Boolean].get && // Is locked
              box.R8[Boolean].get && // Positive vote, judge accepts the game invitation
              invitedJudges.exists({(tokenId: Coll[Byte]) => tokenId == box.tokens(0)._1})  // Is nominated
            })

          // Reputation proof does not show repeated boxes (of the same R4-R5 pair), so this point must be ensured.
          val allVotesAreUnique = {
            val judgeVoteTokens = judgeProofDataInputs.map({(box: Box) => box.tokens(0)._1})
            judgeVoteTokens.indices.forall { (i: Int) =>
                !(judgeVoteTokens.slice(i + 1, judgeVoteTokens.size).exists({ (otherToken: Coll[Byte]) =>
                    otherToken == judgeVoteTokens(i)
                }))
            }
          }

          val resolutionBoxIsValid = {
              resolutionBox.value >= creatorStake &&
              resolutionBox.tokens.filter({ (token: (Coll[Byte], Long)) => token._1 == gameNftId }).size == 1 &&
              resolutionBox.R4[Int].get == 1 && // El estado del juego pasa a "Resuelto" (1)
              resolutionBox.R5[Coll[Byte]].get == gameSeed &&
              resolutionBox.R7[Coll[Coll[Byte]]].get == invitedJudges &&
              resolutionBox.R8[Coll[Long]].get(0) == deadline &&
              resolutionBox.R8[Coll[Long]].get(1) == creatorStake &&
              resolutionBox.R8[Coll[Long]].get(2) == participationFee &&
              resolutionBox.R8[Coll[Long]].get(3) == perJudgeComissionPercentage &&
              resolutionBox.R8[Coll[Long]].get(4) >= creatorComissionPercentage &&
              resolutionBox.R8[Coll[Long]].get(5) >= HEIGHT + JUDGE_PERIOD &&
              resolutionBox.R9[Coll[Coll[Byte]]].get == gameProvenance
            }

          resolutionBoxIsValid && allVotesAreUnique
        } else { false }  // Invalid revealed secret, invalid transition script or invalid participation boxes.
      } else { false }  // There should be exactly one resolution box.
    } else { false }  // Deadline not reached.
  }

  // =================================================================
  // === ACCIÓN 2: TRANSICIÓN A CANCELACIÓN
  // =================================================================
  // Se ejecuta antes de la fecha límite si alguien revela el secreto para penalizar al creador.

  val action2_transitionToCancellation = {
    if (isBeforeDeadline && OUTPUTS.size >= 2) {
      val cancellationBox = OUTPUTS(0)
      val claimerOutput = OUTPUTS(1)

      // Calcular los valores iniciales.
      val initialStakePortionToClaim = creatorStake / STAKE_DENOMINATOR
      val initialRemainingStake = creatorStake - initialStakePortionToClaim

      // Asegurarse de que la caja de cancelación tenga al menos el valor mínimo requerido.
      val stakePortionToClaim = if (initialRemainingStake < MIN_BOX_VALUE) {
        creatorStake - MIN_BOX_VALUE
      } else {
        initialStakePortionToClaim
      }

      val remainingStake = if (initialRemainingStake < MIN_BOX_VALUE) {
        MIN_BOX_VALUE
      } else {
        initialRemainingStake
      }

      // --- 1. Validar la caja de cancelación (OUTPUTS(0)) ---
      val cancellationBoxIsValid = {
          blake2b256(cancellationBox.propositionBytes) == GAME_CANCELLATION_SCRIPT_HASH &&
          cancellationBox.value >= remainingStake &&
          cancellationBox.tokens.filter({ (token: (Coll[Byte], Long)) => token._1 == gameNftId }).size == 1 &&
          cancellationBox.R4[Int].get == 2 && // Game state is "Cancelled" (2)
          cancellationBox.R5[Long].get >= HEIGHT + COOLDOWN_IN_BLOCKS &&
          blake2b256(cancellationBox.R6[Coll[Byte]].get) == secretHash &&
          cancellationBox.R7[Long].get == remainingStake &&
          cancellationBox.R8[Long].get == deadline &&
          cancellationBox.R9[Coll[Coll[Byte]]].get == gameProvenance
      }
      
      // --- 2. Validar la salida para quien reclama (OUTPUTS(1)) ---
      val claimerOutputIsValid = claimerOutput.value >= stakePortionToClaim
      
      // El resultado final es verdadero solo si ambas cajas son válidas.
      cancellationBoxIsValid && claimerOutputIsValid

    } else { 
      false 
    }
  }

  // =================================================================
  // === ACCIÓN 3: ADD RANDOMNESS TO GAME SEED (Reproducción temprana con nueva semilla)
  // =================================================================
  //
  // Esta acción permite reproducir el contrato dentro del período inicial (hasta ceremonyDeadline)
  // desde la creación, para agregar entropía adicional al 'seed'.
  //
  // Condiciones:
  //   - Debe ocurrir antes de 'ceremonyDeadline' (definido en R5._2)
  //   - Se mantiene todo igual salvo el registro R5._1 (la semilla actualizada)
  //   - updated_seed = blake2b256(old_seed ++ INPUTS(0).id)
  //   - El script de salida debe ser idéntico (SELF mismo script)
  //   - El NFT y valores deben preservarse
  //
  val action3_add_randomness = {
    // Usa ceremonyDeadline del nuevo R5
    val ceremonyActive = HEIGHT < ceremonyDeadline

    if (ceremonyActive && OUTPUTS.size > 0) {
      // La caja de salida debe ser una copia del contrato actual, excepto R5._1
      val out = OUTPUTS.filter({ (box: Box) => 
        blake2b256(box.propositionBytes) == blake2b256(SELF.propositionBytes)
      })(0)

      // El NFT debe preservarse
      val sameNFT = out.tokens(0)._1 == gameNftId
      val sameValue = out.value >= MIN_BOX_VALUE && out.value == SELF.value
      val sameTokens = (out.tokens.size == SELF.tokens.size) &&
        (out.tokens.slice(1, out.tokens.size).zip(SELF.tokens.slice(1, SELF.tokens.size)).forall({ (pair: ((Coll[Byte], Long), (Coll[Byte], Long))) =>
          val outToken = pair._1
          val selfToken = pair._2
          outToken._1 == selfToken._1 && outToken._2 >= selfToken._2
        }))

      // Calculamos la nueva semilla (gameSeed es R5._1)
      val updated_seed = blake2b256(gameSeed ++ SELF.id)

      // Validar que R5._1 del output sea igual al updated_seed
      val outR5 = out.R5[(Coll[Byte], Long)].get
      val validUpdatedSeed = outR5._1 == updated_seed
      // Validar que R5._2 (deadline) no cambie
      val sameCeremonyDeadline = outR5._2 == ceremonyDeadline

      // Todos los demás registros deben permanecer iguales
      val sameR4 = out.R4[Int].get == gameState
      val sameR6 = out.R6[Coll[Byte]].get == secretHash
      val sameR7 = out.R7[Coll[Coll[Byte]]].get == invitedJudges
      val sameR8 = out.R8[Coll[Long]].get == numericalParams
      val sameR9 = out.R9[Coll[Coll[Byte]]].get == gameProvenance
    
      sameNFT &&
      sameValue &&
      validUpdatedSeed &&
      sameCeremonyDeadline && // Check R5._2
      sameR4 && sameR6 && sameR7 && sameR8 && sameR9 // Check R4, R6-R9
    } else {
      false
    }
  }

  val game_active = gameState == 0
  val actions = action1_transitionToResolution || action2_transitionToCancellation || action3_add_randomness
  sigmaProp(game_active && actions)
}