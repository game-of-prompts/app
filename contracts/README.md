# **Visión General del Protocolo de Juego Descentralizado**

Este documento describe el ciclo de vida de un juego descentralizado implementado a través de una serie de contratos inteligentes en la blockchain de Ergo. El protocolo define un flujo robusto y sin confianza que abarca desde la creación y participación en un juego, hasta su resolución, pago de premios y mecanismos de salvaguarda contra comportamientos maliciosos o errores. Al operar de forma descentralizada, el sistema garantiza la transparencia, la equidad y la resistencia a la censura, ya que las reglas del juego están codificadas en los contratos y no pueden ser alteradas por una autoridad central.

El sistema se compone de cinco contratos principales, cada uno representando un **estado** específico dentro del ciclo de vida del juego. Una "caja" (UTXO) protegida por uno de estos contratos representa la instancia actual del juego o de una participación. Las transiciones entre estados se realizan mediante transacciones que consumen una caja en un estado y crean una nueva en otro, siguiendo estrictamente las reglas definidas en el código ErgoScript.

## **Diagrama de Flujo de Estados**

El siguiente diagrama ilustra las transiciones posibles entre los diferentes estados del protocolo. Cada nodo representa un contrato y cada flecha una acción que transforma el estado del juego o de una participación.

stateDiagram-v2
    direction LR

    [*] --> Juego_Activo

    state fork_state <<fork>>
    Juego_Activo --> fork_state: El jugador paga la tarifa

    subgraph "Ciclo de Participación"
        direction TB
        fork_state --> Participacion_Enviada
        Participacion_Enviada --> Participacion_Resuelta: Transición a Resolución (normal)
        Participacion_Enviada --> Reembolso: Juego es cancelado
        Participacion_Resuelta --> Fondos_Distribuidos: Finalización del Juego
    end

    state Juego_Activo {
        direction LR
        note left of Juego_Activo
            <b>Contrato</b>: game_active.es
            <br/>El juego está abierto. Los jugadores
            <br/>pueden enviar sus participaciones.
        end note
        Juego_Activo --> Juego_en_Resolucion: <b>Acción</b>: Transición a Resolución <br/> <b>Gatillo</b>: Pasa la fecha límite (deadline) <br/> <b>Ejecutor</b>: Creador revela secreto 'S'
        Juego_Activo --> Juego_Cancelado: <b>Acción</b>: Transición a Cancelación <br/> <b>Gatillo</b>: Se revela el secreto 'S' ANTES de la fecha límite <br/> <b>Ejecutor</b>: Cualquiera (cazarrecompensas)
    }

    state Juego_en_Resolucion {
        note left of Juego_en_Resolucion
            <b>Contrato</b>: game_resolution.es
            <br/>Fase de juicio. El resultado puede
            <br/>ser disputado o corregido.
        end note
        Juego_en_Resolucion --> Juego_en_Resolucion: <b>Acción</b>: Incluir Participación Omitida <br/> <b>Gatillo</b>: Un jugador omitido es incluido por un tercero <br/> <b>Efecto</b>: El tercero se vuelve "Resolvedor"
        Juego_en_Resolucion --> Fondos_Distribuidos: <b>Acción</b>: Finalizar Juego (endGame) <br/> <b>Gatillo</b>: Pasa la fecha límite de resolución <br/> <b>Ejecutor</b>: Cualquiera
    }

    state Juego_Cancelado {
         note right of Juego_Cancelado
            <b>Contrato</b>: game_cancellation.es
            <br/>Estado punitivo. El stake del
            <br/>creador es drenado periódicamente.
        end note
        Juego_Cancelado --> Juego_Cancelado: <b>Acción</b>: Drenar Stake <br/> <b>Gatillo</b>: Pasa el cooldown <br/> <b>Ejecutor</b>: Cualquiera
        Juego_Cancelado --> Cancelacion_Finalizada: <b>Acción</b>: Finalizar Drenaje <br/> <b>Gatillo</b>: El stake restante es muy bajo <br/> <b>Ejecutor</b>: Cualquiera
    }

    Fondos_Distribuidos --> [*]
    Cancelacion_Finalizada --> [*]
    Reembolso --> [*]

## **Descripción de los Contratos (Estados)**

### **1\. Juego Activo (game\_active.es)**

\[Imagen de una línea de salida para una carrera\]

Este es el estado inicial y principal del juego, análogo a un "lobby" o sala de espera. La caja del contrato actúa como la fuente única de verdad para las reglas del juego, conteniendo el NFT identificador, la fianza (stake) del creador, la fecha límite (deadline), la tarifa de participación y un hash del secreto S del creador.

* **Propósito Detallado:** Su función es ser el ancla central e inmutable mientras el juego está abierto. Garantiza a los jugadores que las reglas no cambiarán y que los fondos del creador están bloqueados como garantía de juego limpio. El hash del secreto (secretHash) es una promesa de que el creador conoce una clave S que revelará más tarde, pero sin desvelarla aún.  
* **Acciones Posibles:**  
  * **Transición a Resolución (action1\_transitionToResolution):** Es el camino feliz. Una vez que la fecha límite ha pasado (HEIGHT \>= deadline), el creador está obligado a revelar el secreto S. Para ello, construye una transacción que consume la caja game\_active.es y todas las cajas de participación (participation\_submited.es). Al proporcionar el S correcto (verificado contra el secretHash), el contrato le permite crear una nueva caja game\_resolution.es, que contiene el pozo de premios total y la identidad del ganador preliminar. Todas las participaciones se recrean como participation\_resolved.es para indicar que han sido procesadas.  
  * **Transición a Cancelación (action2\_transitionToCancellation):** Este es el mecanismo de castigo. Si *antes* de la fecha límite, el secreto S es revelado (ya sea por un descuido del creador o por un ataque), cualquier persona (un "cazarrecompensas") puede forzar al juego a este estado. La acción consume la caja game\_active.es y premia al cazarrecompensas con una porción de la fianza del creador. El resto de la fianza se encapsula en una nueva caja game\_cancellation.es, donde quedará expuesta a ser drenada. Esta amenaza económica desincentiva fuertemente al creador a manejar mal el secreto.

### **2\. Participación Enviada (participation\_submited.es)**

Cuando un jugador decide unirse, crea una de estas cajas. Es como enviar un sobre sellado por correo certificado. Contiene la tarifa de participación, su clave pública, y un *commitment* criptográfico (un hash) de su puntuación o solución. Este commitment se crea combinando la puntuación real con otros datos, incluyendo el secreto S que aún no se conoce.

* **Propósito Detallado:** Representar la entrada individual, privada y verificable de un jugador. El uso de un *commitment* es crucial:  
  1. **Privacidad:** Nadie (ni otros jugadores, ni el creador) puede saber la puntuación del jugador antes de tiempo.  
  2. Inmutabilidad: El jugador no puede cambiar su puntuación después de ver las de los demás.  
     La lista de puntuaciones falsas (scoreList) sirve para ofuscar la puntuación real, añadiendo una capa de privacidad.  
* **Acciones Posibles:**  
  * **Inclusión en Resolución (spentInValidGameResolution):** En el flujo normal, esta caja es consumida por el creador en la transacción de transitionToResolution. El contrato verifica que la caja se recrea idénticamente pero bajo el nuevo script participation\_resolved.es, señalando que ha pasado a la siguiente fase.  
  * **Reembolso por Cancelación (spentInValidGameCancellation):** Si el juego entra en el estado game\_cancellation.es, el secreto S se hace público. El jugador puede entonces usar este S para construir una transacción que demuestre que su participación era válida y gastar su propia caja para recuperar el 100% de su tarifa. Es una ruta de escape garantizada.  
  * **Inclusión Tardía (Referenciado en game\_resolution.es):** Si el creador, maliciosamente o por error, "olvida" incluir una participación válida al mover el juego a resolución, el protocolo no se rompe. Un tercero puede tomar esa participación "huérfana" y forzar su inclusión en la fase de game\_resolution, como se detalla más adelante.

### **3\. Juego en Resolución (game\_resolution.es)**

\[Imagen de un mazo de juez y un bloque de sonido\]

Este estado es la "cámara del juez". El secreto S ya es público, se ha calculado un ganador preliminar y el pozo de premios está consolidado. Sin embargo, se abre un período de gracia (JUDGE\_PERIOD) para disputas o correcciones. Un concepto clave aquí es el "Resolvedor": la entidad (inicialmente el creador) que tiene derecho a recibir la fianza y la comisión del juego si todo concluye correctamente.

* **Propósito Detallado:** Gestionar una fase final de validación que permita corregir errores o trampas del creador, como la omisión de participaciones. Esto añade una capa de robustez y seguridad, permitiendo la intervención de la comunidad para asegurar un resultado justo.  
* **Acciones Posibles:**  
  * **Finalizar Juego (action3\_endGame):** Si el período de juicio transcurre sin incidentes (isAfterResolutionDeadline), cualquiera puede ejecutar esta acción final. La transacción consume la caja game\_resolution y la caja participation\_resolved del ganador. El contrato distribuye los fondos: el pozo de premios va para el ganador y la fianza original del creador más las comisiones van para el "Resolvedor" actual.  
  * **Incluir Participación Omitida (action1\_includeOmittedParticipation):** Esta es una acción de cazarrecompensas crítica. Si un jugador fue omitido, un tercero puede gastar la caja game\_resolution junto con la participation\_submited.es omitida. El contrato recalcula el ganador. Como recompensa por mantener la integridad del juego, el cazarrecompensas se convierte en el nuevo "Resolvedor", robándole al creador original el derecho a recuperar su fianza y comisión.  
  * **Invalidación por Jueces (action2\_judgesInvalidate):** Una acción (actualmente un placeholder) que representa una posible gobernanza por un panel de jueces o un sistema de DAO. Podrían anular un resultado, devolver los fondos al pozo y extender el período de resolución para una nueva evaluación.

### **4\. Participación Resuelta (participation\_resolved.es)**

Este es el estado de una participación que ha sido procesada y aceptada en la fase de resolución. Su lógica es extremadamente simple, actuando como un ticket "listo para cobrar".

* **Propósito Detallado:** "Congelar" una participación para evitar cualquier gasto no autorizado. Su única razón de ser es esperar a la transacción endGame que finalizará el juego. Sirve como una pieza del rompecabezas que debe estar presente para la resolución final.  
* **Acciones Posibles:**  
  * **Ser Gastada en endGame (isValidEndGame):** La única forma de gastar esta caja es como una entrada en la transacción action3\_endGame del contrato game\_resolution.es. El script simplemente verifica que la transacción está siendo orquestada por la caja principal del juego y que el período de juicio ha terminado, asegurando que no se pueda gastar prematuramente.

### **5\. Juego Cancelado (game\_cancellation.es)**

\[Imagen de un reloj de arena derritiéndose\]

Este es un estado punitivo e irreversible. Se activa si el secreto del juego se revela antes de tiempo, lo que se considera una falta grave por parte del creador. La fianza del creador queda atrapada en este contrato, disponible para ser reclamada en porciones por la comunidad.

* **Propósito Detallado:** Crear un fuerte desincentivo económico contra la mala gestión o revelación prematura del secreto S. Al hacer que la fianza del creador sea públicamente reclamable, el protocolo asegura que el creador tiene mucho que perder si no sigue las reglas.  
* **Acciones Posibles:**  
  * **Drenar Stake (action1\_drainStake):** El contrato funciona como un grifo que gotea. Después de que pase un período de enfriamiento (cooldownIsOver), cualquiera puede ejecutar esta acción para reclamar una fracción (1/5) del stake restante. La caja se recrea con el stake reducido y el temporizador de enfriamiento se reinicia. Este ciclo puede repetirse.  
  * **Finalizar Drenaje (action2\_finalizeDrain):** Eventualmente, el stake restante será tan pequeño que no valdrá la pena continuar el ciclo. Esta acción final permite a cualquiera reclamar el "polvo" de ERGs restante. Como trofeo y prueba inmutable de la cancelación, la acción también mintea un nuevo NFT que certifica que el juego fue cancelado. Esto limpia el estado final del protocolo y cierra el ciclo de vida de este juego fallido.