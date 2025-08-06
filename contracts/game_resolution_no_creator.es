{
  // === Constants ===
  val STAKE_DENOMINATOR = 5L
  val JUDGE_PERIOD = 30L
  // val DEV_TRIBE_ADDRESS = fromBase16("$DEV_TRIBE_ADDRESS")
  // val DEV_TRIBE_PERCENT_FEE = 5
  val PARTICIPATION_BOX_SCRIPT_HASH = fromBase16("$PARTICIPATION_BOX_SCRIPT_HASH")

  // === Register Definitions (GameBox) ===

  // R4: (Long, Int) - Height for resolution and participation resolved counter.
  // R5: Coll[Byte] - Secret
  // R6: Coll[Long] - numericalParameters: Collection [deadline, creatorStake, participationFee]
  //                   - numericalParameters(0) (deadline): Block height limit for participation/resolution.
  //                   - numericalParameters(1) (creatorStake): Creator's ERG stake.
  //                   - numericalParameters(2) (participationFee): ERG participation fee.
  // R7: Coll[Byte] - winnerCandidateCommitment
  // R8: Int        - Comission percentage for all the participants.
  // R9: Coll[Byte] - gameDetailsJsonHex: JSON String (UTF-8 -> Hex) with game details (title, description, etc.). 


  // === Tokens (GameBox) ===
  // SELF.tokens(0): (gameNftId: Coll[Byte], amount: Long) - Unique game NFT, amount 1L.

  // === Value Extraction ===

  val gameCreatorPK = SELF.R4[Coll[Byte]].get

  val stateTuple_R5 = SELF.R5[(Long, Coll[Byte])].get
  val unlockHeight_in_self = stateTuple_R5._1 // unlockHeight is now the first element
  val secretOrHash_in_self = stateTuple_R5._2 // secretOrHash is now the second element

  val hashS_in_self = if (unlockHeight_in_self == 0L) {
    secretOrHash_in_self // If unlockHeight is 0, this is the hashS
  } else {
    blake2b256(secretOrHash_in_self) // If unlockHeight > 0, this is the revealed S
  }

  val action2_not_initialized = unlockHeight_in_self == 0L
  
  val numericalParams = SELF.R7[Coll[Long]].get
  val deadline = numericalParams(0)
  val creatorStake = numericalParams(1)
  val participationFee = numericalParams(2)
  
  val commissionPercentage = SELF.R8[Int].get
  val gameNftId = SELF.tokens(0)._1

  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd") // For PK() workaround
  val gameCreatorP2PKPropBytes = P2PK_ERGOTREE_PREFIX ++ gameCreatorPK

  val isAfterDeadline = HEIGHT >= deadline
  val isBeforeDeadline = HEIGHT < deadline 


  val action3b_participationOmmited = true  // Gasta la caja actual y una caja con el script participation_submited.es. Se agrega la caja de la participacion candidata (la cual tiene el script participation_resolved.es) como Data Input. El score de la caja de participación debe ser mayor al score de la participación candidata.  Se crea de nuevo la caja actual pero sumando el contador de participaciones en uno.   Se crea una caja de participacion similar a la gastada pero con el script participation_resolved.es.      El ejecutor de la transacción puede retirar ¿¿¿ 1/5 ???? del stake del creador como comisión. 

  // > En este punto surgen varias dudas: A diferencia de la cancelación, aqui no tiene sentido limitar a un drenaje repartido del stake, ya que el secreto ya fue resuelto en A1a    ¿Que pasa si es el propio creador quien se omite una participación a proposito para llevarse el stake? Esto significa que no se puede entregar el stake al ejecutor. ¿parte al ejecutor (que puede ser el creador) y parte al participante de manera directa? esto recompensa a ambos y desincentiva al creador ya que perdería una porción del staking.     Tambien deberíamos de considerar que, siendo que igualmente se va a terminar resolviendo el juego y sabiendo que el creador ya ha cumplido con su parte (desvelar S mediante la acción A1a) ¿porque no retirarle tambien su recompensa?  ¿A donde debería de ir en ese caso la recompensa? ¿A todos los participantes? Si, a todos los participantes es la forma mas segura, pues asi se asegura de que el creador no es ni el jugador ganador (lo cual puede serlo simplemente comprando los jueces y generando él mismo una score falsa muy alta) ni los jueces en si mismos.    Se sabrá que el creador ya no tiene potestad para recibir su comisión porque  la caja cambiará al script game_resolution_no_creator, la cual será similar a game_resolution.es pero con gameCreatorPK en R9 y con R8 unicamente conteniendo el Int de la comisión del creador (que ahora irá para todos los participantes).

  // Por lo tanto: El ejecutor de la transacción puede retirar 1/5 del stake del creador como comisión, 2/5 irán para el participante omitido.

  // Ahora surge otro problema ... realmente se deben de agregar todas las participaciones omitidas, no tan solo las participaciones omitidas que tengan que ser candidatas ... asi que en realidad se debe de incentivar a agregar todas las participaciones omitidas y, ademas, a hacerlo en una sola tx. a ser posible. Para solucionar esto, el ejecutor debería de crear una caja (script: omited_participation_reward.es) que se podrá gastar al gastar la caja principal mediante la acción 1D. Pero si antes de JUDGE_PERIOD algun otro ejecutor demuestra que todavía quedaban participaciones omitidas, entonces el ejecutor original no podrá retirar la caja de recompensa y lo hará el nuevo ejecutor en su lugar.

  val action3c_judges = true  // Los jueces consideran que la participación candidata no es válida.  Gasta la caja actual con la firma de M jueces.    Se debe de gastar la participacion (script: participation_resolved.es) que es candidata según R7.    Los fondos de la participación candidata se transfieren a la caja del juego de nuevo, con los mismos parámetros que la actual pero restando el contador de jueces y agregando una nueva participación candidata (a no ser que el contador sea 0, en cuyo caso el registro R7 quedará vacio).  Se debe de aumentar el bloque de R4 JUDGE_PERIOD para permitir que los jueces puedan volver a votar esta nueva participación candidata.

  val action3d_endGame = true  // Esta acción se puede realizar cuando se ha superado el bloque marcado en R4.    Especificamente debe asegurarse de que  los fondos de todas las participaciones (con script participation_resolved.es) se envien a la participacion candidata. Y que a todas las participaciones se les envie su parte de la comisión del creador. Ademas debe asegurarse de que la caja omited_participation_reward.es es gastada y se envia el staking del creador a la dirección que tiene esta caja en su registro R4.
  
  // The script allows spending the GameBox if it's a valid resolution.
  sigmaProp(action3b_participationOmmited || action3c_judges || action3d_endGame)
}