// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GoPSatellite
 * @author Game of Prompts Team
 * @notice Este es un contrato "satélite" para el ecosistema Game of Prompts (GoP).
 * Permite a los usuarios de cadenas EVM participar en un juego cuya lógica principal y
 * resolución global ocurren en la blockchain de Ergo.
 *
 * FUNCIONAMIENTO:
 * 1.  **Creación:** Un creador de juegos despliega este contrato con los parámetros del juego:
 * tarifa, fecha límite, y una lista de direcciones de "jueces" de confianza.
 * 2.  **Participación:** Los jugadores envían la tarifa de participación y sus datos
 * (commitment, IDs, etc.), que quedan registrados en este contrato. Los fondos se
 * acumulan en el propio contrato.
 * 3.  **Resolución (por Jueces):** Tras la fecha límite, los jueces observan la resolución
 * global en Ergo. Luego, un juez llama a la función `resolveGame` en este contrato,
 * indicando la dirección del ganador. El contrato verifica que quien llama es un juez
 * y transfiere el bote completo al ganador.
 * 4.  **Cancelación y Reembolsos:** Si el juego se cancela (acción iniciada por un juez),
 * el estado del contrato cambia a "Cancelado", y cada participante puede reclamar
 * el reembolso de su tarifa.
 * 5.  **Periodo de Gracia:** Si los jueces no resuelven el juego tras un tiempo prudencial
 * (periodo de gracia), los participantes pueden recuperar sus fondos como medida de seguridad.
 */
contract GoPSatellite {
    // =================================================================
    // === ESTRUCTURAS Y ENUMS
    // =================================================================

    // Mapeo de los registros del contrato de Ergo a una estructura de Solidity.
    struct Participation {
        address playerAddress;
        bytes32 commitmentC;         // Equivalente a R5 en Ergo
        bytes32 solverId;            // Equivalente a R7 en Ergo
        bytes32 hashLogs;            // Equivalente a R8 en Ergo
        uint256[] scoreList;         // Equivalente a R9 en Ergo
        bool isParticipating;        // Para evitar registros duplicados
    }

    enum GameStatus { Open, Resolved, Cancelled }

    // =================================================================
    // === VARIABLES DE ESTADO
    // =================================================================

    // --- Parámetros Inmutables del Juego ---
    bytes32 public immutable gameNftId;         // ID del juego en Ergo (R6)
    uint256 public immutable participationFee;  // Tarifa para participar (SELF.value)
    uint256 public immutable deadline;          // Fecha límite en formato UNIX timestamp
    uint256 public immutable gracePeriod;       // Tiempo extra tras el deadline para que los jugadores reclamen si no hay resolución
    address public immutable creator;           // Dirección del creador en esta cadena

    // --- Estado Dinámico del Juego ---
    mapping(address => Participation) public participations;
    address[] public participantAddresses;
    mapping(address => bool) public judges;
    GameStatus public gameStatus;
    address public winner;

    // =================================================================
    // === EVENTOS
    // =================================================================

    event GameCreated(bytes32 indexed gameNftId, uint256 participationFee, uint256 deadline);
    event ParticipationSubmitted(address indexed player, bytes32 indexed commitmentC);
    event GameResolved(address indexed winner, uint256 prizeAmount);
    event GameCancelled();
    event RefundClaimed(address indexed player, uint256 amount);

    // =================================================================
    // === MODIFICADORES
    // =================================================================

    modifier onlyJudge() {
        require(judges[msg.sender], "GoP: Caller is not a judge");
        _;
    }

    modifier gameIsOpen() {
        require(gameStatus == GameStatus.Open, "GoP: Game is not open");
        _;
    }

    modifier afterDeadline() {
        require(block.timestamp >= deadline, "GoP: Deadline has not passed");
        _;
    }

    // =================================================================
    // === CONSTRUCTOR
    // =================================================================

    constructor(
        bytes32 _gameNftId,
        uint256 _participationFee,
        uint256 _deadline,
        uint256 _gracePeriod,
        address[] memory _judges
    ) {
        require(_participationFee > 0, "GoP: Fee must be positive");
        require(_deadline > block.timestamp, "GoP: Deadline must be in the future");
        require(_judges.length > 0, "GoP: Must have at least one judge");

        gameNftId = _gameNftId;
        participationFee = _participationFee;
        deadline = _deadline;
        gracePeriod = _gracePeriod;
        creator = msg.sender;

        for (uint i = 0; i < _judges.length; i++) {
            require(_judges[i] != address(0), "GoP: Invalid judge address");
            judges[_judges[i]] = true;
        }

        gameStatus = GameStatus.Open;
        emit GameCreated(_gameNftId, _participationFee, _deadline);
    }

    // =================================================================
    // === FUNCIONES PRINCIPALES
    // =================================================================

    /**
     * @notice Permite a un jugador registrarse en el juego.
     * @dev El jugador debe enviar la cantidad exacta de la tarifa de participación.
     * @param _commitmentC Commitment criptográfico con la puntuación.
     * @param _solverId ID del servicio solver del jugador.
     * @param _hashLogs Hash de los logs del juego.
     * @param _scoreList Lista de puntuaciones para ofuscar la real.
     */
    function participate(
        bytes32 _commitmentC,
        bytes32 _solverId,
        bytes32 _hashLogs,
        uint256[] calldata _scoreList
    ) external payable gameIsOpen {
        require(block.timestamp < deadline, "GoP: Deadline has passed");
        require(msg.value == participationFee, "GoP: Incorrect participation fee");
        require(!participations[msg.sender].isParticipating, "GoP: Already participated");

        participations[msg.sender] = Participation({
            playerAddress: msg.sender,
            commitmentC: _commitmentC,
            solverId: _solverId,
            hashLogs: _hashLogs,
            scoreList: _scoreList,
            isParticipating: true
        });

        participantAddresses.push(msg.sender);
        emit ParticipationSubmitted(msg.sender, _commitmentC);
    }

    /**
     * @notice Un juez llama a esta función para finalizar el juego y pagar al ganador.
     * @dev Esta es la acción principal de resolución, equivalente a `spentInValidGameResolution`.
     * @param _winnerAddress La dirección del ganador global determinado en Ergo.
     */
    function resolveGame(address _winnerAddress) external onlyJudge afterDeadline gameIsOpen {
        require(_winnerAddress != address(0), "GoP: Invalid winner address");
        
        uint256 prizeAmount = address(this).balance;
        require(prizeAmount > 0, "GoP: No prize to distribute");

        gameStatus = GameStatus.Resolved;
        winner = _winnerAddress;

        // Transfiere todo el bote al ganador.
        (bool success, ) = payable(_winnerAddress).call{value: prizeAmount}("");
        require(success, "GoP: Prize transfer failed");

        emit GameResolved(_winnerAddress, prizeAmount);
    }

    /**
     * @notice Un juez puede cancelar el juego si algo sale mal (ej. secreto revelado).
     * @dev Equivalente a la transición causada por `spentInValidGameCancellation`.
     */
    function cancelGame() external onlyJudge gameIsOpen {
        gameStatus = GameStatus.Cancelled;
        emit GameCancelled();
    }

    /**
     * @notice Un participante reclama su reembolso si el juego fue cancelado.
     */
    function claimRefund() external {
        require(gameStatus == GameStatus.Cancelled, "GoP: Game is not cancelled");
        Participation storage p = participations[msg.sender];
        require(p.isParticipating, "GoP: You are not a participant");
        
        // Evita reentrada: marca como no participante antes de enviar fondos.
        p.isParticipating = false; 

        (bool success, ) = payable(msg.sender).call{value: participationFee}("");
        require(success, "GoP: Refund transfer failed");

        emit RefundClaimed(msg.sender, participationFee);
    }

    /**
     * @notice Si el juego no se resuelve tras un periodo de gracia, un participante puede recuperar su dinero.
     * @dev Equivalente a `playerReclaimsAfterGracePeriod`.
     */
    function reclaimAfterGracePeriod() external {
        require(gameStatus == GameStatus.Open, "GoP: Game is already resolved or cancelled");
        require(block.timestamp > deadline + gracePeriod, "GoP: Grace period has not ended");

        Participation storage p = participations[msg.sender];
        require(p.isParticipating, "GoP: You are not a participant");

        p.isParticipating = false;

        (bool success, ) = payable(msg.sender).call{value: participationFee}("");
        require(success, "GoP: Reclaim transfer failed");

        emit RefundClaimed(msg.sender, participationFee);
    }

    // =================================================================
    // === FUNCIONES DE VISTA (GETTERS)
    // =================================================================

    function getParticipantCount() external view returns (uint256) {
        return participantAddresses.length;
    }

    function getParticipation(address _player) external view returns (Participation memory) {
        return participations[_player];
    }

    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}