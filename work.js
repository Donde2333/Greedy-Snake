export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const pathname = url.pathname

    // 提交分数接口：记录分数，并返回前 10 名分数
    if (request.method === 'POST' && pathname === '/submit') {
      try {
        const { score } = await request.json()
        if (typeof score !== 'number') {
          return new Response(JSON.stringify({ error: 'Score must be a number' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const id = crypto.randomUUID()
        await env.KV.put(id, score.toString())

        const listRes = await env.KV.list({ limit: 1000 })
        const scores = await Promise.all(listRes.keys.map(async key => {
          const val = await env.KV.get(key.name)
          return val ? { id: key.name, score: parseInt(val) } : null
        }))
        const validScores = scores.filter(s => s !== null)
        validScores.sort((a, b) => b.score - a.score)
        const top10 = validScores.slice(0, 10)
        const toDelete = validScores.slice(10)
        await Promise.all(toDelete.map(s => env.KV.delete(s.id)))
        return new Response(JSON.stringify(top10), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (e) {
        return new Response(JSON.stringify({ error: e.toString() }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // 获取排行榜接口：返回 KV 中前 10 名分数
    if (request.method === 'GET' && pathname === '/scores') {
      try {
        const listRes = await env.KV.list({ limit: 1000 })
        const scores = await Promise.all(listRes.keys.map(async key => {
          const val = await env.KV.get(key.name)
          return val ? { score: parseInt(val) } : null
        }))
        const validScores = scores.filter(s => s !== null)
        validScores.sort((a, b) => b.score - a.score)
        return new Response(JSON.stringify(validScores.slice(0, 10)), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (e) {
        return new Response(JSON.stringify({ error: e.toString() }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // 默认返回 HTML 页面（也包含前端 JS 与移动端适配）
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    })
  }
}

const html = `<!DOCTYPE html>
<html>
<head>
  <title>贪吃蛇</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    /* 整体背景渐变及全局设置 */
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: linear-gradient(135deg, #1abc9c, #16a085);
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
      color: #ecf0f1;
    }

    h1 {
      font-size: 2.8rem;
      margin: 20px 0 10px;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
    }

    .subtitle {
      font-size: 1.1rem;
      margin-bottom: 15px;
      text-align: center;
      opacity: 0.9;
    }

    /* 游戏画布增强圆角和阴影效果 */
    canvas {
      border: 2px solid rgba(236, 240, 241, 0.7);
      border-radius: 10px;
      touch-action: none;
      box-shadow: 0 4px 8px rgba(0,0,0,0.3);
      background: #2c3e50;
    }

    /* 开始按钮样式美化 */
    #startBtn {
      margin: 15px;
      padding: 12px 30px;
      font-size: 1.1rem;
      background: #e67e22;
      border: none;
      border-radius: 30px;
      color: #fff;
      cursor: pointer;
      box-shadow: 0 4px 6px rgba(0,0,0,0.2);
      transition: background 0.3s, transform 0.2s;
    }
    #startBtn:hover {
      background: #d35400;
      transform: translateY(-2px);
    }
    #startBtn:disabled {
      background: #95a5a6;
      cursor: not-allowed;
    }

    /* 记分板和排行榜样式 */
    #scoreBoard {
      font-size: 1.2rem;
      margin: 10px;
      padding: 5px 10px;
      background: rgba(0,0,0,0.2);
      border-radius: 5px;
    }
    #leaderboard {
      margin-top: 20px;
      width: 90%;
      max-width: 400px;
      background: rgba(0, 0, 0, 0.2);
      padding: 10px;
      border-radius: 10px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    }
    #leaderboard h3 {
      margin: 5px 0 10px;
      text-align: center;
    }
    #rankList {
      list-style: decimal;
      padding-left: 20px;
      font-size: 1rem;
      line-height: 1.5;
    }

    /* 游戏结束弹窗风格 */
    .game-over {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(44, 62, 80, 0.95);
      padding: 20px 30px;
      border-radius: 15px;
      text-align: center;
      box-shadow: 0 8px 16px rgba(0,0,0,0.3);
      display: none;
    }
    .game-over div {
      margin-bottom: 10px;
      font-size: 1.4rem;
    }
    .restart-btn {
      padding: 10px 20px;
      font-size: 1rem;
      background: #e74c3c;
      border: none;
      border-radius: 20px;
      color: #fff;
      cursor: pointer;
      transition: background 0.3s, transform 0.2s;
    }
    .restart-btn:hover {
      background: #c0392b;
      transform: translateY(-2px);
    }

    /* 移动端适配调整 */
    @media (max-width: 600px) {
      canvas {
        width: 300px;
        height: 300px;
      }
      h1 {
        font-size: 2rem;
      }
      #startBtn {
        font-size: 1rem;
        padding: 10px 20px;
      }
    }
  </style>
</head>
<body>
  <h1>🐍 贪吃蛇游戏</h1>
  <p class="subtitle">使用方向键或滑动控制 | 吃食物得分 | 避免碰撞</p>
  <canvas id="gameCanvas" width="400" height="400"></canvas>
  <div id="scoreBoard">当前得分: 0</div>
  <button id="startBtn">开始游戏</button>

  <div id="gameOver" class="game-over">
    <div>游戏结束！</div>
    <div>得分: <span id="finalScore">0</span></div>
    <button class="restart-btn" onclick="restartGame()">重新开始</button>
  </div>

  <div id="leaderboard">
    <h3>🏆 排行榜（前10名）</h3>
    <ol id="rankList"></ol>
  </div>

  <script>
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const scoreBoard = document.getElementById('scoreBoard');
    const rankList = document.getElementById('rankList');
    let snake = [];
    let food = {};
    let direction = 'right';
    let gameLoop;
    let isGameStarted = false;
    let score = 0;

    function initGame() {
      snake = [{ x: 200, y: 200 }, { x: 190, y: 200 }, { x: 180, y: 200 }];
      direction = 'right';
      score = 0;
      generateFood();
      scoreBoard.textContent = '当前得分: 0';
    }

    function generateFood() {
      food = {
        x: Math.floor(Math.random() * 40) * 10,
        y: Math.floor(Math.random() * 40) * 10
      };
    }

    function gameStep() {
      if (!isGameStarted) return;
      const head = { ...snake[0] };
      switch (direction) {
        case 'right': head.x += 10; break;
        case 'left': head.x -= 10; break;
        case 'up': head.y -= 10; break;
        case 'down': head.y += 10; break;
      }

      if (head.x < 0 || head.x >= 400 || head.y < 0 || head.y >= 400 ||
          snake.some(seg => seg.x === head.x && seg.y === head.y)) {
        endGame();
        return;
      }

      if (head.x === food.x && head.y === food.y) {
        score += 10;
        scoreBoard.textContent = '当前得分: ' + score;
        generateFood();
      } else {
        snake.pop();
      }

      snake.unshift(head);
      ctx.clearRect(0, 0, 400, 400);
      ctx.fillStyle = '#2c3e50';
      ctx.fillRect(0, 0, 400, 400);

      ctx.fillStyle = '#27ae60';
      snake.forEach(seg => ctx.fillRect(seg.x, seg.y, 10, 10));

      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(food.x, food.y, 10, 10);
    }

    function endGame() {
      isGameStarted = false;
      clearInterval(gameLoop);
      document.getElementById('finalScore').textContent = score;
      document.getElementById('gameOver').style.display = 'block';
      submitScore(score);
    }

    function restartGame() {
      document.getElementById('gameOver').style.display = 'none';
      document.getElementById('startBtn').disabled = false;
      document.getElementById('startBtn').click();
    }

    document.getElementById('startBtn').addEventListener('click', () => {
      if (!isGameStarted) {
        isGameStarted = true;
        document.getElementById('startBtn').disabled = true;
        initGame();
        gameLoop = setInterval(gameStep, 100);
      }
    });

    document.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowUp': if (direction !== 'down') direction = 'up'; break;
        case 'ArrowDown': if (direction !== 'up') direction = 'down'; break;
        case 'ArrowLeft': if (direction !== 'right') direction = 'left'; break;
        case 'ArrowRight': if (direction !== 'left') direction = 'right'; break;
      }
    });

    // 触摸控制：滑动手势处理及阻止默认滚动
    let touchStartX = 0, touchStartY = 0;
    canvas.addEventListener('touchstart', e => {
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
    });
    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchend', e => {
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0 && direction !== 'left') direction = 'right';
        else if (dx < 0 && direction !== 'right') direction = 'left';
      } else {
        if (dy > 0 && direction !== 'up') direction = 'down';
        else if (dy < 0 && direction !== 'down') direction = 'up';
      }
    });

    async function submitScore(score) {
      try {
        await fetch('/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ score })
        });
        loadLeaderboard();
      } catch (err) {
        console.error(err);
      }
    }

    async function loadLeaderboard() {
      try {
        const res = await fetch('/scores');
        const data = await res.json();
        rankList.innerHTML = data.length
          ? data.map(s => \`<li>\${s.score} 分</li>\`).join('')
          : '<p>暂无排行榜数据</p>';
      } catch (err) {
        console.error(err);
      }
    }

    loadLeaderboard();
  </script>
</body>
</html>`;
