# Optimización de Participaciones en Contratos Inteligentes en Ergo: Uso de Merkle Trees para Resolución Eficiente

## Introducción

En el desarrollo de contratos inteligentes en la blockchain de Ergo, un desafío común surge cuando se manejan un gran número de "participaciones" (entradas o cajas relacionadas con un juego o aplicación descentralizada). Estas participaciones representan contribuciones de usuarios, cada una con atributos como un *score* (puntuación) y una altura de creación. El objetivo típico es resolver el juego identificando la participación con el score más alto, distribuyendo fondos y aplicando penalizaciones si es necesario.

Sin embargo, las transacciones en Ergo están limitadas por el tamaño de bloque (aproximadamente 512 KB), lo que restringe el número de inputs, outputs y dataInputs que se pueden procesar en una sola transacción. Además, ErgoScript —el lenguaje de scripting de Ergo— impone costes computacionales que escalan con la complejidad de las operaciones, lo que puede hacer inviables enfoques naïves para grandes conjuntos de datos.

Este documento explica el problema actual, sus limitaciones (incluyendo costes no constantes en loops), y propone una optimización basada en Merkle trees para lograr una resolución escalable y eficiente. Se basa en conceptos clave de Ergo, como eUTXO, Sigma protocols y el modelo de costes híbrido (AOT/JIT).

## Problema Actual: Procesamiento con DataInputs y Loops

En la implementación actual, para resolver el juego:
- Todas las participaciones válidas se presentan como **dataInputs** en la transacción de resolución. Cada dataInput es una referencia a una caja (box) existente, que incluye el ID y el score de la participación (almacenados en registros como R4 para el score).
- On-chain, el script del contrato itera sobre estos dataInputs para computar el score máximo. Esto se implementa típicamente con una operación funcional como `fold` en ErgoScript:

  ```scala
  val maxScore = dataInputs.fold(0L, { (acc: Long, box: Box) => max(acc, box.R4[Long].get) })
  ```

  Aquí, `dataInputs` es una colección (`Coll[Box]`) de todas las participaciones referenciadas.

### Limitaciones Técnicas
1. **Límites de Tamaño de Transacción**:
   - Cada dataInput ocupa aproximadamente 32 bytes (solo la referencia al boxId), pero con overhead, una transacción con miles de dataInputs puede exceder el límite práctico de ~10.000 dataInputs por bloque.
   - Inputs regulares (para gastar cajas) son más pesados (~150 bytes cada uno), limitando a ~3.000 por transacción.

2. **Costes Computacionales en ErgoScript**:
   - ErgoScript es no-Turing completo, lo que garantiza terminación, pero operaciones como `fold` sobre colecciones grandes no tienen un coste constante. El coste es **O(N)**, donde N es el número de dataInputs:
     - Cada iteración del `fold` ejecuta operaciones como acceso a registros (`box.RX.get`), comparaciones (`max`) y acumulaciones.
     - En el modelo de costes híbrido de Ergo (introducido en v5.0):
       - **AOT Costing**: Estima costes estáticos para operaciones criptográficas (e.g., hashes, EC points).
       - **JIT Costing**: Acumula costes durante la ejecución real del intérprete, sumando por opcode.
     - Para N grande (e.g., 1.000+), el coste total puede superar el límite por script (~1 millón de unidades de coste estimadas) o por transacción, causando rechazos por complejidad excesiva.
   - Sigma protocols permiten cómputos off-chain y pruebas zero-knowledge, pero en este caso, el loop se ejecuta on-chain durante la verificación, y su coste escala linealmente, no es independiente de N.

3. **Otros Problemas**:
   - Si N excede los límites, no se puede resolver el juego en una sola transacción.
   - Vulnerabilidad a omisiones intencionales por el creador del juego, requiriendo mecanismos de desafío.

## Solución Propuesta: Uso de Merkle Trees para Resolución Escalable

Para superar estos límites, proponemos un enfoque basado en **Merkle trees** (o árboles AVL, nativos en Ergo para proofs eficientes). El Merkle tree representa compactamente todas las participaciones ordenadas (por score descendente y altura ascendente), permitiendo pruebas de inclusión/exclusión con coste logarítmico (O(log N)), mucho más eficiente que O(N).

### Pasos de la Implementación
1. **Cómputo Off-Chain Inicial (por el Creador)**:
   - Recopila todas las participaciones válidas off-chain.
   - Ordena por `score:desc, altura:asc`.
   - Construye un Merkle tree donde cada hoja es el hash de (commitment de la participación).
   - La raíz del tree (un hash compacto, ~32 bytes) se usa como prueba agregada.

2. **Transacción de Resolución Inicial**:
   - El creador gasta la caja del juego y crea una nueva en estado "resolved", almacenando la raíz del Merkle en un registro (e.g., R5).
   - No se necesitan dataInputs para todas las participaciones aquí — solo basics para verificación (e.g., autorizado, deadline no pasado).
   - Coste: Bajo y constante (no depende de N).

3. **Fase de Desafíos (para Participaciones Omitidas)**:
   - Durante un período limitado (e.g., 30 bloques ~1 hora), cualquiera puede submitir una transacción de "add omitted".
   - En la tx: Presenta una sola participación como dataInput, junto con una prueba de ausencia en el Merkle actual (Merkle proof: path de hashes adyacentes).
   - El script verifica:
     - Validez de la participación.
     - Ausencia en el tree (verifica proof, coste O(log N) hashes ~14 ops para N=10.000).
     - Inserta la nueva hoja en la posición ordenada y computa nueva raíz (nuevamente O(log N)).
   - Actualiza la caja del juego con la nueva raíz.
   - Aplica penalización al creador (e.g., deducida de stake, creciente por bloque).
   - Coste por tx: Bajo (solo una dataInput, log N ops).

4. **Deadline Final y Batching**:
   - Pasado el período, no más desafíos (verificado por `HEIGHT` en script).
   - Post-deadline, permite crear "batches" (lotes) de participaciones:
     - Una tx gasta N participaciones (e.g., 500-1.000) y crea un batch box con suma de fondos y sub-raíz Merkle.
     - Script restrictivo: Solo gastable en la tx final.
   - Repite hasta agrupar todo (batches recursivos si N muy alto).

5. **Transacción Final de Gasto**:
   - Gasta la caja del juego + todos los batches/participaciones restantes.
   - Verifica que la raíz overall (compuesta de sub-raíces) coincida con la final.
   - Distribuye fondos según scores (e.g., pagos a ganadores).
   - Si necesario, usa boxes intermedios para simular chained tx (atomicidad con timeouts).
   - Coste: O(log N) para verificación Merkle + fijo por batches (limitado a ~100 inputs).

### Ventajas en Costes y Escalabilidad
- **Coste Computacional**: Pasa de O(N) a O(log N) para verificaciones clave, manteniéndolo cerca de constante (e.g., <1.000 ops para N=1 millón).
- **Escalabilidad**: Maneja decenas de miles de participaciones sin exceder límites de tx.
- **Seguridad**: Desafíos descentralizados evitan fraudes; Sigma protocols pueden usarse para proofs adicionales (e.g., probar conocimiento off-chain sin revelar datos).
- **Eficiencia con Sigma Protocols**: Aunque no hacen costes independientes, permiten reducir cómputos off-chain (e.g., generar proofs Merkle off-chain y verificar on-chain eficientemente).

### Consideraciones de Implementación
- **ErgoScript Ejemplo Simplificado para Verificación Merkle**:
  ```scala
  // Asume proof como Coll[Byte] en INPUTS(1).R4, newLeaf en dataInputs(0)
  val root = SELF.R5[Coll[Byte]].get  // Raíz actual
  val computedRoot = fold(proofPath, root, { (acc: Coll[Byte], sibling: Coll[Byte]) =>
    if (isLeftChild) blake2b256(sibling ++ acc) else blake2b256(acc ++ sibling)
  })
  // Insertar y verificar ausencia similarmente
  computedRoot == newRootAfterInsert
  ```
  - Coste: Cada `blake2b256` ~100-200 unidades; log N iteraciones.

- **Pruebas y Herramientas**: Usa Ergo Playground para simular scripts y estimar costes. Testnet para tx reales.

- **Riesgos**: Complejidad del script (mantén <4 KB serializado). Ataques de spam: Requiere fees o penalties para desafíos inválidos.

## Conclusión

Esta optimización transforma un enfoque lineal e ineficiente en uno logarítmico y escalable, aprovechando las fortalezas de Ergo como Merkle proofs y costes predictibles. Reduce la dependencia de loops costosos on-chain, moviendo cómputo a off-chain donde posible. Para implementaciones reales, consulta la documentación oficial de Ergo y prueba exhaustivamente para ajustar límites y penalizaciones.

Si necesitas código completo, diagramas o extensiones (e.g., integración con AVL trees), proporciona más detalles.