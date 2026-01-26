{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  // Prefijo P2PK para la validación de direcciones.
  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd")
  
  // Periodo de gracia en bloques para que el jugador reclame si el juego se atasca.
  val GRACE_PERIOD = `+GRACE_PERIOD+`L // Aprox. 24 horas

  // =================================================================
  // === DEFINICIONES DE REGISTROS (PARTICIPACIÓN ENVIADA)
  // =================================================================

  // R4: Coll[Byte] - playerPK: Script de gasto del jugador
  // R5: Coll[Byte] - commitmentC: Commitment criptográfico con la puntuación verdadera.
  // R6: Coll[Byte] - gameNftId: ID del NFT del juego al que pertenece esta participación.
  // R7: Coll[Byte] - solverId: ID del solver del jugador.
  // R8: Coll[Byte] - hashLogs: Hash de los logs del juego del jugador.
  // R9: Coll[Long] - scoreList: Lista de puntuaciones, una de las cuales es la verdadera. (max 10 según esté definido en el contrato principal)
  
  // =================================================================
  // === EXTRACCIÓN DE VALORES
  // =================================================================

  val playerPK = SELF.R4[Coll[Byte]].get
  val gameNftIdInSelf = SELF.R6[Coll[Byte]].get



  // =================================================================
  // === ACCIONES DE GASTO
  // =================================================================

  // ### Acción 1: Reembolso por Cancelación de Juego
  val spentInValidGameCancellation = {
    if (CONTEXT.dataInputs.size > 0) {
      val gameBoxInDataArr = CONTEXT.dataInputs.filter({(b:Box) => b.tokens.size >= 1 && b.tokens(0)._1 == gameNftIdInSelf})

      if (gameBoxInDataArr.size != 1) { sigmaProp(false) } 
      else {
        val gameBoxInData = gameBoxInDataArr(0)
        val isCancelled = gameBoxInData.R4[Int].get == 2
        val correctGame = gameBoxInData.tokens.size > 0 &&
                          gameBoxInData.tokens(0)._1 == gameNftIdInSelf && 
                          isCancelled
        
        val signedByOwner = {
          val prefix = playerPK.slice(0, 3)
          val pubKey = playerPK.slice(3, playerPK.size)

          (sigmaProp(prefix == P2PK_ERGOTREE_PREFIX) && proveDlog(decodePoint(pubKey))) || sigmaProp(INPUTS.exists({ (box: Box) => box.propositionBytes == playerPK }))
        }

        sigmaProp(correctGame) && signedByOwner
      }
    }
    else { sigmaProp(false) }
  }

  // ### Acción 2: Reclamo por Período de Gracia
  val playerReclaimsAfterGracePeriod = {
    if (CONTEXT.dataInputs.size > 0) {
      val gameBoxInDataArr = CONTEXT.dataInputs.filter({(b:Box) => b.tokens.size >= 1 && b.tokens(0)._1 == gameNftIdInSelf})

      if (gameBoxInDataArr.size == 1) {
        val gameBoxInData = gameBoxInDataArr(0)
        val isActive = gameBoxInData.R4[Int].get == 0
        
        if (isActive) {
          val gameDeadline = gameBoxInData.R8[Coll[Long]].get(2)
          val gracePeriodIsOver = HEIGHT >= gameDeadline + GRACE_PERIOD

          val signedByOwner = {
            val prefix = playerPK.slice(0, 3)
            val pubKey = playerPK.slice(3, playerPK.size)

            (sigmaProp(prefix == P2PK_ERGOTREE_PREFIX) && proveDlog(decodePoint(pubKey))) || sigmaProp(INPUTS.exists({ (box: Box) => box.propositionBytes == playerPK }))
          }

          sigmaProp(gracePeriodIsOver) && signedByOwner
        } else {
          sigmaProp(false)
        }
      } else {
        sigmaProp(false)
      }
    } else {
      sigmaProp(false)
    }
  }

  // --- ACCIÓN 3: Gasto en la finalización normal del juego (EndGame) ---
  val isValidEndGame = {
    val mainGameBoxes = INPUTS.filter({(b:Box) => b.tokens.size >= 1 && b.tokens(0)._1 == gameNftIdInSelf})

    if (mainGameBoxes.size == 1) {
      val mainGameBox = mainGameBoxes(0)
      val isResolved = mainGameBox.R4[Int].get == 1
      val resolutionDeadline = mainGameBox.R8[Coll[Long]].get(7)

      val resolutionPeriodIsOver = HEIGHT >= resolutionDeadline
      resolutionPeriodIsOver && isResolved
    } 
    else { false }
  }

  // --- ACCIÓN 4: Gasto cuando esta participación es invalidada por los jueces ---
  val isInvalidatedByJudges = {
    val mainGameBoxes = INPUTS.filter({(b:Box) => b.tokens.size >= 1 && b.tokens(0)._1 == gameNftIdInSelf})

    if (mainGameBoxes.size == 1) {
      val mainGameBox = mainGameBoxes(0)
      val isResolved = mainGameBox.R4[Int].get == 1
      val resolutionDeadline = mainGameBox.R8[Coll[Long]].get(7)

      val isBeforeDeadline = HEIGHT < resolutionDeadline
      val winnerCandidateCommitment = mainGameBox.R6[(Coll[Byte], Coll[Byte])].get._2
      val isTheInvalidatedCandidate = SELF.R5[Coll[Byte]].get == winnerCandidateCommitment
      val recreatedGameBoxes = OUTPUTS.filter({(b:Box) => b.propositionBytes == mainGameBox.propositionBytes})
      
      isBeforeDeadline && isTheInvalidatedCandidate && recreatedGameBoxes.size == 1 && isResolved
    }
    else { false }
  }

  // --- ACCIÓN 5: Unir en Lote (Batching) ---
  val spentInBatch = {
    val gameBoxInDataArr = CONTEXT.dataInputs.filter({(b:Box) => b.tokens.size >= 1 && b.tokens(0)._1 == gameNftIdInSelf})
    
    if (gameBoxInDataArr.size == 1) {
        val gameBox = gameBoxInDataArr(0)
        val isResolved = gameBox.R4[Int].get == 1
        
        if (isResolved) {
            val r6 = gameBox.R6[(Coll[Byte], Coll[Byte])].get
            val winnerCandidateCommitment = r6._2
            val gameProvenance = gameBox.R9[Coll[Coll[Byte]]].get
            val resolverPK = gameProvenance(2)
            val participationTokenId = gameProvenance(1)
            
            val targetBoxes = OUTPUTS.filter({(b:Box) => 
                // Identificamos el lote por su R6 y porque NO es el script de participación individual
                b.propositionBytes != SELF.propositionBytes && 
                b.R6[Coll[Byte]].isDefined && b.R6[Coll[Byte]].get == gameNftIdInSelf
            })

            if (targetBoxes.size == 1) {
                val totalInputValue = INPUTS.filter({ (box: Box) =>
                    val isP = box.propositionBytes == SELF.propositionBytes
                    val isB = box.propositionBytes != SELF.propositionBytes && 
                             box.R6[Coll[Byte]].isDefined && box.R6[Coll[Byte]].get == gameNftIdInSelf
                    
                    if (isP || isB) {
                        val r6Opt = box.R6[Coll[Byte]]
                        if (r6Opt.isDefined) r6Opt.get == gameNftIdInSelf else false
                    } else { false }
                }).fold(0L, { (acc: Long, box: Box) =>
                    val boxValue = {
                        val t = box.tokens.filter { (token: (Coll[Byte], Long)) => token._1 == participationTokenId }
                        if (t.size > 0) t(0)._2 else 0L
                    }
                    acc + boxValue
                })
                
                val targetBox = targetBoxes(0)
                val outputValue = {
                    val t = targetBox.tokens.filter { (token: (Coll[Byte], Long)) => token._1 == participationTokenId }
                    if (t.size > 0) t(0)._2 else 0L
                }
                
                val fundsTransferred = outputValue >= totalInputValue
                
                val resolverAuth = {
                    val prefix = resolverPK.slice(0, 3)
                    val pubKey = resolverPK.slice(3, resolverPK.size)
                    if (prefix == P2PK_ERGOTREE_PREFIX) proveDlog(decodePoint(pubKey))
                    else sigmaProp(INPUTS.exists({(b:Box) => b.propositionBytes == resolverPK}))
                }
                
                val winnerAuth = {
                    if (winnerCandidateCommitment.size > 0) {
                        val winnerPK = if (SELF.R5[Coll[Byte]].get == winnerCandidateCommitment) {
                            playerPK
                        } else {
                            val winnerBoxes = CONTEXT.dataInputs.filter({(b:Box) => 
                                val r5Opt = b.R5[Coll[Byte]]
                                if (r5Opt.isDefined) r5Opt.get == winnerCandidateCommitment else false
                            })
                            if (winnerBoxes.size > 0) {
                                 val winnerBox = winnerBoxes(0)
                                 val seed = gameBox.R5[Coll[Byte]].get
                                 val revealedS = r6._1
                                 val scoreList = winnerBox.R9[Coll[Long]].get
                                 val solverId = winnerBox.R7[Coll[Byte]].get
                                 val logsHash = winnerBox.R8[Coll[Byte]].get
                                 val ergotree = winnerBox.R4[Coll[Byte]].get
                                 val commitment = winnerBox.R5[Coll[Byte]].get
                                 
                                 val isValidWinner = scoreList.fold(false, { (acc: Boolean, score: Long) =>
                                   if (acc) { acc } else {
                                     val testCommitment = blake2b256(solverId ++ seed ++ longToByteArray(score) ++ logsHash ++ ergotree ++ revealedS)
                                     testCommitment == commitment
                                   }
                                 })
                                 
                                 if (isValidWinner) winnerBox.R4[Coll[Byte]].get else Coll[Byte]()
                             } else Coll[Byte]()
                        }
                        
                        if (winnerPK.size > 0) {
                            val prefix = winnerPK.slice(0, 3)
                            val pubKey = winnerPK.slice(3, winnerPK.size)
                            if (prefix == P2PK_ERGOTREE_PREFIX) proveDlog(decodePoint(pubKey))
                            else sigmaProp(INPUTS.exists({(b:Box) => b.propositionBytes == winnerPK}))
                        } else sigmaProp(false)
                    } else sigmaProp(false)
                }
                
                sigmaProp(fundsTransferred) && (resolverAuth || winnerAuth)
            } else sigmaProp(false)
        } else sigmaProp(false)
    } else sigmaProp(false)
  }

  spentInValidGameCancellation || 
  playerReclaimsAfterGracePeriod || 
  sigmaProp(isValidEndGame) || 
  sigmaProp(isInvalidatedByJudges) ||
  spentInBatch
}