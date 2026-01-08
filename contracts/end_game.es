{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  val END_GAME_AUTH_GRACE_PERIOD = `+END_GAME_AUTH_GRACE_PERIOD+`L
  val DEV_SCRIPT = fromBase16("`+DEV_SCRIPT+`")
  val DEV_COMMISSION_PERCENTAGE = `+DEV_COMMISSION_PERCENTAGE+`L
  val JUDGES_PAID_ERGOTREE = fromBase16("`+JUDGES_PAID_ERGOTREE+`")

  val MAX_SCORE_LIST = `+MAX_SCORE_LIST+`L

  val PARTICIPATION_SCRIPT_HASH = fromBase16("`+PARTICIPATION_SCRIPT_HASH+`") 
  val PARTICIPATION_BATCH_SCRIPT_HASH = fromBase16("`+PARTICIPATION_BATCH_SCRIPT_HASH+`")
  
  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd")


  // =================================================================
  // === DEFINICIONES DE REGISTROS
  // =================================================================

  // R4: Integer                    - Game state (0: Active, 1: Resolved, 2: Cancelled).
  // R5: Coll[Byte]                 - Seed
  // R6: (Coll[Byte], Coll[Byte])   - (revealedSecretS, winnerCandidateCommitment): El secreto y el candidato a ganador.
  // R7: Coll[Coll[Byte]]           - participatingJudges: Lista de IDs de tokens de reputación de los jueces.
  // R8: Coll[Long]                 - numericalParameters: [deadline, creatorStake, participationFee, perJudgeComissionPercentage, creatorComissionPercentage, resolutionDeadline]
  // R9: Coll[Coll[Byte]]           - gameProvenance: [gameDetailsJsonHex, ParticipationTokenID, resolverErgoTree]

  // =================================================================
  // === EXTRACCIÓN DE VALORES
  // =================================================================

  val gameState = SELF.R4[Int].get
  val seed = SELF.R5[Coll[Byte]].get

  val r6Tuple = SELF.R6[(Coll[Byte], Coll[Byte])].get
  val revealedS = r6Tuple._1
  val winnerCandidateCommitment = r6Tuple._2
  
  val participatingJudges = SELF.R7[Coll[Coll[Byte]]].get
  val numericalParams = SELF.R8[Coll[Long]].get
  val deadline = numericalParams(0)
  val creatorStake = numericalParams(1)
  val participationFee = numericalParams(2)
  val perJudgeComissionPercentage = numericalParams(3)
  val creatorComissionPercentage = numericalParams(4)
  val resolutionDeadline = numericalParams(5)

  val gameProvenance = SELF.R9[Coll[Coll[Byte]]].get
  // gameProvenance(0) = gameDetailsJsonHex
  val participationTokenId = gameProvenance(1)
  val resolverPK = gameProvenance(2)
  
  val gameNft = SELF.tokens(0)
  val gameNftId = gameNft._1

  val box_value = { (box: Box) =>
    if (participationTokenId.size == 0) {
      box.value
    } else {
      box.tokens.filter { (token: (Coll[Byte], Long)) => token._1 == participationTokenId }.fold(0L, { (acc: Long, token: (Coll[Byte], Long)) => acc + token._2 })
    }
  }

  val getScoreFromBox = { (box: Box) =>
    val scoreList = box.R9[Coll[Long]].get
    val solverId = box.R7[Coll[Byte]].get
    val logsHash = box.R8[Coll[Byte]].get
    val ergotree = box.R4[Coll[Byte]].get
    val commitment = box.R5[Coll[Byte]].get
    
    scoreList.fold((-1L, false), { (acc: (Long, Boolean), score: Long) =>
      if (acc._2) { acc } else {
        val testCommitment = blake2b256(solverId ++ seed ++ longToByteArray(score) ++ logsHash ++ ergotree ++ revealedS)
        if (testCommitment == commitment) { (score, true) } else { acc }
      }
    })
  }



  // =================================================================
  // === ACCIONES DE GASTO
  // =================================================================

  // ### Finalización del Juego
  val action = {

    // Requerimos autorización explícita: si hay candidato a ganador, debe firmar el ganador (clave en participationBox.R4),
    // si NO hay candidato, debe firmar el resolver.
    val authorizedToEnd: SigmaProp = {

    val resolverAuth: SigmaProp = {
        val isP2PK = if (resolverPK.size >= 3) {
            val prefix = resolverPK.slice(0, 3)
            prefix == P2PK_ERGOTREE_PREFIX
        } else {
            false
        }

        if (isP2PK) {
            val addr_content = resolverPK.slice(3, resolverPK.size)
            proveDlog(decodePoint(addr_content))
        }
        else {
            sigmaProp(INPUTS.exists({ (box: Box) => box.propositionBytes == resolverPK }))
        }
    }
    
    val winnerAuth: SigmaProp = {
        val winnerBoxes = INPUTS.filter({ (box: Box) => 
            blake2b256(box.propositionBytes) == PARTICIPATION_SCRIPT_HASH && 
            box.R5[Coll[Byte]].get == winnerCandidateCommitment 
        })
        if (winnerBoxes.size > 0) {
        val winnerPK = winnerBoxes(0).R4[Coll[Byte]].get
        
        val isP2PK = if (winnerPK.size >= 3) {
            val prefix = winnerPK.slice(0, 3)
            prefix == P2PK_ERGOTREE_PREFIX
        } else {
            false
        }

        if (isP2PK) {
            val addr_content = winnerPK.slice(3, winnerPK.size)
            proveDlog(decodePoint(addr_content))
        }
        else {
            sigmaProp(INPUTS.exists({ (box: Box) => box.propositionBytes == winnerPK }))
        }
        } else {
        // Si no se encuentra la caja del ganador, la autorización falla
        sigmaProp(false)
        }
    }

    if (winnerCandidateCommitment != Coll[Byte]()) {
        // winnerAuth || resolverAuth  // Raises "Malformed transaction: Scripts of all transaction inputs should pass verification. b32bbdd8dd9b5d92894439d0a60c1ba6201d727b9dbd5f419786f510046ad02d: #0 => Success((false,1712))"
        val isAfterResolutionDeadlineWithGracePeriod = HEIGHT >= resolutionDeadline + END_GAME_AUTH_GRACE_PERIOD
        if (isAfterResolutionDeadlineWithGracePeriod) {
        resolverAuth
        } else {
        winnerAuth
        }
    } else {
        resolverAuth
    }
    }

    // --- Valores y cálculos comunes para AMBOS CASOS (con y sin ganador) ---
    val participations = INPUTS.filter({ 
            (box: Box) => 
            (blake2b256(box.propositionBytes) == PARTICIPATION_SCRIPT_HASH || 
                blake2b256(box.propositionBytes) == PARTICIPATION_BATCH_SCRIPT_HASH) &&
            box.R6[Coll[Byte]].get == gameNftId
        })

    val prizePool = {
    val participationsAmount = participations.fold(0L, { (acc: Long, pBox: Box) => acc + box_value(pBox) })
    val contractPrize = box_value(SELF) - creatorStake
    participationsAmount + contractPrize
    }
    val judge_amount = participatingJudges.size

    // --- LÓGICA DE PAGO A JUECES Y DEV ---
    // Esta lógica ahora se aplica tanto si hay ganador como si no.
    
    // 1. Calcular payout para DEV
    val devCommission = prizePool * DEV_COMMISSION_PERCENTAGE / 1000000L
    
    // 2. Calcular payout para los JUECES
    val perJudgeComission = prizePool * perJudgeComissionPercentage / 1000000L
    val totalJudgeComission = perJudgeComission * judge_amount
    
    // 3. Verificación de que el DEV recibe su pago
    val devGetsPaid = if (devCommission > 0L) {
        val inputVal = INPUTS.filter({(b:Box) => b.propositionBytes == DEV_SCRIPT}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
        val outputVal = OUTPUTS.filter({(b:Box) => b.propositionBytes == DEV_SCRIPT}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
        val addedValue = outputVal - inputVal
        addedValue >= devCommission
    } else { true }
    
    // 4. Verificación de que los JUECES reciben su pago (enviando a judges_paid.es)
    val judgesGetsPaid = if (totalJudgeComission > 0L) {
        val judgesPaidBox = OUTPUTS.filter({(b:Box) => b.propositionBytes == JUDGES_PAID_ERGOTREE})
        if (judgesPaidBox.size == 1) {
            val box = judgesPaidBox(0)
            val correctValue = box_value(box) >= totalJudgeComission
            val correctR4 = box.R4[Coll[Coll[Byte]]].get == participatingJudges
            val correctR5 = box.R5[Coll[Byte]].get == participationTokenId
            correctValue && correctR4 && correctR5
        } else {
            false
        }
    } else { true }

    // --- Manejar el caso CON y SIN ganador ---
    if (winnerCandidateCommitment != Coll[Byte]()) {
    // --- CASO 1: HAY UN GANADOR DECLARADO ---
    val winnerBoxes = participations.filter({ (box: Box) => box.R5[Coll[Byte]].get == winnerCandidateCommitment })

    if (winnerBoxes.size == 1) {
        val winnerBox = winnerBoxes(0)
        val pBoxScoreList = winnerBox.R9[Coll[Long]].get

        val validWinner = {
        val validScoreExists = getScoreFromBox(winnerBox)._2

        val correctParticipationFee = box_value(winnerBox) >= participationFee
        val createdBeforeDeadline = winnerBox.creationInfo._1 < deadline

        validScoreExists && correctParticipationFee && createdBeforeDeadline && pBoxScoreList.size <= MAX_SCORE_LIST
        }

        if (validWinner) {
        val winnerPK = winnerBox.R4[Coll[Byte]].get
        val resolverCommission = prizePool * creatorComissionPercentage / 1000000L
        
        // El premio se calcula restando los payouts finales (que ya consideran el polvo)
        val tentativeWinnerPrize = prizePool - resolverCommission - totalJudgeComission - devCommission

        // Lógica para asegurar que el ganador no reciba menos que la tarifa de participación (evitar pérdida neta)
        // Si el premio tentativo es menor, eliminamos todas las comisiones (dev, jueces, resolver) y el ganador recibe el prizePool completo
        val adjustedWinnerPrize = if (tentativeWinnerPrize < participationFee) prizePool else tentativeWinnerPrize
        val adjustedResolverCommission = if (tentativeWinnerPrize < participationFee) 0L else resolverCommission
        val adjustedDevPayout = if (tentativeWinnerPrize < participationFee) 0L else devCommission
        val adjustedJudgesPayout = if (tentativeWinnerPrize < participationFee) 0L else totalJudgeComission
        val adjustedPerJudge = if (tentativeWinnerPrize < participationFee) 0L else perJudgeComission

        /*
        * If the tentative winner prize is less than the participation fee, all commissions (resolver, dev, judges) are set to zero,
        * and the winner receives the entire prize pool. This ensures the winner never loses money (i.e., receives at least their participation fee back)
        * but may result in the winner receiving more than their intended percentage in low-participation or high-commission scenarios.
        */

        // Ajustar las verificaciones de pago para usar los valores ajustados
        val adjustedDevGetsPaid = if (adjustedDevPayout == 0L) true else devGetsPaid

        val adjustedJudgesGetsPaid = if (adjustedJudgesPayout == 0L) {
            true
        } else {
            judgesGetsPaid
        }

        // Verificación de la salida del ganador
        val winnerGetsPaid = {
            val txFee = 0L
            val amount = adjustedWinnerPrize - txFee
            val inputVal = INPUTS.filter({(b:Box) => b.propositionBytes == winnerPK}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
            val outputVal = OUTPUTS.filter({(b:Box) => b.propositionBytes == winnerPK}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
            val addedValue = outputVal - inputVal
            val hasNFT = OUTPUTS.exists({ (b: Box) =>
                b.propositionBytes == winnerPK &&
                b.tokens.size > 0 &&
                b.tokens(0)._1 == gameNftId
            })
            addedValue >= amount && hasNFT
        }

        val finalResolverPayout = creatorStake + adjustedResolverCommission
        val resolverGetsPaid = {
            val inputVal = INPUTS.filter({(b:Box) => b.propositionBytes == resolverPK}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
            val outputVal = OUTPUTS.filter({(b:Box) => b.propositionBytes == resolverPK}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
            val addedValue = outputVal - inputVal
            addedValue >= finalResolverPayout
        }
        
        authorizedToEnd && sigmaProp(winnerGetsPaid && resolverGetsPaid && adjustedDevGetsPaid && adjustedJudgesGetsPaid)
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
    val finalResolverPayout = totalValue - devCommission - totalJudgeComission

    val resolverGetsPaid = {
        val txFee = 0L
        val amount = finalResolverPayout - txFee
        val inputVal = INPUTS.filter({(b:Box) => b.propositionBytes == resolverPK}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
        val outputVal = OUTPUTS.filter({(b:Box) => b.propositionBytes == resolverPK}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
        val addedValue = outputVal - inputVal
        val hasNFT = OUTPUTS.exists({ (b: Box) =>
            b.propositionBytes == resolverPK &&
            b.tokens.size > 0 &&
            b.tokens(0)._1 == gameNftId
        })
        addedValue >= amount && hasNFT
    }
    
    // La condición final ya incluye las validaciones movidas fuera.
    authorizedToEnd && sigmaProp(resolverGetsPaid && devGetsPaid && judgesGetsPaid)
    }

  }

  val game_in_resolution = sigmaProp(gameState == 1)
  game_in_resolution && action
}