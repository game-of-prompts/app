# Estrategia Multicadena en Game of Prompts (GoP)

La visión de Game of Prompts (GoP) es crear una plataforma de competición global y descentralizada. Un pilar fundamental para alcanzar esta visión es la capacidad de operar a través de múltiples blockchains (multicadena), permitiendo que comunidades de distintas redes participen en los mismos juegos. Este documento detalla la evolución de nuestra estrategia para implementar esta funcionalidad, describiendo el enfoque inicial y el modelo final adoptado.

## 1. Enfoque Inicial: Contratos Satélite con Rosen Bridge

La primera propuesta para la expansión multicadena se basaba en el uso de **Rosen Bridge**, un puente de interoperabilidad que conecta Ergo con otras redes.

La idea era la siguiente:
* **Contratos Satélite:** Por cada juego creado en Ergo, se desplegarían "contratos satélite" en otras cadenas (ej. Ethereum, Cardano). Estos contratos replicarían las reglas básicas del juego, como la tarifa de participación y la fecha límite.
* **Agregación en Ergo:** Los jugadores de otras cadenas interactuarían con estos contratos satélite. Una vez finalizado el plazo, el contrato satélite se "gastaría" para enviar todos los fondos acumulados y los datos de las participaciones (`commitmentC`, etc.) a través de Rosen Bridge hacia una dirección específica en Ergo.
* **Resolución Centralizada:** La resolución final del juego, la comparación de todas las participaciones y la determinación del ganador se realizarían en Ergo, utilizando los datos agregados de todas las cadenas.

### Desafíos del Modelo Rosen Bridge

Sin embargo, este enfoque presentaba dos obstáculos significativos:

1.  **Dependencia de Liquidez:** Para que los fondos fluyeran de una cadena a otra (ej. de ETH en Ethereum a ERG en Ergo), se requeriría liquidez suficiente en los puentes para los activos envueltos (wrapped assets), como `rsETH`. Si un juego se volvía popular, podría agotar esta liquidez, impidiendo las transferencias.
2.  **Limitaciones Técnicas de Rosen Bridge:** El plan requería que Rosen Bridge pudiera enviar fondos y datos a una dirección de contrato inteligente en Ergo (una dirección **P2SH** - Pay-to-Script-Hash). En el momento del diseño, la funcionalidad del puente se centraba principalmente en transferencias a direcciones de clave pública (P2PK - Pay-to-Public-Key), lo que suponía una dependencia técnica sobre la evolución de la infraestructura de Rosen.

## 2. Nuevo Enfoque: No se toca el contrato principal; solo se mueven datos; la liquidez se queda en cada cadena.

Partiendo de que:
- Es posible crear una competicion de GoP con multiples tokens.
- Una participacion puede tener cualquier ergotree de envio (no solo P2PK).
- Existe un data-bridge basado en el sistema de reputacion e independiente de la plataforma GoP.
   Simplificacion: Consiste en que consideramos un dato verificable cuando lo dan por aprobado pruebas con un valor apostado > N.

De esta forma en el contrato satelite los usuarios agregan sus participaciones.
El creador del juego, antes de crear la competicion, ha creado una caja que contiene un nuevo token; esta caja dice que:
> La prueba de reputación con valor apostado mayor que N puede retirar parte de estos tokens si los utiliza como participaciones validas para la competicion.

Cualquier actor que conserva una buena reputación podrá ir a esa caja y crear la participacion que considere con respecto al contrato satelite.
- Si el actor no replica los datos tal como estaban en el contrato satelite otros actores (y el propio creador tal vez) opinarán mal de él.
- Si el actor actua bien, opinarán bien de él. Además, está incentivado porque el commitment de la participacion que agregue posee un script de gasto que le permite ponerse el como benefactor (ej: 70% para el participante ganador y 30% para el actor).


De esta forma se evita que estos actores (que recrean las participaciones de los participantes de ethereum en ergo) tengan que utilizar liquidez.


Tener en cuenta que:
- Esto no es incompatible con el uso de rosen bridge.
- Los participantes de ergo no necesitan confiar en toda la mecanica del data-bridge.

===

Esto todavía despierta una duda, ¿en caso de que gane un participante de ethereum como se le enviarán los fondos? 
- Una solución puede ser mediante rosen bridge.
- Otra podría ser que cada participante pueda agregar su respectiva dirección de cada una de las cadenas disponibles en esa dirección.

En caso de que gane un participante de Ergo ¿como obtendrá él los fondos depositados en Ethereum?

> Se debe de tener en cuenta que en Ethereum no hay sistema de reputación. ¿quien puede mover entonces los fondos de ethereum?  ¿Y si se implementa un sistema de reputación en Ethereum?
### El mayor problema aqui es ¿cuanto valor debe de tener una prueba de reputación bloqueado para permitirle mover los fondos ...? 
Tal vez la única solución es que en cada contrato satelite exista un set de guardianes.