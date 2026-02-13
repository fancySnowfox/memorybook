'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle } from 'lucide-react';
import Link from 'next/link';

function SuccessContent() {
  const searchParams = useSearchParams();
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const id = searchParams.get('session_id');
    setSessionId(id);
  }, [searchParams]);

  return (
    <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
      <div className="flex justify-center mb-4">
        <CheckCircle className="w-16 h-16 text-green-500" />
      </div>
      
      <h1 className="text-3xl font-bold text-gray-800 mb-4">
        Payment Successful!
      </h1>
      
      <p className="text-gray-600 mb-6">
        Thank you for your purchase! Your memory book is being created.
      </p>

      {sessionId && (
        <p className="text-sm text-gray-500 mb-6">
          Order ID: {sessionId.slice(0, 20)}...
        </p>
      )}

      <div className="space-y-3">
        <p className="text-gray-700">
          We&apos;ll send you an email with instructions on how to access and download your memory book once it&apos;s ready.
        </p>
        
        <p className="text-gray-700">
          This usually takes 24-48 hours.
        </p>
      </div>

      <div className="mt-8">
        <Link
          href="/"
          className="inline-block px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
        >
          Return to Home
        </Link>
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-purple-50 flex items-center justify-center p-4">
      <Suspense fallback={
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="flex justify-center mb-4">
            <CheckCircle className="w-16 h-16 text-green-500" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-4">
            Loading...
          </h1>
        </div>
      }>
        <SuccessContent />
      </Suspense>
    </div>
  );
}
