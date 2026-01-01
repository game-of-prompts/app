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

[x] Durante N bloques tras una invalidación la acción de omisión no permite modificar el creador/resolver actual.  Esto permite al creador actualizar la participacion candidata sin ser penalizado.

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

[] Sin ERG mode.

[] Intentar optimizar el tamaño de game_resolution.es o bien extraer la acción end game a un contrato end_game.es

[] Token id del creador en lugar de web link

[] Permitir comisiones menores al 1%.  El Long puede representar porcentaje en base a 1000000 en lugar de 100.

[] Terminar Demo y agregar puntos de información en GameDetails

[] Actualizar README y KyA (implementar KyA siguiendo el formato propuesto para Sigmaverse)

====


Para usar Bene, se podría utilizar la librería de Bene, que contiene todas las acciones de Bene y dos componentes de svelte:
- Un formulario, por ejemplo para darle a "Subir juego mediante fundraissing"
- Tarjeta de campañas ... de forma que muestre los juegos de GoP que todavía no han empezado porque se activarán si la campaña de recaudación es satisfactoria. En este caso si se da a visualizar se abrirá una pestaña nueva a la web de Bene o ejecutará el servicio de Bene en caso de Celaut.

De esta forma la librería de Bene tan solo posee componentes de Svelte simples.

> A partir de esta idea consideramos que: Todas las aplicaciones poseen 1. Lógica de negocio TS, 2. Componentes svelte reutilizables y 3. Aplicacion completa. De forma que 1. y 2. se distribuyen como paquetes y se pueden reutiliar.


===========


# Servicios


##### game-service-factory
[] Game obfuscated
[] Señuelos
[] Limited resources



#### Servicio para supervisar jueces

[] La reputación de un juez en un juego debe de reducirse en caso de que el juego, aun pudiendo invalidar la participación, no lo terminara haciendo.
> Esto permite incentivar a los jueces a que alguno de ellos termine actualizando la caja del juego ... uno de ellos debe de realizar la acción, aunque esta no tenga un beneficio para él personalmente y beneficie a todo el grupo por igual. De otra forma, el sistema de incentivos sería erroneo (incentivar a los jueces a ser los ultimos si el que realiza la acción recibe recompensa y/o extraer para la recompensa parte de la participacion invalidada ya que se reduciría del vote principal y tampoco es deseado).

----


[] ¿Ceremonia de secreto del servicio juego?