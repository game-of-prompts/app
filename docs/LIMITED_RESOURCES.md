# Garantizando el Cumplimiento de Recursos Limitados

Uno de los pilares de la competición justa en Game of Prompts (GoP) es asegurar que todos los solvers compitan bajo las mismas condiciones. Esto incluye la imposición de límites a los recursos computacionales (CPU, RAM, etc.) que un solver puede utilizar. Sin embargo, surge un desafío de seguridad cuando tanto el servicio del juego como el del solver se ejecutan en un nodo Celaut controlado por el propio participante.

## El Problema: El Nodo Controlado por el Adversario

El flujo estándar de GoP implica que un participante descargue un servicio de juego (`game-service`) y lo ejecute en su nodo local. Posteriormente, le proporciona su propio `solver-service` al `game-service` para que este lo instancie y comience la partida.

El `game-service` está diseñado para poder leer la especificación del solver (su archivo `.celaut.bee`). En esta especificación, el creador del solver define los límites de recursos que su servicio requiere. El `game-service` puede verificar estos límites y, si no cumplen con las reglas del juego (ej. un solver pide 128 GB de RAM para un juego que solo permite 1 GB), puede invalidar la participación desde el inicio.

La vulnerabilidad reside en la ejecución:
* El participante controla el nodo Celaut que ejecuta ambos servicios.
* Un participante malicioso podría modificar el comportamiento de su nodo para que, cuando el `game-service` solicite la ejecución del solver con una especificación de 1 GB de RAM, el nodo ignore esta restricción y le asigne 64 GB de RAM.
* Esto le daría al solver una ventaja computacional injusta, rompiendo el equilibrio competitivo del juego.

¿Cómo puede el `game-service` confiar en que el nodo del participante está haciendo cumplir honestamente los límites de recursos? La respuesta es mediante un mecanismo de trampas y señuelos.

---
## La Solución: Señuelos y Enmascaramiento de Identidad

Para resolver esta vulnerabilidad, el `game-service` emplea una estrategia de ofuscación y verificación activa, partiendo del supuesto de que su propio código está ofuscado y es ininteligible para el participante que lo ejecuta.

El mecanismo se desarrolla en los siguientes pasos:

### 1. Solicitud de Múltiples Instancias
En lugar de solicitar únicamente la ejecución de una instancia del `solver-service` del jugador, el `game-service` solicitará a la vez la ejecución de, por ejemplo, **20 servicios "señuelo" (decoys)** además del solver real.

### 2. Enmascaramiento de Identidad
Antes de enviar las solicitudes de ejecución al nodo, el `game-service` **enmascara o modifica las especificaciones de todos los servicios** (el solver real y los 20 señuelos). El objetivo es que, desde la perspectiva del nodo, todas las solicitudes parezcan provenir de servicios distintos y no relacionados. El nodo del participante ve 21 solicitudes de ejecución diferentes y no puede saber cuál de ellas corresponde al solver real que él mismo ha creado.

### 3. El Señuelo "Canario"
Al menos uno de los servicios señuelo está programado para actuar como un "canario en la mina de carbón". La especificación de este señuelo canario declarará un límite de recursos estricto (ej. 1 GB de RAM), pero su código interno intentará, de forma deliberada, consumir una cantidad de memoria muy superior (ej. 30 GB de RAM).

### 4. Verificación y Consecuencias
El `game-service` monitoriza el estado de todas las instancias que solicitó, especialmente las de los señuelos.
* **En un nodo honesto:** El nodo Celaut detectará que el señuelo canario está violando su asignación de memoria y lo terminará de forma abrupta. El `game-service`, al ver que su canario ha "muerto" como se esperaba, puede confiar en que el nodo está aplicando las reglas correctamente al resto de instancias, incluido el solver real.
* **En un nodo tramposo:** El nodo modificado permitirá que el señuelo canario exceda su límite de RAM sin terminarlo. Cuando el `game-service` observe que su señuelo canario sigue vivo tras intentar consumir 30 GB de RAM, **sabrá con certeza que el nodo está haciendo trampas** y no está haciendo cumplir las restricciones de recursos.

Si se detecta el engaño, el `game-service` puede invalidar la partida inmediatamente, negándose a generar el `commitmentC` y los demás datos necesarios para la participación en la blockchain, haciendo que todo el esfuerzo del participante tramposo sea en vano.

---
## Implicaciones del Modelo

Este sistema de señuelos obliga al participante a aplicar las reglas de forma honesta, ya que la única manera de evitar ser detectado sería desofuscar por completo la lógica interna del `game-service` para identificar cuál de las 21 instancias es el solver real y cuál es el canario, una tarea que debería ser computacionalmente inviable.

Este mecanismo de seguridad se vuelve aún más robusto cuando se combina con un modelo de **pago por intento**. Si cada intento de jugar (y por tanto de hacer trampas) tiene un costo, el riesgo económico para el tramposo aumenta considerablemente, desincentivando aún más cualquier ataque al sistema.