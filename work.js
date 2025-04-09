export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const pathname = url.pathname

    // 提交分数接口
    if (request.method === 'POST' && pathname === '/submit') {
      try {
        const { score } = await request.json()
        if (typeof score !== 'number') {
          return new Response(JSON.stringify({ error: 'Score must be number' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // 获取地理信息
        const geoData = {
          city: (request.headers.get('CF-IPCity') || 'unknown').toLowerCase(),
          country: request.headers.get('CF-IPCountry') || 'XX'
        }

        const id = crypto.randomUUID()
        await env.KV.put(id, JSON.stringify({
          score,
          geo: geoData,
          timestamp: Date.now()
        }))

        // 处理排行榜
        const listRes = await env.KV.list({ limit: 1000 })
        const scores = await Promise.all(listRes.keys.map(async key => {
          try {
            const val = await env.KV.get(key.name)
            const data = val ? JSON.parse(val) : null
            return data ? { 
              score: data.score,
              city: data.geo?.city || 'unknown', 
              country: data.geo?.country || 'XX'
            } : null
          } catch {
            return null
          }
        }))

        const validScores = scores.filter(s => s !== null).sort((a, b) => b.score - a.score)
        const top10 = validScores.slice(0, 10)
        
        // 删除10名之外的数据
        const toDelete = validScores.slice(10).map(s => s.id)
        await Promise.all(toDelete.map(id => env.KV.delete(id)))

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

    // 获取排行榜接口
    if (request.method === 'GET' && pathname === '/scores') {
      try {
        const listRes = await env.KV.list({ limit: 1000 })
        const scores = await Promise.all(listRes.keys.map(async key => {
          try {
            const val = await env.KV.get(key.name)
            const data = val ? JSON.parse(val) : null
            return data ? { 
              score: data.score, 
              city: data.geo?.city || 'unknown',
              country: data.geo?.country || 'XX'
            } : null
          } catch {
            return null
          }
        }))

        const validScores = scores.filter(s => s !== null).sort((a, b) => b.score - a.score)
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

    // 前端页面
    return new Response(html, { 
      headers: { 'content-type': 'text/html; charset=UTF-8' } 
    })
  }
}

const html = <!DOCTYPE html>
<html>
<head>
  <title>贪吃蛇</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
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

    canvas {
      border: 2px solid rgba(236, 240, 241, 0.7);
      border-radius: 10px;
      touch-action: none;
      box-shadow: 0 4px 8px rgba(0,0,0,0.3);
      background: #2c3e50;
    }

    #startBtn {
      margin: 15px;
      padding: 12px 30px;
      font-size: 1.1rem;
      background: #e67e22;
      border: none;
      border-radius: 30px;
      color: #fff;
      cursor: pointer;
      transition: background 0.3s, transform 0.2s;
    }

    #leaderboard {
      margin-top: 20px;
      width: 90%;
      max-width: 400px;
      background: rgba(0, 0, 0, 0.2);
      padding: 15px;
      border-radius: 10px;
    }

    #rankList li {
      padding: 8px 12px;
      margin: 6px 0;
      background: rgba(255,255,255,0.05);
      border-radius: 6px;
      display: flex;
      justify-content: space-between;
      font-family: monospace;
    }

    .geo {
      color: #bdc3c7;
    }

    .score {
      color: #f1c40f;
      font-weight: bold;
    }

    @media (max-width: 480px) {
      h1 { font-size: 2rem; }
      #rankList li { font-size: 0.9rem; }
    }
  </style>
</head>
<body>
  <h1>🐍 贪吃蛇游戏</h1>
  <p class="subtitle">使用方向键或滑动控制 | 吃食物得分 | 避免碰撞</p>
  <canvas id="gameCanvas" width="400" height="400"></canvas>
  <div id="scoreBoard">当前得分: 0</div>
  <button id="startBtn">开始游戏</button>

  <div id="gameOver" class="game-over">...</div>

  <div id="leaderboard">
    <h3>🏆 排行榜（前10名）</h3>
    <ol id="rankList"></ol>
  </div>

  <script>
    // ...保持原有游戏逻辑不变...

    async function loadLeaderboard() {
      try {
        const res = await fetch('/scores');
        const data = await res.json();
        rankList.innerHTML = data.length
          ? data.map(s => `
            <li>
              <span class="geo">${s.city},${s.country}</span>
              <span class="score">${s.score}分</span>
            </li>
          `).join('')
          : '<p>暂无排行榜数据</p>';
      } catch (err) {
        console.error(err);
      }
    }

    // 初始化加载排行榜
    loadLeaderboard();
  </script>
</body>
</html>;
