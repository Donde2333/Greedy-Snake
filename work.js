export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 接口：提交分数，同时存储 IP 与地址信息
    if (url.pathname === '/submit' && request.method === 'POST') {
      try {
        const body = await request.json();
        const score = parseInt(body.score || 0);
        // 获取 IP 与地理信息
        const ip = request.headers.get('cf-connecting-ip') || 'unknown';
        const city = request.cf?.city || '';
        const country = request.cf?.country || '';
        const record = { score, ip, city, country };
        // 使用时间戳和随机数生成唯一 id
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await env.GAME_SCORES.put(id, JSON.stringify(record));
        return new Response('OK', { status: 200 });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.toString() }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 接口：获取排行榜数据（前10名）
    if (url.pathname === '/scores' && request.method === 'GET') {
      try {
        const listRes = await env.GAME_SCORES.list({ limit: 1000 });
        const results = await Promise.all(
          listRes.keys.map(async key => {
            const val = await env.GAME_SCORES.get(key.name);
            if (!val) return null;
            const parsed = JSON.parse(val);
            return {
              score: parsed.score,
              location: parsed.city
                ? `${parsed.city}, ${parsed.country}`
                : parsed.country || '未知地区'
            };
          })
        );
        const validResults = results.filter(r => r !== null);
        validResults.sort((a, b) => b.score - a.score);
        const top10 = validResults.slice(0, 10);
        return new Response(JSON.stringify(top10), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.toString() }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 默认返回 HTML 页面（包含前端 JS 与样式）
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=UTF-8' }
    });
  }
}

const html = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <title>🐍 贪吃蛇</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <style>
    /* 全局设置与背景 */
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: linear-gradient(135deg, #1abc9c, #16a085);
      color: #ecf0f1;
      height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      overflow: hidden;
    }
    h1 {
      font-size: 2.2rem;
      margin: 20px 0 5px;
      text-shadow: 1px 1px 3px #000;
    }
    .subtitle {
      font-size: 0.9rem;
      color: #bdc3c7;
      margin-bottom: 10px;
      letter-spacing: 1px;
    }
    /* Canvas 设置，注意宽高属性将在 JS 中动态设置 */
    canvas {
      border: 2px solid #ecf0f1;
      border-radius: 6px;
      background: #2c3e50;
      margin-top: 10px;
      touch-action: none;
      box-shadow: 0 4px 8px rgba(0,0,0,0.3);
    }
    /* 开始按钮 */
    #startBtn {
      margin: 15px;
      padding: 10px 25px;
      font-size: 16px;
      cursor: pointer;
      background: #27ae60;
      color: white;
      border: none;
      border-radius: 5px;
      transition: background 0.3s;
    }
    #startBtn:disabled {
      background: #999;
      cursor: not-allowed;
    }
    /* 游戏结束弹窗 */
    #gameOver {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0,0,0,0.85);
      color: #e74c3c;
      padding: 20px 30px;
      border-radius: 10px;
      display: none;
      text-align: center;
      box-shadow: 0 0 15px #000;
      z-index: 10;
    }
    .restart-btn {
      margin-top: 10px;
      padding: 8px 20px;
      background: #3498db;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.3s;
    }
    .restart-btn:hover {
      background: #2980b9;
    }
    /* 排行榜样式 */
    #leaderboard {
      margin-top: 20px;
      text-align: left;
      max-width: 90%;
      background: rgba(0, 0, 0, 0.2);
      padding: 10px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    }
    #leaderboard h3 {
      font-size: 1.2rem;
      margin-bottom: 8px;
    }
    #leaderboard ol {
      list-style: decimal;
      padding-left: 20px;
      font-size: 0.95rem;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <h1>🐍 贪吃蛇游戏</h1>
  <p class="subtitle">使用方向键或滑动控制 | 吃食物得分 | 躲避碰撞</p>
  <canvas id="gameCanvas"></canvas>
  <button id="startBtn">开始游戏</button>

  <div id="gameOver">
    <div>游戏结束！</div>
    <div>得分: <span id="finalScore">0</span></div>
    <button class="restart-btn" onclick="restartGame()">重新开始</button>
  </div>

  <div id="leaderboard">
    <h3>🏆 排行榜</h3>
    <ol id="rankList">加载中...</ol>
  </div>

  <script>
    // 根据窗口宽度设置画布尺寸：桌面设备使用 500x500，移动设备使用 300x300
    const canvas = document.getElementById('gameCanvas');
    const isDesktop = window.innerWidth > 600;
    const CANVAS_SIZE = isDesktop ? 500 : 300;
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;

    const ctx = canvas.getContext('2d');
    const startBtn = document.getElementById('startBtn');
    const gameOverDiv = document.getElementById('gameOver');
    const finalScoreSpan = document.getElementById('finalScore');
    const rankList = document.getElementById('rankList');

    let snake = [];
    let food = {};
    let direction = 'right';
    let gameLoop;
    let score = 0;
    let isGameStarted = false;

    function initGame() {
      // 起点设置为画布中心附近，确保适应动态画布大小
      snake = [
        { x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 },
        { x: (CANVAS_SIZE / 2) - 10, y: CANVAS_SIZE / 2 },
        { x: (CANVAS_SIZE / 2) - 20, y: CANVAS_SIZE / 2 }
      ];
      direction = 'right';
      score = 0;
      generateFood();
    }

    function generateFood() {
      food = {
        x: Math.floor(Math.random() * (CANVAS_SIZE / 10)) * 10,
        y: Math.floor(Math.random() * (CANVAS_SIZE / 10)) * 10
      };
    }

    function gameStep() {
      const head = { ...snake[0] };
      switch (direction) {
        case 'right': head.x += 10; break;
        case 'left': head.x -= 10; break;
        case 'up': head.y -= 10; break;
        case 'down': head.y += 10; break;
      }

      // 检测碰撞：边界或自身
      if (
        head.x < 0 || head.x >= CANVAS_SIZE || 
        head.y < 0 || head.y >= CANVAS_SIZE ||
        snake.some(seg => seg.x === head.x && seg.y === head.y)
      ) {
        endGame();
        return;
      }

      if (head.x === food.x && head.y === food.y) {
        score += 10;
        generateFood();
      } else {
        snake.pop();
      }
      snake.unshift(head);
      draw();
    }

    function draw() {
      ctx.fillStyle = '#2c3e50';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.fillStyle = '#27ae60';
      snake.forEach(seg => ctx.fillRect(seg.x, seg.y, 10, 10));
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(food.x, food.y, 10, 10);
    }

    function endGame() {
      clearInterval(gameLoop);
      isGameStarted = false;
      finalScoreSpan.textContent = score;
      gameOverDiv.style.display = 'block';
      submitScore(score);
    }

    function restartGame() {
      gameOverDiv.style.display = 'none';
      startBtn.disabled = false;
      startBtn.click();
    }

    // 键盘控制
    document.addEventListener('keydown', e => {
      if (!isGameStarted) return;
      switch (e.key) {
        case 'ArrowUp':    if (direction !== 'down') direction = 'up'; break;
        case 'ArrowDown':  if (direction !== 'up') direction = 'down'; break;
        case 'ArrowLeft':  if (direction !== 'right') direction = 'left'; break;
        case 'ArrowRight': if (direction !== 'left') direction = 'right'; break;
      }
    });

    startBtn.addEventListener('click', () => {
      if (!isGameStarted) {
        isGameStarted = true;
        startBtn.disabled = true;
        initGame();
        gameLoop = setInterval(gameStep, 100);
      }
    });

    // 禁止触摸滚动
    window.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

    async function submitScore(score) {
      await fetch('/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score })
      });
      loadLeaderboard();
    }

    async function loadLeaderboard() {
      const res = await fetch('/scores');
      const data = await res.json();
      rankList.innerHTML = data.length
        ? data.map(item => \`<li>\${item.score} 分 (\${item.location})</li>\`).join('')
        : '<p>暂无排行榜数据</p>';
    }

    loadLeaderboard();
  </script>
</body>
</html>`;
