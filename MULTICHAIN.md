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

## 2. Nuevo Enfoque: Validación Off-Chain mediante Jueces

Tras analizar los desafíos, se optó por un modelo más robusto, flexible y alineado con la arquitectura de confianza de GoP. Este nuevo enfoque se basa en el **sistema de jueces**, un componente previsto para juzgar las acciones del creador del juego. Si los jugadores ya deben confiar en la honestidad de la mayoría de los jueces de un juego, esa misma confianza puede extenderse para validar la información entre cadenas.

La clave de este modelo es que **solo se mueve información, no activos**, eliminando por completo la necesidad de un puente de liquidez.

### Flujo Operativo del Modelo Basado en Jueces

1.  **Participación Multicadena y Provisión de Direcciones:**
    * Un jugador puede participar en un juego desde cualquiera de las cadenas soportadas.
    * Al momento de registrar su participación (ej. en la red Ethereum), el jugador debe proveer no solo su dirección de Ethereum, sino también sus direcciones para todas las demás cadenas que forman parte del juego (ej. su dirección de Ergo, Cardano, etc.). Esta información se registra junto con su `commitmentC`.

2.  **Fondos Nativos y Descentralizados:**
    * Cada cadena acumula su propio bote de premios de forma independiente. El contrato satélite en Ethereum acumula ETH, el de Cardano acumula ADA, y así sucesivamente.
    * **Los fondos nunca abandonan su cadena de origen.** No hay transferencias entre cadenas, por lo que no hay problemas de liquidez.

3.  **Consolidación de Información (Off-Chain):**
    * Una vez finalizado el plazo de participación, el creador tiene la responsabilidad de recopilar los datos de participación (`commitmentC`, `solverId`, lista de direcciones del jugador, etc.) de cada contrato satélite en cada una de las cadenas y agregarlas como *bolsa de participaciones externas* en una caja en Ergo. Los jueces designados para el juego podrán invalidar estas bolsas de participaciones externas tal como hacen con las participaciones de forma individual. Si el creador se equivoca en alguna de las bolsas perderá parte de su staking en esa cadena.

4.  **Validación y Determinación del Ganador Global:**
    * Los jueces presentan esta información consolidada al contrato principal en Ergo. La lógica del contrato `game.es` sigue siendo la fuente de verdad para la resolución.
    * Con el secreto `S` revelado por el creador en Ergo, se validan los `commitmentC` de todas las participaciones (sin importar de qué cadena provengan) y se determina un **único ganador global** basado en la puntuación más alta.

5.  **Distribución de Premios Nativa:**
    * Una vez que el ganador es declarado, se ejecuta la distribución de los premios en cada cadena.
    * El bote de premios acumulado en ETH se envía a la dirección de Ethereum que el ganador proveyó. El bote de ADA se envía a su dirección de Cardano, y el bote de ERG a su dirección de Ergo. El ganador recibe todos los botes, cada uno en su red nativa.

## 3. Ventajas del Nuevo Modelo

Este enfoque basado en jueces es superior al modelo de puente por varias razones:

* **Evita Problemas de Liquidez:** Al no mover activos entre cadenas, el sistema no depende de la liquidez de los puentes.
* **Independencia de Infraestructura:** La plataforma no depende de funcionalidades específicas de Rosen Bridge (como, tal vez, el soporte P2SH), lo que otorga mayor autonomía y reduce los riesgos técnicos.
* **Flexibilidad y Escalabilidad:** Añadir una nueva blockchain a un juego es mucho más sencillo. Solo se necesita desplegar un contrato satélite y que los jueces lo supervisen, sin la complejidad de establecer nuevos puentes de liquidez.
* **Alineación con el Modelo de Confianza de GoP:** El sistema aprovecha la estructura de confianza de los jueces, que igualmente es un componente basico del sistema de manera nativa (solo en Ergo).
