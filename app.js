const express = require('express');
const app = express();
const session = require("express-session");
const sharedSession = require("express-socket.io-session");
const { v4: uuidv4 } = require('uuid');

// socket.io setup
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

const sessionMiddleware = session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true
});

const port = 3000;

app.use(express.static('public'));
app.use(sessionMiddleware);
app.use((req, res, next) => {
    if (!req.session.userID) req.session.userID = uuidv4();
    next();
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + 'public/index.html');
});

app.get('/room/:id', (req, res) => {
    res.sendFile(__dirname + '/public/room.html');
});

const rooms = {};
const players = {};
const posMap = {
    'n': 'noun',
    'v': 'verb',
    'adj': 'adjective',
    'adv': 'adverb'
};

let gameTime = 20;
let numWords = 6;
let frequencyCutOff = 0.1;

const votingRound = (roomID) => {
    const votingIndex = rooms[roomID].votingIndex;
    const submissions = rooms[roomID].players.map(id => [id, players[id].submission[votingIndex]]).filter(([_, submission]) => submission).sort(() => Math.random() - 0.5);
    const [word, pos, definitions] = rooms[roomID].words[votingIndex];

    rooms[roomID].voting = { submissions, definitions, word, pos, results: Array(submissions.length).fill([0, 0]) };
    rooms[roomID].players.forEach(id => rooms[roomID].votingMatrix[id] = Array(submissions.length).fill(0));
    io.to(roomID).emit('voting round', rooms[roomID].voting);
    rooms[roomID].state = 'voting';
};

const restart = (roomID) => {
    rooms[roomID].state = 'lobby';
    rooms[roomID].words = [];
    rooms[roomID].votingIndex = 0;
    io.to(roomID).emit('game ended');
    io.to(roomID).emit('update lobby', { hostID: rooms[roomID].players[0], players: rooms[roomID].players.map(id => [players[id].name, players[id].score]) });
};

const calculateVotingResults = (roomID) => {
    const numSubmissions = rooms[roomID].voting.submissions.length;
    // array of 2-tuples, [plus votes, total votes]
    const results = Array(numSubmissions).fill().map(() => [0, 0]);
    rooms[roomID].players.forEach(id => {
        rooms[roomID].votingMatrix[id].forEach((vote, i) => {
            results[i][0] += Math.max(0, vote);
            results[i][1] += Math.abs(vote);
        });
    });
    rooms[roomID].voting.results = results;
};

io.use(sharedSession(sessionMiddleware));

io.on('connection', (socket) => {
    console.log('a user connected');
    socket.emit('session', socket.handshake.session.userID);

    socket.on('join room', ({ roomID, playerName }) => {
        const userID = socket.handshake.session.userID;
        if (!rooms[roomID]) rooms[roomID] = {
            players: [],
            words: [],
            state: 'lobby',
            lastStart: 0,
            voting: {},
            votingIndex: 0,
            votingMatrix: {}
        };
        if (!players[userID]) {
            players[userID] = { 
                room: roomID,
                name: playerName,
                submission: [],
                score: 0
            };
            rooms[roomID].players.push(userID);
            io.to(roomID).emit('chat message', { name: 'Server', msg: `${playerName} joined the room`, special: true });
        } else if (players[userID].name !== playerName) {
            io.to(roomID).emit('chat message', { name: 'Server', msg: `${players[userID].name} changed their name to ${playerName}`, special: true });
            players[userID].name = playerName;
            io.to(roomID).emit('update lobby', { hostID: rooms[roomID].players[0], players: rooms[roomID].players.map(id => [players[id].name, players[id].score]) });
            return;
        }

        socket.join(roomID);
        socket.join(userID);
        io.to(roomID).emit('update lobby', { hostID: rooms[roomID].players[0], players: rooms[roomID].players.map(id => [players[id].name, players[id].score]) });

        socket.on('start game', () => {
            const isHost = rooms[roomID].players[0] === userID;
            if (!isHost || rooms[roomID].state !== 'lobby') return;
            rooms[roomID].state = 'game';
            rooms[roomID].lastStart = Date.now();

            // get numWords random words from the API
            const randomWordsAPI = 'https://random-word-api.herokuapp.com/word?number=10';
            const dictionaryAPI = (word) => `https://api.datamuse.com/words?sp=${word}&md=pdf&max=1`;

            const processWord = (word) => {
                return fetch(dictionaryAPI(word))
                    .then(res => res.json())
                    .then(data => {
                        if (data.length === 0) return;
                        data = data[0];
                        if (data.word !== word) return; // word not found
                        const freq = data.tags.find(tag => tag.startsWith('f:')).split(':')[1];
                        if (freq < frequencyCutOff) return; // word is too rare
                        if (data.defs === undefined) return; // no definitions found
                        const definitions = data.defs.map(def => def.split('\t')).filter(def => def[0] !== 'u');
                        if (definitions.length === 0) return; // no definitions found
                        const pos = definitions[Math.floor(Math.random() * definitions.length)][0];
                        rooms[roomID].words.push([word, posMap[pos], definitions.filter(def => def[0] === pos).map(def => def[1])]);
                    });
            };

            const getFilteredWords = async () => {
                while (rooms[roomID].words.length < numWords) {
                    const data = await (await fetch(randomWordsAPI)).json();
                    for (const word of data) {
                        if (rooms[roomID].words.length >= numWords) break;
                        await processWord(word);
                    }
                };
            };
            
            getFilteredWords().then(() => {
                io.to(roomID).emit('game started', { words: rooms[roomID].words.map(([word, pos, defs]) => [word, pos]), time: gameTime });
                setTimeout(() => votingRound(roomID), gameTime * 1000 + 1000);
            });
        });

        if (rooms[roomID].state === 'game') {
            const timeLeft = gameTime - Math.ceil((Date.now() - rooms[roomID].lastStart) / 1000);
            io.to(userID).emit('game started', { words: rooms[roomID].words.map(([word, pos, defs]) => [word, pos]), time: timeLeft });
        }

        socket.on('submit words', ({ input }) => {
            if (rooms[roomID].state !== 'game') return;
            players[userID].submission = input;
        });

        if (rooms[roomID].state === 'voting') {
            rooms[roomID].votingMatrix[userID] = Array(rooms[roomID].voting.submissions.length).fill(0);
            io.to(userID).emit('voting round', rooms[roomID].voting);
        }

        socket.on('vote', ({ index, vote }) => {
            if (rooms[roomID].state !== 'voting') return;
            if (rooms[roomID].voting.submissions[index][0] === userID) return; // cannot vote for yourself

            rooms[roomID].votingMatrix[userID][index] = Math.sign(vote);
            calculateVotingResults(roomID);

            io.to(roomID).emit('update votes', rooms[roomID].voting.results);
        });

        socket.on('next round', () => {
            const isHost = rooms[roomID].players[0] === userID;
            if (!isHost || rooms[roomID].state !== 'voting') return;

            rooms[roomID].voting.results.forEach(([plus, total], i) => {
                if (!players[rooms[roomID].voting.submissions[i][0]])
                    return; // player left
                if (total !== 0 && plus >= total / 2)
                    players[rooms[roomID].voting.submissions[i][0]].score++;
            });

            rooms[roomID].votingIndex++;
            if (rooms[roomID].votingIndex === rooms[roomID].words.length) {
                restart(roomID);
            } else votingRound(roomID);
        });

        socket.on('chat message', (msg) => {
            io.to(roomID).emit('chat message', { name: players[userID].name, msg, special: false });
        });
    });

    socket.on('disconnect', () => {
        console.log('user disconnected');
        const userID = socket.handshake.session.userID;
        const userCount = io.sockets.adapter.rooms.get(userID)?.size || 0;
        if (userCount > 0 || !players[userID]) return;

        const roomID = players[userID].room;
        delete players[userID];
        rooms[roomID].players = rooms[roomID].players.filter(id => id !== userID);
        delete rooms[roomID].votingMatrix[userID];

        if (rooms[roomID].players.length > 0)
            io.to(roomID).emit('update lobby', { hostID: rooms[roomID].players[0], players: rooms[roomID].players.map(id => [players[id].name, players[id].score]) });
        else delete rooms[roomID];
    });
});

server.listen(port, () => {
    console.log(`listening on *:${port}`);
});