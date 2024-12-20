var socket = io();

let isHost = false;
let playerName = localStorage.getItem('playerName');
while (!playerName || !/^[a-zA-Z0-9]+$/.test(playerName)) {
    playerName = prompt('Enter your name:');
    localStorage.setItem('playerName', playerName);
}

const roomID = window.location.pathname.split('/')[2];
// wait for the server to send the userID before joining the room
socket.on('session', (userID) => {
    socket.userID = userID;
    socket.emit('join room', { roomID, playerName });
});

document.getElementById('change name').addEventListener('click', () => {
    do playerName = prompt('Enter your new name:');
    while (!/^[a-zA-Z0-9]*$/.test(playerName));
    if (!playerName) {
        playerName = localStorage.getItem('playerName');
        return;
    }
    localStorage.setItem('playerName', playerName);
    console.log('name changed to ' + playerName);
    socket.emit('join room', { roomID, playerName });
});

document.getElementById('change room').addEventListener('click', () => {
    newRoomID = prompt('Enter new room:');
    window.location.href = `/room/${newRoomID}`;
});

socket.on('update lobby', ({ hostID, players }) => {
    isHost = socket.userID === hostID;
    if (isHost) {
        document.getElementById('status').innerText = 'You are the host';
        document.getElementById('start').disabled = false;
        document.getElementById('next round').disabled = false;
    } else {
        document.getElementById('status').innerText = 'Waiting for host to start the game';
    }

    const playerList = document.getElementById('players');
    playerList.innerHTML = '';
    
    // Add "(host)" next to the first player's name
    players[0][0] += ' (host)';
    
    // Display sorted list of players by score
    players.sort((a, b) => b[1] - a[1]).forEach(([name, score]) => {
        const li = document.createElement('li');
        li.innerText = `${name}: ${score}`;
        li.classList.add('player-item'); // Use CSS class for consistent styling
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
};

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
            socket.emit('submit words', { input: Array.from(document.querySelectorAll('.word-input')).map(input => input.value) });
        }
    }, 1000);

    const inputsContainer = document.getElementById('inputs');
    inputsContainer.innerHTML = '';
    
    words.forEach(([word, pos]) => {
        const div = document.createElement('div');
        div.classList.add('word-input-container'); // Use CSS for consistent styling
        div.innerText = `${word} (${pos})`;

        const input = document.createElement('input');
        input.type = 'text';
        input.classList.add('word-input'); // Styled via CSS
        div.appendChild(input);

        inputsContainer.appendChild(div);
    });
});

socket.on('voting round', ({ submissions, definitions, word, pos, results }) => {
    document.getElementById('game').style.display = 'none';
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('voting').style.display = 'block';
    
    document.getElementById('next round').disabled = !isHost;
    
    document.getElementById('word').innerText = `${word} (${pos})`;

    const submissionsList = document.getElementById('submissions');
    submissionsList.innerHTML = '';

    submissions.forEach(([player, submission], index) => {
        const li = document.createElement('li');
        li.classList.add('submission-item'); // Use CSS for consistent styling

        // Create span for results (e.g., "3 / 5")
        const fractionSpan = document.createElement('span');
        const [plus, total] = results[index];
        fractionSpan.innerText = `${plus} / ${total}`;
        
        // Create div for submission text
        const submissionText = document.createElement('div');
        submissionText.innerText = submission;

        // Create upvote button
        const up = document.createElement('button');
        up.classList.add('upvote-button');
        up.innerText = '▲';
        
        up.addEventListener('click', () => {
            let vote = 0;
            if (up.classList.contains('active')) {
                up.classList.remove('active');
            } else {
                up.classList.add('active');
                down.classList.remove('active');
                vote = 1;
            }
            socket.emit('vote', { index, vote });
        });

        // Create downvote button
        const down = document.createElement('button');
        down.classList.add('downvote-button');
        down.innerText = '▼';
        
        down.addEventListener('click', () => {
            let vote = 0;
            if (down.classList.contains('active')) {
                down.classList.remove('active');
            } else {
                down.classList.add('active');
                up.classList.remove('active');
                vote = -1;
            }
            socket.emit('vote', { index, vote });
        });

        // Append elements to list item
        li.appendChild(fractionSpan); // Results on the left
        li.appendChild(submissionText); // Text in the middle
        if (player === socket.userID) {
            li.classList.add('highlight-self');
        } else {
            li.appendChild(up); // Upvote button on the right
            li.appendChild(down); // Downvote button on the right
        }

        if (total !== 0 && plus >= total / 2) li.classList.add('highlight-success');
        else li.classList.remove('highlight-success');
        submissionsList.appendChild(li);
    });


    const definitionsList = document.getElementById('definitions');
    definitionsList.innerHTML = '';
    
    definitions.forEach(definition => {
        const li = document.createElement('li');
        li.classList.add('definition-item'); // Use CSS for consistent styling
        li.innerText = definition;
        
        definitionsList.appendChild(li);
    });
});

socket.on('update votes', (results) => {
    const listItems = Array.from(document.getElementById('submissions').children);
    
    listItems.forEach((li, i) => {
        const [plus, total] = results[i];
        
        li.querySelector(':scope > span').innerText = `${plus} / ${total}`;
        
        if (total !== 0 && plus >= total / 2) li.classList.add('highlight-success');
        else li.classList.remove('highlight-success');
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

const input = document.getElementById('chat-input');
const sendButton = document.getElementById('send-message');

const sendMessage = () => {
    if (!input.value) return;
    socket.emit('chat message', input.value);
    input.value = '';
};
input.addEventListener('keypress', (e) => e.key === 'Enter' && sendMessage());
sendButton.addEventListener('click', sendMessage);

const chatMessages = document.getElementById('chat-messages');

socket.on('chat message', ({ name, msg, special }) => {
    const li = document.createElement('li');
    if (special) {
        li.classList.add('special');
        li.innerText = msg;
    } else li.innerText = `${name}: ${msg}`;
    li.classList.add('chat-message');
    document.getElementById('chat-messages').appendChild(li);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});