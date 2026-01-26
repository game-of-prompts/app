{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  // Prefijo P2PK para la validación de direcciones.
  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd")
  
  val PARTICIPATION_SCRIPT_HASH = fromBase16("`+PARTICIPATION_SCRIPT_HASH+`")

  // =================================================================
  // === EXTRACCIÓN DE VALORES
  // =================================================================

  val gameNftIdInSelf = SELF.R6[Coll[Byte]].get



  // =================================================================
  // === ACCIONES DE GASTO
  // =================================================================

  // --- ACCIÓN 1: Unir en Lote (Batching) ---
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
                b.propositionBytes == SELF.propositionBytes && 
                b.R6[Coll[Byte]].isDefined && b.R6[Coll[Byte]].get == gameNftIdInSelf
            })

            if (targetBoxes.size == 1) {
                val totalInputValue = INPUTS.filter({ (box: Box) =>
                    val sHash = blake2b256(box.propositionBytes)
                    val isP = sHash == PARTICIPATION_SCRIPT_HASH
                    val isB = box.propositionBytes == SELF.propositionBytes
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
                            
                            if (isValidWinner) {
                                val winnerPK = winnerBox.R4[Coll[Byte]].get
                                val prefix = winnerPK.slice(0, 3)
                                val pubKey = winnerPK.slice(3, winnerPK.size)
                                if (prefix == P2PK_ERGOTREE_PREFIX) proveDlog(decodePoint(pubKey))
                                else sigmaProp(INPUTS.exists({(b:Box) => b.propositionBytes == winnerPK}))
                            } else sigmaProp(false)
                        } else sigmaProp(false)
                    } else sigmaProp(false)
                }
                
                sigmaProp(fundsTransferred) && (resolverAuth || winnerAuth)
            } else sigmaProp(false)
        } else sigmaProp(false)
    } else sigmaProp(false)
  }

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

  spentInBatch || sigmaProp(isValidEndGame)
}
