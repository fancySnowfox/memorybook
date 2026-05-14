const DEFAULT_MODEL_ID = process.env.AI_MODEL_ID || 'router:knowledge-base-document-intelligence-01';
const DEFAULT_TASK_ID = process.env.AI_TASK_ID || 'knowledge-base-customer-support';
const DEFAULT_GRADIENT_BASE_URL = 'https://inference.do-ai.run/v1';
import { retrieveRagContext, retrieveRagContextForUser } from '../utils/rag-llamaindex.js';

function normalizeBaseUrl(baseUrl) {
  return (baseUrl || DEFAULT_GRADIENT_BASE_URL).trim().replace(/\/+$/, '');
}

function isInferenceBaseUrl(baseUrl) {
  return /inference\.do-ai\.run\/v1$/i.test(baseUrl);
}

function isApiV1BaseUrl(baseUrl) {
  return /\/api\/v1$/i.test(baseUrl);
}

function buildModelsEndpoint(baseUrl) {
  if (isInferenceBaseUrl(baseUrl) || isApiV1BaseUrl(baseUrl)) {
    return `${baseUrl}/models`;
  }

  // Public router or agent endpoint style (base endpoint + /api/v1/...)
  return `${baseUrl}/api/v1/models`;
}

function buildChatCompletionsEndpoint(baseUrl) {
  if (isInferenceBaseUrl(baseUrl) || isApiV1BaseUrl(baseUrl)) {
    return `${baseUrl}/chat/completions`;
  }

  // Public router or agent endpoint style (base endpoint + /api/v1/...)
  return `${baseUrl}/api/v1/chat/completions`;
}

/**
 * Fetch available models from Gradient API
 */
async function fetchAvailableModels() {
  const gradientApiKey = process.env.GRADIENT_API_KEY;
  const gradientBaseUrl = normalizeBaseUrl(process.env.GRADIENT_BASE_URL);
  const modelsEndpoint = buildModelsEndpoint(gradientBaseUrl);

  if (!gradientApiKey) {  
    throw new Error('GRADIENT_API_KEY not configured');
  }

  try {
    console.log('Fetching models from:', modelsEndpoint);
    
    const response = await fetch(modelsEndpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${gradientApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('API Response Status:', response.status, response.statusText);

    if (!response.ok) {
      const responseText = await response.text();

      // Public router endpoints may not expose /models; fall back to configured default model.
      if (!isInferenceBaseUrl(gradientBaseUrl) && (response.status === 403 || response.status === 404)) {
        console.warn('Models endpoint unavailable for router endpoint; using configured default model only.');
        return [{
          id: DEFAULT_MODEL_ID,
          name: DEFAULT_MODEL_ID,
          owned_by: 'DigitalOcean Router',
        }];
      }

      console.error('API Error Response:', responseText);
      throw new Error(`API returned status ${response.status}: ${response.statusText} - ${responseText}`);
    }

    const data = await response.json();
    
    console.log('Raw Gradient API response:', JSON.stringify(data, null, 2));

    // Handle different response formats
    let modelsList = [];
    
    if (Array.isArray(data)) {
      // Direct array response
      console.log('Response is direct array');
      modelsList = data;
    } else if (data.data && Array.isArray(data.data)) {
      // Response with data property
      console.log('Response has data property');
      modelsList = data.data;
    } else if (data.object === 'list' && data.data) {
      // OpenAI-compatible format
      console.log('Response is OpenAI-compatible format');
      modelsList = data.data;
    } else {
      console.warn('Unexpected response format:', Object.keys(data));
      modelsList = [];
    }

    // Convert to standard model format
    const models = modelsList.map((model) => {
      console.log('Processing model:', model);
      return {
        id: model.id,
        name: model.id,
        owned_by: model.owned_by || 'Gradient',
      };
    }).filter(m => m.id); // Filter out models without ID

    console.log('Final parsed models:', models);

    if (models.length === 0) {
      console.warn('No valid models found in response');
    }

    return models;
  } catch (error) {
    console.error('Error fetching models:', error);
    throw new Error(`Failed to fetch available models: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * GET endpoint to retrieve available models
 */
async function getModels(req, res) {
  try {
    const gradientBaseUrl = normalizeBaseUrl(process.env.GRADIENT_BASE_URL);

    console.log('=== Models Endpoint Called ===');
    console.log('GRADIENT_API_KEY configured:', !!process.env.GRADIENT_API_KEY);
    console.log('GRADIENT_BASE_URL:', gradientBaseUrl);
    
    const models = await fetchAvailableModels();
    
    console.log('Successfully fetched models:', models.length);
    res.json({
      status: 'success',
      models,
      defaultModel: DEFAULT_MODEL_ID,
    });
  } catch (error) {
    console.error('=== Models Endpoint Error ===');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    console.error('Full error:', error);
    
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Failed to fetch models',
      details: error instanceof Error ? error.stack : undefined,
    });
  }
}

/**
 * POST endpoint for chat streaming
 */
async function chat(req, res) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  try {
    // Validate environment
    const gradientApiKey = process.env.GRADIENT_API_KEY;
    const gradientBaseUrl = normalizeBaseUrl(process.env.GRADIENT_BASE_URL);
    const chatEndpoint = buildChatCompletionsEndpoint(gradientBaseUrl);

    console.log('[chat] request started', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      baseUrl: gradientBaseUrl,
      endpoint: chatEndpoint,
    });

    if (!gradientApiKey) {
      console.error('Error: GRADIENT_API_KEY is not set');
      return res.status(500).json({ 
        error: 'API configuration error: GRADIENT_API_KEY is not set',
        details: 'Please configure your Gradient API key in environment variables',
      });
    }

    // Validate messages
    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid request',
        details: 'No messages provided',
      });
    }

    // Use fixed router model/task for chat retrieval workflow
    const modelId = DEFAULT_MODEL_ID;
    const taskId = DEFAULT_TASK_ID;
    const temperature = req.body?.temperature ?? 0.7;
    const maxTokens = parseInt(req.body?.maxTokens ?? 2000) || 2000;

    const latestUserMessage = [...messages].reverse().find((message) => message?.role === 'user')?.content;
    const browserId = req.headers['x-browser-id'] || req.body?.browserId || '';
    let messagesForModel = messages;
    let ragUsed = false;
    let ragSources = [];

    if (typeof latestUserMessage === 'string' && latestUserMessage.trim().length > 0) {
      try {
        const rag = browserId
          ? await retrieveRagContextForUser(latestUserMessage, browserId)
          : await retrieveRagContext(latestUserMessage);
        if (rag.used && rag.context) {
          const ragSystemMessage = {
            role: 'system',
            content: `Use the retrieved local PDF context when relevant. If context is insufficient, say so and continue with best effort.\n\nRetrieved context:\n${rag.context}`,
          };

          messagesForModel = [ragSystemMessage, ...messages];
          ragUsed = true;
          ragSources = rag.sources;
          console.log('RAG context attached:', { sourceCount: rag.sources.length, sources: rag.sources });
          console.log('RAG attached text chunk:', {
            requestId,
            characterCount: rag.context.length,
            text: rag.context,
          });
        } else {
          console.log('[chat] RAG not used', { requestId });
        }
      } catch (ragError) {
        console.warn('RAG retrieval failed, continuing without RAG:', ragError);
      }
    }

    console.log('Chat request:', {
      requestId,
      modelId, 
      taskId,
      messageCount: messages.length, 
      temperature, 
      maxTokens,
      ragUsed,
    });

    // Call Gradient API
    const response = await fetch(chatEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gradientApiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        task: taskId,
        messages: messagesForModel,
        temperature: temperature,
        max_tokens: maxTokens,
        stream: false, // We'll handle streaming ourselves if needed
      }),
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      let errorDetails = `HTTP ${response.status}: ${response.statusText}`;
      try {
        if (contentType?.includes('application/json')) {
          const errorData = await response.json();
          errorDetails = errorData.error?.message || errorData.message || errorDetails;
        } else {
          const text = await response.text();
          errorDetails = text || errorDetails;
        }
      } catch (e) {
        // Fallback to status text
      }

      // Check for subscription tier issues
      if (errorDetails.toLowerCase().includes('not available for your subscription') || 
          errorDetails.toLowerCase().includes('subscription tier')) {
        console.error('Model not available for subscription tier:', modelId);
        const suggestion = modelId !== DEFAULT_MODEL_ID 
          ? `The model "${modelId}" is not available for your subscription tier. Try using the default model: "${DEFAULT_MODEL_ID}"`
          : `The model "${modelId}" is not available for your subscription tier. Please check your DigitalOcean Gradient account.`;
        
        return res.status(400).json({
          error: 'Model not available',
          details: suggestion,
          originalError: errorDetails,
          availableDefault: DEFAULT_MODEL_ID,
          model: modelId,
        });
      }

      console.error('Gradient API error:', errorDetails);
      console.error('[chat] request failed', {
        requestId,
        status: response.status,
        elapsedMs: Date.now() - startedAt,
      });
      return res.status(response.status).json({
        error: 'Gradient API error',
        details: errorDetails,
        model: modelId,
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    if (!content) {
      console.warn('Empty response from Gradient API:', data);
      return res.status(500).json({
        error: 'Empty response from API',
        details: 'The AI model returned an empty response',
      });
    }

    // Send response as plain text
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.write(content);
    res.end();

    console.log('[chat] request completed', {
      requestId,
      status: 200,
      elapsedMs: Date.now() - startedAt,
      ragUsed,
      ragSourceCount: ragSources.length,
    });

  } catch (error) {
    console.error('Chat error:', error);
    console.error('[chat] request crashed', {
      requestId,
      elapsedMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : 'Internal server error',
    });
    if (!res.headersSent) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      res.status(500).json({ 
        error: 'Chat request failed',
        details: message,
      });
    }
  }
}

export { chat, getModels };
export default chat;
