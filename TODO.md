En game.es Se deberá de juntar R4 y R8 en algun momento.   Y R9 debería de ser Coll[Coll[Byte]] para acceder a los detalles del juego.

Asegurarse de que en el sistema de reputación se aseguran R7, sin que tenga que ser siempre el mismo, y puediendo ser un contrato ... por lo que en lugar de ser una clave publica debe ser una dirección ...


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

### Otros

[] Cubrir el caso sin participaciones validas.
[x] Todas las votaciones deben validarse.
[] Jueces
    [x] Fetch
    [x] Creación de juez
    [] Opinar sobre otro juez
    [x] Opionar sobre un juego (aceptar invitación)
    [x] Opinar sobre participación
    [x] Agregar prueba de reputación en juez.
    
    - Vector de ataque: un usuario malicioso podría crear N jueces que opinan honestamente, si ademas, el usuario malicioso crea un juego e invita a sus jueces. ¿como sabran los usuarios que los jueces no son de fiar?
        1.-Pueden fijarse en el lapso en el que opinaron en otros juegos.
        2.-Para evitar que se creen jueces sin coste, podemos agregar la opción en la que se agregue ERG a un juez (suma del ERG en todas sus cajas) de manera que ese ERG, siguiendo el contrato actual, no podrá ser retirado (hasta que lo obtenga el minero en el demurage).
        
        Por tanto, si vemos muchos jueces, pero opinaron tarde y su ERG quemado es bajo, su reputación (representada en UI) será baja.   Si un pequeño grupo de jueces tiene mas cantidad quemada y opinaron en cada momento, esos tendran la reputación alta.

        Tambien se puede tener en cuenta, y esto es solo a nivel de logica off-chain, que se valore mas una primera opinion sobre algo que una segunda ... aunque robots podrían estar replicando y tal vez entrar antes en mempool ... Asi que simplemente tendría mas sentido considerar quien opinó antes de que se resolviera un juego y quien despues, aun cuando las dos opiniones sean correctas, una tiene que valer mas que la otra.

        Se debe implementar una formula de calculo de reputación, para mostrarlo a nivel local.     SUM[participations => p]( T*p.on_time*p.honest + p.honest + B*burn_erg)

        Tambien debe haber una formula que nos indique a partir de que umbral de premio al creador le es rentable ser malicioso (siempre y cuando tenga a los jueces comprados). Esto es: la suma de los ERGs quemados de todos los jueces + (?) * la comisión del juego actual + (?) * historico de otros juegos del creador.  En referencia a esto último, el creador debería identificarse con su prueba de reputación (agregandola en game info) ya que el contrato del creador puede variar dependiendo de la configuracion (parte a los jueces, referidos, etc ...)

[] GameInfo without JSON
[] Allow for P2SH
[x] Check constants on fetch.

[] Poker

##### game-service-factory
[] Game obfuscated
[] Señuelos
[] Limited resources



# Agregaciones al contrato

##### Evitar que el creador finalice el juego aunque exista una mayoría de jueces en contra.
Actualmente, esto se puede dar, ya que aunque un conjunto mayoritario de los jueces opine en contra de la participacion candidata deberá haber alguien que gaste el game_resolution demostrando esas opiniones. Pero no hay una condición que obligue al creador a demostrar lo contrario si va a resolver

Lo que debería implementarse es una condición en action3_endGame de game_resolution.es que muestre que la mayoria de los jueces del juego no poseen una opinion negativa de la participación (agregando todas las cajas de cada juez como datainputs).


##### judgesInvalidate  debería de permitirse que en la misma transaccion se agregue la prueba de reputación (en caso de que sea posible, simplemente implementar).
Actualmente, el ultimo juez debe de subir su opinion, y despues, cualquiera gastar el contrato principal demostrando las opiniones.  

Permitir hacer ambas cosas es una mejora de UX.

~~##### Limite de invalidacion por jueces, en caso de superarse, se cancela el juego.~~
~~El creador podría agregar muchas participaciones para bloquear la resolución (ya que los jueces no terminarían nunca, cada vez se extiende el tiempo de juicio).~~
~~Aunque esto no es necesario ya que el creador debería de gastar para pagar todas las participaciones ... que no irán para él.  ~~
~~Asi est no es necesario controlarlo~~

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


##### Revisar todo's en el gasto de participaciones en game_active.es y game_resolution.es