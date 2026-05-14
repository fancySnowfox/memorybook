const DEFAULT_GRADIENT_BASE_URL = 'https://inference.do-ai.run/v1';

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

  return `${baseUrl}/api/v1/models`;
}

function buildChatCompletionsEndpoint(baseUrl) {
  if (isInferenceBaseUrl(baseUrl) || isApiV1BaseUrl(baseUrl)) {
    return `${baseUrl}/chat/completions`;
  }

  return `${baseUrl}/api/v1/chat/completions`;
}

// Health check utility for Gradient API connectivity
export async function checkApiConnectivity(baseUrl, apiKey, modelId = 'openai-gpt-oss-120b', timeoutMs = 5000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

    const endpoint = isInferenceBaseUrl(normalizedBaseUrl)
      ? buildModelsEndpoint(normalizedBaseUrl)
      : buildChatCompletionsEndpoint(normalizedBaseUrl);

    const requestOptions = isInferenceBaseUrl(normalizedBaseUrl)
      ? {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        }
      : {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: 'health check' }],
            max_tokens: 1,
            stream: false,
          }),
          signal: controller.signal,
        };

    const response = await fetch(endpoint, requestOptions);

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        accessible: false,
        statusCode: response.status,
        message: `API returned status ${response.status} from ${endpoint}`,
      };
    }

    return {
      accessible: true,
      statusCode: 200,
      message: 'API is accessible',
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        accessible: false,
        statusCode: null,
        message: `API connection timeout after ${timeoutMs}ms`,
      };
    }

    if (error instanceof TypeError && error.message.includes('fetch')) {
      return {
        accessible: false,
        statusCode: null,
        message: `Unable to reach API: ${error.message}`,
      };
    }

    return {
      accessible: false,
      statusCode: null,
      message: `Connectivity check failed: ${error.message}`,
    };
  }
}

// Retry logic with exponential backoff
export async function retryWithBackoff(fn, maxAttempts = 3, baseDelayMs = 100) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      console.log(`Attempt ${attempt} failed. Retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
