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
[x] Jueces
    [x] Fetch
    [x] Creación de juez
    [x] Opinar sobre otro juez
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

[] Use CONTEXT.preHeader.timestamp  en lugar de HEIGHT
[] GameInfo without JSON
[] Allow for P2SH
[x] Check constants on fetch.

[] Poker
[] Contratos satélites

##### game-service-factory
[] Game obfuscated
[] Señuelos
[] Limited resources




### Sobre fetch e indentación
- Las participaciones y juegos gastados se pueden obtener de la api de cajas historicas.  Pero si no tiene utilidad mantener el estado no debe de dejarse, no es limpio.



### Participaciones en el contrato
- [Revisar todo's en el gasto de participaciones en game_active.es y game_resolution.es]




### Evitar que el creador finalice el juego aunque exista una mayoría de jueces en contra.
Actualmente, esto se puede dar, ya que aunque un conjunto mayoritario de los jueces opine en contra de la participacion candidata deberá haber alguien que gaste el game_resolution demostrando esas opiniones. Pero no hay una condición que obligue al creador a demostrar lo contrario si va a resolver

Lo que debería implementarse es una condición en action3_endGame de game_resolution.es que muestre que la mayoria de los jueces del juego no poseen una opinion negativa de la participación (agregando todas las cajas de cada juez como datainputs). --> Esto es complicado de hacer, ya que mostrar todos los datainputs es dificil y en el caso de la implementación de las pruebas con merkles tambien. 
  
Tal vez lo mejor es implementar lo que hay abajo:

##### judgesInvalidate  debería de permitirse que en la misma transaccion se agregue la prueba de reputación (en caso de que sea posible, simplemente implementar).
Actualmente, el ultimo juez debe de subir su opinion, y despues, cualquiera gastar el contrato principal demostrando las opiniones.  

Permitir hacer ambas cosas es una mejora de UX.   Ademas, nos evita tener que implementar lo de arriba.


AUNQUE --- Realmente no es necesario, simplemente asumamos que es necesario que la participacion se invalide antes del deadline.    Se puede agregar incentivo al ejecutor de la invalidación ... 



### Optimización de participaciones.

Las transacciones tienen una cantidad máxima de inputs que pueden gastar, ya que hay un limte de bytes.   Esto implica que hay un limite de participaciones, ya que no se podrá resolver el juego con todas a la vez ...

Soluciones: 

~~ Permitir resolver el juego con N participaciones (game_active -> game_resolved) y despues el creador tiene X tiempo para agregar omitidas, ¿tal vez por lotes?, de forma que X es menor que JUDGE_TIME.  X puede ser una constante, por ejemplo 30 bloques (1 hora aprox.) ~~

~~Otra solución podría usar chained tx. de forma que en lugar de 30 bloques debe de hacerse en el mismo. ¿?  -> El problema de esto es que la chained tx. se podría aprobar a mitad solo... Lo cual vuelve a requerir aumentar a 30 bloques de margen.~~

~~ Otra solución complementaria puede ser que la penalización del stake por omisión de participación sea menor en función del bloque (cada vez penaliza mas) en caso de que se hayan agregado ya N participaciones (aunque siempre que la participacion omitida sea de un bloque posterior y no anterior a la mas nueva). ~~ 


- SI se utilzia un merkle tree a partir de game resolution con las participaciones ... (tal vez no es necesario resolved counter).
  Esto permite que el creador declare que participaciones están resueltas, sin tener que gastarlas todas en la tx. de resolución. Ni tampoco mostrarlas como datainputs.
  ¿
  Es necesario tener dos estados en las participaciones? Tal vez no es necesario gastarlas hasta el final ... Incluso tal vez no es necesario gastarlas, simplemente el ganador es quien puede obtener cada participacion ... aunque esto requiere de un estado de "juego terminado".

  Pero, durante la fase de resolución, ¿como diferenciamos entre las participaciones que el creador todavía no ha procesado y las que ha omitido?
  - Una solución a esto puede ser el actual resolved counter:
   1. Computa todas las participaciones validas off-chain. 
   2. Resuelve la caja del juego agregando la raiz de un Merkle tree de todas las participaciones ordenadas por altura:asc y <>.  
        TODO: Hay que terminar de razonar porque ordenarlo asi, ya que implicará posiblemente no tener el mas alto al principio ... lo cual de mas trabajo a los jueces.
                Si consideramos que se ordena por score:desc y altura:asc está directamente dando la puntuación ganadora de primeras.  <-- ESTO TIENE MAS SENTIDO.  Asi los jueces no trabajan de más por nada.





## ¿Usar timestamp en lugar de HEIGHT?   CONTEXT.preHeader.timestamp


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
