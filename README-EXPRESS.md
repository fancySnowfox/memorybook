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

### 1.1 Install System Dependencies (for Office upload conversion)

The upload feature accepts `.docx`, `.pptx`, and `.xlsx` and auto-converts them to PDF on the server.

Install LibreOffice on the machine running this app:

Ubuntu/Debian (DigitalOcean droplet):

```bash
sudo apt update
sudo apt install -y libreoffice
```

Windows server/dev machine:

1. Install LibreOffice from the official installer.
2. Ensure `soffice` (or `soffice.exe`) is available in `PATH`.

Verify install:

```bash
soffice --version
```

### 1.2 Install System Dependencies (for MOV to MP4 conversion)

The video converter requires FFmpeg on the machine running this app.

Ubuntu/Debian (DigitalOcean droplet):

```bash
sudo apt update
sudo apt install -y ffmpeg
```

Windows server/dev machine:

1. Install FFmpeg.
2. Ensure `ffmpeg` (or `ffmpeg.exe`) is available in `PATH`.

Verify install:

```bash
ffmpeg -version
```

Supported FFmpeg locations used by this project:

- `/usr/local/bin/ffmpeg`
- `/usr/bin/ffmpeg`
- `./ffmpeg` (project root)
- `../FFmpeg/ffmpeg` (sibling folder)

If you place a project-local binary (`./ffmpeg` or `../FFmpeg/ffmpeg`), ensure it is executable:

```bash
chmod +x ./ffmpeg
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

# Debug endpoint (recommended for non-production only)
DEBUG_MODE=true
DEBUG_ADMIN_USER=admin
DEBUG_ADMIN_PASSWORD=change_this_password
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

If you deploy to Ubuntu and use Office file uploads, make sure LibreOffice is installed first:

```bash
sudo apt install -y libreoffice
```

If you deploy to Ubuntu and use MOV to MP4 conversion, make sure FFmpeg is installed first:

```bash
sudo apt install -y ffmpeg
```

## API Endpoints

- `GET /` - Home page
- `GET /chat` - Chat interface
- `POST /api/chat` - Chat API (streaming responses)
- `GET /api/config` - Server configuration
- `GET /api/rag/status` - RAG index status (ready, PDF count, last build time)
- `POST /api/rag/reindex` - Rebuild RAG index from local PDFs
- `GET /debug` - Debug diagnostics (debug mode only, admin Basic Auth required)

## Local PDF & PowerPoint RAG (LlamaIndex TS)

The chat endpoint can augment prompts with context retrieved from local PDFs and PowerPoint files in the `files/` folder.

### How it works

- Reads `.pdf`, `.ppt`, and `.pptx` files from `files/`
- Extracts text from PDFs and PowerPoint presentations
- Chunks content with LlamaIndex `SentenceSplitter`
- Embeds chunks with `@llamaindex/huggingface`
- Retrieves top matches and injects them into the system context before calling Gradient chat

### Usage

1. Put one or more PDFs and/or PowerPoint files in `files/`
2. Build or refresh the in-memory RAG index:

```bash
npm run rag:reindex
```

3. Start the server:

```bash
npm run dev
```

### RAG API Endpoints

Check RAG status (useful to verify index is built):

```bash
curl http://localhost:3000/api/rag/status
```

Response example:
```json
{
  "status": "success",
  "rag": {
    "ready": true,
    "fileCount": 3,
    "lastBuildAt": "2026-05-06T02:48:01.233Z"
  },
  "timestamp": "2026-05-06T02:50:00.000Z"
}
```

Trigger a reindex (e.g., after adding new files):

```bash
curl -X POST http://localhost:3000/api/rag/reindex
```

Optional environment variable:

- `RAG_TOP_K` (default: `3`) controls how many chunks are attached as context.

### How to Tell if RAG Was Used

Check the **server terminal logs**. When RAG context is retrieved, you'll see:
```
RAG context attached: { sourceCount: 2, sources: ['document1.pdf', 'presentation.pptx'] }
```

RAG is active but invisible to the user — the response appears the same whether local context was used or not. This is by design: if RAG has relevant context, it's included in the system prompt before calling the LLM. If not, the chat continues normally.

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
| `DEBUG_MODE` | true when not production | Enables `/debug` endpoint when `true` |
| `DEBUG_ADMIN_USER` | admin | Basic Auth username for `/debug` |
| `DEBUG_ADMIN_PASSWORD` | - | Basic Auth password for `/debug` (required if debug enabled) |

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

**Office files upload but conversion fails?**
Install LibreOffice on the server and verify:

```bash
soffice --version
```

On Ubuntu:

```bash
sudo apt install -y libreoffice
```

**MOV to MP4 conversion fails?**
Install FFmpeg on the server and verify:

```bash
ffmpeg -version
```

On Ubuntu:

```bash
sudo apt install -y ffmpeg
```

**Cannot access `/debug`?**
1. Ensure debug mode is enabled: `DEBUG_MODE=true`
2. Configure admin credentials: `DEBUG_ADMIN_USER` and `DEBUG_ADMIN_PASSWORD`
3. Use Basic Auth when calling the endpoint

Example:

```bash
curl -u admin:your_password http://localhost:3000/debug
```

## Removed Dependencies

This simplified version removes:
- ❌ Playwright (browser automation)
- ❌ @modelcontextprotocol/sdk (MCP protocol)
- ❌ Docker services (Playwright servers)
- ❌ Complex tool handling
- ❌ Screenshot functionality
