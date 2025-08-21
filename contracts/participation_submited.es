{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  // Hash del script al que esta caja debe transicionar en la fase de resolución.
  val PARTICIPATION_RESOLVED_SCRIPT_HASH = fromBase16("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`") // Placeholder

  // Prefijo P2PK para la validación de direcciones.
  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd")

  // =================================================================
  // === DEFINICIONES DE REGISTROS (PARTICIPACIÓN ENVIADA)
  // =================================================================

  // R4: Coll[Byte] - playerPKBytes: Clave pública del jugador.
  // R5: Coll[Byte] - commitmentC: Commitment criptográfico con la puntuación verdadera.
  // R6: Coll[Byte] - gameNftId: ID del NFT del juego al que pertenece esta participación.
  // R7: Coll[Byte] - solverId: ID del solver del jugador.
  // R8: Coll[Byte] - hashLogs: Hash de los logs del juego del jugador.
  // R9: Coll[Long] - scoreList: Lista de puntuaciones, una de las cuales es la verdadera.
  
  // =================================================================
  // === EXTRACCIÓN DE VALORES
  // =================================================================

  val playerPKBytes = SELF.R4[Coll[Byte]].get
  val gameNftIdInSelf = SELF.R6[Coll[Byte]].get

  // =================================================================
  // === ACCIONES DE GASTO
  // =================================================================

  // ### Acción 1: Transición a Participación Resuelta
  // Esta acción se ejecuta cuando 'game_active.es' inicia la resolución.
  val spentInValidGameResolution = {
    val gameBoxCandidate = INPUTS(0) // La caja del juego 'game_active.es' es la primera entrada.

    if (gameBoxCandidate.R4[Int].get == 0) {  // Game state is "Active" (0)
      val gameBoxIsPlausible =
        gameBoxCandidate.tokens.size == 1 &&
        gameBoxCandidate.tokens(0)._1 == gameNftIdInSelf &&
        gameBoxCandidate.R5[(Coll[Byte], Long)].isDefined &&
        gameBoxCandidate.R6[Coll[Byte]].isDefined &&
        gameBoxCandidate.R8[Coll[Long]].isDefined &&
        gameBoxCandidate.R8[Coll[Long]].get.size == 3

      if (gameBoxIsPlausible) {
          val gameDeadline = gameBoxCandidate.R8[Coll[Long]].get(0)
          
          // Condición 1: La transacción debe ocurrir después de la fecha límite del juego.
          val isAfterDeadline = HEIGHT >= gameDeadline
          
          // Condición 2: La caja debe ser recreada con el nuevo script 'participation_resolved.es'.
          val isRecreatedCorrectly = OUTPUTS.exists { (outBox: Box) =>
            // La nueva caja debe tener el script de la siguiente fase.
            blake2b256(outBox.propositionBytes) == PARTICIPATION_RESOLVED_SCRIPT_HASH &&
            // Y debe ser idéntica en todo lo demás (valor, registros, tokens).
            outBox.value == SELF.value &&
            outBox.tokens == SELF.tokens &&
            outBox.R4[Coll[Byte]].get == SELF.R4[Coll[Byte]].get &&
            outBox.R5[Coll[Byte]].get == SELF.R5[Coll[Byte]].get &&
            outBox.R6[Coll[Byte]].get == SELF.R6[Coll[Byte]].get &&
            outBox.R7[Coll[Byte]].get == SELF.R7[Coll[Byte]].get &&
            outBox.R8[Coll[Byte]].get == SELF.R8[Coll[Byte]].get &&
            outBox.R9[Coll[Long]].get == SELF.R9[Coll[Long]].get
          }
          
          isAfterDeadline && isRecreatedCorrectly
      } 
      else { false }
    } 
    else { false }
  }

  // ### Acción 2: Transicion a participacion Resuelta mediante game_resolution.es, debido a que el creador omitió esta participacion.
  val spentAsOmitted = {
    val gameBoxCandidate = INPUTS(0) // La caja del juego 'game_resolution.es' es la primera entrada.

    if (gameBoxCandidate.R4[Int].get == 1) {  // Game state is "Resolved" (1)
      val gameBoxIsPlausible =
        gameBoxCandidate.tokens.size == 1 &&
        gameBoxCandidate.tokens(0)._1 == gameNftIdInSelf &&
        gameBoxCandidate.R5[(Coll[Byte], Coll[Byte])].isDefined &&
        gameBoxCandidate.R6[Coll[Coll[Byte]]].isDefined &&
        gameBoxCandidate.R7[Coll[Long]].isDefined &&
        gameBoxCandidate.R7[Coll[Long]].get.size == 5 &&
        gameBoxCandidate.R8[(Coll[Byte], Long)].isDefined &&
        gameBoxCandidate.R9[(Coll[Byte], Coll[Byte])].isDefined

      if (gameBoxIsPlausible) {
          val gameDeadline = gameBoxCandidate.R7[Coll[Long]].get(0)
          
          // Condición 1: La participación debió ser enviada antes de la fecha límite de resolución.
          val isBeforeDeadline = SELF.creationInfo._1 < gameDeadline

          // No es necesario comprobar que se realiza despues de la fecha límite del juego, ya que se comprueba que el script del juego sea del estado "Resolved" (1).
          
          // Condición 2: La caja debe ser recreada con el nuevo script 'participation_resolved.es'.
          val isRecreatedCorrectly = OUTPUTS.exists { (outBox: Box) =>
            // La nueva caja debe tener el script de la siguiente fase.
            blake2b256(outBox.propositionBytes) == PARTICIPATION_RESOLVED_SCRIPT_HASH &&
            // Y debe ser idéntica en todo lo demás (valor, registros, tokens).
            outBox.value == SELF.value &&
            outBox.tokens == SELF.tokens &&
            outBox.R4[Coll[Byte]].get == SELF.R4[Coll[Byte]].get &&
            outBox.R5[Coll[Byte]].get == SELF.R5[Coll[Byte]].get &&
            outBox.R6[Coll[Byte]].get == SELF.R6[Coll[Byte]].get &&
            outBox.R7[Coll[Byte]].get == SELF.R7[Coll[Byte]].get &&
            outBox.R8[Coll[Byte]].get == SELF.R8[Coll[Byte]].get &&
            outBox.R9[Coll[Long]].get == SELF.R9[Coll[Long]].get
          }
          
          isBeforeDeadline && isRecreatedCorrectly
      } else {
          false
      }
    }
    else { false }
  }

  // ### Acción 3: Reembolso por Cancelación de Juego
  // Permite al jugador recuperar sus fondos si el juego es cancelado (el secreto 'S' es revelado prematuramente).
  val spentInValidGameCancellation = {
    if (CONTEXT.dataInputs.size > 0) {
      val gameBoxInData = CONTEXT.dataInputs(0)  // Caja del juego game_cancelled.es como Data Input.

      val correctGame = gameBoxInData.tokens.size > 0 &&
                        gameBoxInData.tokens(0)._1 == gameNftIdInSelf && 
                        gameBoxInData.R6[Coll[Byte]].isDefined

      val playerGetsRefund = OUTPUTS.exists { (outBox: Box) =>
        outBox.propositionBytes == P2PK_ERGOTREE_PREFIX ++ playerPKBytes &&
        outBox.value >= SELF.value
      }
      
      correctGame && playerGetsRefund
    }
    else { false }
  }

  // ### Acción 4: Reclamo por Período de Gracia (Placeholder)
  // Lógica futura que permitiría al jugador reclamar sus fondos si el juego queda "atascado".
  val playerReclaimsAfterGracePeriod = false

  sigmaProp(spentInValidGameResolution || spentAsOmitted || spentInValidGameCancellation || playerReclaimsAfterGracePeriod)
}