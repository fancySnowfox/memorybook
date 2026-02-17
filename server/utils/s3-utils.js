import { S3Client } from '@aws-sdk/client-s3';

const s3Config = {
  endpoint: process.env.DO_SPACES_ENDPOINT || 'https://nyc3.digitaloceanspaces.com',
  region: process.env.DO_SPACES_REGION || 'nyc3',
  credentials: {
    accessKeyId: process.env.DO_SPACES_ACCESS_KEY || '',
    secretAccessKey: process.env.DO_SPACES_SECRET_KEY || '',
  },
};

const s3Client = new S3Client(s3Config);
const BUCKET_NAME = process.env.DO_SPACES_BUCKET || '';

// Process messages to replace base64 data with S3 URLs
export async function processMessagesForBase64(messages) {
  if (!messages) {
    console.warn('processMessagesForBase64: messages is null/undefined');
    return [];
  }

  if (!Array.isArray(messages)) {
    console.warn('processMessagesForBase64: messages is not an array, type:', typeof messages);
    return [];
  }

  if (messages.length === 0) {
    console.log('processMessagesForBase64: empty messages array');
    return [];
  }

  try {
    const results = await Promise.all(
      messages.map(async (msg) => {
        if (!msg) {
          console.warn('processMessagesForBase64: null message in array');
          return null;
        }

        if (msg.content && Array.isArray(msg.content)) {
          const processedContent = await Promise.all(
            msg.content.map(async (part) => {
              if (part && part.type === 'image' && part.image && typeof part.image === 'string' && part.image.startsWith('data:')) {
                // TODO: Upload base64 image to S3 and return presigned URL
                return part;
              }
              return part;
            })
          );
          return { ...msg, content: processedContent };
        }
        return msg;
      })
    );

    // Filter out null entries and return
    const filtered = results.filter(msg => msg !== null);
    console.log(`processMessagesForBase64: processed ${filtered.length}/${messages.length} messages`);
    return filtered;
  } catch (error) {
    console.error('processMessagesForBase64: error processing messages:', error);
    return messages; // Return original messages if processing fails
  }
}

export async function processToolCallForBase64({ toolName, args }) {
  // TODO: Process any base64 data in tool arguments
  return { args };
}

export async function processToolResultForBase64(result) {
  // TODO: Process any base64 data in tool results
  return result;
}
