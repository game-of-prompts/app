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
    [] Fetch
    [] Creación de juez
    [] Opinar sobre otro juez
    [] Opionar sobre un juego
    [] Opinar sobre participación

[] GameInfo without JSON
[] Allow for P2SH
[x] Check constants on fetch.

[] Poker

##### game-service-factory
[] Game obfuscated
[] Señuelos
[] Limited resources
