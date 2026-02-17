const DEFAULT_MODEL_ID = process.env.AI_MODEL_ID || 'openai-gpt-oss-120b';

/**
 * Fetch available models from Gradient API
 */
async function fetchAvailableModels() {
  const gradientApiKey = process.env.GRADIENT_API_KEY;
  const gradientBaseUrl = process.env.GRADIENT_BASE_URL || 'https://inference.do-ai.run/v1';

  if (!gradientApiKey) {
    throw new Error('GRADIENT_API_KEY not configured');
  }

  try {
    console.log('Fetching models from:', `${gradientBaseUrl}/models`);
    
    const response = await fetch(`${gradientBaseUrl}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${gradientApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('API Response Status:', response.status, response.statusText);

    if (!response.ok) {
      const responseText = await response.text();
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
    console.log('=== Models Endpoint Called ===');
    console.log('GRADIENT_API_KEY configured:', !!process.env.GRADIENT_API_KEY);
    console.log('GRADIENT_BASE_URL:', process.env.GRADIENT_BASE_URL || 'https://inference.do-ai.run/v1');
    
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
  try {
    // Validate environment
    const gradientApiKey = process.env.GRADIENT_API_KEY;
    const gradientBaseUrl = process.env.GRADIENT_BASE_URL || 'https://inference.do-ai.run/v1';

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

    // Get model ID from request or use default
    const modelId = req.body?.modelId || DEFAULT_MODEL_ID;
    const temperature = req.body?.temperature ?? 0.7;
    const maxTokens = parseInt(req.body?.maxTokens ?? 2000) || 2000;

    console.log('Chat request:', { 
      modelId, 
      messageCount: messages.length, 
      temperature, 
      maxTokens 
    });

    // Call Gradient API
    const response = await fetch(`${gradientBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gradientApiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: messages,
        temperature: temperature,
        max_tokens: maxTokens,
        stream: false, // We'll handle streaming ourselves if needed
      }),
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      let errorDetails = `HTTP ${response.status}: ${response.statusText}`;
      let userMessage = '';
      
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

    // Send response as text stream format
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.write(content);
    res.end();

  } catch (error) {
    console.error('Chat error:', error);
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
