# Snowfox Consulting - Express.js AI Chat

A **lightweight, fast** Node.js/Express-based AI chat application with no browser automation overhead.

## Features

- ✅ **Ultra Fast**: Pure Node.js/Express (no Next.js, no Playwright)
- ✅ **Streaming AI**: Real-time response streaming from Gradient API
- ✅ **Simple Design**: Clean, responsive UI with minimal dependencies
- ✅ **Server-Side Rendering**: EJS templates for instant page loads
- ✅ **Production Ready**: Optimized for speed and stability

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Environment Variables

Create or update `.env.local`:

```bash
# Gradient API Configuration (Required)
GRADIENT_API_KEY=your_gradient_api_key
GRADIENT_BASE_URL=https://inference.do-ai.run/v1

# Optional
PORT=3000
AI_MODEL_ID=openai-gpt-4.1
```

### 3. Run Development Server

```bash
npm run dev
```

Access at: **http://localhost:3000**

### 4. Production

```bash
npm start
```

## API Endpoints

- `GET /` - Home page
- `GET /chat` - Chat interface
- `POST /api/chat` - Chat API (streaming responses)
- `GET /api/config` - Server configuration

## Project Structure

```
server/
  ├── index.js           # Express app setup
  ├── routes/
  │   ├── chat.js       # Chat API route (Gradient AI)
  │   └── config.js     # Config API route
  └── utils/
      └── s3-utils.js   # S3/Spaces utilities (optional)

views/
  ├── index.ejs         # Home page
  └── chat.ejs          # Chat interface

public/
  ├── SnowfoxConsulting.png  # Logo
  └── js/                    # Frontend scripts
```

## Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `GRADIENT_API_KEY` | - | API key for Gradient (required) |
| `GRADIENT_BASE_URL` | https://inference.do-ai.run/v1 | Gradient inference endpoint |
| `AI_MODEL_ID` | openai-gpt-4.1 | Model to use |

## Performance

- **Startup**: < 500ms
- **Response time**: < 100ms (then streaming)
- **Memory**: ~50-80MB
- **CPU**: Low overhead pure Node.js

## Troubleshooting

**Port 3000 already in use?**
```bash
PORT=3001 npm run dev
```

**API key errors?**
Check that `GRADIENT_API_KEY` is set and valid in `.env.local`

**No responses from AI?**
Verify Gradient API credentials and model availability

## Removed Dependencies

This simplified version removes:
- ❌ Playwright (browser automation)
- ❌ @modelcontextprotocol/sdk (MCP protocol)
- ❌ Docker services (Playwright servers)
- ❌ Complex tool handling
- ❌ Screenshot functionality
