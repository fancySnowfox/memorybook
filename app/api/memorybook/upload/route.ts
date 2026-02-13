import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const type = formData.get('type') as string; // 'photo' or 'video'
    
    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: 'No files provided' },
        { status: 400 }
      );
    }

    const uploadedUrls: string[] = [];
    
    // Initialize S3 client
    const s3Client = new S3Client({
      endpoint: process.env.DO_SPACES_ENDPOINT || 'https://nyc3.digitaloceanspaces.com',
      region: process.env.DO_SPACES_REGION || 'nyc3',
      credentials: {
        accessKeyId: process.env.DO_SPACES_ACCESS_KEY || '',
        secretAccessKey: process.env.DO_SPACES_SECRET_KEY || '',
      },
    });
    
    const bucket = process.env.DO_SPACES_BUCKET || 'memorybook';

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const fileName = `memorybook/${type}/${Date.now()}-${file.name}`;

      // Upload with private ACL for security
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: fileName,
        Body: buffer,
        ContentType: file.type,
        ACL: 'private', // Changed from 'public-read' for security
      });

      await s3Client.send(command);
      
      // Generate presigned URL for private access
      const getCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: fileName,
      });
      
      const url = await getSignedUrl(s3Client, getCommand, {
        expiresIn: 3600 * 24 * 7, // 7 days
      });
      
      uploadedUrls.push(url);
    }

    return NextResponse.json({ 
      success: true, 
      urls: uploadedUrls 
    });
  } catch (error: unknown) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Error uploading files' },
      { status: 500 }
    );
  }
}

// Configure Next.js to handle large file uploads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};
