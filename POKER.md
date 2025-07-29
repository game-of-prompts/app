### **Sistema de Incentivos Poker: Especificación Técnica**

Este documento detalla la arquitectura y lógica de un sistema de incentivos basado en una mecánica de apuestas de póker, diseñado para integrarse en plataformas de competición basadas en la puntuación. El objetivo es introducir una capa de estrategia de riesgo sobre la competición de habilidad técnica.

---

#### **1. Arquitectura de Componentes**

El sistema opera sobre cuatro componentes fundamentales:

1.  **Puntuación del Participante (`puntuacionBase`):** Métrica objetiva y cuantificable del rendimiento de la solución de un participante. Se asume que es un valor numérico no negativo.

2.  **Compromiso Criptográfico (`commitmentC`):** Para garantizar el juego limpio, cada participante se compromete con su `puntuacionBase` antes de la fase de apuestas. Esto se logra mediante un esquema de compromiso de hash:
    * `commitmentC = HASH(puntuacionBase + nonce)`
    * Donde `nonce` es una cadena aleatoria secreta y `HASH` es una función criptográficamente segura (ej. SHA-256). El `commitmentC` se hace público; la `puntuacionBase` y el `nonce` se revelan al final.

3.  **Tarifas de Participación:**
    * **Tarifa Mínima (`tarifaMinima`):** Coste base definido por el organizador para entrar en la competición.
    * **Tarifa Pagada (`tarifaPagada`):** La tarifa total que un participante elige pagar, donde `tarifaPagada >= tarifaMinima`. La diferencia (`tarifaPagada - tarifaMinima`) constituye la apuesta estratégica o "apuesta de póker".

4.  **Parámetro de Sistema:**
    * **Tasa de Contribución al Premio Base (`TCPB`):** Un porcentaje (0% a 100%) definido por el organizador. Determina qué porción de las apuestas de póker se desvía para recompensar la habilidad técnica pura.

#### **2. Estructura de Premios**

El sistema establece dos premios distintos, financiados por las tarifas de los participantes.

1.  **Premio Base:** Recompensa la excelencia técnica. Su ganador es el participante con la `puntuacionBase` más alta.
2.  **Premio de Poker:** Recompensa la estrategia de apuesta y la autoevaluación. Su ganador se determina mediante una puntuación ponderada.

La composición de estos premios se calcula de la siguiente manera:

* `boteApuestas = SUM(participante -> tarifaPagada - tarifaMinima)`
* `contribucionAPremioBase = boteApuestas * TCPB`
* **Premio Base Final = `SUM(participante -> tarifaMinima) + contribucionAPremioBase`**
* **Premio de Poker Final = `boteApuestas * (1 - TCPB)`**

#### **3. Flujo Operativo Secuencial**

El sistema se ejecuta en cuatro fases discretas y obligatorias.

1.  **Fase de Compromiso y Apuesta:**
    * Cada participante calcula y envía su `commitmentC`.
    * Cada participante envía su `tarifaPagada`.
    * El sistema registra los compromisos y las tarifas. Esta fase se cierra en un tiempo límite estricto. La información de las tarifas pagadas es pública.

2.  **Fase de Revelación:**
    * Tras el cierre de la primera fase, todos los participantes deben revelar su `puntuacionBase` y el `nonce` original.
    * El sistema verifica para cada participante que `HASH(puntuacionBase + nonce) == commitmentC`.
    * **Punto de Fallo:** Si un participante no revela o la verificación falla, su participación es nula. Su `tarifaPagada` se redistribuye a los premios según la `TCPB` y es descalificado.

3.  **Fase de Adjudicación:**
    * **Cálculo del Ganador del Premio Base:** El sistema identifica al participante con la `puntuacionBase` verificada más alta.
    * **Cálculo del Ganador del Premio de Poker:** Para cada participante válido, el sistema calcula una `PuntuacionPoker`:
        * **`PuntuacionPoker = puntuacionBase * (tarifaPagada / tarifaMinima)`**
        * El participante con la `PuntuacionPoker` más alta gana el `Premio de Poker Final`.

4.  **Fase de Distribución:**
    * Los fondos de cada premio se transfieren a sus respectivos ganadores.

#### **4. Verificación y Casos Límite**

Una implementación robusta debe superar las siguientes verificaciones:

* **Integridad Financiera:** La suma de los premios distribuidos debe ser exactamente igual a la suma de las tarifas recaudadas. Se deben usar tipos de datos de punto fijo para los cálculos monetarios para evitar errores de redondeo.
* **Manejo de Empates:** Deben existir reglas de desempate deterministas. La solución estándar es dividir el premio correspondiente equitativamente entre los ganadores empatados.
* **Mínimo de Participantes:** El juego debe definir un umbral mínimo de participantes. Si no se alcanza, el juego se anula y todas las tarifas son reembolsadas.
* **Atomicidad:** Las transiciones entre fases (ej. de "apuesta" a "revelación") deben ser atómicas para prevenir condiciones de carrera.
* **Seguridad:** La función de `HASH` y la longitud del `nonce` deben ser lo suficientemente fuertes para prevenir ataques de pre-cálculo y colisión. La `tarifaMinima` debe ser forzosamente mayor que cero para evitar divisiones por cero.