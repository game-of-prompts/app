{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  // Prefijo P2PK para la validación de direcciones.
  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd")
  
  // Período de gracia en bloques para que el jugador reclame si el juego se atasca.
  val GRACE_PERIOD_IN_BLOCKS = `+GRACE_PERIOD_IN_BLOCKS+`L // Aprox. 24 horas
  val ABANDONED_FUNDS_GRACE_PERIOD = `+ABANDONED_FUNDS_GRACE_PERIOD+`L // 90 días

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
  // Permite al jugador recuperar sus fondos si el juego es cancelado (el secreto 'S' es revelado prematuramente).
  val spentInValidGameCancellation = {
    if (CONTEXT.dataInputs.size > 0) {
      val gameBoxInDataArr = CONTEXT.dataInputs.filter({(b:Box) => b.tokens.size >= 1 && b.tokens(0)._1 == gameNftIdInSelf && b.R4[Int].get == 2})  // Caja del juego game_cancelled.es como Data Input.

      if (gameBoxInDataArr.size != 1) { sigmaProp(false) } // Debe haber exactamente una caja del juego en estado "Cancelado".
      else {
        val gameBoxInData = gameBoxInDataArr(0)
        val correctGame = gameBoxInData.tokens.size > 0 &&
                          gameBoxInData.tokens(0)._1 == gameNftIdInSelf && 
                          gameBoxInData.R6[Coll[Byte]].isDefined &&
                          gameBoxInData.R4[Int].get == 2 // Estado "Cancelado" es 2
        
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
  // Permite al jugador reclamar sus fondos si el juego queda "atascado"
  // (no se ha resuelto después de un período de gracia tras la fecha límite).
  val playerReclaimsAfterGracePeriod = {
    if (CONTEXT.dataInputs.size > 0) {
      val gameBoxInDataArr = CONTEXT.dataInputs.filter({(b:Box) => b.tokens.size >= 1 && b.tokens(0)._1 == gameNftIdInSelf && b.R4[Int].get == 0}) // Caja del juego game_active.es como Data Input.

      if (gameBoxInDataArr.size == 1) {
        val gameDeadline = gameBoxInDataArr(0).R8[Coll[Long]].get(0)
        
        val gracePeriodIsOver = HEIGHT >= gameDeadline + GRACE_PERIOD_IN_BLOCKS

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
  }

  // --- ACCIÓN 3: Gasto en la finalización normal del juego (EndGame) ---
  val isValidEndGame = {
    val mainGameBoxes = INPUTS.filter({(b:Box) => b.tokens.size >= 1 && b.tokens(0)._1 == gameNftIdInSelf && b.R4[Int].get == 1})

    if (mainGameBoxes.size == 1) {
      val mainGameBox = mainGameBoxes(0)
      val resolutionDeadline = mainGameBox.R8[Coll[Long]].get(5)

      val resolutionPeriodIsOver = HEIGHT >= resolutionDeadline
      resolutionPeriodIsOver
    } 
    else { false }
  }

  // --- ACCIÓN 4: Gasto cuando esta participación es invalidada por los jueces ---
  val isInvalidatedByJudges = {
    val mainGameBoxes = INPUTS.filter({(b:Box) => b.tokens.size >= 1 && b.tokens(0)._1 == gameNftIdInSelf && b.R4[Int].get == 1})

    if (mainGameBoxes.size == 1) {
      val mainGameBox = mainGameBoxes(0)
      val resolutionDeadline = mainGameBox.R8[Coll[Long]].get(5)

      // 1. Verificar que la invalidación ocurre antes del deadline de resolución.
      val isBeforeDeadline = HEIGHT < resolutionDeadline
      
      // 2. Verificar que ESTA caja es la candidata a ganadora que se está invalidando.
      //    El commitment en R5 de esta caja debe coincidir con el del candidato en la caja del juego.
      val winnerCandidateCommitment = mainGameBox.R6[(Coll[Byte], Coll[Byte])].get._2
      val isTheInvalidatedCandidate = SELF.R5[Coll[Byte]].get == winnerCandidateCommitment

      val recreatedGameBoxes = OUTPUTS.filter({(b:Box) => b.propositionBytes == mainGameBox.propositionBytes})
      
      isBeforeDeadline && isTheInvalidatedCandidate && recreatedGameBoxes.size == 1
    }
    else { false }
  }

  // ### Acción 5: Reclamo del creador por abandono
  // Permite al creador del juego reclamar los fondos de esta participación si
  // ha pasado un tiempo muy largo (90 días) desde la finalización del juego.
  // Esto actúa como un mecanismo de limpieza para fondos no reclamados o atascados.
  val creatorClaimsAbandonedFunds = {
    // Buscamos la caja principal del juego en estado "Finalizado" (1) entre los DataInputs.
    val mainGameBoxes = CONTEXT.dataInputs.filter({(b:Box) => b.tokens.size >= 1 && b.tokens(0)._1 == gameNftIdInSelf && b.R4[Int].get == 1})

    if (mainGameBoxes.size == 1) {
      val mainGameBox = mainGameBoxes(0)
      
      // --- Condición 1: Plazo de 90 días superado ---
      // Se comprueba que han pasado 90 días (64800 bloques) desde la fecha límite de resolución.
      val resolutionDeadline = mainGameBox.R8[Coll[Long]].get(5)
      val isAfter90Days = HEIGHT >= resolutionDeadline + ABANDONED_FUNDS_GRACE_PERIOD

      if (isAfter90Days) {
        val participationTokenId = mainGameBox.R9[Coll[Coll[Byte]]].get(1)
        val resolverPK = mainGameBox.R9[Coll[Coll[Byte]]].get(2)

        // --- Condición 2: Destino de los fondos ---
        val outputGoesToCreator = {

          // Calculamos el valor requerido (ERG o tokens) que debe recibir el creador.
          val requiredValue = {
            if (participationTokenId == Coll[Byte]()) {
              SELF.value
            } else {
              SELF.tokens.filter { (token: (Coll[Byte], Long)) => token._1 == participationTokenId }.fold(0L, { (acc: Long, token: (Coll[Byte], Long)) => acc + token._2 })
            }
          }

          // Calculamos el valor (ERG o tokens) que posee el creador en las entradas.
          val inputValue = {
            if (participationTokenId == Coll[Byte]()) {
              INPUTS.filter({(b:Box) => b.propositionBytes == resolverPK}).fold(0L, { (acc: Long, b: Box) => acc + b.value })
            } else {
              INPUTS.filter({(b:Box) => b.propositionBytes == resolverPK})
                .flatMap({(b:Box) => b.tokens}) 
                .filter({(token:(Coll[Byte], Long)) => token._1 == participationTokenId}) 
                .fold(0L, { (acc: Long, token: (Coll[Byte], Long)) => acc + token._2 }) 
            }
          }

          val outputValue = {
            if (participationTokenId == Coll[Byte]()) {
              OUTPUTS.filter({(b:Box) => b.propositionBytes == resolverPK}).fold(0L, { (acc: Long, b: Box) => acc + b.value })
            } else {
              OUTPUTS.filter({(b:Box) => b.propositionBytes == resolverPK})
                .flatMap({(b:Box) => b.tokens}) 
                .filter({(token:(Coll[Byte], Long)) => token._1 == participationTokenId}) 
                .fold(0L, { (acc: Long, token: (Coll[Byte], Long)) => acc + token._2 }) 
            }
          }

          val txFee = if (participationTokenId == Coll[Byte]()) { 10000000L } else { 0L }  // Consider tx fee and min box value only for ERG transfers.
          val addedValue = outputValue - inputValue
          addedValue >= requiredValue - txFee
        }

        sigmaProp(outputGoesToCreator)
      } else {
        sigmaProp(false)
      }
    } 
    else { 
      sigmaProp(false) 
    }
  }

  spentInValidGameCancellation || 
  playerReclaimsAfterGracePeriod || 
  sigmaProp(isValidEndGame) || 
  sigmaProp(isInvalidatedByJudges) ||
  creatorClaimsAbandonedFunds
}