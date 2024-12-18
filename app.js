const express = require('express');
const app = express();

// socket.io setup
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

const port = 3000;

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + 'public/index.html');
});

app.get('/room/:id', (req, res) => {
    res.sendFile(__dirname + '/public/room.html');
});

const rooms = {};
const players = {};
const gameTime = 2;

const votingRound = (roomID) => {
    const votingIndex = rooms[roomID].votingIndex;
    const submissions = rooms[roomID].players.map(id => [id, players[id].submission[votingIndex]]).filter(([_, submission]) => submission).sort(() => Math.random() - 0.5);

    // get defintion from https://api.dictionaryapi.dev/api/v2/entries/en/<word>
    let [word, pos] = rooms[roomID].words[votingIndex];
    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`)
        .then(res => res.json())
        .then(data => {
            let definitions = [];
            try {
                data.forEach(entry => {
                    const meaning = entry.meanings.find(group => group.partOfSpeech === pos);
                    if (meaning) definitions.push(...meaning.definitions);
                });
            } catch (e) {
                definitions = [{ definition: 'No definition found' }];
            }
            if (definitions.length === 0) definitions = [{ definition: 'No definition found' }];

            rooms[roomID].voting = { submissions, definitions, word, pos, results: Array(submissions.length).fill([0, 0]) };
            rooms[roomID].players.forEach(id => rooms[roomID].votingMatrix[id] = Array(submissions.length).fill(0));
            io.to(roomID).emit('voting round', rooms[roomID].voting);
            rooms[roomID].state = 'voting';
        });
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

io.on('connection', (socket) => {
    console.log('a user connected');

    socket.on('join room', ({ roomID, playerName }) => {
        console.log(`user ${socket.id} joined room ${roomID}`);
        console.log(playerName);
        if (!rooms[roomID]) rooms[roomID] = {
            players: [],
            words: [],
            state: 'lobby',
            lastStart: 0,
            voting: {},
            votingIndex: 0,
            votingMatrix: {}
        };
        if (!players[socket.id]) {
            players[socket.id] = { 
                room: roomID,
                name: playerName,
                submission: [],
                score: 0
            };
        } else { // update player name
            players[socket.id].name = playerName;
            io.to(roomID).emit('update lobby', { hostID: rooms[roomID].players[0], players: rooms[roomID].players.map(id => [players[id].name, players[id].score]) });
            return;
        }

        socket.join(roomID);

        rooms[roomID].players.push(socket.id);
        
        io.to(roomID).emit('update lobby', { hostID: rooms[roomID].players[0], players: rooms[roomID].players.map(id => [players[id].name, players[id].score]) });

        socket.on('start game', () => {
            const isHost = rooms[roomID].players[0] === socket.id;
            if (!isHost || rooms[roomID].state !== 'lobby') return;
            rooms[roomID].state = 'game';
            rooms[roomID].lastStart = Date.now();

            // get 3 nouns and 3 adjectives, add the word, pos pair to the words array in the room
            const apiURL = 'https://random-word-form.herokuapp.com/random';
            fetch(`${apiURL}/noun?count=3`)
                .then(res => res.json())
                .then(data => {
                    rooms[roomID].words.push(...data.map(word => [word, 'noun']));
                    return fetch(`${apiURL}/adjective?count=3`);
                })
                .then(res => res.json())
                .then(data => {
                    rooms[roomID].words.push(...data.map(word => [word, 'adjective']));
                    rooms[roomID].words = rooms[roomID].words.sort(() => Math.random() - 0.5); // shuffle the words
                    io.to(roomID).emit('game started', { words: rooms[roomID].words, time: gameTime });
                });
            
            setTimeout(() => {
                votingRound(roomID);
            }, gameTime * 1000 + 1000);
        });

        if (rooms[roomID].state === 'game') {
            const timeLeft = gameTime - Math.ceil((Date.now() - rooms[roomID].lastStart) / 1000);
            io.to(socket.id).emit('game started', { words: rooms[roomID].words, time: timeLeft });
        }

        socket.on('submit words', ({ input }) => {
            if (rooms[roomID].state !== 'game') return;
            players[socket.id].submission = input;
        });

        if (rooms[roomID].state === 'voting') {
            rooms[roomID].votingMatrix[socket.id] = Array(rooms[roomID].voting.submissions.length).fill(0);
            io.to(socket.id).emit('voting round', rooms[roomID].voting);
        }

        socket.on('vote', ({ index, vote }) => {
            if (rooms[roomID].state !== 'voting') return;
            if (rooms[roomID].voting.submissions[index][0] === socket.id) return; // cannot vote for yourself

            rooms[roomID].votingMatrix[socket.id][index] = Math.sign(vote);
            calculateVotingResults(roomID);

            io.to(roomID).emit('update votes', rooms[roomID].voting.results);
        });

        socket.on('next round', () => {
            const isHost = rooms[roomID].players[0] === socket.id;
            if (!isHost || rooms[roomID].state !== 'voting') return;

            rooms[roomID].voting.results.forEach(([plus, total], i) => {
                if (total !== 0 && plus >= total / 2)
                    players[rooms[roomID].voting.submissions[i][0]].score++;
            });

            rooms[roomID].votingIndex++;
            if (rooms[roomID].votingIndex === rooms[roomID].words.length) {
                restart(roomID);
            } else votingRound(roomID);
        });
    });

    socket.on('disconnect', () => {
        console.log('user disconnected');
        if (!players[socket.id]) return;
        const roomID = players[socket.id].room;
        delete players[socket.id];
        rooms[roomID].players = rooms[roomID].players.filter(id => id !== socket.id);
        delete rooms[roomID].votingMatrix[socket.id];

        if (rooms[roomID].players.length > 0)
            io.to(roomID).emit('update lobby', { hostID: rooms[roomID].players[0], players: rooms[roomID].players.map(id => [players[id].name, players[id].score]) });
        else delete rooms[roomID];
    });
});

server.listen(port, () => {
    console.log(`listening on *:${port}`);
});