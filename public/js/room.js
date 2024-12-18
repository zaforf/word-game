var socket = io();

let playerName = localStorage.getItem('playerName');
while (!playerName || !/^[a-zA-Z0-9]+$/.test(playerName)) {
    playerName = prompt('Enter your name:');
    localStorage.setItem('playerName', playerName);
}

const roomID = window.location.pathname.split('/')[2];
document.querySelector('h1').innerText = 'congrats! you are in room: ' + roomID;
socket.emit('join room', { roomID, playerName });
let isHost = false;

document.getElementById('change name').addEventListener('click', () => {
    do playerName = prompt('Enter your name:');
    while (!/^[a-zA-Z0-9]*$/.test(playerName));
    if (!playerName) {
        playerName = localStorage.getItem('playerName');
        return;
    }
    localStorage.setItem('playerName', playerName);
    socket.emit('join room', { roomID, playerName });
});

socket.on('update lobby', ({ hostID, players }) => {
    isHost = socket.id === hostID;
    if (isHost) { // check if the player is the host
        document.getElementById('status').innerText = 'You are the host';
        document.getElementById('start').disabled = false;
        document.getElementById('next round').disabled = false;
    } else
        document.getElementById('status').innerText = 'Waiting for host to start the game';

    const playerList = document.getElementById('players');
    playerList.innerHTML = '';
    // first person should have (host) next to their name
    players[0][0] += ' (host)';
    // display the list of players sorted by score
    players.sort((a, b) => b[1] - a[1]).forEach(([name, score]) => {
        const li = document.createElement('li');
        li.innerText = name + ': ' + score;
        li.style.fontSize = '20px';
        playerList.appendChild(li);
    });
});

document.getElementById('start').addEventListener('click', () => {
    socket.emit('start game');
});

const format = (time) => {
    let minutes = Math.floor(time / 60);
    let seconds = time % 60;
    return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
}

socket.on('game started', ({ words, time }) => {
    document.getElementById('game').style.display = 'block';
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('voting').style.display = 'none';
        
    const timer = document.getElementById('timer');
    timer.innerText = format(time);
    let interval = setInterval(() => {
        time--;
        timer.innerText = format(time);
        if (time === 0) {
            timer.innerText = '0:00';
            clearInterval(interval);
            socket.emit('submit words', { input: Array.from(document.querySelectorAll('input')).map(input => input.value) });
        }
    }, 1000);

    document.getElementById('inputs').innerHTML = '';
    words.forEach(([word, pos]) => {
        const div = document.createElement('div');
        div.innerText = word + ' (' + pos + ')';
        div.style.fontSize = '20px';
        const input = document.createElement('input');
        input.type = 'text';
        input.style.width = '1000px';
        input.style.marginLeft = '10px';
        input.style.fontSize = '20px';
        div.appendChild(input);
        document.getElementById('inputs').appendChild(div);
    });
});

socket.on('voting round', ({ submissions, definitions, word, pos, results }) => {
    document.getElementById('game').style.display = 'none';
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('voting').style.display = 'block';
    document.getElementById('next round').disabled = !isHost;

    document.getElementById('word').innerText = word + ' (' + pos + ')';

    const list = document.getElementById('submissions');
    list.innerHTML = '';
    submissions.forEach(([player, submission], index) => {
        const li = document.createElement('li');
        li.innerText = submission;
        li.style.fontSize = '20px';

        const fraction = document.createElement('span');
        const [plus, total] = results[index];
        fraction.innerText = plus + ' / ' + total;
        fraction.style.marginRight = '10px';

        if (total !== 0 && plus >= total / 2) li.style.backgroundColor = 'lightgreen';

        const up = document.createElement('button');
        if (player === socket.id) up.disabled = true;
        up.innerText = '🔼';
        up.style.marginRight = '10px';
        up.addEventListener('click', () => {
            // if clicked previously, remove the vote
            let vote = 0;
            if (up.style.backgroundColor === 'lightgreen')
                up.style.backgroundColor = '';
            else {
                up.style.backgroundColor = 'lightgreen';
                down.style.backgroundColor = '';
                vote = 1;
            }
            socket.emit('vote', { index, vote });
        });
        const down = document.createElement('button');
        if (player === socket.id) down.disabled = true;
        down.innerText = '🔽';
        down.style.marginRight = '10px';
        down.addEventListener('click', () => {
            let vote = 0;
            if (down.style.backgroundColor === 'red')
                down.style.backgroundColor = '';
            else {
                down.style.backgroundColor = 'red';
                up.style.backgroundColor = '';
                vote = -1;
            }
            socket.emit('vote', { index, vote });
        });

        li.insertBefore(fraction, li.firstChild);
        li.insertBefore(up, fraction.nextSibling);
        li.insertBefore(down, up.nextSibling);
        list.appendChild(li);
    });

    const defList = document.getElementById('definitions');
    defList.innerHTML = '';
    definitions.forEach(definition => {
        const li = document.createElement('li');
        li.innerText = definition;
        li.style.fontSize = '20px';
        defList.appendChild(li);
    });
});

socket.on('update votes', (results) => {
    const list = document.getElementById('submissions');
    Array.from(list.children).forEach((li, i) => {
        const [plus, total] = results[i];
        li.children[0].innerText = plus + ' / ' + total;
        if (total !== 0 && plus >= total / 2) li.style.backgroundColor = 'lightgreen';
        else li.style.backgroundColor = '';
    });
});

document.getElementById('next round').addEventListener('click', () => {
    socket.emit('next round');
});

socket.on('game ended', () => {
    document.getElementById('game').style.display = 'none';
    document.getElementById('lobby').style.display = 'block';
    document.getElementById('voting').style.display = 'none';
});