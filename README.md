# DeepSeek POW Proxy

Cloudflare Worker 免费版 CPU 限制 10ms，无法在 Worker 内完成 DeepSeek 的 POW 计算。这个本地代理在你电脑上自动求解 POW，然后转发给 Cloudflare Worker。

## 安装

**需要 Node.js 18+**

```bash
git clone https://github.com/zhangyiteng1-web/deepseek-pow-proxy.git
cd deepseek-pow-proxy
```

## 使用

```bash
node proxy.js
```

默认监听 `http://localhost:8899`，上游指向 `https://deepseek-cf-worker.pages.dev`。

自定义配置：

```bash
PORT=8899 DEEPSEEK_BASE_URL=https://ds.zyt163.com node proxy.js
```

- `PORT` — 本地监听端口，默认 8899
- `DEEPSEEK_BASE_URL` — 你的 Cloudflare Worker 地址

## 在 Trae 中配置

| 字段 | 值 |
|------|-----|
| API 地址 | `http://localhost:8899/v1` |
| API Key | `sk-any` |
| 模型 | `deepseek-v4-flash` |

## 在 OpenAI SDK 中使用

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8899/v1",
    api_key="sk-any"
)

response = client.chat.completions.create(
    model="deepseek-v4-flash",
    messages=[{"role": "user", "content": "你好"}]
)
print(response.choices[0].message.content)
```

## cURL

```bash
curl -X POST http://localhost:8899/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"你好"}]}'
```

## 工作原理

1. 收到 `/v1/chat/completions` 请求
2. 从 Worker 获取 POW 挑战
3. 本地计算 nonce（平均 3-4 秒）
4. 将 POW 答案注入 `x-ds-pow-response` 头
5. 转发给 Cloudflare Worker
6. 流式返回结果（支持 SSE 流式传输）

POW 答案缓存 4 分钟，避免重复计算。
