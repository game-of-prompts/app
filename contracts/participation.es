{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  // Prefijo P2PK para la validación de direcciones.
  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd")
  
  // Período de gracia en bloques para que el jugador reclame si el juego se atasca.
  val GRACE_PERIOD_IN_BLOCKS = 720L // Aprox. 24 horas
  val ABANDONED_FUNDS_GRACE_PERIOD = 64800L // 90 días

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
      val gameBoxInDataArr = CONTEXT.dataInputs.filter({(b:Box) => b.tokens.size == 1 && b.tokens(0)._1 == gameNftIdInSelf && b.R4[Int].get == 2})  // Caja del juego game_cancelled.es como Data Input.

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
      val gameBoxInDataArr = CONTEXT.dataInputs.filter({(b:Box) => b.tokens.size == 1 && b.tokens(0)._1 == gameNftIdInSelf && b.R4[Int].get == 0}) // Caja del juego game_active.es como Data Input.

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
    val mainGameBoxes = INPUTS.filter({(b:Box) => b.tokens.size == 1 && b.tokens(0)._1 == gameNftIdInSelf && b.R4[Int].get == 1})

    if (mainGameBoxes.size == 1) {
      val mainGameBox = mainGameBoxes(0)
      val resolutionDeadline = mainGameBox.R7[Coll[Long]].get(3)

      // 1. Verificar que esta participación pertenece a la caja del juego que se está gastando.
      val gameLinkIsValid = mainGameBox.tokens(0)._1 == gameNftIdInSelf && mainGameBox.R4[Int].get == 1

      // 2. Verificar que el período de resolución/juicio ha terminado.
      val resolutionPeriodIsOver = HEIGHT >= resolutionDeadline

      gameLinkIsValid && resolutionPeriodIsOver
    } 
    else { false }
  }

  // --- ACCIÓN 4: Gasto cuando esta participación es invalidada por los jueces ---
  val isInvalidatedByJudges = {
    val mainGameBoxes = INPUTS.filter({(b:Box) => b.tokens.size == 1 && b.tokens(0)._1 == gameNftIdInSelf && b.R4[Int].get == 1})

    if (mainGameBoxes.size == 1) {
      val mainGameBox = mainGameBoxes(0)
      val resolutionDeadline = mainGameBox.R7[Coll[Long]].get(3)

      // 1. Verificar que la invalidación ocurre antes del deadline de resolución.
      val isBeforeDeadline = HEIGHT < resolutionDeadline
      
      // 2. Verificar que ESTA caja es la candidata a ganadora que se está invalidando.
      //    El commitment en R5 de esta caja debe coincidir con el del candidato en la caja del juego.
      val winnerCandidateCommitment = mainGameBox.R5[(Coll[Byte], Coll[Byte])].get._2
      val isTheInvalidatedCandidate = SELF.R5[Coll[Byte]].get == winnerCandidateCommitment

      val recreatedGameBoxes = OUTPUTS.filter({(b:Box) => b.propositionBytes == mainGameBox.propositionBytes})
      if (isBeforeDeadline && isTheInvalidatedCandidate && recreatedGameBoxes.size == 1) {
        // 3. Verificar que la transacción recrea la caja del juego correctamente según las reglas de invalidación.
        val recreatedGameBox = recreatedGameBoxes(0)
        
        // El contador de participantes resueltos debe disminuir en 1.
        val oldResolvedCounter = mainGameBox.R7[Coll[Long]].get(4)
        val counterIsDecreased = recreatedGameBox.R7[Coll[Long]].get(4) == oldResolvedCounter - 1  // Esta comprobación nos asegura que la acción realizada es una invalidación por los jueces.
        
        // Los fondos de esta caja deben ser devueltos al pozo de premios en la nueva caja del juego.
        val fundsAreReturned = recreatedGameBox.value >= mainGameBox.value + SELF.value
        
        // El nuevo candidato a ganador debe ser diferente al de esta caja.
        val newWinnerCommitment = recreatedGameBox.R5[(Coll[Byte], Coll[Byte])].get._2
        val winnerIsChanged = newWinnerCommitment != winnerCandidateCommitment

        counterIsDecreased && fundsAreReturned && winnerIsChanged
      } else { false }
    }
    else { false }
  }

  // ### Acción 5: Reclamo del creador por abandono
  // Permite al creador del juego reclamar los fondos de esta participación si
  // ha pasado un tiempo muy largo (90 días) desde la finalización del juego.
  // Esto actúa como un mecanismo de limpieza para fondos no reclamados o atascados.
  val creatorClaimsAbandonedFunds = {
    // Buscamos la caja principal del juego en estado "Finalizado" (1) entre los DataInputs.
    val mainGameBoxes = CONTEXT.dataInputs.filter({(b:Box) => b.tokens.size == 1 && b.tokens(0)._1 == gameNftIdInSelf && b.R4[Int].get == 1})

    if (mainGameBoxes.size == 1) {
      val mainGameBox = mainGameBoxes(0)
      
      // --- Condición 1: Plazo de 90 días superado ---
      // Se comprueba que han pasado 90 días (64800 bloques) desde la fecha límite de resolución.
      val resolutionDeadline = mainGameBox.R7[Coll[Long]].get(3)
      val isAfter90Days = HEIGHT >= resolutionDeadline + ABANDONED_FUNDS_GRACE_PERIOD

      if (isAfter90Days) {
        val resolverPK = mainGameBox.R8[(Coll[Byte], Long)].get._1

        // --- Condición 2: Autenticación del creador ---
        val prefix = resolverPK.slice(0, 3)
        val pubKey = resolverPK.slice(3, resolverPK.size)

        val signedByCreator = 
          (sigmaProp(prefix == P2PK_ERGOTREE_PREFIX) && proveDlog(decodePoint(pubKey))) ||
          sigmaProp(INPUTS.exists({ (box: Box) => box.propositionBytes == resolverPK }))

        // --- Condición 3: Destino de los fondos ---
        val outputGoesToCreator = OUTPUTS.exists({(b:Box) => 
          b.propositionBytes == resolverPK &&
          b.value >= SELF.value
        })

        signedByCreator && sigmaProp(outputGoesToCreator)
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