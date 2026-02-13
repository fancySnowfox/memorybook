# Memory Book Chatbot

This feature allows users to create personalized memory books for their loved ones through an interactive chatbot interface.

## Features

- **Simple, Mobile-Friendly UI**: Clean chat interface optimized for mobile browsers
- **Interactive Chatbot**: Guides users through the memory book creation process step-by-step
- **Media Upload**: Support for uploading photos and videos
- **Music Selection**: Choose from pre-selected music or upload custom audio
- **Stripe Payment Integration**: Secure payment processing for memory book orders
- **File Storage**: Automatic upload to DigitalOcean Spaces (S3-compatible storage)

## User Flow

1. **Name Entry**: User provides the name of their loved one
2. **Photo Upload**: Upload multiple photos that capture special moments
3. **Video Upload**: Optionally add videos to bring memories to life
4. **Music Selection**: Choose background music from preset options or upload custom audio
5. **Payment**: Secure checkout via Stripe ($29.99 per memory book)
6. **Success**: Confirmation page with order details

## Setup

### 1. Install Dependencies

The required dependencies are already included in `package.json`:
- `stripe`: Stripe payment processing
- `@stripe/stripe-js`: Stripe client-side library
- `multer`: File upload handling

### 2. Configure Environment Variables

Add the following to your `.env` file:

```bash
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...

# Base URL (for Stripe redirects)
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# DigitalOcean Spaces (for file storage)
DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
DO_SPACES_REGION=nyc3
DO_SPACES_ACCESS_KEY=your_access_key
DO_SPACES_SECRET_KEY=your_secret_key
DO_SPACES_BUCKET=your_bucket_name
```

### 3. Get Stripe API Keys

1. Sign up for a Stripe account at https://stripe.com
2. Go to the [Dashboard](https://dashboard.stripe.com/apikeys)
3. Copy your test API keys for development
4. Use live keys in production

### 4. Set Up DigitalOcean Spaces

The memory book feature uses the existing S3-compatible storage configuration. Files are uploaded to:
- Photos: `memorybook/photo/`
- Videos: `memorybook/video/`

## Usage

### Accessing the Memory Book Creator

Navigate to `/memorybook` in your browser:
```
http://localhost:3000/memorybook
```

### API Endpoints

#### Create Checkout Session
```
POST /api/memorybook/create-checkout
```

Request body:
```json
{
  "lovedOneName": "John Doe",
  "photoCount": 5,
  "videoCount": 2,
  "music": "Peaceful Piano"
}
```

Response:
```json
{
  "url": "https://checkout.stripe.com/..."
}
```

#### Upload Files
```
POST /api/memorybook/upload
```

Request: multipart/form-data
- `files`: File[] (multiple files)
- `type`: string ('photo' or 'video')

Response:
```json
{
  "success": true,
  "urls": ["https://..."]
}
```

## Development

### Running Locally

```bash
# Install dependencies
yarn install

# Run development server
yarn dev
```

Visit http://localhost:3000/memorybook

### Testing Payments

Use Stripe test cards:
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`

Any future expiry date and any 3-digit CVC will work with test cards.

## Mobile Responsiveness

The UI is built with Tailwind CSS and is fully responsive:
- Flexible layout adapts to screen size
- Touch-friendly buttons and inputs
- Optimized for mobile browsers
- Maximum width constraints for readability on larger screens

## Security Notes

- File uploads are stored in DigitalOcean Spaces with public-read ACL
- Stripe handles all payment card data (PCI compliant)
- Use HTTPS in production
- Keep API keys secure and never commit them to version control
- Consider adding file type validation and size limits
- Implement rate limiting for API endpoints in production

## Future Enhancements

Potential improvements:
- Email notifications when memory book is ready
- Admin dashboard to manage orders
- Memory book preview before payment
- Custom music upload functionality
- Additional payment options
- Order history and tracking
- PDF generation of memory books
- Social sharing features
