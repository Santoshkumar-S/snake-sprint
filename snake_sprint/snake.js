// Game Configuration
const CONFIG = {
  GRID_SIZE: 20,
  INITIAL_SPEED: 150,
  SPEED_INCREASE: 10,
  POINTS_PER_LEVEL: 5,
  MIN_SPEED: 50,
  SWIPE_THRESHOLD: 30
};

// Game States
const GAME_STATE = {
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAME_OVER: 'game_over',
  READY: 'ready'
};

// Direction Constants
const DIRECTION = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 }
};

class SoundManager {
  constructor() {
    this.enabled = true;
    this.audioContext = null;
    this.backgroundNode = null;
  }

  ensureContext() {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    // When disabling, ensure background stops; when enabling, do not auto-start.
    if (!this.enabled) {
      this.stopBackground();
    }
    return this.enabled;
  }

  // Simple synth tone
  playTone(frequency = 440, durationMs = 120, type = 'sine', gainValue = 0.06) {
    if (!this.enabled) return;
    this.ensureContext();
    const ctx = this.audioContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.value = gainValue;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
  }

  // Eat sound: short blip with slight pitch up
  playEat() {
    this.playTone(520 + Math.random() * 40, 80, 'square', 0.07);
  }

  // Level up: quick arpeggio
  playLevelUp() {
    if (!this.enabled) return;
    this.ensureContext();
    const notes = [523, 659, 784];
    notes.forEach((f, i) => setTimeout(() => this.playTone(f, 120, 'triangle', 0.07), i * 110));
  }

  // Game over: descending tone
  playGameOver() {
    if (!this.enabled) return;
    this.ensureContext();
    const ctx = this.audioContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    gain.gain.value = 0.06;
    osc.connect(gain).connect(ctx.destination);
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.6);
    osc.start();
    osc.stop(ctx.currentTime + 0.65);
  }

  // Background loop: soft low tone pulsing
  playBackground() {
    if (!this.enabled) return;
    this.ensureContext();
    if (this.backgroundNode) return;
    const ctx = this.audioContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 110;
    gain.gain.value = 0.02;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    this.backgroundNode = { osc, gain };
  }

  stopBackground() {
    if (!this.backgroundNode) return;
    this.backgroundNode.osc.stop();
    this.backgroundNode = null;
  }
}

class SnakeGame {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.tileCount = this.canvas.width / CONFIG.GRID_SIZE;
    
    // UI Elements
    this.scoreEl = document.getElementById('score');
    this.levelEl = document.getElementById('level');
    this.speedEl = document.getElementById('speed');
    this.highScoreEl = document.getElementById('high-score');
    this.overlayEl = document.getElementById('game-overlay');
    this.overlayTitle = document.getElementById('overlay-title');
    this.overlayMessage = document.getElementById('overlay-message');
    
    // Control buttons
    this.pauseBtn = document.getElementById('pause-btn');
    this.newGameBtn = document.getElementById('new-game-btn');
    // Navigation (D-pad) buttons
    this.upBtn = document.getElementById('up');
    this.downBtn = document.getElementById('down');
    this.leftBtn = document.getElementById('left');
    this.rightBtn = document.getElementById('right');
    
    // Sound
    this.sound = new SoundManager();
    
    // Game State
    this.state = GAME_STATE.READY;
    this.snake = [];
    this.velocity = { x: 0, y: 0 };
    this.food = {};
    this.score = 0;
    this.level = 1;
    this.speed = CONFIG.INITIAL_SPEED;
    this.moveLock = false;
    this.gameLoop = null;
    this.highScore = this.getHighScore();
    
    // Touch controls
    this.touchStart = { x: null, y: null };
    
    this.init();
  }
  
  init() {
    this.setupEventListeners();
    this.resetGame();
    this.state = GAME_STATE.READY; // Ensure state is set correctly
    this.updateHighScoreDisplay();
    this.showOverlay('Ready to Play!', 'Press any key, touch the screen, or use the buttons to start');
  }
  
  setupEventListeners() {
    // Keyboard controls
    window.addEventListener('keydown', (e) => this.handleKeyPress(e));
    
    // Touch controls - buttons
    this.upBtn.addEventListener('click', () => this.onNavPress(DIRECTION.UP));
    this.downBtn.addEventListener('click', () => this.onNavPress(DIRECTION.DOWN));
    this.leftBtn.addEventListener('click', () => this.onNavPress(DIRECTION.LEFT));
    this.rightBtn.addEventListener('click', () => this.onNavPress(DIRECTION.RIGHT));
    
    // Game control buttons
    this.pauseBtn.addEventListener('click', () => this.togglePause());
    this.newGameBtn.addEventListener('click', () => this.startNewGame());
    document.getElementById('resume-btn').addEventListener('click', () => this.resumeGame());
    document.getElementById('restart-btn').addEventListener('click', () => this.startNewGame());

    // Mute toggle
    const muteBtn = document.getElementById('mute-btn');
    muteBtn.addEventListener('click', () => {
      const enabled = this.sound.toggle();
      muteBtn.textContent = enabled ? 'Sound: On' : 'Sound: Off';
      muteBtn.setAttribute('aria-pressed', (!enabled).toString());
      // Reconcile background audio with current state
      this.syncBackgroundAudio();
    });
    
    // Swipe controls
    this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: true });
    this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: true });
    
    // Touch to start game
    this.canvas.addEventListener('touchstart', (e) => this.handleTouchToStart(e), { passive: true });
  }
  
  handleKeyPress(e) {
    if (this.moveLock && this.state === GAME_STATE.PLAYING) return;
    
    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (this.state === GAME_STATE.PAUSED) {
          this.resumeGame();
        } else if (this.state === GAME_STATE.PLAYING) {
          this.pauseGame();
        } else if (this.state === GAME_STATE.READY || this.state === GAME_STATE.GAME_OVER) {
          this.startGame();
        }
        break;
      case 'ArrowUp':
      case 'w':
      case 'W':
        e.preventDefault();
        this.changeDirection(DIRECTION.UP);
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        e.preventDefault();
        this.changeDirection(DIRECTION.DOWN);
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        e.preventDefault();
        this.changeDirection(DIRECTION.LEFT);
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        e.preventDefault();
        this.changeDirection(DIRECTION.RIGHT);
        break;
    }
  }
  
  handleTouchStart(e) {
    if (e.touches.length === 1) {
      this.touchStart.x = e.touches[0].clientX;
      this.touchStart.y = e.touches[0].clientY;
    }
  }
  
  handleTouchEnd(e) {
    if (!this.touchStart.x || !this.touchStart.y) return;
    
    const dx = e.changedTouches[0].clientX - this.touchStart.x;
    const dy = e.changedTouches[0].clientY - this.touchStart.y;
    
    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal swipe
      if (dx > CONFIG.SWIPE_THRESHOLD) this.changeDirection(DIRECTION.RIGHT);
      else if (dx < -CONFIG.SWIPE_THRESHOLD) this.changeDirection(DIRECTION.LEFT);
    } else {
      // Vertical swipe
      if (dy > CONFIG.SWIPE_THRESHOLD) this.changeDirection(DIRECTION.DOWN);
      else if (dy < -CONFIG.SWIPE_THRESHOLD) this.changeDirection(DIRECTION.UP);
    }
    
    this.touchStart = { x: null, y: null };
  }
  
  handleTouchToStart(e) {
    if (this.state === GAME_STATE.READY || this.state === GAME_STATE.GAME_OVER) {
      e.preventDefault();
      this.startGame(); // Start with default direction (right)
    }
  }

  onNavPress(direction) {
    // Block nav when not actively playing
    if (this.state !== GAME_STATE.PLAYING) return;
    this.changeDirection(direction);
  }

  setNavEnabled(enabled) {
    const flag = !enabled;
    this.upBtn.disabled = flag;
    this.downBtn.disabled = flag;
    this.leftBtn.disabled = flag;
    this.rightBtn.disabled = flag;
  }
  
  changeDirection(newDirection) {
    if (this.state === GAME_STATE.READY || this.state === GAME_STATE.GAME_OVER) {
      this.startGame(newDirection);
      return;
    }
    
    if (this.state !== GAME_STATE.PLAYING || this.moveLock) return;
    
    // Prevent reversing direction
    if (this.velocity.x === -newDirection.x && this.velocity.y === -newDirection.y) return;
    
    this.velocity = { ...newDirection };
    this.moveLock = true;
  }
  
  startGame(initialDirection = null) {
    if (this.state === GAME_STATE.GAME_OVER || this.state === GAME_STATE.READY) {
      this.resetGame();
    }
    this.state = GAME_STATE.PLAYING;
    
    // Set initial direction if provided, otherwise default to right
    if (initialDirection) {
      this.velocity = { ...initialDirection };
    } else {
      this.velocity = { ...DIRECTION.RIGHT };
    }
    
    this.hideOverlay();
    this.showGameControls();
    this.setNavEnabled(true);
    this.syncBackgroundAudio();
    this.startGameLoop();
  }
  
  startNewGame() {
    this.stopGameLoop();
    this.resetGame();
    // Controls state for new game
    this.pauseBtn.textContent = 'Pause';
    this.newGameBtn.classList.add('hidden');
    this.startGame();
  }
  
  pauseGame() {
    if (this.state === GAME_STATE.PLAYING) {
      this.state = GAME_STATE.PAUSED;
      this.stopGameLoop();
      this.sound.stopBackground();
      this.showOverlay('Game Paused', 'Press SPACE to resume');
      this.pauseBtn.textContent = 'Resume';
      this.newGameBtn.classList.remove('hidden');
      this.setNavEnabled(false);
    }
  }
  
  resumeGame() {
    if (this.state === GAME_STATE.PAUSED) {
      this.state = GAME_STATE.PLAYING;
      this.hideOverlay();
      this.startGameLoop();
      this.syncBackgroundAudio();
      this.pauseBtn.textContent = 'Pause';
      this.newGameBtn.classList.add('hidden');
      this.setNavEnabled(true);
    }
  }
  
  togglePause() {
    if (this.state === GAME_STATE.PLAYING) {
      this.pauseGame();
    } else if (this.state === GAME_STATE.PAUSED) {
      this.resumeGame();
    }
  }
  
  resetGame() {
    this.snake = [{ x: 10, y: 10 }];
    this.velocity = { x: 0, y: 0 };
    this.food = this.generateFood();
    this.score = 0;
    this.level = 1;
    this.speed = CONFIG.INITIAL_SPEED;
    this.moveLock = false;
    this.updateUI();
  }
  
  generateFood() {
    let newPos;
    do {
      newPos = {
        x: Math.floor(Math.random() * this.tileCount),
        y: Math.floor(Math.random() * this.tileCount)
      };
    } while (this.snake.some(segment => segment.x === newPos.x && segment.y === newPos.y));
    return newPos;
  }
  
  update() {
    if (this.state !== GAME_STATE.PLAYING) return;
    
    // Don't move if no velocity (game hasn't started moving yet)
    if (this.velocity.x === 0 && this.velocity.y === 0) return;
    
    // Move snake
    const head = {
      x: this.snake[0].x + this.velocity.x,
      y: this.snake[0].y + this.velocity.y
    };
    
    // Check collision with walls
    if (head.x < 0 || head.x >= this.tileCount || head.y < 0 || head.y >= this.tileCount) {
      this.gameOver();
      return;
    }
    
    // Check collision with self
    if (this.snake.some(segment => segment.x === head.x && segment.y === head.y)) {
      this.gameOver();
      return;
    }
    
    this.snake.unshift(head);
    
    // Check if food eaten
    if (head.x === this.food.x && head.y === this.food.y) {
      this.score++;
      this.food = this.generateFood();
      this.sound.playEat();
      this.checkLevelUp();
      this.updateUI();
      
      // Add pulse effect to score
      this.scoreEl.classList.add('pulse');
      setTimeout(() => this.scoreEl.classList.remove('pulse'), 300);
    } else {
      this.snake.pop();
    }
    
    this.moveLock = false;
  }
  
  checkLevelUp() {
    const newLevel = Math.floor(this.score / CONFIG.POINTS_PER_LEVEL) + 1;
    if (newLevel > this.level) {
      this.level = newLevel;
      this.speed = Math.max(
        CONFIG.MIN_SPEED,
        CONFIG.INITIAL_SPEED - (this.level - 1) * CONFIG.SPEED_INCREASE
      );
      this.stopGameLoop();
      this.startGameLoop();
      this.sound.playLevelUp();
      
      // Add pulse effect to level
      this.levelEl.classList.add('pulse');
      setTimeout(() => this.levelEl.classList.remove('pulse'), 300);
    }
  }
  
  draw() {
    // Clear canvas
    this.ctx.fillStyle = '#121212';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw food
    this.ctx.fillStyle = '#e91e63';
    this.ctx.beginPath();
    this.ctx.arc(
      this.food.x * CONFIG.GRID_SIZE + CONFIG.GRID_SIZE / 2,
      this.food.y * CONFIG.GRID_SIZE + CONFIG.GRID_SIZE / 2,
      CONFIG.GRID_SIZE / 2.2,
      0,
      Math.PI * 2
    );
    this.ctx.fill();
    
    // Draw snake
    this.snake.forEach((segment, i) => {
      this.ctx.fillStyle = i === 0 ? '#4caf50' : '#81c784';
      this.ctx.fillRect(
        segment.x * CONFIG.GRID_SIZE,
        segment.y * CONFIG.GRID_SIZE,
        CONFIG.GRID_SIZE,
        CONFIG.GRID_SIZE
      );
      
      // Add highlight
      this.ctx.strokeStyle = '#2e7d32';
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(
        segment.x * CONFIG.GRID_SIZE + 1,
        segment.y * CONFIG.GRID_SIZE + 1,
        CONFIG.GRID_SIZE - 2,
        CONFIG.GRID_SIZE - 2
      );
    });
  }
  
  gameOver() {
    this.state = GAME_STATE.GAME_OVER;
    this.stopGameLoop();
    this.hideGameControls();
    this.sound.playGameOver();
    this.sound.stopBackground();
    // Show only New Game button on game over
    const controls = document.getElementById('game-controls');
    controls.style.display = 'flex';
    this.pauseBtn.classList.add('hidden');
    this.newGameBtn.classList.remove('hidden');
    this.setNavEnabled(false);

    // Check for high score
    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.setHighScore(this.highScore);
      this.updateHighScoreDisplay();
      this.showOverlay(
        'New High Score! 🎉',
        `Amazing! You scored ${this.score} points!\nPress SPACE or tap Play Again to restart`
      );
      this.scoreEl.classList.add('high-score');
    } else {
      this.showOverlay(
        'Game Over',
        `Final Score: ${this.score}\nHigh Score: ${this.highScore}\nPress SPACE or tap Play Again to restart`
      );
    }
    
    // Add game over effect
    this.canvas.classList.add('game-over');
    setTimeout(() => this.canvas.classList.remove('game-over'), 2000);
  }
  
  updateUI() {
    this.scoreEl.textContent = `Score: ${this.score}`;
    this.levelEl.textContent = `Level: ${this.level}`;
    this.speedEl.textContent = `Speed: ${((CONFIG.INITIAL_SPEED / this.speed)).toFixed(1)}x`;
    
    // Remove high score class when game resets
    if (this.score === 0) {
      this.scoreEl.classList.remove('high-score');
    }
  }
  
  updateHighScoreDisplay() {
    if (this.highScore > 0) {
      this.highScoreEl.textContent = `High Score: ${this.highScore}`;
      this.highScoreEl.classList.remove('hidden');
    } else {
      this.highScoreEl.classList.add('hidden');
    }
  }
  
  showOverlay(title, message) {
    this.overlayTitle.textContent = title;
    this.overlayMessage.textContent = message;
    
    // Show/hide buttons based on game state
    const resumeBtn = document.getElementById('resume-btn');
    const restartBtn = document.getElementById('restart-btn');
    
    if (this.state === GAME_STATE.READY) {
      // Hide buttons on initial ready state
      resumeBtn.style.display = 'none';
      restartBtn.style.display = 'none';
    } else if (this.state === GAME_STATE.PAUSED) {
      // Show resume button when paused
      resumeBtn.style.display = 'inline-block';
      restartBtn.style.display = 'inline-block';
    } else if (this.state === GAME_STATE.GAME_OVER) {
      // Hide resume, show restart on game over
      resumeBtn.style.display = 'none';
      restartBtn.style.display = 'inline-block';
      restartBtn.textContent = 'Play Again';
    }
    
    this.overlayEl.classList.remove('hidden');
  }
  
  hideOverlay() {
    this.overlayEl.classList.add('hidden');
  }
  
  showGameControls() {
    const controls = document.getElementById('game-controls');
    controls.style.display = 'flex';
    // When gameplay starts: show only Pause
    this.pauseBtn.classList.remove('hidden');
    this.pauseBtn.textContent = 'Pause';
    this.newGameBtn.classList.add('hidden');
  }
  
  hideGameControls() {
    const controls = document.getElementById('game-controls');
    controls.style.display = 'none';
  }
  
  startGameLoop() {
    this.stopGameLoop();
    this.gameLoop = setInterval(() => {
      this.update();
      this.draw();
    }, this.speed);
  }
  
  stopGameLoop() {
    if (this.gameLoop) {
      clearInterval(this.gameLoop);
      this.gameLoop = null;
    }
  }
  
  // Centralized background sound policy
  syncBackgroundAudio() {
    if (!this.sound.enabled) {
      this.sound.stopBackground();
      return;
    }
    if (this.state === GAME_STATE.PLAYING) {
      this.sound.playBackground();
    } else {
      this.sound.stopBackground();
    }
  }
  
  getHighScore() {
    return parseInt(localStorage.getItem('snakeHighScore')) || 0;
  }
  
  setHighScore(score) {
    localStorage.setItem('snakeHighScore', score.toString());
  }
}

// Initialize game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new SnakeGame();
}); 