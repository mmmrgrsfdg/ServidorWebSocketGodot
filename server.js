// ========================
// Servidor Multiplayer Simples para Godot
// Criado pelo Zee GameDev lindo de mãe
// Atualizado para 3D, Animações e Inventário
// ========================

const express = require("express");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 9090;
const server = app.listen(PORT, () => {
    console.log(`Servidor iniciado na porta: ${PORT}`);
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();

function generateRoomCode(length = 5) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

const playerlist = {
    players: [],
    getAll: function() { return this.players; },
    get: function(uuid) { return this.players.find(player => player.uuid === uuid); },
    
    add: function(uuid, roomCode) {
        const playersInRoom = this.getByRoom(roomCode);
        const isFirstPlayer = playersInRoom.length === 0;
        let player = {
            uuid,
            room: roomCode,
            x: isFirstPlayer ? 550 : 700,
            y: 300,
            z: 0,
            rot_y: 0
        };
        this.players.push(player);
        return player;
    },
    
    update: function(uuid, newX, newY, newZ, newRotY) {
        const player = this.get(uuid);
        if (player) {
            player.x = newX;
            player.y = newY;
            player.z = newZ;
            player.rot_y = newRotY;
        }
    },
    
    remove: function(uuid) {
        this.players = this.players.filter(player => player.uuid !== uuid);
    },
    
    getByRoom: function(roomCode) {
        return this.players.filter(player => player.room === roomCode);
    }
};

wss.on("connection", (socket) => {
    const uuid = uuidv4();
    socket.uuid = uuid;
    console.log(`Cliente conectado: ${uuid}`);

    socket.send(JSON.stringify({ 
        cmd: "joined_server", 
        content: { uuid: uuid } 
    }));

    socket.on("message", (message) => {
        let data;
        try { 
            data = JSON.parse(message.toString()); 
        } catch (err) { 
            console.error("Erro ao parsear mensagem:", err);
            return; 
        }

        switch (data.cmd) {
            case "create_room": {
                const newRoomId = generateRoomCode();
                socket.roomId = newRoomId;
                rooms.set(newRoomId, { players: {} });
                rooms.get(newRoomId).players[uuid] = socket;
                
                const newPlayer = playerlist.add(uuid, newRoomId);
                
                console.log(`Sala ${newRoomId} criada pelo jogador ${uuid}`);
                
                socket.send(JSON.stringify({ 
                    cmd: "room_created", 
                    content: { code: newRoomId } 
                }));
                
                socket.send(JSON.stringify({
                    cmd: "spawn_local_player",
                    content: { player: newPlayer }
                }));
                break;
            }
            
            case "join_room": {
                const roomCode = data.content.code.toUpperCase();
                const roomToJoin = rooms.get(roomCode);
                
                if (!roomToJoin) {
                    socket.send(JSON.stringify({ 
                        cmd: "error", 
                        content: { msg: "Sala não encontrada." } 
                    }));
                    return;
                }
                
                socket.roomId = roomCode;
                roomToJoin.players[uuid] = socket;
                
                const newPlayer = playerlist.add(uuid, socket.roomId);
                
                console.log(`Jogador ${uuid} entrou na sala ${socket.roomId}`);
                
                socket.send(JSON.stringify({ 
                    cmd: "room_joined", 
                    content: { code: socket.roomId } 
                }));
                
                socket.send(JSON.stringify({
                    cmd: "spawn_local_player",
                    content: { player: newPlayer }
                }));
                
                const roomPlayers = playerlist.getByRoom(socket.roomId)
                    .filter(p => p.uuid !== uuid);
                
                socket.send(JSON.stringify({
                    cmd: "spawn_network_players",
                    content: { players: roomPlayers }
                }));
                
                for (const clientUuid in roomToJoin.players) {
                    const client = roomToJoin.players[clientUuid];
                    if (client !== socket && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ 
                            cmd: "spawn_new_player", 
                            content: { player: newPlayer } 
                        }));
                    }
                }

                if (Object.keys(roomToJoin.players).length >= 2) {
                    console.log(`Sala ${socket.roomId} atingiu o número de jogadores. Começando o jogo!`);
                    for (const clientUuid in roomToJoin.players) {
                        const client = roomToJoin.players[clientUuid];
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                cmd: "start_game",
                                content: {}
                            }));
                        }
                    }
                }
                break;
            }
            
            case "position": {
                playerlist.update(
                    uuid, 
                    data.content.x, 
                    data.content.y, 
                    data.content.z, 
                    data.content.rot_y
                );
                
                const room = rooms.get(socket.roomId);
                if (room) {
                    for (const clientUuid in room.players) {
                        const client = room.players[clientUuid];
                        if (client !== socket && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                cmd: "update_position",
                                content: {
                                    uuid: uuid,
                                    x: data.content.x,
                                    y: data.content.y,
                                    z: data.content.z,
                                    rot_y: data.content.rot_y
                                }
                            }));
                        }
                    }
                }
                break;
            }

            case "update_anim": {
                const room = rooms.get(socket.roomId);
                if (room) {
                    for (const clientUuid in room.players) {
                        const client = room.players[clientUuid];
                        if (client !== socket && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                cmd: "update_anim",
                                content: {
                                    uuid: uuid,
                                    anim: data.content.anim
                                }
                            }));
                        }
                    }
                }
                break;
            }
            
            // ========================================
            // NOVO: Sistema de Inventário
            // ========================================
            case "pickup_item": {
                const room = rooms.get(socket.roomId);
                if (room) {
                    // Avisa todos na sala (بما فيهم الذي التقطه) أن العنصر قد تم التقاطه
                    for (const clientUuid in room.players) {
                        const client = room.players[clientUuid];
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                cmd: "item_picked",
                                content: {
                                    picker_uuid: uuid, // من الذي التقطه
                                    item_id: data.content.item_id, // كود العنصر
                                    item_name: data.content.item_name // اسم العنصر
                                }
                            }));
                        }
                    }
                }
                break;
            }

            case "chat": {
                const room = rooms.get(socket.roomId);
                if (room) {
                    for (const clientUuid in room.players) {
                        const client = room.players[clientUuid];
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                cmd: "new_chat_message",
                                content: {
                                    uuid: uuid,
                                    msg: data.content.msg
                                }
                            }));
                        }
                    }
                }
                break;
            }
        }
    });

    socket.on("close", () => {
        console.log(`Cliente desconectado: ${uuid}`);
        playerlist.remove(uuid);
        
        const room = rooms.get(socket.roomId);
        if (room) {
            delete room.players[uuid];
            
            for (const clientUuid in room.players) {
                const client = room.players[clientUuid];
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ 
                        cmd: "player_disconnected", 
                        content: { uuid: uuid } 
                    }));
                }
            }
            
            if (Object.keys(room.players).length === 0) {
                rooms.delete(socket.roomId);
                console.log(`Sala ${socket.roomId} vazia e removida.`);
            }
        }
    });
});
