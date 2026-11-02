{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  // Prefijo P2PK para la validación de direcciones.
  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd")

  // No participation script hash here: participation.es embeds this contract's hash, so this one can't embed
  // participation's. Inputs are summed by the game NFT id in R6 instead (see action 1).

  // The game NFT is minted with 2 units and both must stay together in the game box until end_game,
  // where one unit is given as the trophy and the other is burned. Holding a single unit (the trophy)
  // is therefore never enough to impersonate a game box.
  val GAME_NFT_AMOUNT = 2L

  // Game state of the end_game box (see game_resolution.es action4).
  val ENDING_STATE = 3

  // =================================================================
  // === EXTRACCIÓN DE VALORES
  // =================================================================

  val gameNftIdInSelf = SELF.R6[Coll[Byte]].get

  // Only a box with both units of the game NFT can be the game box (see participation.es).
  val isGameBox = { (b: Box) =>
    b.tokens.size >= 1 && b.tokens(0)._1 == gameNftIdInSelf && b.tokens(0)._2 == GAME_NFT_AMOUNT
  }


  // =================================================================
  // === ACCIONES DE GASTO
  // =================================================================

  // --- ACCIÓN 1: Unir en Lote (Batching) ---
  val spentInBatch = {
    val gameBoxInDataArr = CONTEXT.dataInputs.filter(isGameBox)
    
    if (gameBoxInDataArr.size == 1) {
        val gameBox = gameBoxInDataArr(0)
        val isResolved = gameBox.R4[Int].get == 1
        
        if (isResolved) {
            val r6 = gameBox.R6[(Coll[Byte], Coll[Byte])].get
            val winnerCandidateCommitment = r6._2
            val gameProvenance = gameBox.R9[Coll[Coll[Byte]]].get
            val resolverPK = gameProvenance(3)
            val participationTokenId = gameProvenance(1)
            
            val targetBoxes = OUTPUTS.filter({(b:Box) => 
                b.propositionBytes == SELF.propositionBytes && 
                b.R6[Coll[Byte]].isDefined && b.R6[Coll[Byte]].get == gameNftIdInSelf
            })

            if (targetBoxes.size == 1) {
                // Every input carrying this game's NFT id in R6 (participations and batches) is counted.
                // Counting any such box can only raise the amount the new batch must hold.
                val totalInputValue = INPUTS.filter({ (box: Box) =>
                    val r6Opt = box.R6[Coll[Byte]]
                    if (r6Opt.isDefined) r6Opt.get == gameNftIdInSelf else false
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
    val mainGameBoxes = INPUTS.filter(isGameBox)

    if (mainGameBoxes.size == 1) {
      val mainGameBox = mainGameBoxes(0)
      val isEnding = mainGameBox.R4[Int].get == ENDING_STATE
      val resolutionDeadline = mainGameBox.R8[Coll[Long]].get(9)

      val resolutionPeriodIsOver = HEIGHT >= resolutionDeadline
      resolutionPeriodIsOver && isEnding
    } 
    else { false }
  }

  spentInBatch || sigmaProp(isValidEndGame)
}
