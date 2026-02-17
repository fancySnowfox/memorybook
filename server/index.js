import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import chatRoute, { getModels } from './routes/chat.js';
import { configRoutes } from './routes/config.js';
import { checkApiConnectivity } from './utils/health-check.js';

dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.PORT || 3000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/chat', (req, res) => {
  res.render('chat');
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const gradientBaseUrl = process.env.GRADIENT_BASE_URL || 'https://inference.do-ai.run/v1';
  const gradientApiKey = process.env.GRADIENT_API_KEY;

  if (!gradientApiKey) {
    return res.status(500).json({
      status: 'error',
      message: 'GRADIENT_API_KEY is not configured',
      timestamp: new Date().toISOString(),
    });
  }

  const healthCheck = await checkApiConnectivity(gradientBaseUrl, gradientApiKey);
  
  if (!healthCheck.accessible) {
    return res.status(503).json({
      status: 'error',
      message: healthCheck.message,
      baseUrl: gradientBaseUrl,
      timestamp: new Date().toISOString(),
    });
  }

  res.json({
    status: 'ok',
    message: 'API is accessible and configured correctly',
    baseUrl: gradientBaseUrl,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/chat', chatRoute);
app.get('/api/models', getModels);
app.get('/api/config', configRoutes.config);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'An error occurred',
      type: 'api_error',
    },
  });
});

app.listen(PORT, () => {
  console.log(`\n✓ Express server running at http://localhost:${PORT}`);
  console.log('- Home: http://localhost:3000/');
  console.log('- Chat: http://localhost:3000/chat\n');
});
