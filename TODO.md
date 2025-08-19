En game.es Se deberá de juntar R4 y R8 en algun momento.   Y R9 debería de ser Coll[Coll[Byte]] para acceder a los detalles del juego.

Asegurarse de que en el sistema de reputación se aseguran R7, sin que tenga que ser siempre el mismo, y puediendo ser un contrato ... por lo que en lugar de ser una clave publica debe ser una dirección ...


### Acciones

- Estado 1 (activo)
    - [x] Resolución
    - [x] Cancelación

- Estado 2 (juicio)
    - [x] Finalización
    - [] Omisión de participación
    - [] Invalidación por jueces

- Estado 3 (cancelacion)
    - [x] Drenar staking

- Acciones individuales de participacion:
    - [] cancelar por inactividad en estado 1
    - [] retirar fondos por cancelacion en estado 3

### Otros

[x] Todas las votaciones deben validarse.
- Los jueces deben opinar tambien en positivo, aunque en el contrato la omisión significa que acceden.   <--- ESTO ES SOLO DE FRONT.
- Votación con peso.

- GameInfo without JSON
- Allow for P2SH
- Check constants on fetch.

- Poker

##### game-service-factory
- Game obfuscated
- Señuelos
- Limited resources




=======


Test de prueba
https://scastie.scala-lang.org/DYmWz9EcSd2ZISfb2teC6w


Mismo test pero compilando
https://scastie.scala-lang.org/hntoyWvcSDazaxap0zqeag


Test actual: https://scastie.scala-lang.org/jI0FqvEMT5i2OrsJIETqEA