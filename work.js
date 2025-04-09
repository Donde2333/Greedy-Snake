export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 提交分数接口
    if (request.method === "POST" && pathname === "/submit") {
      try {
        const { score } = await request.json();
        if (typeof score !== "number") {
          return new Response(
            JSON.stringify({ error: "分数必须是数字" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        // 获取地理位置
        const city = request.cf?.city || "未知城市";
        const country = request.cf?.country || "未知国家";
        const id = crypto.randomUUID();

        // 存储数据
        await env.KV.put(
          id,
          JSON.stringify({
            score,
            city,
            country,
            timestamp: Date.now()
          })
        );

        // 处理排行榜
        const allKeys = await env.KV.list();
        const allScores = await Promise.all(
          allKeys.keys.map(async (key) => {
            const value = await env.KV.get(key.name);
            return value ? { ...JSON.parse(value), id: key.name } : null;
          })
        );

        const validScores = allScores.filter(Boolean).sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.timestamp - b.timestamp;
        });

        // 维护Top10
        const top10 = validScores.slice(0, 10);
        const toDelete = validScores.slice(10);
        
        await Promise.all([
          ...toDelete.map(r => env.KV.delete(r.id)),
          ...top10.map((r, i) => 
            env.KV.put(r.id, JSON.stringify({ ...r, rank: i + 1 }))
          )
        ]);

        return new Response(JSON.stringify(top10), {
          headers: { "Content-Type": "application/json" }
        });

      } catch (e) {
        return new Response(
          JSON.stringify({ error: e.message }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // 获取排行榜接口
    if (request.method === "GET" && pathname === "/scores") {
      try {
        const allKeys = await env.KV.list();
        const scores = await Promise.all(
          allKeys.keys.map(async (key) => {
            const value = await env.KV.get(key.name);
            return value ? JSON.parse(value) : null;
          })
        );

        const sortedScores = scores.filter(Boolean).sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.timestamp - b.timestamp;
        }).slice(0, 10);

        return new Response(JSON.stringify(sortedScores), {
          headers: { "Content-Type": "application/json" }
        });

      } catch (e) {
        return new Response(
          JSON.stringify({ error: e.message }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // 返回HTML页面
    return new Response(HTML_TEMPLATE, {
      headers: { "Content-Type": "text/html; charset=UTF-8" }
    });
  }
};

const HTML_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
  <title>贪吃蛇大作战</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: linear-gradient(135deg, #1a5276, #16a085);
      min-height: 100vh;
      color: #fff;
      display: flex;
      flex-direction: column;
      align-items: center;
      -webkit-tap-highlight-color: transparent;
    }
    canvas {
      border: 3px solid rgba(255,255,255,0.3);
      border-radius: 10px;
      margin: 20px 0;
      max-width: 95%;
      aspect-ratio: 1;
      touch-action: none;
    }
    #controls {
      display: flex;
      gap: 15px;
      margin: 15px 0;
      align-items: center;
      flex-wrap: wrap;
      justify-content: center;
    }
    button {
      padding: 15px 30px;
      border: none;
      border-radius: 25px;
      background: #27ae60;
      color: white;
      cursor: pointer;
      transition: opacity 0.2s;
      font-size: 1.1em;
    }
    button:disabled {
      background: #7f8c8d;
      cursor: not-allowed;
    }
    #leaderboard {
      width: 100%;
      max-width: 500px;
      background: rgba(0,0,0,0.2);
      border-radius: 10px;
      padding: 20px;
      margin-top: 20px;
    }
    .rank-item {
      display: flex;
      justify-content: space-between;
      padding: 10px;
      margin: 5px 0;
      background: rgba(255,255,255,0.1);
      border-radius: 5px;
      font-size: 14px;
    }
    .food-tip {
      position: absolute;
      top: 10px;
      right: 10px;
      background: rgba(0,0,0,0.5);
      padding: 8px;
      border-radius: 8px;
    }
    .food-type {
      display: flex;
      align-items: center;
      gap: 5px;
      margin: 3px 0;
    }
    .food-color {
      width: 15px;
      height: 15px;
      border-radius: 3px;
    }
    @media (max-width: 480px) {
      body {
        padding: 10px;
      }
      h1 {
        font-size: 24px;
      }
      #leaderboard {
        padding: 10px;
      }
      .food-tip {
        top: 5px;
        right: 5px;
        font-size: 12px;
      }
    }
  </style>
</head>
<body>
  <h1>🐍 贪吃蛇大作战</h1>
  <p class="subtitle">方向键或滑动控制 | 吃食物得分 | 避免碰撞</p>
  <canvas id="game"></canvas>
  <div id="controls">
    <button id="startBtn">开始游戏</button>
    <div id="score">得分: 0</div>
  </div>
  <div id="leaderboard">
    <h3>🏆 排行榜</h3>
    <div id="ranks"></div>
  </div>

  <script>
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    const CELL = 10;
    const FOOD_TYPES = [
      { color: '#e74c3c', score: 10 },
      { color: '#f1c40f', score: 20 }
    ];
    const TOTAL_DURATION = 5000; // 食物总存在时间
    const BLINK_DURATION = 3000;  // 闪烁持续时间
    
    let snake = [];
    let food = {
      x: 0,
      y: 0,
      type: FOOD_TYPES[0],
      spawnTime: 0
    };
    let dir = 'right';
    let score = 0;
    let gameLoop;
    let isPlaying = false;
    let foodTimeout = null;
    let blinkInterval = null;

    // 移动端触摸处理
    let touchStartX = 0;
    let touchStartY = 0;
    const minSwipeDistance = 30;

    function handleTouchStart(e) {
      if (!isPlaying) return;
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      e.preventDefault();
    }

    function handleTouchMove(e) {
      if (!isPlaying) return;
      const touch = e.touches[0];
      const diffX = touch.clientX - touchStartX;
      const diffY = touch.clientY - touchStartY;
      
      if (Math.abs(diffX) > Math.abs(diffY)) {
        if (Math.abs(diffX) < minSwipeDistance) return;
        if (diffX > 0 && dir !== 'left') dir = 'right';
        else if (diffX < 0 && dir !== 'right') dir = 'left';
      } else {
        if (Math.abs(diffY) < minSwipeDistance) return;
        if (diffY > 0 && dir !== 'up') dir = 'down';
        else if (diffY < 0 && dir !== 'down') dir = 'up';
      }
      e.preventDefault();
    }

    function initGame() {
      if (foodTimeout) clearTimeout(foodTimeout);
      if (blinkInterval) clearInterval(blinkInterval);
      
      const maxSize = Math.min(window.innerWidth * 0.8, 400);
      const size = Math.floor(maxSize / CELL) * CELL;
      canvas.width = size;
      canvas.height = size;

      const startX = Math.floor(size/2 / CELL) * CELL;
      const startY = Math.floor(size/2 / CELL) * CELL;
      
      snake = [
        { x: startX, y: startY },
        { x: startX - CELL, y: startY },
        { x: startX - CELL*2, y: startY }
      ];
      dir = 'right';
      score = 0;
      food = spawnFood();
      updateScore();
      drawInitialBoard();
    }

    function drawInitialBoard() {
      ctx.fillStyle = '#2c3e50';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function spawnFood() {
      if (foodTimeout) clearTimeout(foodTimeout);
      if (blinkInterval) clearInterval(blinkInterval);

      const cols = canvas.width / CELL;
      const rows = canvas.height / CELL;
      const foodType = Math.random() < 0.1 ? FOOD_TYPES[1] : FOOD_TYPES[0];
      
      do {
        food = {
          x: Math.floor(Math.random() * cols) * CELL,
          y: Math.floor(Math.random() * rows) * CELL,
          type: foodType,
          spawnTime: Date.now()
        };
      } while (snake.some(s => s.x === food.x && s.y === food.y));

      if (foodType === FOOD_TYPES[1]) {
        foodTimeout = setTimeout(() => {
          food = spawnFood();
          redrawGame();
        }, TOTAL_DURATION);

        // 启动闪烁定时器
        blinkInterval = setInterval(() => {
          redrawGame();
        }, 50);
      }

      return food;
    }

    function redrawGame() {
      drawInitialBoard();
      ctx.fillStyle = '#27ae60';
      snake.forEach(s => ctx.fillRect(s.x+1, s.y+1, CELL-2, CELL-2));
      
      // 处理食物闪烁
      if (food.type === FOOD_TYPES[1]) {
        const elapsed = Date.now() - food.spawnTime;
        if (elapsed > TOTAL_DURATION - BLINK_DURATION) {
          const remain = TOTAL_DURATION - elapsed;
          const progress = 1 - remain / BLINK_DURATION;
          const blinkSpeed = 300 - (250 * progress); // 闪烁速度从300ms到50ms
          const blinkState = Math.floor((Date.now() - food.spawnTime) / blinkSpeed) % 2;
          
          if (blinkState === 0) {
            ctx.fillStyle = food.type.color;
            ctx.fillRect(food.x+1, food.y+1, CELL-2, CELL-2);
          }
        } else {
          ctx.fillStyle = food.type.color;
          ctx.fillRect(food.x+1, food.y+1, CELL-2, CELL-2);
        }
      } else {
        ctx.fillStyle = food.type.color;
        ctx.fillRect(food.x+1, food.y+1, CELL-2, CELL-2);
      }
    }

    function updateScore() {
      document.getElementById('score').textContent = \`得分: \${score}\`;
    }

    function gameStep() {
      if (!isPlaying) return;

      const head = { ...snake[0] };
      switch (dir) {
        case 'up': head.y -= CELL; break;
        case 'down': head.y += CELL; break;
        case 'left': head.x -= CELL; break;
        case 'right': head.x += CELL; break;
      }

      const hitWall = head.x < 0 || head.x >= canvas.width || 
                     head.y < 0 || head.y >= canvas.height;
      const hitSelf = snake.some(s => s.x === head.x && s.y === head.y);
      
      if (hitWall || hitSelf) {
        endGame();
        return;
      }

      snake.unshift(head);
      
      if (head.x === food.x && head.y === food.y) {
        score += food.type.score;
        updateScore();
        food = spawnFood();
      } else {
        snake.pop();
      }

      redrawGame();
    }

    function endGame() {
      isPlaying = false;
      clearInterval(gameLoop);
      clearInterval(blinkInterval);
      submitScore(score);
      drawInitialBoard();
      ctx.fillStyle = '#e74c3c';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(\`🤣游戏结束！得分：\${score} 分👊\`, canvas.width / 2, canvas.height / 2);
      const startBtn = document.getElementById('startBtn');
      startBtn.textContent = "重新开始";
      startBtn.disabled = false;
    }

    // 事件监听
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    
    document.getElementById('startBtn').addEventListener('click', () => {
      if (!isPlaying) {
        isPlaying = true;
        const startBtn = document.getElementById('startBtn');
        startBtn.textContent = "游戏中...";
        startBtn.disabled = true;
        initGame();
        gameLoop = setInterval(gameStep, 100);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (!isPlaying) return;
      switch (e.key) {
        case 'ArrowUp': if (dir !== 'down') dir = 'up'; break;
        case 'ArrowDown': if (dir !== 'up') dir = 'down'; break;
        case 'ArrowLeft': if (dir !== 'right') dir = 'left'; break;
        case 'ArrowRight': if (dir !== 'left') dir = 'right'; break;
      }
    });

    async function submitScore() {
      try {
        await fetch('/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ score })
        });
        loadLeaderboard();
      } catch (err) {
        console.error('提交失败:', err);
      }
    }

    async function loadLeaderboard() {
      try {
        const res = await fetch('/scores');
        const data = await res.json();
        document.getElementById('ranks').innerHTML = data
          .map((entry, i) => \`
            <div class="rank-item">
              <span>#\${i + 1}</span>
              <span>\${entry.score} 分</span>
              <span>\${entry.city}, \${entry.country}</span>
            </div>\`
          ).join('');
      } catch (err) {
        console.error('加载失败:', err);
      }
    }

    // 初始化
    initGame();
    loadLeaderboard();
    setInterval(loadLeaderboard, 30000);
    window.addEventListener('resize', () => {
      initGame();
      if (!isPlaying) drawInitialBoard();
    });
  </script>
</body>
</html>
`;
