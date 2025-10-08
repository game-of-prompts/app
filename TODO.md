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

[] Compatibilizar con P2SH y P2S  para direcciones de jugadores y creador.

[] Permitir pagos a jueces
[] Razonar sobre sistema de reputación
[] ¿Compatibilizar jueces.R7 con direcciones P2PK y P2S?

[] Verificar si action2_judgesInvalidate recreatedGameBox está completo.

[] Agregar dirección del jugador en el commitment

[] Implementar en frontend la fórmula de reputación para jueces: SUM[participations => p]( T * p.on_time * p.honest + p.honest + B * burn_erg ), donde se muestra visualmente la fiabilidad basada en participaciones oportunas, honestidad y ERG quemado.


##### game-service-factory
[] Game obfuscated
[] Señuelos
[] Limited resources

#### Servicio para supervisar jueces










----

##### Puntuacion en funcion de antiguedad del bloque -> incentivo de participar antes aunq no haya demasiado vote.
Un escenario que puede darse es que nadie agregue la primera participación, por dos motivos:
- No hay vote, asi que no llama la atención.
- Esperar al último momento permite probar mas veces.

Una posible idea para incentivar a participar de manera prematura (si es que lo considera adecuado el creador) es que el puntaje no solo dependa de la puntuacion del juego, si no del bloque en el que se agregó la participación. Algo como `score = game_score + N*(DEADLINE - HEIGHT)` donde:
- score: es la puntuación final
- game_score: es la puntuación del solver en el juego.
- N: factor constante.
- DEADLINE: deadline de la competición.
- HEIGHT: altura donde se agregó la participación.

### Permitir otros tokens en lugar de ERG. Bolsa de tokens con coste de participación para cada token.

### Gastar participaciones en lotes
De esta forma se permite gastar la caja de resolución tanto con participaciones como con lotes de participaciones.
Teoricamente se permite un numero ilimitado de participaciones.

### Poker

### Contratos satélite
