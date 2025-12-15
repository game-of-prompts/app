# Game of Prompts (GoP)

## Especificación Formal del Protocolo

---

## 1. Propósito del documento

Este documento define formalmente el **protocolo Game of Prompts (GoP)** desde el punto de vista **on-chain**, especificando:

* El **estado global del juego**,
* Las **entidades económicas fundamentales**,
* Las **reglas de transición implícitas**,
* Y, de forma central, los **derechos de gasto de las Participation Boxes**, que constituyen la verdadera lógica de control del sistema.

La especificación adopta explícitamente el **modelo UTXO de Ergo**, donde:

> El comportamiento del sistema emerge de qué cajas pueden gastarse, cuándo y por quién,
> no de una máquina de estados centralizada.

---

## 2. Entidades fundamentales

### 2.1 Main Game Box

La **Main Game Box** representa el estado canónico del juego. Es una caja on-chain única que contiene:

* Un NFT identificador del juego (`gameNftId`)
* El estado global del juego (`R4`)
* Parámetros temporales críticos (deadlines)
* Compromisos criptográficos (hash del secreto)
* Direcciones clave (creador, resolver)

La Main Game Box **no controla directamente a los jugadores**. Su función es publicar información verificable que otras cajas (participaciones) usan para autovalidarse.

---

### 2.2 Participation Box

Una **Participation Box** representa la participación económica de un jugador en el juego.

Contiene:

* Fondos bloqueados (stake / entry fee)
* Identidad del jugador (clave pública)
* Referencia al juego (`gameNftId`)
* Un `commitment` criptográfico del score (`R5`)

Cada Participation Box es **autónoma** y define explícitamente **todos sus caminos de gasto posibles**, condicionados exclusivamente por:

* El estado del Main Game Box
* El tiempo (`HEIGHT`)
* La identidad del firmante

No existe lógica implícita fuera del script.

---

## 3. Estados globales del juego

El estado global del juego está codificado en el registro `R4` de la Main Game Box.

| Valor `R4` | Estado                 |
| ---------: | ---------------------- |
|        `0` | **ACTIVE**             |
|        `1` | **RESOLUTION**         |
|        `2` | **CANCELLED_DRAINING** |

No existen otros estados válidos.

---

## 4. Estado 0 — ACTIVE

### 4.1 Definición

El juego está activo y aceptando participación, pero **no ha sido resuelto**.

Este estado incluye dos **fases temporales internas**, que no son estados on-chain:

* **Ceremony Phase**: el seed es renovable.
* **Playing Phase**: el seed es inmutable y se compite.

Estas fases se distinguen únicamente por condiciones temporales y reglas off-chain, nunca por `R4`.

---

### 4.2 Propiedades invariantes

Mientras `R4 == 0`:

* El secreto `S` **no debe ser público**.
* No existen scores verificables.
* Las Participation Boxes no pueden ser consumidas para premios.

---

### 4.3 Acción permitida: Rescate por Juego Atascado (Grace Period)

**Objetivo:** Proteger a los jugadores contra abandono del creador.

**Condiciones formales:**

* Existe una Main Game Box con:

  * `R4 == 0`
  * mismo `gameNftId`
* `HEIGHT > gameDeadline + GRACE_PERIOD_IN_BLOCKS`
* El gasto está firmado por el dueño de la Participation Box

**Efecto:**

* La Participation Box se gasta
* Los fondos regresan íntegramente al jugador

Esta acción define el **único escape legítimo** desde ACTIVE para una participación.

---

## 5. Estado 1 — RESOLUTION

### 5.1 Definición

El juego ha pasado a fase de resolución:

* El secreto `S` ha sido revelado
* Los scores son verificables
* No se aceptan nuevas participaciones

Este estado **no implica cierre inmediato**, sino un período explícito de validación y corrección.

---

### 5.2 Propiedades invariantes

Mientras `R4 == 1`:

* Existe un `resolutionDeadline`
* El resultado es **mutable** hasta dicho deadline
* Las Participation Boxes determinan el resultado final

---

### 5.3 Acción permitida: Invalidación de Participación Candidata

**Objetivo:** Eliminar resultados fraudulentos o inválidos.

**Condiciones formales:**

* `MainGameBox.R4 == 1`
* `HEIGHT < resolutionDeadline`
* El `commitment` de la Participation Box coincide con el candidato actual

**Ejecutor:**

* Jueces / backend / infraestructura autorizada

**Efecto:**

* La Participation Box candidata se consume
* Pierde cualquier derecho a premio
* El protocolo continúa evaluando otras participaciones

Esta acción **no resuelve el juego**, solo corrige el conjunto de candidatos.

---

### 5.4 Acción permitida: Finalización Normal del Juego

**Objetivo:** Cerrar el juego y distribuir premios.

**Condiciones formales:**

* `MainGameBox.R4 == 1`
* `HEIGHT >= resolutionDeadline`
* La Participation Box se gasta **junto con** la Main Game Box

**Ejecutor:**

* Protocolo / bot / flujo estándar

**Efecto:**

* Se distribuyen los fondos según las reglas
* Las Participation Boxes son consumidas
* El resultado queda económicamente cerrado

---

## 6. Estado 2 — CANCELLED_DRAINING

### 6.1 Definición

Estado punitivo alcanzable **exclusivamente desde ACTIVE**.

**Causa única:**

> El secreto `S`, que solo debía conocer el creador,
> es revelado prematuramente.

---

### 6.2 Propiedades invariantes

Mientras `R4 == 2`:

* El juego es inválido
* No existe ganador
* No existe resolución
* El creador pierde su stake

---

### 6.3 Drenaje progresivo del stake del creador

El stake del creador:

* No puede retirarse de golpe
* Solo puede drenarse **1/5 cada X bloques**

Esto introduce:

* Castigo prolongado
* Fricción económica
* Visibilidad pública del incumplimiento

---

### 6.4 Acción permitida: Reembolso por Cancelación

**Objetivo:** Proteger inmediatamente a los jugadores.

**Condiciones formales:**

* `MainGameBox.R4 == 2`
* El gasto está firmado por el dueño de la Participation Box

**Efecto:**

* Reembolso completo al jugador
* La Participation Box se auto-liquida

---

## 7. Principios de diseño del protocolo

1. **Estados mínimos, reglas ricas**
2. **Las cajas se autodefienden**
3. **El tiempo es parte del consenso**
4. **No existen disputas como estado**
5. **La irreversibilidad es explícita y tardía**

---

## 8. Interpretación final

Game of Prompts no es un juego en el sentido clásico.

Es un **protocolo de revelación controlada de información**, donde:

* Nadie puede ganar antes de tiempo
* Nadie puede bloquear indefinidamente a otros
* Ningún actor tiene poder absoluto

La verdad del juego no se declara:

> **emerge de qué cajas siguen siendo gastables.**
