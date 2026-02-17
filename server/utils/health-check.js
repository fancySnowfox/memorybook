// Health check utility for Gradient API connectivity
export async function checkApiConnectivity(baseUrl, apiKey, timeoutMs = 5000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        accessible: false,
        statusCode: response.status,
        message: `API returned status ${response.status}`,
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
