### Acciones

- Estado 1 (activo)
    - [x] Resolución
    - [x] Cancelación

- Estado 2 (juicio)
    - [x] Finalización
    - [x] Omisión de participación
    - [x] Invalidación por jueces

- Estado 3 (cancelacion)
    - [x] Drenar staking

- Acciones individuales de participacion:
    - [x] Cancelar por inactividad en estado 1
    - [x] Retirar fondos por cancelacion en estado 3


### Simplificar participaciones

[x] Un solo estado, solo se gasta al final del juego o en invalidez o cancelación.
[x] Las participaciones solo se gastan al finalizar el juego o en cancelación o invalidación por jueces.
[x] Omited participation solo controla la ganadora.
[x] No hay resolvedCounter en game_resolution.es; únicamente puede finalizar el juego la participación ganadora
[x] Las participaciones poseen una condición que permite al creador del juego obtener su valor si el ganador no resuelve el juego en 90 días.


### Otros

[x] Cubrir el caso sin participaciones validas.
[x] Todas las votaciones deben validarse.
[x] Jueces
    [x] Fetch
    [x] Creación de juez
    [x] Opinar sobre otro juez
    [x] Opionar sobre un juego (aceptar invitación)
    [x] Opinar sobre participación
    [x] Agregar prueba de reputación en juez.

[x] Check constants on fetch.


[x] Obtener juegos finalizados y participaciones gastadas
[x] Mostrar en listado y detalles juegos finalizados y participaciones gastadas.

[x] Allow for P2SH -> en lugar de usar proveDLog para comprobar que el creador/resolvedor es el firmante, comprueba que alguno de los INPUTS tiene ese mismo propositionBytes.
[x] Allow for P2SH en participantes.

[x] Limite de 10 puntuaciones en participation.es

[x] Permitir pagos a jueces

[x] Razonar sobre sistema de reputación

[x] Verificar si action2_judgesInvalidate recreatedGameBox está completo.

[x] Revisar pago a jueces.

[x] Agregar dirección del jugador en el commitment

[x] Implementar en frontend la fórmula de reputación para jueces: SUM[participations => p]( T * p.on_time * p.honest + p.honest + B * burn_erg ), donde se muestra visualmente la fiabilidad basada en participaciones oportunas, honestidad y ERG quemado.

[x] Durante N bloques tras una invalidación la acción de omisión no permite modificar el resolver actual.  Esto permite al creador actualizar la participacion candidata sin ser penalizado.

[x]  En accion end_game, asegurar que el ganador como minimo obtiene el coste de participar, aunque las comisiones del resto tengan que ser 0 (de lo contrario se desincentivaría a participar el primero ya que obligaría al jugador a especular que habrá otros jugadores tambien).

[x] Utilizar variables de entorno definidas en el código. Obtener las variables de cada juego de fetch.ts y validarlas.
 
[x] Normalizar registros entre game_active y game_resolution

[x] Plantear la necesidad de registrar creator script ¿porque no solo resolver script? ¿porque simplemente quien quiera que lo cambie y ya ... ?  el creador podría agregar su prueba de reputación entre el resto de información del juego

[x] Fetch debe asegurarse de que las participaciones son válidas, y marcar las maliciosas.

[»]Obtener semilla de particpaciones de forma pseudo-aleatoria a partir del estado inicial del juego.
[x]Permitir agregar entropia por cualquiera mediante nueva acción en game_active.es
[x] Agregar semilla dentro del commitment, para no requerir a los jueces a la hora de probar si la participación utilizó la semilla correcta.
[x] Implementar acción mediante código.

[x] Soporte multi-token

[x] authorizedToEnd game_resolution action 3.  Autorizar al siguiente a los 3 meses.

[x] Incentivo a participación temprana.
    Un escenario que puede darse es que nadie agregue la primera participación, por dos motivos:
    - No hay vote, asi que no llama la atención.
    - Esperar al último momento permite probar durante mas tiempo.
    Una posible idea para incentivar a participar de manera prematura (si es que lo considera adecuado el creador) es que el puntaje no solo dependa de la puntuacion del juego, si no del bloque en el que se agregó la participación. Algo como `score = game_score * (DEADLINE - HEIGHT)` donde:
    - score: es la puntuación final
    - game_score: es la puntuación del solver en el juego.
    - N: factor constante.
    - DEADLINE: deadline de la competición.
    - HEIGHT: altura donde se agregó la participación.

[x] Revisar contrato en resolution.es action 3.
   Podíamos ponder el ergotree de juez que queramos!

[x] Revisar end_game.ts l.197

[x] JudgesInvalidate debe de otorgar la comisión del creador a los jueces.   
    De esta forma el creador está incentivado a que el servicio juego no permita participaciones invalidas. Es una forma de decir "lo que no ha sabido controlar el creador lo han tenido que controlar los jueces, asi que su comisión es para ellos".    Igualmente, el creador no pierde su stake y puede seguir agregando la participación candidata a ganadora, ya que penalizarle con la perdida del stake tambien supondría un riesgo muy elevado para crear juegos.

[x] ¿Si no hay ganador (pero si que hay fondos) no debería de ir los fondos hacia los jueces en lugar de hacia el creador?    Por que en este caso todas las participaciones son invalidas.
La respuesta es que no, el creador todavía debe obtener la parte del ganador, pues aun siendo su culpa, el es quien debe de ejecutar la transacción de finalización (agrupar todas las participaciones). Los jueces recuperarán su comisión +  la del creador y el creador la del ganador + su stake.

[x] Lotes de participaciones 
(Agregar acción en participacion y crear lotes con nueva accion y accion end_game de participation.es)
De esta forma se permite gastar la caja de resolución tanto con participaciones como con lotes de participaciones.
Teoricamente se permite un numero ilimitado de participaciones.

[x] Sin ERG mode.

[x] Token id del creador en lugar de web link

[x] Permitir comisiones menores al 1%.  El Long puede representar porcentaje en base a 1000000 en lugar de 100.

[x] After create the game, in case it has a creator token id (creator's reputation proof), the creator must verify it's game submitting a positive opinion about it (add an issue to submit it (the same R4 than the nominated judges uses to approve the game) on the same tx or chained tx.)

[x] Agregar visualización de Paper en Game Details

[x] Quitar contratos de reputacion y mejorar diseño de vista de juez.

[x] Extraer la acción 3 de game_resolution.es (end game) a un contrato end_game.es

[x] Implementar end game UI

[x] Mejorar formula de Efficient-score
    - Multiplicar score por slot, donde slot es diferencia_bloque/ceremony_blocks
    - Agregar parámetro variable N.

[x] Implementar EIP-004, para ello primero el token del juego debe mintarse con mint_idt.es

[x] Terminar Demo y agregar puntos de información en GameDetails

[x] Actualizar datos de Judges votes y "what can happen" con el voto unavailable.

[x] Alinear review competition details.

[x] No permitir voto del juez en caso de que no haya ganador. (de ninguna de las dos acciones)

[x] Add soundtrack hash into game content. The soundtrack must be a source like the image and paper. Download soundtrack on fetch.ts if it's available some of their sources.  Reproduce soundtrack on game details.

[x] Aclarar nomenclatura: El creador solo es el creator token id ... en todo lo demas, lo llamamos "resolver" ... (lo digo porque en algunas partes se menciona tanto como resolver como creador ... realmente la unica relacion de los dos terminos es que el creador es quien tiene la oportunidad de ser el resolver)

[x] El explorador web posee tres endpoints distintos, eso ocurre porque algunos usan plural y otros singular (ej: transaction o transactions) ... vamos a permitir que el usuario ponga solo el web explorer una vez e internamente comprobaremos que caso es (si plugral o singular) para cada caso (transaction, address, token) ... deberemos utilizar datos mock para hacer llamadas de prueba (sabemos que estos existen en mainnet)
- token: ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12
- address: 9fcwctfPQPkDfHgxBns5Uu3dwWpaoywhkpLEobLuztfQuV5mt3T
- transaction: 843a5c85ed0f0cf6a936e48eb9d1de0771092ebb7ca54eba0bf95fb13827812b

[x] Detectar de forma automática si el explorador web funciona mediante los datos mock previamente utilizados.

[x] mejorar submit score layout

[x] failed to convert hex to bytes en fill demo participation.

[x] Agregar pantallas de guia para pasos off-chain - creador.
    - Agregar una primera pantalla en CreateGame que guie al usuario en que debe de diseñar un servicio juego y un paper. Para que una vez lo tenga pueda seguir al formulario.

[x] Agregar pantalla de guia para pasos off-chain - participante.
    - "nodo gop_judges_check <game_id>"  Comprobar reputación de los jueces nominados en una competición.
    - "nodo gop_create_bot <game_id>"   Guiar en la creación de un robot; permitir centrarse únicamente en el script del juego; integrar con LLMs externas. Posibilidad de dejar en segundo plano hasta que tenga que participar, y hasta que tenga que desvelar el robot.

[x] Agregar pantalla de guia para pasos off-chain - jueces.
    - Comprobar validez de una participación.  "nodo gop_validate_participation <commitment>"

-----

[x] Invalidación por no disponibilidad.

[x] La participación es valida si y solo si existe una caja cuyo R4 sea el id del servicio y su creación sea anterior a deadline - M. Donde M es una nueva constante llamada ROBOT_SUBMIT_DEADLINE o similar.

[] Actualizar README y KyA (implementar KyA siguiendo el formato propuesto para Sigmaverse)

---

[] Obtener datos de mem-pool [implementar como libreria ¿?]

[x] Chained tx.

====


Para usar Bene, se podría utilizar la librería de Bene, que contiene todas las acciones de Bene y dos componentes de svelte:
- Un formulario, por ejemplo para darle a "Subir juego mediante fundraissing"
- Tarjeta de campañas ... de forma que muestre los juegos de GoP que todavía no han empezado porque se activarán si la campaña de recaudación es satisfactoria. En este caso si se da a visualizar se abrirá una pestaña nueva a la web de Bene o ejecutará el servicio de Bene en caso de Celaut.

De esta forma la librería de Bene tan solo posee componentes de Svelte simples.

> A partir de esta idea consideramos que: Todas las aplicaciones poseen 1. Lógica de negocio TS, 2. Componentes svelte reutilizables y 3. Aplicacion completa. De forma que 1. y 2. se distribuyen como paquetes y se pueden reutiliar.


===========


# Servicios

##### game-robot-factory

[] Permite escribir el script, a mano o mediante vibe-coding. Realiza todo lo demás bajo el capó.
[] Permite o asiste sobre cuando subir el hash del robot, cuando participar y cuando subir el robot.


##### game-service-factory
[] Game obfuscated
[] Señuelos
[] Limited resources



#### Servicio para supervisar jueces

[] Comprobar si el historico de las validaciones e invalidaciones de los jueces son correctas. (ejecutando el robot en caso de que el servicio siga accesible, y comprobando si los logs eran coincidentes o no lo eran).


    RAZONAMIENTO IMPORTANTE:  ¿COMO SE HARÁ ESTO?
        ¿Main in the middle?
         ¿Porque no iba el robot a generar los pasos necesarios para resolver el problema con esa puntuación ....? 
         Pensemos en el caso del stake.
         Primero no sabemos el seed, pero despues de la ceremonia ... sabmeos exactamente donde estarán las manzanas.
         Entonces los participantes crean sus participaciones ...
         ¿Porque no iba en este punto el creador a hacer un robot que simplemente emita los pasos necesarios para comerse todas las manzanas?
         No hace falta pensar que el robot tenía un limite de recursos a utilizar ... el juego de la serpiente consiste en que la serpiente no para, tienes un tiempo concreto para computar que acción tomar, y los posibles caminos se reducen a medida que el tiempo avanza (porque la serpiente no para) ... pero el creador ha podido computar cuales son los pasos optimos, crear un robot que genere esos pasos y despues subir una participación con el score coincidente a esos logs ... de esta forma el robot que probaran los jueces efectivamente ejecuta los logs ... pero no hubiera funcionado en ningun otro seed.
         Esto solo signfica una cosa: "El seed de la ceremonia no puede terminar antes de que los participantes emitan su participación!!!! Los participantes deben de subir su robot, y solo despues subir la participación". 

         La solución a esto implica un doble paso para los participantes: 
          - 1. Subir su robot antes de finalizar la ceremonia.  (De hecho, un tiempo antes de que termine ...)
          - 2. Subir su participación tras la ceremonia (porque se necesita saber el seed).

          Esto significa que realmente las participaciones se podrían calcular por parte del creador del juego ¿? ....
          Si es asi ... ¿sigue teniendo sentido pensar en include ommited y las comparaciones de score .... ?

          Bueno, los participantes deben participar como hasta ahora ... un robot puede generar una variedad enorme de participaciones con un mismo seed. ... y sin el score el creador no sabe cual es la mas alta ... asi que obviamente los participantes deben de participar como hasta ahora ... pero con la obligación de que su solver se hubiera subido antes de saber el seed.

          Esto es algo incomodo para los participantes ... deberán estar atentos de antemano ... simplemente tendrán casi todo el tiempo de Game Active en el que el seed estará cambiando ... y ellos se dedicarań a mejorar y mejorar su robot hasta que decidan subir su robot (particpation.es fase 1)  ... tras la ceremonia, podrán actualizar su participation.es con su score y commitment.

          Esto destruye los incentivos de ver que otros scores hay y pensar en participar o no ... tal vez podríamos pensar que el pago por participar realmente es en la fase 2, y no en la 1 ... realmente tienes que crear una participacion con tu robot antes de terminar la ceremonia ... y tras la ceremonia decides si pagas la tarifa y participas o te retiras. ....

          Esta es la forma correcta de hacerlo, con la que menos se rompen los incentivos que ya teníamos.
          De esta manera el creador ya no puede subir un robot que emite los pasos correctos ... ya que no se conocerá el seed hasta despues de haber empaquetado el robot.


          Para llevar a cabo esta implementación, debemos asegurarnos de que la ceremonia ahora dura todo el tiempo ... asi que la constante será mas bien los últimos N bloques antes del deadline, cuando ya no es posible modificar el seed y los M bloques antes del deadline cuando ya no se pueden subir mas robots (de forma que M < N).




[] Comprobar si las opiniones de "unavailable" de los jueces eran correctas (basandose en este caso en otras opiniones de ese momento ... ya que no puede saberse si el servicio estaba en ese momento disponible o no).

[] La reputación de un juez en un juego debe de reducirse en caso de que el juego, aun pudiendo invalidar la participación, no lo terminara haciendo.
> Esto permite incentivar a los jueces a que alguno de ellos termine actualizando la caja del juego ... uno de ellos debe de realizar la acción, aunque esta no tenga un beneficio para él personalmente y beneficie a todo el grupo por igual. De otra forma, el sistema de incentivos sería erroneo (incentivar a los jueces a ser los ultimos si el que realiza la acción recibe recompensa y/o extraer para la recompensa parte de la participacion invalidada ya que se reduciría del vote principal y tampoco es deseado).

----

# Otros

[] ¿Ceremonia de secreto del servicio juego?

[] Explorar "Participación no interactiva" Basada en pagos a servicios y contratos de participación por terceros.